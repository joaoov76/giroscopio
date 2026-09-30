const socket = io();

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const scoreElement = document.getElementById("score");
const livesElement = document.getElementById("lives");
const levelElement = document.getElementById("level");
const connectionElement = document.getElementById("connection");
const comboElement = document.getElementById("combo");

let currentPlayerName = getPlayerName();

setupPlayerHud("breakout", (name) => { currentPlayerName = name; });

// O nome "de verdade" chega do celular (controle), em tempo real.
socket.on("player_name", (data) => {
    currentPlayerName = (data && data.name) || "Jogador";
    const nameEl = document.getElementById("playerName");
    if (nameEl) nameEl.textContent = currentPlayerName;
});

const BASE_PADDLE_WIDTH = 110;

const paddle = {
    x: canvas.width / 2 - BASE_PADDLE_WIDTH / 2,
    y: canvas.height - 40,
    width: BASE_PADDLE_WIDTH,
    height: 14,
    velocity: 0,
    gamma: 0
};

const ball = {
    x: 0,
    y: 0,
    radius: 8,
    vx: 0,
    vy: 0
};

const state = {
    score: 0,
    lives: 3,
    level: 1,
    speed: 5,
    combo: 1,
    started: false,     // true depois do primeiro pacote do giroscópio
    launched: false,    // bola solta da raquete
    serveTimer: 0,
    gameOver: false,
    restartLock: 0,
    lastTime: performance.now(),
    bricks: [],
    powerups: [],
    wideTimer: 0,
    slowTimer: 0,
    statusMessage: "",
    statusTimer: 0
};

const COLORS = ["#ff5a5f", "#ff9f43", "#ffd83d", "#42b94d", "#4b8cff"];
const TOUGH_COLOR = "#8a8fa3";
const COLS = 10;
const ROWS = 5;

// Tipos de power-up: id -> {label, color, letter}
const POWERUPS = {
    wide: { label: "Plataforma larga", color: "#4b8cff", letter: "W" },
    slow: { label: "Bola lenta", color: "#a35bff", letter: "S" },
    life: { label: "+1 vida", color: "#ff6fa5", letter: "♥" }
};

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
    paddle.gamma = Number(data.gamma) || 0;
    state.started = true;
});

// Teclado (setas) só para testar sem celular.
const keys = {};

window.addEventListener("keydown", (e) => {
    keys[e.key] = true;
    state.started = true;
});

window.addEventListener("keyup", (e) => {
    keys[e.key] = false;
});

function createBricks() {
    const gap = 6;
    const width = (canvas.width - 40 - gap * (COLS - 1)) / COLS;
    const height = 24;

    state.bricks = [];

    // A partir da fase 2, uma parte dos tijolos das fileiras de cima
    // precisa de 2 acertos para quebrar.
    const toughChance = state.level >= 2 ? 0.22 : 0;

    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            const tough = row < 2 && Math.random() < toughChance;

            state.bricks.push({
                x: 20 + col * (width + gap),
                y: 60 + row * (height + gap),
                width,
                height,
                color: COLORS[row % COLORS.length],
                points: (ROWS - row) * 10,
                hits: tough ? 2 : 1,
                maxHits: tough ? 2 : 1
            });
        }
    }
}

function resetBall() {
    ball.x = paddle.x + paddle.width / 2;
    ball.y = paddle.y - ball.radius;
    ball.vx = 0;
    ball.vy = 0;
    state.launched = false;
    state.serveTimer = 1.2;
    state.combo = 1;
    updateCombo();
}

function launchBall() {
    const angle = (Math.random() * 40 - 20) * Math.PI / 180;
    ball.vx = state.speed * Math.sin(angle);
    ball.vy = -state.speed * Math.cos(angle);
    state.launched = true;
}

function updateHud() {
    scoreElement.textContent = state.score;
    livesElement.textContent = state.lives;
    levelElement.textContent = state.level;
}

function updateCombo() {
    if (comboElement) comboElement.textContent = "x" + state.combo;
}

function resetGame() {
    state.score = 0;
    state.lives = 3;
    state.level = 1;
    state.speed = 5;
    state.combo = 1;
    state.gameOver = false;
    state.powerups = [];
    state.wideTimer = 0;
    state.slowTimer = 0;
    state.statusMessage = "";
    state.statusTimer = 0;
    scoreSaved = false;
    paddle.width = BASE_PADDLE_WIDTH;
    paddle.x = canvas.width / 2 - paddle.width / 2;
    createBricks();
    resetBall();
    updateHud();
    updateCombo();
    hideGameOverPanel();
}

