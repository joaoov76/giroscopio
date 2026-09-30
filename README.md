# Gyro Flappy

Projeto de feira de ciências com:

- Python + Flask + Flask-SocketIO no servidor
- HTML5 Canvas + JavaScript no jogo
- DeviceOrientationEvent no celular
- SQLite para ranking
- Sem Pygame

## 1. Instalação

Linux:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Windows:

```powershell
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

## 2. Descobrir o IP do computador

Linux:

```bash
hostname -I
```

Windows:

```powershell
ipconfig
```

Os aparelhos precisam estar na mesma rede Wi-Fi.

## 3. Iniciar

```bash
python app.py
```

No computador:

```text
http://127.0.0.1:5000/game
```

No celular:

```text
http://IP_DO_COMPUTADOR:5000/controller
```

Exemplo:

```text
http://192.168.0.160:5000/controller
```

## 4. Fluxo

Celular:
DeviceOrientationEvent
        ↓
controller.js
        ↓
Socket.IO
        ↓
app.py
        ↓
game.js
        ↓
Canvas

## 5. Observação sobre giroscópio

Alguns navegadores exigem que o usuário toque no botão "Ativar giroscópio".
Em determinados aparelhos/navegadores, sensores podem exigir contexto seguro
(HTTPS) para funcionar. Se o navegador bloquear o sensor em HTTP, o próximo
passo é colocar o servidor em HTTPS na rede local.

## 6. Ranking

Os resultados são armazenados em:

```text
game.db
```

O endpoint:

```text
/ranking
```

mostra os 20 maiores resultados.


## QR Code automático

A página inicial (`/`) gera automaticamente um QR Code para:

```text
/controller
```

O endereço usado no QR Code é baseado no endereço pelo qual a página inicial
foi acessada.

### Rede local

Se você abrir:

```text
http://192.168.0.160:5000/
```

o QR Code apontará para:

```text
http://192.168.0.160:5000/controller
```

### URL HTTPS/túnel

Se você abrir a página através de uma URL HTTPS de um túnel, o QR Code será
gerado apontando para essa URL HTTPS automaticamente.

Isso permite usar o mesmo projeto sem editar manualmente o QR Code.


## 7. Celular mostra Alpha/Beta/Gamma em 0

Se o controle abre, conecta ao Socket.IO, mas os valores do sensor continuam em 0,
o motivo mais comum é abrir o celular por HTTP em um IP da rede local. Navegadores
móveis podem bloquear sensores fora de um contexto seguro.

### Solução prática com HTTPS usando Cloudflare Tunnel

1. Inicie o jogo normalmente:

```bash
python app.py
```

2. Em outro terminal, com `cloudflared` instalado, execute:

```bash
cloudflared tunnel --url http://localhost:5000
```

3. O comando mostrará uma URL parecida com:

```text
https://alguma-coisa.trycloudflare.com
```

4. Abra ESSA URL no computador e use o QR Code mostrado pela página.
O celular deve abrir `/controller` também em HTTPS.

5. Toque em **Ativar giroscópio** e aceite a permissão do navegador quando solicitada.

O projeto foi ajustado para respeitar o cabeçalho HTTPS quando estiver atrás de um túnel/proxy.


## Breakout

Além do Flappy, o projeto tem um Breakout controlado pelo giroscópio.

```text
http://127.0.0.1:5000/breakout
```

Use o mesmo `/controller` no celular: incline para a esquerda/direita para mover a raquete.
Para testar sem celular, use as setas do teclado. Ajuste `sensitivity` em `static/breakout.js`.


## Ligue os Pontos (Gyro Dots)

```text
http://127.0.0.1:5000/dots
```

Incline o celular (esquerda/direita e frente/trás) para mover o cursor e ligar os pontos em ordem, desviando dos obstáculos vermelhos.
A posição neutra do celular é calibrada no início de cada fase (contagem "Segure o celular na posição neutra").
Para testar sem celular, use as setas do teclado. Ajuste `sensitivity` em `static/dots.js` e o desenho das fases em `LEVELS`.

## Rodando sem Cloudflare Tunnel (HTTPS local)

Se não puder instalar o `cloudflared` no computador, use o HTTPS embutido do
próprio Flask, com certificado autoassinado:

```bash
pip install -r requirements.txt
python app.py --https
```

Abra `https://SEU_IP:5000/` no computador. O celular vai avisar que o site
não é confiável (é esperado, por ser um certificado autoassinado) — toque em
"Avançado" e depois "Continuar mesmo assim" para acessar o controle.

Alternativa sem mexer no computador: no celular, ative a flag do Chrome
`chrome://flags/#unsafely-treat-insecure-origin-as-secure`, adicione o
endereço `http://SEU_IP:5000` e reinicie o navegador do celular.
