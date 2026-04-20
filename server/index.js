const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const cookie = require('cookie');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { Server } = require('socket.io');
const {
  createUser,
  getUserByUsername,
  getUserByEmail,
  getUserById,
  createGame,
  listGamesByUser,
  getGameById,
  createGoban,
  listGobans,
  getGobanById,
  createPasswordReset,
  getPasswordReset,
  markPasswordResetUsed,
  updateUserPassword,
} = require('./db');

const app = express();

// HTTPS when SSL_KEY and SSL_CERT env vars point to readable PEM files
// (typical for a Let's Encrypt setup, e.g.
//   SSL_KEY=/etc/letsencrypt/live/<domain>/privkey.pem
//   SSL_CERT=/etc/letsencrypt/live/<domain>/fullchain.pem ).
// Otherwise plain HTTP — fine for local dev or when fronted by a TLS proxy.
function buildServer() {
  const keyPath = process.env.SSL_KEY;
  const certPath = process.env.SSL_CERT;
  if (keyPath && certPath) {
    try {
      const credentials = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      };
      console.log(`🔒  HTTPS enabled (key=${keyPath}, cert=${certPath})`);
      return { server: https.createServer(credentials, app), tls: true };
    } catch (err) {
      console.error(`⚠️  Failed to load TLS cert/key — falling back to HTTP:`, err.message);
    }
  }
  console.log('🌐  HTTP mode (no SSL_KEY / SSL_CERT set)');
  return { server: http.createServer(app), tls: false };
}

const { server, tls: _tlsEnabled } = buildServer();
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change';
const TOKEN_COOKIE = 'vortego_token';
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

// Email transporter — configure via environment variables:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// If SMTP_USER is not set, falls back to an Ethereal test account (dev only).
// The preview URL for each email is printed to the server console.
let _transporter = null;
let _smtpFrom = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@vortego.app';

