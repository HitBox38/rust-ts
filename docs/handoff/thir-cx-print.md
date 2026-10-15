# Handoff: thir-cx-print (M3 wave 18): THIR building and printing

Branch `lane/thir-cx-print`, from `integ` 4447fa3. Commits bf5a7be, 9120881 (+ this handoff). No baselines, suites,
oracle outputs, `harness/`, `scripts/`, `tools/` or `UPSTREAM.json` touched. No files of parallel lanes edited
(`src/rustc_hir_typeck`, rustc_trait_selection traits/*, rustc_codegen_ssa, small rustc_middle/hir_analysis stops).

## Summary
- New crate root `src/rustc_mir_build/` (THIR half). THIR building (`thir/cx/*`, `util`, `constant`) and printing
  (`print.rs`) are fully ported. The pattern files are stubs with final signatures for the follow-up lane `thir-pattern`.
- `provide` is wired into `rustc_interface/passes.ts` at upstream's position (right after `rustc_incremental::provide`).
- `src/rust_ts/thirdump.ts` now calls the real `rustc_mir_build::thir::print::{thir_flat, thir_tree}`.
- As expected, every thirdump case still stops before THIR (typeck / old solver / other providers), so suite results
  are unchanged: **no new DIFF**.

## Files touched
- New:
  - `src/rustc_mir_build/lib.ts`: crate root. Load order: cx/mod, cx/block, cx/expr, pattern/mod, pattern/const_to_pat,
    pattern/migration, pattern/check_match.
  - `thir/mod.ts`, `thir/util.ts`, `thir/constant.ts`, `thir/print.ts`.
  - `thir/cx/mod.ts` (`ThirBuildCx` class, `thir_body`, plus a non-marker `push_idx` helper for `IndexVec::push`).
  - `thir/cx/block.ts`, `thir/cx/expr.ts` (extension modules on `ThirBuildCx.prototype`).
  - `thir/pattern/{mod,migration,const_to_pat,check_match}.ts`: stubs.
  - `thir/print.test.ts`: 2 unit tests.
- Edited:
  - `src/rustc_interface/passes.ts`: import plus `rustc_mir_build_provide(providers)` after
    `rustc_incremental_provide`. The "pending crates" comment no longer lists rustc_mir_build.
  - `src/rust_ts/thirdump.ts`: the `unported` stand-ins are gone. `make_callbacks` takes the printers, loaded with
    the driver through `rustc_mir_build/lib.ts`.

## provide (lib.rs:19)
- **Registered:**
  - `check_match`: the **stub** `pattern/check_match.ts::check_match`, which stops as
    `unported("rustc_mir_build::thir::pattern::check_match::check_match (lane thir-pattern)")`.
  - `lit_to_const`: the real port.
  - `thir_body`: the real port.
- **Not registered** (default `<query> provider (not ported)`, commented in lib.ts): the modules below are not ported
  (MIR building, M4).
  - `closure_saved_names_of_captured_variables`, `check_unsafety`, `check_tail_calls`;
  - the `build_mir_inner_impl` hook.

## Coverage (`bun scripts/coverage.ts --missing ...`)
| file | |
|---|---|
| lib.rs | 1/1 |
| thir/mod.rs | 0/0 (module list) |
| thir/cx/mod.rs | 7/7 |
| thir/cx/block.rs | 2/2 |
| thir/cx/expr.rs | 27/27 |
| thir/util.rs | 1/1 |
| thir/constant.rs | 1/1 |
| thir/print.rs | 23/23 |
| thir/pattern/mod.rs, migration.rs, const_to_pat.rs, check_match.rs | 0/14, 0/8, 0/10, 0/34 (stubs) |
| rustc_middle thir.rs, thir/visit.rs | 16/16, 12/12 (already complete, nothing to add) |

`bun scripts/coverage.ts --check`: markers ok (15048; vendor 3888).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_mir_build src/rustc_middle --timeout=60000`: 262 pass, 0 fail.
- `thir/print.test.ts` builds the THIR of `pub fn main() {}` by hand and installs the test file in the source map,
  so spans print as upstream's. It checks:
  - `ThirPrinter::print` against upstream's `tests/ui/thir-print/thir-tree.stdout`;
  - `{:#?}` of the `Thir` (thir_flat's format) against `thir-flat.stdout`.

  Both pass. Two substitutions, documented in the test:
  - the `HirId`'s DefId path is printed by `debug_HirId` (the mock tcx has no definitions);
  - `body_type: Fn(fn())` becomes `Const(())`.
- Samples (`RUST_TS_AGENT=thir-cx-print`):

  | suite | result | base |
  |---|---|---|
  | thirdump-minicore (full, 46) | 5 MATCH / 0 DIFF / 41 UNPORTED (run 20261015-020520-thir-cx-print-w2vo) | 5 / 0 / 41 |
  | tydump-minicore (full, 46) | 5 MATCH / 0 DIFF / 41 UNPORTED | 5 / 0 / 41 |
  | hir-tree-nocore `--sample 100 --seed thir` | 99 MATCH / 0 DIFF / 1 UNPORTED | (no DIFF) |

  thirdump-minicore stops:
  - 27: `FulfillmentContext::new (old solver, wave 20)` (lane selcx-contract);
  - 8: `codegen_fn_attrs provider` (lane codegen-fn-attrs);
  - 3: `check_unused_traits provider`;
  - 2: `StableHash without a TS impl`;
  - 1: `Decodable for ty::TraitDef`.

  None reaches `thir_body` yet.

## Every `unported(...)` left
- cx/expr.ts:
  - **InlineAsm `const` operand**: `rustc_middle::mir::Const::Unevaluated (mir/consts.rs not ported)`.
  - **Non-thread-local static path**: `TyCtxt::reserve_and_set_static_alloc (mir/interpret, M4)`.
  - **`#[const_continue]` without label or value**: `rustc_mir_build::errors::ConstContinueMissingLabelOrValue`.
  - **`#[loop_match]` fatal errors** (`emit_loop_match_fatal`): `rustc_mir_build::errors::LoopMatch{MissingAssignment,
    BadStatements,BadRhs,InvalidMatch,InvalidUpdate}`. The valid `#[loop_match]` path is fully ported.
  - **ICE-message helper only**: `Debug for ty::UpvarId` (manual impl in ty/structural_impls.rs).
- cx/expr.ts and cx/mod.ts reach `pattern::pat_from_hir`, a stub: every body with a parameter, `let`, `if let` or
  `match` arm stops there until thir-pattern lands.
- constant.ts: `parse_float_into_scalar` is a stand-in for `builder::parse_float_into_scalar` (builder; needs
  rustc_apfloat). Float literals stop there.
- print.ts: Debug of `mir::Const`, `AllocId` and `FakeReadCause`. None of them can be built yet (see above;
  `FakeReadCause` only appears with closure fake reads, from typeck's upvar analysis).
- pattern/*.ts: every stub fn and method (`unported_methods` lists).

## `// PORT:` decisions
1. **mir/syntax.rs is not ported.** THIR stores `mir::{BorrowKind, MutBorrowKind, BinOp, UnOp, AssignOp}`; thir.gen.ts
   types them `Pending<..>` / `unknown`.
   - cx/expr.ts builds them in PORTING §5's representation: the variant-name string for fieldless enums,
     `{ $: "Shared" }` / `{ $: "Mut", kind }` for `BorrowKind`. It uses local `Mir*` aliases and casts.
   - print.ts prints them with derived-Debug stand-ins (`debug_mir_*`).
   - When mir/syntax.rs lands, repoint the aliases. No values change.
2. **hir/place.rs is pending** (`HirPlace = Pending<..>`). `HirPlaceView` reads `base_ty`/`base`/`projections` with
   ty/closure.ts's `HirPlaceBase`/`HirProjectionKind` shapes (same precedent as closure.ts).
3. `explicit_params` returns a generator. Upstream returns a lazy `impl Iterator` that `thir_body` chains and collects.
4. **Copies of `CanonicalUserType`** (`*user_provided_types.get(..)` then `&mut .kind`) rebuild the copy instead of
   mutating the table entry (util.ts, expr.ts `with_type_of_did`).
5. **Out-of-file pieces:**
   - `fn local` (nested in the `#[loop_match]` arm) is hoisted to module level;
   - `trait ToBorrowKind` is an interface. Its two impls are functions over the implementing type:
     `AutoBorrowMutability_to_borrow_kind`, `Mutability_to_borrow_kind`.
6. **`stringify!` texts in ICE-only messages** (`assert!`/`assert_matches!`) are the tokens on one line.
7. **Loosely typed queries.**
   - `alloc_steal_thir` (ty/context.ts) types `Thir` as pending, so its result is cast.
   - `layout_of`'s value is `unknown`, so `.size` is read through a cast. That path is enum-discriminant casts;
     the provider is unported anyway.
8. `ThirPrinter` is exported (private upstream) so the unit test can print a hand-built `Thir`.
9. `is_upvar` uses `.has(hir_id)` on `upvars_mentioned`'s `Map<HirId, unknown>`. That query's provider (rustc_passes
   upvars.rs) is not ported; its map must be keyed by value (`HirIdMap`) when it lands, as closure.ts assumes too.

## For root: needed before thirdump can MATCH (outside this lane's files)
- **thir_flat Debug (tools/codegen).** The suites' default format is `{:#?}` of `Thir` (thir_flat), and thir.gen.ts
  still has `unported_debug` for:
  - `AdtExpr.adt_def` / `variant_index` / `user_ty`;
  - `ExprKind::{Binary,Unary,AssignOp}.op`, `Field.{variant_index,name}`, `Borrow.borrow_kind`;
  - every `user_ty` (`Option<Box<CanonicalUserType>>`);
  - `Literal.lit` (`hir::Lit` = `Spanned<LitKind>`), `ConstParam.param`, `StaticRef.alloc_id`;
  - `FieldExpr.name`, `FieldPat.field`, `PatKind::Variant.{adt_def,variant_index}`;
  - `ClosureExpr.fake_reads` cause, `InlineAsmOperand::Const.value`;
  - `PatRangeBoundary::Finite` (ValTree).

  So almost any non-trivial body will stop in `unported_debug` once THIR building runs.

  Most of these have TS Debug impls already. `tools/codegen/middle_traits_thir.typemap.json` (set
  `rustc_middle_traits_thir`) needs entries for:
  - `VariantIdx`/`FieldIdx`: newtype_index with the default `debug_format = "{}"`, i.e. the plain number;
  - `CanonicalUserType`: `debug_Canonical(.., debug_UserType)`;
  - `hir::Lit`: `debug_Spanned(.., debug_LitKind)`;
  - `ParamConst`: `debug_ParamConst`;
  - `AdtDef`.

  The mir types need mir/syntax.rs (or stand-ins like print.ts's). This is a tools/ change, so I left it to root.
  thir_tree (`THIRDUMP_FORMAT=tree`) only needs `{:?}` of `Pat` in `ExprKind::Let`, which has the same gaps for
  patterns.
- **`rustc_mir_build` diagnostics.rs** (`#[derive(Diagnostic)]`): no codegen set exists. It is needed for the
  loop_match / const_continue fatal errors here and heavily by thir-pattern (check_match, const_to_pat, migration).
  Suggest adding a codegen set `rustc_mir_build` (as rustc_passes / rustc_ty_utils have) before or within thir-pattern.
- `upvars_mentioned` provider (rustc_passes upvars.rs) and `reserve_and_set_static_alloc` are missing for closures and
  statics.

## Scope note for the follow-up lane `thir-pattern`
- **Files:** `compiler/rustc_mir_build/src/thir/pattern/{mod,migration,const_to_pat,check_match}.rs` (3224 lines).
  The TS stubs are `src/rustc_mir_build/thir/pattern/*.ts`; follow "How to fill a stub" in the header of
  pattern/mod.ts.
  - **Signatures are final:** `pat_from_hir(upper, tcx, typing_env, typeck_results, pat, let_stmt_type): Pat`, called
    by `ThirBuildCx.pattern_from_hir{,_with_annotation}`, and `check_match(tcx, def_id)`, registered by lib.ts.
  - **Already declared:** `PatCtxt` (class, fields in upstream order), `PatMigration`, `ConstToPat`, `MatchVisitor`
    (extends rustc_middle thir `Visitor`; its field `thir` is `thir_` because of the `thir()` method), `RefutableFlag`,
    `LetSource`, `PartialEqImplStatus`.
- **Dependencies:**
  - **pattern/mod.rs and const_to_pat.rs** (the part THIR building needs) depend on rustc_middle (ported: thir.ts
    `Pat`/`PatRange`, typeck_results' `pat_adjustments`, `pat_binding_modes`, ...), `lit_to_const` (ported here),
    `const_lit_matches_ty` (ported in rustc_middle ty/consts/lit.ts) and const eval for `const_to_pat` (valtrees;
    `const_eval_resolve_for_typeck`, M4: expect UNPORTED there).
  - **check_match.rs** needs rustc_pattern_analysis (an unported crate, about 10k lines) for usefulness checking. The
    stub types its types `unknown`. Recommend splitting: `thir-pattern-lower` (mod.rs, migration.rs, const_to_pat.rs,
    about 1.65k lines) first; `check_match` together with a rustc_pattern_analysis lane later.
  - **The pattern Debug gaps** listed above (`PatKind::Variant`, `FieldPat`, `PatRangeBoundary`) block thir_flat
    output of patterns.
