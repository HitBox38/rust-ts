// Oracle tests for rustc_passes/src/check_attr.rs, stability.rs and lib_features.rs (lane passes-b): the
// `check_mod_attrs` and `check_mod_unstable_api_usage` queries (attribute validation, stability and feature checks).
//
// Oracle: the tydump probe (tools/probes/tydump, rustc-dev), whose prefix runs `run_required_analyses` up to type
// checking: misc_checking_1 runs both queries per module. Subject: src/rustc_passes/oracle/attr_stab_run.ts (the
// ported driver; AST lowering, then both queries per module, then stop). stderr and the exit code must be identical.
// The cases are chosen so that the rest of the probe's prefix (entry_fn, emit_delayed_lints, typeck, ...) emits
// nothing: `#![no_core]` libraries with the `sized` lang items, no delayed attribute lints.
//
// PENDING cases stop at an unported piece outside this lane; each must reach exactly the listed `unported(..)`. When
// that piece lands, the case must match the oracle: delete its PENDING entry.
//
// Without the probe this is a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { beforeAll, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, REPO } from "../../scripts/lib/common.ts";
import { test_scratch_dir } from "../rust_ts/test_scratch.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const PROBE = join(DATA, "target", "probes", "release", "tydump");
const SKIP = !existsSync(PROBE) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: tydump probe not built (bun scripts/probes.ts build tydump); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const WORK = test_scratch_dir("check-attr-stability-oracle");
const RUNNER = join(REPO, "src/rustc_passes/oracle/attr_stab_run.ts");

const ENV: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE"].includes(k)) ENV[k] = v;
}

interface Out {
  stderr: string;
  code: number;
}
async function run(cmd: string[], cwd: string): Promise<Out> {
  const p = Bun.spawn(cmd, { cwd, env: ENV, stdout: "ignore", stderr: "pipe" });
  const [stderr, code] = await Promise.all([new Response(p.stderr).text(), p.exited]);
  return { stderr, code };
}

/** A `#![no_core]` library with the `sized` lang items (typeck of the probe needs them), plus `features`. */
function lib(features: string[], body: string, crate_attrs = ""): string {
  return (
    `#![feature(${["lang_items", "no_core", ...features].join(", ")})]\n#![no_core]\n#![crate_type = "lib"]\n${crate_attrs}` +
    '#[lang = "pointee_sized"] pub trait PointeeSized {}\n#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}\n#[lang = "sized"] pub trait Sized: MetaSized {}\n' +
    body
  );
}

