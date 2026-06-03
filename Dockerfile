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

# ---- Runtime stage: production deps + compiled output only ----
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Copy the compiled JavaScript from the build stage
COPY --from=builder /app/dist ./dist

CMD ["node", "dist/main.js", "-v"]
