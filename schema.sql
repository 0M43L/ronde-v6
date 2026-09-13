-- Ronde V6 — schéma Turso (libSQL / SQLite)
-- Exécuter avec: turso db shell <db-name> < schema.sql
-- (ou via scripts/migrate.mjs qui applique ce fichier avec les variables d'environnement)

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  nom           TEXT NOT NULL,
  prenom        TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login    TEXT
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token);

-- Sous-stations importées du KML Google Earth (source de vérité: data/substations.seed.json)
CREATE TABLE IF NOT EXISTS substations (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  lat          REAL,
  lon          REAL,
  notes_acces  TEXT,
  needs_review INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rondes (
  id             TEXT PRIMARY KEY,
  substation_id  TEXT NOT NULL REFERENCES substations(id),
  user_id        TEXT NOT NULL REFERENCES users(id),
  date           TEXT,
  heure          TEXT,
  tech           TEXT,
  controls_json  TEXT NOT NULL,
  observations   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rondes_substation ON rondes(substation_id);
CREATE INDEX IF NOT EXISTS idx_rondes_user ON rondes(user_id);

CREATE TABLE IF NOT EXISTS fiches (
  id            TEXT PRIMARY KEY,
  ronde_id      TEXT REFERENCES rondes(id),
  substation_id TEXT REFERENCES substations(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  type          TEXT NOT NULL,
  description   TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS actions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  substation_id TEXT REFERENCES substations(id),
  text          TEXT NOT NULL,
  done          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mes_records (
  id            TEXT PRIMARY KEY,
  substation_id TEXT REFERENCES substations(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  phase         TEXT,
  puissance     REAL,
  debit         REAL,
  temperature   REAL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
