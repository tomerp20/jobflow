# JobFlow write shim — container image.
#
# Runs two routes (see ADR 0010 + ADR 0011):
#   POST /companies  — Cassandra write shim (Company Scout)
#   POST /notify     — WhatsApp Notifier (sends via whatsapp-web.js + Chromium)
#
# Base is Debian slim (not Alpine): whatsapp-web.js drives Chromium via
# puppeteer, and puppeteer's bundled Chromium does not run on Alpine's musl.
# We install the distro Chromium and point puppeteer at it instead of letting
# puppeteer download its own.

FROM node:20-slim

WORKDIR /app

# Use the system Chromium; skip puppeteer's own download at install time.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Chromium + the runtime libraries it needs headless. --no-install-recommends
# keeps the image lean; fonts-liberation avoids blank glyphs in rendered pages.
# The explicit lib list is belt-and-suspenders — most are already hard Depends
# of the `chromium` package — but pinning them documents the headless surface
# and guards against a future apt resolver trimming a transitive dependency.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-liberation \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libexpat1 \
      libgbm1 \
      libglib2.0-0 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libpango-1.0-0 \
      libx11-6 \
      libxcomposite1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
      libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*

# Install production deps first so layer caches across source-only edits.
# npm ci against the committed lockfile makes rebuilds reproducible (pins the
# whatsapp-web.js + puppeteer tree so a rebuild can't silently drift).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Source.
COPY shim.js ./
COPY lib ./lib

# whatsapp-web.js LocalAuth persists the session here; the directory is
# bind-mounted to the host (see docker-compose.yml) so the QR is scanned once.
# Create it and hand /app to the non-root 'node' user (uid 1000) that ships
# with the image. Chromium runs with --no-sandbox so non-root is fine.
RUN mkdir -p /app/.wwebjs_auth && chown -R node:node /app
USER node

# Documentation only — actual port comes from SHIM_PORT env var.
EXPOSE 3333

CMD ["node", "shim.js"]
