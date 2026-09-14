import { db } from './_db.js';
import { requireAuth } from './_auth.js';

// Sessions MES partagées entre techniciens : la dernière configuration
// connue d'un poste (onglet Sites) doit être visible même si elle a été
// enregistrée par un collègue sur un autre appareil.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    const result = await db.execute(
      `SELECT m.id, m.substation_id, m.user_id, m.checks_json, m.poste_json, m.notes, m.created_at,
              u.prenom AS user_prenom, u.nom AS user_nom
       FROM mes_sessions m LEFT JOIN users u ON u.id = m.user_id
       ORDER BY m.created_at DESC`
    );

    return res.json({
      ok: true,
      sessions: result.rows.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        tech: [r.user_prenom, r.user_nom].filter(Boolean).join(' ').trim() || null,
        substation_id: r.substation_id,
        checks: JSON.parse(r.checks_json || '[]'),
        poste: JSON.parse(r.poste_json || '{}'),
        notes: r.notes,
        date: formatDateFr(r.created_at),
        ts: Date.parse(`${r.created_at}Z`) || 0,
      })),
    });
  } catch (error) {
    console.error('MES sessions error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}

function formatDateFr(sqliteDatetime) {
  const ms = Date.parse(`${sqliteDatetime}Z`);
  if (!ms) return '';
  return new Date(ms).toLocaleString('fr-FR');
}
