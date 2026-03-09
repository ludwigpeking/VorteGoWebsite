# VorteGo — Technical Reference

## 1. File Structure

```
2602_VorteGoWebsite/
│
├── server/                   # Node.js back-end
│   ├── index.js              # Express HTTP server + Socket.io event hub
│   ├── db.js                 # SQLite database access layer
│   └── data/
│       └── vortego.db        # SQLite database file (WAL mode)
│
├── index.html                # Single-page app entry point
├── styles.css                # All UI styling (CSS variables, panels, modals)
├── sketch.js                 # p5.js game engine — board rendering, stone placement,
│                             #   game rules (capture, Ko, scoring), editor
├── multiplayer.js            # Client-side Socket.io logic — auth UI, room management,
│                             #   chat, invite flow, game sync with server
├── common.js                 # Pure utilities shared between sketch.js and print:
│                             #   axial-to-pixel, hex directions, polygon ordering
│
├── p5.js                     # p5.js library (bundled locally)
├── ai_player.js              # Monte-Carlo AI opponent (offline only)
├── mcts.js                   # MCTS search tree used by ai_player.js
├── game_reviewer.js          # Standalone game-record viewer
├── print.html / print_sketch.js  # Printable board generation
│
├── images/                   # Wood texture, stone sprites
├── gobans/                   # Preset board JSON files
├── saved_games/              # Local file-system game saves (offline)
├── python_training/          # ML self-play scripts (offline tooling, not served)
│
├── package.json              # npm manifest; start: "node server/index.js"
├── .github/workflows/        # GitHub Actions: SSH pull-to-deploy on DigitalOcean
└── server.md                 # Brief server run instructions
```

### What each file does

| File | Responsibility |
|---|---|
| `server/index.js` | All real-time and HTTP logic: auth routes, game-record REST API, Socket.io event handling, in-memory room state |
| `server/db.js` | Thin wrapper around `better-sqlite3`: user CRUD, game-record CRUD |
| `sketch.js` | p5.js draw loop, board geometry, stone placement/capture/Ko, scoring, goban editor, exposes `window.*` hooks for multiplayer |
| `multiplayer.js` | Socket.io client, auth modals, lobby/room/chat UI, turn enforcement, state sync bridge to sketch.js |
| `common.js` | Stateless math helpers used by both the browser game and print utilities |
| `index.html` | DOM skeleton: lobby, room panel, modals; loads all scripts in order |
| `styles.css` | Design system via CSS custom properties (`--ink`, `--amber`, `--paper`, etc.) |

---

## 2. Multiplayer Live Service

### Technology

The live service is built on **Socket.io v4** over a single persistent WebSocket connection per browser tab. The server keeps all room and presence state **in memory** — there is no database table for rooms or connections.

```
Browser                         Node.js server
  |                                  |
  |--- socket.io handshake --------->|  (JWT cookie + guestId query param)
  |                                  |  → socket authenticated, added to onlineUsers map
  |                                  |
  |--- room:create ----------------->|  → createRoom(); socket joins Socket.io room
  |<-- room:joined ------------------|  (role, color, count)
  |<-- presence:update -------------|  (broadcast to all connected clients)
```

### In-memory data structures (server/index.js)

```js
onlineUsers  // Map<socketId, { clientId, userId, name, isGuest, roomId }>
rooms        // Map<roomId, { id, name, hostId, hostName,
             //               players: [socketId|null, socketId|null],
             //               spectators: Set<socketId>,
             //               count, gameState, rules }>
```

Rooms are created on `room:create` and destroyed automatically when the last player leaves (`leaveRoom()` checks `room.players.every(p => !p) && room.spectators.size === 0`).

---

### Global Lobby Chat

```
Client A                  Server                  All clients
  |-- global:message -->  |                       |
  |   { text }            |-- global:message -->  |  (io.emit — every connected socket)
```

The server calls `io.emit('global:message', { time, name, text })` — a broadcast to **all** connected sockets, not just a room. `multiplayer.js` handles it with `addChatMessage()` which appends to the `#globalChatLog` div.

---

### Private Chat (PM)

```
Client A                  Server                  Client B
  |-- pm:send ----------> |                       |
  |   { toClientId, text }|-- pm:receive -------> |
  |                       |   io.to(toClientId)   |
```

`toClientId` is the target's `socket.id` (stored as `clientId` in `onlineUsers`). The server calls `io.to(toClientId).emit('pm:receive', ...)` — direct delivery to a single socket. On the client, `addPrivateMessage()` renders it in `#pmLog`.

The `pm:send` handler validates the text exists but does **not** persist messages — PMs are ephemeral (session only).

---

### Game Rooms

#### Creating and joining

```
Owner                     Server                  Invited player
  |-- room:create ------> |                       |
  |<- room:joined --------|  role=Black, color=black
  |<- room:members -------|  count=1
  |                       |                       |
  |-- room:invite ------> |                       |
  |                       |-- room:invite ------> | { from, roomName, roomId }
  |                       |                       |-- room:join -->
  |                       |                       |<- room:joined --  role=White, color=white
  |<- room:members -------|---------------------->|  count=2 (broadcast to room)
```

Players are assigned to `room.players[0]` (Black) or `room.players[1]` (White) in order of joining. A third joiner becomes a Spectator.

#### Setting rules and starting a game

```
Owner                     Server                  All in room
  |-- room:setRules -----> |                      |
  |   { komi, colorMode }  |-- room:rules ------> |  { komi, colorMode, ownerColor, opponentColor }
  |                        |                      |
  |-- game:state --------> |                      |
  |   { state }            |-- room:state ------> |  (to all except sender)
```

