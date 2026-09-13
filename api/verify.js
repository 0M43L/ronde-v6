import { authenticate } from './_auth.js';

export default async function handler(req, res) {
  try {
    const user = await authenticate(req);

    if (!user) {
      return res.status(401).json({ error: 'Token invalide ou expiré' });
    }

    return res.json({ ok: true, user });
  } catch (error) {
    console.error('Verify error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
