import { db } from './_db.js';

// Invalide la session côté serveur (pas seulement le token local effacé côté
// client) : sans ça, un token qui fuit (appareil volé, etc.) reste valable
// jusqu'à 7 jours même après que le technicien s'est déconnecté.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = req.headers.authorization?.split('Bearer ')[1];
  if (token) {
    await db.execute({ sql: `DELETE FROM user_sessions WHERE token = ?`, args: [token] });
  }

  return res.json({ ok: true });
}
