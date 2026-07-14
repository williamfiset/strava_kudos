# ---- Build stage: install all deps and compile TypeScript ----
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install all dependencies (including dev deps needed for the build)
RUN npm ci

# Copy sources and compile to dist/
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# ---- Runtime stage: production deps + compiled output + Firefox for Playwright ----
# Playwright's bundled browser binaries need glibc and are not supported on
# Alpine/musl, so the runtime stage uses Microsoft's official Playwright image
# (Debian-based, matching the "playwright" version pinned in package.json)
# instead of node:22-alpine.
FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app

COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Firefox itself is already bundled in this base image, but this keeps the
# Dockerfile correct if the pinned Playwright version above ever changes.
RUN npx playwright install --with-deps firefox

# Copy the compiled JavaScript from the build stage
COPY --from=builder /app/dist ./dist

CMD ["node", "dist/main.js", "-v"]
