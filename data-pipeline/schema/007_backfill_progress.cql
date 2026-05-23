CREATE TABLE IF NOT EXISTS jobflow.backfill_progress (
    run_id          timeuuid,
    date            date,
    status          text,
    started_at      timestamp,
    completed_at    timestamp,
    events_written  bigint,
    PRIMARY KEY ((run_id), date)
) WITH CLUSTERING ORDER BY (date ASC);
