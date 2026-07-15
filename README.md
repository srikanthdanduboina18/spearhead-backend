# Spearhead EB Platform — Backend API

Node.js + Express + PostgreSQL (via Prisma) backend implementing the workflows from
`Spearhead_EB_Platform_Design.md` — client/HR-hierarchy masters, magic-link auth,
pre-enrollment with dependents, policy issuance, and monthly payroll sync.

## Setup

```bash
npm install
cp .env.example .env        # then fill in DATABASE_URL, JWT_SECRET, SMTP_* (or leave SMTP blank to log to console)
npx prisma migrate dev --name init
npm run dev                 # starts on http://localhost:4000
```

Requires a running PostgreSQL instance. For local dev, the quickest option is:
```bash
docker run --name spearhead-pg -e POSTGRES_PASSWORD=password -e POSTGRES_DB=spearhead_eb -p 5432:5432 -d postgres:16
```

## How auth works

There's no stored password for HR or Employee users. `POST /auth/request-link` with an
email sends a single-use, 15-minute link; `GET /auth/verify?token=...` consumes it and
sets an httpOnly session cookie. Every protected route re-checks the role and client
scope server-side via `requireAuth` / `requireRole` / `requireClientScope` — the API
never trusts the frontend to hide a button.

Super Admin accounts aren't modeled here (kept out for brevity) — in practice, add a
small `AdminUser` table with a real password + TOTP MFA, since that role has
cross-client access.

## Route map

| Method & path | Who | What |
|---|---|---|
| `POST /auth/request-link` | anyone | Email a magic login link |
| `GET /auth/verify` | anyone with a valid token | Exchange token for a session |
| `POST /clients` | Super Admin | Create a client |
| `GET /clients/:id` | scoped | Client detail |
| `POST /clients/:id/hierarchy` | Admin/Servicing/top HR | Add an HR node, mails them a login link |
| `POST /clients/:id/employees` | Admin/Servicing/HR | Add to census, mails a pre-enrollment link |
| `PATCH /clients/:id/employees/:empId/status` | Admin/Servicing/HR | e.g. mark Removed |
| `GET /enrollment/:token` | public (token-based) | Fetch employee + applicable policy types |
| `POST /enrollment/:token` | public (token-based) | Submit enrollment (+ dependents if Health) |
| `POST /clients/:id/policies` | Admin/Servicing | Create a policy record |
| `POST /clients/:id/policies/:polId/issue` | Admin/Servicing | Assign policy number, activates SUBMITTED members |
| `POST /clients/:id/payroll/sync` | Admin/Servicing/HR | Dry-run diff of active codes vs. system |
| `POST /clients/:id/payroll/confirm` | Admin/Servicing/HR | Applies removals, records the batch, mails HR |

## What's intentionally left out (Phase 2+, per the design doc)

- Claims module (intimation, document upload, status tracking)
- TPA/insurer API adapters — currently no integration layer; payroll sync is manual paste/diff
- File storage (S3) for claim documents and e-cards
- Super Admin account table + MFA
- Hospital locator

## Wiring up the prototype UI

The `spearhead_eb_platform.jsx` prototype currently uses `window.storage`. To point it
at this API: replace `loadDB()`/`saveDB()` calls with `fetch()` calls to the routes
above, and swap the role-switcher dropdown for the real magic-link flow
(`POST /auth/request-link` → email → `GET /auth/verify` sets the cookie automatically
on subsequent `fetch` calls when `credentials: 'include'` is set).
