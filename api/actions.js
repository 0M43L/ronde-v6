import { db } from './_db.js';
import { requireAuth } from './_auth.js';

// Ajoute les colonnes de preuve de clôture à `actions` si elles n'existent
// pas encore (idempotent — vérifie avant d'altérer). Même pattern que
// addMeterValueColumns() dans api/rondes.js, déclenché automatiquement à la
// connexion d'Axel (voir enterApp() côté client).
async function addClosureColumns() {
  const existing = await db.execute(`PRAGMA table_info(actions)`);
  const existingNames = new Set(existing.rows.map((r) => String(r.name).toLowerCase()));
  let added = 0;
  for (const col of ['closed_photo', 'closed_comment', 'closed_by', 'closed_at']) {
    if (existingNames.has(col)) continue;
    await db.execute(`ALTER TABLE actions ADD COLUMN ${col} TEXT`);
    added++;
  }
  return added;
}

// Les actions sont partagées entre tous les techniciens : une action créée
// par un collègue doit apparaître comme "en attente" pour tout le monde.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;

  if (req.method === 'POST' && req.query.action === 'add-closure-columns') {
    if ((user?.prenom || '').toLowerCase() !== 'axel') {
      return res.status(403).json({ error: 'Réservé à Axel' });
    }
    try {
      const added = await addClosureColumns();
      return res.json({ ok: true, added });
    } catch (error) {
      console.error('Migration closure columns error:', error);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // ?since= (optionnel), même principe que rondes/mes-sessions — mais avec
    // une nuance : une action non traitée doit TOUJOURS remonter, même créée
    // il y a longtemps (sinon une action ancienne encore "en attente" sur
    // laquelle un collègue vient d'agir n'apparaîtrait plus jamais comme
    // traitée sur un appareil qui ne la revoit plus dans sa fenêtre récente).
    // Seules les actions déjà traitées ET anciennes sortent du rafraîchissement.
    const { since } = req.query;
    const baseColumns = `a.id, a.user_id, a.substation_id, a.ronde_id, a.text, a.severity, a.source, a.photo, a.done, a.created_at`;
    // closed_photo/closed_comment/closed_by/closed_at peuvent ne pas encore
    // exister (voir addClosureColumns() ci-dessus, pas encore lancée) : on
    // retombe sur l'ancienne liste de colonnes plutôt que de casser le
    // chargement des actions pour tout le monde en attendant que ça arrive.
    let result;
    try {
      result = await db.execute(
        since
          ? {
              sql: `SELECT ${baseColumns}, a.closed_photo, a.closed_comment, a.closed_by, a.closed_at,
                           u.prenom AS user_prenom, u.nom AS user_nom
                    FROM actions a LEFT JOIN users u ON u.id = a.user_id
                    WHERE a.created_at >= datetime(?) OR a.done = 0
                    ORDER BY a.created_at DESC`,
              args: [since],
            }
          : `SELECT ${baseColumns}, a.closed_photo, a.closed_comment, a.closed_by, a.closed_at,
                    u.prenom AS user_prenom, u.nom AS user_nom
             FROM actions a LEFT JOIN users u ON u.id = a.user_id
             ORDER BY a.created_at DESC`
      );
    } catch (error) {
      if (!/no such column/i.test(error?.message || '')) throw error;
      result = await db.execute(
        since
          ? {
              sql: `SELECT ${baseColumns}, u.prenom AS user_prenom, u.nom AS user_nom
                    FROM actions a LEFT JOIN users u ON u.id = a.user_id
                    WHERE a.created_at >= datetime(?) OR a.done = 0
                    ORDER BY a.created_at DESC`,
              args: [since],
            }
          : `SELECT ${baseColumns}, u.prenom AS user_prenom, u.nom AS user_nom
             FROM actions a LEFT JOIN users u ON u.id = a.user_id
             ORDER BY a.created_at DESC`
      );
    }

    return res.json({
      ok: true,
      actions: result.rows.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        tech: [r.user_prenom, r.user_nom].filter(Boolean).join(' ').trim() || null,
        substation_id: r.substation_id,
        ronde_id: r.ronde_id,
        text: r.text,
        severity: r.severity || 'none',
        source: r.source || 'manuelle',
        photo: r.photo,
        done: !!r.done,
        closedPhoto: r.closed_photo ?? null,
        closedComment: r.closed_comment ?? null,
        closedBy: r.closed_by ?? null,
        closedAt: r.closed_at ?? null,
        date: formatDateFr(r.created_at),
        // SQLite stocke created_at au format "YYYY-MM-DD HH:MM:SS" (espace,
        // pas de 'T') : ajouter juste un 'Z' n'est pas de l'ISO 8601 strict
        // et certains moteurs (WebKit/Safari) peuvent le refuser et renvoyer
        // une date invalide. replace(' ', 'T') le rend conforme partout.
        ts: Date.parse(`${r.created_at.replace(' ', 'T')}Z`) || 0,
      })),
    });
  } catch (error) {
    console.error('Actions error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}

function formatDateFr(sqliteDatetime) {
  const ms = Date.parse(`${sqliteDatetime.replace(' ', 'T')}Z`);
  if (!ms) return '';
  return new Date(ms).toLocaleString('fr-FR');
}
