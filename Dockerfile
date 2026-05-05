FROM node:22-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 python3-setuptools \
    git ripgrep sqlite3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM base AS production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/shared ./shared
COPY --from=build /app/server ./server
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV SERVER_PORT=3001
ENV HOST=0.0.0.0

EXPOSE 3001

CMD ["node", "dist-server/server/index.js"]
