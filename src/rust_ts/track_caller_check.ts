// rust-ts tool (not an upstream mirror, not a gate step; docs/reviews/plan-ice-report.md D11): reports how far
// src/rust_ts/track_caller.ts can be trusted.
//
//   bun src/rust_ts/track_caller_check.ts [--oracle <n>]
//
// Static part, over every marked fn of the port:
//  - every call of the callee families in D4 goes through `map_call`, the resolver's own mapping: how many map, why
//    the others refuse, and every **proven swap** (the TS call's key is at another index upstream): a port bug, fixed
//    by restoring upstream's order;
//  - every `// rustc-call:` anchor and `// rustc-const:` marker must name upstream code (coverage.ts --check does not
//    know them yet: see docs/handoff/ice-report-impl.md);
//  - mapped locations absent from the oracle binary's `Location` constants are reported, never an error: absence
//    only means "not witnessed", and presence does not prove the mapping either (review F3);
//  - how many of the locations the oracle prints in the ICE corpus D4 refuses.
// `--oracle <n>` compares what the oracle itself prints under `-Ztrack-diagnostics` on a deterministic sample of
// `tests/ui` files with a `.stderr`, with tail calls off so that refusals do not hide locations.
//
// Details go to `$RUST_TS_DATA/tmp/track-caller-check/`; a few summary lines go to stdout.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { is_track_caller_owner, map_call, ts_file, type Owner, type TsFile, up_file, type UpFile } from "./track_caller.ts";

const SRC_ROOT = resolve(import.meta.dir, "..");
const DATA = resolve(process.env.RUST_TS_DATA ?? join(SRC_ROOT, "..", ".data"));
const OUT = join(DATA, "tmp", "track-caller-check");

/** D4's callee families: the message-carrying ones and the struct-carrying ones. */
const FAMILIES: readonly string[] = [
  "bug",
  "span_bug",
  "fail",
  "emit_err",
  "create_err",
  "emit_warn",
  "create_warn",
  "emit_fatal",
  "create_fatal",
  "emit_note",
  "create_note",
  "emit_help",
  "create_bug",
  "emit_bug",
  "emit_node_span_lint",
];

function ts_sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!/(_oracle|_test|^oracle|^fixtures|^vendor)$/.test(e.name)) ts_sources(p, out);
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

interface Site {
  file: string;
  line: number;
  owner: Owner;
  callee: string;
  result: string; // "mapped-single" | "mapped-key" | "mapped-anchor" | "swap" | refusal class
  detail: string;
  location?: string;
}

function classify_refusal(why: string): string {
  if (why.includes("macro_rules")) return "refused: macro_rules";
  if (why.includes("called")) return "refused: count mismatch";
  if (why.includes("no key")) return "refused: no key";
  if (why.includes("not unique")) return "refused: key not unique";
  if (why.includes("key ")) return "refused: key differs";
  if (why.includes("no body")) return "refused: no upstream body";
  if (why.includes("cannot read")) return "refused: no upstream file";
  return "refused: other";
}

function check_site(ts: TsFile, file: string, owner: Owner, callee: string, line: number, col: number): Site {
  const m = map_call(ts, owner, callee, false, line, col);
  const rel = file.slice(SRC_ROOT.length + 1);
  if (!m.ok) {
    let result = classify_refusal(m.why);
    let detail = m.why;
    if (result === "refused: key differs") {
      const up = up_file(owner.path)!;
      const body = up.owner_body(owner)!;
      const ts_key = ts.call_key(line, col, callee);
      const at = up.calls_in(body, callee).findIndex((c) => up.call_key(c, callee) === ts_key);
      if (at >= 0) {
        result = "swap";
        detail = `${m.why}; the TS key is call #${at} upstream`;
      }
    }
    return { file: rel, line, owner, callee, result, detail };
  }
  const [l, c0] = m.up.line_col(m.call.pos);
  const single = m.up.calls_in(m.body, callee).length === 1;
  return {
    file: rel,
    line,
    owner,
    callee,
    result: m.anchored ? "mapped-anchor" : single ? "mapped-single" : "mapped-key",
    detail: "",
    location: `${owner.path}:${l}:${c0 + 1}`,
  };
}

