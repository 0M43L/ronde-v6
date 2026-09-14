import { db } from './_db.js';
import { requireAuth } from './_auth.js';

// Fiches = base de connaissances métier, partagée entre tous les techniciens.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    const result = await db.execute(
      `SELECT id, title, cause_probable, solution, notes, is_reference, substation_id, created_at
       FROM fiches ORDER BY is_reference DESC, title ASC`
    );

    return res.json({
      ok: true,
      fiches: result.rows.map((r) => ({
        id: r.id,
        title: r.title,
        cause_probable: r.cause_probable,
        solution: r.solution,
        notes: r.notes,
        is_reference: !!r.is_reference,
        substation_id: r.substation_id,
        created_at: r.created_at,
      })),
    });
  } catch (error) {
    console.error('Fiches error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
