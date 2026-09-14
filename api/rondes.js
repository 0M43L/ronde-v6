import { db } from './_db.js';
import { requireAuth } from './_auth.js';

// Les rondes sont partagées entre tous les techniciens (visibilité d'équipe
// sur l'activité), pas cantonnées à l'appareil qui les a créées.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    const result = await db.execute(
      `SELECT id, substation_id, user_id, date, heure, tech, controls_json, observations, statut, created_at
       FROM rondes ORDER BY created_at DESC`
    );

    return res.json({
      ok: true,
      rondes: result.rows.map((r) => ({
        id: r.id,
        substation_id: r.substation_id,
        user_id: r.user_id,
        date: r.date,
        heure: r.heure,
        tech: r.tech,
        controls: JSON.parse(r.controls_json || '[]'),
        observations: r.observations,
        statut: r.statut || 'operationnel',
        ts: Date.parse(`${r.created_at}Z`) || 0,
      })),
    });
  } catch (error) {
    console.error('Rondes error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
