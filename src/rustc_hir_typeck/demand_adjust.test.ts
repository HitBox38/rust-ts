// Tests of lane typeck-demand-adjust: fn_ctxt/adjust_fulfillment_errors.rs and demand.rs through the driver, against
// the oracle.
//
// demand_adjust_test/run.ts runs the ported driver through type checking (see its header). `<case>.stderr` /
// `<case>.exit` are the pinned rustc's human-format stderr and exit status (`REGEN=1` rewrites them from the oracle); the
// port must print them byte for byte.
// - `adjust_args`: `blame_specific_arg_if_possible` (first / second argument) and the `ImplDerived` drilling of
//   `blame_specific_part_of_expr_corresponding_to_generic_param` (tuples, references, struct literals, tuple-struct and
//   variant constructors, nested).
// - `adjust_paths`: `point_at_path_if_possible` / `point_at_generic_if_possible` (turbofish on calls, paths, methods,
//   elided lifetimes before the type params), `point_at_field_if_possible`, method-call receivers (`Self` param; the
//   receiver-to-method-name span move of suggestions.rs:5459), type-relative paths.
// - `demand_basic`: `annotate_expected_due_to_let_ty` (let type, parameter, local, field), a
//   `note_source_of_type_mismatch_constraint` chain, `annotate_loop_expected_due_to_inference`,
//   `annotate_mut_binding_to_immutable_binding`, `explain_self_literal` (`Self(..)` and `Self { .. }`).
// (Until merge-w19 the runner replaced other wave-19 lanes' reporting by stand-ins and the test compared a projection of
// the JSON output, with the `note_type_err` parts removed from the oracle side.)
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN } from "../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "demand_adjust_test");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

const CASES = ["adjust_args", "adjust_paths", "demand_basic"] as const;

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

function rustc_at_pin(): boolean {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 && r.stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}

const args = (sysroot: string, c: string): string[] => [
  "--target",
  "x86_64-unknown-linux-gnu",
  "--sysroot",
  sysroot,
  "--edition=2021",
  "--crate-type",
  "lib",
  `${c}.rs`,
];
const oracle_args = (sysroot: string, c: string): string[] => [...args(sysroot, c), "--emit=metadata", "-o", join(process.env.TMPDIR ?? "/tmp", `demand_adjust_test_${c}.rmeta`)];

function run(cmd: string[]): { exit: number; stderr: string } {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stderr: r.stderr.toString() };
}

const oracle = (s: string, c: string) => run(["rustc", `+${PIN.toolchain}`, ...oracle_args(s, c)]);

if (REGEN) {
  const s = sysroot();
  if (s === undefined || !rustc_at_pin()) throw new Error("ERROR: REGEN needs the pinned toolchain");
  for (const c of CASES) {
    const o = oracle(s, c);
    writeFileSync(join(DIR, `${c}.stderr`), o.stderr);
    writeFileSync(join(DIR, `${c}.exit`), `${o.exit}\n`);
  }
}

const expected = (c: string) => ({
  exit: Number(readFileSync(join(DIR, `${c}.exit`), "utf8").trim()),
  stderr: readFileSync(join(DIR, `${c}.stderr`), "utf8"),
});

test("demand_adjust_test fixtures are the current oracle output", () => {
  const s = sysroot();
  if (s === undefined || !rustc_at_pin()) {
    if (REQUIRE) throw new Error("ERROR: pinned toolchain missing");
    return;
  }
  for (const c of CASES) {
    const o = oracle(s, c);
    // every case is an error case (guards against a case that tests nothing)
    expect(o.stderr).toContain("error[E");
    expect({ c, exit: o.exit, stderr: o.stderr }).toEqual({ c, ...expected(c) });
  }
}, 120_000);

for (const c of CASES) {
  test(`demand_adjust_test/${c}.rs: the port's stderr equals the oracle's`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const r = run(["bun", join(DIR, "run.ts"), ...args(s, c)]);
    expect({ exit: r.exit, stderr: r.stderr }).toEqual(expected(c));
  }, 120_000);
}
