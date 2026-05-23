export async function readInitialised(client) {
  const result = await client.execute(
    'SELECT company, org_name FROM companies WHERE initialized = true AND active = true ALLOW FILTERING'
  );
  return result.rows.map(r => ({ company: r.company, org_name: r.org_name }));
}
