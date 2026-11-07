// rust-ts tool (not an upstream mirror, not a gate step): checks that every upstream INFO-level tracing site in a ported fn
// is live in the port or stops loudly.
//
//   bun src/rust_ts/info_sites_check.ts
//
// rustc is built with tracing's `max_level_info`, so `info!`, `info_span!` and the `#[instrument]`s at INFO (the default
// level) are the only tracing call sites that print. A `RUSTC_LOG` / `MIRI_LOG` filter that enables INFO for a target
// must print every such event the oracle prints, or stop. So each upstream site (in `compiler/` and Miri's `src/`) that
// lies in a fn the port has (a `// rustc:` marker) must have, in that fn's TS body, a live call (`tracing.info(`,
// `tracing.info_span(`, `tracing.instrument(`) or a stop (`tracing.info_unconverted(`), at least as many as the upstream
// fn has sites. A site in a fn the port does not have is reported only as a count: that fn's caller stops first.
//
// It is a count per fn, not a site-by-site map, so it catches a forgotten site, not a misplaced one. `SKIP` lists the
// sites that never print in the oracle, with the reason. Details go to `$RUST_TS_DATA/tmp/info-sites-check/`; a few
// summary lines go to stdout, and a failure prints `ERROR:` lines and exits 1.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC_ROOT = resolve(import.meta.dir, "..");
const DATA = resolve(process.env.RUST_TS_DATA ?? join(SRC_ROOT, "..", ".data"));
const UPSTREAM = join(DATA, "rust");
const OUT = join(DATA, "tmp", "info-sites-check");

/** Upstream sites that never print in the oracle, or that the port's fn stops before reaching. */
const SKIP: Readonly<Record<string, string>> = {
  "compiler/rustc_const_eval/src/interpret/util.rs:199": "inside `macro_rules! enter_trace_span`: the default `Machine::enter_trace_span` is `()`",
  "compiler/rustc_trait_selection/src/traits/query/type_op/custom.rs:50": "under `if cfg!(debug_assertions)`, false in the oracle",
  "src/tools/miri/src/concurrency/scheduler.rs:65": "in the GenMC branch, which the port stops before (`unported(\"genmc\")`)",
};

/** The upstream directories scanned (relative to the checkout), and the path prefix their markers use. */
const ROOTS: readonly string[] = ["compiler", "src/tools/miri/src"];

interface Site {
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
function scan(rel: string, src: string): Site[] {
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

/** Every `// rustc: <path>:<line> <name>` marker of the port, with the TS text up to the next marker in that file. */
function markers(): Map<string, { ts: string; body: string }[]> {
  const files: string[] = [];
  const walk_ts = (dir: string): void => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk_ts(p);
      else if (e.endsWith(".ts") && !e.endsWith(".test.ts")) files.push(p);
    }
  };
  walk_ts(SRC_ROOT);
  const out = new Map<string, { ts: string; body: string }[]>();
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    if (!text.includes("// rustc: ")) continue;
    const lines = text.split("\n");
    const at: [number, string][] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = /\/\/ rustc: (\S+:\d+) /.exec(lines[i]!);
      if (m !== null) at.push([i, m[1]!]);
    }
    for (let k = 0; k < at.length; k++) {
      const [i, key] = at[k]!;
      const end = k + 1 < at.length ? at[k + 1]![0] : lines.length;
      const list = out.get(key) ?? [];
      list.push({ ts: `${f.slice(SRC_ROOT.length + 1)}:${i + 1}`, body: lines.slice(i, end).join("\n") });
      out.set(key, list);
    }
  }
  return out;
}

const LIVE_RE = /\btracing\.(info|info_span|instrument|info_unconverted)\(|\btracing\.event\("INFO"/g;

function main(): number {
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
  const marks = markers();
  const by_fn = new Map<string, Site[]>();
  let skipped = 0;
  for (const s of sites) {
    if (SKIP[`${s.file}:${s.line}`] !== undefined) {
      skipped++;
      continue;
    }
    const key = `${s.file}:${s.fn_line}`;
    const list = by_fn.get(key) ?? [];
    list.push(s);
    by_fn.set(key, list);
  }
  const report: string[] = [];
  const errors: string[] = [];
  let in_ported = 0;
  let unported_fns = 0;
  for (const [key, list] of by_fn) {
    const ts = marks.get(key);
    if (ts === undefined) {
      unported_fns++;
      report.push(`not ported: ${key} ${list[0]!.fn_name} (${list.length} site(s))`);
      continue;
    }
    in_ported += list.length;
    const live = ts.reduce((n, t) => n + (t.body.match(LIVE_RE)?.length ?? 0), 0);
    const where = ts.map((t) => t.ts).join(", ");
    if (live < list.length) {
      errors.push(`ERROR: ${key} ${list[0]!.fn_name}: ${list.length} upstream INFO site(s) (${list.map((s) => s.line).join(", ")}), ${live} live or stopped in ${where}`);
    } else {
      report.push(`ok: ${key} ${list[0]!.fn_name}: ${list.length} site(s), ${live} in ${where}`);
    }
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.txt"), [...errors, ...report].join("\n") + "\n");
  console.log(`upstream INFO sites ${sites.length} (skipped ${skipped}); in ported fns ${in_ported}; fns not ported ${unported_fns}`);
  console.log(`details: ${join(OUT, "report.txt")}`);
  for (const e of errors) console.log(e);
  return errors.length === 0 ? 0 : 1;
}

process.exitCode = main();
