from flask import Flask, render_template, request, send_file
from flask_socketio import SocketIO, emit
from werkzeug.middleware.proxy_fix import ProxyFix
import sqlite3
import io
import sys
import qrcode
import qrcode.image.svg
from datetime import datetime

app = Flask(__name__)
# Respeita HTTPS/Host informados por proxies e túneis (Cloudflare, ngrok etc.).
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)
app.config["SECRET_KEY"] = "gyro-flappy-secret"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# Último nome recebido do controle, para quem abrir/recarregar o jogo depois.
last_player_name = {"name": "Jogador"}

DB = "game.db"

# Nome exibido para cada jogo, usado no ranking.
GAMES = {
    "flappy": "Flappy",
    "breakout": "Breakout",
    "dots": "Ligue os Pontos",
    "birds": "Gyro Birds"
}

# Para onde o /play redireciona quando o celular escolhe um jogo.
GAME_ROUTES = {
    "flappy": "/game",
    "breakout": "/breakout",
    "dots": "/dots",
    "birds": "/birds"
}

# Último jogo escolhido no celular, para quem abrir o /play depois da escolha.
last_selected_game = {"game": None}

def init_db():
    with sqlite3.connect(DB) as con:
        con.execute("""
            CREATE TABLE IF NOT EXISTS scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                score INTEGER NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        # Migração: bancos criados antes do jogo Breakout/Dots não tinham a coluna "game".
        columns = [row[1] for row in con.execute("PRAGMA table_info(scores)")]
        if "game" not in columns:
            con.execute(
                "ALTER TABLE scores ADD COLUMN game TEXT NOT NULL DEFAULT 'flappy'"
            )
        con.commit()

init_db()

@app.route("/")
def index():
    # A página usa o endereço público/local pelo qual o usuário acessou o servidor.
    controller_url = request.host_url.rstrip("/") + "/controller"
    return render_template("index.html", controller_url=controller_url)

@app.route("/qr/controller")
def controller_qr():
    controller_url = request.host_url.rstrip("/") + "/controller"

    # SVG não depende do Pillow, então funciona mesmo sem ele instalado.
    image = qrcode.make(
        controller_url,
        image_factory=qrcode.image.svg.SvgPathImage,
        box_size=10,
        border=4,
    )
    buffer = io.BytesIO()
    image.save(buffer)
    buffer.seek(0)

    return send_file(buffer, mimetype="image/svg+xml")

@app.route("/game")
def game():
    return render_template("game.html")

@app.route("/breakout")
def breakout():
    return render_template("breakout.html")

@app.route("/dots")
def dots():
    return render_template("dots.html")

@app.route("/birds")
def birds():
    return render_template("birds.html")

@app.route("/controller")
def controller():
    return render_template("controller.html")

@app.route("/play")
def play():
    # Tela de espera: fica aqui até o celular escolher um jogo, e então
    # redireciona sozinha. Se o celular já tiver escolhido antes, pula direto.
    controller_url = request.host_url.rstrip("/") + "/controller"
    return render_template(
        "play.html",
        controller_url=controller_url,
        games=GAMES,
        routes=GAME_ROUTES,
        initial_game=last_selected_game["game"]
    )

@app.route("/ranking")
def ranking():
    # Tabela de classificação em HTML, com abas por jogo.
    game = request.args.get("game", "all")
    if game not in GAMES:
        game = "all"

    with sqlite3.connect(DB) as con:
        if game == "all":
            rows = con.execute(
                "SELECT name, score, game, created_at FROM scores "
                "ORDER BY score DESC, id ASC LIMIT 20"
            ).fetchall()
        else:
            rows = con.execute(
                "SELECT name, score, game, created_at FROM scores "
                "WHERE game = ? ORDER BY score DESC, id ASC LIMIT 20",
                (game,)
            ).fetchall()

    return render_template("ranking.html", rows=rows, games=GAMES, active=game)

@app.route("/api/ranking")
def api_ranking():
    # Mesma consulta, em JSON, para uso programático.
    game = request.args.get("game")
    with sqlite3.connect(DB) as con:
        if game in GAMES:
            rows = con.execute(
                "SELECT name, score, game, created_at FROM scores "
                "WHERE game = ? ORDER BY score DESC, id ASC LIMIT 20",
                (game,)
            ).fetchall()
        else:
            rows = con.execute(
                "SELECT name, score, game, created_at FROM scores "
                "ORDER BY score DESC, id ASC LIMIT 20"
            ).fetchall()
    return {"ranking": [
        {"name": r[0], "score": r[1], "game": r[2], "created_at": r[3]} for r in rows
    ]}

@app.post("/score")
def save_score():
    data = request.get_json(silent=True) or {}

    name = str(data.get("name", "Jogador")).strip()[:20] or "Jogador"

    game = str(data.get("game", "flappy")).strip().lower()
    if game not in GAMES:
        game = "flappy"

    try:
        score = int(data.get("score", 0))
    except (TypeError, ValueError):
        score = 0

    with sqlite3.connect(DB) as con:
        con.execute(
            "INSERT INTO scores (name, score, game, created_at) VALUES (?, ?, ?, ?)",
            (name, score, game, datetime.now().isoformat(timespec="seconds"))
        )
        con.commit()
    return {"ok": True}

@socketio.on("gyro")
def gyro(data):
    # Mantém apenas os valores esperados e evita dados inválidos.
    try:
        packet = {
            "alpha": float(data.get("alpha", 0)),
            "beta": float(data.get("beta", 0)),
            "gamma": float(data.get("gamma", 0)),
            "seq": int(data.get("seq", 0))
        }
    except (TypeError, ValueError):
        return

    # Envia o controle para todos os clientes do jogo.
    emit("player_gyro", packet, broadcast=True, include_self=False)

@socketio.on("set_name")
def set_name(data):
    # O nome é escolhido no celular (controle) e repassado para quem está
    # vendo o jogo, assim como o giroscópio.
    name = str((data or {}).get("name", "")).strip()[:20]
    if not name:
        name = "Jogador"
    last_player_name["name"] = name
    emit("player_name", {"name": name}, broadcast=True, include_self=False)

@socketio.on("connect")
def handle_connect():
    # Quem acabou de conectar (ex: a tela do jogo foi recarregada) recebe
    # o nome mais recente, sem precisar esperar o celular reenviar.
    emit("player_name", last_player_name)

@socketio.on("controller_connected")
def controller_connected(data=None):
    emit("controller_status", {"connected": True}, broadcast=True)

@socketio.on("action")
def handle_action(data=None):
    # Botão "Soltar" do celular, usado para lançar o pássaro no Gyro Birds.
    emit("action", {}, broadcast=True, include_self=False)

@socketio.on("select_game")
def select_game(data=None):
    # O celular escolhe o jogo; quem estiver na tela /play é levado até ele.
    game = str((data or {}).get("game", "")).strip().lower()
    if game not in GAME_ROUTES:
        return
    last_selected_game["game"] = game
    emit("select_game", {"game": game}, broadcast=True, include_self=False)

if __name__ == "__main__":
    use_https = "--https" in sys.argv

    if use_https:
        print("Servidor HTTPS (certificado autoassinado): https://0.0.0.0:5000")
        print("Jogo:     https://SEU_IP:5000/game")
        print("Breakout: https://SEU_IP:5000/breakout")
        print("Dots:     https://SEU_IP:5000/dots")
        print("Controle: https://SEU_IP:5000/controller")
        print("O celular vai mostrar um aviso de site não seguro: toque em Avançado > Continuar.")
        socketio.run(
            app, host="0.0.0.0", port=5000,
            ssl_context="adhoc", allow_unsafe_werkzeug=True
        )
    else:
        print("Servidor: http://0.0.0.0:5000")
        print("Jogo:     http://SEU_IP:5000/game")
        print("Breakout: http://SEU_IP:5000/breakout")
        print("Dots:     http://SEU_IP:5000/dots")
        print("Controle: http://SEU_IP:5000/controller")
        print("Dica: rode com --https se o giroscópio não funcionar em HTTP.")
        socketio.run(app, host="0.0.0.0", port=5000, allow_unsafe_werkzeug=True)
