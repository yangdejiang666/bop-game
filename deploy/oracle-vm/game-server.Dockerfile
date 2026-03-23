FROM node:20-alpine AS build
WORKDIR /workspace

COPY shared-protocol ./shared-protocol
COPY game-server ./game-server

WORKDIR /workspace/shared-protocol
RUN npm ci && npm run build

WORKDIR /workspace/game-server
RUN npm ci && npm run build && npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app

COPY --from=build /workspace/game-server ./

ENV NODE_ENV=production
EXPOSE 8899

CMD ["node", "--enable-source-maps", "dist/index.js"]

