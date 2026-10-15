# CS 1.6 Web

Salas de Counter-Strike 1.6 (ReHLDS + ReGameDLL) criadas sob demanda, com lobby no navegador
e sem login. Subir: `docker compose up --build` e abrir <http://localhost:8080>.

> **Estado atual:** servidor, orquestrador, proxy WebSocket→UDP, lobby, validação de assets e
> `check.sh` estão prontos. **O cliente WebAssembly do jogo ainda não está incluso** (veja
> [Cliente WASM](#cliente-wasm-pendente)); sem ele a página cria/lista salas e chega até a tela do
> jogo, mas não renderiza o CS no navegador.

## Requisitos

- **Windows 10/11 com Docker Desktop (WSL2)**, ou Linux x86_64 com Docker + Compose v2.
  O servidor é x86 de 32 bits: precisa de CPU x86. **Não roda em Mac Apple Silicon** (o
  `steamclient.so` de 32 bits quebra sob emulação QEMU: `futex robust_list not initialized`).
- ~3 GB de disco (imagens + assets) e internet no primeiro build.

## Passo a passo

1. **Coloque os arquivos do jogo em `./assets`** (ao lado do `docker-compose.yml`):

   ```
   assets/
   ├── valve/            # pasta valve/ do Half-Life/CS 1.6
   └── cstrike/
       └── maps/
           ├── fy_pool_day.bsp
           └── fy_snow.bsp
   ```

   `./assets` está no `.gitignore` e é montado como volume somente leitura. Não copie `.exe`/`.dll`
   (o servidor usa os binários Linux das imagens). Se faltar algo, o `docker compose up` para com a
   lista do que falta (serviço `assets`).
2. `docker compose up --build` (o primeiro build baixa ReHLDS, ReGameDLL e as libs Steam).
3. Abra <http://localhost:8080>, crie uma sala e passe o código de 5 letras para os amigos.
4. Verifique: `bash scripts/check.sh` (ou, sem bash no Windows:
   `docker compose --profile tools run --rm check`). Use `--no-room` para não criar sala de teste.

## Configuração (`.env`, opcional)

Copie `.env.example` para `.env`.

| Variável | Padrão | O que faz |
|---|---|---|
| `WEB_PORT` | `8080` | porta do site |
| `ROOM_MAPS` | `fy_pool_day,fy_snow` | mapas, alternando nessa ordem (`mapcycle`); cada um precisa existir em `assets/cstrike/maps/` |
| `MAX_ROOMS` | `5` | limite de salas simultâneas |
| `MAX_PLAYERS_CAP` | `16` | teto de jogadores por sala |
| `IDLE_MINUTES` | `10` | salas vazias por mais tempo que isso são removidas |

Cada sala também aceita (variáveis do container do servidor): `MAPS`, `MAXPLAYERS`, `SERVER_NAME`,
`RCON_PASSWORD` (aleatória por sala), `TIMELIMIT`, `PORT`.

## Como funciona

```
navegador ──HTTP/WS──> nginx :8080 ──/api/*──> orquestrador ──docker.sock──> container cs16-room-<CODIGO>
                          │                        │                              (ReHLDS + ReGameDLL)
                          └─ /ws/<CODIGO> ─────────┴── proxy WebSocket→UDP :27015 ─┘
                          └─ /game/*  → ./assets (somente leitura)
```

- **Sem login:** quem tem o código entra. O estado das salas vive nas labels dos containers.
- **Orquestrador** (`orchestrator/`, Node): `GET/POST /api/rooms`, `GET/DELETE /api/rooms/<CODIGO>`,
  `GET /api/health`. Consulta jogadores por A2S, remove salas vazias/paradas/travadas na subida.
- Salas **não publicam portas UDP**: o jogo passa pelo proxy WebSocket (`/ws/<CODIGO>`), uma mensagem
  binária = um datagrama UDP.
- Atenção: o orquestrador monta o `docker.sock` — quem alcançar a API cria containers. Use só em rede
  confiável/local.

## Cliente WASM (pendente)

O port web usado como referência (`yohimik/webxash3d-fwgs`) **foi removido do GitHub** e o pacote
`cs16-client` foi despublicado do npm em 08/09/2026. O `xash3d-fwgs@1.2.2` (engine) ainda existe no
npm, mas sem o cliente do CS. Para fechar essa parte é preciso compilar o Xash3D FWGS e o
`cs16-client` (upstream: `FWGS/xash3d-fwgs`, `Velaron/cs16-client`) para WASM.

A página já espera este contrato: um `web/public/client/loader.js` que defina

```js
window.CS16Client.start({ canvas, connect, assetsBase })
// connect    = ws://<host>/ws/<CODIGO>  (equivale a "connect <endereço>")
// assetsBase = /game/                   (valve/ e cstrike/)
```

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| `docker compose up` para em `assets` com `[FALTA] ...` | complete `./assets` (passo 1) |
| Sala fica "iniciando" e some após 5 min | `docker logs cs16-room-<CODIGO>` antes de ela sumir; confirme CPU x86 |
| `502` logo após subir | o orquestrador ainda está iniciando; aguarde alguns segundos |
| Primeiro build lento/falha | precisa de internet (GitHub e Steam CDN) |

## Próximas fases (não implementadas)

Spring Boot + Angular + Redis.

## Licenças

ReHLDS e ReGameDLL: GPLv3. Os arquivos do jogo (`valve/`, `cstrike/`) são propriedade da Valve e
**não** fazem parte do repositório.
