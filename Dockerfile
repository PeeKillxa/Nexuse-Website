FROM node:20-alpine
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source files
COPY . .

# Build Next.js application
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Setup persistent data folder
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

EXPOSE 3000

CMD ["npm", "run", "start"]
