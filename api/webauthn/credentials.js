import { db } from '../_db.js';
import { requireAuth } from '../_auth.js';

// Liste ou révoque les appareils Face ID/Touch ID du compte connecté — pour
// pouvoir retirer un ancien téléphone perdu ou remplacé sans devoir changer
// le mot de passe.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    const result = await db.execute({
      sql: `SELECT id, device_name, created_at FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at DESC`,
      args: [user.id],
    });
    return res.json({ ok: true, credentials: result.rows });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id requis' });
    await db.execute({
      sql: `DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?`,
      args: [id, user.id],
    });
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
