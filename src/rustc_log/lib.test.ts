// rustc's default logger (rustc_log + tracing-tree, `RUSTC_LOG` unset): the `warn!` / `error!` lines on stderr.
// - Oracle: tracing_oracle/root_region.rs through the ported tydump driver (src/rust_ts/tydump.ts) must give the
//   `tydump` probe's stdout, stderr, exit code and log file byte for byte, for each `RUSTC_LOG_*` variant of
//   tracing_oracle/gen.ts (expected.json); a second test checks the fixtures are the current oracle output.
// - Format: the event path of src/rust_ts/tracing_tree.ts on cases the fixture crate does not reach (named fields,
//   ERROR, multi-line messages, recursion), with the bytes tracing-tree 0.4.1's code produces.
import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Outcome, run_oracle, run_variant, tydump_probe, VARIANTS } from "./tracing_oracle/gen.ts";
import { LoggerConfig, display_Error, init_logger } from "./lib.ts";
import { error, reset_global_default_for_tests, set_global_default, LayeredSubscriber, warn } from "../rust_ts/tracing.ts";
import { HierarchicalLayer, type Writer } from "../rust_ts/tracing_tree.ts";
import { Err, Ok } from "../std/result.ts";

const HERE = import.meta.dir;
const REPO = join(HERE, "..", "..");
const expected = JSON.parse(readFileSync(join(HERE, "tracing_oracle", "expected.json"), "utf8")) as Record<string, Outcome>;

for (const variant of Object.keys(VARIANTS)) {
  test(`oracle: ${variant}`, () => {
    const want = expected[variant];
    if (want === undefined) throw new Error(`ERROR: no oracle outcome for ${variant}; run bun src/rustc_log/tracing_oracle/gen.ts`);
    const got = run_variant([process.execPath, join(REPO, "src", "rust_ts", "tydump.ts")], variant);
    expect(got).toEqual(want);
  }, 120_000);
}

test("the fixtures are the current oracle output", () => {
  const req = process.env.RUST_TS_REQUIRE_PROBES === "1";
  if (process.env.RUST_TS_DATA === undefined || !existsSync(tydump_probe())) {
    if (req) throw new Error(`ERROR: tydump probe missing; bun scripts/probes.ts build tydump`);
    return;
  }
  for (const variant of Object.keys(VARIANTS)) expect({ variant, ...run_oracle(variant) }).toEqual({ variant, ...expected[variant]! });
}, 300_000);

// ---- format ---------------------------------------------------------------------------------------------------------

afterEach(() => reset_global_default_for_tests());

/** Installs a `HierarchicalLayer` configured as rustc_log does (WARN filter), writing into the returned array. */
function capture(opts: { ansi?: boolean; lines?: boolean } = {}): string[] {
  const out: string[] = [];
  const writer: Writer = {
    write_all(s: string) {
      out.push(s);
      return undefined;
    },
  };
  const layer = HierarchicalLayer.default()
    .with_writer(() => writer)
    .with_ansi(opts.ansi ?? false)
    .with_targets(true)
    .with_indent_amount(2)
    .with_indent_lines(opts.lines ?? false);
  expect(set_global_default(new LayeredSubscriber([layer], "WARN"))).toEqual(Ok(null));
  return out;
}

test("message, then the named fields in macro order", () => {
  const out = capture();
  // `warn!(error = ?e, "Invalid span {:?}", sp)`: tracing records `message` first.
  warn("rustc_errors::emitter", () => "Invalid span x.rs:1:1: 1:2 (#0)", ["error", () => "IllFormedSpan(..)"]);
  expect(out).toEqual([" WARN rustc_errors::emitter Invalid span x.rs:1:1: 1:2 (#0), error=IllFormedSpan(..)\n"]);
});

test("ERROR level, plain and coloured", () => {
  const out = capture();
  error("rustc_mir_dataflow::framework", () => "Failed to write graphviz dataflow results: oops");
  expect(out).toEqual([" ERROR rustc_mir_dataflow::framework Failed to write graphviz dataflow results: oops\n"]);
  reset_global_default_for_tests();
  const out2 = capture({ ansi: true });
  error("t", () => "m");
  expect(out2).toEqual([" \x1B[1;31mERROR\x1B[0m \x1B[2mt\x1B[0m m\n"]);
});

test("multi-line messages", () => {
  const out = capture();
  warn("t", () => "a\r\nb\n");
  // `str::lines` drops the trailing empty line and the `\r`; later lines are indented by two more spaces.
  expect(out).toEqual([" WARN t a\n   b\n"]);
  reset_global_default_for_tests();
  const out2 = capture({ lines: true });
  warn("t", () => "a\nb\n");
  // `indent_current` appends a `\n` first when `indent_lines`, so the block ends in an empty line.
  expect(out2).toEqual(["WARN t a\nb\n\n"]);
});

test("the default filter drops INFO and below; no subscriber drops everything", () => {
  reset_global_default_for_tests();
  let formatted = false;
  warn("t", () => ((formatted = true), "m"));
  expect(formatted).toBe(false);
  const out = capture();
  const sub = new LayeredSubscriber([], "WARN");
  expect(["TRACE", "DEBUG", "INFO", "WARN", "ERROR"].map((l) => sub.enabled(l as "WARN", "t"))).toEqual([false, false, false, true, true]);
  expect(out).toEqual([]);
});

test("events emitted while formatting an event are dropped (tracing-tree's recursion guard)", () => {
  const out = capture();
  warn("outer", () => {
    warn("inner", () => "nested");
    return "m";
  });
  expect(out).toEqual([" WARN outer m\n"]);
});

test("rustc_log errors", () => {
  const cfg = (o: Partial<Record<string, string>>) => {
    const v = (k: string) => (o[k] === undefined ? Err({ $: "NotPresent" as const }) : Ok(o[k]!));
    return new LoggerConfig(v("filter"), v("color"), v("ee"), v("tid"), v("bt"), v("json"), v("out"), v("wrap"), v("lines"));
  };
  expect(init_logger(cfg({}))).toEqual(Ok(null));
  const again = init_logger(cfg({}));
  expect(again.$ === "Err" && display_Error(again._0)).toBe("a global default trace dispatcher has already been set");
  const bad = init_logger(cfg({ wrap: "x" }));
  expect(bad.$ === "Err" && display_Error(bad._0)).toBe("invalid log WRAPTREE value 'x': expected a non-negative integer");
});
