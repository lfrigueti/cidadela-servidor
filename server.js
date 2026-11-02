// A Cidadela — Servidor Multiplayer
// Node.js 18+ | Dependência: ws

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const MAX_PLAYERS = 10;
const INDEX_FILE = path.join(__dirname, 'index.html');
const rooms = new Map();

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;

  if (pathname === '/saude' || pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('ok');
  }

  if (pathname !== '/' && pathname !== '/index.html') {
    res.writeHead(404);
    return res.end('Não encontrado.');
  }

  fs.readFile(INDEX_FILE, (error, html) => {
    if (error) {
      console.error('Erro ao abrir index.html:', error.message);
      res.writeHead(500);
      return res.end('Coloque index.html na mesma pasta de server.js.');
    }

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });

    res.end(html);
  });
});

const wss = new WebSocketServer({
  server,
  maxPayload: 32 * 1024
});

function send(ws, data) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

function getRoomList() {
  return Array.from(rooms, ([nome, room]) => ({
    nome,
    jogadores: room.clients.size,
    aberta: !room.iniciada
  }));
}

function sendRoomList(ws) {
  send(ws, {
    t: 'lista',
    salas: getRoomList()
  });
}

function broadcast(room, data, except = null) {
  const packet = JSON.stringify(data);

  for (const client of room.clients) {
    if (client !== except && client.readyState === 1) {
      client.send(packet);
    }
  }
}

function updatePlayerCount(room) {
  broadcast(room, {
    t: 'jogadores',
    n: room.clients.size
  });
}

function leaveRoom(ws) {
  const roomName = ws.room;

  if (!roomName) return;

  ws.room = null;

  const room = rooms.get(roomName);

  if (!room) return;

  room.clients.delete(ws);

  if (room.clients.size === 0) {
    rooms.delete(roomName);
    return;
  }

  if (room.host === ws.id) {
    const nextHost = room.clients.values().next().value;

    room.host = nextHost.id;

    send(nextHost, {
      t: 'host'
    });
  }

  updatePlayerCount(room);
}

wss.on('connection', (ws) => {
  ws.id = Math.random().toString(36).slice(2, 10);
  ws.room = null;

  sendRoomList(ws);

  ws.on('message', (raw) => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send(ws, {
        t: 'erro',
        msg: 'Mensagem inválida.'
      });
    }

    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') {
      return;
    }

    if (msg.t === 'listar') {
      return sendRoomList(ws);
    }

    if (msg.t === 'criar') {
      if (ws.room) {
        return send(ws, {
          t: 'erro',
          msg: 'Você já está em uma sala.'
        });
      }

      const nome = String(msg.nome || '').trim().slice(0, 20);
      const senha = String(msg.senha || '').slice(0, 20);

      if (!nome || !senha) {
        return send(ws, {
          t: 'erro',
          msg: 'Digite nome e senha.'
        });
      }

      if (rooms.has(nome)) {
        return send(ws, {
          t: 'erro',
          msg: 'Já existe uma sala com esse nome.'
        });
      }

      const room = {
        senha,
        host: ws.id,
        clients: new Set([ws]),
        iniciada: false
      };

      rooms.set(nome, room);
      ws.room = nome;

      send(ws, {
        t: 'entrou',
        nome,
        host: true,
        id: ws.id
      });

      updatePlayerCount(room);
      return;
    }

    if (msg.t === 'entrar') {
      if (ws.room) {
        return send(ws, {
          t: 'erro',
          msg: 'Você já está em uma sala.'
        });
      }

      const nome = String(msg.nome || '').trim().slice(0, 20);
      const senha = String(msg.senha || '').slice(0, 20);

      const room = rooms.get(nome);

      if (!room) {
        return send(ws, {
          t: 'erro',
          msg: 'Sala não encontrada.'
        });
      }

      if (room.senha !== senha) {
        return send(ws, {
          t: 'erro',
          msg: 'Senha errada.'
        });
      }

      if (room.iniciada) {
        return send(ws, {
          t: 'erro',
          msg: 'Essa partida já começou.'
        });
      }

      if (room.clients.size >= MAX_PLAYERS) {
        return send(ws, {
          t: 'erro',
          msg: `Sala cheia (máx. ${MAX_PLAYERS}).`
        });
      }

      room.clients.add(ws);
      ws.room = nome;

      send(ws, {
        t: 'entrou',
        nome,
        host: false,
        id: ws.id
      });

      updatePlayerCount(room);
      return;
    }

    const room = rooms.get(ws.room);

    if (!room || !room.clients.has(ws)) return;

    if (msg.t === 'iniciar') {
      if (ws.id !== room.host) {
        return send(ws, {
          t: 'erro',
          msg: 'Somente o anfitrião pode iniciar.'
        });
      }

      if (room.iniciada) return;

      room.iniciada = true;

      broadcast(room, {
        t: 'iniciar'
      });

      return;
    }

    if (msg.t === 'pos' || msg.t === 'ev') {
      if (
        !msg.d ||
        typeof msg.d !== 'object' ||
        Array.isArray(msg.d)
      ) {
        return;
      }

      broadcast(room, {
        t: msg.t,
        from: ws.id,
        d: msg.d
      }, ws);
    }
  });

  ws.on('close', () => leaveRoom(ws));
  ws.on('error', () => leaveRoom(ws));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `A Cidadela multiplayer ativa na porta ${PORT}; limite de ${MAX_PLAYERS} jogadores por sala.`
  );
});
