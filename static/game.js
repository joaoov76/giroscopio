const socket = io();

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const scoreElement = document.getElementById("score");
const connectionElement = document.getElementById("connection");

let currentPlayerName = getPlayerName();

setupPlayerHud("flappy", (name) => { currentPlayerName = name; });

// O nome "de verdade" chega do celular (controle), em tempo real.
socket.on("player_name", (data) => {
    currentPlayerName = (data && data.name) || "Jogador";
    const nameEl = document.getElementById("playerName");
    if (nameEl) nameEl.textContent = currentPlayerName;
});

const player = {
    x: 150,
    y: 300,
    width: 38,
    height: 28,
    velocity: 0,
    gamma: 0
};

const state = {
    score: 0,
    gameOver: false,
    started: false,
    restartLock: 0,
    lastTime: performance.now(),
    pipeTimer: 0,
    pipes: [],
    groundOffset: 0,
    clouds: []
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
    player.gamma = Number(data.gamma) || 0;
    state.started = true;
});

const keys = {};

window.addEventListener("keydown", (e) => {
    keys[e.key] = true;
    state.started = true;
});

window.addEventListener("keyup", (e) => {
    keys[e.key] = false;
});

function currentSpeed() {
    // Começa mais devagar e sobe menos por ponto (era 4 a 8; agora 3 a 6).
    return Math.min(3 + Math.floor(state.score / 6) * 0.3, 6);
}

function currentGap() {
    return Math.max(190 - Math.floor(state.score / 6) * 5, 150);
}

function createPipe() {
    const gap = currentGap();
    const margin = 70;
    const top = Math.random() *
        (canvas.height - gap - margin * 2) + margin;

    state.pipes.push({
        x: canvas.width,
        width: 75,
        top,
        gap,
        passed: false
    });
}

function createClouds() {
    state.clouds = [];
    for (let i = 0; i < 5; i++) {
        state.clouds.push({
            x: Math.random() * canvas.width,
            y: 40 + Math.random() * 160,
            scale: 0.7 + Math.random() * 0.8,
            speed: 0.4 + Math.random() * 0.4
        });
    }
}

function resetGame() {
    player.y = canvas.height / 2;
    player.velocity = 0;
    state.score = 0;
    state.gameOver = false;
    state.restartLock = 0;
    state.pipes = [];
    state.pipeTimer = 0;
    scoreElement.textContent = "0";
    createClouds();
    createPipe();
    hideGameOverPanel();
}

function collision(a, b) {
    return (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
    );
}

function update(dt) {
    if (!state.started) return;

    if (state.gameOver) {
        state.restartLock -= dt;

        const wantsRestart =
            Math.abs(player.gamma) > 35 ||
            keys["Enter"] || keys[" "];

        if (state.restartLock <= 0 && wantsRestart) resetGame();
        return;
    }

    const sensitivity = 0.017;
    const maxVelocity = 6;

    let tilt = player.gamma;
    if (keys["ArrowUp"]) tilt = -30;
    if (keys["ArrowDown"]) tilt = 30;

    player.velocity = Math.max(
        -maxVelocity,
        Math.min(maxVelocity, tilt * sensitivity * 35)
    );

    player.y += player.velocity * dt * 60;

    const speed = currentSpeed();

    state.pipeTimer += dt;

    if (state.pipeTimer > 2.1) {
        state.pipeTimer = 0;
        createPipe();
    }

    for (const cloud of state.clouds) {
        cloud.x -= cloud.speed * dt * 60;
        if (cloud.x < -80) cloud.x = canvas.width + 80;
    }

    state.groundOffset = (state.groundOffset + speed * dt * 60) % 40;

    for (const pipe of state.pipes) {
        pipe.x -= speed * dt * 60;

        const topRect = { x: pipe.x, y: 0, width: pipe.width, height: pipe.top };
        const bottomRect = { x: pipe.x, y: pipe.top + pipe.gap, width: pipe.width, height: canvas.height };

        if (collision(player, topRect) || collision(player, bottomRect)) {
            endGame();
        }

        if (!pipe.passed && pipe.x + pipe.width < player.x) {
            pipe.passed = true;
            state.score++;
            scoreElement.textContent = state.score;
        }
    }

    state.pipes = state.pipes.filter(pipe => pipe.x + pipe.width > 0);

    if (player.y < 0 || player.y + player.height > canvas.height - 30) {
        player.y = Math.max(0, Math.min(player.y, canvas.height - 30 - player.height));
        endGame();
    }
}

