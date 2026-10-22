// Oracle tests (not a port) of the compiler paths lane vendor-apfloat-b repointed from `unported(..)` to the vendored
// rustc_apfloat:
// - rustc_mir_build thir/constant.ts `parse_float_into_scalar` (stand-in for builder/mod.rs's): float literal patterns
//   (`lit_to_const`), f16 / f32 / f64 / f128, negated, suffixed and unsuffixed, rounding and overflow to infinity;
// - rustc_middle ty/consts/int.ts `ScalarInt::{to_f16, .., to_f128}` / `From<Half / ..> for ScalarInt` and back
//   (const_to_pat's NaN check, the printing below);
// - rustc_middle ty/print/pretty.ts: a float `ScalarInt` printed as `{}{}f32` (the THIR dump's pattern constants);
// - rustc_middle thir.ts `PatRangeBoundary::compare_with` (range patterns: E0030 `lo > hi`, E0579 empty exclusive
//   range) and ty/util.ts `numeric_min_and_max_as_bits` (half-open float range patterns `..x` / `x..`).
// The lint path (rustc_lint types/literal.ts `float_is_infinite`) is tested by src/rustc_lint/types.oracle.test.ts.
//
// Oracle: the thirdump probe (tools/probes/thirdump, rustc-dev: the tydump prefix, abort_if_errors, then the flat
// THIR of every body). Subject: src/rust_ts/thirdump.ts. stdout, stderr and the exit code must be identical. The
// cases are `#![no_core]` libraries.
//
// Without the probe this is a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { beforeAll, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, REPO } from "../../../scripts/lib/common.ts";
import { test_scratch_dir } from "../../rust_ts/test_scratch.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const PROBE = join(DATA, "target", "probes", "release", "thirdump");
const SKIP = !existsSync(PROBE) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: thirdump probe not built (bun scripts/probes.ts build thirdump); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const WORK = test_scratch_dir("apfloat-callers-oracle");
const SUBJECT = join(REPO, "src/rust_ts/thirdump.ts");
const ARGS = ["--edition", "2021", "-Ainternal_features"];

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

/** A `#![no_core]` library with the `sized` lang items, `Copy` and `Neg` (negative literal patterns need it). */
function lib(body: string, features = ""): string {
  return (
    `#![feature(lang_items, no_core, rustc_attrs${features})]\n#![no_core]\n#![crate_type = "lib"]\n` +
    '#[lang = "pointee_sized"] pub trait PointeeSized {}\n#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}\n' +
    '#[lang = "sized"] pub trait Sized: MetaSized {}\n#[lang = "copy"] pub trait Copy {}\n' +
    '#[lang = "neg"] pub trait Neg { type Output; fn neg(self) -> Self::Output; }\n' +
    neg_impls(["f32", "f64"]) +
    body
  );
}

function neg_impls(tys: string[]): string {
  return tys.map((t) => `impl Neg for ${t} { type Output = ${t}; fn neg(self) -> ${t} { loop {} } }\n`).join("");
}

interface Case {
  name: string;
  src: string;
}
const CASES: Case[] = [
  {
    name: "f32_f64_literal_patterns",
    src: lib(
      "pub fn a(x: f32) -> u8 { match x { 1.5 => 1, -2.5 => 2, 0.1 => 3, 3.4028236e38 => 4, 1e-50 => 5, 7e-46 => 6, 1e40 => 7, _ => 0 } }\n" +
        "pub fn b(x: f64) -> u8 { match x { 1e300 => 1, -0.0 => 2, 0.1 => 3, 1.7976931348623159e308 => 4, 4.9406564584124654e-324 => 5, 123456789012345678901234567890.0 => 6, _ => 0 } }\n" +
        "pub fn c(x: f32) -> u8 { match x { 2f32 => 1, 1.25_f32 => 2, 1_000.000_1 => 3, _ => 0 } }\n",
    ),
  },
  {
    name: "f16_f128_literal_patterns",
    src: lib(
      neg_impls(["f16", "f128"]) +
      "pub fn a(x: f16) -> u8 { match x { 1.5 => 1, -65504.0 => 2, 65520.0 => 3, 0.1 => 4, 1e-8 => 5, _ => 0 } }\n" +
        "pub fn b(x: f128) -> u8 { match x { 1.5 => 1, -0.1 => 2, 1e4932 => 3, 1e-4960 => 4, _ => 0 } }\n",
      ", f16, f128",
    ),
  },
  {
    name: "float_range_patterns",
    src: lib(
      "pub fn a(x: f32) -> u8 { match x { 0.0..=1.0 => 1, -2.5..3e3 => 2, ..-10.0 => 3, 5e3.. => 4, ..=-5.0 => 5, _ => 0 } }\n" +
        "pub fn b(x: f64) -> u8 { match x { -1e300..=1e300 => 1, 0.1..0.2 => 2, _ => 0 } }\n",
    ),
  },
  {
    name: "float_range_errors",
    src: lib(
      "pub fn a(x: f32) -> u8 { match x { 2.0..=1.0 => 1, 1.0..1.0 => 2, -0.0..0.0 => 3, _ => 0 } }\n" +
        "pub fn b(x: f64) -> u8 { match x { 0.30000000000000004..=0.3 => 1, 0.1..=0.1 => 2, _ => 0 } }\n",
    ),
  },
];

beforeAll(() => {
  for (const c of CASES) writeFileSync(join(WORK, `${c.name}.rs`), c.src);
});

for (const c of CASES) {
  test.skipIf(SKIP)(`rustc_apfloat callers (vendor-apfloat-b) oracle: ${c.name}`, async () => {
    const file = `${c.name}.rs`;
    const [oracle, subject] = await Promise.all([run([PROBE, file, ...ARGS], WORK), run(["bun", SUBJECT, file, ...ARGS], WORK)]);
    expect(subject.stderr).toBe(oracle.stderr);
    expect(subject.stdout).toBe(oracle.stdout);
    expect(subject.code).toBe(oracle.code);
  }, 120_000);
}
