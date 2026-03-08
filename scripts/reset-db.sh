#!/usr/bin/env bash
#
# JobFlow — Reset Database
#
# Rolls back all migrations, re-runs them from scratch, and re-seeds.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}       JobFlow — Database Reset             ${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

echo -e "${RED}WARNING: This will destroy all existing data.${NC}"
read -rp "Are you sure you want to continue? (y/N) " confirm
if [[ "$confirm" != [yY] ]]; then
  echo "Aborted."
  exit 0
fi

echo ""

# ── 1. Roll back all migrations ──────────────────────────────────────────────

echo -e "${YELLOW}>> Rolling back all migrations ...${NC}"
(cd "$BACKEND_DIR" && npx knex migrate:rollback --all --knexfile knexfile.ts)
echo -e "${GREEN}   All migrations rolled back.${NC}"

echo ""

# ── 2. Run migrations fresh ──────────────────────────────────────────────────

echo -e "${YELLOW}>> Running migrations ...${NC}"
(cd "$BACKEND_DIR" && npm run migrate)
echo -e "${GREEN}   Migrations complete.${NC}"

echo ""

# ── 3. Seed the database ─────────────────────────────────────────────────────

echo -e "${YELLOW}>> Seeding database ...${NC}"
(cd "$BACKEND_DIR" && npm run seed)
echo -e "${GREEN}   Seed data loaded.${NC}"

echo ""

echo -e "${CYAN}============================================${NC}"
echo -e "${GREEN}  Database reset complete!${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""
echo -e "  Demo login: ${YELLOW}demo@jobflow.dev / demo1234${NC}"
echo ""
