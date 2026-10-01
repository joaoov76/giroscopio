const socket = io();

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const scoreElement = document.getElementById("score");
const birdsLeftElement = document.getElementById("birdsLeft");
const levelElement = document.getElementById("level");
const connectionElement = document.getElementById("connection");

let currentPlayerName = getPlayerName();

setupPlayerHud("birds", (name) => { currentPlayerName = name; });

// O nome "de verdade" chega do celular (controle), em tempo real.
socket.on("player_name", (data) => {
    currentPlayerName = (data && data.name) || "Jogador";
    const nameEl = document.getElementById("playerName");
    if (nameEl) nameEl.textContent = currentPlayerName;
});

const GROUND_Y = canvas.height - 30;
const SLING_X = 130;
const SLING_Y = GROUND_Y - 70;

const GRAVITY = 0.55;
const MIN_POWER = 11;
const MAX_POWER = 20;
const BASE_ANGLE = 50 * Math.PI / 180;   // ângulo padrão de lançamento
const ANGLE_VAR = 22 * Math.PI / 180;    // o quanto a inclinação lateral ajusta o ângulo

const bird = {
    x: SLING_X,
    y: SLING_Y,
    radius: 13,
    vx: 0,
    vy: 0,
    rolling: 0 // tempo parado no chão, usado para decidir quando trocar de pássaro
};

// gamma = inclinação esquerda/direita (ajusta o ângulo), beta = frente/trás (ajusta a força).
// gamma0/beta0 é a posição "neutra" calibrada no início da fase.
const input = {gamma: 0, beta: 0, gamma0: 0, beta0: 0};

const state = {
    mode: "ready",      // ready | aim | flying | levelDone | over
    started: false,     // true depois do primeiro pacote do giroscópio
    calibrated: false,
    score: 0,
    level: 0,
    birdsLeft: 3,
    blocks: [],
    pigs: [],
    timer: 1,
    statusMessage: "",
    statusTimer: 0,
    message: "",
    lastTime: performance.now()
};

// Cada fase: pássaros disponíveis, blocos (obstáculos) e porquinhos (alvos).
// material "wood" quebra com 1 acerto, "stone" precisa de 2.
const LEVELS = [
    {
        birds: 3,
        blocks: [],
        pigs: [
            {x: 650, y: GROUND_Y - 16}
        ]
    },
    {
        birds: 4,
        blocks: [
            {x: 600, y: GROUND_Y - 90, w: 30, h: 60, material: "wood"},
            {x: 660, y: GROUND_Y - 90, w: 30, h: 60, material: "wood"},
            {x: 595, y: GROUND_Y - 120, w: 100, h: 30, material: "wood"}
        ],
        pigs: [
            {x: 645, y: GROUND_Y - 136}
        ]
    },
    {
        birds: 5,
        blocks: [
            {x: 555, y: GROUND_Y - 90, w: 26, h: 60, material: "stone"},
            {x: 605, y: GROUND_Y - 90, w: 26, h: 60, material: "wood"},
            {x: 655, y: GROUND_Y - 90, w: 26, h: 60, material: "stone"},
            {x: 580, y: GROUND_Y - 120, w: 76, h: 30, material: "wood"}
        ],
        pigs: [
            {x: 605, y: GROUND_Y - 136},
            {x: 740, y: GROUND_Y - 16}
        ]
    }
];

const MATERIAL_HP = {wood: 1, stone: 2};
const MATERIAL_COLOR = {wood: "#c8893f", stone: "#9aa0ad"};
const MATERIAL_POINTS = {wood: 80, stone: 150};

socket.on("connect", () => {
    connectionElement.textContent = "Servidor conectado";
});

socket.on("disconnect", () => {
    connectionElement.textContent = "Servidor desconectado";
});

socket.on("controller_status", () => {
    connectionElement.textContent = "Controle conectado";
});

socket.on("player_gyro", (data) => {
    input.gamma = Number(data.gamma) || 0;
    input.beta = Number(data.beta) || 0;
    state.started = true;
});

// Botão "Soltar" do celular.
socket.on("action", () => tryLaunch());

// Teclado só para testar sem celular:
// setas ajustam mira/força e espaço solta o pássaro.
const keys = {};

