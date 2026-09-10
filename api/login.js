import { createClient } from "@libsql/client/web";
import crypto from 'crypto';

const db = createClient({
  url: process.env.TURSO_CONNECTION_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await db.execute({
      sql: `SELECT * FROM users WHERE email = ?`,
      args: [email],
    });

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const passwordHash = crypto
      .createHash('sha256')
      .update(password + 'salt_idex_2024')
      .digest('hex');

    if (user.password_hash !== passwordHash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db.execute({
      sql: `INSERT INTO user_sessions (id, user_id, token, expires_at)
            VALUES (?, ?, ?, ?)`,
      args: [
        crypto.randomBytes(16).toString('hex'),
        user.id,
        token,
        expiresAt.toISOString(),
      ],
    });

    await db.execute({
      sql: `UPDATE users SET last_login = ? WHERE id = ?`,
      args: [new Date().toISOString(), user.id],
    });

    return res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        nom: user.nom,
        prenom: user.prenom,
      },
    });

  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
