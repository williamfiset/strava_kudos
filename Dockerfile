FROM node:22-alpine

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install dependencies (npm ci is faster and more reliable for production)
RUN npm ci --only=production && npm cache clean --force

# Copy source code and configuration templates
COPY main.js .
COPY src/ src/

CMD ["node", "main.js", "-v"]