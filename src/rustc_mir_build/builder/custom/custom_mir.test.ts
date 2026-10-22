// Tests of lane mb-custom-tail: `#[custom_mir]` bodies (builder/custom/{mod, parse, parse/instruction}.rs) through the
// driver, against the oracle.
//
// custom_mir_test/run.ts runs the ported driver, then `construct_fn` (-> `custom::build_custom_mir`) on every
// `#[custom_mir]` body owner and prints each body as `MirWriter::write_mir_fn` does (see its header). Fixtures (`REGEN=1`
// rewrites them from the pinned rustc): `<case>.stderr` / `<case>.exit` are the oracle's output and exit status;
// `<case>.mir` is the oracle's `-Zdump-mir=built` files of those bodies without their two header lines (`// MIR for ..`
// and a blank line), in source order. Both sides get `-Zdump-mir` (it also exempts the trimmed-paths printing from
// rustc's "diagnostics were expected" check).
// - custom_basic: every dialect / phase pair `parse_attribute` maps, `parse_args` / `parse_body` (block, local and
//   debuginfo decls, cleanup blocks), statements (`StorageLive` / `StorageDead`, assignments), rvalues (`Ref`,
//   `RawPtr`, `BinaryOp` incl. `Checked` / `Offset`, `UnaryOp`, `Cast` via `mir_cast_kind`, tuple / ADT aggregates,
//   `Discriminant`), operands (`Copy` / `Move`), places (fields, deref, index), terminators (`Goto`, `Return`,
//   `Unreachable`, `UnwindResume`, `Drop`, `SwitchInt` from `match`).
// - custom_error: `span_fatal` "Could not parse local, found: .." (`expr_error`'s `{:?}` of the THIR `ExprKind`).
// PENDING (pinned to the exact stop): custom_const: `parse_integer_literal` -> `as_constant_inner` (lane mb-expr-a).
import { expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN } from "../../../../scripts/lib/common.ts";
import { test_scratch_dir } from "../../../rust_ts/test_scratch.ts";

const DIR = join(import.meta.dir, "custom_mir_test");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
const WORK = test_scratch_dir("mb-custom-tail-custom-mir");

const CASES = ["custom_basic", "custom_error"] as const;
/** Cases whose port run stops at unported code today: the case and its exact stop. */
const PENDING: Record<string, string> = {
  custom_const: "rustc_mir_build::builder::expr::as_constant::as_constant_inner",
};

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../../../scripts/lib/oracle.ts") as typeof import("../../../../scripts/lib/oracle.ts");
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

const args = (sysroot: string, c: string, dump: string): string[] => [
  "--target",
  "x86_64-unknown-linux-gnu",
  "--sysroot",
  sysroot,
  "--edition=2021",
  "-Zui-testing",
  "-Zdump-mir=built",
  `-Zdump-mir-dir=${dump}`,
  `${c}.rs`,
];

function run(cmd: string[]): { exit: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

/** The oracle's output for case `c`: exit, stderr and the built MIR dumps (header lines dropped, source order). */
function oracle(s: string, c: string): { exit: number; stderr: string; mir: string } {
  const dump = join(WORK, `dump-${c}`);
  rmSync(dump, { recursive: true, force: true });
  mkdirSync(dump, { recursive: true });
  const r = run(["rustc", `+${PIN.toolchain}`, ...args(s, c, dump), "--emit=metadata", "-o", join(WORK, `${c}.rmeta`)]);
  const src = readFileSync(join(DIR, `${c}.rs`), "utf8");
  const files = readdirSync(dump).filter((f) => f.endsWith(".built.after.mir"));
  const at = (f: string) => src.indexOf(`fn ${f.split(".")[1]}(`);
  files.sort((a, b) => at(a) - at(b));
  const mir = files.map((f) => readFileSync(join(dump, f), "utf8").split("\n").slice(2).join("\n")).join("");
  return { exit: r.exit, stderr: r.stderr, mir };
}

const ALL = [...CASES, ...Object.keys(PENDING)];

if (REGEN) {
  const s = sysroot();
  if (s === undefined || !rustc_at_pin()) throw new Error("ERROR: REGEN needs the pinned toolchain");
  for (const c of ALL) {
    const o = oracle(s, c);
    writeFileSync(join(DIR, `${c}.stderr`), o.stderr);
    writeFileSync(join(DIR, `${c}.exit`), `${o.exit}\n`);
    writeFileSync(join(DIR, `${c}.mir`), o.mir);
  }
}

const expected = (c: string) => ({
  exit: Number(readFileSync(join(DIR, `${c}.exit`), "utf8").trim()),
  stderr: readFileSync(join(DIR, `${c}.stderr`), "utf8"),
  mir: readFileSync(join(DIR, `${c}.mir`), "utf8"),
});

test("custom_mir_test fixtures are the current oracle output", () => {
  const s = sysroot();
  if (s === undefined || !rustc_at_pin()) {
    if (REQUIRE) throw new Error("ERROR: pinned toolchain missing");
    return;
  }
  for (const c of ALL) expect({ c, ...oracle(s, c) }).toEqual({ c, ...expected(c) });
}, 120_000);

for (const c of CASES) {
  test(`custom_mir_test/${c}.rs: the built #[custom_mir] bodies equal the oracle's`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const r = run(["bun", join(DIR, "run.ts"), ...args(s, c, join(WORK, "port-dump"))]);
    expect({ exit: r.exit, stderr: r.stderr, mir: r.stdout }).toEqual(expected(c));
  }, 120_000);
}

for (const [c, stop] of Object.entries(PENDING)) {
  test(`custom_mir_test/${c}.rs: PENDING, stops at ${stop}`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const r = run(["bun", join(DIR, "run.ts"), ...args(s, c, join(WORK, "port-dump"))]);
    expect({ exit: r.exit, stderr: r.stderr }).toEqual({ exit: 70, stderr: `rust-ts: unported: ${stop}\n` });
  }, 120_000);
}
