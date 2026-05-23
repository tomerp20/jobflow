-- Run via: docker exec -i jf-cassandra cqlsh < scripts/seed-org-map.sql

INSERT INTO jobflow.companies (company, org_name, added_at, active) VALUES ('wix', 'wix', toTimestamp(now()), true);
INSERT INTO jobflow.companies (company, org_name, added_at, active) VALUES ('wix', 'wix-incubator', toTimestamp(now()), true);
INSERT INTO jobflow.companies (company, org_name, added_at, active) VALUES ('wix', 'wix-private', toTimestamp(now()), false);
INSERT INTO jobflow.companies (company, org_name, added_at, active) VALUES ('honeybook', 'honeybook', toTimestamp(now()), true);
