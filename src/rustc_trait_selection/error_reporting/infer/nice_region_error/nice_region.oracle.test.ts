// Oracle tests for lane errrep-nice-region: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/
// static_impl_trait.rs's `suggest_new_region_bound` / `make_elided_region_spans_suggs` (every branch that writes a
// suggestion: opaque with an explicit `'static` bound, opaque without one (`+ '_`, a new named lifetime with `<'a>` and
// `S<'a, 'a>`, an existing named lifetime), trait object with an implicit and with an explicit `'static`).
//
// Cases: nice_region_oracle/cases/<name>.rs, no_core libraries where plain rustc reports one borrowck error
// (`lifetime may not live long enough`) whose `help:` children all come from `suggest_new_region_bound`. Borrowck is not
// ported: nice_region_oracle/run.ts stands in for its caller (`add_static_impl_trait_suggestion`) and puts the
// suggestions onto a scaffold error at the fn; the `help:` children (from the first `help:` line to the end of the
// diagnostic) must equal the oracle's byte for byte.
//
// The other files of the lane (placeholder_error.rs, placeholder_relation.rs, trait_impl_difference.rs,
// mismatched_static_lifetime.rs, the rest of static_impl_trait.rs) are reached only through
// `TypeErrCtxt::report_region_errors` / `NiceRegionError::try_report` (lane errrep-region) or borrowck; with the pinned
// rustc none of tests/ui reaches them during type checking (checked with `-Zunpretty=thir-tree`), so they have no oracle
// case yet. The test below checks that they are installed (not placeholders).
//
// Without the pinned toolchain the oracle part is a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { beforeAll, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { unported_stub_path } from "../../../../rust_ts/stubs.ts";
import "../../../lib.ts";
import { NiceRegionError } from "./mod.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const HERE = import.meta.dir;
const CASES_DIR = join(HERE, "nice_region_oracle", "cases");
const RUNNER = join(HERE, "nice_region_oracle", "run.ts");
const ARGS = ["--edition", "2024", "--crate-type", "lib", "-Ainternal_features"];

const CASES = readdirSync(CASES_DIR)
  .filter((f) => f.endsWith(".rs"))
  .map((f) => f.slice(0, -3))
  .sort();

const ENV: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE"].includes(k)) ENV[k] = v;
}

interface Out {
  stderr: string;
  code: number;
}
async function run(cmd: string[]): Promise<Out> {
  const p = Bun.spawn(cmd, { cwd: CASES_DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  const [, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stderr, code };
}

/** The `help:` children of the first diagnostic: from its first `help:` line up to the blank line that ends it. */
function help_children(stderr: string): string {
  const lines = stderr.split("\n");
  const start = lines.findIndex((l) => l.startsWith("help: "));
  if (start < 0) return "";
  const end = lines.indexOf("", start);
  return lines.slice(start, end < 0 ? lines.length : end).join("\n");
}

let oracle_cmd: ((args: string[]) => string[]) | undefined;
const oracle_out = new Map<string, Out>();

beforeAll(async () => {
  const oracle = require("../../../../../scripts/lib/oracle.ts") as typeof import("../../../../../scripts/lib/oracle.ts");
  const probe = Bun.spawnSync(oracle.oracleRustcCmd(["-vV"]), { env: ENV });
  if (probe.exitCode !== 0) {
    if (REQUIRE) throw new Error("ERROR: the pinned rustc is not runnable and RUST_TS_REQUIRE_PROBES=1");
    console.log("SKIP: pinned rustc not runnable; RUST_TS_REQUIRE_PROBES=1 makes this a failure");
    return;
  }
  await oracle.verifyOraclePin();
  oracle_cmd = oracle.oracleRustcCmd;
  await Promise.all(
    CASES.map(async (c) => {
      // `--emit=metadata` into the OS temp dir: the borrowck error is all we need, and no output lands in the tree.
      const out = join(require("node:os").tmpdir(), `rust-ts-nice-region-${process.pid}-${c}.rmeta`);
      oracle_out.set(c, await run(oracle.oracleRustcCmd([...ARGS, "--emit=metadata", "-o", out, `${c}.rs`])));
    }),
  );
}, 120_000);

test("the cases exist", () => {
  expect(CASES.length).toBeGreaterThanOrEqual(7);
});

test("the lane's fns are installed (not placeholders)", () => {
  const proto = NiceRegionError.prototype as unknown as Record<string, unknown>;
  for (const m of [
    "try_report_placeholder_conflict",
    "try_report_trait_placeholder_mismatch",
    "report_trait_placeholder_mismatch",
    "explain_actual_impl_that_was_found",
    "try_report_placeholder_relation",
    "try_report_static_impl_trait",
    "try_report_impl_not_conforming_to_trait",
    "emit_err",
    "try_report_mismatched_static_lifetime",
  ]) {
    expect(typeof proto[m]).toBe("function");
    expect(unported_stub_path(proto[m])).toBeUndefined();
  }
  const statics = NiceRegionError as unknown as Record<string, unknown>;
  expect(unported_stub_path(statics.get_impl_ident_and_self_ty_from_trait)).toBeUndefined();
  expect(typeof statics.get_impl_ident_and_self_ty_from_trait).toBe("function");
});

for (const c of CASES) {
  test(`suggest_new_region_bound: ${c}`, async () => {
    const got = await run([process.execPath, RUNNER, ...ARGS, `${c}.rs`]);
    expect(got.stderr).not.toContain("rust-ts: ");
    expect(got.code).toBe(1);
    if (oracle_cmd === undefined) return;
    const want = oracle_out.get(c)!;
    // the oracle reports exactly the borrowck error with at least one of `suggest_new_region_bound`'s suggestions
    expect(want.code).toBe(1);
    expect(want.stderr.startsWith("error: lifetime may not live long enough\n")).toBe(true);
    expect(want.stderr.split("\n").filter((l) => /^error(\[E\d+\])?: /.test(l) && !l.startsWith("error: aborting")).length).toBe(1);
    const help = help_children(want.stderr);
    expect(help).toMatch(/^help: (to declare that|consider changing)/);
    expect(help_children(got.stderr)).toBe(help);
  }, 120_000);
}
