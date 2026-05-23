CREATE TABLE IF NOT EXISTS jobflow.processed_files (
    file_name      text PRIMARY KEY,
    processed_at   timestamp,
    event_count    int,
    filtered_count int
);