function endGame() {
    if (state.gameOver) return;
    state.gameOver = true;
    state.restartLock = 1.5;
    saveScore();
    showGameOverRanking("flappy", "Fim de jogo! Você fez " + state.score + " pontos");
}

let scoreSaved = false;

function saveScore() {
    if (scoreSaved || state.score <= 0) return;
    scoreSaved = true;

    const best = setBestScore("flappy", state.score);
    const bestEl = document.getElementById("bestScore");
    if (bestEl) bestEl.textContent = best;

    fetch("/score", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            name: currentPlayerName,
            score: state.score,
            game: "flappy"
        })
    }).catch(console.error);
}

function drawClouds() {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (const cloud of state.clouds) {
        const s = cloud.scale;
        ctx.beginPath();
        ctx.ellipse(cloud.x, cloud.y, 30 * s, 16 * s, 0, 0, Math.PI * 2);
        ctx.ellipse(cloud.x + 22 * s, cloud.y + 6 * s, 22 * s, 13 * s, 0, 0, Math.PI * 2);
        ctx.ellipse(cloud.x - 22 * s, cloud.y + 6 * s, 22 * s, 13 * s, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawPipe(x, y, width, height, flip) {
    const capHeight = 22;

    ctx.fillStyle = "#3ea043";
    ctx.fillRect(x, y, width, height);

    ctx.fillStyle = "#2d7a32";
    ctx.fillRect(x, flip ? y + height - capHeight : y, width, capHeight);

    ctx.fillStyle = "#57c95d";
    ctx.fillRect(x + 6, y, width - 12, height);
}

function drawPlayer() {
    ctx.save();
    ctx.translate(player.x + player.width / 2, player.y + player.height / 2);

    const angle = Math.max(-25, Math.min(45, player.velocity * 4)) * Math.PI / 180;
    ctx.rotate(angle);

    ctx.fillStyle = "#ffd83d";
    ctx.beginPath();
    ctx.ellipse(0, 0, player.width / 2, player.height / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#f5b400";
    ctx.beginPath();
    ctx.ellipse(-4, 4, 12, 7, 0.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.arc(player.width / 2 - 12, -4, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ff8a3d";
    ctx.beginPath();
    ctx.moveTo(player.width / 2 - 4, 0);
    ctx.lineTo(player.width / 2 + 10, -3);
    ctx.lineTo(player.width / 2 + 10, 4);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, "#7fd4ff");
    sky.addColorStop(1, "#bdeaff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawClouds();

    for (const pipe of state.pipes) {
        drawPipe(pipe.x, 0, pipe.width, pipe.top, true);
        drawPipe(pipe.x, pipe.top + pipe.gap, pipe.width, canvas.height - (pipe.top + pipe.gap), false);
    }

    drawPlayer();

    ctx.fillStyle = "#8a5a2b";
    ctx.fillRect(0, canvas.height - 30, canvas.width, 30);
    ctx.fillStyle = "#6f451f";
    for (let x = -state.groundOffset; x < canvas.width; x += 40) {
        ctx.fillRect(x, canvas.height - 30, 20, 30);
    }
    ctx.fillStyle = "#65b84a";
    ctx.fillRect(0, canvas.height - 34, canvas.width, 6);

    if (!state.started) {
        drawMessage("Abra o controle no celular");
    } else if (state.gameOver) {
        drawMessage("GAME OVER - incline forte para recomeçar");
    }
}

function drawMessage(message) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(160, 245, 480, 110);

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
