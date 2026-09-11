FROM oven/bun:1.3.14-alpine

WORKDIR /app
COPY package.json server.ts ./

ENV NODE_ENV=production
EXPOSE 10000

USER bun
CMD ["bun", "run", "server.ts"]
