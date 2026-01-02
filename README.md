# Presale Tracker

A production-ready presale tracker that indexes USDC transfers into a sale recipient and serves a minimal dashboard with velocity metrics and charts.

## Stack
- Next.js 14 (App Router) + TypeScript
- Tailwind CSS
- PostgreSQL + Prisma ORM
- Ethers v6 log indexing

## Local setup
1) Start Postgres (Docker is easiest):
   ```bash
   docker compose up -d
   ```
2) Copy env file and set values:
   ```bash
   copy .env.example .env
   ```
   Update `DATABASE_URL` and `RPC_URL`. You can leave `RECIPIENT_ADDRESS` as the placeholder until you have it.
3) Install dependencies:
   ```bash
   npm install
   ```
4) Create tables and seed the default sale:
   ```bash
   npm run db:push
   npm run seed
   ```
5) Run the indexer (cron-friendly):
   ```bash
   npm run indexer
   ```
6) Start the app:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000/sale/infinex-inx`.

## Adding more sales
- Insert new `Sale` rows in the database (or run the seed with a different `SALE_SLUG`).
- Run the indexer with `npm run indexer -- --slug=your-slug` or `npm run indexer -- --all`.

## Cron example
Run every 2 minutes:
```bash
*/2 * * * * cd /path/to/presale-tracker && npm run indexer
```

## Scripts
- `npm run dev` - start Next.js dev server
- `npm run db:push` - sync Prisma schema to Postgres
- `npm run db:studio` - open Prisma Studio
- `npm run seed` - seed default sale
- `npm run indexer` - run indexer once
- `npm run indexer:watch` - run indexer in a loop every 2 minutes

## Notes
- The indexer only counts transfers within `[SALE_START_TS, SALE_END_TS]`.
- Use `RECIPIENT_ADDRESS=0x0000000000000000000000000000000000000000` until you know the real recipient address.
