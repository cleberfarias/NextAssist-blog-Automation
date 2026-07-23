FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY web/public ./web/public
COPY content-calendar.json post-history.json ./

# O painel grava relatórios e arquivos de estado no diretório /app.
RUN chown node:node /app /app/content-calendar.json /app/post-history.json

USER node
EXPOSE 8080

# Sobe o painel (servidor HTTP), não o pipeline CLI. O Cloud Run injeta PORT.
CMD ["node", "dist/server.js"]