/** Anchors and `rustc-const:` markers must name upstream code. */
function check_anchors(ts: TsFile, file: string, bad: string[]): number {
  let n = 0;
  const rel = file.slice(SRC_ROOT.length + 1);
  ts.lines.forEach((l, i) => {
    const a = /^\s*\/\/ rustc-call: (\d+):(\d+)\s*$/.exec(l);
    if (a !== null) {
      n++;
      const owner = ts.owner_at(i + 2);
      if (owner === undefined) bad.push(`${rel}:${i + 1}: rustc-call outside any marked fn`);
      else {
        const up = up_file(owner.path);
        const at = up?.lines[Number(a[1]) - 1];
        const rest = at?.slice(Number(a[2]) - 1) ?? "";
        if (!/^[\w:]/.test(rest)) bad.push(`${rel}:${i + 1}: rustc-call ${a[1]}:${a[2]} names nothing at ${owner.path}`);
      }
    }
    const c = /^\s*\/\/ rustc-const: (compiler\/\S+):(\d+) (\w+)\s*$/.exec(l);
    if (c !== null) {
      n++;
      const at = up_file(c[1]!)?.lines[Number(c[2]) - 1] ?? "";
      if (!new RegExp(`\\bconst\\s+${c[3]}\\b`).test(at)) bad.push(`${rel}:${i + 1}: rustc-const names no const ${c[3]} at ${c[1]}:${c[2]}`);
    }
  });
  return n;
}

function static_check(): { sites: Site[]; byOwner: Map<string, { ts: TsFile; file: string; owner: Owner }[]> } {
  const sites: Site[] = [];
  const bad_anchors: string[] = [];
  const byOwner = new Map<string, { ts: TsFile; file: string; owner: Owner }[]>();
  let anchors = 0;
  for (const file of ts_sources(SRC_ROOT)) {
    if (file.includes("/rust_ts/track_caller")) continue;
    const ts = ts_file(file);
    anchors += check_anchors(ts, file, bad_anchors);
    for (const owner of ts.owners) {
      if (owner.kind !== "fn") continue;
      let list = byOwner.get(owner.path);
      if (list === undefined) byOwner.set(owner.path, (list = []));
      list.push({ ts, file, owner });
      for (const callee of FAMILIES) {
        for (const [line, col] of ts.calls_in(owner, callee, false)) sites.push(check_site(ts, file, owner, callee, line, col));
      }
    }
  }
  // Not only D4's families: the resolver accepts every tracked name and the panic entries, and a call that maps into an item
  // nested upstream is where a count can agree by coincidence (review ice-report-impl F1).
  const into_nested: string[] = [];
  for (const { ts, file, owner } of [...byOwner.values()].flat()) {
    for (const callee of [...FAMILIES, ...PANIC_ENTRIES]) {
      for (const [line, col] of ts.calls_in(owner, callee, false)) {
        const m = map_call(ts, owner, callee, false, line, col);
        if (m.ok && !m.anchored && m.up.in_nested_item(m.body, m.call.pos)) into_nested.push(`${file.slice(SRC_ROOT.length + 1)}:${line} ${callee}`);
      }
    }
  }
  console.log(`calls mapped into a nested upstream item, each in a nested function of its TS owner: ${into_nested.length}`);
  writeFileSync(join(OUT, "into-nested.txt"), `${into_nested.join("\n")}\n`);
  const counts = new Map<string, number>();
  for (const s of sites) counts.set(s.result, (counts.get(s.result) ?? 0) + 1);
  console.log(`sites ${sites.length}; ${[...counts].sort().map(([k, v]) => `${k} ${v}`).join("; ")}`);
  const swaps = sites.filter((s) => s.result === "swap");
  console.log(`proven swaps: ${swaps.length} in ${new Set(swaps.map((s) => `${s.owner.path}:${s.owner.line}`)).size} fns`);
  for (const s of swaps) console.log(`  ERROR: swap ${s.file}:${s.line} ${s.detail.slice(0, 160)}`);
  console.log(`anchors and const markers: ${anchors}, ${bad_anchors.length} bad`);
  for (const b of bad_anchors) console.log(`  ERROR: ${b}`);
  writeFileSync(
    join(OUT, "sites.txt"),
    sites.map((s) => `${s.result}\t${s.callee}\t${s.file}:${s.line}\t${s.owner.path}:${s.owner.line}\t${s.location ?? ""}\t${s.detail}`).join("\n") + "\n",
  );
  return { sites, byOwner };
}

