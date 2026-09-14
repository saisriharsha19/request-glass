FROM oven/bun:1.3.14-alpine
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY server.ts ai.ts auth.ts assets.ts ./
COPY public ./public
ENV NODE_ENV=production
EXPOSE 10000
USER bun
CMD ["bun", "run", "server.ts"]
