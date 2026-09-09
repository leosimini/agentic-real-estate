FROM node:24-alpine
RUN npm i -g pnpm@10.17.0
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @realty/worker... build
CMD ["pnpm", "--filter", "@realty/worker", "start"]
