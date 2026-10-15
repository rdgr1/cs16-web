#!/bin/sh
# Valida ./assets (montado em /assets). Sai com erro e mensagem clara se faltar algo.
A=/assets
ROOM_MAPS=${ROOM_MAPS:-fy_pool_day,fy_snow}
missing=0

need() {
  if [ ! -e "$A/$1" ]; then
    echo "  [FALTA] assets/$1"
    missing=1
  fi
}

echo "Validando ./assets ..."
need valve/halflife.wad
need valve/liblist.gam
need cstrike/cstrike.wad
need cstrike/liblist.gam
need cstrike/maps
for m in $(echo "$ROOM_MAPS" | tr ',' ' '); do
  need "cstrike/maps/$m.bsp"
done

if [ "$missing" -ne 0 ]; then
  cat >&2 <<'MSG'

ERRO: arquivos do jogo ausentes em ./assets.
Coloque as pastas valve/ e cstrike/ do Counter-Strike 1.6 dentro de ./assets
(ao lado do docker-compose.yml) e os mapas em assets/cstrike/maps/. Veja o README.
MSG
  exit 1
fi
echo "OK: assets validos (mapas: $ROOM_MAPS)"
