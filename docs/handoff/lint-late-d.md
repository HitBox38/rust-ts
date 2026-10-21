# Handoff: lint-late-d (wave 21, late lints part d)

Branch `lane/lint-late-d`, base `970d2365`. Agent `lint-late-d`.

## Files touched

Ported (every upstream fn, upstream order, markers):

| upstream | TS | coverage |
|---|---|---|
| compiler/rustc_lint/src/internal.rs (late passes; early ones were already ported) | src/rustc_lint/internal.ts | 28/28 |
| compiler/rustc_lint/src/foreign_modules.rs (`clashing_extern_declarations` + helpers) | src/rustc_lint/foreign_modules.ts | 11/11 |
| compiler/rustc_lint/src/transmute.rs | src/rustc_lint/transmute.ts | 4/4 |
| compiler/rustc_lint/src/non_fmt_panic.rs | src/rustc_lint/non_fmt_panic.ts | 7/7 |
| compiler/rustc_lint/src/dangling.rs | src/rustc_lint/dangling.ts | 8/8 |
| compiler/rustc_lint/src/non_local_def.rs | src/rustc_lint/non_local_def.ts | 9/9 |
| compiler/rustc_lint/src/reference_casting.rs | src/rustc_lint/reference_casting.ts | 8/8 |
| compiler/rustc_lint/src/drop_forget_useless.rs | src/rustc_lint/drop_forget_useless.ts | 2/2 |

New test files (not upstream mirrors):
- src/rustc_lint/late_d.oracle.test.ts: 10 oracle cases (pinned rustc vs the port, full stderr + exit code).
- src/rustc_lint/late_d_test/run.ts, walker.ts: the test driver (see "Tests").

No other file edited. `bun scripts/coverage.ts --check`: markers ok.

## Registration

Nothing to register: lane lint-late-a's lib.ts already lists every pass of this lane with the right constructor
(`new CheckTransmutes()`, `new DanglingPointers()`, `new DropForgetUseless()`, `new InvalidReferenceCasting()`,
`NonLocalDefinitions.default()`, `new NonPanicFmt()`, `new internal.<Pass>()` for the 9 internal late passes), and
`foreign_modules.provide` / `lint_vec` were already wired. Pass types follow lint-late-a's pattern (generated
`declare_lint_pass!` classes + `declare module` `extends LateLintPass` + prototype methods; `impl_lint_pass!`
structs with fields (`CheckTransmutes`, `DanglingPointers`, `NonLocalDefinitions`) are classes in their file).
`clashing_extern_declarations` runs from rustc_interface passes.rs:1248 (`tcx.ensure_ok().clashing_extern_declarations(())`),
not from the lint store: whoever ports `analysis` calls it there.

## Tests

`RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_lint/late_d.oracle.test.ts`: 10 pass. Every case compares the full stderr
and exit code with the pinned rustc (`--crate-type=lib --emit=metadata`, x86_64-unknown-linux-gnu, oracle sysroot):
- drop_forget_useless: dropping_references, forgetting_references, dropping_copy_types, forgetting_copy_types, the
  single-call-in-arm exception.
- transmute: unnecessary_transmutes (every arm, incl. bool in const fn), ptr_to_integer_transmute_in_consts (const fn
  and assoc const).
- non_fmt_panic (2018): unused placeholders, braces (plain and raw), non-literal (&str, i32 + panic_any, Debug-only,
  format!), unreachable!, assert!, core::panic!, `panic!{..}`.
- dangling: dangling_pointers_from_temporaries (CString, Vec, String, Box<[_]>, call-arg and block exceptions,
  closures).
- non_local_def: impls in fns / named const / static, nested fns, anon-const exceptions, local-type exception,
  `#[macro_export]` in a body.
- reference_casting: only paths that bail out before `peel_casts` (no diagnostics; see below).
- internal (`-Zunstable-options`, local `#[rustc_diagnostic_item]`s): default_hash_types; usage_of_ty_tykind (path and
  type forms), usage_of_qualified_ty, span_use_eq_ctxt, symbol_intern_string_literal; rustc_must_match_exhaustively
  (match wildcard/binding, if let, let else); usage_of_type_ir_traits, missing_generic_type_visitable_derive,
  potential_query_instability. (bad_opt_access is exercised but the oracle does not fire on the case either.)

