const socket = io();

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const scoreElement = document.getElementById("score");
const livesElement = document.getElementById("lives");
const levelElement = document.getElementById("level");
const connectionElement = document.getElementById("connection");

let currentPlayerName = getPlayerName();

setupPlayerHud("dots", (name) => { currentPlayerName = name; });

// O nome "de verdade" chega do celular (controle), em tempo real.
socket.on("player_name", (data) => {
    currentPlayerName = (data && data.name) || "Jogador";
    const nameEl = document.getElementById("playerName");
    if (nameEl) nameEl.textContent = currentPlayerName;
});

const cursor = {x: 400, y: 565, radius: 9};

// gamma = inclinação esquerda/direita, beta = frente/trás.
// gamma0/beta0 é a posição "neutra" calibrada no início de cada fase.
const input = {gamma: 0, beta: 0, gamma0: 0, beta0: 0};

const START = {x: 400, y: 565};

const state = {
    mode: "ready",      // ready | playing | levelDone | over
    started: false,     // true depois do primeiro pacote do giroscópio
    score: 0,
    lives: 3,
    level: 0,
    targets: [],
    targetIndex: 0,
    path: [],           // pontos já ligados
    obstacles: [],
    timer: 0,
    levelTime: 0,
    invulnerable: 0,
    message: "",
    lastTime: performance.now()
};

// axis: direção em que o obstáculo patrulha; min/max: limites da posição.
const LEVELS = [
    {
        closed: true,
        points: [[400, 110], [660, 470], [140, 470]],
        obstacles: [
            {x: 100, y: 290, w: 110, h: 18, axis: "x", min: 100, max: 590, speed: 2},
            {x: 330, y: 380, w: 140, h: 18, axis: "x", min: 330, max: 330, speed: 0}
        ]
    },
    {
        closed: true,
        points: [[200, 480], [200, 290], [400, 140], [600, 290], [600, 480]],
        obstacles: [
            {x: 300, y: 250, w: 18, h: 110, axis: "y", min: 240, max: 400, speed: 2.2},
            {x: 500, y: 400, w: 18, h: 110, axis: "y", min: 240, max: 400, speed: 2.2, dir: -1},
            {x: 160, y: 200, w: 110, h: 18, axis: "x", min: 100, max: 590, speed: 2.8}
        ]
    },
    {
        closed: true,
        points: [[400, 120], [517, 481], [210, 258], [590, 258], [283, 481]],
        obstacles: [
            {x: 100, y: 200, w: 120, h: 18, axis: "x", min: 60, max: 620, speed: 3},
            {x: 395, y: 250, w: 18, h: 110, axis: "y", min: 180, max: 400, speed: 2.5},
            {x: 560, y: 400, w: 110, h: 18, axis: "x", min: 100, max: 600, speed: 2.5, dir: -1}
        ]
    },
    {
        closed: false,
        points: [[150, 500], [250, 140], [330, 340], [460, 100], [540, 400], [650, 140], [690, 510]],
        obstacles: [
            {x: 100, y: 300, w: 100, h: 18, axis: "x", min: 60, max: 600, speed: 3.2},
            {x: 400, y: 200, w: 18, h: 100, axis: "y", min: 130, max: 420, speed: 3},
            {x: 560, y: 460, w: 100, h: 18, axis: "x", min: 200, max: 600, speed: 3.5, dir: -1},
            {x: 300, y: 430, w: 18, h: 100, axis: "y", min: 380, max: 480, speed: 2}
        ]
    }
];

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

// Teclado (setas) só para testar sem celular.
const keys = {};

window.addEventListener("keydown", (e) => {
    keys[e.key] = true;
    state.started = true;
});

window.addEventListener("keyup", (e) => {
    keys[e.key] = false;
});

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function updateHud() {
    scoreElement.textContent = state.score;
    livesElement.textContent = state.lives;
    levelElement.textContent = state.level + 1;
}

function startLevel(index) {
    const level = LEVELS[index];

    state.level = index;
    state.targets = level.closed
        ? [...level.points, level.points[0]]
        : [...level.points];
    state.targetIndex = 0;
    state.path = [];
    state.obstacles = level.obstacles.map(o => ({dir: 1, ...o}));
    state.mode = "ready";
    state.timer = 2;
    state.levelTime = 0;
    state.invulnerable = 0;

    cursor.x = START.x;
    cursor.y = START.y;
    updateHud();
    hideGameOverPanel();
}

function resetGame() {
    state.score = 0;
    state.lives = 3;
    scoreSaved = false;
    startLevel(0);
}

function axisSpeed(delta) {
    // Ajuste a sensibilidade aqui.
    const sensitivity = 0.25;
    const maxVelocity = 9;
    const deadZone = 3;

    if (Math.abs(delta) < deadZone) return 0;
    return clamp(delta * sensitivity, -maxVelocity, maxVelocity);
}

function hitsRect(c, r) {
    const nx = clamp(c.x, r.x, r.x + r.w);
    const ny = clamp(c.y, r.y, r.y + r.h);
    return (c.x - nx) ** 2 + (c.y - ny) ** 2 < c.radius ** 2;
}

function lastPoint() {
    return state.path.length
        ? state.path[state.path.length - 1]
        : START;
}

function moveObstacles(dt) {
    for (const o of state.obstacles) {
        if (o.speed === 0) continue;

        o[o.axis] += o.dir * o.speed * dt * 60;

        if (o[o.axis] <= o.min) {
            o[o.axis] = o.min;
            o.dir = 1;
        } else if (o[o.axis] >= o.max) {
            o[o.axis] = o.max;
            o.dir = -1;
        }
    }
}

