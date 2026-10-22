// Oracle checks of the late lint passes ported by lane lint-late-e1 (async_closures, async_fn_in_trait, autorefs,
// c_void_returns, default_could_be_derived, deref_into_dyn_supertrait, disallowed_pass_by_ref,
// enum_intrinsics_non_enums, for_loops_over_fallibles, function_cast_as_integer, gpukernel_abi,
// implicit_provenance_casts, interior_mutable_consts, invalid_from_utf8, let_underscore) against the pinned nightly.
// The subject is lane lint-late-a's test driver src/rustc_lint/late_oracle/run.ts (see its header): the ported analysis
// prefix, then the pass(es) under test (`--late-pass=<file>:<Pass>`) over every module. Both sides compile the file as
// a lib with `--emit=metadata -A unused`; each case only has diagnostics from the selected passes, so stderr and the
// exit code must be identical.
//
// Cases with `stop` reach code outside this lane that is still `unported` (a target spec, const eval). They are pinned: the run must end with exit 70 at that stop, and everything
// printed before it must be a prefix of the oracle's stderr. Once the stop is no longer reached, the case fails with
// "drop `stop` from this case" and must be moved to full equality.
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
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

const WORK = join(DATA, "tmp", "lint-late-e1-oracle", process.env.RUST_TS_AGENT ?? "default");
mkdirSync(WORK, { recursive: true });
const UI = join(DATA, "rust", "tests", "ui");

