# Handoff: merge-w18 (fixer): integration fixes for wave 18a/18b on `integ`

Worktree `.data/integ`, branch `integ`, from 60a45cf. Commits (on `integ`, not pushed): 9a2571c, a1665bd, e5df3d48, d9714780,
5b7a6762 (+ this handoff). Main untouched.

## 1. The 8 failing tests (5230 pass / 8 fail before)

| test | finding | action |
|---|---|---|
| privacy_test/clean_pub.rs (--mod-privacy) | stop moved forward (`FnCtxt::normalize` ported) to `fn_ctxt::suggestions::FnCtxt::fn_sig`; after porting `fn_sig` a **real bug** surfaced: an ICE "`trimmed_def_paths` called, diagnostics were expected but none were emitted" | (a) ported `FnCtxt::fn_sig` (suggestions.rs:43, 5 lines, on the success path of every fn body: `check_return_or_body_tail`); (b) fixed writeback.ts `write_ty_to_typeck_results`: the `assert!` message was formatted eagerly with `display_Ty` (records trimmed paths) on every node; now formatted only on failure. With both, `check_mod_privacy` runs clean and **equals the oracle** (exit 0, empty stderr): locked as an oracle case (`["clean_pub", "--mod-privacy"]` in CASES), the stop test removed. |
| collect_test/generics.rs, misc.rs | stop moved forward: `lit_to_const` is ported (thir-cx-print); `3usize` truncation now reads `tcx.data_layout` | re-pinned the 4 `type_of STOP` lines to `rustc_target::spec::Target::parse_data_layout (GlobalCtxt::data_layout; pending target-cfg / rustc_abi)` (genuinely unported: context.ts `data_layout` getter). Probe comparison unchanged (STOP lines). |
| lower_ty "stops at the remaining stubs" | same as above (P4, P7) | re-pinned P4/P7 with the reason in a comment. |
| entry_test/{args,generic,where,plain}_main.rs | stop moved forward: `ty::TraitDef` decodes (small-gaps-18); next stop is `Decodable for ty::ImplTraitHeader<'static>` (cstore_impl `impl_trait_header`, `decode_unported`) | re-pinned PENDING (all 4 cases stop there; none equals the oracle yet). |

No assertion that matched the oracle was weakened.

## 2. Merge seams fixed

- **CoerceMany** = coercion.ts's hand class: tools/codegen types.sets.json `rustc_hir_typeck` `hand` += `coercion::CoerceMany` (+ hand_note);
  coercion.gen.ts now only re-exports it; decls.ts imports `CoerceMany` from `./coercion.ts`. Dropped `ret_coercion_of` /
  `as_gen_CoerceMany` (expr.ts), `as_hand_CoerceMany` (_match.ts), the casts in check.ts and closure.ts.
- decls.ts signatures: `explain_if_expr(.., error: MutRef<boolean>)`, `adjust_expr_for_assert_eq_macro(MutRef<hir.Expr>,
  MutRef<hir.Expr | undefined>)`, `Fns_upvar.truncate_place_to_len_and_update_capture_kind(.., curr_mode: MutRef<UpvarCapture>, ..)`;
  dropped the local overloads / typed-call helper (_match.ts `explain_if_expr` helper, demand.ts `declare module`, upvar.ts overloads).
- **hir::place** everywhere is rustc_middle hir/place.ts: ty/decls.ts `HirPlace` = `hir::place::Place` (re-export); ty/closure.ts
  views (`HirPlaceView`, `HirPlaceBase`, `HirProjectionKind`, local `ProjectionKind_eq`, unported Debug stand-ins) dropped, uses the
  real `debug_Place` / `debug_PlaceBase` / `debug_ProjectionKind` / `ProjectionKind_eq`; thir/cx/expr.ts view + local
  `debug_HirPlaceBase` (whose Upvar arm was `unported`) dropped; upvar.ts views (`pv`, `pv_proj`, `pvh`, `as_HirPlace`), `Place_new`,
  `PlaceWithHirId_new`, `clone_Place`, `PlaceBase_eq`, `ProjectionKind_eq`, Debug stand-ins dropped; expr_use_visitor.ts `as_place`
  dropped; hir/mod.ts `pub mod place` (`export * as place`). codegen hir_typeck.typemap.json maps `rustc_middle::hir::place::Place`
  (upvar.gen.ts `InferredCaptureInformation` is `[Place, CaptureInfo][]`, was `unknown`).
- tydump_dump.ts: `closure_kind_origins` / `closure_fake_reads` print with the real Debug impls (were `unported_debug`);
  `hidden_types` cast dropped.
- typeck_results.ts: `FakeReadCause` = mir/syntax.ts's; `ClosureSizeProfileData` / `DefinitionSiteHiddenType` = ty/mod.ts's (were
  `Pending`); writeback.ts `hidden_types_of` / `closure_size_eval_of` and opaque_types.ts `hidden_types_of` casts dropped.
- ty/decls.ts `BinOp` / `UnOp` = mir/syntax.ts's; structural_impls.ts uses the generated `debug_BinOp` / `debug_UnOp` (stand-ins were
  `unported`); pretty.ts `UnOpT` view dropped.
- closure.ts's copy of `Elaboratable_Clause_Span` dropped (uses ty/elaborate_impl.ts). fn_ctxt/checks.ts `InlineAsmCtxt.new` cast dropped.

