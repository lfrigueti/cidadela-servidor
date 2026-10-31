// Servidor de salas da Cidadela. Requer Node 18+.
// Instalação: npm install ws
// Execução local: node server.js   (porta 8080, ou PORT do ambiente)
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const rooms = new Map(); // nome -> { senha, host, clients:Set }

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Servidor da Cidadela ativo.');
});
const wss = new WebSocketServer({ server });

function listRooms() {
  return [...rooms.entries()].map(([nome, r]) => ({ nome, jogadores: r.clients.size, aberta: !r.iniciada }));
}
function broadcast(room, msg, except) {
  const txt = JSON.stringify(msg);
  for (const c of room.clients) if (c !== except && c.readyState === 1) c.send(txt);
}

wss.on('connection', (ws) => {
  ws.room = null;
  ws.id = Math.random().toString(36).slice(2, 8);
  ws.send(JSON.stringify({ t: 'lista', salas: listRooms() }));

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'listar') return ws.send(JSON.stringify({ t: 'lista', salas: listRooms() }));

    if (m.t === 'criar') {
      const nome = String(m.nome || '').trim().slice(0, 20);
      const senha = String(m.senha || '').slice(0, 20);
      if (!nome || !senha) return ws.send(JSON.stringify({ t: 'erro', msg: 'Digite nome e senha.' }));
      if (rooms.has(nome)) return ws.send(JSON.stringify({ t: 'erro', msg: 'Já existe uma sala com esse nome.' }));
      const room = { senha, host: ws.id, clients: new Set([ws]), iniciada: false };
      rooms.set(nome, room);
      ws.room = nome;
      ws.send(JSON.stringify({ t: 'entrou', nome, host: true, id: ws.id }));
      broadcast(room, { t: 'lista', salas: listRooms() });
      return;
    }

    if (m.t === 'entrar') {
      const nome = String(m.nome || '');
      const room = rooms.get(nome);
      if (!room) return ws.send(JSON.stringify({ t: 'erro', msg: 'Sala não encontrada.' }));
      if (room.senha !== String(m.senha || '')) return ws.send(JSON.stringify({ t: 'erro', msg: 'Senha errada.' }));
      if (room.iniciada) return ws.send(JSON.stringify({ t: 'erro', msg: 'Essa partida já começou.' }));
      if (room.clients.size >= 8) return ws.send(JSON.stringify({ t: 'erro', msg: 'Sala cheia (máx. 8).' }));
      room.clients.add(ws);
      ws.room = nome;
      ws.send(JSON.stringify({ t: 'entrou', nome, host: false, id: ws.id }));
      broadcast(room, { t: 'jogadores', n: room.clients.size });
      return;
    }

    const room = rooms.get(ws.room);
    if (!room) return;

    if (m.t === 'iniciar' && ws.id === room.host) {
      room.iniciada = true;
      broadcast(room, { t: 'iniciar' });
      return;
    }
    // Repassa posição, eventos de missão etc. para os outros da sala
    if (m.t === 'pos' || m.t === 'ev') {
      broadcast(room, { t: m.t, from: ws.id, d: m.d }, ws);
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.room);
    if (!room) return;
    room.clients.delete(ws);
    if (room.clients.size === 0) rooms.delete(ws.room);
    else {
      if (ws.id === room.host) {
        const novo = [...room.clients][0];
        room.host = novo.id;
        novo.send(JSON.stringify({ t: 'host' }));
      }
      broadcast(room, { t: 'jogadores', n: room.clients.size });
    }
  });
});

server.listen(PORT, () => console.log('Servidor da Cidadela na porta ' + PORT));