/** TS names of the panic machinery's entry points (std/panic.ts, std/result.ts, rustc_span/macros.ts). */
const PANIC_ENTRIES: readonly string[] = ["bug", "span_bug", "panic", "unreachable", "unwrap", "assert", "assert_eq", "assert_matches", "expect"];

/**
 * The hole in the resolver's link check: it compares the callee's *name*. A non-`#[track_caller]` fn `N` that tail-calls
 * another `N` loses its frame, and its caller's `x.N(..)` still links to the frame below, so the location would be taken
 * in the wrong fn. Every such wrapper must be non-tail (`keep_frame`). `#[track_caller]` wrappers are harmless: the walk
 * skips them anyway.
 */
function self_named_tail_calls(): string[] {
  const out: string[] = [];
  const files = ts_sources(SRC_ROOT).filter((f) => !f.includes("/rust_ts/track_caller"));
  // Only a name that can lead to a location matters: a `#[track_caller]` fn, or a panic entry.
  const leads = new Set<string>(PANIC_ENTRIES);
  for (const file of files) {
    for (const owner of ts_file(file).owners) {
      if (owner.kind === "fn" && up_file(owner.path) !== undefined && is_track_caller_owner(owner)) leads.add(owner.name);
    }
  }
  for (const file of files) {
    const ts = ts_file(file);
    for (const owner of ts.owners) {
      if (owner.kind !== "fn" || !leads.has(owner.name)) continue;
      const up = up_file(owner.path);
      if (up === undefined) continue;
      if (is_track_caller_owner(owner)) continue;
      const body = ts.masked_lines.slice(owner.start - 1, owner.end).join("\n");
      const re = new RegExp(`\\b(?:return\\s+|=>\\s*)(?:[\\w$.!]|\\([^()]*\\))*?(?<![\\w$])(?:[A-Za-z][\\w$]*_)?${owner.name.replace(/[$]/g, "\\$")}_?\\s*(?:<[^()]*>)?\\(`, "g");
      for (const m of body.matchAll(re)) {
        const open = m.index + m[0].length - 1;
        let d = 0;
        let i = open;
        for (; i < body.length; i++) {
          if (body[i] === "(") d++;
          else if (body[i] === ")" && --d === 0) break;
        }
        const next = /^\s*([;,)}]|$)/.exec(body.slice(i + 1));
        if (next === null) continue;
        const line = owner.start + body.slice(0, m.index).split("\n").length - 1;
        // The declaration's own line can match an arrow's parameter list; only a call in the body counts.
        out.push(`${file.slice(SRC_ROOT.length + 1)}:${line} ${owner.name} (${owner.path}:${owner.line})`);
      }
    }
  }
  return out;
}

