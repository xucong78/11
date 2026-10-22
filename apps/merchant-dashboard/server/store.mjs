import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function hashToken(token) { return createHash('sha256').update(token).digest('hex'); }

export function createStore({ dataDir, password, now = Date.now }) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const filename = path.join(dataDir, 'fenbd.sqlite3');
  const db = new DatabaseSync(filename);
  chmodSync(filename, 0o600);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      auth_tag TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  `);
  db.prepare('INSERT OR IGNORE INTO metadata (key, value) VALUES (?, ?)').run('password_salt', randomBytes(32).toString('hex'));
  const salt = db.prepare('SELECT value FROM metadata WHERE key = ?').get('password_salt').value;
  const passwordHash = scryptSync(password, salt, 64);
  const authTag = hashToken(passwordHash);
  db.prepare('INSERT OR IGNORE INTO workspace (id, revision, updated_at, data) VALUES (1, 0, ?, ?)').run(new Date(now()).toISOString(), JSON.stringify({ version: 1, records: [], checks: {}, demo: false, calculator: { values: {}, demo: false } }));
  const read = db.prepare('SELECT revision, updated_at AS updatedAt, data FROM workspace WHERE id = 1');
  const save = db.prepare('UPDATE workspace SET revision = revision + 1, updated_at = ?, data = ? WHERE id = 1 AND revision = ?');
  const sessions = {
    put: db.prepare('INSERT INTO sessions (token_hash, auth_tag, expires_at) VALUES (?, ?, ?)'),
    get: db.prepare('SELECT auth_tag, expires_at FROM sessions WHERE token_hash = ?'),
    remove: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    prune: db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR auth_tag != ?'),
  };
  function getWorkspace() {
    const record = read.get();
    const data = JSON.parse(record.data);
    data.calculator ??= { values: {}, demo: false };
    return { revision: record.revision, updatedAt: record.updatedAt, data };
  }
  return {
    filename,
    passwordHash,
    salt,
    getWorkspace,
    saveWorkspace(baseRevision, data) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const current = read.get();
        if (current.revision !== baseRevision) {
          db.exec('ROLLBACK');
          return { conflict: true, revision: current.revision, updatedAt: current.updatedAt };
        }
        const timestamp = new Date(now()).toISOString();
        save.run(timestamp, JSON.stringify(data), baseRevision);
        db.exec('COMMIT');
        return { revision: baseRevision + 1, updatedAt: timestamp, data };
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch { /* Preserve the original database error. */ }
        throw error;
      }
    },
    createSession(ttlMs) {
      sessions.prune.run(now(), authTag);
      const token = randomBytes(32).toString('base64url');
      sessions.put.run(hashToken(token), authTag, now() + ttlMs);
      return token;
    },
    validSession(token) {
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
      const row = sessions.get.get(hashToken(token));
      if (!row) return false;
      if (row.expires_at <= now() || row.auth_tag !== authTag) { sessions.remove.run(hashToken(token)); return false; }
      return true;
    },
    removeSession(token) {
      if (typeof token === 'string') sessions.remove.run(hashToken(token));
    },
    close() { db.close(); },
  };
}