Test driver: the lane started before lint-late-a committed late.ts / context.ts, so `late_d_test/` carries a
test-only copy of `LateContextAndPass` and a `TestLateContext` subclass filling the then-unported `LateContext`
methods with the upstream bodies. After integration with lint-late-a, replace it with
`src/rustc_lint/late_oracle/run.ts --late-pass=<file>.ts:<Pass>` and delete `late_d_test/` (walker.ts's
`TestLateContext` declares `layout_of` without `override`; if tsc's noImplicitOverride complains after the merge,
that is the fix).

Other checks: `bunx tsc --noEmit -p .` clean; full `bun test src` and the suite comparisons: see "Checks" below.

## unported(...) left

- foreign_modules.ts: cross-lane shims `types.nonnull_optimization_guaranteed`, `types.transparent_newtype_field`,
  `types.repr_nullable_ptr` (types.rs:724/:733/:883, lane lint-late-b). **Root at integration**: delete the local
  `const types = {..}` and import the three from ./types.ts.
- Reached through other files (not this lane's): `utils::peel_casts` and `utils::std_or_core` (utils.ts stubs) —
  reference_casting (every linting path), dangling's `dangling_pointers_from_locals` (fns returning raw pointers),
  drop_forget_useless's `undropped_manually_drops`, transmute's `integer_to_ptr_transmutes` stop there until
  utils.rs is ported. `clashing_extern_declarations` stops at the `symbol_name` query
  (`QueryKey for ty::Instance` / rustc_symbol_mangling, unported) for any extern fn.

## PORT decisions

- `cx.typeck_results()` is `cx.typeck_results_()`; results of `qpath_res`, `typing_env`, `expr_or_init`,
  `typeck_results_()` are cast (`as Res` / `as TypingEnv` / `as hir.Expr` / `as TypeckResults`): context.ts typed them
  `unknown` at the base; with lint-late-a's typed LateContext the casts are no-ops.
- reference_casting.ts: `cx.layout_of(ty)` goes through a `LateLayoutOf` view (`cx as unknown as LayoutOf<..>`):
  `LateContext` had no `LayoutOf` impl at the base (lint-late-a adds it; the view then just names it).
- transmute.ts: `UndefinedTransmuteLint` (the only `#[derive(Diagnostic)]` outside diagnostics.rs in these files) is
  written by hand in the generator's shape; tools/codegen only reads rustc_lint's diagnostics.rs.
- non_local_def.ts: `PathCollector` keeps the `hir::Path` nodes themselves (upstream clones them for a lifetime);
  `bool::then_some(Option<Span>)` is `{ $: "Some", _0 } | undefined` (PORTING §5).
- foreign_modules.ts: `seen_types: UnordSet<(Ty, Ty)>` is a `KeyedSet` keyed on the pair's intern ids; the
  `cfg!(debug_assertions)` layout sanity check in `structurally_same_type` is a comment (never runs in shipped rustc);
  `Iterator::eq_by` is a local helper with the same evaluation order.
- internal.ts `TypeIr::check_expr`: upstream's non-short-circuit `|` on the two `is_diagnostic_item` calls kept
  (both run).
- non_fmt_panic.ts: `PanicMessageNotLiteral`'s manual `Diagnostic` impl is a class with `into_diag` (+ a
  `_diagnostic` trait-object helper).

## Checks

- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok; all 8 files fully covered (table above).
- `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`: 5406 pass, 1 skip, 0 fail.
- tydump-minicore: 45/46 MATCH (1 UNPORTED), identical to base `970d2365` (run 20261021-190352-lint-late-d-i8pp).
- hir-tree `--sample 300` (agent lint-late-d): 300/300, identical to base on the same sample
  (run 20261021-190415-lint-late-d-xkws).
