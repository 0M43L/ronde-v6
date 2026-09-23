// rpID/origin dérivés de la requête plutôt que codés en dur : l'appli est
// servie à la fois sur le domaine de prod et sur des previews Vercel
// (*.vercel.app), et WebAuthn exige que rpID corresponde exactement au
// domaine réellement utilisé par le navigateur.
export function getRpConfig(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const rpID = host.split(':')[0];
  const origin = `${proto}://${host}`;
  return { rpID, origin };
}

// Purge opportuniste des challenges expirés (pas de cron séparé pour une
// table aussi petite) : appelée à chaque génération d'un nouveau challenge.
export async function cleanupExpiredChallenges(db) {
  await db.execute(`DELETE FROM webauthn_challenges WHERE expires_at < datetime('now')`);
}

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
