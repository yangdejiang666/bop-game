FROM node:20-alpine AS frontend-build
WORKDIR /workspace

COPY package*.json ./
RUN npm install

COPY . .
RUN node ./scripts/build-frontend.mjs

FROM caddy:2-alpine

COPY deploy/oracle-vm/Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend-build /workspace/dist /srv
