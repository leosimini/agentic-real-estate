FROM node:24-alpine AS builder
RUN npm i -g pnpm@10.17.0
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web ./apps/web
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @realty/web build
EXPOSE 3000
CMD ["pnpm", "--filter", "@realty/web", "start"]
