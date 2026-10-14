// Oracle tests for lane repr-options: rustc_abi `ReprOptions` (its derived Debug, `{:?}` and `{:#?}`, the `ReprFlags`
// Debug, the predicates `c` .. `inhibits_union_abi_opt`, `discr_type`) and `TyCtxt::repr_options_of_def` (rustc_middle
// ty/mod.rs) on the no_core items of repr_oracle/r.rs and l.rs: `repr(C)`, `repr(<int>)`, `repr(packed(N))` (min),
// `repr(align(N))` (max), `repr(transparent)`, `repr(simd)`, the `owned_box` lang item (IS_LINEAR),
// `#[rustc_pass_indirectly_in_non_rustic_abis]`, `#[rustc_scalable_vector(N)]` / without `N`, the field shuffle seed
// (`def_path_hash`), `-Zrandomize-layout` and `-Zlayout-seed`.
//
// The expected outputs (repr_oracle/expected.json) come from the oracle compiler itself: repr_oracle/probe.rs, a
// throwaway rustc-dev probe (its header says how to build it; lanes may not add tools/probes). The subject side is
// repr_oracle/run.ts (the ported driver, same output). stdout, stderr and the exit code must be identical.
//
// `r.rs` is compiled as a binary: a lib crate needs the crate hash, whose HIR hashing reaches `StableHash for Align`
// (the payload of `ReprAttr::{ReprPacked, ReprAlign}`), not generated yet (docs/handoff/repr-options.md). `l.rs` (r.rs
// without packed / align) is compiled as a lib.
//
// To regenerate expected.json from the probe: TYREPR_PROBE=<path to the built probe> TYREPR_WRITE=1 bun test <this file>.
// With only TYREPR_PROBE set, the cases compare against the live probe instead of expected.json.
import { beforeAll, expect, test } from "bun:test";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../../../scripts/lib/common.ts";
import { test_scratch_dir } from "../../rust_ts/test_scratch.ts";

const WORK = test_scratch_dir("repr-options");
const DIR = join(REPO, "src/rustc_middle/ty/repr_oracle");
const RUNNER = join(DIR, "run.ts");
const EXPECTED = join(DIR, "expected.json");
const PROBE = process.env.TYREPR_PROBE;
const WRITE = process.env.TYREPR_WRITE === "1";

const ENV: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE"].includes(k)) ENV[k] = v;
}

interface Out {
  stdout: string;
  stderr: string;
  code: number;
}
async function run(cmd: string[], cwd: string): Promise<Out> {
  const p = Bun.spawn(cmd, { cwd, env: ENV, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stdout, stderr, code };
}

const CASES: { name: string; args: string[] }[] = [
  { name: "bin", args: ["r.rs"] },
  { name: "randomize", args: ["r.rs", "-Zrandomize-layout", "-Zlayout-seed=12345"] },
  { name: "lib", args: ["l.rs", "--crate-type=lib"] },
];

let sysroot = "";
const expected: Record<string, Out> = PROBE !== undefined ? {} : JSON.parse(readFileSync(EXPECTED, "utf8"));

beforeAll(() => {
  const oracle = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
  sysroot = oracle.oracleSysroot();
  for (const f of ["r.rs", "l.rs"]) copyFileSync(join(DIR, f), join(WORK, f));
}, 120_000);

for (const c of CASES) {
  test(`repr-options oracle: ${c.name}`, async () => {
    const args = [...c.args, "--sysroot", sysroot];
    const ours = await run([process.execPath, RUNNER, ...args], WORK);
    let want: Out;
    if (PROBE !== undefined) {
      want = await run([PROBE, ...args], WORK);
      if (WRITE) {
        expected[c.name] = want;
        writeFileSync(EXPECTED, JSON.stringify(expected, null, 2) + "\n");
      }
    } else {
      want = expected[c.name]!;
    }
    // the oracle did something (guards against a case that tests nothing)
    expect(want.stdout).toContain("ReprOptions {");
    expect(ours.stderr).toBe(want.stderr);
    expect(ours.stdout).toBe(want.stdout);
    expect(ours.code).toBe(want.code);
  }, 120_000);
}