function nextLevel() {
    state.level++;
    state.speed = Math.min(state.speed + 0.7, 10);
    createBricks();
    resetBall();
    updateHud();
}

function setStatus(message) {
    state.statusMessage = message;
    state.statusTimer = 2;
}

function maybeDropPowerUp(brick) {
    if (Math.random() > 0.22) return;

    const roll = Math.random();
    let type = "wide";
    if (roll > 0.85) type = "life";
    else if (roll > 0.45) type = "slow";

    state.powerups.push({
        x: brick.x + brick.width / 2,
        y: brick.y + brick.height / 2,
        vy: 2.4,
        type
    });
}

function applyPowerUp(type) {
    const info = POWERUPS[type];

    if (type === "wide") {
        state.wideTimer = 8;
        paddle.width = BASE_PADDLE_WIDTH * 1.5;
    } else if (type === "slow") {
        state.slowTimer = 6;
    } else if (type === "life") {
        state.lives = Math.min(state.lives + 1, 5);
        updateHud();
    }

    setStatus(info.label + "!");
}

function update(dt) {
    if (!state.started) return;

    if (state.gameOver) {
        state.restartLock -= dt;

        // Depois de 2s, uma inclinação forte (ou tecla) recomeça.
        const wantsRestart =
            Math.abs(paddle.gamma) > 35 ||
            keys["Enter"] || keys[" "];

        if (state.restartLock <= 0 && wantsRestart) resetGame();
        return;
    }

    // O gamma representa a inclinação esquerda/direita.
    // Ajuste a sensibilidade aqui.
    const sensitivity = 0.25;
    const maxVelocity = 12;
    const deadZone = 3;

    let tilt = Math.abs(paddle.gamma) < deadZone ? 0 : paddle.gamma;
    if (keys["ArrowLeft"]) tilt = -40;
    if (keys["ArrowRight"]) tilt = 40;

    paddle.velocity = Math.max(
        -maxVelocity,
        Math.min(maxVelocity, tilt * sensitivity)
    );

    paddle.x += paddle.velocity * dt * 60;
    paddle.x = Math.max(0, Math.min(canvas.width - paddle.width, paddle.x));

    // Timers de power-up ativos.
    if (state.wideTimer > 0) {
        state.wideTimer -= dt;
        if (state.wideTimer <= 0) {
            paddle.width = BASE_PADDLE_WIDTH;
            paddle.x = Math.max(0, Math.min(canvas.width - paddle.width, paddle.x));
        }
    }
    if (state.slowTimer > 0) state.slowTimer -= dt;
    if (state.statusTimer > 0) state.statusTimer -= dt;

    // Power-ups caindo.
    for (const p of state.powerups) p.y += p.vy * dt * 60;

    state.powerups = state.powerups.filter(p => {
        if (p.y > canvas.height) return false;

        const caught =
            p.y + 10 >= paddle.y &&
            p.y - 10 <= paddle.y + paddle.height &&
            p.x >= paddle.x &&
            p.x <= paddle.x + paddle.width;

        if (caught) {
            applyPowerUp(p.type);
            return false;
        }
        return true;
    });

    if (!state.launched) {
        // A bola acompanha a raquete até o lançamento.
        ball.x = paddle.x + paddle.width / 2;
        ball.y = paddle.y - ball.radius;
        state.serveTimer -= dt;
        if (state.serveTimer <= 0) launchBall();
        return;
    }

    const slowFactor = state.slowTimer > 0 ? 0.55 : 1;

    ball.x += ball.vx * slowFactor * dt * 60;
    ball.y += ball.vy * slowFactor * dt * 60;

    // Paredes e teto
    if (ball.x - ball.radius < 0) {
        ball.x = ball.radius;
        ball.vx = Math.abs(ball.vx);
    }

    if (ball.x + ball.radius > canvas.width) {
        ball.x = canvas.width - ball.radius;
        ball.vx = -Math.abs(ball.vx);
    }

    if (ball.y - ball.radius < 0) {
        ball.y = ball.radius;
        ball.vy = Math.abs(ball.vy);
    }

    // Raquete: o ângulo depende de onde a bola bate.
    if (
        ball.vy > 0 &&
        ball.y + ball.radius >= paddle.y &&
        ball.y - ball.radius <= paddle.y + paddle.height &&
        ball.x >= paddle.x - ball.radius &&
        ball.x <= paddle.x + paddle.width + ball.radius
    ) {
        const hit = (ball.x - (paddle.x + paddle.width / 2)) /
            (paddle.width / 2);
        const angle = Math.max(-1, Math.min(1, hit)) * 60 * Math.PI / 180;

        ball.vx = state.speed * Math.sin(angle);
        ball.vy = -state.speed * Math.cos(angle);
        ball.y = paddle.y - ball.radius;

        // Bater na raquete zera o combo.
        state.combo = 1;
        updateCombo();
    }

    // Tijolos
    for (let i = 0; i < state.bricks.length; i++) {
        const b = state.bricks[i];

        if (
            ball.x + ball.radius > b.x &&
            ball.x - ball.radius < b.x + b.width &&
            ball.y + ball.radius > b.y &&
            ball.y - ball.radius < b.y + b.height
        ) {
            const overlapX = Math.min(
                ball.x + ball.radius - b.x,
                b.x + b.width - (ball.x - ball.radius)
            );
            const overlapY = Math.min(
                ball.y + ball.radius - b.y,
                b.y + b.height - (ball.y - ball.radius)
            );

            if (overlapX < overlapY) ball.vx = -ball.vx;
            else ball.vy = -ball.vy;

            b.hits--;

            if (b.hits <= 0) {
                state.score += b.points * state.combo;
                state.combo = Math.min(state.combo + 1, 5);
                updateCombo();
                maybeDropPowerUp(b);
                state.bricks.splice(i, 1);
            }

            updateHud();
            break;
        }
    }

    if (state.bricks.length === 0) {
        nextLevel();
        return;
    }

    // Bola perdida
    if (ball.y - ball.radius > canvas.height) {
        state.lives--;
        updateHud();

        if (state.lives <= 0) {
            state.gameOver = true;
            state.restartLock = 2;
            saveScore();
        } else {
            resetBall();
        }
    }
}

