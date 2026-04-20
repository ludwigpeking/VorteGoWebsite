// One-shot admin script for inspecting / cleaning the VorteGo SQLite DB.
//
// Examples (run from project root):
//   node server/admin/reset.js                     # show row counts only
//   node server/admin/reset.js --resets --confirm  # wipe password_resets
//   node server/admin/reset.js --users   --confirm # wipe users + games + resets
//   node server/admin/reset.js --gobans  --confirm # wipe user-created gobans (keeps official)
//   node server/admin/reset.js --full    --confirm # wipe everything
//
// Safety: nothing is deleted without --confirm. Stop the Node server before
// running so WAL writes don't race the cleanup.

const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'data', 'vortego.db');
const db = new Database(dbPath);

const args = new Set(process.argv.slice(2));
const confirm = args.has('--confirm');

const wantResets = args.has('--resets') || args.has('--users') || args.has('--full');
const wantUsers  = args.has('--users')  || args.has('--full');
const wantGobans = args.has('--gobans') || args.has('--full');

function count(table) {
  try { return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n; }
  catch { return 'n/a'; }
}

console.log(`DB: ${dbPath}`);
console.log('Current row counts:');
console.log(`  users           : ${count('users')}`);
console.log(`  password_resets : ${count('password_resets')}`);
console.log(`  games           : ${count('games')}`);
console.log(`  gobans (total)  : ${count('gobans')}`);
try {
  const off = db.prepare('SELECT COUNT(*) AS n FROM gobans WHERE official = 1').get().n;
  const usr = db.prepare('SELECT COUNT(*) AS n FROM gobans WHERE official = 0').get().n;
  console.log(`    official      : ${off}`);
  console.log(`    user-created  : ${usr}`);
} catch {}

if (!wantResets && !wantUsers && !wantGobans) {
  console.log('\nNo --resets / --users / --gobans / --full flag passed — nothing to do.');
  process.exit(0);
}

if (!confirm) {
  console.log('\n--confirm not set. Would delete:');
  if (wantResets) console.log('  - all rows in password_resets');
  if (wantUsers)  console.log('  - all rows in users AND games (cascade by user_id)');
  if (wantGobans) console.log('  - user-created gobans (official rows kept)');
  console.log('\nRe-run with --confirm to execute.');
  process.exit(0);
}

const tx = db.transaction(() => {
  if (wantResets) {
    const n = db.prepare('DELETE FROM password_resets').run().changes;
    console.log(`Deleted ${n} password_resets rows.`);
  }
  if (wantUsers) {
    // Wipe per-user data first to keep referential intent consistent.
    const g = db.prepare('DELETE FROM games').run().changes;
    console.log(`Deleted ${g} games rows.`);
    const u = db.prepare('DELETE FROM users').run().changes;
    console.log(`Deleted ${u} users rows.`);
    // Detach user-created gobans from now-gone users so listings still work.
    const o = db.prepare('UPDATE gobans SET user_id = NULL WHERE user_id IS NOT NULL').run().changes;
    if (o) console.log(`Detached ${o} gobans from deleted users (rows kept, user_id cleared).`);
  }
  if (wantGobans) {
    const n = db.prepare('DELETE FROM gobans WHERE official = 0').run().changes;
    console.log(`Deleted ${n} user-created gobans (official rows kept).`);
  }
});
tx();

console.log('\nDone. New row counts:');
console.log(`  users           : ${count('users')}`);
console.log(`  password_resets : ${count('password_resets')}`);
console.log(`  games           : ${count('games')}`);
console.log(`  gobans          : ${count('gobans')}`);
