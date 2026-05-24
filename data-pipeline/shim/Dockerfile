# JobFlow Cassandra write shim — container image.
#
# Run via docker-compose from data-pipeline/. The shim binds on
# SHIM_BIND_ADDRESS:SHIM_PORT (defaults set in compose to 0.0.0.0:3333) and
# talks to Cassandra on the docker network via the 'cassandra' service name.

FROM node:20-alpine

WORKDIR /app

# Install production deps first so layer caches across source-only edits.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Source.
COPY shim.js ./
COPY lib ./lib

# Non-root user. node:alpine ships a 'node' user (uid 1000) — use it.
RUN chown -R node:node /app
USER node

# Documentation only — actual port comes from SHIM_PORT env var.
EXPOSE 3333

CMD ["node", "shim.js"]
