CREATE TABLE IF NOT EXISTS jobflow.companies (
    company         text,
    org_name        text,
    added_at        timestamp,
    active          boolean,
    PRIMARY KEY ((company), org_name)
);
