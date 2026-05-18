export default async function globalTeardown(): Promise<void> {
  // Per-worker knex pools are destroyed by the smoke test via afterAll(destroyDb).
  // This hook is kept as the explicit place to add cross-worker cleanup later.
}