/** Mapped locations against the `Location` constants of the oracle binary (plan-ice-report 3.2). */
function binary_check(sites: Site[]): void {
  const path = join(DATA, "tmp", "ice-report", "dylib-locs.txt");
  if (!existsSync(path)) {
    console.log(`oracle binary check skipped: no ${path}`);
    return;
  }
  const all = new Set(readFileSync(path, "utf8").split("\n"));
  const mapped = [...new Set(sites.filter((s) => s.location !== undefined).map((s) => s.location!))];
  const absent = mapped.filter((l) => !all.has(`RD/${l}`));
  // Another column witnessed on the same line is what a column error would look like; other absences are compiled out.
  const lines = new Set([...all].map((l) => l.replace(/:\d+$/, "")));
  const suspect = absent.filter((l) => lines.has(`RD/${l.replace(/:\d+$/, "")}`));
  console.log(`oracle binary: ${mapped.length - absent.length} of ${mapped.length} mapped locations witnessed; ${absent.length} absent (not an error), ${suspect.length} of them with another column witnessed on the line`);
  writeFileSync(join(OUT, "not-witnessed.txt"), absent.join("\n") + "\n");
  writeFileSync(join(OUT, "other-column.txt"), suspect.join("\n") + "\n");
}

/** How many of the locations the oracle prints in the ICE corpus the D4 rules refuse. */
function corpus_check(byOwner: Map<string, { ts: TsFile; file: string; owner: Owner }[]>): void {
  const dir = join(DATA, "tmp", "ice-report", "out2");
  if (!existsSync(dir)) {
    console.log(`corpus check skipped: no ${dir}`);
    return;
  }
  const locs = new Set<string>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".o1.err")) continue;
    for (const m of readFileSync(join(dir, f), "utf8").matchAll(/\/rustc-dev\/[0-9a-f]+\/(compiler\/\S+?\.rs):(\d+):(\d+)/g)) locs.add(`${m[1]}:${m[2]}:${m[3]}`);
  }
  const rows: string[] = [];
  let ok = 0;
  for (const loc of [...locs].sort()) {
    const m = /^(.*):(\d+):(\d+)$/.exec(loc)!;
    const r = corpus_location(byOwner, m[1]!, Number(m[2]), Number(m[3]));
    if (r.startsWith("mapped")) ok++;
    rows.push(`${loc}\t${r}`);
  }
  console.log(`ICE corpus: ${locs.size} locations, ${ok} map from a TS site under the D4 rules, ${locs.size - ok} do not`);
  writeFileSync(join(OUT, "corpus.txt"), rows.join("\n") + "\n");
}

function corpus_location(byOwner: Map<string, { ts: TsFile; file: string; owner: Owner }[]>, path: string, line: number, col: number): string {
  const up: UpFile | undefined = up_file(path);
  if (up === undefined) return "no upstream file";
  const pos = up.line_starts[line - 1]! + col - 1;
  // The callee: the last path segment of the call or macro at the location.
  const m = /^[\w:]*?(\w+)\s*(?:!|::\s*<|\()/.exec(up.masked.slice(pos, pos + 200));
  if (m === null) return `no call at the location: ${up.masked.slice(pos, pos + 30).trim()}`;
  const callee = m[1]!;
  const candidates = (byOwner.get(path) ?? []).filter(({ owner }) => {
    const b = up.owner_body(owner);
    return b !== undefined && pos >= b[0] && pos < b[1];
  });
  if (candidates.length === 0) return `no marked TS fn contains it (callee ${callee})`;
  const seen: string[] = [];
  for (const { ts, file, owner } of candidates) {
    const calls = ts.calls_in(owner, callee, false);
    if (calls.length === 0) seen.push(`no TS call of ${callee} in the port of ${owner.path}:${owner.line}`);
    for (const [l, c] of calls) {
      const s = check_site(ts, file, owner, callee, l, c);
      if (s.location === `${path}:${line}:${col}`) return `${s.result} ${s.file}:${s.line}`;
      seen.push(`${s.result} ${s.file}:${s.line}${s.location ? ` -> ${s.location}` : ""}`);
    }
  }
  return `refused: ${seen.slice(0, 3).join("; ").slice(0, 300)}`;
}

/** A deterministic sample of `tests/ui` files with a `.stderr`. */
function ui_sample(n: number): string[] {
  const root = join(DATA, "rust");
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name !== "auxiliary") walk(r);
      } else if (e.name.endsWith(".rs") && existsSync(join(root, r.replace(/\.rs$/, ".stderr")))) out.push(r);
    }
  };
  walk("tests/ui");
  out.sort((a, b) => Number(Bun.hash(a)) - Number(Bun.hash(b)));
  return out.slice(0, n);
}

