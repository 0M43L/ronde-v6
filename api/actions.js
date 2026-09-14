import { db } from './_db.js';
import { requireAuth } from './_auth.js';

// Les actions sont partagées entre tous les techniciens : une action créée
// par un collègue doit apparaître comme "en attente" pour tout le monde.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    const result = await db.execute(
      `SELECT a.id, a.user_id, a.substation_id, a.ronde_id, a.text, a.severity, a.source, a.photo, a.done, a.created_at,
              u.prenom AS user_prenom, u.nom AS user_nom
       FROM actions a LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC`
    );

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
        date: formatDateFr(r.created_at),
        ts: Date.parse(`${r.created_at}Z`) || 0,
      })),
    });
  } catch (error) {
    console.error('Actions error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}

function formatDateFr(sqliteDatetime) {
  const ms = Date.parse(`${sqliteDatetime}Z`);
  if (!ms) return '';
  return new Date(ms).toLocaleString('fr-FR');
}