const BASE_ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_TS_E1_PASSES"].includes(k)) {
    BASE_ENV[k] = v;
  }
}
interface Out {
  stderr: string;
  code: number;
}
function run(cmd: string[], env: Record<string, string>): Out {
  const r = Bun.spawnSync(cmd, { cwd: WORK, env, stdout: "pipe", stderr: "pipe" });
  return { stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}
const sysroot = (): string => Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim();

/** The file (relative to src/rustc_lint) exporting each pass. */
const PASS_FILE: Record<string, string> = {
  AsyncClosureUsage: "async_closures.ts",
  AsyncFnInTrait: "async_fn_in_trait.ts",
  ImplicitAutorefs: "autorefs.ts",
  CVoidReturns: "c_void_returns.ts",
  DefaultCouldBeDerived: "default_could_be_derived.ts",
  DerefIntoDynSupertrait: "deref_into_dyn_supertrait.ts",
  DisallowedPassByRef: "disallowed_pass_by_ref.ts",
  EnumIntrinsicsNonEnums: "enum_intrinsics_non_enums.ts",
  ForLoopsOverFallibles: "for_loops_over_fallibles.ts",
  FunctionCastsAsInteger: "function_cast_as_integer.ts",
  ImproperGpuKernelLint: "gpukernel_abi.ts",
  ImplicitProvenanceCasts: "implicit_provenance_casts.ts",
  InteriorMutableConsts: "interior_mutable_consts.ts",
  InvalidFromUtf8: "invalid_from_utf8.ts",
  LetUnderscore: "let_underscore.ts",
};
const late_pass = (p: string): string => {
  const f = PASS_FILE[p];
  if (f === undefined) throw new Error(`unknown pass ${p}`);
  return `--late-pass=${f}:${p}`;
};

const QPATH_RES = "rustc_lint::context::LateContext::qpath_res";
const TYPING_ENV = "rustc_lint::context::LateContext::typing_env";

interface Case {
  name: string;
  /** The passes to run (keys of `PASS_FILE`), in lib.rs order. */
  passes: string[];
  /** Inline source, or a tests/ui path (`ui`). */
  src?: string[];
  ui?: string;
  edition?: string;
  target?: string;
  flags?: string[];
  /** Text the oracle's stderr must contain (the diagnostics under test are really emitted). */
  expect: string[];
  /** The pinned `unported(..)` stop outside this lane (see the header); the run must end at one of them. */
  stop?: string[];
}

const CASES: Case[] = [
  // async_closures.rs
  {
    name: "closure_returning_async_block: allow by default (no diagnostic)",
    passes: ["AsyncClosureUsage"],
    src: ["pub fn f() {", "    let _c = |_x: &str| async {};", "    let _d = || { async move {} };", "}"],
    expect: [],
  },
  {
    name: "closure_returning_async_block: tests/ui lint-closure-returning-async-block.rs",
    passes: ["AsyncClosureUsage"],
    ui: "async-await/async-closures/lint-closure-returning-async-block.rs",
    expect: ["closure returning async block can be made into an async closure"],
  },
  // async_fn_in_trait.rs
  {
    name: "async_fn_in_trait: tests/ui async-await/in-trait/warn.rs",
    passes: ["AsyncFnInTrait"],
    ui: "async-await/in-trait/warn.rs",
    expect: ["use of `async fn` in public traits is discouraged", "desugar to a normal `fn`"],
  },
  {
    name: "async_fn_in_trait: private trait, desugared impl (no diagnostic)",
    passes: ["AsyncFnInTrait"],
    ui: "async-await/in-trait/async-example-desugared-boxed.rs",
    expect: [],
  },
  // autorefs.rs
  {
    name: "dangerous_implicit_autorefs: tests/ui lint/implicit_autorefs.rs",
    passes: ["ImplicitAutorefs"],
    ui: "lint/implicit_autorefs.rs",
    expect: ["implicit autoref creates a reference to the dereference of a raw pointer", "method calls to `len` require a reference"],
  },
  // c_void_returns.rs
  {
    name: "c_void_returns: tests/ui lint/c-void-returns.rs",
    passes: ["CVoidReturns"],
    ui: "lint/c-void-returns.rs",
    expect: ["`c_void` should not be used as a return type"],
  },
  // default_could_be_derived.rs
  {
    name: "default_overrides_default_fields: manual impls without default field values (no diagnostic)",
    passes: ["DefaultCouldBeDerived"],
    src: [
      "pub struct S { pub x: i32 }",
      "impl Default for S {",
      "    fn default() -> S { S { x: 1 } }",
      "}",
      "#[derive(Default)]",
      "pub struct T { pub y: u8 }",
    ],
    expect: [],
  },
  {
    name: "default_overrides_default_fields: overridden default fields",
    passes: ["DefaultCouldBeDerived"],
    src: [
      "#![feature(default_field_values)]",
      "pub struct A {",
      "    pub x: i32,",
      "    pub y: i32 = 101,",
      "}",
      "impl Default for A {",
      "    fn default() -> Self {",
      "        A { x: 1, y: 0 }",
      "    }",
      "}",
      "pub struct B {",
      "    pub y: i32 = 101,",
      "}",
      "impl Default for B {",
      "    fn default() -> Self {",
      "        B { y: 0 }",
      "    }",
      "}",
    ],
    expect: ["`Default` impl doesn't use the declared default field values", "derive the `Default`"],
    // Default field values are const-evaluated in the analysis prefix, before the lint runs (`const_eval_poly`, ported by
    // lane mir-interp-b, reaches the `eval_to_const_value_raw` provider: CTFE, not ported yet).
    stop: ["rustc_const_eval::const_eval::eval_to_const_value_raw_provider"],
  },
  // deref_into_dyn_supertrait.rs
  {
    name: "deref_into_dyn_supertrait: `Deref` for a non-`dyn` type (no diagnostic)",
    passes: ["DerefIntoDynSupertrait"],
    src: [
      "use std::ops::Deref;",
      "pub struct W(pub i32);",
      "impl Deref for W {",
      "    type Target = i32;",
      "    fn deref(&self) -> &i32 { &self.0 }",
      "}",
    ],
    expect: [],
  },
  {
    name: "deref_into_dyn_supertrait: tests/ui deref-upcast-shadowing-lint.rs",
    passes: ["DerefIntoDynSupertrait"],
    ui: "traits/trait-upcasting/deref-upcast-shadowing-lint.rs",
    expect: ["this `Deref` implementation is covered by an implicit supertrait coercion"],
  },
  {
    name: "deref_into_dyn_supertrait: tests/ui lint/issue-108155.rs (`Target` not a supertrait)",
    passes: ["DerefIntoDynSupertrait"],
    ui: "lint/issue-108155.rs",
    expect: [],
  },
  // disallowed_pass_by_ref.rs
  {
    name: "rustc::disallowed_pass_by_ref: tests/ui internal-lints/rustc_pass_by_value_self.rs",
    passes: ["DisallowedPassByRef"],
    ui: "internal-lints/rustc_pass_by_value_self.rs",
    expect: ["passing `TyCtxt<'tcx>` by reference", "passing `WithParameters<T, 1, u8>` by reference"],
  },
  // enum_intrinsics_non_enums.rs
  {
    name: "enum_intrinsics_non_enums: tests/ui lint/lint-enum-intrinsics-non-enums.rs",
    passes: ["EnumIntrinsicsNonEnums"],
    ui: "lint/lint-enum-intrinsics-non-enums.rs",
    expect: ["the return value of `mem::discriminant` is unspecified when called with a non-enum type"],
  },
  // for_loops_over_fallibles.rs
  {
    name: "for_loops_over_fallibles: `Option`, `&Option`, `Result`, `.next()`",
    passes: ["ForLoopsOverFallibles"],
    src: [
      "pub fn f(o: Option<i32>, x: &Option<i32>, y: Result<u8, ()>, mut it: std::vec::IntoIter<u8>) -> i32 {",
      "    let mut s = 0;",
      "    for v in o { s += v; }",
      "    for v in x { s += *v; }",
      "    for v in y { s += v as i32; }",
      "    for v in it.next() { s += v as i32; }",
      "    s",
      "}",
    ],
    expect: ["for loop over a `&Option`", "for loop over a `Result`", "to iterate over `it` remove the call to `next`"],
  },
  {
    name: "for_loops_over_fallibles: tests/ui macro-iterator-next.rs",
    passes: ["ForLoopsOverFallibles"],
    ui: "lint/for-loops-over-fallibles/macro-iterator-next.rs",
    expect: ["for loop over an `Option`"],
  },
  {
    name: "for_loops_over_fallibles: tests/ui macro-issue-140747.rs",
    passes: ["ForLoopsOverFallibles"],
    ui: "lint/for-loops-over-fallibles/macro-issue-140747.rs",
    expect: ["for loop over an `Option`"],
  },
  {
    name: "for_loops_over_fallibles: tests/ui lint/for_loop_over_fallibles.rs (`?` suggestion)",
    passes: ["ForLoopsOverFallibles"],
    ui: "lint/for_loop_over_fallibles.rs",
    expect: ["for loop over a `Result`", "consider unwrapping the `Result` with `?` to iterate over its contents"],
  },
  // function_cast_as_integer.rs
  {
    name: "function_casts_as_integer: tests/ui lint/function_casts_as_integer.rs",
    passes: ["FunctionCastsAsInteger"],
    ui: "lint/function_casts_as_integer.rs",
    expect: ["direct cast of function item into an integer", "first cast to a pointer `as *const ()`"],
  },
  // gpukernel_abi.rs
  {
    name: "improper_gpu_kernel_arg: non-gpu-kernel fns (no diagnostic)",
    passes: ["ImproperGpuKernelLint"],
    src: ["pub extern \"C\" fn f(_: &i32) {}", "pub fn g(_: (i32, i32)) {}", "pub struct S;", "impl S { pub extern \"C\" fn m(_: &i32) {} }"],
    expect: [],
  },
  {
    name: "improper_gpu_kernel_arg / missing_gpu_kernel_export_name on nvptx64",
    passes: ["ImproperGpuKernelLint"],
    target: "nvptx64-nvidia-cuda",
    edition: "2024",
    src: [
      "#![feature(no_core, lang_items, abi_gpu_kernel)]",
      "#![no_core]",
      "#![allow(internal_features, improper_ctypes_definitions)]",
      '#[lang = "pointee_sized"]',
      "pub trait PointeeSized {}",
      '#[lang = "meta_sized"]',
      "pub trait MetaSized: PointeeSized {}",
      '#[lang = "sized"]',
      "pub trait Sized: MetaSized {}",
      "#[unsafe(no_mangle)]",
      'extern "gpu-kernel" fn arg_i32(_: i32) {}',
      "#[unsafe(no_mangle)]",
      'extern "gpu-kernel" fn arg_ptr(_: *const i32, _: *mut [u8]) {}',
      "#[unsafe(no_mangle)]",
      'extern "gpu-kernel" fn arg_ref(_: &i32, _: (i32, i32)) {}',
      'extern "gpu-kernel" fn mangled() {}',
      '#[unsafe(export_name = "x")]',
      'extern "gpu-kernel" fn exported() {}',
      "pub struct S;",
      "impl S {",
      '    extern "gpu-kernel" fn method(_: &i32) {}',
      "}",
    ],
    expect: ['passing type `*mut [u8]` to a function with "gpu-kernel" ABI may have unexpected behavior', 'function with the "gpu-kernel" ABI has a mangled name'],
    stop: ["rustc_target::spec::targets::nvptx64_nvidia_cuda"],
  },
  // implicit_provenance_casts.rs
  {
    name: "implicit_provenance_casts: int2ptr, tests/ui lint-strict-provenance-fuzzy-casts.rs",
    passes: ["ImplicitProvenanceCasts"],
    ui: "lint/lint-strict-provenance-fuzzy-casts.rs",
    expect: ["cast from `usize` to `*const u8` implicitly relies on exposed provenance"],
  },
  {
    name: "implicit_provenance_casts: ptr2int, tests/ui lint-strict-provenance-lossy-casts.rs",
    passes: ["ImplicitProvenanceCasts"],
    ui: "lint/lint-strict-provenance-lossy-casts.rs",
    expect: ["cast from `*const u8` to `usize` implicitly exposes pointer provenance", "use `.addr()` to obtain the address of a pointer"],
  },
  // interior_mutable_consts.rs
  {
    name: "const_item_interior_mutations: method calls on `Cell` / atomic consts",
    passes: ["InteriorMutableConsts"],
    src: [
      "use std::cell::Cell;",
      "use std::sync::atomic::{AtomicU32, Ordering};",
      "pub const A: Cell<i32> = Cell::new(0);",
      "pub(crate) const B: AtomicU32 = AtomicU32::new(0);",
      "pub struct T;",
      "impl T { pub const C: AtomicU32 = AtomicU32::new(1); }",
      "pub fn f() {",
      "    A.set(1);",
      "    B.store(3, Ordering::SeqCst);",
      "    let _ = B.fetch_add(1, Ordering::SeqCst);",
      "    T::C.store(2, Ordering::Relaxed);",
      "}",
    ],
    expect: ["mutation of an interior mutable `const` item with call to `set`", "for a shared instance of `B`, consider making it a `static` item instead"],
  },
  // invalid_from_utf8.rs
  {
    name: "invalid_from_utf8(_unchecked): tests/ui lint/invalid_from_utf8.rs",
    passes: ["InvalidFromUtf8"],
    ui: "lint/invalid_from_utf8.rs",
    expect: ["calls to `std::str::from_utf8_unchecked_mut` with an invalid literal are undefined behavior"],
  },
  // let_underscore.rs
  {
    name: "let_underscore: no `_` patterns (no diagnostic)",
    passes: ["LetUnderscore"],
    src: ["pub fn g() -> (i32, String) {", "    let s = String::new();", "    let (a, b) = (1, s);", "    (a, b)", "}"],
    expect: [],
  },
  {
    name: "let_underscore_drop: tests/ui lint/let_underscore/let_underscore_drop.rs",
    passes: ["LetUnderscore"],
    ui: "lint/let_underscore/let_underscore_drop.rs",
    expect: ["non-binding let on a type that has a destructor"],
  },
  {
    name: "let_underscore_lock: tests/ui lint/let_underscore/let_underscore_lock.rs",
    passes: ["LetUnderscore"],
    ui: "lint/let_underscore/let_underscore_lock.rs",
    expect: ["non-binding let on a synchronization lock"],
  },
];

/** `//@ compile-flags:` / `//@ edition:` headers of a tests/ui file (no revisions in the chosen files). */
function headers(text: string): { flags: string[]; edition?: string } {
  const flags: string[] = [];
  let edition: string | undefined;
  for (const line of text.split("\n")) {
    const f = /^\/\/@\s*compile-flags:(.*)$/.exec(line);
    if (f) flags.push(...f[1]!.trim().split(/\s+/).filter((s) => s !== ""));
    const e = /^\/\/@\s*edition:\s*(\S+)/.exec(line);
    if (e) edition = e[1];
  }
  return { flags, edition };
}

for (const [i, c] of CASES.entries()) {
  test.skipIf(SKIP)(`late lints e1: ${c.name}`, () => {
    let file: string;
    let flags = c.flags ?? [];
    let edition = c.edition ?? "2021";
    if (c.ui !== undefined) {
      file = basename(c.ui);
      copyFileSync(join(UI, c.ui), join(WORK, file));
      const h = headers(readFileSync(join(UI, c.ui), "utf8"));
      flags = [...h.flags, ...flags];
      if (h.edition !== undefined) edition = h.edition;
    } else {
      file = `case${i}.rs`;
      writeFileSync(join(WORK, file), unwrapSrc(c).join("\n") + "\n");
    }
    const args = [
      "--target",
      c.target ?? "x86_64-unknown-linux-gnu",
      "--sysroot",
      sysroot(),
      `--edition=${edition}`,
      "--crate-type=lib",
      "--emit=metadata",
      "-o",
      `${file.replace(/\.rs$/, "")}.rmeta`,
      "-A",
      "unused",
      ...flags,
      file,
    ];
    const oracle = run([...RUSTC, ...args], BASE_ENV);
    const ours = run([process.execPath, join(REPO, "src/rustc_lint/late_oracle/run.ts"), ...c.passes.map(late_pass), ...args], BASE_ENV);
    for (const e of c.expect) expect(oracle.stderr).toContain(e);
    if (c.stop !== undefined) {
      if (ours.code !== 70) throw new Error(`stop \`${c.stop.join("` / `")}\` is no longer reached (exit ${ours.code}): drop \`stop\` from this case`);
      const lines = ours.stderr.split("\n");
      const last = lines.findLastIndex((l) => l.startsWith("rust-ts: unported: "));
      expect(c.stop.some((stop) => lines[last]!.includes(stop))).toBe(true);
      const before = lines.slice(0, last).join("\n");
      expect(oracle.stderr.startsWith(before)).toBe(true);
    } else {
      expect(ours.stderr).toBe(oracle.stderr);
      expect(ours.code).toBe(oracle.code);
    }
  });
}

function unwrapSrc(c: Case): string[] {
  if (c.src === undefined) throw new Error(`case ${c.name}: no src`);
  return c.src;
}
