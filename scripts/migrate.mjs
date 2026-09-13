// Applique schema.sql à la base Turso configurée par les variables d'environnement.
// Usage: node scripts/migrate.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@libsql/client';
import { getTursoConfig } from './_turso.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const db = createClient(getTursoConfig());

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
