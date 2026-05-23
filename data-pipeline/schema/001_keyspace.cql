CREATE KEYSPACE IF NOT EXISTS jobflow
WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};
