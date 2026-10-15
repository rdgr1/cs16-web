#!/usr/bin/env bash
# Verifica se esta tudo de pe. Uso:
#   bash scripts/check.sh              # no host (BASE_URL padrao http://localhost:8080)
#   bash scripts/check.sh --no-room    # nao cria sala de teste (rapido)
#   docker compose --profile tools run --rm check    # dentro da rede do compose (Windows sem bash)
set -u
BASE_URL=${BASE_URL:-http://localhost:8080}
CREATE_ROOM=1
[ "${1:-}" = "--no-room" ] && CREATE_ROOM=0
fails=0

ok()   { echo "  [OK]    $*"; }
bad()  { echo "  [FALHA] $*"; fails=$((fails + 1)); }
info() { echo "  [..]    $*"; }

echo "Checando $BASE_URL"

# 1. pagina
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE_URL/")
[ "$code" = "200" ] && ok "pagina web (HTTP 200)" || bad "pagina web respondeu '$code' (esperado 200). Veja: docker compose logs web"

# 2. orquestrador via nginx
health=$(curl -s --max-time 5 "$BASE_URL/api/health")
if echo "$health" | grep -q '"ok":true'; then ok "orquestrador: $health"; else bad "orquestrador sem resposta ($health). Veja: docker compose logs orchestrator"; fi

# 3. lista de salas
curl -s --max-time 5 "$BASE_URL/api/rooms" | grep -q '^\[' && ok "GET /api/rooms" || bad "GET /api/rooms nao devolveu lista"

# 4. arquivos do jogo servidos pelo nginx
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE_URL/game/cstrike/cstrike.wad")
[ "$code" = "200" ] && ok "assets servidos em /game/ (cstrike.wad)" || bad "/game/cstrike/cstrike.wad respondeu '$code'. Confira ./assets"

# 5. cliente WASM (opcional por enquanto)
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE_URL/client/loader.js")
[ "$code" = "200" ] && ok "cliente WASM presente" || info "cliente WASM ausente (/client/loader.js = $code): lobby e servidor funcionam, mas o jogo no navegador nao abre"

# 6. sala de teste ponta a ponta: criar -> pronta -> WebSocket -> remover
if [ "$CREATE_ROOM" = "1" ]; then
  resp=$(curl -s --max-time 30 -X POST -H 'Content-Type: application/json' -d '{"name":"check","maxPlayers":2}' "$BASE_URL/api/rooms")
  room=$(echo "$resp" | sed -n 's/.*"code":"\([A-Z0-9]\{5\}\)".*/\1/p')
  if [ -z "$room" ]; then
    bad "nao consegui criar sala de teste: $resp"
  else
    ok "sala criada: $room"
    ready=0
    for _ in $(seq 1 90); do
      st=$(curl -s --max-time 5 "$BASE_URL/api/rooms/$room")
      if echo "$st" | grep -q '"status":"ready"'; then ready=1; break; fi
      if echo "$st" | grep -q '"status":"stopped"'; then break; fi
      sleep 2
    done
    if [ "$ready" = "1" ]; then
      ok "servidor da sala respondeu A2S (status ready)"
      ws=$(curl -s -i -N --max-time 3 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
            -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "$BASE_URL/ws/$room" 2>/dev/null | head -1)
      echo "$ws" | grep -q '101' && ok "proxy WebSocket -> UDP (HTTP 101)" || bad "WebSocket nao fez upgrade ('$ws')"
    else
      bad "sala $room nao ficou pronta. Veja: docker logs cs16-room-$room"
    fi
    curl -s -o /dev/null -X DELETE "$BASE_URL/api/rooms/$room" && info "sala de teste removida"
  fi
fi

echo
if [ "$fails" -eq 0 ]; then echo "Tudo certo."; else echo "$fails verificacao(oes) falharam."; fi
exit "$fails"
