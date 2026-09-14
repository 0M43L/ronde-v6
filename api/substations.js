import { db } from './_db.js';
import { requireAuth } from './_auth.js';

// Les notes d'accès (codes portail, mots de passe d'armoire...) sont sensibles :
// cet endpoint exige une authentification.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    const result = await db.execute(
      `SELECT id, name, lat, lon, notes_acces, needs_review, photos_json FROM substations ORDER BY name`
    );

    return res.json({
      ok: true,
      substations: result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        lat: r.lat,
        lon: r.lon,
        notes_acces: r.notes_acces,
        needs_review: !!r.needs_review,
        photos: JSON.parse(r.photos_json || '[]'),
      })),
    });
  } catch (error) {
    console.error('Substations error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