`room:setRules` computes `ownerColor` / `opponentColor` from `colorMode` (`owner-black`, `owner-white`, or `study`) and broadcasts `room:rules` to every socket in the room. Each client's `onRoomRules()` handler sets `multiplayerState.color` — owner gets `ownerColor`, opponent gets `opponentColor`.

`game:state` carries a full board snapshot (JSON). The server stores it as `room.gameState` (so late-joining spectators receive it on join) and relays it to all other room members as `room:state`.

#### Broadcasting game moves

```
Active player             Server                  Other player(s)
  |-- game:move --------> |                       |
  |   { roomId,           |-- game:move --------> |  (socket.to(roomId) — room except sender)
  |     move: {           |                       |
  |       type: 'place',  |                       |  → applyRemoteMove(move)
  |       vid, color      |                       |    sets currentPlayer = move.color,
  |     }}                |                       |    calls placeStone(vid, {remote:true})
  |                       |                       |    currentPlayer flips to opponent
```

For a **pass**: `move: { type: 'pass' }` → `applyRemotePass()` → `handlePass(true)`.

After applying the remote move the client calls `window.multiplayerUpdateTurn()` which re-evaluates `canMove` from live state and updates `window.multiplayerState.canMove`.

#### Turn enforcement (client-side)

Turn enforcement is computed inline in `mousePressed()` (sketch.js) every click, using the live snapshot `window.multiplayerState`:

```
isSpectator?         → blocked
color === 'study'?   → both players can click freely
color is null?       → free only if solo (no opponent)
hasOpponent?         → allowed only when ms.color === currentPlayer
else (solo)          → free
```

`window.multiplayerState` is a snapshot object rebuilt by `updateMultiplayerState()` in multiplayer.js every time significant state changes. `multiplayerUpdateTurn()` additionally patches `.canMove` on the live snapshot after each remote move.

#### Room state flow summary

```
room:create          → in-memory room created, host gets room:joined
room:join            → slot assigned, everyone gets room:members
room:setRules        → room.rules stored, everyone gets room:rules (colors assigned)
game:state (owner)   → room.gameState stored, others get room:state → game board shown
game:move            → relayed to room; recipient calls applyRemoteMove
game:state (sync)    → sent after every move for late-joining spectators
room:leave / disconnect → slot freed; if empty → room deleted
```

---

## 3. User Registration and Maintenance

### Stack

- **Database:** SQLite via `better-sqlite3` (file: `server/data/vortego.db`, WAL mode)
- **Password hashing:** `bcryptjs` (10 salt rounds)
- **Sessions:** JWT stored in an httpOnly cookie (`vortego_token`), 7-day expiry
- **Middleware:** `cookie-parser` reads the cookie; `requireAuth()` validates the JWT

### Database schema (server/db.js)

```sql
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  username     TEXT    UNIQUE NOT NULL,
  email        TEXT    UNIQUE NOT NULL,
  password_hash TEXT   NOT NULL,
  created_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL,
  name      TEXT    NOT NULL,
  data      TEXT    NOT NULL,   -- full JSON game snapshot
  created_at TEXT   NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
```

### REST API routes

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/signup` | none | Create account; sets JWT cookie |
| POST | `/api/auth/login` | none | Login by username or email; sets JWT cookie |
| POST | `/api/auth/logout` | none | Clears JWT cookie |
| GET | `/api/auth/me` | optional | Returns current user from cookie (null if guest) |
| POST | `/api/games` | required | Save game record (JSON snapshot) |
| GET | `/api/games` | required | List all records for current user |
| GET | `/api/games/:id` | required | Fetch a single record (user-scoped) |

### Signup flow

```
Client                           Server
  |-- POST /api/auth/signup -->  |
  |   { username, email,         |  1. Validate fields present
  |     password }               |  2. Check username unique  → 409 if taken
  |                              |  3. Check email unique     → 409 if taken
  |                              |  4. bcrypt.hash(password, 10)
  |                              |  5. INSERT INTO users ...
  |                              |  6. jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '7d' })
  |                              |  7. res.cookie('vortego_token', token, { httpOnly: true,
  |                              |       sameSite: 'lax', secure: production? })
  |<-- 200 { user } ------------ |
```

### Login flow

```
Client                           Server
  |-- POST /api/auth/login --->  |
  |   { identity, password }     |  1. getUserByUsername(identity) || getUserByEmail(identity)
  |                              |  2. bcrypt.compareSync(password, hash)  → 401 if fail
  |                              |  3. Same JWT/cookie issue as signup
  |<-- 200 { user } ------------ |
```

### Session validation (requireAuth middleware)

```js
function requireAuth(req, res, next) {
  const token = req.cookies.vortego_token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);   // validates signature + expiry
    req.user = getUserById(payload.sub);              // re-fetch from DB
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
```

### Guest access

Guests never authenticate. Their `socket.id` is used as `clientId`. A stable guest label is derived from a `guestId` stored in `localStorage` (passed via Socket.io handshake query). Guests can create rooms, play, and chat but are rejected by `requireAuth` when attempting to save game records.

### Socket.io authentication

The Socket.io connection reads the JWT cookie directly from the HTTP upgrade request via `cookie.parse(socket.request.headers.cookie)`. This means the socket is identified as the same authenticated user as the browser session — no separate token exchange is needed.

### Deployment notes

- `JWT_SECRET` must be set as a real secret in the production environment (defaults to `'dev-secret-change'`).
- `NODE_ENV=production` enables the `secure` flag on the cookie (HTTPS only).
- The server is deployed to a DigitalOcean droplet via GitHub Actions (`.github/workflows/deploy.yml`): on every push to `master`, the workflow SSH-pulls the latest code and restarts.
- The database file lives on the droplet's filesystem at `server/data/vortego.db` and is **not** in version control (listed in `.gitignore`).