interface Case {
  name: string;
  src: string;
}
const CASES: Case[] = [
  // check_repr: no errors
  { name: "repr_ok", src: lib([], "#[repr(C)]\npub struct S(u8);\n#[repr(u8)]\npub enum E { A, B }\n#[repr(transparent)]\npub struct U(u8);\n") },
  // check_repr: E0692 (transparent + other hints), E0566 (Rust + C)
  { name: "repr_errors", src: lib([], "#[repr(transparent, C)]\npub struct S;\n#[repr(Rust, C)]\npub struct T;\n#[repr(Rust, u8)]\npub enum E { A }\n") },
  // check_doc_alias_value: bad location (impl block, trait-impl assoc const), same as the item's name
  {
    name: "doc_alias",
    src: lib(
      [],
      'pub struct S;\n#[doc(alias = "x")]\nimpl S {}\n#[doc(alias = "f")]\npub fn f() {}\npub trait T { #[doc(alias = "y")] type A; const C: u8; }\n' +
        'impl T for S { type A = S; #[doc(alias = "z")] const C: u8 = 0; }\n',
    ),
  },
  // check_doc_keyword_and_attribute, check_doc_fake_variadic, check_doc_search_unbox
  {
    name: "doc_keyword",
    src: lib(
      ["rustdoc_internals"],
      '#[doc(keyword = "match")]\nmod m {}\n#[doc(keyword = "while")]\nconst _: () = ();\n#[doc(attribute = "inline")]\nmod n {}\n' +
        "#[doc(fake_variadic)]\npub struct S;\n#[doc(search_unbox)]\npub struct T;\n#[doc(search_unbox)]\npub struct G<X>(X);\n",
    ),
  },
  // check_rustc_must_implement_one_of: no default, not a function, not found
  {
    name: "must_implement_one_of",
    src: lib(
      ["rustc_attrs"],
      "#[rustc_must_implement_one_of(a, b)]\npub trait T { fn a(); fn b() {} }\n#[rustc_must_implement_one_of(c, X)]\npub trait U { fn c() {} type X; }\n" +
        "#[rustc_must_implement_one_of(d, e)]\npub trait V { fn d() {} }\n",
    ),
  },
  // check_may_dangle outside a `Drop` impl
  { name: "may_dangle", src: lib(["dropck_eyepatch"], "pub struct S<#[may_dangle] T>(T);\npub struct L<#[may_dangle] 'a>(&'a u8);\n") },
  // check_linkage: `const fn`
  { name: "linkage", src: lib(["linkage"], '#[linkage = "weak"]\npub const fn f() {}\n#[linkage = "weak"]\npub fn g() {}\n') },
  // check_unused_or_stable_features: E0635 unknown features
  { name: "unknown_feature", src: lib(["nonexistent_featur", "lang_itemz"], "") },
  // the stability checker walks every path (check_stability_allow_unstable on items without stability)
  { name: "paths", src: lib([], "pub mod a { pub mod b { pub struct S; } }\npub use a::b::S;\npub use a::{b, b::S as T};\npub fn f(_: a::b::S) {}\n") },
  // ---- PENDING (see below) ----
  // check_repr: REPEATED_REPRS lint
  { name: "lint_repeated_repr", src: lib([], "#[repr(C)]\n#[repr(C)]\npub struct S(u8);\n") },
  // check_unused_attribute: `#[allow()]`
  { name: "lint_unused_empty_allow", src: lib([], "#[allow()]\npub fn f() {}\n") },
  // check_optimize_and_inline (an error) after the STABLE_FEATURES lint of `optimize_attribute`
  { name: "optimize_inline", src: lib(["optimize_attribute"], "#[optimize(none)]\n#[inline]\npub fn f() {}\n#[optimize(none)]\n#[inline(never)]\npub fn g() {}\n") },
  // staged_api: MissingStabilityAnnotations (missing stability, deprecated before stable)
  {
    name: "staged_api",
    src: lib(
      ["staged_api"],
      'pub fn missing() {}\n#[deprecated(since = "1.0.0", note = "x")]\n#[stable(feature = "b", since = "1.1.0")]\npub fn depr() {}\n',
      '#![stable(feature = "a", since = "1.0.0")]\n',
    ),
  },
];

/** Cases that stop at a piece another lane ports, with the `unported(..)` text they must reach. */
const SHALLOW = "rustc_lint::levels::shallow_lint_levels_on (tcx.hir_attr_map / hir_owner_node: HIR, M3)";
const PENDING: Record<string, string> = {
  staged_api: "constness provider (not ported)",
};

const ARGS = ["--edition", "2021", "-Zui-testing"];

beforeAll(() => {
  for (const c of CASES) writeFileSync(join(WORK, `${c.name}.rs`), c.src);
});

for (const c of CASES) {
  test.skipIf(SKIP)(`check_attr/stability oracle: ${c.name}`, async () => {
    const file = `${c.name}.rs`;
    const [oracle, subject] = await Promise.all([run([PROBE, file, ...ARGS], WORK), run(["bun", RUNNER, file, ...ARGS], WORK)]);
    const pending = PENDING[c.name];
    if (pending !== undefined) {
      expect(subject.code).toBe(70);
      expect(subject.stderr).toContain(`rust-ts: unported: ${pending}\n`);
      return;
    }
    expect(subject.stderr).toBe(oracle.stderr);
    expect(subject.code).toBe(oracle.code);
  }, 120_000);
}
