FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:22-slim AS build-web

WORKDIR /app/web

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/tsconfig.json web/tsconfig.node.json web/vite.config.ts web/index.html ./
COPY web/src ./src
RUN npm run build

FROM node:22-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build-web /app/web/dist ./web/dist
COPY workspaces ./workspaces

# O painel grava relatórios e arquivos de estado no diretório /app.
RUN chown -R node:node /app/workspaces && chown node:node /app

USER node
EXPOSE 8080

# Sobe o painel (servidor HTTP), não o pipeline CLI. O Cloud Run injeta PORT.
CMD ["node", "dist/server.js"]
