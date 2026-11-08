// rust-ts tool (not an upstream mirror): checks that every upstream INFO-level tracing site in a ported fn is live in the
// port or stops loudly. A static step of the gate (scripts/gate.ts `staticChecks`, "info sites"; lane harness-w44), since
// protected cases set `RUSTC_LOG` (docs/reviews/w40c-audit.md N2).
//
//   bun src/rust_ts/info_sites_check.ts [--out <dir>]
//
// rustc is built with tracing's `max_level_info`, so `info!`, `info_span!` and the `#[instrument]`s at INFO (the default
// level) are the only tracing call sites that print. A `RUSTC_LOG` / `MIRI_LOG` filter that enables INFO for a target
// must print every such event the oracle prints, or stop. So each upstream site (in `compiler/` and Miri's `src/`) that
// lies in a fn the port has (a `// rustc:` marker) must have, in that fn's TS body, a live call (`tracing.info(`,
// `tracing.info_span(`, `tracing.instrument(`) or a stop (`tracing.info_unconverted(`), at least as many as the upstream
// fn has sites. A site in a fn the port does not have is reported only as a count: that fn's caller stops first.
//
// It is a count per fn, not a site-by-site map, so it catches a forgotten site, not a misplaced one. `SKIP` lists the
// sites that never print in the oracle, with the reason. Details go to `<dir>/report.txt` (default
// `$RUST_TS_DATA/tmp/info-sites-check/`; never the tree); a few summary lines go to stdout, and a failure prints `ERROR:`
// lines and exits 1.
//
// What the method cannot see fails instead of counting as "not ported" (docs/reviews/fixers-45.md F4):
// - a site whose enclosing fn the scanner cannot find (a module-level `macro_rules!` body; key `<file>:0`), unless `SKIP`
//   lists it;
// - a fn with no marker at the scanner's line while the port has a marker of the same upstream file and fn name at
//   another line (the scanner and the marker disagree about where the fn is, so the sites would go unchecked). A marker
//   whose own upstream line declares a fn of that name (`fn <name>`) is a namesake, a different fn of the same file
//   (`coerce` in coercion.rs at 242, 1134 and 1609), so it does not count: the fn at the scanner's line is then "not ported"
//   (review harness-w44 N3). The markers step (`coverage.ts --check`) already holds every marker to an upstream fn;
//   an unreadable file counts as no namesake (the stricter rule before the namesake exception);
// - a `SKIP` entry that names no site (upstream moved, or the entry is stale).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC_ROOT = resolve(import.meta.dir, "..");
const DATA = resolve(process.env.RUST_TS_DATA ?? join(SRC_ROOT, "..", ".data"));
const UPSTREAM = join(DATA, "rust");
const DEFAULT_OUT = join(DATA, "tmp", "info-sites-check");

/** Upstream sites that never print in the oracle, or that the port's fn stops before reaching. */
const SKIP: Readonly<Record<string, string>> = {
  "compiler/rustc_const_eval/src/interpret/util.rs:199": "inside `macro_rules! enter_trace_span`: the default `Machine::enter_trace_span` is `()`",
  "compiler/rustc_trait_selection/src/traits/query/type_op/custom.rs:50": "under `if cfg!(debug_assertions)`, false in the oracle",
  "src/tools/miri/src/concurrency/scheduler.rs:65": "in the GenMC branch, which the port stops before (`unported(\"genmc\")`)",
};

/** The upstream directories scanned (relative to the checkout), and the path prefix their markers use. */
const ROOTS: readonly string[] = ["compiler", "src/tools/miri/src"];

export interface Site {
  readonly file: string; // e.g. compiler/rustc_metadata/src/creader.rs
  readonly line: number;
  readonly text: string;
  readonly fn_line: number; // the enclosing fn (an `#[instrument]`'s own fn)
  readonly fn_name: string;
}

function walk(dir: string, out: string[]): void {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e !== "tests") walk(p, out);
    } else if (e.endsWith(".rs")) out.push(p);
  }
}

const FN_RE = /^\s*(pub(\([^)]*\))?\s+)?(const\s+)?(async\s+)?(unsafe\s+)?(extern\s+"[^"]*"\s+)?fn\s+(\w+)/;

