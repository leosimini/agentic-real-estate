FROM node:24-alpine AS base
RUN npm i -g pnpm@10.17.0
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @realty/api... build
CMD ["pnpm", "--filter", "@realty/api", "start"]
