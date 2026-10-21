// Oracle checks of the late lint passes ported by lane lint-late-e2 (map_unit_fn.rs, multiple_supertrait_upcastable.rs,
// noop_method_call.rs, opaque_hidden_inferred_bound.rs, ptr_nulls.rs, raw_borrows_via_references.rs,
// runtime_symbols.rs, shadowed_into_iter.rs, static_mut_refs.rs, traits.rs, unit_bindings.rs,
// unqualified_local_imports.rs, utils.rs) against the pinned nightly rustc.
// The subject is lane lint-late-a's shared driver src/rustc_lint/late_oracle/run.ts (`--late-pass=<file>:<Pass>`):
// the ported driver, the typeck prefix of `analysis`, then the named late passes over every module the way late.rs
// `late_lint_mod` runs them. The oracle
// compiles the same file as a lib with std (`--emit=metadata`); each case only has diagnostics those passes produce
// (other lints are allowed in the source), so stderr and the exit code must be identical.
// Cases whose path reaches unported code are pinned to the `unported` stop they reach (`stop`), with the oracle
// output still checked for the diagnostic they will produce once it is ported.
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
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

const WORK = join(DATA, "tmp", "lint-late-e2-oracle", process.env.RUST_TS_AGENT ?? "default");
mkdirSync(WORK, { recursive: true });

const ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "LATE_E2_PASSES"].includes(k)) ENV[k] = v;
}
interface Out {
  stderr: string;
  code: number;
}
function run(cmd: string[], env: Record<string, string>): Out {
  const r = Bun.spawnSync(cmd, { cwd: WORK, env, stdout: "pipe", stderr: "pipe" });
  return { stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}
/** The file (relative to src/rustc_lint) of each pass, for lint-late-a's `--late-pass=<file>:<Pass>`. */
const PASS_FILES: Record<string, string> = {
  MapUnitFn: "map_unit_fn.ts",
  MultipleSupertraitUpcastable: "multiple_supertrait_upcastable.ts",
  NoopMethodCall: "noop_method_call.ts",
  OpaqueHiddenInferredBound: "opaque_hidden_inferred_bound.ts",
  PtrNullChecks: "ptr_nulls.ts",
  RawBorrowsViaReferences: "raw_borrows_via_references.ts",
  RuntimeSymbols: "runtime_symbols.ts",
  ShadowedIntoIter: "shadowed_into_iter.ts",
  StaticMutRefs: "static_mut_refs.ts",
  DropTraitConstraints: "traits.ts",
  UnitBindings: "unit_bindings.ts",
  UnqualifiedLocalImports: "unqualified_local_imports.ts",
};
const SHARED_DRIVER = join(REPO, "src/rustc_lint/late_oracle/run.ts");
function subject(passes: readonly string[], args: readonly string[]): [string[], Record<string, string>] {
  return [[process.execPath, SHARED_DRIVER, ...passes.map((p) => `--late-pass=${PASS_FILES[p]}:${p}`), ...args], ENV];
}
const sysroot = (): string => Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim();

interface Case {
  name: string;
  /** Late passes to run (walker.ts `PASSES` names). */
  passes: string[];
  src: string[];
  edition?: string;
  /** Text the oracle output must contain (the diagnostics under test were really emitted). */
  expect: string[];
  /** The `unported` stop rust-ts reaches instead (exit 70); the case is pinned to it. */
  stop?: string;
}

const CASES: Case[] = [
  {
    name: "map_unit_fn: fn item and closure",
    passes: ["MapUnitFn"],
    src: [
      "#![allow(unused_must_use)]",
      "fn foo(items: &mut Vec<u8>) {",
      "    items.sort();",
      "}",
      "pub fn main() {",
      "    let mut x: Vec<Vec<u8>> = vec![vec![0, 2, 1], vec![5, 4, 3]];",
      "    x.iter_mut().map(foo);",
      "    x.iter_mut().map(|items| items.sort());",
      "}",
    ],
    expect: ["`Iterator::map` call that discard the iterator's values", "this function returns `()`"],
  },
  {
    name: "multiple_supertrait_upcastable: MetaSized / Sized / auto supertraits",
    passes: ["MultipleSupertraitUpcastable"],
    src: [
      "#![feature(multiple_supertrait_upcastable)]",
      "#![warn(multiple_supertrait_upcastable)]",
      "pub trait A {}",
      "pub trait B {}",
      "pub trait C: A + B {}",
      "pub trait D: A + Sized {}",
      "pub trait E: A + B { fn f() -> Self; }",
      "pub trait F: A + B + Send {}",
    ],
    expect: ["`C` is dyn-compatible and has multiple supertraits", "`F` is dyn-compatible"],
  },
  {
    name: "noop_method_call and suspicious_double_ref_op (clone, deref, borrow; derive suggestion)",
    passes: ["NoopMethodCall"],
    src: [
      "#![warn(noop_method_call)]",
      "#![allow(unused)]",
      "use std::borrow::Borrow;",
      "use std::ops::Deref;",
      "struct PlainType<T>(T);",
      "#[derive(Clone)]",
      "struct CloneType<T>(T);",
      "pub fn f() {",
      "    let non_clone_type_ref = &PlainType(1u32);",
      "    let non_clone_type_ref_clone: &PlainType<u32> = non_clone_type_ref.clone();",
      "    let clone_type_ref = &CloneType(1u32);",
      "    let clone_type_ref_clone: CloneType<u32> = clone_type_ref.clone();",
      "    let non_deref_type = &PlainType(1u32);",
      "    let non_deref_type_deref: &PlainType<u32> = non_deref_type.deref();",
      "    let non_borrow_type = &PlainType(1u32);",
      "    let non_borrow_type_borrow: &PlainType<u32> = non_borrow_type.borrow();",
      "    let x = &&1u32;",
      "    let y: &u32 = x.clone();",
      "}",
      "fn generic<T>(non_clone_type: &PlainType<T>) {",
      "    non_clone_type.clone();",
      "}",
      "fn non_generic(non_clone_type: &PlainType<u32>) {",
      "    non_clone_type.clone();",
      "}",
      "fn double_ref<'a>(x: &'a &'a String) -> &'a String { x.clone() }",
      "fn double_ref_deref<'a>(x: &'a &'a String) -> &'a String { x.deref() }",
    ],
    expect: ["call to `.clone()` on a reference in this situation does nothing", "using `.clone()` on a double reference", "using `.deref()` on a double reference"],
  },
  {
    name: "ptr_nulls: useless_ptr_null_checks (casts, ptr::null, cast_mut, never-null fn) and invalid_null_arguments (ZST)",
    passes: ["PtrNullChecks"],
    src: [
      "#![allow(unused)]",
      "use std::ptr;",
      'extern "C" fn c_fn() {}',
      "fn static_i32() -> &'static i32 { &1 }",
      "pub unsafe fn f() {",
      "    let fn_ptr = main;",
      "    if (fn_ptr as *mut ()).is_null() {}",
      "    if (fn_ptr as *const u8).is_null() {}",
      "    if (fn_ptr as *const ()) == std::ptr::null() {}",
      "    if (fn_ptr as *mut ()) == std::ptr::null_mut() {}",
      "    if (fn_ptr as *const ()) == (0 as *const ()) {}",
      "    if <*const _>::is_null(fn_ptr as *const ()) {}",
      "    if (c_fn as *const ()).is_null() {}",
      "    let r = &1i32;",
      "    if (r as *const i32).is_null() {}",
      "    if (static_i32() as *const i32).cast_mut().is_null() {}",
      "    let ptr = std::ptr::null::<u8>();",
      "    let _ = ptr::read(ptr::null::<u8>());",
      "    let _ = ptr::read(ptr);",
      "    let _ = ptr::read(0 as *const u8);",
      "    let _ = ptr::read(ptr::null::<()>());",
      "    let _: &[usize] = std::slice::from_raw_parts(ptr::null(), 0);",
      "    ptr::copy::<usize>(ptr::null(), ptr::null_mut(), 0);",
      "    let mut v = vec![1u8];",
      "    if v.as_ptr().is_null() {}",
      "}",
      "fn main() {}",
    ],
    expect: [
      "function pointers are not nullable",
      "references are not nullable",
      "returned pointer of `as_ptr` call is never null",
      "calling this function with a null pointer is undefined behavior",
    ],
  },
  {
    name: "raw_borrows_via_references: spanful suggestions",
    passes: ["RawBorrowsViaReferences"],
    src: [
      "#![warn(raw_borrows_via_references)]",
      "pub fn f() {",
      "    let mut x = 0u8;",
      "    let a = &x as *const u8;",
      "    let b = &mut x as *mut u8;",
      "    let c = &mut (x) as *mut u8 as *const u8;",
      "    let _ = (a, b, c);",
      "}",
    ],
    expect: ["creating an intermediate reference implies aliasing requirements", "consider using `&raw const`"],
  },
  {
    name: "shadowed_into_iter: array_into_iter and boxed_slice_into_iter (2018), for-loop and UFCS suggestions",
    passes: ["ShadowedIntoIter"],
    edition: "2018",
    src: [
      "#![allow(unused, array_into_iter)]",
      "#![warn(array_into_iter, boxed_slice_into_iter)]",
      "pub fn f() {",
      "    let small = [1, 2];",
      "    let big = [0u8; 33];",
      "    small.into_iter();",
      "    [1, 2].into_iter();",
      "    big.into_iter();",
      "    for _ in [1, 2].into_iter() {}",
      "    let boxed: Box<[u8]> = vec![1u8].into_boxed_slice();",
      "    boxed.into_iter();",
      "    Box::new(boxed.clone()).into_iter();",
      "    for _ in boxed.into_iter() {}",
      "}",
    ],
    expect: ["this method call resolves to `<&[T; N] as IntoIterator>::into_iter`", "this method call resolves to `<&Box<[T]> as IntoIterator>::into_iter`"],
  },
  {
    name: "static_mut_refs (2021): shared, mut, field, ref bindings, method receiver, interior mutability, parens, macro",
    passes: ["StaticMutRefs"],
    src: [
      "#![allow(unused)]",
      "use std::cell::Cell;",
      "static mut FOO: (u32, u32) = (1, 2);",
      "pub static  mut CELL: Cell<u32> = Cell::new(0);",
      "macro_rules! bar { ($x:expr) => { &mut ($x.0) }; }",
      "pub unsafe fn f() {",
      "    let _y = &FOO;",
      "    let _z = &mut FOO;",
      "    let _w = &FOO.0;",
      "    let ref _r = FOO;",
      "    let ref mut _rm = FOO;",
      "    let _len = FOO.0.count_ones();",
      "    let _c = &CELL;",
      "    let _m = &mut CELL;",
      "    let _p = ( ( &FOO ) );",
      "    let _b = bar!(FOO);",
      '    let _s = format!("{:?}", FOO);',
      "}",
    ],
    expect: ["creating a shared reference to mutable static", "creating a mutable reference to mutable static"],
  },
  {
    name: "static_mut_refs (2024): deny by default",
    passes: ["StaticMutRefs"],
    edition: "2024",
    src: ["#![allow(unused)]", "static mut FOO: u32 = 1;", "pub fn f() {", "    unsafe {", "        let _y = &FOO;", "        let _z = &raw const FOO;", "        let _len = FOO.count_ones();", "    }", "}"],
    expect: ["error: creating a shared reference to mutable static"],
  },
  {
    name: "dyn_drop",
    passes: ["DropTraitConstraints"],
    src: ["pub fn f(_x: Box<dyn Drop>) {}", "pub fn g(_x: &(dyn Drop + Send)) {}"],
    expect: ["types that do not implement `Drop` can still have drop glue"],
  },
  {
    name: "drop_bounds",
    passes: ["DropTraitConstraints"],
    src: ["pub fn foo<T: Drop>() {}"],
    expect: ["bounds on `T: Drop` are most likely incorrect"],
  },
  {
    name: "unit_bindings: inferred unit binding vs annotated / `()` pattern / `()` init",
    passes: ["UnitBindings"],
    src: ["#![warn(unit_bindings)]", "fn foo() {}", "pub fn main() {", "    let x = foo();", "    let () = foo();", "    let y: () = foo();", "    let z = ();", "    let _ = (x, y, z);", "}"],
    expect: ["binding has unit type `()`"],
  },
  {
    name: "unqualified_local_imports: module scope vs `crate::` / fn scope",
    passes: ["UnqualifiedLocalImports"],
    src: [
      "#![feature(unqualified_local_imports)]",
      "#![warn(unqualified_local_imports)]",
      "#![allow(unused_imports, dead_code)]",
      "mod localmod {",
      "    pub struct S;",
      "    pub struct T;",
      "}",
      "use localmod::S;",
      "use crate::localmod::T;",
      "pub fn f() {",
      "    use localmod::S as S2;",
      "}",
    ],
    expect: ["`use` of a local item without leading `self::`, `super::`, or `crate::`"],
  },
  {
    name: "runtime_symbols: #[no_mangle] fn (stop: rustc_symbol_mangling::symbol_name_from_attrs)",
    passes: ["RuntimeSymbols"],
    src: ["#[unsafe(no_mangle)]", 'pub extern "C" fn strlen(_ptr: *mut f32) -> usize { 0 }'],
    expect: ["suspicious definition of the runtime `strlen` symbol used by the standard library"],
    stop: "rustc_symbol_mangling::symbol_name_from_attrs",
  },
  {
    name: "runtime_symbols: foreign fn (stop: the `symbol_name` query key)",
    passes: ["RuntimeSymbols"],
    src: ['unsafe extern "C" {', "    pub fn strlen(p: *const u8) -> usize;", "}"],
    expect: ["suspicious definition of the runtime `strlen` symbol used by the standard library"],
    stop: "QueryKey for `ty::Instance<'tcx>`",
  },
  {
    name: "opaque_hidden_inferred_bound: RPITIT without a body is skipped",
    passes: ["OpaqueHiddenInferredBound"],
    src: ["pub trait Duh {}", "pub trait Trait { type Assoc: Duh; }", "pub trait T2 { fn f(&self) -> impl Trait<Assoc = impl Sized>; }"],
    expect: [],
  },
  {
    name: "opaque_hidden_inferred_bound: TAIT (tests/ui/impl-trait/nested-return-type3-tait3.rs) (stop: mir_borrowck, reached by the typeck prefix)",
    passes: ["OpaqueHiddenInferredBound"],
    src: [
      "#![feature(type_alias_impl_trait)]",
      "#![allow(dead_code)]",
      "trait Duh {}",
      "impl Duh for i32 {}",
      "trait Trait {",
      "    type Assoc: Duh;",
      "}",
      "impl<F: Duh> Trait for F {",
      "    type Assoc = F;",
      "}",
      "type Traitable = impl Trait<Assoc = impl Send>;",
      "#[define_opaque(Traitable)]",
      "fn foo() -> Traitable {",
      "    42",
      "}",
    ],
    expect: ["opaque type `Traitable` does not satisfy its associated type bounds", "impl Send + Duh"],
    stop: "mir_borrowck provider",
  },
];

for (const [i, c] of CASES.entries()) {
  test.skipIf(SKIP)(`late lints (lint-late-e2): ${c.name}`, () => {
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
      file,
    ];
    const oracle = run([...RUSTC, ...args], ENV);
    const ours = run(...subject(c.passes, args));
    for (const e of c.expect) expect(oracle.stderr).toContain(e);
    if (c.stop !== undefined) {
      expect(ours.stderr).toContain(`rust-ts: unported: `);
      expect(ours.stderr).toContain(c.stop);
      expect(ours.code).toBe(70);
    } else {
      expect(ours.stderr).toBe(oracle.stderr);
      expect(ours.code).toBe(oracle.code);
    }
  });
}
