# Handoff: errctxt-contract (M3 wave 19, contract-first): the error-reporting contract

Branch `lane/errctxt-contract` (from integ `5602fa2b`, no merges). Commits: contract + codegen + stubs + ports → view
replacement → ObligationCauseExt + contract test + re-pins + this handoff.

## Result
- **`TypeErrCtxt` is real.** `infcx.err_ctxt()` and `fcx.err_ctxt()` return a `TypeErrCtxt` (all fields), whose methods are
  ported or `unported` placeholders named after their own module. Every `Pending` TypeErrCtxt alias and every local view
  (`TypeErrCtxtView`, `TypeErrCtxtMethods` / `err_ctxt_methods`, `TypeErrCtxt_`, `TypeErrCtxt_suggest`, traits/mod.ts's
  exported `err_ctxt(infcx)`, the inline `as unknown as {..}` casts) is gone; callers call the contract directly, so the stop
  moved to the exact method placeholder.
- **Contract** (`src/rustc_trait_selection/decls.ts`, section "Error reporting"): one declaration of each of the 377 fns
  of error_reporting/** + diagnostics.rs + diagnostics/note_and_explain.rs under `// <file>:<line>`, grouped by file with the
  lane that ports it:
  - `class TypeErrCtxt` (6 fields, `declare static as_host_effect_clause`) + `interface TypeErrCtxt extends
    Omit<InferCtxt, "dcx" | "err_ctxt" | "drop">` with all 197 `impl TypeErrCtxt` / `Deref` methods;
  - `NiceRegionError` (hand class in nice_region_error/mod.ts) methods (19) and statics (`new`, `new_from_span`,
    `get_impl_ident_and_self_ty_from_trait`) by module augmentation;
  - `ObligationCauseExt` (3) on rustc_middle's `ObligationCause` (module augmentation of traits/mod.gen.ts);
  - `interface Fns_<module>` for the 32 free fns of 12 modules;
  - comment-only declarations for trait impls (visitors, folders, `IntoDiagArg`, `Subdiagnostic`, `Diagnostic`), nested fns
    and single-file helper types.
- **Codegen set `rustc_trait_selection_error_reporting`** (types.sets.json, appended): 22 error_reporting files +
  diagnostics.rs + diagnostics/note_and_explain.rs → 16 `*.gen.ts`, 98 types, 43 diagnostic derives, 10 Debug, 11 Clone.
  Report: 0 unknown types, 1 missing Debug (`TypeckResults` inside `CoroutineData`, debug!-only), 2 missing IntoDiagArg/Display
  (`Binder<FnSig>` in diagnostics.rs:1522/1610 + 4 Display uses: needs a `$into0` template in tools/codegen, see "For root").
  - **need_type_info.rs is not in the set**: the typedefs probe (syn) cannot parse its `do yeet ()` (1209:16). Its 9 types
    are hand-written in need_type_info.ts (`// rustc-type:` markers); `ClosureEraser` / `FindInferSourceVisitor` are
    `unknown` aliases for the lane.
  - New set-local type map `tools/codegen/error_reporting.typemap.json` (10 entries; `hir::Ty` is diagnostics.ts's
    `hir_Ty` because the generator would import `hir::Ty` and `ty::Ty` under one name).
  - `tools/codegen/diag_args.json`: 3 entries (`ClosureKind`, `AliasConst`: the ported ir_print.rs impls;
    `UnderspecifiedArgKind`: need_type_info.ts stub). Also fixed the missing comma after the `GenericArg` entry.
- **Stub modules** for every file (header "How to fill this stub"): `unported_methods(TypeErrCtxt.prototype, ..)` lists
  (split files have one list per lane under `// ==== lane <name> ====`), `NiceRegionError` lists, free fns as
  `export const f = ((): never => unported(..)) as Fns_<module>["f"]` (infcx-contract precedent), `export type X = unknown`
  for single-file hand visitor types, diagnostics.ts / note_and_explain.ts manual-impl stubs under the names the
  generated files import.
- **Ported for real** (31 fns): error_reporting/mod.rs 4/4 (`InferCtxt::err_ctxt`, `dcx`, deprecated `err_ctxt`, `deref`),
  traits/overflow.rs 7/7 (incl. nested `with_short_path`), traits/call_kind.rs 3/3 (`CallDesugaringKind`, `call_kind`),
  traits/mod.rs 6/15 (`FindExprBySpan` class + `new` + 3 Visitor methods, `ArgKind::{empty, from_expected_ty}`),
  suggestions.rs 4/80 (`SelfVisitor`, `ReturnsVisitor`, `AwaitsVisitor` classes: rustc_hir_analysis reads ReturnsVisitor),
  infer/mod.rs 3/53 (`ObligationCauseExt`: the first stop of 12 minicore cases), plus rustc_hir_typeck
  `FnCtxt::err_ctxt` (fn_ctxt/mod.rs:192, body was `unported`).
- **Stand-ins repointed to the contract**: `report_dyn_incompatibility` (traits/project.ts, hir_analysis
  hir_ty_lowering/errors.ts + dyn_trait.ts), `to_pretty_impl_header` (specialize/mod.ts), `suggest_new_overflow_limit`
  (coherence.ts, now real), `ArgKind::from_expected_ty` + `get_fn_like_arguments` / `report_arg_count_mismatch` (hir_typeck
  closure.ts `sig_of_closure_with_mismatched_number_of_arguments`, now the upstream body), `report_mismatched_types`
  (method/confirm.ts), `emit_inference_failure_err` (method/probe.ts), `ReturnsVisitor` +
  `ObligationCause::as_failure_code_diag` (hir_analysis check/mod.ts), `ty_kind_suggestion` (check/mod.ts),
  `DefIdOrName` (hir_typeck decls.ts `Pending` → the generated type; callee.ts's local repr cast removed).

## Representation decisions (please record)
1. **TypeErrCtxt Deref = FnCtxt's**: field `infcx` + forwarders. The registry moved from rustc_hir_typeck/decls.ts to
   `src/rust_ts/deref.ts` (hir_typeck decls.ts re-exports `register_deref` / `install_derefs` / `registered_derefs`);
   `install_derefs()` is now re-runnable (a later call adds forwarders for inner members added since; own/forwarded members
   untouched). rustc_trait_selection/lib.ts calls it at its end; rustc_hir_typeck/lib.ts's call stays.
   `TypeErrCtxt_shadowed = "dcx" | "err_ctxt" | "drop"`: a TypeErrCtxt is not structurally an InferCtxt; a deref coercion
   is `this.infcx` (checked with `@ts-expect-error`).
2. `typeck_results: Option<Ref<TypeckResults>>` is `TypeckResults | undefined`; the two boxed closures are plain fns.
3. **Hand types**: `TypeErrCtxt` (decls.ts class), `NiceRegionError` (field `regions` → `regions_`, the method `regions()`
   collides; precedent `CoerceMany.expected_ty_`), visitor/folder/relation types (`unknown` aliases until their lane writes
   the class), `SelfVisitor` is `skip` + hand Debug (hir::Ty vs ty::Ty `debug_Ty` clash; precedent `SelfSource`).
4. nice_region_error/mod.rs's `pub use find_anon_type::.., static_impl_trait::.., util::..` are **not re-exported** by
   mod.ts: a re-export evaluates those modules before mod.ts defines `NiceRegionError` (TDZ). Import from the submodules.
5. Signatures: `long_ty_path: &mut Option<PathBuf>` → `MutRef<PathBuf | undefined>`; `T: Upcast<TyCtxt, Predicate>` adds
   `upcast_from_T: (from: T, tcx: Interner) => Predicate` last (rustc_infer convention; callers with `T = Predicate` pass
   rustc_type_ir's `upcast_from_self`; select/mod.ts's `check_recursion_depth` now forwards its `upcast_from_T`);
   `T: TypeFoldable` / `Relate` / `Display` add `d_T` / `display_T`; `maybe_highlight<T: Eq + ToString>` takes
   `to_string_T` (`Eq` is `===`); `impl Into<MultiSpan>` → `IntoMultiSpan`; `&dyn Display` → `string`;
   `TypeAnnotationNeeded` is need_type_info.ts's string union `"E0282" | "E0283" | "E0284"`; enum methods on companions
   (`ArgKind`, `CallDesugaringKind`, `SourceKindSubdiag`, `ActualImplExplNotes`).
6. `Iterator::max_by_key` (report_overflow_obligation_cycle) keeps the **last** maximal element.

## Split table (wave 19; upstream lines; ordered by tydump-minicore stop frequency after this lane)
| # | lane | upstream | lines | minicore stops | notes |
|---|---|---|---|---|---|
| 1 | errrep-infer-a | error_reporting/infer/mod.rs (rest: 50 fns) | 2753 | **12** `TypeErrCtxt::note_type_err` | type-mismatch reporting (`report_and_explain_type_error`, `note_type_err`, `cmp`, `values_str`, ...); `SameTypeModuloInfer` class. All 12 are `start_lang_item_args.rs` revisions (hir_analysis `check_function_signature`) |
| 2 | typeck-demand-adjust | rustc_hir_typeck demand.rs except :171..289; fn_ctxt/adjust_fulfillment_errors.rs | ~2435 | **3** `adjust_fulfillment_error_for_expr_obligation` | |
| 3 | typeck-suggest-b | rustc_hir_typeck method/suggest.rs:2433..5035 | ~2600 | **3** (2 `suggest_assoc_method_call`, 1 `all_traits`) | |
| 4 | errrep-traits-a | traits/mod.rs (rest), traits/on_unimplemented.rs, traits/fulfillment_errors.rs:1..1529 | ~2680 | **1** `report_fulfillment_errors` | `report_fulfillment_errors` / `report_selection_error`: the hub of every trait error; ui/traits needs it first |
| 5 | errrep-sugg-a | traits/suggestions.rs:1..2484 | 2484 | **1** `note_field_shadowed_by_private_candidate` | |
| 6 | errrep-traits-b | traits/fulfillment_errors.rs:1530..4136 | 2607 | 0 | |
| 7 | errrep-need-type-info | infer/need_type_info.rs, traits/ambiguity.rs | 2467 | 0 | `emit_inference_failure_err` (E0282/E0283), ambiguity; hand types already in need_type_info.ts |
| 8 | errrep-sugg-b | traits/suggestions.rs:2485..5017 | 2533 | 0 | `note_obligation_cause_code(_inner)` (1150 lines) |
| 9 | errrep-sugg-c | traits/suggestions.rs:5018..7379 | 2362 | 0 | the 3 visitors ported here; rest of the file |
| 10 | errrep-infer-b | infer/note_and_explain.rs, infer/suggest.rs, diagnostics.rs manual impls (15), diagnostics/note_and_explain.rs | ~2700 | 0 | |
| 11 | errrep-region | infer/region.rs; nice_region_error/{mod,util,find_anon_type,different_lifetimes,named_anon_conflict}.rs | 2293 | 0 | `report_region_errors` (wfcheck / compare_impl / borrowck) |
| 12 | errrep-nice-region | nice_region_error/{placeholder_error,placeholder_relation,static_impl_trait,trait_impl_difference,mismatched_static_lifetime}.rs | 1629 | 0 | |
| 13 | typeck-checks-b | rustc_hir_typeck fn_ctxt/checks.rs:1669..3710 | 2042 | 0 | argument-error reporting (deferred from 18b) |
| 14 | typeck-suggest-a | rustc_hir_typeck method/suggest.rs:1..2432 | ~2430 | 0 | `report_method_error` .. `confusable_method_name` |
| 15 | typeck-fnsugg-a | rustc_hir_typeck fn_ctxt/suggestions.rs:1..2025, method/prelude_edition_lints.rs except :156/:273 | ~2280 | 0 | |
| 16 | typeck-fnsugg-b | rustc_hir_typeck fn_ctxt/suggestions.rs:2026..3956, diagnostics.rs manual impls (10) | ~2300 | 0 | |
| — | (done here) | error_reporting/mod.rs, traits/overflow.rs, traits/call_kind.rs; the small items listed above | | | |

Stop ranking (tydump-minicore, 25 UNPORTED; thirdump-minicore identical): base 14 at `err_ctxt` → now 12 `note_type_err`,
3 `adjust_fulfillment_error_for_expr_obligation`, 2 `suggest_assoc_method_call`, 1 each `all_traits`,
`report_fulfillment_errors`, `note_field_shadowed_by_private_candidate`; non-error-reporting: `mk_pat`, `const_eval_poly`,
`QueryKey PseudoCanonicalInput<Ty>`, `layout_of`, `Relate for &List<PolyExistentialPredicate>`. For M3b (≥ 80% minicore)
lanes 1–5 plus those five non-error stops are the path; tydump-ui (ui/traits) will weigh errrep-traits-a/-b and
errrep-sugg-* far higher.

## How to fill a stub
1. **Find the declaration** in `src/rustc_trait_selection/decls.ts` under `// <file>:<line>`: `interface TypeErrCtxt`
   (grouped by file and lane), `declare module ".../nice_region_error/mod.ts"` (`NiceRegionError`), `declare module
   "../rustc_middle/traits/mod.gen.ts"` (`ObligationCause`), `interface Fns_<module>`, or the comment-only section. Do not
   change a real signature; a wrong one goes in your handoff (or a local `declare module` marked `// PORT(decls): pending root`).
2. **Methods**: in upstream order `TypeErrCtxt.prototype.<name> = function (this: TypeErrCtxt, ..): R { .. };` with
   `// rustc: compiler/rustc_trait_selection/src/<file>:<line> <name>` directly above, then delete the name from your lane's
   `unported_methods` list (the call when empty). Same for `NiceRegionError.prototype`; statics: `(NiceRegionError as
   unknown as {..}).new = function ..`; `TypeErrCtxt.as_host_effect_clause = function ..`.
3. **Free fns**: replace the `export const f = ((): never => unported(..)) as Fns_..["f"]` by `export function f(..)` with
   the declared signature and the marker.
4. **Deref**: `self.tcx`, `self.infcx`, `self.next_ty_var(..)`, `self.can_eq(..)`, `self.probe(..)` are `this.tcx`, ... (the
   forwarders); a `&TypeErrCtxt` passed as `&InferCtxt` is `this.infcx`. `self.typeck_results` is `this.typeck_results`
   (`TypeckResults | undefined`).
5. **Types are generated** (`<file>.gen.ts`, set `rustc_trait_selection_error_reporting`; fix maps in
   `tools/codegen/error_reporting.typemap.json` and regenerate with `bun tools/codegen/types.ts
   rustc_trait_selection_error_reporting`, root-reviewed). Replace an `export type X = unknown` hand alias with the class
   (fields in declaration order) and its trait impl. Manual diagnostic impls: fill the stubs in diagnostics.ts /
   note_and_explain.ts / placeholder_error.ts (`Highlighted_into_diag_arg`) / need_type_info.ts
   (`UnderspecifiedArgKind_into_diag_arg`) in place.
6. **Init order**: a module's top-level code touches only the crate decls.ts (`TypeErrCtxt`), its own `.gen.ts`, `./mod.ts`
   (`NiceRegionError`) and other crates; other modules of the crate are read inside function bodies (lazy `require` where a
   static import closes a cycle: overflow.ts's `traits_mod()`). Every module loads as a fresh entry point (checked).
7. `src/rustc_trait_selection/errctxt_contract.test.ts` must stay green; its counts change only with the declarations.

## `unported(...)` left
- Placeholders: `TypeErrCtxt` 189 methods + `as_host_effect_clause`; `NiceRegionError` 19 + 3 statics; free-fn stubs 30;
  manual-impl stubs: diagnostics.ts 13 + 2 companions, note_and_explain.ts 5, `Highlighted_into_diag_arg`,
  `UnderspecifiedArgKind_into_diag_arg`.
- In ported code: `call_kind` `DerefCoercion` arm → `Instance::try_resolve` (rustc_middle ty/instance.rs, not ported).
- Generated: diagnostics.gen.ts `Binder<FnSig>` IntoDiagArg / Display (`unported_into_diag_arg` / `unported_display`).

## Re-pinned tests (no matching assertion weakened; each now pins the exact new stop)
- `src/rustc_hir_typeck/contract.test.ts` "Deref ...": the registered-derefs list gains `"TypeErrCtxt.infcx -> InferCtxt"`
  (shared registry).
- `src/rustc_infer/contract.test.ts`: (a) "rustc_trait_selection's extension methods ..." scans only the extension-trait /
  SelectionContext part of rustc_trait_selection/decls.ts (count 127 unchanged); the error-reporting declarations are
  checked by the new errctxt_contract.test.ts; (b) "the contract's placeholders stop as UNPORTED": `infcx.err_ctxt()` is
  ported, the example moves to `err_ctxt().report_fulfillment_errors([])` (traits::TypeErrCtxt placeholder).
- `src/rustc_hir_analysis/check/entry.test.ts` (args_main.rs, E0580) and `compare_impl_item.oracle.test.ts` (in-process
  e0053_sig, e0326): `InferCtxt::err_ctxt` → `error_reporting::infer::TypeErrCtxt::note_type_err`.
- `src/rustc_hir_analysis/check/wfcheck_a.test.ts` (field_bound.rs) and `wfcheck_b.test.ts` (static_wf.rs, E0277):
  `InferCtxt::err_ctxt` → `error_reporting::traits::TypeErrCtxt::report_fulfillment_errors`.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (16397; vendor 3888).
- Coverage: rustc_trait_selection 597/976 (was 570): error_reporting/mod.rs 4/4, overflow.rs 7/7, call_kind.rs 3/3,
  traits/mod.rs 6/15, suggestions.rs 4/80, infer/mod.rs 3/53; TOTAL 15881/25518.
- New test `src/rustc_trait_selection/errctxt_contract.test.ts` (7 tests, pass): scan = coverage (377); every fn declared at
  file:line; TypeErrCtxt / NiceRegionError / ObligationCause declare their impl methods; every declared method exists and
  placeholders name their own module; `Fns_*` (tsc `satisfies`) and their UNPORTED paths; Deref forwarders / shadowing /
  `@ts-expect-error`; `InferCtxt::err_ctxt` fields; ported small items.
- Every error_reporting / diagnostics module loads as a fresh entry point.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools --timeout=120000`: 5284 pass, 1 skip, 0 fail (348 files).

## Samples (lane vs base; base = this worktree before any runtime change, `RUST_TS_AGENT=errctxt-base`)
| suite | lane run | M / D / U / C | base run | M / D / U / C |
|---|---|---|---|---|
| tydump-minicore (46) | `20261015-124405-errctxt-contract-ixz1` | 21 / 0 / 25 / 0 | `20261015-112826-errctxt-base-utu4` | 21 / 0 / 25 / 0 |
| thirdump-minicore (46) | `20261015-131517-errctxt-contract-uxyn` | 21 / 0 / 25 / 0 | `20261015-112837-errctxt-base-5nzw` | 21 / 0 / 25 / 0 |
| tydump-nocore `--sample 300 --seed m17` | `20261015-124429-errctxt-contract-xteq` | 287 / 0 / 13 / 0 | `20261015-112848-errctxt-base-vjl6` | 287 / 0 / 13 / 0 |

No new DIFF; statuses identical; only the stops of the 14 err_ctxt cases moved (to the methods listed above).
tydump-nocore: identical stops.

## For root
1. Record the decisions above (1 shared Deref registry + re-runnable install, 3 hand types / `regions_`, 4 no re-exports in
   nice_region_error/mod.ts, 5 signature rules, the stub form `export const f = .. as Fns_..`) and the split table.
2. Review the tools changes: set `rustc_trait_selection_error_reporting` (types.sets.json, appended), new
   `error_reporting.typemap.json`, diag_args.json (3 entries + the comma fix).
3. Codegen follow-ups: (a) the typedefs probe cannot parse `do yeet` (need_type_info.rs) — blanking it like default field
   values would let the set include the file (its types are hand-written meanwhile); (b) a `$into0` template in diag_args
   for generic `IntoDiagArg` impls (`Binder<T>`), so `Binder<FnSig>` fields get `Binder_into_diag_arg(v, p,
   FnSig_into_diag_arg)`; (c) an import alias in type maps would remove diagnostics.ts's `hir_Ty` re-export.
4. Shared files edited outside rustc_trait_selection/error_reporting (review): rustc_trait_selection `decls.ts`, `lib.ts`,
   `diagnostics.ts` (new), `traits/{mod,engine,fulfill,normalize,project,coherence}.ts`, `traits/select/mod.ts`,
   `traits/query/normalize.ts`, `traits/specialize/mod.ts`, `solve/fulfill.ts`; rustc_traits `codegen.ts`,
   `normalize_projection_ty.ts`; rustc_hir_typeck `decls.ts`, `fn_ctxt/{mod,_impl,checks}.ts`, `expr.ts`, `op.ts`, `cast.ts`,
   `closure.ts`, `callee.ts`, `coercion.ts`, `demand.ts`, `opaque_types.ts`, `writeback.ts`, `method/{confirm,probe}.ts`,
   `contract.test.ts`; rustc_hir_analysis `check/{check,mod,entry,compare_eii,compare_impl_item,wfcheck}.ts`,
   `coherence/builtin.ts`, `coherence/builtin/coerce_shared.ts`, `impl_wf_check/min_specialization.ts`,
   `hir_ty_lowering/{errors,dyn_trait}.ts`; rustc_passes `check_attr.ts`; `src/rust_ts/deref.ts` (new).
5. Remaining stand-ins outside this crate that name error_reporting items (left: other owners / not on the TypeErrCtxt
   path): rustc_hir_analysis collect.ts and hir_ty_lowering/dyn_trait.ts `NextTypeParamName::next_type_param_name`
   (suggestions.rs:6970, lane errrep-sugg-c), rustc_mir_build const_to_pat.ts `compute_applicable_impls_for_diagnostics`
   (ambiguity.rs, lane errrep-need-type-info), specialize/mod.ts `NegativePositiveConflict` (now diagnostics.ts
   `NegativePositiveConflict_diagnostic` stub, lane errrep-infer-b).
