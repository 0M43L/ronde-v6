-- Ronde V6 — schéma Turso (libSQL / SQLite)
-- Exécuter avec: turso db shell <db-name> < schema.sql
-- (ou via scripts/migrate.mjs qui applique ce fichier avec les variables d'environnement)

CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  email               TEXT UNIQUE NOT NULL,
  password_hash       TEXT NOT NULL,
  password_salt       TEXT NOT NULL,
  nom                 TEXT NOT NULL,
  prenom              TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  last_login          TEXT,
  failed_login_count  INTEGER NOT NULL DEFAULT 0,
  locked_until        TEXT
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token);

-- Sous-stations. Deux origines : 'kml' (import initial) et 'terrain' (créées
-- depuis l'app via géolocalisation quand une sous-station n'est pas encore référencée).
CREATE TABLE IF NOT EXISTS substations (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  lat          REAL,
  lon          REAL,
  notes_acces  TEXT,
  needs_review INTEGER NOT NULL DEFAULT 0,
  source       TEXT NOT NULL DEFAULT 'kml',
  photos_json  TEXT,
  comments_json TEXT,
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
  statut         TEXT NOT NULL DEFAULT 'operationnel',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rondes_substation ON rondes(substation_id);
CREATE INDEX IF NOT EXISTS idx_rondes_user ON rondes(user_id);

-- Fiches = base de connaissances métier (pannes récurrentes, causes probables,
-- solutions). is_reference=1 pour les fiches pré-remplies, 0 pour celles
-- ajoutées à la main par un technicien. Champs d'assistance à l'intervention
-- (symptomes, procedure_intervention, securite, outillage, pieces_rechange,
-- urgence, photos_json) : tous optionnels, à enrichir au fil du temps — pas
-- de contenu de sécurité/procédure inventé pour une infrastructure réelle.
CREATE TABLE IF NOT EXISTS fiches (
  id                    TEXT PRIMARY KEY,
  title                 TEXT NOT NULL,
  symptomes             TEXT,
  cause_probable        TEXT,
  procedure_intervention TEXT,
  securite              TEXT,
  outillage             TEXT,
  pieces_rechange       TEXT,
  solution              TEXT,
  urgence               TEXT,
  photos_json           TEXT,
  notes                 TEXT,
  is_reference          INTEGER NOT NULL DEFAULT 0,
  ronde_id              TEXT REFERENCES rondes(id),
  substation_id         TEXT REFERENCES substations(id),
  user_id               TEXT REFERENCES users(id),
  version               INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Actions à traiter. source='ronde' quand créée automatiquement depuis une
-- anomalie relevée en ronde (avec photo), 'manuelle' sinon.
-- severity : 'danger' | 'warning' | 'none' — sert au tri par gravité.
CREATE TABLE IF NOT EXISTS actions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  substation_id TEXT REFERENCES substations(id),
  ronde_id      TEXT REFERENCES rondes(id),
  text          TEXT NOT NULL,
  severity      TEXT NOT NULL DEFAULT 'none',
  source        TEXT NOT NULL DEFAULT 'manuelle',
  photo         TEXT,
  done          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sessions de mise en service. checks_json contient la liste des points de
-- vérification cochés (structure libre : le nombre/contenu des points peut
-- évoluer côté frontend sans migration de schéma).
CREATE TABLE IF NOT EXISTS mes_sessions (
  id            TEXT PRIMARY KEY,
  substation_id TEXT REFERENCES substations(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  checks_json   TEXT NOT NULL,
  poste_json    TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
