// Applique schema.sql à la base Turso configurée par les variables d'environnement.
// Usage: node scripts/migrate.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@libsql/client';

const __dirname = dirname(fileURLToPath(import.meta.url));

const url = process.env.TURSO_CONNECTION_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error('TURSO_CONNECTION_URL et TURSO_AUTH_TOKEN doivent être définis.');
  process.exit(1);
}

const db = createClient({ url, authToken });

const sql = readFileSync(join(__dirname, '..', 'schema.sql'), 'utf-8');
const withoutComments = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');
const statements = withoutComments
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

for (const statement of statements) {
  await db.execute(statement);
}

console.log(`Migration appliquée (${statements.length} instructions).`);
