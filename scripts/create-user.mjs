// Crée un compte technicien. Pas d'inscription publique par sécurité (les codes
// d'accès des sous-stations sont visibles dans l'app une fois connecté).
// Usage: node scripts/create-user.mjs <email> <password> <prenom> <nom>
import { randomUUID, randomBytes, scryptSync } from 'node:crypto';
import { createClient } from '@libsql/client';

const [, , email, password, prenom, nom] = process.argv;

if (!email || !password || !prenom || !nom) {
  console.error('Usage: node scripts/create-user.mjs <email> <password> <prenom> <nom>');
  process.exit(1);
}

const url = process.env.TURSO_CONNECTION_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error('TURSO_CONNECTION_URL et TURSO_AUTH_TOKEN doivent être définis.');
  process.exit(1);
}

const db = createClient({ url, authToken });

const salt = randomBytes(16).toString('hex');
const passwordHash = scryptSync(password, salt, 64).toString('hex');

await db.execute({
  sql: `INSERT INTO users (id, email, password_hash, password_salt, nom, prenom)
        VALUES (?, ?, ?, ?, ?, ?)`,
  args: [randomUUID(), email, passwordHash, salt, nom, prenom],
});

console.log(`Utilisateur créé : ${prenom} ${nom} <${email}>`);