async function exec(cmd: string[], cwd: string, env: Record<string, string | undefined>): Promise<{ code: number; err: string }> {
  const p = Bun.spawn(cmd, { cwd, env, stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  const timer = setTimeout(() => p.kill(9), 120_000);
  const err = await new Response(p.stderr).text();
  const code = await p.exited;
  clearTimeout(timer);
  return { code, err };
}

async function oracle_check(n: number): Promise<void> {
  const root = join(DATA, "rust");
  const files = ui_sample(n);
  const main = join(SRC_ROOT, "rust_ts", "main.ts");
  const created = /^\s*= note: -Ztrack-diagnostics: created at (\S+)$/;
  const sysroot = Bun.spawnSync(["rustc", "+nightly", "--print", "sysroot"]).stdout.toString().trim();
  let comparable = 0;
  let refused = 0;
  let locations = 0;
  const wrong: string[] = [];
  const not_comparable: string[] = [];
  const q = [...files];
  const one = async (f: string): Promise<void> => {
    const dir = mkdtempSync(join(tmpdir(), "rust-ts-track-check-"));
    try {
      const src = readFileSync(join(root, f), "utf8");
      const edition = /^\/\/@\s*edition:\s*(\S+)/m.exec(src)?.[1] ?? "2015";
      const args = [f, `--edition=${edition.replace(/\.\.$/, "")}`, "--emit=metadata", "--out-dir", dir, "--sysroot", sysroot, "-Ztrack-diagnostics"];
      const env = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
      const [o, p] = await Promise.all([
        exec(["rustc", "+nightly", ...args], root, env),
        exec([process.execPath, main, ...args], root, { ...env, BUN_JSC_useTailCalls: "0" }),
      ]);
      if (p.code === 70 && p.err.includes("Location::caller")) {
        refused++;
        return;
      }
      const ol = o.err.split("\n");
      const pl = p.err.split("\n");
      const text = (ls: string[]): string => ls.filter((l) => !created.test(l)).join("\n");
      if (text(ol) !== text(pl) || ol.length !== pl.length) {
        not_comparable.push(f);
        return;
      }
      comparable++;
      ol.forEach((l, i) => {
        if (!created.test(l)) return;
        locations++;
        if (l !== pl[i]) wrong.push(`${f}: oracle ${l.trim()} | port ${pl[i]!.trim()}`);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (q.length > 0) await one(q.shift()!);
  }));
  console.log(`-Ztrack-diagnostics, tail calls off: ${files.length} files, ${comparable} comparable, ${locations} locations, ${wrong.length} wrong, ${refused} refused, ${not_comparable.length} not comparable`);
  for (const w of wrong) console.log(`  ERROR: ${w.slice(0, 240)}`);
  writeFileSync(join(OUT, "oracle.txt"), [`wrong:`, ...wrong, `not comparable:`, ...not_comparable].join("\n") + "\n");
}

if (import.meta.main) {
  mkdirSync(OUT, { recursive: true });
  const { sites, byOwner } = static_check();
  const wrappers = self_named_tail_calls();
  console.log(`self-named tail calls in non-#[track_caller] fns: ${wrappers.length}`);
  writeFileSync(join(OUT, "self-named-tail.txt"), wrappers.join("\n") + "\n");
  binary_check(sites);
  corpus_check(byOwner);
  const i = process.argv.indexOf("--oracle");
  if (i >= 0) await oracle_check(Number(process.argv[i + 1] ?? 200));
  console.log(`details: ${OUT}`);
}
