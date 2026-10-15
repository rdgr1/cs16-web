#!/bin/bash
# Servidor CS 1.6 (ReHLDS + ReGameDLL). Configuracao por variaveis de ambiente.
set -euo pipefail

ASSETS=${ASSETS_DIR:-/assets}
MAPS=${MAPS:-de_dust2}              # lista separada por virgula; vira o mapcycle
MAXPLAYERS=${MAXPLAYERS:-12}
SERVER_NAME=${SERVER_NAME:-CS16 Web}
RCON_PASSWORD=${RCON_PASSWORD:-}
PORT=${PORT:-27015}
TIMELIMIT=${TIMELIMIT:-20}

fail() { echo "[ERRO] $*" >&2; exit 1; }

# --- valida assets ---
for f in valve/halflife.wad valve/liblist.gam cstrike/cstrike.wad cstrike/liblist.gam; do
  [ -f "$ASSETS/$f" ] || fail "Arquivo ausente: $ASSETS/$f. Coloque as pastas valve/ e cstrike/ do jogo em ./assets (veja README)."
done
IFS=',' read -ra MAPLIST <<< "$MAPS"
for m in "${MAPLIST[@]}"; do
  [ -f "$ASSETS/cstrike/maps/$m.bsp" ] || fail "Mapa '$m' nao encontrado em $ASSETS/cstrike/maps/$m.bsp"
done

# --- monta /hlds: symlinks para os assets (somente leitura) + diretorios gravaveis ---
for d in valve cstrike; do
  mkdir -p "/hlds/$d"
  cp -rsn "$ASSETS/$d/." "/hlds/$d/"
done
mkdir -p /hlds/cstrike/logs /hlds/cstrike/addons
# arquivos gerados precisam ser reais (nao symlink para volume somente leitura)
unlink /hlds/cstrike/server.cfg 2>/dev/null || true
unlink /hlds/cstrike/mapcycle.txt 2>/dev/null || true

printf '%s\n' "${MAPLIST[@]}" > /hlds/cstrike/mapcycle.txt
cat > /hlds/cstrike/server.cfg <<CFG
hostname "$SERVER_NAME"
sv_lan 1
sv_password ""
rcon_password "$RCON_PASSWORD"
mp_timelimit $TIMELIMIT
mp_freezetime 3
sv_allowdownload 0
sv_allowupload 0
mapcyclefile mapcycle.txt
CFG

cd /hlds
echo "[INFO] Iniciando: mapa=${MAPLIST[0]} maxplayers=$MAXPLAYERS porta=$PORT"
exec ./hlds_linux -game cstrike -console +ip 0.0.0.0 +port "$PORT" \
  +maxplayers "$MAXPLAYERS" +map "${MAPLIST[0]}" -insecure -pingboost 1
