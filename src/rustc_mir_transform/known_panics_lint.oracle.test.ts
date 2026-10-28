// Oracle checks of `KnownPanicsLint` (lane mt-kpl-ubchecks: the `arithmetic_overflow` / `unconditional_panic` lints)
// against the pinned nightly rustc.
//
// Each case runs the test driver known_panics_lint_oracle/run.ts (see its header): the ported driver through type
// checking, the MIR loop of `run_required_analyses` without `mir_borrowck`, and the lint on each `mir_promoted` body
// where rustc runs `mir_drops_elaborated_and_const_checked`. The oracle compiles the same file with codegen
// (`--emit=obj`: the lint runs only when `should_codegen()` or in a const context), target x86_64-unknown-linux-gnu,
// the oracle sysroot. The cases avoid what the driver skips (borrowck errors, drops, coroutines), so the complete
// stderr and the exit code of both sides must be equal, and the oracle's stderr must contain the diagnostics under
// test. The cases are in known_panics_lint_oracle/cases/. (tests/ui cases do not fit yet: those tried stop in
// rustc_borrowck when the lint evaluates a promoted constant (CTFE runs `mir_borrowck`), or emit late lints the driver
// does not run; see docs/handoff/mt-kpl-ubchecks.md.)
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
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

const WORK = join(DATA, "tmp", "kpl-oracle", process.env.RUST_TS_AGENT ?? "default");
mkdirSync(WORK, { recursive: true });
const CASES_DIR = join(import.meta.dir, "known_panics_lint_oracle", "cases");
const RUNNER = join(REPO, "src/rustc_mir_transform/known_panics_lint_oracle/run.ts");

const ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_BACKTRACE"].includes(k)) ENV[k] = v;
}
interface Out {
  stderr: string;
  code: number;
}
function run(cmd: string[], cwd: string): Out {
  const r = Bun.spawnSync(cmd, { cwd, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}
let SYSROOT: string | undefined;
const sysroot = (): string => (SYSROOT ??= Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim());
const args = (edition: string, extra: string[]): string[] => [
  "--target",
  "x86_64-unknown-linux-gnu",
  "--sysroot",
  sysroot(),
  `--edition=${edition}`,
  "--emit=obj",
  "-o",
  join(WORK, "out.o"),
  ...extra,
];

function compare(cwd: string, file: string, a: string[], expected: string[]): void {
  const oracle = run([...RUSTC, ...a, file], cwd);
  const ours = run([process.execPath, RUNNER, ...a, file], cwd);
  expect(ours.stderr).not.toContain("rust-ts: ");
  if (ours.stderr !== oracle.stderr) {
    // Show the first differing line.
    const ol = oracle.stderr.split("\n");
    const pl = ours.stderr.split("\n");
    let k = 0;
    while (k < pl.length && ol[k] === pl[k]) k++;
    expect(`line ${k + 1}: ${pl[k]}`).toBe(`line ${k + 1}: ${ol[k]}`);
  }
  expect(ours.code).toBe(oracle.code);
  for (const e of expected) expect(oracle.stderr).toContain(e);
}

interface Case {
  file: string;
  /** Text the oracle's stderr must contain (the diagnostics under test were really emitted). */
  expect: string[];
}

const HAND: Case[] = [
  {
    file: "arith.rs",
    expect: [
      "error: this arithmetic operation will overflow",
      "attempt to shift left by `8_i32`, which would overflow",
      "attempt to compute `u8::MAX + 1_u8`, which would overflow",
      "attempt to negate `i8::MIN`, which would overflow",
      "error: this operation will panic at runtime",
      "attempt to divide `10_i32` by zero",
      "attempt to calculate the remainder of `10_i32` with a divisor of zero",
      "attempt to compute `i8::MIN / -1_i8`, which would overflow",
      "attempt to compute `44_u8 + 250_u8`, which would overflow",
    ],
  },
  // An array's length is a `Const::Ty` value: `eval_mir_constant` runs the `valtree_to_const_val` query (key
  // `ty::Value`, lane key-value; this case pinned that stop before).
  { file: "bounds.rs", expect: ["error: this operation will panic at runtime", "index out of bounds: the length is 3 but the index is 5"] },
];

for (const c of HAND) {
  test.skipIf(SKIP)(`oracle: ${c.file}`, () => {
    // the fixture really has the source the expectations talk about
    expect(readFileSync(join(CASES_DIR, c.file), "utf8").length).toBeGreaterThan(0);
    compare(CASES_DIR, c.file, args("2021", []), c.expect);
  }, 300_000);
}

// CheckAlignment / CheckNull / CheckEnums: the driver's `KPL_ORACLE_UB_PASSES=1` dump (see run.ts) against rustc's
// `-Zdump-mir` files. Every fn of ub_checks.rs has a `mir_promoted` text equal to rustc's "before CheckAlignment" text
// (checked: the `// before` sections), so the three "after" texts must be equal too.
test.skipIf(SKIP)("oracle: ub_checks.rs (CheckAlignment, CheckNull, CheckEnums)", () => {
  const dir = join(WORK, "dump-mir");
  rmSync(dir, { recursive: true, force: true });
  const a = args("2021", ["-Zub-checks=yes"]);
  const oracle = run([...RUSTC, ...a, "-Zdump-mir=CheckAlignment|CheckNull|CheckEnums", `-Zdump-mir-dir=${dir}`, "ub_checks.rs"], CASES_DIR);
  const r = Bun.spawnSync([process.execPath, RUNNER, ...a, "ub_checks.rs"], {
    cwd: CASES_DIR,
    env: { ...ENV, KPL_ORACLE_UB_PASSES: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const ours = { stdout: r.stdout.toString(), stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
  expect(ours.stderr).toBe(oracle.stderr);
  expect(ours.code).toBe(oracle.code);
  const files = readdirSync(dir);
  const parts = ours.stdout.split(/^\/\/ (before|after \S+)\n/m);
  let sections = 0;
  for (let i = 1; i < parts.length; i += 2) {
    const tag = parts[i]!;
    const body = parts[i + 1]!;
    const name = /^fn (\w+)\(/m.exec(body)![1]!;
    const [pass, kind] = tag === "before" ? ["CheckAlignment", "before"] : [tag.split(" ")[1]!, "after"];
    const file = files.find((f) => f.startsWith(`ub_checks.${name}.`) && f.endsWith(`.${pass}.${kind}.mir`));
    expect(`${name} ${pass} ${kind}: ${file !== undefined}`).toBe(`${name} ${pass} ${kind}: true`);
    // The dump file starts with `// MIR for `<fn>` <kind> <pass>` and an empty line.
    const expected = readFileSync(join(dir, file!), "utf8").split("\n").slice(2).join("\n");
    expect(`${name} ${pass} ${kind}:\n${body}`).toBe(`${name} ${pass} ${kind}:\n${expected}`);
    sections += 1;
  }
  // 10 fns, each `before` + 3 passes
  expect(sections).toBe(40);
  expect(ours.stdout).toContain("misaligned pointer dereference");
  expect(ours.stdout).toContain("null pointer dereference occurred");
  expect(ours.stdout).toContain("trying to construct an enum from an invalid value");
}, 300_000);
