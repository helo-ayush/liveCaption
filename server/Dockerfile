# Use Node 16 Alpine (lightweight image)
FROM node:18-alpine

# Set working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json first (for caching)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Expose default Hugging Face port
EXPOSE 7860

# Command to run the app
CMD ["npm", "start"]
