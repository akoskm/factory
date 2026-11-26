FROM node:22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends git curl ca-certificates \
  && curl -fsSL https://claude.ai/install.sh | bash \
  && curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path \
  && ln -sf /root/.opencode/bin/opencode /usr/local/bin/opencode \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build:web

ENV WORKSPACES_DIR=/var/lib/factory/workspaces
ENV FACTORY_CONFIG_DIR=/var/lib/factory/config
ENV PORT=3000

EXPOSE 3000

CMD ["sh", "-c", "npx tsx src/db/migrate.ts && npx tsx src/index.ts"]
