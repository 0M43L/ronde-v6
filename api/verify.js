import { createClient } from "@libsql/client/web";

const db = createClient({
  url: process.env.TURSO_CONNECTION_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export default async function handler(req, res) {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const result = await db.execute({
      sql: `SELECT s.user_id, s.expires_at, u.email, u.nom, u.prenom 
            FROM user_sessions s 
            JOIN users u ON s.user_id = u.id 
            WHERE s.token = ?`,
      args: [token],
    });

    const session = result.rows[0];

    if (!session) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    if (new Date(session.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Token expired' });
    }

    return res.json({
      ok: true,
      user: {
        email: session.email,
        nom: session.nom,
        prenom: session.prenom,
      },
    });

  } catch (error) {
    console.error('Verify Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
