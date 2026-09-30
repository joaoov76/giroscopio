// Nome do jogador, compartilhado entre a home e os jogos (armazenado no navegador).
const PLAYER_KEY = "gyro_player_name";

function getPlayerName() {
    const value = localStorage.getItem(PLAYER_KEY);
    return value && value.trim() ? value.trim() : "Jogador";
}

function setPlayerName(name) {
    const clean = (name || "").toString().trim().slice(0, 20);
    if (clean) localStorage.setItem(PLAYER_KEY, clean);
    else localStorage.removeItem(PLAYER_KEY);
    return getPlayerName();
}

function getBestScore(game) {
    return Number(localStorage.getItem("gyro_best_" + game)) || 0;
}

function setBestScore(game, score) {
    const best = Math.max(getBestScore(game), Number(score) || 0);
    localStorage.setItem("gyro_best_" + game, best);
    return best;
}

// Busca o ranking do jogo e preenche o painel de fim de jogo.
// gameId: "flappy" | "breakout" | "dots". finalMessage: texto acima da tabela.
async function showGameOverRanking(gameId, finalMessage) {
    const panel = document.getElementById("gameOverPanel");
    if (!panel) return;

    const messageEl = document.getElementById("gameOverMessage");
    const listEl = document.getElementById("gameOverRanking");

    if (messageEl) messageEl.textContent = finalMessage || "Fim de jogo!";
    if (listEl) listEl.innerHTML = "<li class=\"ranking-loading\">Carregando ranking...</li>";

    panel.classList.remove("hidden");

    try {
        const response = await fetch("/api/ranking?game=" + encodeURIComponent(gameId));
        const data = await response.json();
        const rows = (data && data.ranking) || [];

        if (!listEl) return;

        if (!rows.length) {
            listEl.innerHTML = "<li>Ninguém pontuou ainda neste jogo.</li>";
            return;
        }

        listEl.innerHTML = rows
            .slice(0, 5)
            .map((r, i) => `<li><span>${i + 1}. ${escapeHtml(r.name)}</span><b>${r.score}</b></li>`)
            .join("");
    } catch (error) {
        if (listEl) listEl.innerHTML = "<li>Não foi possível carregar o ranking.</li>";
    }
}

function hideGameOverPanel() {
    const panel = document.getElementById("gameOverPanel");
    if (panel) panel.classList.add("hidden");
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// Liga o cabeçalho comum de cada jogo (nome + trocar + recorde).
// onNameChange é chamado quando o nome é trocado manualmente nesta tela
// (usado só para testar sem celular; o nome "de verdade" vem do controle).
function setupPlayerHud(game, onNameChange) {
    const nameEl = document.getElementById("playerName");
    const changeBtn = document.getElementById("changeName");
    const bestEl = document.getElementById("bestScore");

    if (nameEl) nameEl.textContent = getPlayerName();
    if (bestEl) bestEl.textContent = getBestScore(game);

    if (changeBtn) {
        changeBtn.addEventListener("click", () => {
            const current = nameEl ? nameEl.textContent : getPlayerName();
            const name = prompt("Seu nome (normalmente definido no celular):", current);
            if (name !== null) {
                const clean = setPlayerName(name);
                if (nameEl) nameEl.textContent = clean;
                if (onNameChange) onNameChange(clean);
            }
        });
    }
}
