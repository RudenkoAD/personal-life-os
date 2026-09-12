FROM node:24-bookworm-slim AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN LIFE_OS_TARGET=yandex npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/data/life-os.sqlite MIGRATIONS_DIR=/app/drizzle
WORKDIR /app
COPY --from=build /build/dist/standalone/ ./
COPY --from=build /build/drizzle/ ./drizzle/
COPY --from=build /build/server/start.mjs ./start.mjs
USER node
EXPOSE 3000
CMD ["node", "start.mjs"]
