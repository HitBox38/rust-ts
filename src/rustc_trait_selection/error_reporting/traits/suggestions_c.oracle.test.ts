// Oracle tests for lane errrep-sugg-c: compiler/rustc_trait_selection/src/error_reporting/traits/suggestions.rs:5018..7379.
//
// Oracle: the tydump probe (tools/probes/tydump, rustc-dev), whose prefix runs `run_required_analyses` up to type
// checking. Subject: src/rust_ts/tydump.ts (the ported driver, same stop point). stdout, stderr and the exit code must be
// identical. The cases are `#![no_core]` libraries whose only errors come from type checking:
// - `ret_prims`, `ret_items`: E0069 (`return;` in a fn returning a value, rustc_hir_typeck coercion.rs), whose
//   "give the `return` a value of the expected type" suggestion is `TypeErrCtxt::ty_kind_suggestion` (suggestions.rs:6394):
//   every arm (integers, floats, bool, char, tuples incl. the 1-tuple, `&str`, `&mut T`, slices, arrays of length 0 /
//   1 / `Copy` / non-`Copy` elements, the `Option` / `Result` / `Vec` / `String` diagnostic items, `Box`, `Default`
//   impls, the `/* value */` fallback).
// - `missing_consts`: E0046 with missing associated consts (rustc_hir_analysis check/mod.rs `missing_items_err` calls
//   `ty_kind_suggestion` for each const's suggestion).
// The other ported paths of this range are reached from `report_selection_error` / `note_obligation_cause_code`
// (lanes errrep-traits-a/-b, errrep-sugg-b): see docs/handoff/errrep-sugg-c.md.
//
// Without the probe this is a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { beforeAll, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, REPO } from "../../../../scripts/lib/common.ts";
import { test_scratch_dir } from "../../../rust_ts/test_scratch.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const PROBE = join(DATA, "target", "probes", "release", "tydump");
const SKIP = !existsSync(PROBE) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: tydump probe not built (bun scripts/probes.ts build tydump); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const WORK = test_scratch_dir("errrep-sugg-c-oracle");
const SUBJECT = join(REPO, "src/rust_ts/tydump.ts");
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

/** A `#![no_core]` library with the `sized` lang items and `Copy`. */
function lib(body: string): string {
  return (
    '#![feature(lang_items, no_core, rustc_attrs)]\n#![no_core]\n#![crate_type = "lib"]\n' +
    '#[lang = "pointee_sized"] pub trait PointeeSized {}\n#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}\n' +
    '#[lang = "sized"] pub trait Sized: MetaSized {}\n#[lang = "copy"] pub trait Copy {}\n' +
    body
  );
}

interface Case {
  name: string;
  src: string;
}
const CASES: Case[] = [
  {
    name: "ret_prims",
    src: lib(
      "pub struct S;\n" +
        "pub fn a() -> u32 { return; }\npub fn b() -> (bool, char, i8) { return; }\npub fn c() -> &'static str { return; }\n" +
        "pub fn d() -> &'static mut f64 { return; }\npub fn e() -> S { return; }\npub fn f() -> (u8,) { return; }\n" +
        "pub fn g() -> [u8; 0] { return; }\npub fn h() -> &'static [u16] { return; }\n",
    ),
  },
  {
    name: "ret_items",
    src: lib(
      "impl Copy for u8 {}\n" +
        '#[rustc_diagnostic_item = "Option"] pub enum Option<T> { None, Some(T) }\n' +
        '#[rustc_diagnostic_item = "Result"] pub enum Result<T, E> { Ok(T), Err(E) }\n' +
        '#[rustc_diagnostic_item = "Vec"] pub struct Vec<T>(T);\n' +
        '#[rustc_diagnostic_item = "String"] pub struct String;\n' +
        '#[lang = "owned_box"] pub struct Box<T: ?Sized>(*const T);\n' +
        '#[rustc_diagnostic_item = "Default"] pub trait Default { fn default() -> Self; }\n' +
        "pub struct D;\nimpl Default for D { fn default() -> D { D } }\npub struct S;\n" +
        "pub fn a() -> Option<S> { return; }\npub fn b() -> Result<Option<u8>, S> { return; }\npub fn c() -> Vec<u8> { return; }\n" +
        "pub fn d() -> String { return; }\npub fn e() -> Box<char> { return; }\npub fn f() -> D { return; }\n" +
        "pub fn g() -> [u8; 3] { return; }\npub fn h() -> [S; 2] { return; }\npub fn i() -> [S; 1] { return; }\n" +
        "pub fn j() -> Result<S, u8> { return; }\npub fn k() -> &'static mut [D; 2] { return; }\npub fn l() -> *const u8 { return; }\n",
    ),
  },
  {
    name: "missing_consts",
    src: lib("pub trait T { const N: u32; const M: (bool, char); const O: &'static str; }\npub struct S;\nimpl T for S {}\n"),
  },
];

beforeAll(() => {
  for (const c of CASES) writeFileSync(join(WORK, `${c.name}.rs`), c.src);
});

for (const c of CASES) {
  test.skipIf(SKIP)(`suggestions.rs (errrep-sugg-c) oracle: ${c.name}`, async () => {
    const file = `${c.name}.rs`;
    const [oracle, subject] = await Promise.all([run([PROBE, file, ...ARGS], WORK), run(["bun", SUBJECT, file, ...ARGS], WORK)]);
    expect(subject.stderr).toBe(oracle.stderr);
    expect(subject.stdout).toBe(oracle.stdout);
    expect(subject.code).toBe(oracle.code);
  }, 120_000);
}
