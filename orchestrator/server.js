'use strict';
// Orquestrador: cria/lista/remove salas (1 container hlds por sala) e faz proxy WebSocket -> UDP.
// Sem login: quem tem o codigo da sala entra. Estado vive nas labels dos containers.
const http = require('http');
const dgram = require('dgram');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const cfg = {
  port: +process.env.PORT || 3000,
  image: process.env.SERVER_IMAGE || 'cs16-server',
  network: process.env.NETWORK_NAME || 'cs16-web_default',
  assetsContainer: process.env.ASSETS_CONTAINER || 'cs16-assets',
  maps: (process.env.ROOM_MAPS || 'fy_pool_day,fy_snow').split(',').map((s) => s.trim()).filter(Boolean),
  maxRooms: +process.env.MAX_ROOMS || 5,
  maxPlayersCap: +process.env.MAX_PLAYERS_CAP || 16,
  idleMinutes: +process.env.IDLE_MINUTES || 10,
  startupMinutes: +process.env.STARTUP_MINUTES || 5,
  gamePort: 27015,
};
const LABEL = 'cs16.room';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ---------- Docker Engine API via socket ----------
function docker(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      { socketPath: '/var/run/docker.sock', method, path, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
          if (res.statusCode >= 400) return reject(Object.assign(new Error((json && json.message) || text || `HTTP ${res.statusCode}`), { status: res.statusCode }));
          resolve(json);
        });
      });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const newCode = () => Array.from(crypto.randomBytes(5), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
const containerName = (code) => `cs16-room-${code}`;

async function listContainers() {
  const filters = encodeURIComponent(JSON.stringify({ label: [LABEL] }));
  return docker('GET', `/containers/json?all=true&filters=${filters}`);
}

// ---------- A2S_INFO (GoldSrc 'm' e Source 'I') ----------
function queryInfo(host) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const done = (v) => { clearTimeout(t); try { sock.close(); } catch {} resolve(v); };
    const t = setTimeout(() => done(null), 1500);
    sock.on('message', (m) => {
      try {
        let o = 5; const str = () => { const e = m.indexOf(0, o); const s = m.toString('utf8', o, e); o = e + 1; return s; };
        if (m[4] === 0x6d) { str(); str(); const map = str(); str(); str(); return done({ map, players: m[o], max: m[o + 1] }); }
        if (m[4] === 0x49) { o = 6; str(); const map = str(); str(); str(); o += 2; return done({ map, players: m[o], max: m[o + 1] }); }
        done(null);
      } catch { done(null); }
    });
    sock.on('error', () => done(null));
    sock.send(Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff]), Buffer.from('TSource Engine Query\0')]), cfg.gamePort, host);
  });
}

async function describe(c) {
  const l = c.Labels || {};
  const running = c.State === 'running';
  const info = running ? await queryInfo(containerName(l[LABEL])) : null;
  return {
    code: l[LABEL], name: l['cs16.name'], maps: (l['cs16.maps'] || '').split(','),
    maxPlayers: +l['cs16.max'] || 0, players: info ? info.players : 0, currentMap: info ? info.map : null,
    status: !running ? 'stopped' : info ? 'ready' : 'starting', createdAt: new Date(c.Created * 1000).toISOString(),
  };
}

// ---------- Salas ----------
async function createRoom(opts) {
  const rooms = await listContainers();
  if (rooms.length >= cfg.maxRooms) throw Object.assign(new Error(`Limite de ${cfg.maxRooms} salas atingido`), { status: 429 });
  const maps = (Array.isArray(opts.maps) && opts.maps.length ? opts.maps : cfg.maps);
  if (!maps.every((m) => cfg.maps.includes(m))) throw Object.assign(new Error(`Mapas permitidos: ${cfg.maps.join(', ')}`), { status: 400 });
  const maxPlayers = Math.min(Math.max(+opts.maxPlayers || 10, 2), cfg.maxPlayersCap);
  const name = String(opts.name || '').replace(/[^\w \-áàâãéêíóôõúç]/gi, '').slice(0, 32) || 'Sala';
  let code; do { code = newCode(); } while (rooms.some((r) => r.Labels[LABEL] === code));
  const body = {
    Image: cfg.image,
    Env: [`MAPS=${maps.join(',')}`, `MAXPLAYERS=${maxPlayers}`, `SERVER_NAME=${name} [${code}]`, `RCON_PASSWORD=${crypto.randomBytes(8).toString('hex')}`],
    Labels: { [LABEL]: code, 'cs16.name': name, 'cs16.maps': maps.join(','), 'cs16.max': String(maxPlayers) },
    Tty: true, OpenStdin: true, // o hlds com -console trava sem terminal
    // /assets (somente leitura) vem do servico "assets" do compose: sem caminhos do host, funciona igual no Windows.
    HostConfig: { VolumesFrom: [`${cfg.assetsContainer}:ro`], NetworkMode: cfg.network, AutoRemove: false, Memory: 512 * 1024 * 1024 },
  };
  await docker('POST', `/containers/create?name=${containerName(code)}`, body);
  await docker('POST', `/containers/${containerName(code)}/start`);
  return code;
}

