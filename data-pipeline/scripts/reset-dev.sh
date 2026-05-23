#!/usr/bin/env bash
set -euo pipefail

# Wipe Cassandra data and restart the single-node stack cleanly.
# WARNING: destroys all local Cassandra data.

echo "Stopping containers..."
docker compose -f "$(dirname "$0")/../docker-compose.yml" down

echo "Removing Cassandra data..."
sudo rm -rf /home/tomer/cassandra-data/*

echo "Starting fresh..."
docker compose -f "$(dirname "$0")/../docker-compose.yml" up -d

echo "Done. Waiting for node to reach UN state..."
sleep 60
docker exec jf-cassandra nodetool status
