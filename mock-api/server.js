#!/usr/bin/env node
/**
 * Atlas take-home - mock credit line API.
 * Zero dependencies. Node 18+.   Run:  npm start   (or: node server.js)
 *
 * Every member has a maximum eligible limit, fixed for the experiment. A
 * request is approved when it would land at or under that ceiling and
 * declined when it would overshoot. Some members have no room at all.
 *
 * A member can request once; after that the account carries the request and
 * further submits are rejected. State is in memory and resets on restart.
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = process.env.PORT ? Number(process.env.PORT) : 4010;

// Pick one with the X-Test-Persona header. Defaults to "approved".
//
// `max_eligible_limit_cents` is the member's ceiling. Their remaining room is
// max_eligible_limit_cents - limit_cents; a persona with no room cannot be
// approved for any amount. `decline_reason` is the code this member receives
// if they are declined.
const PERSONAS = {
  approved: {
    first_name: "Dana",
    limit_cents: 250000,
    max_eligible_limit_cents: 500000, // $2,500 of room: the whole slider
    balance_cents: 78000,
    pending_holds_cents: 6550,
    months_on_book: 19,
    decline_reason: "UTILIZATION_TOO_HIGH", // unreachable at the current bounds
  },
  "utilization-too-high": {
    first_name: "Priya",
    limit_cents: 100000,
    max_eligible_limit_cents: 180000, // $800 of room
    balance_cents: 90400,
    pending_holds_cents: 3800,
    months_on_book: 22,
    decline_reason: "UTILIZATION_TOO_HIGH",
  },
  "new-credit-lines": {
    first_name: "Marcus",
    limit_cents: 50000,
    max_eligible_limit_cents: 100000, // $500 of room
    balance_cents: 11800,
    pending_holds_cents: 0,
    months_on_book: 2,
    decline_reason: "NEW_CREDIT_LINES",
  },
  "insufficient-history": {
    first_name: "Sam",
    limit_cents: 150000,
    max_eligible_limit_cents: 150000, // no room at all
    balance_cents: 31000,
    pending_holds_cents: 1200,
    months_on_book: 5,
    decline_reason: "INSUFFICIENT_PAYMENT_HISTORY",
  },
};

const MIN_CENTS = 10000, MAX_CENTS = 250000, STEP_CENTS = 5000;

const requestsByPersona = new Map(); // persona -> request record

const json = (res, code, body) => {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,x-test-persona",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
};
const err = (res, code, error, message, extra = {}) =>
  json(res, code, { error, message, ...extra });

const readBody = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try { resolve(b ? JSON.parse(b) : {}); } catch { resolve(null); }
    });
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const name = (req.headers["x-test-persona"] || "approved").toString();
  const p = PERSONAS[name] || PERSONAS.approved;
  const key = PERSONAS[name] ? name : "approved";

  if (req.method === "OPTIONS") return json(res, 204, {});

  // The account. Deliberately does NOT include available credit or the
  // member's remaining room; both are derivable from what is here.
  // increase_request is null until the member has requested.
  if (req.method === "GET" && path === "/v1/credit-line") {
    // An approved increase is live immediately: the credit line reflects it.
    const prior = requestsByPersona.get(key);
    const limit = prior && prior.status === "APPROVED" ? prior.new_limit_cents : p.limit_cents;
    return json(res, 200, {
      account_id: "acct_8f21c0",
      currency: "USD",
      limit_cents: limit,
      max_eligible_limit_cents: p.max_eligible_limit_cents,
      balance_cents: p.balance_cents,
      pending_holds_cents: p.pending_holds_cents,
      member: {
        first_name: p.first_name,
        months_on_book: p.months_on_book,
        ssn_last4: "4417",
        dob: "1994-03-02",
      },
      increase_request: requestsByPersona.get(key) || null,
    });
  }

  if (req.method === "POST" && path === "/v1/credit-line/increase-requests") {
    const body = await readBody(req);
    if (body === null) return err(res, 400, "MALFORMED_JSON", "Request body was not valid JSON.");
    if (requestsByPersona.has(key)) {
      return err(res, 409, "ALREADY_REQUESTED",
        "This member has already requested an increase.",
        { increase_request: requestsByPersona.get(key) });
    }
    const amount = body.requested_amount_cents;
    if (!Number.isInteger(amount)) {
      return err(res, 400, "INVALID_AMOUNT", "requested_amount_cents must be an integer number of cents.");
    }
    if (amount < MIN_CENTS || amount > MAX_CENTS || amount % STEP_CENTS !== 0) {
      return err(res, 422, "AMOUNT_INVALID",
        "Amount must be $100 to $2,500 in $50 steps.",
        { min_amount_cents: MIN_CENTS, max_amount_cents: MAX_CENTS, step_cents: STEP_CENTS });
    }
    // Overshooting the ceiling is a decision, not a validation error: the
    // member has to be told the specific reason. The app is what decides
    // whether they are ever put in a position to overshoot.
    const wouldBe = p.limit_cents + amount;
    const approved = wouldBe <= p.max_eligible_limit_cents;
    const rec = {
      request_id: `clr_${randomUUID().slice(0, 12)}`,
      requested_amount_cents: amount,
      status: approved ? "APPROVED" : "DECLINED",
      reason_codes: approved ? [] : [p.decline_reason],
      approved_amount_cents: approved ? amount : 0,
      new_limit_cents: approved ? wouldBe : p.limit_cents,
      created_at: new Date().toISOString(),
    };
    requestsByPersona.set(key, rec);
    return json(res, 201, rec);
  }

  if (path === "/" || path === "/health") {
    return json(res, 200, { ok: true, personas: Object.keys(PERSONAS), port: PORT });
  }
  return err(res, 404, "NOT_FOUND", `No route for ${req.method} ${path}`);
});

server.listen(PORT, () => {
  console.log(`\n  Atlas take-home mock API on http://localhost:${PORT}`);
  console.log(`  Personas: ${Object.keys(PERSONAS).join(", ")}`);
  console.log(`  Send one with the X-Test-Persona header. Defaults to "approved".\n`);
});