Not changed (not mechanical / not a duplicate):
- rustc_middle ty/decls.ts `ProjectionKind` is **`mir::ProjectionKind`** (`ProjectionElem<(), ()>`, `TyCtxt.projs`), not
  `hir::place::ProjectionKind`; left `Pending`.
- `fold_Place` (upvar.ts), `fold_HirPlace` / `fold_CapturedPlace` (writeback.ts): TypeFoldable/TypeVisitable derives of hir/place.rs and
  ty/closure.rs types are not generated (needs a codegen set for hand-written types); stand-in texts now say so. Every closure capture
  stops here once the earlier stops are gone.
- `pending_SelectionContext_new`: already gone (selcx-contract). `BinOp::to_hir_binop` stays a stand-in (mir/statement.rs:953, no file).
- `TypeErrCtxt` views (`err_ctxt() as unknown as ..View`): wave 19 (errctxt contract).

## 3. Verification

- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (16158; vendor 3888). Coverage: TOTAL 15639/25518
  (61.29%); rustc_hir_typeck 828/1041. suggestions.rs: `fn_sig` ported, rest missing (wave 19).
- Full `RUST_TS_REQUIRE_PROBES=1 bun test src tools --timeout=120000`: see the result at the end of this file.
- Samples, integ (HEAD 5b7a6762) vs base main 17f29c7 (temporary worktree, removed). No DIFF, no lost MATCH in any suite.

| suite | base MATCH / UNPORTED | integ MATCH / UNPORTED | DIFF |
|---|---|---|---|
| tydump-minicore (46) | 5 / 41 | 14 / 32 | 0 |
| thirdump-minicore (46) | 5 / 41 | 14 / 32 | 0 |
| tydump-nocore (300, seed m17) | 49 / 251 | 262 / 38 | 0 |
| hir-tree-nocore (300, seed m17) | 295 / 5 | 299 / 1 | 0 |
| expanded (200, seed m18) | 199 / 1 | 199 / 1 | 0 |
| parse (200, seed m18) | 200 / 0 | 200 / 0 | 0 |

Base top stops: FulfillmentContext::new (old solver) 27+27, codegen_fn_attrs 217 (tydump-nocore) / 8+8 / 5 (hir-tree).

## 4. Top remaining stops (integ samples, ranked by cases)

| cases | stop | suites |
|---|---|---|
| 48 | `rustc_trait_selection::traits::select::SelectionContext::poly_select` (old solver select, wave 18b old-solver fill lanes) | tydump-/thirdump-minicore 24+24 |
| 26 | `rustc_middle::mir::ConstraintCategory (mir, M4): BoringNoLocation` | tydump-nocore 14, minicore 6+6 |
| 9 | `rustc_target::spec::Target::parse_data_layout` (`tcx.data_layout`; target-cfg / rustc_abi) | tydump-nocore 8, hir-tree-nocore 1 |
| 6 | `TyCtxt::const_eval_resolve_for_typeck` (const eval, M4) | tydump-nocore |
| 5 | `IntegerExt::from_int_ty` (4) / `to_ty` (1) (ty/layout.rs, M4) | tydump-nocore |
| 4 | `CrateMetadata::get_adt_def` (ReprOptions decode, ty::AdtDef) | tydump-nocore |
| 2+2 | `TyCtxt::mk_pat` (Pattern class); QueryKey `ty::PseudoCanonicalInput<Ty>` | minicore |
| 1 | `thir_abstract_const` provider; `Decodable for VariantData` (expanded) | |

Unit-test pins (not in samples): `Decodable for ty::ImplTraitHeader<'static>` (entry tests, every std crate main);
`hir::place::Place TypeVisitable/TypeFoldable` (closures with captures, after the above).

## 5. PORT decisions to record

1. `assert!(cond, "{}", display(..))` messages whose formatting has side effects (trimmed paths) are formatted only on failure
   (`if (!cond) panic(..)`), never eagerly (writeback.ts `write_ty_to_typeck_results`).
2. rustc_middle ty/decls.ts `ProjectionKind` stays `mir::ProjectionKind` (pending, M4); `HirPlace` = hir/place.ts `Place`.
3. `CoerceMany` is a codegen `hand` type of set rustc_hir_typeck.
4. `FnCtxt::fn_sig` (suggestions.rs:43) pulled forward from wave 19 (success path).

## 6. Files touched
src/rustc_hir_typeck/{decls,expr,_match,check,closure,demand,upvar,upvar.test,expr_use_visitor,writeback,opaque_types,coercion.gen,
upvar.gen}.ts, fn_ctxt/{suggestions,checks}.ts; src/rustc_middle/ty/{decls,closure,typeck_results,structural_impls,ty_adt_assoc.test}.ts,
ty/print/pretty.ts, hir/{mod,place}.ts; src/rustc_mir_build/thir/cx/expr.ts; src/rust_ts/tydump_dump.ts; src/rustc_privacy/privacy.test.ts;
src/rustc_hir_analysis/{check/entry.test.ts, hir_ty_lowering/lower_ty.test.ts, collect_test/{generics,misc}.expected.txt};
tools/codegen/{types.sets.json, hir_typeck.typemap.json}.

## Full test result
`RUST_TS_REQUIRE_PROBES=1 bun test src tools --timeout=120000` on 5b7a6762: **5238 pass / 1 skip / 0 fail** (5239 tests, 341 files,
1494 s; log /tmp/integ-tests-m18.log).
