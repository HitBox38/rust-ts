// rust-ts test support (not an upstream mirror): checks rust_ts/intern_key.ts against its first version on the
// values of a real compilation (lane perf-intern; used by intern_key.test.ts).
//
// `intern_key_reference` is the first `intern_key`, kept verbatim: the faster one must give the same string for every
// value, so the equivalence classes (hash-consing, `KeyedMap`) are unchanged.
//
//   bun src/rust_ts/intern_key_corpus.ts [--bench] <tydump arguments...>
//
// runs the tydump subject in this process (as src/rust_ts/tydump.ts, the dump discarded, diagnostics on stderr) with
// an observer on `intern_key` that, for every value, compares the key with `intern_key_reference`, and checks
// `intern_key_eq` against key equality: true with the first value seen under the same key, false with the previous
// value when the keys differ. Prints one line of JSON (`IkSummary`) on stdout. `--bench` also keeps every value and
// times both key functions over them after the compilation (`ns_reference` / `ns_new` per value).
import { INTERNED } from "../rustc_data_structures/intern.ts";
import { panic } from "../std/panic.ts";
import { intern_key, intern_key_eq, set_intern_key_observer } from "./intern_key.ts";

function push_key(v: unknown, out: string[]): void {
  switch (typeof v) {
    case "number":
      out.push(Object.is(v, -0) ? "-0" : String(v));
      return;
    case "string":
      out.push(JSON.stringify(v));
      return;
    case "boolean":
      out.push(v ? "t" : "f");
      return;
    case "bigint":
      out.push(`${v}n`);
      return;
    case "undefined":
      out.push("~");
      return;
    case "object": {
      if (v === null) {
        out.push("()");
        return;
      }
      const o = v as { readonly [INTERNED]?: true; readonly id?: number };
      if (o[INTERNED] === true) {
        out.push(`#${o.id}`);
        return;
      }
      if (Array.isArray(v)) {
        out.push("[");
        for (let i = 0; i < v.length; i++) {
          if (i > 0) out.push(",");
          push_key(v[i], out);
        }
        out.push("]");
        return;
      }
      if (v instanceof Map || v instanceof Set) panic("intern_key: a Map/Set inside an intern key");
      const keys = Object.keys(v).sort();
      out.push("{");
      let first = true;
      for (const k of keys) {
        const f = (v as Record<string, unknown>)[k];
        if (f === undefined) continue;
        if (!first) out.push(",");
        first = false;
        out.push(k, ":");
        push_key(f, out);
      }
      out.push("}");
      return;
    }
    default:
      panic(`intern_key: a ${typeof v} inside an intern key`);
  }
}

/** The first `intern_key` (module comment). */
export function intern_key_reference(v: unknown): string {
  const out: string[] = [];
  push_key(v, out);
  return out.join("");
}

export interface IkSummary {
  exit_code: number;
  values: number;
  distinct_keys: number;
  key_mismatches: number;
  eq_true_checks: number;
  eq_false_checks: number;
  eq_mismatches: number;
  /** kept values whose key changed after they were keyed */
  changed_after_keyed: number;
  first_mismatch?: string;
  ns_reference?: number;
  ns_new?: number;
  avg_key_len?: number;
}

/** Keys kept for the `intern_key_eq` check (memory bound). */
const MAX_CLASSES = 500_000;

async function main(argv: string[]): Promise<void> {
  const bench = argv[0] === "--bench";
  const args = bench ? argv.slice(1) : argv;
  const s: IkSummary = {
    exit_code: -1,
    values: 0,
    distinct_keys: 0,
    key_mismatches: 0,
    eq_true_checks: 0,
    eq_false_checks: 0,
    eq_mismatches: 0,
    changed_after_keyed: 0,
  };
  const first_of = new Map<string, unknown>();
  const kept: unknown[] = [];
  let prev: unknown;
  let prev_key: string | undefined;
  const mismatch = (what: string) => {
    if (s.first_mismatch === undefined) s.first_mismatch = what.slice(0, 400);
  };
  set_intern_key_observer((v, key) => {
    s.values++;
    const r = intern_key_reference(v);
    if (r !== key) {
      s.key_mismatches++;
      mismatch(`key: reference ${r} new ${key}`);
    }
    // `intern_key_eq` against key equality *now*: a value kept from earlier may have been changed since (a `Vec`
    // that is still being built), so the expected answer compares its current reference key
    const check = (x: unknown) => {
      const expected = intern_key_reference(x) === r;
      if (expected) s.eq_true_checks++;
      else s.eq_false_checks++;
      if (intern_key_eq(x, v) !== expected) {
        s.eq_mismatches++;
        mismatch(`eq: ${!expected} for ${intern_key_reference(x)} / ${r}`);
      }
      return expected;
    };
    const f = first_of.get(key);
    if (f === undefined) {
      if (first_of.size < MAX_CLASSES) first_of.set(key, v);
    } else if (f !== v && !check(f)) {
      s.changed_after_keyed++;
      first_of.set(key, v);
    }
    if (prev_key !== undefined && prev !== v) check(prev);
    prev = v;
    prev_key = key;
    if (bench) kept.push(v);
  });

  const { catch_with_exit_code, compiler_entrypoint } = await import("../rustc_driver_impl/lib.ts");
  const { run_required_analyses_prefix, dump } = await import("./tydump_dump.ts");
  const callbacks = {
    config(config: { opts: { trimmed_def_paths: boolean } }): void {
      config.opts.trimmed_def_paths = true;
    },
    after_expansion(_compiler: unknown, tcx: Parameters<typeof run_required_analyses_prefix>[0]): "Stop" {
      dump(tcx, run_required_analyses_prefix(tcx));
      return "Stop";
    },
  };
  s.exit_code = catch_with_exit_code(() =>
    compiler_entrypoint(["rustc", ...args], callbacks as unknown as Parameters<typeof compiler_entrypoint>[1]),
  );
  set_intern_key_observer(undefined);
  s.distinct_keys = first_of.size;
  if (bench) {
    // each key goes into a `Map`, as in the interners (a key built by concatenation is flattened there)
    const time = (f: (v: unknown) => string) => {
      const t0 = performance.now();
      for (let rep = 0; rep < 3; rep++) {
        const m = new Map<string, number>();
        for (const v of kept) m.set(f(v), 0);
      }
      return ((performance.now() - t0) * 1e6) / (3 * kept.length);
    };
    time(intern_key_reference);
    time(intern_key);
    s.ns_reference = Math.round(time(intern_key_reference));
    s.ns_new = Math.round(time(intern_key));
    let len = 0;
    for (const v of kept) len += intern_key(v).length;
    s.avg_key_len = Math.round(len / kept.length);
  }
  process.stdout.write(`${JSON.stringify(s)}\n`);
}

if (import.meta.main) await main(process.argv.slice(2));