window.addEventListener("keydown", (e) => {
    keys[e.key] = true;
    state.started = true;
    if (e.key === " ") {
        e.preventDefault();
        tryLaunch();
    }
});

window.addEventListener("keyup", (e) => {
    keys[e.key] = false;
});

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function updateHud() {
    scoreElement.textContent = state.score;
    birdsLeftElement.textContent = state.birdsLeft;
    levelElement.textContent = state.level + 1;
}

function setStatus(message) {
    state.statusMessage = message;
    state.statusTimer = 1.6;
}

function startLevel(index) {
    const level = LEVELS[index];

    state.level = index;
    state.birdsLeft = level.birds;
    state.blocks = level.blocks.map(b => ({
        ...b,
        hp: MATERIAL_HP[b.material],
        maxHp: MATERIAL_HP[b.material]
    }));
    state.pigs = level.pigs.map(p => ({...p, radius: 15, alive: true}));
    state.calibrated = false;
    state.mode = "ready";
    state.timer = 1;

    placeBirdOnSling();
    updateHud();
    hideGameOverPanel();
}

function resetGame() {
    state.score = 0;
    scoreSaved = false;
    startLevel(0);
}

function placeBirdOnSling() {
    bird.x = SLING_X;
    bird.y = SLING_Y;
    bird.vx = 0;
    bird.vy = 0;
    bird.rolling = 0;
}

// Calcula o ângulo e a força atuais a partir da inclinação do celular
// (ou do teclado, para testar sem telefone).
function currentAim() {
    let liveGamma = input.gamma - input.gamma0;
    let liveBeta = input.beta - input.beta0;

    if (keys["ArrowLeft"]) liveGamma = -25;
    if (keys["ArrowRight"]) liveGamma = 25;
    if (keys["ArrowUp"]) liveBeta = -30;
    if (keys["ArrowDown"]) liveBeta = 15;

    // Se a puxada estiver "ao contrário" no seu celular, inverta os sinais abaixo.
    const pullX = clamp(liveGamma / 30, -1, 1);
    const pullBack = clamp(-liveBeta / 35, 0, 1);

    const angle = clamp(BASE_ANGLE + pullX * ANGLE_VAR, 20 * Math.PI / 180, 80 * Math.PI / 180);
    const power = MIN_POWER + pullBack * (MAX_POWER - MIN_POWER);

    return {angle, power, pullBack};
}

function tryLaunch() {
    if (state.mode !== "aim") return;

    const {angle, power} = currentAim();

    bird.vx = power * Math.cos(angle);
    bird.vy = -power * Math.sin(angle);
    state.mode = "flying";
    state.birdsLeft--;
    updateHud();
}

// Colisão simples círculo x retângulo (mesmo estilo usado no Breakout).
function hitsBlock(b) {
    return (
        bird.x + bird.radius > b.x &&
        bird.x - bird.radius < b.x + b.w &&
        bird.y + bird.radius > b.y &&
        bird.y - bird.radius < b.y + b.h
    );
}

function resolveBlockHit(b) {
    const overlapX = Math.min(
        bird.x + bird.radius - b.x,
        b.x + b.w - (bird.x - bird.radius)
    );
    const overlapY = Math.min(
        bird.y + bird.radius - b.y,
        b.y + b.h - (bird.y - bird.radius)
    );

    if (overlapX < overlapY) bird.vx = -bird.vx * 0.4;
    else bird.vy = -bird.vy * 0.4;

    bird.vx *= 0.85;
    bird.vy *= 0.85;

    b.hp--;

    if (b.hp <= 0) {
        state.score += MATERIAL_POINTS[b.material];
        setStatus(b.material === "stone" ? "Pedra destruída!" : "Madeira destruída!");
        return true; // destruído
    }
    return false;
}

function checkPigHit(p) {
    const dist = Math.hypot(bird.x - p.x, bird.y - p.y);
    return dist < bird.radius + p.radius;
}

function allPigsDown() {
    return state.pigs.every(p => !p.alive);
}

