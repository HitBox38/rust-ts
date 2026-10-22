// Oracle checks of rustc_peek.rs and the analyses it observes (lane dataflow-impls): `MaybeInitializedPlaces`,
// `MaybeUninitializedPlaces` (with MoveData, lane dataflow-move-paths) and `MaybeLiveLocals`, on MIR built by the port.
//
// Each case is a crate whose one annotated fn carries `#[rustc_mir(rustc_peek_.., stop_after_dataflow)]`: the oracle
// reports the peeks whose bit is not set while building that fn's MIR (`mir_built`'s `Lint(SanityCheck)`), then stops
// with the fatal `stop_after_dataflow ended compilation`. The port runs rustc_peek_oracle/run.ts (see its header: the
// analysis prefix, then `check_unsafety` per body owner with the real `mir_built`, whose pass list ends in
// `Lint(SanityCheck)`). The complete stderr and the exit code must be equal. Cases: the `tests/ui/mir-dataflow` UI tests
// and rustc_peek_oracle/*.rs (loops, calls, moves out of tuple fields, an untracked place, enum matches with drops,
// liveness across a loop). Target x86_64-unknown-linux-gnu with the oracle sysroot (std loads from metadata).
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO, UPSTREAM } from "../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
function rustcAvailable(): boolean {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}
const HAVE = rustcAvailable();
const SKIP = !HAVE && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const WORK = join(DATA, "tmp", "rustc-peek-oracle", process.env.RUST_TS_AGENT ?? "default");
mkdirSync(WORK, { recursive: true });
const RUNNER = join(REPO, "src/rustc_mir_dataflow/rustc_peek_oracle/run.ts");

const ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_BACKTRACE"].includes(k)) ENV[k] = v;
}
interface Out {
  stderr: string;
  code: number;
}
function run(cmd: string[]): Out {
  const r = Bun.spawnSync(cmd, { cwd: WORK, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}
const sysroot = (): string => Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim();

const UI = join(UPSTREAM, "tests/ui/mir-dataflow");
const CASES: [string, string][] = [
  ...readdirSync(UI)
    .filter((f) => f.endsWith(".rs"))
    .sort()
    .map((f): [string, string] => [f, join(UI, f)]),
  ...readdirSync(join(import.meta.dir, "rustc_peek_oracle"))
    .filter((f) => f.endsWith(".rs"))
    .sort()
    .map((f): [string, string] => [f, join(import.meta.dir, "rustc_peek_oracle", f)]),
];

test("the cases exist (6 UI tests + 3 own)", () => {
  expect(CASES.length).toBe(9);
});

for (const [name, file] of CASES) {
  test.skipIf(SKIP)(`rustc_peek: ${name}`, () => {
    const a = ["--target", "x86_64-unknown-linux-gnu", "--sysroot", sysroot(), "--edition=2015", "--emit=metadata", "-o", join(WORK, "out.rmeta")];
    const oracle = run([...RUSTC, ...a, file]);
    const ours = run([process.execPath, RUNNER, ...a, file]);
    // the oracle really ran the dataflow and stopped after it
    expect(oracle.stderr).toContain("error: stop_after_dataflow ended compilation");
    expect(ours.stderr).not.toContain("rust-ts: ");
    if (ours.stderr !== oracle.stderr) {
      const ol = oracle.stderr.split("\n");
      const pl = ours.stderr.split("\n");
      let k = 0;
      while (k < pl.length && ol[k] === pl[k]) k++;
      expect(`line ${k + 1}: ${pl[k]}`).toBe(`line ${k + 1}: ${ol[k]}`);
    }
    expect(ours.code).toBe(oracle.code);
  });
}
