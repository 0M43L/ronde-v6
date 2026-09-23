import { randomUUID } from 'node:crypto';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { db } from '../_db.js';
import { requireAuth } from '../_auth.js';
import { getRpConfig, cleanupExpiredChallenges, CHALLENGE_TTL_MS } from './_rp.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAuth(req, res);
  if (!user) return;

  const { rpID } = getRpConfig(req);

  const existing = await db.execute({
    sql: `SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = ?`,
    args: [user.id],
  });

  const options = await generateRegistrationOptions({
    rpName: 'Ronde V6',
    rpID,
    userName: user.email,
    userID: Buffer.from(user.id, 'utf8'),
    userDisplayName: `${user.prenom} ${user.nom}`.trim(),
    attestationType: 'none',
    excludeCredentials: existing.rows.map((r) => ({
      id: r.credential_id,
      transports: r.transports ? JSON.parse(r.transports) : undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform',
    },
  });

  await cleanupExpiredChallenges(db);
  await db.execute({
    sql: `INSERT INTO webauthn_challenges (id, user_id, challenge, expires_at) VALUES (?, ?, ?, ?)`,
    args: [randomUUID(), user.id, options.challenge, new Date(Date.now() + CHALLENGE_TTL_MS).toISOString()],
  });

  return res.json(options);
}