function update(dt) {
    if (!state.started) return;

    if (state.mode === "ready") {
        state.timer -= dt;

        if (state.timer <= 0) {
            // Calibra a posição neutra do celular.
            input.gamma0 = input.gamma;
            input.beta0 = input.beta;
            state.mode = "playing";
        }
        moveObstacles(dt);
        return;
    }

    if (state.mode === "levelDone") {
        state.timer -= dt;

        if (state.timer <= 0) {
            if (state.level + 1 < LEVELS.length) {
                startLevel(state.level + 1);
            } else {
                state.mode = "over";
                state.timer = 2;
                state.message = "VOCÊ VENCEU! " + state.score + " pontos";
                saveScore();
                showGameOverRanking("dots", state.message);
            }
        }
        return;
    }

    if (state.mode === "over") {
        state.timer -= dt;

        // Depois de 2s, uma inclinação forte (ou tecla) recomeça.
        const wantsRestart =
            Math.abs(input.gamma - input.gamma0) > 35 ||
            keys["Enter"] || keys[" "];

        if (state.timer <= 0 && wantsRestart) resetGame();
        return;
    }

    // --- jogando ---
    state.levelTime += dt;
    state.invulnerable = Math.max(0, state.invulnerable - dt);

    let dx = axisSpeed(input.gamma - input.gamma0);
    let dy = axisSpeed(input.beta - input.beta0);

    if (keys["ArrowLeft"]) dx = -6;
    if (keys["ArrowRight"]) dx = 6;
    if (keys["ArrowUp"]) dy = -6;
    if (keys["ArrowDown"]) dy = 6;

    cursor.x = clamp(cursor.x + dx * dt * 60, cursor.radius, canvas.width - cursor.radius);
    cursor.y = clamp(cursor.y + dy * dt * 60, cursor.radius, canvas.height - cursor.radius);

    moveObstacles(dt);

    // Ligar o próximo ponto
    const target = state.targets[state.targetIndex];

    if (Math.hypot(cursor.x - target[0], cursor.y - target[1]) < 20) {
        state.path.push({x: target[0], y: target[1]});
        state.targetIndex++;
        state.score += 100;
        updateHud();

        if (state.targetIndex >= state.targets.length) {
            const bonus = Math.max(0, 40 - Math.floor(state.levelTime)) * 5;
            state.score += bonus;
            state.message = "Fase completa! +" + bonus + " de bônus";
            state.mode = "levelDone";
            state.timer = 2.5;
            updateHud();
        }
        return;
    }

    // Obstáculos
    if (state.invulnerable > 0) return;

    if (state.obstacles.some(o => hitsRect(cursor, o))) {
        state.lives--;
        updateHud();

        if (state.lives <= 0) {
            state.mode = "over";
            state.timer = 2;
            state.message = "GAME OVER - incline forte para recomeçar";
            saveScore();
            showGameOverRanking("dots", "Fim de jogo! Você fez " + state.score + " pontos");
        } else {
            // Volta ao último ponto ligado.
            const p = lastPoint();
            cursor.x = p.x;
            cursor.y = p.y;
            state.invulnerable = 1.5;
        }
    }
}

let scoreSaved = false;

function saveScore() {
    if (scoreSaved || state.score <= 0) return;
    scoreSaved = true;

    const best = setBestScore("dots", state.score);
    const bestEl = document.getElementById("bestScore");
    if (bestEl) bestEl.textContent = best;

    fetch("/score", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            name: currentPlayerName,
            score: state.score,
            game: "dots"
        })
    }).catch(console.error);
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Fundo
    ctx.fillStyle = "#12182b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Linhas já ligadas
    ctx.strokeStyle = "#ffd83d";
    ctx.lineWidth = 5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    state.path.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
    });
    if (state.mode === "playing" && state.path.length) {
        ctx.lineTo(cursor.x, cursor.y);
    }
    ctx.stroke();

    // Pontos numerados
    const points = LEVELS[state.level].points;
    const pulse = 4 * Math.sin(performance.now() / 150);
    const target = state.targets[state.targetIndex];

    ctx.font = "bold 15px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    points.forEach((p, i) => {
        const done = state.path.some(q => q.x === p[0] && q.y === p[1]);

        ctx.beginPath();
        ctx.arc(p[0], p[1], 15, 0, Math.PI * 2);
        ctx.fillStyle = done ? "#42b94d" : "#243056";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = "#fff";
        ctx.fillText(i + 1, p[0], p[1]);
    });

    // Destaque do próximo ponto
    if (target && state.mode !== "over") {
        ctx.beginPath();
        ctx.arc(target[0], target[1], 22 + pulse, 0, Math.PI * 2);
        ctx.strokeStyle = "#4b8cff";
        ctx.lineWidth = 3;
        ctx.stroke();
    }

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    // Obstáculos
    ctx.fillStyle = "#ff5a5f";
    for (const o of state.obstacles) {
        ctx.fillRect(o.x, o.y, o.w, o.h);
    }

    // Cursor (pisca quando invulnerável)
    if (state.invulnerable <= 0 || Math.floor(performance.now() / 100) % 2) {
        ctx.beginPath();
        ctx.arc(cursor.x, cursor.y, cursor.radius, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
    }

    if (!state.started) {
        drawMessage("Abra o controle no celular");
    } else if (state.mode === "ready") {
        drawMessage("Fase " + (state.level + 1),
            "Segure o celular na posição neutra");
    } else if (state.mode === "levelDone" || state.mode === "over") {
        drawMessage(state.message);
    }
}

function drawMessage(message, sub) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(140, 245, 520, 110);

    ctx.fillStyle = "#fff";
    ctx.font = "24px Arial";
    ctx.textAlign = "center";
    ctx.fillText(message, canvas.width / 2, sub ? 293 : 305);

    if (sub) {
        ctx.font = "16px Arial";
        ctx.fillText(sub, canvas.width / 2, 325);
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
