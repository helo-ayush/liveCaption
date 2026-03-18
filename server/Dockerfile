# Use Node 18 Alpine (lightweight production image)
FROM node:18-alpine

# Set production environment
ENV NODE_ENV=production

# Set working directory inside the container
WORKDIR /app

# Copy dependency manifests first (Docker layer cache optimization)
COPY package*.json ./

# Install only production dependencies, reproducible via lockfile
RUN npm ci --omit=dev

# Copy source code
COPY . .

# Default port for Docker deployment (overridable via docker-compose)
EXPOSE 7860

# Command to run the app
CMD ["npm", "start"]
