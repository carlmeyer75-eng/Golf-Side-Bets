# Golf Side Bets

Golf Side Bets helps golf groups track Wolf and Nassau wagers hole by hole and settle the round without manual math.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/golf-side-bets/src/App.tsx` — dashboard, round setup, scorecard, and settlement UI
- `artifacts/golf-side-bets/src/index.css` — shared clubhouse visual theme and responsive styles
- `artifacts/api-server/src/routes/rounds.ts` — round, hole, dashboard, and settlement API handlers
- `lib/api-spec/openapi.yaml` — API contract source of truth
- `lib/db/src/schema/rounds.ts` — PostgreSQL schema for rounds and hole results

## Architecture decisions

- Round players and game types are stored as JSONB so the first version can support both Wolf and Nassau without over-modeling rules.
- Settlement is calculated server-side from recorded hole winners, stake, and selected games; clients only render the returned balances.
- The app uses the shared API server and generated React Query hooks so saved rounds survive reloads and navigation.

## Product

- Dashboard with round history, active-round progress, and holes recorded
- New round setup for course, date, stake, game types, and 2–4 players
- Live hole-by-hole scorecard with Wolf/winner selection
- Running settlement balances, total pot, round completion, reopening, editing, and deletion

## User preferences

No additional preferences recorded.

## Gotchas

- Regenerate the API client after every OpenAPI change with `pnpm --filter @workspace/api-spec run codegen`.
- The app expects the managed artifact workflow to provide `PORT` and `BASE_PATH`; do not run the Vite command directly for preview routing.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
