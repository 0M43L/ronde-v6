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
        await syncItem(item, user.id, user);
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

async function syncItem(item, userId, user) {
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

    // Les photos ne passent plus par ce chemin (voir 'substation_photo' plus
    // bas) : un upsert ici n'écrase donc jamais photos_json, même si le
    // technicien n'avait pas encore chargé les photos existantes de ce site
    // (chargement à la demande — voir api/substations.js).
    case 'substation':
      return db.execute({
        sql: `INSERT INTO substations (id, name, lat, lon, notes_acces, needs_review, source, updated_at)
              VALUES (?, ?, ?, ?, ?, 0, 'terrain', datetime('now'))
              ON CONFLICT(id) DO UPDATE SET
                name = excluded.name, lat = excluded.lat, lon = excluded.lon,
                notes_acces = excluded.notes_acces, updated_at = datetime('now')`,
        args: [payload.id, payload.name, payload.lat, payload.lon, payload.notes_acces || ''],
      });

    // Opération ciblée sur UNE photo (ajout ou retrait), plutôt qu'un
    // remplacement du tableau complet : deux techniciens qui ajoutent chacun
    // une photo au même site hors ligne se retrouvent bien tous les deux
    // dans la galerie une fois synchronisés, au lieu que le second écrase
    // l'ajout du premier.
    case 'substation_photo': {
      const result = await db.execute({ sql: `SELECT photos_json FROM substations WHERE id = ?`, args: [payload.substation_id] });
      if (!result.rows[0]) throw new Error('Sous-station introuvable');
      const photos = JSON.parse(result.rows[0].photos_json || '[]');
      const next =
        action === 'add'
          ? photos.some((p) => p.id === payload.photo.id) ? photos : [...photos, payload.photo]
          : photos.filter((p) => p.id !== payload.photo_id);
      return db.execute({
        sql: `UPDATE substations SET photos_json = ?, updated_at = datetime('now') WHERE id = ?`,
        args: [JSON.stringify(next), payload.substation_id],
      });
    }

    // Même principe que les photos : opération ciblée (ajouter/retirer CE
    // commentaire), pas un remplacement du tableau complet. L'auteur et la
    // date sont fixés côté serveur (jamais fournis par le client) pour que
    // l'attribution soit fiable.
    case 'substation_comment': {
      const result = await db.execute({ sql: `SELECT comments_json FROM substations WHERE id = ?`, args: [payload.substation_id] });
      if (!result.rows[0]) throw new Error('Sous-station introuvable');
      const comments = JSON.parse(result.rows[0].comments_json || '[]');
      let next;
      if (action === 'add') {
        if (comments.some((c) => c.id === payload.comment.id)) {
          next = comments;
        } else {
          const tech = [user?.prenom, user?.nom].filter(Boolean).join(' ').trim() || null;
          next = [...comments, { id: payload.comment.id, text: payload.comment.text, user_id: userId, tech, date: new Date().toISOString() }];
        }
      } else {
        // Retrait limité à ses propres commentaires.
        next = comments.filter((c) => !(c.id === payload.comment_id && c.user_id === userId));
      }
      return db.execute({
        sql: `UPDATE substations SET comments_json = ?, updated_at = datetime('now') WHERE id = ?`,
        args: [JSON.stringify(next), payload.substation_id],
      });
    }

    case 'fiche': {
      // Seul l'auteur d'une fiche terrain a le droit de la modifier (les
      // fiches de référence, sans auteur personnel, restent modifiables par
      // tous). Vérifié ici côté serveur — pas seulement en cachant le
      // bouton "Modifier" côté client — pour que ce ne soit pas
      // contournable par un appel direct à l'API.
      const existing = await db.execute({ sql: `SELECT user_id, is_reference FROM fiches WHERE id = ?`, args: [payload.id] });
      const row = existing.rows[0];
      if (row && !row.is_reference && row.user_id && row.user_id !== userId) {
        const err = new Error('FORBIDDEN_NOT_OWNER');
        err.code = 'FORBIDDEN_NOT_OWNER';
        throw err;
      }

      // Concurrence optimiste : si deux personnes modifient la même fiche
      // hors ligne en même temps (rare maintenant que l'édition est limitée
      // à l'auteur, mais reste possible entre deux appareils du même
      // compte, ou pour une fiche de référence), on ne veut surtout pas que
      // la seconde synchro écrase silencieusement le travail de la
      // première. Le client envoie la version qu'il avait vue ; la mise à
      // jour n'est appliquée que si c'est toujours la version courante en
      // base, sinon 0 ligne n'est affectée et syncItem() le traduit en
      // conflit explicite (voir plus bas) — jamais un écrasement silencieux.
      const result = await db.execute({
        sql: `INSERT INTO fiches (id, title, symptomes, cause_probable, procedure_intervention, securite,
                outillage, pieces_rechange, solution, urgence, photos_json, notes, is_reference,
                ronde_id, substation_id, user_id, version)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 1)
              ON CONFLICT(id) DO UPDATE SET
                title = excluded.title, symptomes = excluded.symptomes,
                cause_probable = excluded.cause_probable,
                procedure_intervention = excluded.procedure_intervention,
                securite = excluded.securite, outillage = excluded.outillage,
                pieces_rechange = excluded.pieces_rechange, solution = excluded.solution,
                urgence = excluded.urgence, photos_json = excluded.photos_json,
                notes = excluded.notes, version = fiches.version + 1
              WHERE fiches.version = ?`,
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
          payload.version || 1,
        ],
      });
      if (result.rowsAffected === 0) {
        const err = new Error('CONFLICT');
        err.code = 'CONFLICT';
        throw err;
      }
      return result;
    }

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
