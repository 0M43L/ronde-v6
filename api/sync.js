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
    const table = TABLES[entity_type];
    if (!table) throw new Error(`Type inconnu: ${entity_type}`);
    await db.execute({ sql: `DELETE FROM ${table} WHERE id = ? AND user_id = ?`, args: [payload.id, userId] });
    return;
  }

  switch (entity_type) {
    case 'ronde':
      return db.execute({
        sql: `INSERT INTO rondes (id, substation_id, user_id, date, heure, tech, controls_json, observations)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                date = excluded.date, heure = excluded.heure, tech = excluded.tech,
                controls_json = excluded.controls_json, observations = excluded.observations`,
        args: [
          payload.id,
          payload.substation_id,
          userId,
          payload.date || null,
          payload.heure || null,
          payload.tech || null,
          JSON.stringify(payload.controls || []),
          payload.observations || '',
        ],
      });

    case 'fiche':
      return db.execute({
        sql: `INSERT INTO fiches (id, ronde_id, substation_id, user_id, type, description)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET type = excluded.type, description = excluded.description`,
        args: [
          payload.id,
          payload.ronde_id || null,
          payload.substation_id || null,
          userId,
          payload.type,
          payload.description,
        ],
      });

    case 'action':
      return db.execute({
        sql: `INSERT INTO actions (id, user_id, substation_id, text, done)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET text = excluded.text, done = excluded.done`,
        args: [payload.id, userId, payload.substation_id || null, payload.text, payload.done ? 1 : 0],
      });

    case 'mes':
      return db.execute({
        sql: `INSERT INTO mes_records (id, substation_id, user_id, phase, puissance, debit, temperature)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                phase = excluded.phase, puissance = excluded.puissance,
                debit = excluded.debit, temperature = excluded.temperature`,
        args: [
          payload.id,
          payload.substation_id || null,
          userId,
          payload.phase || null,
          payload.puissance ?? null,
          payload.debit ?? null,
          payload.temperature ?? null,
        ],
      });

    default:
      throw new Error(`Type inconnu: ${entity_type}`);
  }
}

const TABLES = {
  ronde: 'rondes',
  fiche: 'fiches',
  action: 'actions',
  mes: 'mes_records',
};
