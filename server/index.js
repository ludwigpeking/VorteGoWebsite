const path = require('path');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const cookie = require('cookie');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const {
  createUser,
  getUserByUsername,
  getUserByEmail,
  getUserById,
  createGame,
  listGamesByUser,
  getGameById,
} = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change';
const TOKEN_COOKIE = 'vortego_token';

app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

const publicDir = path.join(__dirname, '..');
app.use(express.static(publicDir));

function signToken(user) {
  return jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '7d' });
}

function setAuthCookie(res, token) {
  res.cookie(TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearAuthCookie(res) {
  res.clearCookie(TOKEN_COOKIE);
}

function sanitizeUser(user) {
  return { id: user.id, username: user.username, email: user.email };
}

function getUserFromRequest(req) {
  const token = req.cookies[TOKEN_COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return getUserById(payload.sub);
  } catch (err) {
    return null;
  }
}

function requireAuth(req, res, next) {
  const user = getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  req.user = user;
  next();
}

app.post('/api/auth/signup', (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password) {
    return res.status(400).json({ message: 'All fields required.' });
  }
  if (getUserByUsername(username)) {
    return res.status(400).json({ message: 'Username taken.' });
  }
  if (getUserByEmail(email)) {
    return res.status(400).json({ message: 'Email already registered.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const userId = createUser({ username, email, passwordHash });
  const user = getUserById(userId);
  const token = signToken(user);
  setAuthCookie(res, token);
  return res.json({ user: sanitizeUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { identity, password } = req.body || {};
  if (!identity || !password) {
    return res.status(400).json({ message: 'Missing credentials.' });
  }
  const user = getUserByUsername(identity) || getUserByEmail(identity);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ message: 'Invalid credentials.' });
  }
  const token = signToken(user);
  setAuthCookie(res, token);
  return res.json({ user: sanitizeUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res);
  return res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const user = getUserFromRequest(req);
  return res.json({ user: user ? sanitizeUser(user) : null });
});

app.get('/api/games', requireAuth, (req, res) => {
  const games = listGamesByUser(req.user.id).map((game) => ({
    id: game.id,
    name: game.name,
    createdAt: game.created_at,
  }));
  return res.json({ games });
});

app.get('/api/games/:id', requireAuth, (req, res) => {
  const game = getGameById(req.user.id, Number(req.params.id));
  if (!game) {
    return res.status(404).json({ message: 'Not found.' });
  }
  return res.json({
    id: game.id,
    name: game.name,
    createdAt: game.created_at,
    data: JSON.parse(game.data),
  });
});

app.post('/api/games', requireAuth, (req, res) => {
  const { name, data } = req.body || {};
  if (!name || !data) {
    return res.status(400).json({ message: 'Missing data.' });
  }
  const id = createGame({ userId: req.user.id, name, data });
  return res.json({ id });
});

const onlineUsers = new Map();
const rooms = new Map();

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function broadcastPresence() {
  const list = Array.from(onlineUsers.values()).map((user) => ({
    clientId: user.clientId,
    name: user.name,
    isGuest: user.isGuest,
    roomId: user.roomId || null,
  }));
  io.emit('presence:update', list);
}

function broadcastRooms() {
  const list = Array.from(rooms.values()).map((room) => ({
    id: room.id,
    name: room.name,
    host: room.hostName,
    count: room.count,
  }));
  io.emit('rooms:update', list);
}

function updateRoomCounts(room) {
  room.count = room.players.filter(Boolean).length + room.spectators.size;
  io.to(room.id).emit('room:members', { roomId: room.id, count: room.count });
  broadcastRooms();
}

function getUserFromSocket(socket) {
  const rawCookies = socket.request.headers.cookie || '';
  const parsed = cookie.parse(rawCookies);
  const token = parsed[TOKEN_COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return getUserById(payload.sub);
  } catch (err) {
    return null;
  }
}

function generateRoomId() {
  return `room_${Math.random().toString(36).slice(2, 8)}`;
}

function createRoom(name, socket, user) {
  const roomId = generateRoomId();
  const hostName = user ? user.username : `guest-${socket.id.slice(0, 4)}`;
  const room = {
    id: roomId,
    name,
    hostId: socket.id,
    hostName,
    players: [socket.id, null],
    spectators: new Set(),
    count: 1,
    gameState: null,
  };
  rooms.set(roomId, room);
  joinRoom(roomId, socket, user, true);
}

function joinRoom(roomId, socket, user, isHost = false) {
  const room = rooms.get(roomId);
  if (!room) return;

  socket.join(roomId);
  let role = 'Spectator';
  let color = null;

  if (room.players[0] === null) {
    room.players[0] = socket.id;
    role = 'Black';
    color = 'black';
  } else if (room.players[1] === null) {
    room.players[1] = socket.id;
    role = 'White';
    color = 'white';
  } else {
    room.spectators.add(socket.id);
  }

  const isRoomHost = isHost || room.hostId === socket.id;
  const client = onlineUsers.get(socket.id);
  if (client) client.roomId = roomId;

  updateRoomCounts(room);

  socket.emit('room:joined', {
    roomId: room.id,
    roomName: room.name,
    role,
    color,
    isHost: isRoomHost,
    count: room.count,
  });

  if (room.gameState) {
    socket.emit('room:state', { roomId: room.id, state: room.gameState });
  }

  broadcastPresence();
}

function leaveRoom(socket) {
  const client = onlineUsers.get(socket.id);
  if (!client || !client.roomId) return;

  const room = rooms.get(client.roomId);
  if (!room) {
    client.roomId = null;
    broadcastPresence();
    return;
  }

  room.players = room.players.map((playerId) => (playerId === socket.id ? null : playerId));
  room.spectators.delete(socket.id);

  if (room.hostId === socket.id) {
    const nextHost = room.players.find(Boolean) || Array.from(room.spectators)[0] || null;
    room.hostId = nextHost;
    const hostClient = nextHost ? onlineUsers.get(nextHost) : null;
    room.hostName = hostClient ? hostClient.name : 'Open';
  }

  socket.leave(room.id);
  client.roomId = null;

  if (room.players.every((p) => !p) && room.spectators.size === 0) {
    rooms.delete(room.id);
  } else {
    updateRoomCounts(room);
  }

  socket.emit('room:left');
  broadcastPresence();
  broadcastRooms();
}

io.on('connection', (socket) => {
  const user = getUserFromSocket(socket);
  const guestId = socket.handshake.query.guestId || socket.id.slice(0, 6);
  const name = user ? user.username : `guest-${guestId.slice(-4)}`;

  onlineUsers.set(socket.id, {
    clientId: socket.id,
    userId: user ? user.id : null,
    name,
    isGuest: !user,
    roomId: null,
  });

  broadcastPresence();
  broadcastRooms();

  socket.on('global:message', (payload) => {
    if (!payload || !payload.text) return;
    io.emit('global:message', {
      time: nowTime(),
      name,
      text: payload.text.slice(0, 500),
    });
  });

  socket.on('pm:send', (payload) => {
    if (!payload || !payload.text || !payload.toClientId) return;
    io.to(payload.toClientId).emit('pm:receive', {
      time: nowTime(),
      from: name,
      text: payload.text.slice(0, 500),
    });
  });

  socket.on('room:create', (payload) => {
    const roomName = payload?.name?.trim() || 'VorteGo Room';
    createRoom(roomName, socket, user);
  });

  socket.on('room:join', (payload) => {
    if (!payload?.roomId) return;
    joinRoom(payload.roomId, socket, user);
  });

  socket.on('room:leave', () => {
    leaveRoom(socket);
  });

  socket.on('room:invite', (payload) => {
    if (!payload?.roomId || !payload?.toClientId) return;
    const room = rooms.get(payload.roomId);
    if (!room) return;
    io.to(payload.toClientId).emit('room:invite', {
      roomId: room.id,
      roomName: room.name,
      from: name,
    });
  });

  socket.on('room:message', (payload) => {
    if (!payload || !payload.text) return;
    const client = onlineUsers.get(socket.id);
    if (!client || !client.roomId) return;
    io.to(client.roomId).emit('room:message', {
      time: nowTime(),
      name,
      text: payload.text.slice(0, 500),
    });
  });

  socket.on('game:state', (payload) => {
    const room = rooms.get(payload?.roomId);
    if (!room || !payload?.state) return;
    room.gameState = payload.state;
  });

  socket.on('game:move', (payload) => {
    const room = rooms.get(payload?.roomId);
    if (!room || !payload?.move) return;
    socket.to(room.id).emit('game:move', payload);
  });

  socket.on('disconnect', () => {
    leaveRoom(socket);
    onlineUsers.delete(socket.id);
    broadcastPresence();
    broadcastRooms();
  });
});

server.listen(PORT, () => {
  console.log(`VorteGo server running on :${PORT}`);
});
