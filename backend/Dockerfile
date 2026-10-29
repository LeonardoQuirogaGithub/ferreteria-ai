FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY seeds ./seeds
EXPOSE 4000
# Aplica migraciones pendientes y arranca. Los seeds de demostración se cargan aparte (npm run db:seed).
CMD ["sh", "-c", "node dist/scripts/db.js migrate && node dist/src/server.js"]
