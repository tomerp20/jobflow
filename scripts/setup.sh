#!/usr/bin/env bash
#
# JobFlow — Local Development Setup
#
# This script bootstraps the entire local development environment:
#   1. Copies .env.example to .env (if .env does not already exist)
#   2. Starts PostgreSQL via Docker Compose
#   3. Installs npm dependencies for backend and frontend
#   4. Runs database migrations and seeds
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}       JobFlow — Development Setup          ${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

# ── 1. Environment file ──────────────────────────────────────────────────────

if [ ! -f "$ROOT_DIR/backend/.env" ]; then
  echo -e "${YELLOW}>> Copying .env.example to .env ...${NC}"
  cp "$ROOT_DIR/backend/.env.example" "$ROOT_DIR/backend/.env"
  echo "   .env created. Review and update values as needed."
else
  echo -e "${GREEN}>> .env already exists — skipping copy.${NC}"
fi

echo ""

# ── 2. Start PostgreSQL ──────────────────────────────────────────────────────

echo -e "${YELLOW}>> Starting PostgreSQL via Docker Compose ...${NC}"
docker compose -f "$ROOT_DIR/docker-compose.yml" up -d db

echo -e "${YELLOW}>> Waiting for PostgreSQL to become healthy ...${NC}"
RETRIES=30
until docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T db pg_isready -U jobflow -d jobflow > /dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ "$RETRIES" -le 0 ]; then
    echo "ERROR: PostgreSQL did not become ready in time."
    exit 1
  fi
  sleep 1
done
echo -e "${GREEN}   PostgreSQL is ready.${NC}"

echo ""

# ── 3. Install dependencies ──────────────────────────────────────────────────

echo -e "${YELLOW}>> Installing backend dependencies ...${NC}"
(cd "$ROOT_DIR/backend" && npm install)
echo -e "${GREEN}   Backend dependencies installed.${NC}"

echo ""

echo -e "${YELLOW}>> Installing frontend dependencies ...${NC}"
(cd "$ROOT_DIR/frontend" && npm install)
echo -e "${GREEN}   Frontend dependencies installed.${NC}"

echo ""

# ── 4. Database migrations & seed ─────────────────────────────────────────────

echo -e "${YELLOW}>> Running database migrations ...${NC}"
(cd "$ROOT_DIR/backend" && npm run migrate)
echo -e "${GREEN}   Migrations complete.${NC}"

echo ""

echo -e "${YELLOW}>> Seeding database ...${NC}"
(cd "$ROOT_DIR/backend" && npm run seed)
echo -e "${GREEN}   Seed data loaded.${NC}"

echo ""

# ── Done ──────────────────────────────────────────────────────────────────────

echo -e "${CYAN}============================================${NC}"
echo -e "${GREEN}  Setup complete!${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""
echo -e "  Backend API:   ${CYAN}http://localhost:3001${NC}"
echo -e "  Frontend App:  ${CYAN}http://localhost:5173${NC}"
echo -e "  PostgreSQL:    ${CYAN}localhost:5432${NC}"
echo ""
echo -e "  Demo login:    ${YELLOW}demo@jobflow.dev / demo1234${NC}"
echo ""
echo "  To start all services with Docker Compose:"
echo "    docker compose up"
echo ""
echo "  Or start backend and frontend manually:"
echo "    cd backend  && npm run dev"
echo "    cd frontend && npm run dev"
echo ""
