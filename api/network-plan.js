import { db } from './_db.js';
import { requireAuth } from './_auth.js';

// Plan global du réseau d'eau chaude/froide — une seule ligne ('global'),
// pas rattachée à une sous-station (voir aussi api/sync.js pour l'écriture,
// réservée à Axel).
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    const result = await db.execute(`SELECT base_image, strokes_json FROM network_plan WHERE id = 'global'`);
    const r = result.rows[0];
    return res.json({
      ok: true,
      networkPlan: r ? { baseImage: r.base_image, strokes: JSON.parse(r.strokes_json || '[]') } : null,
    });
  } catch (error) {
    console.error('Network plan error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
