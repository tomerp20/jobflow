# JobFlow

A modern, Kanban-style job search pipeline manager. Track every application from discovery to offer with drag-and-drop boards, activity timelines, and smart reminders.

## Features

- **Kanban Board** -- Drag-and-drop cards between customizable pipeline stages
- **Job Cards** -- Store company, role, salary, recruiter contacts, tech stack, tags, and notes
- **Activity Timeline** -- Automatic logging of every change with full field-level history
- **Dashboard Metrics** -- At-a-glance stats on your job search progress
- **Search & Filter** -- Find cards by company, role, tags, priority, or work mode
- **Authentication** -- Secure signup/login with JWT access and refresh tokens
- **Responsive UI** -- Works on desktop and mobile

## Tech Stack

| Layer      | Technology                                      |
| ---------- | ----------------------------------------------- |
| Frontend   | React 19, TypeScript, Vite, Tailwind CSS 4      |
| Backend    | Node.js, Express, TypeScript                    |
| Database   | PostgreSQL 16                                   |
| ORM        | Knex.js (query builder + migrations)            |
| Auth       | JWT (access + refresh tokens), bcrypt           |
| Drag & Drop| @dnd-kit                                        |
| Testing    | Jest, Supertest                                 |
| DevOps     | Docker, Docker Compose                          |

## Prerequisites

- **Node.js** 20+ and npm
- **Docker** and Docker Compose (for PostgreSQL, or bring your own Postgres)
- **Git**

## Quick Start

### Option 1 -- Docker Compose (recommended)

Start everything (database, backend, frontend) with a single command:

```bash
docker compose up
```

The first run will build images and install dependencies. Once running:

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001
- PostgreSQL: localhost:5432

To run migrations and seed the database inside the Docker backend container:

```bash
docker compose exec backend npm run migrate
docker compose exec backend npm run seed
```

### Option 2 -- Setup Script

Run the automated setup script which starts PostgreSQL via Docker, installs
dependencies, runs migrations, and seeds the database:

```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

Then start the backend and frontend in separate terminals:

```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev
```

### Option 3 -- Manual Setup

1. **Start PostgreSQL** (Docker or local install):

   ```bash
   docker compose up -d db
   ```

2. **Configure environment**:

   ```bash
   cp backend/.env.example backend/.env
   # Edit backend/.env if needed
   ```

3. **Install dependencies**:

   ```bash
   cd backend && npm install
   cd ../frontend && npm install
   ```

4. **Run migrations and seed**:

   ```bash
   cd backend
   npm run migrate
   npm run seed
   ```

5. **Start development servers**:

   ```bash
   # Terminal 1
   cd backend && npm run dev

   # Terminal 2
   cd frontend && npm run dev
   ```

## Demo Credentials

After seeding the database, you can log in with:

| Email              | Password   |
| ------------------ | ---------- |
| demo@jobflow.dev   | demo1234   |

## Available Scripts

### Backend (`cd backend`)

| Command               | Description                            |
| --------------------- | -------------------------------------- |
| `npm run dev`         | Start dev server with hot reload       |
| `npm run build`       | Compile TypeScript to `dist/`          |
| `npm start`           | Run compiled production build          |
| `npm run migrate`     | Run pending database migrations        |
| `npm run migrate:rollback` | Roll back the last migration batch |
| `npm run seed`        | Seed the database with demo data       |
| `npm test`            | Run the test suite                     |
| `npm run test:watch`  | Run tests in watch mode                |
| `npm run lint`        | Lint source files                      |

### Frontend (`cd frontend`)

| Command               | Description                            |
| --------------------- | -------------------------------------- |
| `npm run dev`         | Start Vite dev server with HMR         |
| `npm run build`       | Type-check and build for production    |
| `npm run preview`     | Preview the production build locally   |

### Utility Scripts (`scripts/`)

| Script           | Description                                        |
| ---------------- | -------------------------------------------------- |
| `setup.sh`       | Full first-time setup (env, Docker, deps, migrate) |
| `reset-db.sh`    | Roll back all migrations, re-migrate, and re-seed  |

## API Endpoints

All API routes are prefixed with `/api`.

### Health & Metrics

| Method | Endpoint        | Auth | Description                |
| ------ | --------------- | ---- | -------------------------- |
| GET    | `/api/health`   | No   | Health check with DB status|
| GET    | `/api/metrics`  | Yes  | Dashboard metrics          |

### Authentication

| Method | Endpoint            | Auth | Description               |
| ------ | ------------------- | ---- | ------------------------- |
| POST   | `/api/auth/signup`  | No   | Register a new user       |
| POST   | `/api/auth/login`   | No   | Log in and get tokens     |
| POST   | `/api/auth/logout`  | Yes  | Revoke refresh token      |
| POST   | `/api/auth/refresh` | No   | Refresh access token      |
| GET    | `/api/auth/me`      | Yes  | Get current user profile  |

### Stages

| Method | Endpoint            | Auth | Description               |
| ------ | ------------------- | ---- | ------------------------- |
| GET    | `/api/stages`       | Yes  | List all stages           |
| POST   | `/api/stages`       | Yes  | Create a new stage        |
| PATCH  | `/api/stages/:id`   | Yes  | Update a stage            |

### Cards

| Method | Endpoint                    | Auth | Description                     |
| ------ | --------------------------- | ---- | ------------------------------- |
| GET    | `/api/cards`                | Yes  | List cards (with filters)       |
| GET    | `/api/cards/:id`            | Yes  | Get card with activity timeline |
| POST   | `/api/cards`                | Yes  | Create a new card               |
| PATCH  | `/api/cards/:id`            | Yes  | Update card fields              |
| PATCH  | `/api/cards/:id/move`       | Yes  | Move card to stage/position     |
| DELETE | `/api/cards/:id`            | Yes  | Delete a card                   |
| POST   | `/api/cards/:id/notes`      | Yes  | Add a note to a card            |

## Project Structure

```
jobflow/
├── backend/
│   ├── src/
│   │   ├── config/          # Database and logger configuration
│   │   ├── controllers/     # Route controllers
│   │   ├── middleware/       # Auth, validation, error handling
│   │   ├── models/          # Data models
│   │   ├── routes/          # Express route definitions
│   │   ├── services/        # Business logic
│   │   └── utils/           # Shared utilities
│   ├── migrations/          # Knex database migrations
│   ├── seeds/               # Seed data for development
│   ├── tests/               # Test suites
│   ├── Dockerfile
│   ├── knexfile.ts
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── components/      # React components (Auth, Board, Card, etc.)
│   │   ├── hooks/           # Custom React hooks
│   │   ├── pages/           # Route-level page components
│   │   ├── services/        # API client services
│   │   ├── types/           # TypeScript type definitions
│   │   └── utils/           # Shared utilities
│   ├── public/              # Static assets
│   ├── Dockerfile
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── scripts/
│   ├── setup.sh             # First-time setup script
│   └── reset-db.sh          # Database reset script
├── docker-compose.yml
└── README.md
```

## Development Notes

- The backend uses `ts-node-dev` for hot reload during development. Changes to files in `backend/src/` are picked up automatically.
- The frontend uses Vite with HMR. Changes to files in `frontend/src/` are reflected instantly in the browser.
- The Vite dev server proxies `/api` requests to the backend at `http://localhost:3001`, so the frontend and backend can run on different ports without CORS issues.
- When running via Docker Compose, source directories are volume-mounted so hot reload works inside containers.
- The `DATABASE_URL` in Docker Compose overrides the `.env` value to use the `db` service hostname instead of `localhost`.

## License

MIT
