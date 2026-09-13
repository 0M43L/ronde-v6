// Charge data/substations.seed.json (extrait du KML) dans la table `substations`.
// Usage: node scripts/seed-substations.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@libsql/client';
import { getTursoConfig } from './_turso.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const db = createClient(getTursoConfig());

const substations = JSON.parse(
  readFileSync(join(__dirname, '..', 'data', 'substations.seed.json'), 'utf-8')
);

let count = 0;
for (const s of substations) {
  await db.execute({
    sql: `INSERT INTO substations (id, name, lat, lon, notes_acces, needs_review, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            lat = excluded.lat,
            lon = excluded.lon,
            notes_acces = excluded.notes_acces,
            needs_review = excluded.needs_review,
            updated_at = datetime('now')`,
    args: [s.id, s.name, s.lat, s.lon, s.notes_acces || '', s.needs_review ? 1 : 0],
  });
  count++;
}

console.log(`${count} sous-stations importées/mises à jour.`);
