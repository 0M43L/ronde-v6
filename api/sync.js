import { db } from './_db.js';
import { requireAuth } from './_auth.js';

// Synchronise la file d'attente locale (IndexedDB) vers le serveur.
// Idempotent : chaque entrée a un id stable côté client, les upserts
// peuvent être rejoués sans dupliquer les données.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    const { queue } = req.body;
    if (!Array.isArray(queue)) {
      return res.status(400).json({ error: 'queue doit être un tableau' });
    }

    let synced = 0;
    const errors = [];

    for (const item of queue) {
      try {
        await syncItem(item, user.id);
        synced++;
      } catch (err) {
        console.error('Sync item error:', item.id, err);
        errors.push({ id: item.id, error: err.message });
      }
    }

    return res.json({ ok: true, synced, errors });
  } catch (error) {
    console.error('Sync error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}

async function syncItem(item, userId) {
  const { entity_type, action, payload } = item;

  if (action === 'delete') {
    return deleteItem(entity_type, payload.id, userId);
  }

  switch (entity_type) {
    case 'ronde':
      return db.execute({
        sql: `INSERT INTO rondes (id, substation_id, user_id, date, heure, tech, controls_json, observations, statut)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                date = excluded.date, heure = excluded.heure, tech = excluded.tech,
                controls_json = excluded.controls_json, observations = excluded.observations,
                statut = excluded.statut`,
        args: [
          payload.id,
          payload.substation_id,
          userId,
          payload.date || null,
          payload.heure || null,
          payload.tech || null,
          JSON.stringify(payload.controls || []),
          payload.observations || '',
          payload.statut || 'operationnel',
        ],
      });

    case 'substation':
      return db.execute({
        sql: `INSERT INTO substations (id, name, lat, lon, notes_acces, needs_review, source, photos_json, updated_at)
              VALUES (?, ?, ?, ?, ?, 0, 'terrain', ?, datetime('now'))
              ON CONFLICT(id) DO UPDATE SET
                name = excluded.name, lat = excluded.lat, lon = excluded.lon,
                notes_acces = excluded.notes_acces, photos_json = excluded.photos_json,
                updated_at = datetime('now')`,
        args: [payload.id, payload.name, payload.lat, payload.lon, payload.notes_acces || '', JSON.stringify(payload.photos || [])],
      });

    case 'fiche':
      return db.execute({
        sql: `INSERT INTO fiches (id, title, symptomes, cause_probable, procedure_intervention, securite,
                outillage, pieces_rechange, solution, urgence, photos_json, notes, is_reference,
                ronde_id, substation_id, user_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                title = excluded.title, symptomes = excluded.symptomes,
                cause_probable = excluded.cause_probable,
                procedure_intervention = excluded.procedure_intervention,
                securite = excluded.securite, outillage = excluded.outillage,
                pieces_rechange = excluded.pieces_rechange, solution = excluded.solution,
                urgence = excluded.urgence, photos_json = excluded.photos_json,
                notes = excluded.notes`,
        args: [
          payload.id,
          payload.title,
          payload.symptomes || '',
          payload.cause_probable || '',
          payload.procedure_intervention || '',
          payload.securite || '',
          payload.outillage || '',
          payload.pieces_rechange || '',
          payload.solution || '',
          payload.urgence || '',
          JSON.stringify(payload.photos || []),
          payload.notes || '',
          payload.ronde_id || null,
          payload.substation_id || null,
          userId,
        ],
      });

    case 'action':
      return db.execute({
        sql: `INSERT INTO actions (id, user_id, substation_id, ronde_id, text, severity, source, photo, done)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                text = excluded.text, severity = excluded.severity, done = excluded.done,
                photo = excluded.photo`,
        args: [
          payload.id,
          userId,
          payload.substation_id || null,
          payload.ronde_id || null,
          payload.text,
          payload.severity || 'none',
          payload.source || 'manuelle',
          payload.photo || null,
          payload.done ? 1 : 0,
        ],
      });

    case 'mes_session':
      return db.execute({
        sql: `INSERT INTO mes_sessions (id, substation_id, user_id, checks_json, poste_json, notes)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET checks_json = excluded.checks_json, poste_json = excluded.poste_json, notes = excluded.notes`,
        args: [payload.id, payload.substation_id || null, userId, JSON.stringify(payload.checks || []), JSON.stringify(payload.poste || {}), payload.notes || ''],
      });

    default:
      throw new Error(`Type inconnu: ${entity_type}`);
  }
}

const TABLES = {
  ronde: 'rondes',
  substation: 'substations',
  fiche: 'fiches',
  action: 'actions',
  mes_session: 'mes_sessions',
};

// Tables où la suppression est limitée aux enregistrements du user (les
// fiches de référence et les sous-stations n'ont pas cette contrainte).
const OWNED_TABLES = new Set(['rondes', 'actions', 'mes_sessions']);

function deleteItem(entity_type, id, userId) {
  const table = TABLES[entity_type];
  if (!table) throw new Error(`Type inconnu: ${entity_type}`);
  if (OWNED_TABLES.has(table)) {
    return db.execute({ sql: `DELETE FROM ${table} WHERE id = ? AND user_id = ?`, args: [id, userId] });
  }
  return db.execute({ sql: `DELETE FROM ${table} WHERE id = ?`, args: [id] });
}
