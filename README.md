# @atlas/risk — Risk & Disputes Service

Risk engine, fraud signals, dispute management, evidence handling, and representment for the AtlasPayments platform.

## Domains

### Risk Engine

- **Risk Signals** — Ingest and query fraud/risk signals attached to any entity (customer, payment, etc.)
- **Risk Rulesets** — Configure named rulesets with versioning and activation controls
- **Risk Rules** — Individual rules within rulesets defining conditions, actions, and priority ordering
- **Risk Decisions** — Record and query risk evaluation outcomes with optional manual override
- **Risk Lists** — Manage blocklists and allowlists with typed entries and expiration

### Disputes

- **Disputes** — Full lifecycle management (needs_response → under_review → won/lost/accepted/expired)
- **Dispute Evidence** — Attach, list, retrieve, delete, and bulk-submit evidence for disputes
- **Representment** — Create and submit representment packages for disputes under review

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/risk/signals` | Create risk signal |
| GET | `/api/v1/risk/signals` | List risk signals |
| GET | `/api/v1/risk/signals/:id` | Get risk signal |
| POST | `/api/v1/risk/decisions` | Create risk decision |
| GET | `/api/v1/risk/decisions` | List risk decisions |
| GET | `/api/v1/risk/decisions/:id` | Get risk decision |
| PATCH | `/api/v1/risk/decisions/:id` | Override risk decision |
| POST | `/api/v1/risk/rulesets` | Create ruleset |
| GET | `/api/v1/risk/rulesets` | List rulesets |
| GET | `/api/v1/risk/rulesets/:id` | Get ruleset |
| PATCH | `/api/v1/risk/rulesets/:id` | Update ruleset |
| DELETE | `/api/v1/risk/rulesets/:id` | Delete ruleset |
| POST | `/api/v1/risk/rulesets/:id/rules` | Add rule to ruleset |
| GET | `/api/v1/risk/rulesets/:id/rules` | List rules in ruleset |
| GET | `/api/v1/risk/rulesets/:id/rules/:ruleId` | Get rule |
| PATCH | `/api/v1/risk/rulesets/:id/rules/:ruleId` | Update rule |
| DELETE | `/api/v1/risk/rulesets/:id/rules/:ruleId` | Delete rule |
| POST | `/api/v1/risk/lists` | Create risk list |
| GET | `/api/v1/risk/lists` | List risk lists |
| GET | `/api/v1/risk/lists/:id` | Get risk list |
| PATCH | `/api/v1/risk/lists/:id` | Update risk list |
| DELETE | `/api/v1/risk/lists/:id` | Delete risk list |
| POST | `/api/v1/risk/lists/:id/entries` | Add entry to list |
| GET | `/api/v1/risk/lists/:id/entries` | List entries |
| GET | `/api/v1/risk/lists/:id/entries/:entryId` | Get entry |
| DELETE | `/api/v1/risk/lists/:id/entries/:entryId` | Delete entry |
| POST | `/api/v1/disputes` | Create dispute |
| GET | `/api/v1/disputes` | List disputes |
| GET | `/api/v1/disputes/:id` | Get dispute |
| PATCH | `/api/v1/disputes/:id` | Update dispute |
| POST | `/api/v1/disputes/:id/accept` | Accept dispute |
| POST | `/api/v1/disputes/:id/evidence` | Add evidence |
| GET | `/api/v1/disputes/:id/evidence` | List evidence |
| GET | `/api/v1/disputes/:id/evidence/:evidenceId` | Get evidence |
| DELETE | `/api/v1/disputes/:id/evidence/:evidenceId` | Delete evidence |
| POST | `/api/v1/disputes/:id/evidence/submit` | Submit all evidence |
| POST | `/api/v1/disputes/:id/representment` | Create representment |
| GET | `/api/v1/disputes/:id/representment` | Get representment |
| POST | `/api/v1/disputes/:id/representment/submit` | Submit representment |
| GET | `/api/health` | Health check |

## Setup

```bash
# Install dependencies
pnpm install

# Generate Prisma client
pnpm prisma:generate

# Run migrations
pnpm prisma:migrate:dev

# Start development server (port 3003)
pnpm dev
```

## Port

This service runs on **port 3003**.

## Stack

- Next.js App Router (route handlers)
- Prisma (PostgreSQL)
- Zod (request validation)
- Upstash Redis (rate limits, idempotency cache)
