FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src/ ./src/
COPY web/ ./web/
COPY scripts/build-web.mjs ./scripts/build-web.mjs
RUN npm run build:web
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production KIOKU_HOME=/data KIOKU_PORT=47800
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/dist/web ./dist/web
RUN mkdir /data && chown node:node /data
USER node
CMD ["node", "src/cli/main.ts", "daemon"]
