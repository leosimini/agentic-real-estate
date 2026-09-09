FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf
RUN npm install --global pnpm@10.17.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/db ./packages/db
COPY infra/postgres ./infra/postgres
RUN pnpm install --frozen-lockfile --filter @realty/db...
RUN pnpm --filter @realty/db build
USER node
CMD ["pnpm", "--filter", "@realty/db", "migrate:prod"]
