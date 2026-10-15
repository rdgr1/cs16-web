'use strict';
// Lobby (criar sala / entrar com codigo / lista) + inicio do cliente WASM.
//
// Contrato do cliente WASM (ainda nao incluso, veja README): o arquivo /client/loader.js deve
// definir window.CS16Client.start({ canvas, connect, assetsBase }) onde
//   connect    = URL WebSocket da sala (ws://host/ws/CODIGO), usada como "connect <endereco>"
//   assetsBase = /game/  (valve/ e cstrike/ servidos em somente leitura)
const $ = (id) => document.getElementById(id);
const els = {
  lobby: $('lobby'), game: $('game'), rooms: $('rooms'), empty: $('rooms-empty'), count: $('rooms-count'),
  msg: $('msg'), maps: $('maps-label'), info: $('game-info'), title: $('game-title'), canvas: $('canvas'),
};
let pollTimer = null;

function say(text, isErr) { els.msg.textContent = text || ''; els.msg.className = 'msg' + (isErr ? ' err' : ''); }

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body && body.error) || `Erro ${res.status}`);
  return body;
}

function renderRooms(rooms) {
  els.rooms.replaceChildren();
  els.count.textContent = rooms.length ? `(${rooms.length})` : '';
  els.empty.hidden = rooms.length > 0;
  for (const r of rooms) {
    const li = document.createElement('li');
    const info = document.createElement('div'); info.className = 'info';
    const name = document.createElement('div'); name.className = 'name'; name.textContent = r.name;   // textContent: nome vem de usuarios
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = `${r.players}/${r.maxPlayers} jogadores · ${r.currentMap || r.maps[0]}`;
    const code = document.createElement('span'); code.className = 'code'; code.textContent = r.code;
    const badge = document.createElement('span'); badge.className = 'badge ' + r.status; badge.textContent = r.status === 'ready' ? 'pronta' : 'iniciando';
    const btn = document.createElement('button'); btn.textContent = 'Entrar'; btn.disabled = r.status !== 'ready';
    btn.addEventListener('click', () => enter(r.code));
    info.append(name, meta); li.append(info, code, badge, btn); els.rooms.append(li);
  }
}

async function refresh() {
  try { renderRooms(await api('/api/rooms')); } catch (e) { say('Não consegui falar com o servidor: ' + e.message, true); }
}

async function waitReady(code) {
  for (let i = 0; i < 90; i++) {            // ate ~3 min (a primeira subida pode demorar)
    const r = await api(`/api/rooms/${code}`);
    if (r.status === 'ready') return r;
    say(`Sala ${code} iniciando... (${i * 2}s)`);
    await new Promise((ok) => setTimeout(ok, 2000));
  }
  throw new Error('A sala demorou demais para iniciar. Veja os logs do container.');
}

async function enter(code) {
  code = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) return say('Código inválido (5 letras/números).', true);
  try {
    say('Verificando sala...');
    const room = await waitReady(code);
    say('');
    startGame(room);
  } catch (e) { say(e.message, true); }
}

async function startGame(room) {
  clearInterval(pollTimer);
  els.lobby.hidden = true; els.game.hidden = false; els.info.hidden = true;
  els.title.textContent = `${room.name} · ${room.code}`;
  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${room.code}`;
  try {
    await loadScript('/client/loader.js');
    if (!window.CS16Client || typeof window.CS16Client.start !== 'function') throw new Error('loader invalido');
    await window.CS16Client.start({ canvas: els.canvas, connect: wsUrl, assetsBase: '/game/' });
  } catch (e) {
    els.info.hidden = false;
    els.info.replaceChildren();
    const p = document.createElement('p'); p.textContent = 'Cliente WebAssembly não instalado (/client/loader.js). A sala e o proxy estão funcionando; falta o cliente. Veja o README.';
    const pre = document.createElement('pre'); pre.textContent = `sala: ${room.code}\nconnect: ${wsUrl}\nmotivo: ${e.message}`;
    els.info.append(p, pre);
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('arquivo nao encontrado: ' + src));
    document.head.append(s);
  });
}

$('create-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = ev.submitter; btn.disabled = true;
  try {
    say('Criando sala...');
    const r = await api('/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: $('room-name').value, maxPlayers: +$('room-max').value }),
    });
    await enter(r.code);
  } catch (e) { say(e.message, true); } finally { btn.disabled = false; }
});

$('join-form').addEventListener('submit', (ev) => { ev.preventDefault(); enter($('join-code').value); });
$('leave').addEventListener('click', () => { location.reload(); });

api('/api/health').then((h) => { els.maps.textContent = h.maps.join(' ↔ '); }).catch(() => { els.maps.textContent = 'indisponível'; });
refresh(); pollTimer = setInterval(refresh, 3000);