function finishShot() {
    if (allPigsDown()) {
        const bonus = state.birdsLeft * 300;
        state.score += bonus;
        updateHud();

        if (state.level + 1 < LEVELS.length) {
            state.message = "Fase completa! +" + bonus + " de bônus";
            state.mode = "levelDone";
            state.timer = 2.2;
        } else {
            state.message = "VOCÊ VENCEU! " + state.score + " pontos";
            state.mode = "over";
            state.timer = 2;
            saveScore();
            showGameOverRanking("birds", state.message);
        }
        return;
    }

    if (state.birdsLeft <= 0) {
        state.message = "GAME OVER - incline forte para recomeçar";
        state.mode = "over";
        state.timer = 2;
        saveScore();
        showGameOverRanking("birds", "Fim de jogo! Você fez " + state.score + " pontos");
        return;
    }

    placeBirdOnSling();
    state.mode = "aim";
}

function update(dt) {
    if (!state.started) return;

    if (state.statusTimer > 0) state.statusTimer -= dt;

    if (state.mode === "ready") {
        state.timer -= dt;
        if (state.timer <= 0) {
            input.gamma0 = input.gamma;
            input.beta0 = input.beta;
            state.calibrated = true;
            state.mode = "aim";
        }
        return;
    }

    if (state.mode === "levelDone") {
        state.timer -= dt;
        if (state.timer <= 0) startLevel(state.level + 1);
        return;
    }

    if (state.mode === "over") {
        state.timer -= dt;

        const wantsRestart =
            Math.abs(input.gamma - input.gamma0) > 35 ||
            keys["Enter"] || keys[" "];

        if (state.timer <= 0 && wantsRestart) resetGame();
        return;
    }

    if (state.mode === "aim") return; // espera o toque em "Soltar"

    // --- pássaro voando ---
    bird.vy += GRAVITY * dt * 60;
    bird.x += bird.vx * dt * 60;
    bird.y += bird.vy * dt * 60;

    if (bird.x - bird.radius < 0) {
        bird.x = bird.radius;
        bird.vx = Math.abs(bird.vx) * 0.5;
    }

    // Chão
    if (bird.y + bird.radius > GROUND_Y) {
        bird.y = GROUND_Y - bird.radius;
        bird.vy = -bird.vy * 0.35;
        bird.vx *= 0.85;

        if (Math.abs(bird.vx) < 0.6 && Math.abs(bird.vy) < 1.2) {
            bird.rolling += dt;
        }
    }

    // Blocos (um pássaro pode atravessar/derrubar mais de um por lançamento)
    state.blocks = state.blocks.filter(b => {
        if (!hitsBlock(b)) return true;
        return !resolveBlockHit(b);
    });

    // Porquinhos
    for (const p of state.pigs) {
        if (p.alive && checkPigHit(p)) {
            p.alive = false;
            state.score += 500;
            setStatus("Porquinho atingido! +500");
            bird.vx *= 0.8;
            bird.vy *= 0.8;
        }
    }

    updateHud();

    const offScreen = bird.x - bird.radius > canvas.width;
    const settled = bird.rolling > 0.6;

    if (offScreen || settled) finishShot();
}

let scoreSaved = false;

function saveScore() {
    if (scoreSaved || state.score <= 0) return;
    scoreSaved = true;

    const best = setBestScore("birds", state.score);
    const bestEl = document.getElementById("bestScore");
    if (bestEl) bestEl.textContent = best;

    fetch("/score", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            name: currentPlayerName,
            score: state.score,
            game: "birds"
        })
    }).catch(console.error);
}

