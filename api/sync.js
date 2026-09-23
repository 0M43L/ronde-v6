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

    // Traité par VAGUES de dépendance (sous-stations d'abord, puis rondes/
    // sessions MES, puis actions/fiches) avant le regroupement par lot en
    // parallèle : une ronde faite sur un site tout juste créé (même envoi)
    // référence ce site par son id — si les deux étaient tentés en même
    // temps (groupes différents, donc en parallèle), la ronde pouvait être
    // insérée AVANT que le site n'existe vraiment en base, et échouer alors
    // systématiquement à chaque tentative (la contrainte n'est jamais
    // satisfaite, retenter le même envoi ne change rien). Une action/fiche
    // peut à son tour référencer une ronde du même envoi, d'où la 3e vague.
    const TIER = {
      substation: 0,
      ronde: 1,
      mes_session: 1,
      substation_photo: 1,
      substation_comment: 1,
      action: 2,
      fiche: 2,
    };
    const waves = [[], [], []];
    for (const item of queue) {
      waves[TIER[item.entity_type] ?? 0].push(item);
    }

    for (const wave of waves) {
      if (wave.length === 0) continue;

      // Regroupées par ligne visée (même sous-station pour un ajout de photo/
      // commentaire, même id pour le reste) : les groupes tournent en
      // parallèle — ce qui accélère beaucoup une resynchro après une longue
      // coupure réseau, où la file contient souvent des dizaines d'éléments
      // indépendants — mais chaque groupe reste traité dans l'ordre pour ne
      // jamais risquer que deux écritures sur LE MÊME enregistrement (ex.
      // deux photos ajoutées au même site dans le même lot) se marchent
      // dessus en lisant chacune l'ancienne valeur avant que l'autre n'ait
      // écrit la sienne. conflictKeyFor() ne doit JAMAIS faire échouer toute
      // la vague : un seul élément mal formé (ancien format, bug côté
      // client...) ne doit pas empêcher les autres de synchroniser — on lui
      // donne sa propre clé isolée plutôt que de laisser l'exception remonter.
      const groups = new Map();
      for (const item of wave) {
        let key;
        try {
          key = conflictKeyFor(item);
        } catch (err) {
          console.error('Sync grouping error:', item?.id, err);
          key = `_isolated_${item?.id ?? Math.random()}`;
        }
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      }

      await Promise.all(
        Array.from(groups.values()).map(async (group) => {
          for (const item of group) {
            try {
              await syncItem(item, user.id, user);
              synced++;
            } catch (err) {
              console.error('Sync item error:', item.id, err);
              errors.push({ id: item.id, error: err.message });
            }
          }
        })
      );
    }

    return res.json({ ok: true, synced, errors });
  } catch (error) {
    console.error('Sync error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}

// Lève une erreur si l'enregistrement existe déjà ET appartient à quelqu'un
// d'autre. Ne bloque jamais la création d'un nouvel enregistrement (pas de
// ligne existante) ni la resynchro de son propre enregistrement.
async function assertOwnerOrNew(table, id, userId) {
  const existing = await db.execute({ sql: `SELECT user_id FROM ${table} WHERE id = ?`, args: [id] });
  const row = existing.rows[0];
  if (row && row.user_id && row.user_id !== userId) {
    const err = new Error('FORBIDDEN_NOT_OWNER');
    err.code = 'FORBIDDEN_NOT_OWNER';
    throw err;
  }
}

// La clé identifie la ligne réellement modifiée en base. Pour les photos/
// commentaires de sous-station, plusieurs opérations peuvent viser la même
// sous-station (même si elles portent des ids de photo/commentaire
// différents) puisqu'elles lisent-modifient-écrivent le même champ JSON —
// elles doivent donc rester dans le même groupe séquentiel.
function conflictKeyFor(item) {
  if (item.entity_type === 'substation_photo' || item.entity_type === 'substation_comment') {
    return `substation:${item.payload.substation_id}`;
  }
  return `${item.entity_type}:${item.payload.id}`;
}

async function syncItem(item, userId, user) {
  const { entity_type, action, payload } = item;

  if (action === 'delete') {
    return deleteItem(entity_type, payload.id, userId);
  }

  switch (entity_type) {
    // Une ronde n'a de sens que rattachée à qui l'a faite : contrairement aux
    // actions (voir plus bas), il n'y a pas de cas légitime où quelqu'un
    // d'autre a besoin de modifier une ronde existante. Même vérification
    // que pour la suppression (OWNED_TABLES), appliquée ici à la mise à jour
    // pour qu'elle ne soit pas le seul chemin resté ouvert à tous.
    case 'ronde': {
      await assertOwnerOrNew('rondes', payload.id, userId);
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
    }

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

    // Opération ciblée sur UNE photo (ajout ou retrait), écrite en UNE seule
    // requête SQL atomique (json_insert / json_each — fonctions JSON1 de
    // SQLite, supportées par Turso/libSQL) plutôt qu'en lisant le tableau
    // côté code puis en le réécrivant en entier : cette ancienne méthode
    // "lire puis écrire" avait une vraie fenêtre de course — deux ajouts qui
    // se chevauchent (deux techniciens, ou simplement deux tentatives de
    // synchro qui se chevauchent sur le même appareil) pouvaient lire
    // chacun l'état AVANT l'écriture de l'autre, la seconde écrasant
    // silencieusement l'ajout de la première. Vérifié par simulation :
    // avec l'ancienne méthode, une photo pouvait disparaître de la galerie
    // sans erreur ni message ; avec l'écriture atomique, impossible — le
    // moteur SQL garantit qu'une seule écriture à la fois modifie la ligne.
    case 'substation_photo': {
      if (action === 'add') {
        const result = await db.execute({
          sql: `UPDATE substations
                SET photos_json = json_insert(COALESCE(photos_json, '[]'), '$[#]', json(?)),
                    updated_at = datetime('now')
                WHERE id = ?
                  AND NOT EXISTS (
                    SELECT 1 FROM json_each(COALESCE(photos_json, '[]'))
                    WHERE json_extract(value, '$.id') = ?
                  )`,
          args: [JSON.stringify(payload.photo), payload.substation_id, payload.photo.id],
        });
        // 0 ligne modifiée : soit la photo était déjà présente (rejeu d'une
        // synchro déjà passée — rien à faire, pas une erreur), soit le site
        // n'existe pas du tout. On ne distingue les deux que pour donner un
        // message clair dans ce 2e cas, jamais pour décider quoi écrire.
        if (result.rowsAffected === 0) {
          const exists = await db.execute({ sql: `SELECT 1 FROM substations WHERE id = ?`, args: [payload.substation_id] });
          if (!exists.rows[0]) throw new Error('Sous-station introuvable');
        }
        return result;
      }
      return db.execute({
        sql: `UPDATE substations
              SET photos_json = (
                SELECT COALESCE(json_group_array(json(value)), '[]')
                FROM json_each(COALESCE(photos_json, '[]'))
                WHERE json_extract(value, '$.id') != ?
              ),
              updated_at = datetime('now')
              WHERE id = ?`,
        args: [payload.photo_id, payload.substation_id],
      });
    }

    // Même principe que les photos : opération ciblée (ajouter/retirer/
    // modifier CE commentaire), pas un remplacement du tableau complet.
    // L'auteur et la date sont fixés côté serveur (jamais fournis par le
    // client) pour que l'attribution soit fiable. Modifier ou retirer est
    // limité à ses propres commentaires (comme la suppression).
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
      } else if (action === 'edit') {
        next = comments.map((c) => (c.id === payload.comment_id && c.user_id === userId ? { ...c, text: payload.text, edited_at: new Date().toISOString() } : c));
      } else {
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

    // Les actions sont un cas particulier : n'importe quel technicien doit
    // pouvoir cocher/traiter une action créée par un collègue (workflow
    // d'équipe voulu, voir renderActions côté client — la case à cocher
    // n'est pas limitée à l'auteur). Mais rien ne justifie qu'un tiers
    // réécrive le texte ou la gravité d'une action qu'il n'a pas créée :
    // seul "done"/"photo" (le résultat du traitement) reste ouvert à tous,
    // le contenu original reste protégé comme pour une fiche.
    case 'action': {
      const existing = await db.execute({ sql: `SELECT user_id FROM actions WHERE id = ?`, args: [payload.id] });
      const row = existing.rows[0];
      const isOwner = !row || !row.user_id || row.user_id === userId;

      if (!isOwner) {
        return db.execute({
          sql: `UPDATE actions SET done = ?, photo = ? WHERE id = ?`,
          args: [payload.done ? 1 : 0, payload.photo || null, payload.id],
        });
      }

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
    }

    // Comme les rondes : une session MES appartient à qui l'a faite, pas de
    // cas légitime où un collègue la modifierait après coup.
    case 'mes_session': {
      await assertOwnerOrNew('mes_sessions', payload.id, userId);
      return db.execute({
        sql: `INSERT INTO mes_sessions (id, substation_id, user_id, checks_json, poste_json, notes)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET checks_json = excluded.checks_json, poste_json = excluded.poste_json, notes = excluded.notes`,
        args: [payload.id, payload.substation_id || null, userId, JSON.stringify(payload.checks || []), JSON.stringify(payload.poste || {}), payload.notes || ''],
      });
    }

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
