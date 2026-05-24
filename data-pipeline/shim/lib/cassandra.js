import cassandra from 'cassandra-driver';

const { Client, types } = cassandra;

// Unqualified table name so the Client's `keyspace` config (set from
// CASSANDRA_KEYSPACE env via buildClient) determines where we write. Hardcoding
// `jobflow.companies` would silently ignore that knob.
const INSERT_CQL =
  `INSERT INTO companies (company, org_name, added_at, active, initialized)
   VALUES (?, ?, toTimestamp(now()), true, false)
   IF NOT EXISTS`;

export function buildClient({ contactPoints, localDc, keyspace }) {
  return new Client({
    contactPoints,
    localDataCenter: localDc,
    keyspace,
    queryOptions: {
      consistency: types.consistencies.localOne,
      // LWTs run a Paxos round; pin serial consistency explicitly rather than
      // relying on the driver default, so behaviour stays predictable if the
      // topology grows beyond one datacenter.
      serialConsistency: types.consistencies.localSerial,
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
 * @returns {Promise<'registered' | 'already_exists'>}
 */
export async function insertIfNotExists(client, { company, orgName }) {
  const result = await client.execute(INSERT_CQL, [company, orgName], { prepare: true });
  // LWT result: first row carries a `[applied]` boolean column. Be defensive —
  // a missing row or a non-boolean value silently bucketing to `already_exists`
  // would let `initialized = true` rows quietly survive write attempts and
  // break the relay-race idempotency guarantee.
  const row = result?.rows?.[0];
  if (!row) {
    throw new Error('cassandra LWT returned no rows');
  }
  const applied = row['[applied]'];
  if (typeof applied !== 'boolean') {
    throw new Error('cassandra LWT response missing or non-boolean [applied] column');
  }
  return applied ? 'registered' : 'already_exists';
}
