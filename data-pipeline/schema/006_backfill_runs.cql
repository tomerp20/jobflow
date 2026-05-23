CREATE TABLE IF NOT EXISTS jobflow.backfill_runs (
    bucket          text,
    run_id          timeuuid,
    started_at      timestamp,
    completed_at    timestamp,
    status          text,
    target_rows     set<frozen<tuple<text, text>>>,
    PRIMARY KEY ((bucket), run_id)
) WITH CLUSTERING ORDER BY (run_id DESC);