const removeRoom = (code) => docker('DELETE', `/containers/${containerName(code)}?force=true`);

// Remove salas vazias ha mais de IDLE_MINUTES (e salas paradas/crashadas).
const emptySince = new Map();
async function reap() {
  for (const c of await listContainers()) {
    const code = c.Labels[LABEL];
    const d = await describe(c);
    const age = Date.now() - new Date(d.createdAt).getTime();
    // parada, crashada ou travada na subida: remove
    if (d.status === 'stopped' || (d.status === 'starting' && age > cfg.startupMinutes * 60000)) {
      await removeRoom(code).catch(() => {}); emptySince.delete(code); continue;
    }
    if (d.status === 'ready' && d.players === 0) {
      const since = emptySince.get(code) || Date.now(); emptySince.set(code, since);
      if (Date.now() - since > cfg.idleMinutes * 60000) { await removeRoom(code).catch(() => {}); emptySince.delete(code); }
    } else emptySince.delete(code);
  }
}
setInterval(() => reap().catch((e) => console.error('[reap]', e.message)), 30000);

// ---------- HTTP API ----------
const send = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((resolve) => { let s = ''; req.on('data', (c) => { s += c; if (s.length > 4096) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } }); });

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const m = url.pathname.match(/^\/api\/rooms(?:\/([A-Z0-9]{5}))?$/);
    if (url.pathname === '/api/health') return send(res, 200, { ok: true, maps: cfg.maps });
    if (!m) return send(res, 404, { error: 'not found' });
    const code = m[1];
    if (!code && req.method === 'GET') return send(res, 200, await Promise.all((await listContainers()).map(describe)));
    if (!code && req.method === 'POST') { const c = await createRoom(await readBody(req)); const r = (await listContainers()).find((x) => x.Labels[LABEL] === c); return send(res, 201, await describe(r)); }
    const room = code && (await listContainers()).find((x) => x.Labels[LABEL] === code);
    if (code && !room) return send(res, 404, { error: 'sala nao encontrada' });
    if (code && req.method === 'GET') return send(res, 200, await describe(room));
    if (code && req.method === 'DELETE') { await removeRoom(code); return send(res, 204, {}); }
    send(res, 405, { error: 'method not allowed' });
  } catch (e) { console.error('[api]', e.message); send(res, e.status || 500, { error: e.message }); }
});

// ---------- WebSocket -> UDP ----------
// Cada mensagem binaria do WS vira um datagrama UDP para a sala, e vice-versa.
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
server.on('upgrade', async (req, socket, head) => {
  const m = new URL(req.url, 'http://x').pathname.match(/^\/ws\/([A-Z0-9]{5})$/);
  if (!m) return socket.destroy();
  const room = (await listContainers().catch(() => [])).find((x) => x.Labels[LABEL] === m[1]);
  if (!room) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    const udp = dgram.createSocket('udp4');
    const host = containerName(m[1]);
    udp.on('message', (msg) => ws.readyState === 1 && ws.send(msg, { binary: true }));
    udp.on('error', () => ws.close());
    ws.on('message', (data) => udp.send(data, cfg.gamePort, host));
    ws.on('close', () => { try { udp.close(); } catch {} });
  });
});

server.listen(cfg.port, () => console.log(`[orchestrator] :${cfg.port} imagem=${cfg.image} rede=${cfg.network} mapas=${cfg.maps.join(',')}`));