let scoreSaved = false;

function saveScore() {
    showGameOverRanking("breakout", "Fim de jogo! Você fez " + state.score + " pontos");

    if (scoreSaved || state.score <= 0) return;
    scoreSaved = true;

    const best = setBestScore("breakout", state.score);
    const bestEl = document.getElementById("bestScore");
    if (bestEl) bestEl.textContent = best;

    fetch("/score", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            name: currentPlayerName,
            score: state.score,
            game: "breakout"
        })
    }).catch(console.error);
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Fundo
    ctx.fillStyle = "#1b2440";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Tijolos
    for (const b of state.bricks) {
        ctx.fillStyle = b.maxHits > 1 && b.hits > 1 ? TOUGH_COLOR : b.color;
        ctx.fillRect(b.x, b.y, b.width, b.height);

        if (b.maxHits > 1) {
            ctx.strokeStyle = "rgba(255,255,255,0.6)";
            ctx.lineWidth = 2;
            ctx.strokeRect(b.x + 1, b.y + 1, b.width - 2, b.height - 2);
        }
    }

    // Power-ups caindo
    for (const p of state.powerups) {
        const info = POWERUPS[p.type];
        ctx.fillStyle = info.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "11px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(info.letter, p.x, p.y + 1);
        ctx.textBaseline = "alphabetic";
    }

    // Raquete (fica azulada enquanto "larga" está ativa)
    ctx.fillStyle = state.wideTimer > 0 ? "#8fb8ff" : "#ffd83d";
    ctx.fillRect(paddle.x, paddle.y, paddle.width, paddle.height);

    // Bola (arroxeada enquanto "lenta" está ativa)
    ctx.fillStyle = state.slowTimer > 0 ? "#c9a3ff" : "#ffffff";
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    ctx.fill();

    // Mensagem de power-up coletado
    if (state.statusTimer > 0) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(canvas.width / 2 - 110, 34, 220, 26);
        ctx.fillStyle = "#fff";
        ctx.font = "14px Arial";
        ctx.textAlign = "center";
        ctx.fillText(state.statusMessage, canvas.width / 2, 52);
        ctx.textAlign = "left";
    }

    if (!state.started) {
        drawMessage("Abra o controle no celular");
    } else if (state.gameOver) {
        drawMessage("GAME OVER - incline forte para recomeçar");
    }
}

function drawMessage(message) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(140, 245, 520, 110);

    ctx.fillStyle = "#fff";
    ctx.font = "24px Arial";
    ctx.textAlign = "center";
    ctx.fillText(message, canvas.width / 2, 305);
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
