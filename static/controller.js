const socket = io();
let enabled = false;
let seq = 0;
let receivedSensorEvent = false;

const statusEl = document.getElementById("status");
const enableButton = document.getElementById("enable");
const diagnosticEl = document.getElementById("diagnostic");
const nameInput = document.getElementById("playerName");

function sendName() {
    if (!nameInput) return;
    const clean = setPlayerName(nameInput.value);
    socket.emit("set_name", { name: clean });
}

if (nameInput) {
    // Preenche com o nome salvo neste celular, se já tiver jogado antes.
    const saved = getPlayerName();
    nameInput.value = saved === "Jogador" ? "" : saved;
    nameInput.addEventListener("input", sendName);
}

function show(id, value) {
    document.getElementById(id).textContent = Number(value).toFixed(2);
}

function setDiagnostic(message) {
    if (diagnosticEl) diagnosticEl.textContent = message;
}

socket.on("connect", () => {
    statusEl.textContent = "Conectado ao servidor";
    socket.emit("controller_connected");
    sendName();
});

socket.on("disconnect", () => {
    statusEl.textContent = "Servidor desconectado";
});

function checkEnvironment() {
    if (!("DeviceOrientationEvent" in window)) {
        setDiagnostic("Este navegador não disponibiliza DeviceOrientationEvent.");
        return false;
    }

    if (!window.isSecureContext) {
        setDiagnostic(
            "Sensor bloqueado: esta página está em HTTP. Abra o controle por HTTPS no celular."
        );
        return false;
    }

    setDiagnostic("Ambiente seguro detectado. Toque em Ativar giroscópio.");
    return true;
}

async function requestPermission() {
    if (
        typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== "granted") {
            throw new Error("Permissão do sensor recusada.");
        }
    }
}

function handleOrientation(event) {
    if (!enabled) return;

    receivedSensorEvent = true;

    const alpha = event.alpha ?? 0;
    const beta = event.beta ?? 0;
    const gamma = event.gamma ?? 0;

    show("alpha", alpha);
    show("beta", beta);
    show("gamma", gamma);

    setDiagnostic("Sensor recebendo dados.");

    socket.emit("gyro", {
        alpha,
        beta,
        gamma,
        seq: ++seq
    });
}

enableButton.addEventListener("click", async () => {
    try {
        if (!checkEnvironment()) {
            statusEl.textContent = "Giroscópio bloqueado pelo navegador";
            return;
        }

        await requestPermission();

        window.addEventListener("deviceorientation", handleOrientation, true);

        enabled = true;
        enableButton.disabled = true;
        enableButton.textContent = "Giroscópio ativo";
        statusEl.textContent = "Aguardando dados do sensor...";
        setDiagnostic("Incline o celular para testar.");

        setTimeout(() => {
            if (enabled && !receivedSensorEvent) {
                statusEl.textContent = "Nenhum dado do sensor recebido";
                setDiagnostic(
                    "O navegador não entregou eventos do sensor. Confirme HTTPS e a permissão de movimento/sensores do navegador."
                );
            }
        }, 3000);
    } catch (error) {
        statusEl.textContent = "Erro: " + error.message;
        setDiagnostic("Verifique a permissão de movimento/sensores do navegador.");
    }
});

const GAME_LABELS = {
    flappy: "Flappy",
    breakout: "Breakout",
    dots: "Ligue os Pontos",
    birds: "Gyro Birds"
};

const selectedGameEl = document.getElementById("selectedGame");

document.querySelectorAll(".game-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        const game = btn.dataset.game;

        document.querySelectorAll(".game-btn").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");

        if (selectedGameEl) {
            selectedGameEl.textContent =
                "Abrindo " + (GAME_LABELS[game] || game) + " na tela...";
        }

        socket.emit("select_game", { game });
    });
});

const actionButton = document.getElementById("action");

if (actionButton) {
    actionButton.addEventListener("click", () => {
        socket.emit("action", {});

        // Feedback visual rápido de que o toque foi enviado.
        actionButton.classList.add("pressed");
        setTimeout(() => actionButton.classList.remove("pressed"), 150);
    });
}

checkEnvironment();
