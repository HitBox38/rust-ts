// Project state, so any fresh agent can orient in seconds.
//   docs/state/current.json   latest snapshot (milestone, protected sets, coverage)
//   docs/state/history.jsonl  append-only log; never edit committed lines
//
//   bun scripts/state.ts summary
//   bun scripts/state.ts record <kind> <message...>     kinds: note | decision | accept | milestone | stop
//   bun scripts/state.ts history [--last N]
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO, parseArgs } from "./lib/common.ts";

const DIR = join(REPO, "docs", "state");
const CURRENT = join(DIR, "current.json");
const HISTORY = join(DIR, "history.jsonl");

interface Current {
  milestone: string;
  pin: string;
  protected: Record<string, number>;
  coverage?: { ported: number; total: number };
  updated: string;
  open_stops: string[];
}

function load(): Current {
  return existsSync(CURRENT)
    ? JSON.parse(readFileSync(CURRENT, "utf8"))
    : { milestone: "M0", pin: PIN.commit, protected: {}, updated: "", open_stops: [] };
}

function refresh(cur: Current): Current {
  const base = join(REPO, "harness", "baseline");
  cur.protected = {};
  if (existsSync(base)) {
    for (const f of readdirSync(base).filter((f) => f.endsWith(".txt"))) {
      cur.protected[f.slice(0, -4)] = readFileSync(join(base, f), "utf8").split("\n").filter(Boolean).length;
    }
  }
  const cov = join(DATA, "coverage.json");
  if (existsSync(cov)) {
    const c = JSON.parse(readFileSync(cov, "utf8"));
    cur.coverage = { ported: c.ported, total: c.total };
  }
  cur.pin = PIN.commit;
  cur.updated = new Date().toISOString();
  return cur;
}

export function record(kind: string, msg: string, data?: unknown): void {
  const cur = refresh(load());
  if (kind === "milestone") cur.milestone = msg.split(/\s/)[0]!;
  if (kind === "stop") cur.open_stops.push(msg);
  if (kind === "unstop") cur.open_stops = cur.open_stops.filter((s) => !s.startsWith(msg));
  writeFileSync(CURRENT, JSON.stringify(cur, null, 2) + "\n");
  appendFileSync(HISTORY, JSON.stringify({ ts: new Date().toISOString(), kind, msg, ...(data ? { data } : {}) }) + "\n");
}

if (import.meta.main) {
  const a = parseArgs(process.argv.slice(2));
  const [cmd, kind, ...rest] = a._;
  if (cmd === "summary") {
    const cur = load();
    console.log(`milestone: ${cur.milestone}   pin: ${cur.pin.slice(0, 12)} (${PIN.release})   updated: ${cur.updated}`);
    for (const [s, n] of Object.entries(cur.protected)) console.log(`protected ${s}: ${n}`);
    if (cur.coverage) console.log(`coverage: ${cur.coverage.ported}/${cur.coverage.total} fns`);
    console.log(cur.open_stops.length ? `OPEN STOPS:\n  ${cur.open_stops.join("\n  ")}` : "open stops: none");
    const hist = existsSync(HISTORY) ? readFileSync(HISTORY, "utf8").trim().split("\n").filter(Boolean) : [];
    for (const l of hist.slice(-5)) {
      const h = JSON.parse(l);
      console.log(`  ${h.ts.slice(0, 16)} [${h.kind}] ${h.msg}`);
    }
  } else if (cmd === "record" && kind && rest.length) {
    record(kind, rest.join(" "));
    console.log("recorded");
  } else if (cmd === "history") {
    const n = typeof a.last === "string" ? Number(a.last) : 20;
    const hist = existsSync(HISTORY) ? readFileSync(HISTORY, "utf8").trim().split("\n").filter(Boolean) : [];
    for (const l of hist.slice(-n)) console.log(l);
  } else {
    console.log("usage: bun scripts/state.ts summary | record <kind> <msg...> | history [--last N]");
  }
}
