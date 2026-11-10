// Tests of the graphviz writers (lane dataflow-graphviz): framework/graphviz.ts (`-Zdump-mir-dataflow`),
// rustc_borrowck region_infer/graphviz.ts (`nll.0.regioncx.{all,scc}.dot`) and rustc_middle mir/graphviz.ts
// (`-Zdump-mir-graphviz`), against the oracle.
//
// Fixture: graphviz_oracle/, made from the oracle with (cwd graphviz_oracle/):
//   rustc +nightly dataflow.rs --crate-type=lib --edition=2021 -Zdump-mir=f -Zdump-mir-dataflow \
//     -Zdump-mir-graphviz -Zdump-mir-dir=<tmp> --emit=metadata -o <tmp>/x.rmeta
// keeping the `.dot` files listed in `DOTS`: a forward analysis with a call-return row (maybe_uninit), borrows,
// a backward analysis (liveness), both region graphs, and one MIR graph. `dataflow.rs` is `#![no_core]`, so neither
// side needs a sysroot. With the pinned toolchain available the test re-runs the oracle and requires the fixture to be
// current; `REGEN=1 bun test src/rustc_mir_dataflow/framework/graphviz.test.ts` rewrites it.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DenseBitSet } from "../../rustc_index/bit_set.ts";
import type { Local } from "../../rustc_middle/mir/mod.ts";
import { PIN, REPO } from "../../../scripts/lib/common.ts";
import { DebugWithContext_DenseBitSet, DebugWithContext_Local } from "./fmt.ts";
import { diff_pretty } from "./graphviz.ts";

const DIR = join(import.meta.dir, "graphviz_oracle");
const CASE = "dataflow.rs";
const DOTS = [
  "dataflow.f.-------.maybe_uninit.borrowck.dot",
  "dataflow.f.-------.borrows.borrowck.dot",
  "dataflow.f.-------.liveness-lint.-----.dot",
  "dataflow.f.-------.nll.0.regioncx.all.dot",
  "dataflow.f.-------.nll.0.regioncx.scc.dot",
  "dataflow.f.1-1-000.built.after.dot",
];
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ARGS = ["--crate-type=lib", "--edition=2021", "-Zdump-mir=f", "-Zdump-mir-dataflow", "-Zdump-mir-graphviz"];

function rustc_at_pin(): boolean {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 && r.stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}

/** Runs `cmd ... dataflow.rs ARGS` in graphviz_oracle/ with its dumps in a fresh directory; returns the `.dot` files of `DOTS`. */
function run_dumps(cmd: string[]): { code: number | null; stderr: string; dots: Map<string, string> } {
  const tmp = mkdtempSync(join(tmpdir(), "dataflow-graphviz-"));
  try {
    const r = Bun.spawnSync([...cmd, CASE, ...ARGS, `-Zdump-mir-dir=${tmp}`, "--emit=metadata", "-o", join(tmp, "x.rmeta")], {
      cwd: DIR,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" },
    });
    const dots = new Map<string, string>();
    for (const name of DOTS) {
      try {
        dots.set(name, readFileSync(join(tmp, name), "utf8"));
      } catch {
        // missing: the comparison below reports it
      }
    }
    return { code: r.exitCode, stderr: r.stderr.toString(), dots };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- diff_pretty --------------------------------------------------------------------------------

const LocalSet = DebugWithContext_DenseBitSet<Local, unknown>(DebugWithContext_Local);
const set = (...xs: number[]): DenseBitSet<Local> => {
  const s = DenseBitSet.new_empty<Local>(32);
  for (const x of xs) s.insert(x as Local);
  return s;
};

test("diff_pretty: equal states print nothing", () => {
  expect(diff_pretty(set(1, 2), set(1, 2), undefined, LocalSet)).toBe("");
});

// The expected cells are copied from the oracle's graphviz_oracle/*.dot.
test("diff_pretty: removal, additions, and both (oracle cells)", () => {
  expect(diff_pretty(set(), set(0), undefined, LocalSet)).toBe('<font color="red">-_0</font>');
  expect(diff_pretty(set(9, 10), set(), undefined, LocalSet)).toBe('<font color="darkgreen">+_9<br align="left"/></font><font color="darkgreen">+_10</font>');
  expect(diff_pretty(set(20), set(19), undefined, LocalSet)).toBe('<font color="darkgreen">+_20<br align="left"/></font><font color="red">-_19</font>');
});

// ---- the writers, end to end ---------------------------------------------------------------------

test(
  "the port writes the oracle's .dot files",
  () => {
    const port = run_dumps([process.execPath, join(REPO, "src/rust_ts/main.ts")]);
    expect(port.stderr).toBe("");
    expect(port.code).toBe(0);
    for (const name of DOTS) {
      const want = readFileSync(join(DIR, name), "utf8");
      const got = port.dots.get(name);
      expect(got === undefined ? `ERROR: ${name} not written` : got === want ? "same" : `ERROR: ${name} differs`).toBe("same");
    }
  },
  120_000,
);

test(
  "the graphviz_oracle fixture is the current oracle output",
  () => {
    if (!rustc_at_pin()) {
      if (REQUIRE) throw new Error(`ERROR: rustc +${PIN.toolchain} at ${PIN.commit} unavailable`);
      return;
    }
    const oracle = run_dumps(["rustc", `+${PIN.toolchain}`]);
    expect(oracle.code).toBe(0);
    for (const name of DOTS) {
      expect(oracle.dots.get(name) === readFileSync(join(DIR, name), "utf8") ? "same" : `ERROR: ${name} is stale`).toBe("same");
    }
  },
  120_000,
);

if (process.env.REGEN === "1" && rustc_at_pin()) {
  const oracle = run_dumps(["rustc", `+${PIN.toolchain}`]);
  for (const [name, text] of oracle.dots) writeFileSync(join(DIR, name), text);
}
