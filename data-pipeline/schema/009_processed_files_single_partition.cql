-- Restructure processed_files to single-partition design for O(1) catchup max lookup.
-- The original table keyed on file_name alone, requiring N concurrent SELECT queries in
-- --catchup mode (one per on-disk hour). With 3,426 on-disk files, this hit the
-- cassandra-driver default pooling.maxRequestsPerConnection = 2048 limit.
--
-- New design: single partition (bucket='singleton') with CLUSTERING ORDER BY DESC.
-- Catchup now reads MAX(file_name) in one query → filter by id > max.
--
-- Trade-off: hot-partition anti-pattern accepted because deployment is single-node Cassandra.
-- Future multi-node topology would require repartitioning (e.g. bucket=YYYY).
-- See ADR 0007 for full rationale.
--
-- Production processed_files is empty at migration time → drop+recreate with no data loss.

DROP TABLE IF EXISTS jobflow.processed_files;

CREATE TABLE jobflow.processed_files (
    bucket       text,
    file_name    text,
    processed_at timestamp,
    PRIMARY KEY (bucket, file_name)
) WITH CLUSTERING ORDER BY (file_name DESC);
