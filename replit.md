# Golf Side Bets

Golf Side Bets helps golf groups track Wolf, Snake, Dots, and Nassau wagers hole by hole and settle the round without manual math. Any subset of the four games can be selected per round.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` plus the managed Gemini AI integration variables for scorecard extraction

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/golf-side-bets/src/App.tsx` — dashboard, round setup, scorecard (with Score/Wolf/Snake/Dots sub-tabs), and ledger UI
- `artifacts/golf-side-bets/src/pages/Courses.tsx` — reusable course library, external-search status, and editable scorecard-import review
- `artifacts/golf-side-bets/src/index.css` — shared clubhouse visual theme and responsive styles
- `artifacts/api-server/src/lib/golf-rules.ts` — pure rules engine: net-score Wolf, putt-based Snake, auto+manual Dots, Nassau, and gross pairwise settlement/payout math
- `artifacts/api-server/src/routes/rounds.ts` — round, hole, dashboard, and settlement API handlers (calls into golf-rules.ts)
- `lib/api-spec/openapi.yaml` — API contract source of truth
- `lib/db/src/schema/rounds.ts` — PostgreSQL schema for rounds and hole results
- `lib/db/src/schema/courses.ts` — saved 18-hole course layouts and import-source metadata

## Architecture decisions

- Round players and game types are stored as JSONB so rounds can mix any subset of Wolf/Snake/Dots/Nassau without over-modeling rules.
- Settlement is calculated server-side (`golf-rules.ts`) from recorded strokes/putts/manual flags, stake, and selected games; clients only render the returned balances, payouts, and point totals.
- Wolf/Snake/Dots contribute "points" per player (converted to dollars via `dollarPerPoint`, which defaults to the round's `stake`); Nassau contributes dollars directly. Each player's raw total (points-as-dollars + Nassau dollars) is never pre-netted or mean-centered.
- Settlement is a gross pairwise model: every unique pair of players settles head-to-head — whoever has the smaller total owes the other the exact gap — rather than simplifying into a minimal "who owes whom" set. A player's displayed balance is just their net position summed across all of those pairwise payouts, so it always reconciles with the payout list exactly.
- Wolf uses a gross-wins model: only the winning side banks `wolfUnit × losing-team-size × carry`; the losing side gets 0 (never negative). Pushes accumulate a carry-over multiplier applied to the next decisive hole.
- Snake tie-breaks allow the host to select the holder when multiple players tie.
- Saved course layouts are copied into round JSONB fields at round creation; later course edits never change historical rounds.
- Scorecard images/PDFs are validated and analyzed transiently into editable drafts; uploaded file bytes are not retained.
- The app uses the shared API server and generated React Query hooks so saved rounds survive reloads and navigation.

## Product

- Dashboard with round history, active-round progress, and holes recorded
- New round setup for a saved or custom course, date, stake, game types (any combination of Wolf/Snake/Dots/Nassau), and 2–6 players with handicaps
- Reusable course library with 18-hole par/handicap validation, manual CRUD, and editable image/PDF scorecard imports
- Live hole-by-hole scorecard with Score/Wolf/Snake/Dots sub-tabs: strokes+putts entry, Wolf partner picking and manual override/result, Snake holder display, and Dots toggles (Greenie/Sandy/Poley) plus auto Birdie/Eagle/3-putt
- Running ledger with net balances, a simplified "who pays whom" payout list, a per-player point breakdown by game, round completion, reopening, editing, and deletion

## User preferences

No additional preferences recorded.

## Gotchas

- Regenerate the API client after every OpenAPI change with `pnpm --filter @workspace/api-spec run codegen`.
- The app expects the managed artifact workflow to provide `PORT` and `BASE_PATH`; do not run the Vite command directly for preview routing.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
