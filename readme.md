# Credit line increase take-home

- **Timebox:** Two hours
- **Tools:** Anything
- **Framework:** Pick either the Flutter base app (`flutter_app/`) or the React
  Native base app (`react_native_app/`)

## Context

Atlas serves people traditional banks often overlook. Members pay monthly for a
spending account, a card, and a credit line.

A higher limit can give someone more room to manage their money. A confusing or
dismissive experience can add stress when they need clarity. Treat this work with care.

## The experiment

For the last few weeks, some new members have been able to request a credit limit
increase in the app. The control group never sees an Increase button, and neither do
they actually get an increase.

When a member requests an increase, Atlas performs a soft inquiry. This does not hurt
their credit score.

The treatment experience is in `flutter_app/` or `react_native_app/`:

1. **Your credit line**
2. **Request an increase**, including an amount slider
3. **Decision**

It runs against `mock-api/`:

```bash
cd mock-api && npm start
```

Then, from `flutter_app/`:

```bash
flutter run
```

Or, from `react_native_app/`:

```bash
npm install
npm run web
```

You can also use `npm run ios` or `npm run android`.

The persona control on Home switches between the four outcomes the server can return.
See `mock-api/README.md` for details.

## The data

The experiment data is in `data/`. Join the two CSV files on `user_id`.

- Maximum eligible and initial limit is calculated once when the user joins and not
  re-evaluated after join. Maximum eligible limit should remain fixed in any proposal
  of yours.
- Assignment was randomized at signup with an approximately 50/50 split.
- Members joined from early June onward; snapshot taken 2026-08-25.

### `users.csv`: one row per member in the experiment window

| Column | Meaning |
|---|---|
| `user_id` | Identifier. Joins to `requests.csv` |
| `joined_ts` | The day they paid their first membership |
| `experiment_group` | `treatment` (could request an increase) or `control` |
| `account_closed_ts` | The day they closed their account. Blank if still open at the snapshot |
| `starting_limit_cents` | The member's credit limit when they joined |
| `max_eligible_limit_cents` | The member's maximum eligible limit at signup. Fixed for the experiment |

### `requests.csv`: one row per increase request

| Column | Meaning |
|---|---|
| `user_id` | Who asked |
| `decision` | `APPROVED` or `DECLINED` |
| `decline_reason` | Set on declines: `UTILIZATION_TOO_HIGH`, `INSUFFICIENT_PAYMENT_HISTORY`, or `NEW_CREDIT_LINES` |
| `requested_limit_cents` | The total credit limit the member requested, not the amount of the increase |
| `requested_ts` | When the member submitted the request |

## Deliverables

- A one-page `DECISIONS.pdf` covering:
  - your ship or no-ship decision (or something else) and the evidence and reasoning
    behind it
  - what the next experiment(s) you'd run would be
- Fully working UX and designs for your proposed next experiment's experiment groups
- Your full AI transcript, if you used AI tools

Prioritize by what's most impactful for improving member retention %.

## Constraints

- Two hours
- No authentication work

Make the right decisions and choose the scope correctly to finish well within the
timebox.

## Evaluation

| Weight | Axis |
|---:|---|
| **25%** | Reading the data |
| **35%** | Prioritization |
| **40%** | User experience |

## Follow-up

We will spend 30 minutes together extending what you built and discussing one decision
in depth.
