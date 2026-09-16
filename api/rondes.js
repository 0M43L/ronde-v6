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
    // ?since= (optionnel) : ne renvoie que les rondes créées après cette date.
    // Le client s'en sert pour les rechargements courants une fois qu'il a
    // déjà toute l'historique en cache local (voir loadAppData côté client) —
    // sans ça, chaque ouverture de l'appli retélécharge l'intégralité de
    // l'historique de toute l'équipe depuis le début, un poids qui ne fait
    // que grossir au fil des mois. datetime(?) normalise le format reçu
    // (ISO 8601 avec 'T'/'Z') vers celui stocké en base avant comparaison.
    const { since } = req.query;
    const result = await db.execute(
      since
        ? {
            sql: `SELECT id, substation_id, user_id, date, heure, tech, controls_json, observations, statut, created_at
                  FROM rondes WHERE created_at >= datetime(?) ORDER BY created_at DESC`,
            args: [since],
          }
        : `SELECT id, substation_id, user_id, date, heure, tech, controls_json, observations, statut, created_at
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
