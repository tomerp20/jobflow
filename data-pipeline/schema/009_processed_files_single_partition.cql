-- Restructure processed_files to single-partition design.
-- The original table keyed on file_name alone, requiring N concurrent SELECT queries in
-- --catchup mode (one per on-disk hour). With 3,426 on-disk files, this hit the
-- cassandra-driver default pooling.maxRequestsPerConnection = 2048 limit.
--
-- New design: single partition (bucket='singleton'), clustering on hour_time (timestamp).
-- Cassandra timestamps sort chronologically, so LIMIT 1 on the DESC clustering column
-- returns the latest processed hour in a true O(1) key lookup — no JS max scan needed.
-- hour_time is computed from file_name on write (hourIdToMs); file_name is stored as a
-- regular column so the application can return the original string to callers.
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
    hour_time    timestamp,
    file_name    text,
    processed_at timestamp,
    PRIMARY KEY (bucket, hour_time)
) WITH CLUSTERING ORDER BY (hour_time DESC);
