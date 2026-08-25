FROM node:20-slim

WORKDIR /app

# Install dependencies first for better layer caching
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source (data/ is excluded by .dockerignore)
COPY . .

# Ensure the persistent data directory exists and is writable
RUN mkdir -p /app/data && chmod 755 /app/data

EXPOSE 3000

CMD ["npm", "start"]
