-- Restructure processed_files to single-partition design.
-- The original table keyed on file_name alone, requiring N concurrent SELECT queries in
-- --catchup mode (one per on-disk hour). With 3,426 on-disk files, this hit the
-- cassandra-driver default pooling.maxRequestsPerConnection = 2048 limit.
--
-- New design: single partition (bucket='singleton'). The catchup query is a single
-- Cassandra round-trip (paged scan of the singleton partition); the chronological
-- max is computed in JS via hourIdToMs(). The clustering order is DESC for operator
-- convenience when reading via cqlsh, but the APPLICATION MUST NOT rely on the
-- on-wire order — file_name has an unpadded hour component (YYYY-MM-DD-H, 0–23),
-- so a lexicographic LIMIT 1 against the clustering order returns the wrong row
-- (e.g. '…-9' beats '…-23' as a string). The application reads all rows and picks
-- the max chronologically. The DESC ordering is a cqlsh nicety only.
--
-- Trade-off: hot-partition anti-pattern accepted because deployment is single-node Cassandra.
-- Future multi-node topology would require repartitioning (e.g. bucket=YYYY).
-- See ADR 0007 for full rationale.
--
-- Production processed_files is empty at migration time → drop+recreate with no data loss.
-- IMPORTANT: re-running this migration on a populated table will wipe its rows.
-- Operator precondition: `SELECT COUNT(*) FROM jobflow.processed_files;` must return 0.

DROP TABLE IF EXISTS jobflow.processed_files;

CREATE TABLE jobflow.processed_files (
    bucket       text,
    file_name    text,
    processed_at timestamp,
    PRIMARY KEY (bucket, file_name)
) WITH CLUSTERING ORDER BY (file_name DESC);
