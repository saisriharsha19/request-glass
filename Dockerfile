FROM oven/bun:1.3.14-alpine
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY calendar-api.ts server.ts ai.ts auth.ts assets.ts account-api.ts database.ts local-db.ts ./
COPY migrations ./migrations
COPY public ./public
ENV NODE_ENV=production
EXPOSE 10000
USER bun
CMD ["bun", "run", "server.ts"]
