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
      `SELECT f.id, f.title, f.symptomes, f.cause_probable, f.procedure_intervention, f.securite, f.outillage,
              f.pieces_rechange, f.solution, f.urgence, f.photos_json, f.notes, f.is_reference, f.substation_id,
              f.user_id, f.version, f.created_at,
              u.prenom AS user_prenom, u.nom AS user_nom
       FROM fiches f LEFT JOIN users u ON u.id = f.user_id
       ORDER BY f.is_reference DESC, f.title ASC`
    );

    return res.json({
      ok: true,
      fiches: result.rows.map((r) => ({
        id: r.id,
        title: r.title,
        symptomes: r.symptomes,
        cause_probable: r.cause_probable,
        procedure_intervention: r.procedure_intervention,
        securite: r.securite,
        outillage: r.outillage,
        pieces_rechange: r.pieces_rechange,
        solution: r.solution,
        urgence: r.urgence,
        photos: JSON.parse(r.photos_json || '[]'),
        notes: r.notes,
        is_reference: !!r.is_reference,
        substation_id: r.substation_id,
        user_id: r.user_id,
        tech: [r.user_prenom, r.user_nom].filter(Boolean).join(' ').trim() || null,
        version: r.version || 1,
        created_at: r.created_at,
      })),
    });
  } catch (error) {
    console.error('Fiches error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