async function getTransporter() {
  if (_transporter) return _transporter;
  if (process.env.SMTP_USER) {
    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' },
    });
  } else {
    // No credentials — create a free Ethereal catch-all inbox for local dev
    const testAccount = await nodemailer.createTestAccount();
    _transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    _smtpFrom = `VorteGo <${testAccount.user}>`;
    console.log('📧  No SMTP credentials set — using Ethereal test inbox:', testAccount.user);
  }
  return _transporter;
}

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

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ message: 'Email required.' });

  const user = getUserByEmail(email);
  // Always respond 200 so we don't reveal whether an email is registered
  if (!user) return res.json({ ok: true });

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
  createPasswordReset({ userId: user.id, token, expiresAt });

  const link = `${APP_URL}/?resetToken=${token}`;
  try {
    const transport = await getTransporter();
    const info = await transport.sendMail({
      from: _smtpFrom,
      to: user.email,
      subject: 'VorteGo — Reset your password',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;">
          <h2 style="color:#f2b705;">VorteGo</h2>
          <p>Hi <strong>${user.username}</strong>,</p>
          <p>We received a request to reset your password. Click the button below to choose a new one.
             This link is valid for <strong>1 hour</strong>.</p>
          <p style="text-align:center;margin:32px 0;">
            <a href="${link}"
               style="background:#f2b705;color:#0d0f14;padding:12px 28px;border-radius:999px;
                      text-decoration:none;font-weight:700;">Reset Password</a>
          </p>
          <p style="font-size:12px;color:#888;">
            If you didn't request this, you can safely ignore this email.<br>
            Link: ${link}
          </p>
        </div>`,
    });
    const preview = nodemailer.getTestMessageUrl(info);
    if (preview) {
      console.log(`📧  Password reset email preview (Ethereal): ${preview}`);
    }
  } catch (err) {
    console.error('Failed to send reset email:', err.message);
    // Still return ok — don't expose email/SMTP errors to the client
  }

  return res.json({ ok: true });
});

app.post('/api/auth/reset-password', (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ message: 'Missing fields.' });
  if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters.' });

  const reset = getPasswordReset(token);
  if (!reset) return res.status(400).json({ message: 'Reset link is invalid or has expired.' });

  const passwordHash = bcrypt.hashSync(password, 10);
  updateUserPassword(reset.user_id, passwordHash);
  markPasswordResetUsed(token);

  return res.json({ ok: true });
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

app.get('/api/gobans', (req, res) => {
  const user = getUserFromRequest(req);
  const filter = (req.query.filter || 'all').toString();
  const query = (req.query.q || '').toString();
  const rows = listGobans({ filter, query, userId: user?.id ?? null }).map((g) => ({
    id: g.id,
    name: g.name,
    creator: g.creator || (g.official ? 'official' : 'guest'),
    official: !!g.official,
    isMine: user ? g.user_id === user.id : false,
    createdAt: g.created_at,
  }));
  return res.json({ gobans: rows });
});

app.get('/api/gobans/:id', (req, res) => {
  const goban = getGobanById(Number(req.params.id));
  if (!goban) return res.status(404).json({ message: 'Not found.' });
  return res.json({
    id: goban.id,
    name: goban.name,
    creator: goban.creator || (goban.official ? 'official' : 'guest'),
    official: !!goban.official,
    createdAt: goban.created_at,
    data: JSON.parse(goban.data),
  });
});

app.post('/api/gobans', requireAuth, (req, res) => {
  const { name, data } = req.body || {};
  if (!name || !data) {
    return res.status(400).json({ message: 'Missing name or data.' });
  }
  const id = createGoban({ userId: req.user.id, name: String(name).slice(0, 80), data });
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

function memberListForRoom(room) {
  // Public roster of socketId + display name for the rules dialog's
  // invitation dropdown. Excludes the room owner only at render time on the
  // client (so the host doesn't invite themselves).
  return Array.from(room.members.values()).map((m) => ({
    clientId: m.socketId,
    name: m.name,
    isHost: m.socketId === room.hostId,
  }));
}

function updateRoomCounts(room) {
  room.count = room.members.size;
  io.to(room.id).emit('room:members', {
    roomId: room.id,
    count: room.count,
    members: memberListForRoom(room),
  });
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
    // members: every joined socket → { socketId, name, userId }. Replaces the
    // old fixed [black, white] slot model so rooms can hold N players, with
    // the active two chosen explicitly via the host invitation flow.
    members: new Map(),
    count: 0,
    challenge: null,         // pending invitation: { fromId, toId, rules, sentAt }
    game: null,              // active game runtime (clocks, finishedMarking, etc.)
    gameState: null,
    rules: null,             // set by room:setRules (after challenge accepted)
    record: null,            // active game record, managed by beginRoomRecord/finalizeRoomRecord
  };
  rooms.set(roomId, room);
  joinRoom(roomId, socket, user, true);
}

// ---- Game runtime (clocks, finishMarking, end-of-game) -------------------

const TIME_PER_MOVE_MS = 30 * 1000;   // 30 seconds per move
const BYO_YOMI_PERIODS = 5;           // 5 reserved countdowns per player

function startGameRuntime(room, blackId, whiteId) {
  stopGameRuntime(room); // clean up any prior game's timer
  // Timed mode requires two distinct seated players. Study / solo runs
  // without a clock — the clock state is still emitted (so the UI can
  // render placeholders) but no setInterval is started and timeout cannot fire.
  const timed = !!blackId && !!whiteId && blackId !== whiteId
    && (room.rules?.colorMode !== 'study');
  room.game = {
    blackId,
    whiteId,
    activeColor: 'black',         // black plays first
    clocks: {
      black: { remainingMs: TIME_PER_MOVE_MS, periodsLeft: BYO_YOMI_PERIODS },
      white: { remainingMs: TIME_PER_MOVE_MS, periodsLeft: BYO_YOMI_PERIODS },
    },
    finishedMarking: new Set(),   // 'black' / 'white' that have confirmed
    deadStones: new Set(),
    ended: false,
    timed,
    lastTickAt: Date.now(),
    timerInterval: null,
  };
  if (timed) {
    room.game.timerInterval = setInterval(() => tickGameClock(room), 1000);
  }
  broadcastClock(room);
}

function stopGameRuntime(room) {
  if (room.game?.timerInterval) {
    clearInterval(room.game.timerInterval);
    room.game.timerInterval = null;
  }
}

function broadcastClock(room) {
  const g = room.game;
  if (!g) return;
  io.to(room.id).emit('game:clock', {
    activeColor: g.activeColor,
    black: { ...g.clocks.black },
    white: { ...g.clocks.white },
  });
}

function tickGameClock(room) {
  const g = room.game;
  if (!g || g.ended) return;
  const c = g.clocks[g.activeColor];
  c.remainingMs -= 1000;
  if (c.remainingMs <= 0) {
    if (c.periodsLeft > 0) {
      // Spend one byo-yomi period and reset the per-move clock.
      c.periodsLeft -= 1;
      c.remainingMs = TIME_PER_MOVE_MS;
    } else {
      // Out of periods — timeout loss.
      const loser = g.activeColor;
      const winner = loser === 'black' ? 'white' : 'black';
      endGame(room, {
        winner,
        endReason: 'timeout',
        // No score — timeout overrides points.
      });
      return;
    }
  }
  broadcastClock(room);
}

// On every move (place/pass), reset active player's clock and switch sides.
function onMoveSwitchClock(room, moveColor) {
  const g = room.game;
  if (!g || g.ended) return;
  // Reset whoever just moved back to a fresh per-move 30s, restoring any
  // mid-period balance — this is the conventional behaviour: spending
  // periods is only triggered by timeout, not by playing under one.
  const moved = g.clocks[moveColor];
  if (moved) moved.remainingMs = TIME_PER_MOVE_MS;
  g.activeColor = moveColor === 'black' ? 'white' : 'black';
  // Give the next player a fresh budget too (their previous turn had its
  // clock reset when they moved last; this is just a no-op refresh).
  g.clocks[g.activeColor].remainingMs = Math.min(
    TIME_PER_MOVE_MS,
    g.clocks[g.activeColor].remainingMs > 0 ? TIME_PER_MOVE_MS : TIME_PER_MOVE_MS,
  );
  broadcastClock(room);
}

// Finalize the game (via consent score, timeout, resignation, or disconnect).
// `result` shape:
//   { winner: 'black'|'white'|'tie',
//     endReason: 'consent'|'timeout'|'resignation'|'disconnect',
//     blackTotal?, whiteTotal?, diff?, komi? }
function endGame(room, result) {
  const g = room.game;
  if (!g || g.ended) return;
  g.ended = true;
  stopGameRuntime(room);
  const players = participantInfoForRoom(room);
  const enriched = {
    ...result,
    blackName: players.black?.username || null,
    whiteName: players.white?.username || null,
  };
  io.to(room.id).emit('game:end', enriched);
  finalizeRoomRecord(room, enriched, result.endReason || 'consent');
}

// ---- Game record lifecycle (multiplayer, server-authoritative) ----

function participantInfoForRoom(room) {
  // Map colors → { socketId, userId, username }. Source of truth is the
  // active game's blackId / whiteId (set when a challenge is accepted).
  // If no game is in progress yet, returns nulls.
  const info = { black: null, white: null };
  const fill = (socketId, color) => {
    if (!socketId) return;
    const client = onlineUsers.get(socketId);
    if (!client) return;
    info[color] = {
      socketId,
      userId: client.userId || null,
      username: client.name,
    };
  };
  if (room.game) {
    fill(room.game.blackId, 'black');
    fill(room.game.whiteId, 'white');
  }
  return info;
}

function beginRoomRecord(room, initialGoban) {
  // Finalize any in-flight record first (handles new game in same room).
  if (room.record && room.record.active) {
    finalizeRoomRecord(room, null, 'superseded');
  }
  const rules = room.rules || { komi: 7.5, colorMode: 'owner-black' };
  const players = participantInfoForRoom(room);
  room.record = {
    active: true,
    startedAt: new Date().toISOString(),
    initialGoban,
    moves: [],
    komi: rules.komi,
    colorMode: rules.colorMode,
    players,
  };
  console.log(`[record] START  room="${room.name}" black=${players.black?.username || '-'} white=${players.white?.username || '-'} komi=${rules.komi} mode=${rules.colorMode}`);
}

function appendRoomMove(room, move) {
  if (!room.record || !room.record.active) return;
  room.record.moves.push({ ...move, ts: Date.now() });
  console.log(`[record] move  room="${room.name}" #${room.record.moves.length} ${move.type}${move.vid != null ? ' vid=' + move.vid : ''}${move.color ? ' ' + move.color : ''}`);
}

function finalizeRoomRecord(room, result, endReason) {
  const rec = room.record;
  if (!rec || !rec.active) return;
  rec.active = false;

  const endedAt = new Date();
  const dateStr = endedAt.toISOString().slice(0, 10);                     // YYYY-MM-DD
  const timeStr = endedAt.toTimeString().slice(0, 5).replace(':', '-');   // HH-MM
  const blackName = rec.players.black?.username;
  const whiteName = rec.players.white?.username;
  let who;
  if (blackName && whiteName) {
    who = `${blackName}_${whiteName}`;
  } else if (blackName || whiteName) {
    who = `${blackName || whiteName}_singleplayer`;
  } else {
    who = 'game';
  }
  const name = `${who}_${dateStr}_${timeStr}`;

  const data = {
    version: 1,
    type: 'game-record',
    room: room.name,
    startedAt: rec.startedAt,
    endedAt: endedAt.toISOString(),
    endReason,                // 'consent' | 'disconnect' | 'superseded'
    result: result || null,   // { winner, diff, blackTotal, whiteTotal, ... } or null
    komi: rec.komi,
    colorMode: rec.colorMode,
    players: rec.players,
    initialGoban: rec.initialGoban,
    moves: rec.moves,
  };

  // Save once per distinct authenticated participant.
  const savedUserIds = new Set();
  for (const color of ['black', 'white']) {
    const p = rec.players[color];
    if (p?.userId && !savedUserIds.has(p.userId)) {
      try {
        createGame({ userId: p.userId, name, data });
        savedUserIds.add(p.userId);
      } catch (err) {
        console.error('Failed to save game record for user', p.userId, err.message);
      }
    }
  }

  console.log(`[record] END    room="${room.name}" name="${name}" reason=${endReason} moves=${rec.moves.length} saved_for=${savedUserIds.size > 0 ? Array.from(savedUserIds).join(',') : '(guests only — not persisted)'}`);

  // Tell participants the record was persisted so their UI can refresh.
  io.to(room.id).emit('game:recordSaved', { name, endReason });
}

function joinRoom(roomId, socket, user, isHost = false) {
  const room = rooms.get(roomId);
  if (!room) return;

  socket.join(roomId);

  // Everyone joins as a "member" first. Their color is decided later, when
  // the host issues a challenge and the invitee accepts. Late joiners during
  // an active game become spectators implicitly (they have no color).
  const client = onlineUsers.get(socket.id);
  const memberName = client ? client.name : (user ? user.username : `guest-${socket.id.slice(0,4)}`);
  room.members.set(socket.id, {
    socketId: socket.id,
    name: memberName,
    userId: user?.id || client?.userId || null,
    joinedAt: Date.now(),
  });
  if (client) client.roomId = roomId;

  const isRoomHost = isHost || room.hostId === socket.id;

  // Determine current role/color from the active game (if any). New joiners
  // mid-game are spectators; the two seated players keep their colors.
  let role = 'Spectator';
  let color = null;
  if (room.game && !room.game.ended) {
    if (socket.id === room.game.blackId) { role = 'Black'; color = 'black'; }
    else if (socket.id === room.game.whiteId) { role = 'White'; color = 'white'; }
  }

  updateRoomCounts(room);

  socket.emit('room:joined', {
    roomId: room.id,
    roomName: room.name,
    role,
    color,
    isHost: isRoomHost,
    count: room.count,
    members: memberListForRoom(room),
  });

  // Send existing rules (if set) so late-joiners know game settings.
  if (room.rules) {
    const { komi, colorMode } = room.rules;
    socket.emit('room:rules', {
      komi,
      colorMode,
      // Late-joiner's perspective: they're a spectator unless they're one of
      // the seated players (handled above via room:joined.color).
      ownerColor: null,
      opponentColor: null,
    });
  }

  if (room.gameState) {
    socket.emit('room:state', { roomId: room.id, state: room.gameState });
  }

  // Push current clock to the late-joiner so spectators see live timers too.
  if (room.game && !room.game.ended) {
    socket.emit('game:clock', {
      activeColor: room.game.activeColor,
      black: { ...room.game.clocks.black },
      white: { ...room.game.clocks.white },
    });
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

  // Item 7: if the leaver is a seated player in an active game, the timer
  // keeps running on their clock — they will lose by 超時 if it runs out.
  // We do NOT clear blackId/whiteId so the timer keeps ticking on the
  // absent player; their socket is gone but their seat persists for
  // timeout purposes.

  room.members.delete(socket.id);

  if (room.hostId === socket.id) {
    // Promote the longest-resident remaining member to host.
    const remaining = Array.from(room.members.values()).sort((a, b) => a.joinedAt - b.joinedAt);
    const next = remaining[0] || null;
    room.hostId = next ? next.socketId : null;
    room.hostName = next ? next.name : 'Open';
  }

  socket.leave(room.id);
  client.roomId = null;

  if (room.members.size === 0) {
    stopGameRuntime(room);
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

  // Host sends a challenge to a specific other member. The recipient gets a
  // confirm prompt; only after they accept does the game actually begin
  // (with rules applied + colors assigned, possibly randomly).
  // In study mode or when no opponent is specified (host alone), the game
  // starts immediately — no invitation flow.
  socket.on('room:challenge', (payload) => {
    const client = onlineUsers.get(socket.id);
    if (!client || !client.roomId) return;
    const room = rooms.get(client.roomId);
    if (!room || room.hostId !== socket.id) return; // only host can invite
    const opponentId = payload?.opponentClientId;
    const { komi = 7.5, colorMode = 'owner-black' } = payload?.rules || {};

    // Direct-start path: study mode, or no opponent picked. The host plays
    // alone (or both seats in study) — no challenge prompt is sent.
    const validOpponent = opponentId && room.members.has(opponentId) && opponentId !== socket.id;
    if (colorMode === 'study' || !validOpponent) {
      room.rules = { komi, colorMode };
      // For solo / study we still set a clock state so the UI works, but the
      // game-runtime tick is started only if there are two distinct seated
      // players. Use the host as black; whiteId may be null.
      const hostColor = colorMode === 'owner-white' ? 'white' : 'black';
      const oppColor = hostColor === 'black' ? 'white' : 'black';
      const blackId = hostColor === 'black' ? socket.id : null;
      const whiteId = hostColor === 'black' ? null : socket.id;
      startGameRuntime(room, blackId, whiteId);

      socket.emit('room:rules', {
        komi, colorMode,
        yourColor: colorMode === 'study' ? 'study' : hostColor,
        ownerColor: hostColor,
        opponentColor: oppColor,
      });
      // Spectators get the announcement without a personal color.
      socket.to(room.id).emit('room:rules', {
        komi, colorMode,
        yourColor: null,
        ownerColor: hostColor,
        opponentColor: oppColor,
      });
      return;
    }

    room.challenge = {
      fromId: socket.id,
      toId: opponentId,
      rules: { komi, colorMode },
      sentAt: Date.now(),
    };
    const opponentClient = onlineUsers.get(opponentId);
    io.to(opponentId).emit('room:challenge', {
      roomId: room.id,
      roomName: room.name,
      fromName: client.name,
      rules: { komi, colorMode },
    });
    // Echo back to host so they can show "waiting for accept" UI.
    socket.emit('room:challengeSent', { toName: opponentClient?.name || '' });
  });

  socket.on('room:challengeDecline', () => {
    const client = onlineUsers.get(socket.id);
    if (!client || !client.roomId) return;
    const room = rooms.get(client.roomId);
    if (!room || !room.challenge || room.challenge.toId !== socket.id) return;
    const hostId = room.challenge.fromId;
    room.challenge = null;
    io.to(hostId).emit('room:challengeDeclined', {
      byName: client.name,
    });
  });

  socket.on('room:challengeAccept', () => {
    const client = onlineUsers.get(socket.id);
    if (!client || !client.roomId) return;
    const room = rooms.get(client.roomId);
    if (!room || !room.challenge || room.challenge.toId !== socket.id) return;
    const ch = room.challenge;
    room.challenge = null;
    const { komi, colorMode } = ch.rules;

    // Resolve which seat plays which color. 'random' picks fairly.
    let hostColor;
    if (colorMode === 'owner-white') hostColor = 'white';
    else if (colorMode === 'owner-black') hostColor = 'black';
    else if (colorMode === 'random') hostColor = Math.random() < 0.5 ? 'black' : 'white';
    else hostColor = 'black'; // study mode: arbitrary label
    const opponentColor = hostColor === 'black' ? 'white' : 'black';
    const blackId = hostColor === 'black' ? ch.fromId : ch.toId;
    const whiteId = hostColor === 'black' ? ch.toId : ch.fromId;

    room.rules = { komi, colorMode };
    startGameRuntime(room, blackId, whiteId);

    // Tell each seated player their assigned color individually so the
    // client doesn't have to figure it out from socket id comparisons.
    io.to(ch.fromId).emit('room:rules', {
      komi, colorMode,
      yourColor: hostColor,
      ownerColor: hostColor,
      opponentColor,
    });
    io.to(ch.toId).emit('room:rules', {
      komi, colorMode,
      yourColor: opponentColor,
      ownerColor: hostColor,
      opponentColor,
    });
    // Spectators get a generic announcement (no yourColor).
    socket.to(room.id).except([ch.fromId, ch.toId]).emit('room:rules', {
      komi, colorMode,
      yourColor: null,
      ownerColor: hostColor,
      opponentColor,
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
    // The first state broadcast after rules are set = game start.
    // Start the record, then let subsequent broadcasts just update gameState for late joiners.
    const isFirstSnapshot = !room.gameState || !room.record || !room.record.active;
    const isHost = socket.id === room.hostId;
    const hasRules = !!room.rules;
    room.gameState = payload.state;
    if (isFirstSnapshot && hasRules && isHost) {
      beginRoomRecord(room, payload.state);
    } else if (isFirstSnapshot) {
      console.log(`[record] game:state received but NOT starting — host=${isHost} hasRules=${hasRules} firstSnapshot=${isFirstSnapshot}`);
    }
    socket.to(room.id).emit('room:state', { roomId: room.id, state: room.gameState });
  });

  socket.on('game:move', (payload) => {
    const room = rooms.get(payload?.roomId);
    if (!room || !payload?.move) return;
    if (!room.record?.active) {
      console.log(`[record] game:move received but no active record for room "${room.name}" — move ignored by record`);
    }
    appendRoomMove(room, payload.move);
    socket.to(room.id).emit('game:move', payload);
    // Reset timer for the player who just moved (per item 6).
    if (room.game && !room.game.ended) {
      const moveColor = payload.move.color
        || (socket.id === room.game.blackId ? 'black'
            : socket.id === room.game.whiteId ? 'white' : null);
      if (moveColor === 'black' || moveColor === 'white') {
        onMoveSwitchClock(room, moveColor);
      }
    }
  });

  // Item 5: dead-stone marking is shared between the two seated players.
  // Either player toggles a stone, the other side mirrors it. Spectators
  // see updates but cannot toggle.
  socket.on('game:deadMark', (payload) => {
    const room = rooms.get(payload?.roomId);
    if (!room || !room.game || room.game.ended) return;
    if (socket.id !== room.game.blackId && socket.id !== room.game.whiteId) return;
    const vid = payload.vid;
    if (typeof vid !== 'number') return;
    if (payload.dead) room.game.deadStones.add(vid);
    else room.game.deadStones.delete(vid);
    socket.to(room.id).emit('game:deadMark', { vid, dead: !!payload.dead });
  });

  // Item 5: BOTH players must confirm Finish Marking before the game ends.
  socket.on('game:finishMarking', (payload) => {
    const room = rooms.get(payload?.roomId);
    if (!room || !room.game || room.game.ended) return;
    let color = null;
    if (socket.id === room.game.blackId) color = 'black';
    else if (socket.id === room.game.whiteId) color = 'white';
    else return; // spectators ignored
    room.game.finishedMarking.add(color);
    io.to(room.id).emit('game:markingProgress', {
      finished: Array.from(room.game.finishedMarking),
    });
    if (room.game.finishedMarking.has('black') && room.game.finishedMarking.has('white')) {
      // Both confirmed — finalize using the score the host computed
      // (passed alongside the second finishMarking event by the client),
      // since the host has the authoritative goban geometry.
      const result = payload?.result || null;
      const winner = result
        ? (result.blackTotal === result.whiteTotal ? 'tie'
           : result.blackTotal > result.whiteTotal ? 'black' : 'white')
        : 'tie';
      endGame(room, {
        winner,
        endReason: 'consent',
        blackTotal: result?.blackTotal ?? null,
        whiteTotal: result?.whiteTotal ?? null,
        diff: result?.diff ?? null,
        komi: result?.komi ?? room.rules?.komi ?? null,
      });
    }
  });

  // Resignation — instant loss for the resigning player.
  socket.on('game:resign', (payload) => {
    const room = rooms.get(payload?.roomId);
    if (!room || !room.game || room.game.ended) return;
    let color = null;
    if (socket.id === room.game.blackId) color = 'black';
    else if (socket.id === room.game.whiteId) color = 'white';
    else return;
    const winner = color === 'black' ? 'white' : 'black';
    endGame(room, { winner, endReason: 'resignation' });
  });

  // Legacy game:end (host computed end after marking) — still accepted as a
  // fallback so spectator-only flows continue to work.
  socket.on('game:end', (payload) => {
    const room = rooms.get(payload?.roomId);
    if (!room) return;
    console.log(`[record] game:end received for room "${room.name}"`);
    finalizeRoomRecord(room, payload?.result || null, 'consent');
  });

  socket.on('disconnect', () => {
    // Item 7: if a seated player disconnects mid-game, do NOT end the game
    // immediately — their server-side clock keeps ticking and they will
    // ultimately lose by timeout (超時負). Only finalize the record when
    // the room is empty (everyone gone) or the game has otherwise ended.
    const client = onlineUsers.get(socket.id);
    if (client?.roomId) {
      const room = rooms.get(client.roomId);
      const inActiveGame = room?.game && !room.game.ended
        && (socket.id === room.game.blackId || socket.id === room.game.whiteId);
      if (room?.record?.active && !inActiveGame) {
        finalizeRoomRecord(room, null, 'disconnect');
      }
    }
    leaveRoom(socket);
    onlineUsers.delete(socket.id);
    broadcastPresence();
    broadcastRooms();
  });
});

server.listen(PORT, () => {
  console.log(`VorteGo server running on ${_tlsEnabled ? 'https' : 'http'}://*:${PORT}`);
});
