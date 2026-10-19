'use strict';
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });
const rooms = new Map();
const PORT = Number(process.env.PORT || 3000);

app.use(express.static(path.join(__dirname)));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
function code() {
  let c;
  do { c = crypto.randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(c));
  return c;
}
function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function drop(ws) {
  const roomCode = ws.room;
  const r = roomCode && rooms.get(roomCode);
  if (!r) { ws.room = null; return; }
  if (r.host === ws) {
    send(r.guest, { type: 'left' });
    rooms.delete(roomCode);
  } else if (r.guest === ws) {
    r.guest = null;
    r.ready = false;
    r.guestCharacter = null;
    send(r.host, { type: 'left' });
  }
  ws.room = null;
  ws.role = null;
}

wss.on('connection', ws => {
  ws.role = null;
  ws.room = null;
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'create') {
      if (ws.room) drop(ws);
      const c = code();
      rooms.set(c, { host: ws, guest: null, ready: false, guestCharacter: null });
      ws.room = c;
      ws.role = 'host';
      send(ws, { type: 'created', code: c });
      return;
    }
    if (m.type === 'join') {
      const c = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const r = rooms.get(c);
      if (!r) { send(ws, { type: 'error', message: '방을 찾을 수 없습니다. 코드가 맞는지 확인하세요.' }); return; }
      if (r.guest && r.guest.readyState === WebSocket.OPEN) { send(ws, { type: 'error', message: '이미 두 명이 입장한 방입니다.' }); return; }
      if (ws.room) drop(ws);
      r.guest = ws;
      r.ready = false;
      ws.room = c;
      ws.role = 'guest';
      send(ws, { type: 'joined', code: c });
      send(r.host, { type: 'peerJoined' });
      return;
    }
    const r = ws.room && rooms.get(ws.room);
    if (!r) { send(ws, { type: 'error', message: '먼저 방을 만들거나 입장하세요.' }); return; }
    if (m.type === 'ready' && ws === r.guest) {
      const ch = String(m.character || 'gojo').slice(0, 30);
      r.guestCharacter = ch;
      r.ready = true;
      send(r.host, { type: 'peerReady', character: ch });
      return;
    }
    if (m.type === 'start' && ws === r.host && r.guest) { send(r.guest, m); return; }
    if (m.type === 'snapshot' && ws === r.host && r.guest) { send(r.guest, m); return; }
    if ((m.type === 'input' || m.type === 'skill' || m.type === 'trial') && ws === r.guest) { send(r.host, m); return; }
  });
  ws.on('close', () => drop(ws));
  ws.on('error', () => drop(ws));
});

server.listen(PORT, '0.0.0.0', () => console.log(`Shinjuku multiplayer server listening on ${PORT}`));
