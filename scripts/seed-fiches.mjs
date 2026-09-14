// Charge data/fiches-reference.seed.json (base de connaissances de départ) dans `fiches`.
// Usage: node scripts/seed-fiches.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@libsql/client';
import { getTursoConfig } from './_turso.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const db = createClient(getTursoConfig());

const fiches = JSON.parse(
  readFileSync(join(__dirname, '..', 'data', 'fiches-reference.seed.json'), 'utf-8')
);

let count = 0;
for (const f of fiches) {
  await db.execute({
    sql: `INSERT INTO fiches (id, title, cause_probable, solution, is_reference, user_id)
          VALUES (?, ?, ?, ?, 1, NULL)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title, cause_probable = excluded.cause_probable, solution = excluded.solution`,
    args: [f.id, f.title, f.cause_probable, f.solution],
  });
  count++;
}

console.log(`${count} fiches de référence importées/mises à jour.`);