/** The INFO-level sites of one upstream file. */
export function scan(rel: string, src: string): Site[] {
  const lines = src.split("\n");
  const sites: Site[] = [];
  const enclosing = (i: number): [number, string] => {
    const ind = lines[i]!.search(/\S/);
    for (let j = i - 1; j >= 0; j--) {
      const m = FN_RE.exec(lines[j]!);
      if (m !== null && lines[j]!.search(/\S/) < ind) return [j + 1, m[7]!];
    }
    return [0, "?"];
  };
  const next_fn = (i: number): [number, string] => {
    for (let j = i; j < lines.length; j++) {
      const m = /\bfn\s+(\w+)/.exec(lines[j]!);
      if (m !== null) return [j + 1, m[1]!];
    }
    return [0, "?"];
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\s*\/\//.test(l)) continue;
    if (/\b(info!|info_span!)\s*\(/.test(l) || /(event|span)!\s*\(\s*(tracing::)?Level::INFO/.test(l)) {
      const [fn_line, fn_name] = enclosing(i);
      sites.push({ file: rel, line: i + 1, text: l.trim(), fn_line, fn_name });
      continue;
    }
    const at = l.search(/#\[(tracing::)?instrument\b/);
    if (at < 0 || /cfg_attr/.test(l)) continue;
    // The attribute, brackets balanced.
    let attr = "";
    let depth = 0;
    outer: for (let j = i; j < lines.length; j++) {
      for (const ch of j === i ? lines[j]!.slice(at) : lines[j]!) {
        attr += ch;
        if (ch === "[") depth++;
        else if (ch === "]" && --depth === 0) break outer;
      }
      attr += " ";
    }
    const lv = /level\s*=\s*"?(\w+)"?/.exec(attr) ?? /level\s*=\s*(?:tracing::)?Level::(\w+)/.exec(attr);
    if ((lv === null ? "info" : lv[1]!.toLowerCase()) !== "info") continue;
    const [fn_line, fn_name] = next_fn(i + 1);
    sites.push({ file: rel, line: i + 1, text: attr.replace(/\s+/g, " "), fn_line, fn_name });
  }
  return sites;
}

/** One marker of the port: where it is (`<ts file>:<line>`), its upstream fn name, and the TS text up to the next marker in that file. */
export interface Marker {
  readonly ts: string;
  readonly name: string;
  readonly body: string;
}

/** Every `// rustc: <path>:<line> <name>` marker of the port, keyed `<path>:<line>`. */
function markers(): Map<string, Marker[]> {
  const files: string[] = [];
  const walk_ts = (dir: string): void => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk_ts(p);
      else if (e.endsWith(".ts") && !e.endsWith(".test.ts")) files.push(p);
    }
  };
  walk_ts(SRC_ROOT);
  const out = new Map<string, Marker[]>();
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    if (!text.includes("// rustc: ")) continue;
    const lines = text.split("\n");
    const at: [number, string, string][] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = /\/\/ rustc: (\S+:\d+) (\S+)/.exec(lines[i]!);
      if (m !== null) at.push([i, m[1]!, m[2]!]);
    }
    for (let k = 0; k < at.length; k++) {
      const [i, key, name] = at[k]!;
      const end = k + 1 < at.length ? at[k + 1]![0] : lines.length;
      const list = out.get(key) ?? [];
      list.push({ ts: `${f.slice(SRC_ROOT.length + 1)}:${i + 1}`, name, body: lines.slice(i, end).join("\n") });
      out.set(key, list);
    }
  }
  return out;
}

