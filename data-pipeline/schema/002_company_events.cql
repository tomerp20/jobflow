CREATE TABLE IF NOT EXISTS jobflow.company_events (
    company        text,
    year_month     text,
    event_time     timestamp,
    event_id       text,
    event_type     text,
    repo_name      text,
    actor_login    text,
    is_ai          boolean,
    tech_tags      set<text>,
    PRIMARY KEY ((company, year_month), event_time, event_id)
) WITH CLUSTERING ORDER BY (event_time DESC, event_id ASC);