function drawTrajectoryPreview() {
    const {angle, power} = currentAim();

    let x = SLING_X;
    let y = SLING_Y;
    let vx = power * Math.cos(angle);
    let vy = -power * Math.sin(angle);

    ctx.fillStyle = "rgba(255,255,255,0.55)";

    for (let i = 0; i < 26; i++) {
        vy += GRAVITY * 0.5;
        x += vx * 0.5;
        y += vy * 0.5;

        if (x > canvas.width || y > GROUND_Y) break;

        if (i % 2 === 0) {
            ctx.beginPath();
            ctx.arc(x, y, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function drawSlingshot() {
    ctx.strokeStyle = "#5a3b1f";
    ctx.lineWidth = 8;
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(SLING_X - 14, GROUND_Y);
    ctx.lineTo(SLING_X - 6, SLING_Y - 10);
    ctx.moveTo(SLING_X + 14, GROUND_Y);
    ctx.lineTo(SLING_X + 6, SLING_Y - 10);
    ctx.stroke();

    // Elástico até o pássaro (só faz sentido mostrar durante a mira)
    if (state.mode === "aim" || state.mode === "ready") {
        ctx.strokeStyle = "#8a5a2b";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(SLING_X - 6, SLING_Y - 10);
        ctx.lineTo(bird.x, bird.y);
        ctx.lineTo(SLING_X + 6, SLING_Y - 10);
        ctx.stroke();
    }
}

function drawBird() {
    ctx.fillStyle = "#e9452f";
    ctx.beginPath();
    ctx.arc(bird.x, bird.y, bird.radius, 0, Math.PI * 2);
    ctx.fill();

    // Sobrancelha braba
    ctx.strokeStyle = "#7a2015";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bird.x - 2, bird.y - 6);
    ctx.lineTo(bird.x + 7, bird.y - 2);
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(bird.x + 3, bird.y - 2, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.arc(bird.x + 4, bird.y - 2, 1.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#f5a623";
    ctx.beginPath();
    ctx.moveTo(bird.x + bird.radius - 2, bird.y);
    ctx.lineTo(bird.x + bird.radius + 9, bird.y - 2);
    ctx.lineTo(bird.x + bird.radius + 9, bird.y + 4);
    ctx.closePath();
    ctx.fill();
}

function drawBlocks() {
    for (const b of state.blocks) {
        ctx.fillStyle = MATERIAL_COLOR[b.material];
        ctx.fillRect(b.x, b.y, b.w, b.h);

        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.lineWidth = 2;
        ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);

        if (b.hp < b.maxHp) {
            ctx.strokeStyle = "rgba(255,255,255,0.7)";
            ctx.beginPath();
            ctx.moveTo(b.x + 4, b.y + 4);
            ctx.lineTo(b.x + b.w - 4, b.y + b.h - 4);
            ctx.stroke();
        }
    }
}

function drawPigs() {
    for (const p of state.pigs) {
        if (!p.alive) continue;

        ctx.fillStyle = "#6fbf4a";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(p.x - 5, p.y - 3, 3, 0, Math.PI * 2);
        ctx.arc(p.x + 5, p.y - 3, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#222";
        ctx.beginPath();
        ctx.arc(p.x - 5, p.y - 3, 1.3, 0, Math.PI * 2);
        ctx.arc(p.x + 5, p.y - 3, 1.3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#4a9c32";
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + 3, 5, 3.5, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, "#87cfff");
    sky.addColorStop(1, "#d7f0ff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Chão
    ctx.fillStyle = "#6fae3f";
    ctx.fillRect(0, GROUND_Y, canvas.width, canvas.height - GROUND_Y);
    ctx.fillStyle = "#5c8f33";
    ctx.fillRect(0, GROUND_Y, canvas.width, 6);

    drawSlingshot();
    drawBlocks();
    drawPigs();

    if (state.mode === "aim") drawTrajectoryPreview();

    drawBird();

    if (state.statusTimer > 0) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(canvas.width / 2 - 120, 16, 240, 28);
        ctx.fillStyle = "#fff";
        ctx.font = "14px Arial";
        ctx.textAlign = "center";
        ctx.fillText(state.statusMessage, canvas.width / 2, 35);
        ctx.textAlign = "left";
    }

    if (!state.started) {
        drawMessage("Abra o controle no celular");
    } else if (state.mode === "ready") {
        drawMessage("Fase " + (state.level + 1), "Segure o celular na posição neutra");
    } else if (state.mode === "aim") {
        drawMessage("Incline para mirar e toque Soltar", "Para trás = mais força · lados = ângulo");
    } else if (state.mode === "levelDone" || state.mode === "over") {
        drawMessage(state.message);
    }
}

function drawMessage(message, sub) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(130, sub ? 430 : 245, 540, sub ? 70 : 110);

    ctx.fillStyle = "#fff";
    ctx.font = "20px Arial";
    ctx.textAlign = "center";
    ctx.fillText(message, canvas.width / 2, sub ? 455 : 305);

    if (sub) {
        ctx.font = "14px Arial";
        ctx.fillText(sub, canvas.width / 2, 480);
    }
    ctx.textAlign = "left";
}

function loop(now) {
    const dt = Math.min((now - state.lastTime) / 1000, 0.05);
    state.lastTime = now;

    update(dt);
    draw();

    requestAnimationFrame(loop);
}

resetGame();
requestAnimationFrame(loop);