const LIVE_RE = /\btracing\.(info|info_span|instrument|info_unconverted)\(|\btracing\.event\("INFO"/g;

/** The checker's verdict on the upstream sites against the port's markers (see the header). */
export interface CheckResult {
  readonly errors: string[];
  readonly report: string[];
  readonly skipped: number;
  readonly in_ported: number;
  readonly unported_fns: number;
}

/** Whether upstream `line` (1-based) of `lines` declares a fn named `name`. */
export function declares_fn(lines: readonly string[] | undefined, line: number, name: string): boolean {
  const l = lines?.[line - 1];
  return l !== undefined && !/^\s*\/\//.test(l) && new RegExp(`\\bfn\\s+${name}\\b`).test(l);
}

/**
 * Checks `sites` against `marks` (keyed `<path>:<line>`), with `skip` as `SKIP` (see the header). `upstream` gives an
 * upstream file's lines (by its checkout-relative path), to tell a namesake marker from a disagreeing one.
 */
export function check(sites: readonly Site[], marks: ReadonlyMap<string, readonly Marker[]>, skip: Readonly<Record<string, string>> = SKIP, upstream: (file: string) => readonly string[] | undefined = () => undefined): CheckResult {
  const by_fn = new Map<string, Site[]>();
  const errors: string[] = [];
  const report: string[] = [];
  const skip_used = new Set<string>();
  for (const s of sites) {
    const at = `${s.file}:${s.line}`;
    if (skip[at] !== undefined) {
      skip_used.add(at);
      continue;
    }
    if (s.fn_line === 0) {
      errors.push(`ERROR: ${at}: an INFO site in no fn the scanner can find (${s.text}); port it with its enclosing fn's marker, or list it in SKIP with the reason it never prints`);
      continue;
    }
    const key = `${s.file}:${s.fn_line}`;
    const list = by_fn.get(key) ?? [];
    list.push(s);
    by_fn.set(key, list);
  }
  for (const at of Object.keys(skip)) if (!skip_used.has(at)) errors.push(`ERROR: SKIP lists ${at}, which is no INFO site; remove or move the entry`);
  // Markers by upstream file and fn name, for the fns the scanner finds no marker at; a namesake's marker is left out.
  const by_name = new Map<string, string[]>();
  for (const [key, list] of marks) {
    const file = key.slice(0, key.lastIndexOf(":"));
    const line = Number(key.slice(key.lastIndexOf(":") + 1));
    for (const m of list) {
      if (declares_fn(upstream(file), line, m.name)) continue;
      const k = `${file} ${m.name}`;
      const l = by_name.get(k) ?? [];
      l.push(`${key} (${m.ts})`);
      by_name.set(k, l);
    }
  }
  let in_ported = 0;
  let unported_fns = 0;
  for (const [key, list] of by_fn) {
    const ts = marks.get(key);
    const fn_name = list[0]!.fn_name;
    if (ts === undefined) {
      const elsewhere = by_name.get(`${list[0]!.file} ${fn_name}`);
      if (elsewhere !== undefined) {
        errors.push(`ERROR: ${key} ${fn_name}: ${list.length} upstream INFO site(s) (${list.map((s) => s.line).join(", ")}), no marker at that line, but the port marks ${fn_name} at ${elsewhere.join(", ")}; the scanner and the marker disagree, so these sites are unchecked`);
        continue;
      }
      unported_fns++;
      report.push(`not ported: ${key} ${fn_name} (${list.length} site(s))`);
      continue;
    }
    in_ported += list.length;
    const live = ts.reduce((n, t) => n + (t.body.match(LIVE_RE)?.length ?? 0), 0);
    const where = ts.map((t) => t.ts).join(", ");
    if (live < list.length) {
      errors.push(`ERROR: ${key} ${fn_name}: ${list.length} upstream INFO site(s) (${list.map((s) => s.line).join(", ")}), ${live} live or stopped in ${where}`);
    } else {
      report.push(`ok: ${key} ${fn_name}: ${list.length} site(s), ${live} in ${where}`);
    }
  }
  return { errors, report, skipped: skip_used.size, in_ported, unported_fns };
}

function main(argv: readonly string[]): number {
  let out = DEFAULT_OUT;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1] !== undefined) out = resolve(argv[++i]!);
    else {
      console.log(`ERROR: info_sites_check: unknown argument ${argv[i]} (usage: bun src/rust_ts/info_sites_check.ts [--out <dir>])`);
      return 2;
    }
  }
  if (!existsSync(UPSTREAM)) {
    console.log(`ERROR: info_sites_check: no upstream checkout at ${UPSTREAM}`);
    return 1;
  }
  const sites: Site[] = [];
  for (const root of ROOTS) {
    const files: string[] = [];
    walk(join(UPSTREAM, root), files);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!/info!|info_span!|instrument|Level::INFO/.test(src)) continue;
      sites.push(...scan(f.slice(UPSTREAM.length + 1), src));
    }
  }
  const lines = new Map<string, readonly string[] | undefined>();
  const upstream_lines = (file: string): readonly string[] | undefined => {
    if (!lines.has(file)) {
      const p = join(UPSTREAM, file);
      lines.set(file, existsSync(p) ? readFileSync(p, "utf8").split("\n") : undefined);
    }
    return lines.get(file);
  };
  const r = check(sites, markers(), SKIP, upstream_lines);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "report.txt"), [...r.errors, ...r.report].join("\n") + "\n");
  console.log(`upstream INFO sites ${sites.length} (skipped ${r.skipped}); in ported fns ${r.in_ported}; fns not ported ${r.unported_fns}`);
  console.log(`details: ${join(out, "report.txt")}`);
  for (const e of r.errors) console.log(e);
  return r.errors.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
