# Factory

Self-hosted software factory. Issues in, agents out, learning after merge.

```bash
cp .env.example .env
docker compose up --build
```

Open http://localhost:3000 (password from `ADMIN_PASSWORD`).

## Local dev

```bash
docker compose up postgres temporal temporal-ui -d
npm install
npm run db:migrate
npm run dev
```

UI with HMR: http://localhost:5173 (proxies `/api` to `:3000`). Password from `ADMIN_PASSWORD`.

## Dogfood

1. Create a project pointed at this repo
2. Add a GitHub source with label `factory`
3. Set Cursor API key
4. Label an issue `factory`
