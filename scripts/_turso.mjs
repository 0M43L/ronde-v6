// Certains environnements exposent TURSO_DATABASE_URL, d'autres TURSO_CONNECTION_URL :
// on accepte les deux pour éviter les surprises entre local/CI/Vercel.
export function getTursoConfig() {
  const url = process.env.TURSO_DATABASE_URL || process.env.TURSO_CONNECTION_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url || !authToken) {
    console.error('TURSO_DATABASE_URL (ou TURSO_CONNECTION_URL) et TURSO_AUTH_TOKEN doivent être définis.');
    process.exit(1);
  }

  return { url, authToken };
}
