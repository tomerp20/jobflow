import cassandra from 'cassandra-driver';

const { Client, types } = cassandra;

const INSERT_CQL =
  `INSERT INTO jobflow.companies (company, org_name, added_at, active, initialized)
   VALUES (?, ?, toTimestamp(now()), true, false)
   IF NOT EXISTS`;

export function buildClient({ contactPoints, localDc, keyspace }) {
  return new Client({
    contactPoints,
    localDataCenter: localDc,
    keyspace,
    queryOptions: {
      consistency: types.consistencies.localOne,
      prepare: true,
    },
  });
}

/**
 * Registers one (company, org_name) pair using an LWT INSERT … IF NOT EXISTS.
 *
 * The shim is the sole writer of `initialized = false`.  We never UPDATE an
 * existing row — that would silently regress `initialized` from true back to
 * false and break the ADR 0003 Backfill/Hourly relay race.
 *
 * @returns {'registered' | 'already_exists'}
 */
export async function insertIfNotExists(client, { company, orgName }) {
  const result = await client.execute(INSERT_CQL, [company, orgName], { prepare: true });
  // LWT result: first row has a boolean `[applied]` column
  const applied = result.rows[0]['[applied]'];
  return applied ? 'registered' : 'already_exists';
}
