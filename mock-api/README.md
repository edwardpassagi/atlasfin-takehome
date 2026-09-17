# Mock credit line API

No dependencies. No install step.

```bash
npm start          # or: node server.js
```

Listens on **http://localhost:4010**. State is in memory and resets on restart.

## Eligibility

Every member has a **maximum eligible limit**, fixed for the experiment and returned
as `max_eligible_limit_cents`. Their remaining room is
`max_eligible_limit_cents - limit_cents`; derive it.

A request is **approved** when it would land at or under that ceiling, and **declined**
when it would overshoot. Some members have no room at all, and no amount they can ask
for will be approved.

The API will happily accept an ask that is doomed. Whether a member is ever put in that
position is the app's decision.

## Personas

Send `X-Test-Persona: <name>` on any request to pick the member you're logged in as.
Defaults to `approved`.

| Persona | Limit | Eligible up to | Room | A submit returns |
|---|---|---|---|---|
| `approved` | $2,500 | $5,000 | $2,500 | `APPROVED` at any valid amount |
| `utilization-too-high` | $1,000 | $1,800 | $800 | `APPROVED` up to $800, else `DECLINED`, `UTILIZATION_TOO_HIGH` |
| `new-credit-lines` | $500 | $1,000 | $500 | `APPROVED` up to $500, else `DECLINED`, `NEW_CREDIT_LINES` |
| `insufficient-history` | $1,500 | $1,500 | none | `DECLINED`, `INSUFFICIENT_PAYMENT_HISTORY`, whatever they ask |

Balances, holds, and months on book vary per persona too. `approved` has 19 months on
book, `utilization-too-high` 22, `insufficient-history` 5, `new-credit-lines` 2.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/v1/credit-line` | Limit, maximum eligible limit, balance, pending holds, member, and `increase_request` (null until they request) |
| `POST` | `/v1/credit-line/increase-requests` | Submit. Body: `{ "requested_amount_cents": 25000 }` — the **increase**, not the target limit |
| `GET` | `/health` | Liveness and the persona list |

**A member can request once.** After that, `increase_request` on `/v1/credit-line`
carries the decision, and further submits return `409 ALREADY_REQUESTED`. The app
should not offer the request button to a member who has already requested.

**An approved increase is live immediately.** After approval, `limit_cents` on
`/v1/credit-line` reflects the new limit.

Amounts: $100 to $2,500 in $50 steps, or `422 AMOUNT_INVALID`. These are the bounds of
the endpoint, not of the member — an amount inside them can still be declined for
overshooting that member's ceiling, and that comes back as a `201` decision with reason
codes rather than a validation error.

## Reason codes

Compliance requires that a declined member is told the specific reasons. Use wording
similar to below.

| Code | Copy |
|---|---|
| `UTILIZATION_TOO_HIGH` | Credit file shows high utilization on this card and / or other cards as of late. |
| `INSUFFICIENT_PAYMENT_HISTORY` | We need to see a longer run of on-time payments first. |
| `NEW_CREDIT_LINES` | We've noticed a multitude of new credit lines you've opened. |

## Smoke test

With the server running:

```bash
./smoke.sh
```
