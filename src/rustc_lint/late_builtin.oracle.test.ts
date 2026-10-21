// Oracle checks of the late lint driver (late.rs) and the late passes of builtin.rs against the pinned nightly rustc.
// The subject is src/rustc_lint/late_oracle/run.ts (see its header): the ported driver, `run_required_analyses_prefix`
// (typeck of every body), `analysis`'s abort on non-lint errors, the listed late passes on every module through
// `late_lint_mod` (`--late-pass`), `check_expectations(None)`. The oracle compiles the same file as a lib with std
// (`--emit=metadata`); each case only has diagnostics the listed passes produce, so stderr and the exit code must be
// identical.
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
//
// Other late lint lanes: copy this file (harness part), change WORK's directory name and the CASES.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO } from "../../scripts/lib/common.ts";

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

const WORK = join(DATA, "tmp", "late-builtin-oracle", process.env.RUST_TS_AGENT ?? "default");
mkdirSync(WORK, { recursive: true });

const ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE"].includes(k)) ENV[k] = v;
}
interface Out {
  stderr: string;
  code: number;
}
function run(cmd: string[]): Out {
  const r = Bun.spawnSync(cmd, { cwd: WORK, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}
let SYSROOT: string | undefined;
const sysroot = (): string => (SYSROOT ??= Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim());

interface Case {
  name: string;
  /** `<file relative to src/rustc_lint>:<pass export>`, in lib.rs order. */
  passes: string[];
  src: string[];
  edition?: string;
  flags?: string[];
  /** Text the oracle's output must contain (the diagnostics under test were really emitted). */
  expect: string[];
}

const B = (pass: string): string => `builtin.ts:${pass}`;

const CASES: Case[] = [
  {
    name: "NonShorthandFieldPatterns: `x: x`, `y: ref y`, shorthand and macro-expanded fields are skipped",
    passes: [B("NonShorthandFieldPatterns")],
    src: [
      "pub struct Point { pub x: i32, pub y: i32 }",
      "macro_rules! pat { ($p:ident) => { Point { x: $p, y: _ } } }",
      "pub fn f(p: Point) -> i32 {",
      "    match p {",
      "        Point { x: x, y: ref y } => x + *y,",
      "    }",
      "}",
      "pub fn g(p: Point) -> i32 { let Point { x, y: z } = p; x + z }",
      "pub fn h(p: Point) -> i32 { let pat!(x) = p; x }",
    ],
    expect: ["the `x:` in this pattern is redundant", "the `y:` in this pattern is redundant"],
  },
];

for (const [i, c] of CASES.entries()) {
  test.skipIf(SKIP)(`late lints: ${c.name}`, () => {
    const file = `case${i}.rs`;
    writeFileSync(join(WORK, file), c.src.join("\n") + "\n");
    const args = [
      "--target",
      "x86_64-unknown-linux-gnu",
      "--sysroot",
      sysroot(),
      `--edition=${c.edition ?? "2021"}`,
      "--crate-type=lib",
      "--emit=metadata",
      "-o",
      `case${i}.rmeta`,
      ...(c.flags ?? []),
      file,
    ];
    const oracle = run([...RUSTC, ...args]);
    const ours = run([process.execPath, join(REPO, "src/rustc_lint/late_oracle/run.ts"), ...c.passes.map((p) => `--late-pass=${p}`), ...args]);
    for (const e of c.expect) expect(oracle.stderr).toContain(e);
    expect(ours.stderr).toBe(oracle.stderr);
    expect(ours.code).toBe(oracle.code);
  });
}
