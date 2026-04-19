const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'vortego.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

const initSql = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS gobans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  official INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
`;

db.exec(initSql);

const createUserStmt = db.prepare(
  'INSERT INTO users (username, email, password_hash, created_at) VALUES (?, ?, ?, ?)'
);
const getUserByUsernameStmt = db.prepare('SELECT * FROM users WHERE username = ?');
const getUserByEmailStmt = db.prepare('SELECT * FROM users WHERE email = ?');
const getUserByIdStmt = db.prepare('SELECT * FROM users WHERE id = ?');

const createGameStmt = db.prepare(
  'INSERT INTO games (user_id, name, data, created_at) VALUES (?, ?, ?, ?)'
);
const listGamesStmt = db.prepare(
  'SELECT id, name, created_at FROM games WHERE user_id = ? ORDER BY id DESC'
);
const getGameStmt = db.prepare(
  'SELECT id, name, data, created_at FROM games WHERE id = ? AND user_id = ?'
);
const updateGameStmt = db.prepare(
  'UPDATE games SET name = ?, data = ? WHERE id = ? AND user_id = ?'
);

function createUser({ username, email, passwordHash }) {
  const now = new Date().toISOString();
  const info = createUserStmt.run(username, email, passwordHash, now);
  return info.lastInsertRowid;
}

function getUserByUsername(username) {
  return getUserByUsernameStmt.get(username);
}

function getUserByEmail(email) {
  return getUserByEmailStmt.get(email);
}

function getUserById(id) {
  return getUserByIdStmt.get(id);
}

const createPasswordResetStmt = db.prepare(
  'INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)'
);
const getPasswordResetStmt = db.prepare(
  'SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > ?'
);
const markPasswordResetUsedStmt = db.prepare(
  'UPDATE password_resets SET used = 1 WHERE token = ?'
);
const updateUserPasswordStmt = db.prepare(
  'UPDATE users SET password_hash = ? WHERE id = ?'
);

function createPasswordReset({ userId, token, expiresAt }) {
  createPasswordResetStmt.run(userId, token, expiresAt);
}

function getPasswordReset(token) {
  return getPasswordResetStmt.get(token, new Date().toISOString());
}

function markPasswordResetUsed(token) {
  markPasswordResetUsedStmt.run(token);
}

function updateUserPassword(userId, passwordHash) {
  updateUserPasswordStmt.run(passwordHash, userId);
}

function createGame({ userId, name, data }) {
  const now = new Date().toISOString();
  const info = createGameStmt.run(userId, name, JSON.stringify(data), now);
  return info.lastInsertRowid;
}

function listGamesByUser(userId) {
  return listGamesStmt.all(userId);
}

function getGameById(userId, id) {
  return getGameStmt.get(id, userId);
}

function updateGame({ userId, id, name, data }) {
  const info = updateGameStmt.run(name, JSON.stringify(data), id, userId);
  return info.changes;
}

const createGobanStmt = db.prepare(
  'INSERT INTO gobans (user_id, name, data, official, created_at) VALUES (?, ?, ?, ?, ?)'
);
const getGobanStmt = db.prepare(`
  SELECT g.id, g.name, g.data, g.official, g.created_at, g.user_id, u.username AS creator
  FROM gobans g
  LEFT JOIN users u ON u.id = g.user_id
  WHERE g.id = ?
`);

function createGoban({ userId, name, data, official = 0 }) {
  const now = new Date().toISOString();
  const info = createGobanStmt.run(userId, name, JSON.stringify(data), official ? 1 : 0, now);
  return info.lastInsertRowid;
}

function listGobans({ filter = 'all', query = '', userId = null } = {}) {
  const where = [];
  const params = [];
  if (filter === 'official') {
    where.push('g.official = 1');
  } else if (filter === 'mine') {
    if (!userId) return [];
    where.push('g.user_id = ?');
    params.push(userId);
  }
  const q = (query || '').trim();
  if (q) {
    where.push('(g.name LIKE ? OR u.username LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like);
  }
  const sql = `
    SELECT g.id, g.name, g.official, g.created_at, g.user_id, u.username AS creator
    FROM gobans g
    LEFT JOIN users u ON u.id = g.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY g.official DESC, g.id DESC
  `;
  return db.prepare(sql).all(...params);
}

function getGobanById(id) {
  return getGobanStmt.get(id);
}

module.exports = {
  db,
  createUser,
  getUserByUsername,
  getUserByEmail,
  getUserById,
  createGame,
  listGamesByUser,
  getGameById,
  updateGame,
  createGoban,
  listGobans,
  getGobanById,
  createPasswordReset,
  getPasswordReset,
  markPasswordResetUsed,
  updateUserPassword,
};
