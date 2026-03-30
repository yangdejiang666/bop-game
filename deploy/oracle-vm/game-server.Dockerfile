FROM node:20-alpine AS build
WORKDIR /workspace

COPY shared-protocol ./shared-protocol
COPY game-server ./game-server

WORKDIR /workspace/shared-protocol
RUN npm install && npm run build

WORKDIR /workspace/game-server
RUN npm install && npm run build && npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app

COPY --from=build /workspace/game-server ./
RUN rm -rf node_modules/@bop/shared-protocol && mkdir -p node_modules/@bop/shared-protocol
COPY --from=build /workspace/shared-protocol/package.json ./node_modules/@bop/shared-protocol/package.json
COPY --from=build /workspace/shared-protocol/dist ./node_modules/@bop/shared-protocol/dist

ENV NODE_ENV=production
EXPOSE 8899

CMD ["node", "--enable-source-maps", "dist/index.js"]
