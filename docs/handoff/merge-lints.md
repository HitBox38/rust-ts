# Handoff: merge-lints (fixer on integ-w19, after the late-lint merges)

Branch `integ-w19`, base `344608db` (lint-late-a..e2, passes-dead, index-ds, mir-contract, vendor-apfloat-a merged).
Agent `merge-lints`. Commits: `75cfc0c8` (driver swap), `be0f2571` (codegen + diagnostics), `3b402c17` (inhabitedness),
`104f8ea0` (codegen regen), then the checks/handoff commit.

## 1. Typecheck: stand-in late-lint drivers removed
- `bunx tsc --noEmit -p .` had 3 errors in `src/rustc_lint/late_d_test/walker.ts`. Fixed by deleting the stand-ins:
  `src/rustc_lint/late_d_test/`, `late_passes_e1_oracle/`, `late_e2_oracle/` (lint-late-b and -c already used the real
  driver). `late_d`, `late_passes_e1`, `late_e2` oracle tests now run `src/rustc_lint/late_oracle/run.ts
  --late-pass=<file>:<Pass>` (each test has a `PASS_FILE` map).
- e1's `stop` cases were lenient ("may stop"); they are now pinned (exit 70 at the listed stop required, else
  "drop `stop` from this case"). 8 e1 cases whose stops were context.rs methods (ported by lint-late-a) now match rustc in
  full: c-void-returns, lint-enum-intrinsics-non-enums, issue-108155, for_loop_over_fallibles (`?` suggestion),
  lint-strict-provenance-lossy-casts, invalid_from_utf8, let_underscore_drop, let_underscore_lock.

## 2. Root items from the lint handoffs
- `foreign_modules.ts`: the local `types` shims are gone; `import * as types from "./types.ts"` (as upstream `use crate::types`).
- **codegen** (`tools/codegen/types.sets.json`, set `rustc_lint`): + `async_closures.rs`, `if_let_rescope.rs`,
  `impl_trait_overcaptures.rs`, `opaque_hidden_inferred_bound.rs`, `transmute.rs` (every rustc_lint file with a local
  derive(Diagnostic/Subdiagnostic); context.rs only mentions it in a comment). New `*.gen.ts` per file; the hand ports
  `export *` them. `hand` (+`hand_notes`): the pass structs (`CheckTransmutes`, `IfLetRescope`), hand-written types
  (`ImplTraitOvercapturesLint` / `IfLetRescopeRewrite` with manual impls, `VisitOpaqueTypes`, `FunctionalVariances`,
  `FindSignificantDropper`, `AltHead`/`ConsequentRewrite`/`ClosingBrackets`/`SingleArmMatchBegin`). Replaced stand-ins:
  `ClosureReturningAsyncBlock`/`AsyncClosureSugg`, `UndefinedTransmuteLint` (lint-late-d's hand copy), `IfLetRescopeLint`/
  `DestructorLabel`, `ImplTraitRedundantCapturesLint`, `ParamKind` (now generated, `ParamKind.Late`), and
  opaque_hidden_inferred_bound now emits `OpaqueHiddenInferredBoundLint` (was `unported`).
- `tools/codegen/diag_args.json`: `Clause` → `Clause_into_diag_arg` (TrivialConstraints), `PolyExistentialTraitRef` →
  new `PolyExistentialTraitRef_into_diag_arg` (ir_print.ts, the :140 Binder impl with T = ExistentialTraitRef;
  deref_into_dyn_supertrait), the `rustc_middle::ty::PolyFnSig` alias (FnAddrEqWithCast's `{fn_sig}`), and
  `TraitClausePrintModifiersAndPath` Display (AddBound). `diagnostics.gen.ts` has no `unported_into_diag_arg` /
  `unported_display` left.
- `tools/codegen/typemap.lint.json`: real types for `Clause`, `PolyFnSig`, `PolyExistentialTraitRef`, `InitError`,
  `LifetimeSyntaxCategories<$0>` (lint-late-c item 6: `MismatchedLifetimeSyntaxes.inputs/outputs` typed, its Debug
  generated; `debug_LifetimeSyntaxCategories` now takes `(v, f, debug_T)`), `TraitClausePrintModifiersAndPath`.
  NOTE: typemap.*.json are global, so this also types `rustc_infer/infer/mod.gen.ts` (`ValuePairs::PolySigs` /
  `ExistentialTraitRef`) and queries.gen.ts (`inferred_outlives_of`, `fn_abi_of_fn_ptr` key, `type_op_normalize_*`). tsc clean.
- `diagnostics.ts`: filled `DropTraitConstraintsDiag_into_diag`, `MismatchedLifetimeSyntaxes_into_diag` (lint-late-c's
  verified patch, without the casts), and also `ImproperCTypes_into_diag` (lint-late-b blocker 2) and
  `BuiltinClashingExternSub_add_to_diag` (`Ty::fn_sig` exists). No `unported` left in diagnostics.ts.
- utils.rs (`peel_casts`, `std_or_core`) was already ported by lint-late-e2 (2/2); the 2 types.oracle failures seen on
  aae2f3fc were the std_or_core pins, promoted here.
- **`Ty::is_inhabited_from`**: rustc_middle `ty/inhabitedness/{mod.rs,inhabited_predicate.rs}` = 706 upstream lines
  (~490 code), at the ~700 limit, so ported here (decision recorded): `inhabited_predicate.ts` (15/15), `mod.ts` (12/12),
  providers wired from `ty::provide`; decls.ts re-exports the real `InhabitedPredicate`; `query/keys.ts` gets the
  `(AdtDef, GenericArgsRef)` QueryKey (keys.rs:311) + its PseudoCanonicalInput (queries.config.json), typemap.middle.json
  maps `InhabitedPredicate` (query values typed, Debug generated). builtin.ts InvalidValue's enum branch and
  `BuiltinUnpermittedTypeInit::into_diag` use it. contract.test.ts's "a stub stops as UNPORTED" used the inhabitedness
  stub; it now checks the stub mechanism on a fresh prototype (no `Ty` stub is left). plan-m4's wave-22 mb-check-match
  lane no longer needs to port inhabitedness.
- passes-dead "for root": only wiring into `analysis` (not ported) and moving the dead-code liveness types to
  rustc_middle `middle/dead_code.rs` when that is ported. Nothing to do now.

## 3. Oracle tests (all with `RUST_TS_REQUIRE_PROBES=1`)
Promoted (now byte-identical with rustc): late_c `mismatched_lifetime_syntaxes fires`, `unused_must_use on a non-unit
type`; types `fn pointer == fn_addr_eq suggestion`, `ambiguous_wide_pointer_comparisons`, `ImproperCTypesLint FFI-unsafe
fn pointer`; e1 `closure_returning_async_block` (ui), `deref-upcast-shadowing-lint` (ui), + the 8 above; e2 `drop_bounds`.
New: late_c `unused_must_use: uninhabited and Result<_, !>-like types`; late_builtin `InvalidValue: references, bool,
enums with one / several inhabited variants`.
Still pinned (exact stop): types float literal (rustc_apfloat `IeeeFloat::from_str`), types extern "C" cache key
(`Ty: StableHash`); late_c impl_trait_overcaptures (`mir_borrowck provider`), if_let_rescope
(`significant_drop_order::extract_component_with_significant_dtor`); e1 default field values (`const_eval_poly`), gpukernel
(`nvptx64_nvidia_cuda`); e2 runtime_symbols x2 (`symbol_name_from_attrs`, `QueryKey for ty::Instance`), opaque TAIT
(`mir_borrowck provider`); dead.oracle 2 (`QueryKey` for `PseudoCanonicalInput<(PolyFnSig|Instance, List<Ty>)>`).
Results: every rustc_lint test passes (in the full run below); `src/rustc_passes/dead.oracle.test.ts` 11/11.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (18098; vendor 4129). Coverage of the
  touched upstream files: rustc_lint diagnostics 19/19, foreign_modules 11/11, async_closures 1/1, if_let_rescope 10/10,
  impl_trait_overcaptures 16/16, opaque_hidden_inferred_bound 1/1, transmute 4/4, builtin 78/78, lifetime_syntax 19/19,
  types 28/28, utils 2/2; rustc_middle ty/inhabitedness/mod.rs 12/12, inhabited_predicate.rs 15/15; rustc_type_ir
  ir_print.rs 16/16; query/keys.rs: the new `default_span` (:312) is marked (other keys.rs gaps predate this lane).
- Codegen: every `types.sets.json` set regenerated in place: only diffs are the intended rustc_lint files and
  `rustc_infer/infer/mod.gen.ts` (global typemap.lint.json types, see above); the `rustc_lexer` set writes an untracked
  `src/rustc_lexer/lib.gen.ts` (fixture-only set, deleted, as before). `bun tools/codegen/queries.ts --check`: up to date.
  `bun test tools/codegen`: 50 pass.
- `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (once, at 104f8ea0): 5645 pass, 1 skip, 0 fail (382 files).
- tydump-minicore: 45 MATCH / 1 UNPORTED, same as base (runs ml-head-tydump-minicore / ml-base-tydump-minicore).
- tydump-ui --sample 300 (seed merge-lints): 243 MATCH / 0 DIFF / 52 UNPORTED / 5 UNSTABLE, identical per case to base
  344608db (runs ml-head-tydump-ui2 / ml-base-tydump-ui).
- hir-tree --sample 300: 300/300 MATCH, 0 DIFF (run ml-head-hir-tree2).

## unported(...) left in rustc_lint (not this lane's to fill)
- if_let_rescope.ts: `rustc_middle::ty::significant_drop_order::{ty_dtor_span, extract_component_with_significant_dtor}` (file unassigned, 160 lines).
- runtime_symbols.ts: `rustc_symbol_mangling::symbol_name_from_attrs` (x2) — first thing to port before `check_crate` runs the full combined pass.
- types/literal.ts: `rustc_apfloat::ieee::IeeeFloat::from_str` (vendor-apfloat-a merged; the call can be ported once vendor-apfloat-b's API is in).
- Elsewhere reached by lints: `Ty: StableHash` (improper_ctypes cache key), `symbol_name` query / `QueryKey for Instance`
  (clashing_extern_declarations), `TyCtxt::ty_is_opaque_future` (must_use `.await`), `mir_borrowck` (analysis prefix).

## PORT decisions made here
- `InhabitedPredicate` methods on the companion const; `&'tcx [Self; 2]` is a frozen 2-array; derived PartialEq is
  `InhabitedPredicate_eq`; `apply_inner::<!>`'s `let Ok(r)` unwraps; `FxHashSet<DefId>` is `DefIdSet`.
- `debug_LifetimeSyntaxCategories(v, f, debug_T)` (generic Debug takes the element Debug last, as `debug_Binder`).

## PORT decisions from the 6 lint handoffs not yet recorded (for `bun scripts/state.ts record decision`)
Already recorded: lint-late-a LateContext/`typeck_results_()`/driver; lint-late-e2 x3; lint-late-d transmute+shims
(both now superseded by this lane's codegen/imports). Proposed records:
1. (lint-late-a) late.ts: `lint_callback!` is `LateLintPass_provided.check_x(cx.pass, cx.context, ..)`; `RuntimeCombinedLateLintPass` methods are installed from `LATE_LINT_METHODS`; `typeck_body` casts `hir::BodyId` to rustc_middle's pending `BodyId`.
2. (lint-late-a) builtin.ts: `InitError::nested` (method) is `nested_`; `From<&str>`/`From<String>` are `InitError.from_str`/`from_String`; `InitKind`/`AsmLabelKind` are string unions; static fns of generated pass classes are declared by namespace augmentation and assigned.
3. (lint-late-a) AsmLabels works on `Str` (UTF-8 bytes) so InnerSpan offsets, `match_indices(':')` and slicing are byte-exact; ExplicitOutlivesRequirements sorts with std/slice_sort.ts `slice_sort_unstable_by` (`LAYOUT_Span = {size_of: 8, freeze: true}`), `dedup_by_key` hand-written; MissingDebugImplementations takes only the first element of `non_blanket_impls_for_ty`.
4. (lint-late-b) types.rs passes are standalone `LateLintPass` objects; `cx.layout_of(ty)` is the local `late_layout_of` (written before LateContext had `layout_of`; can become `cx.layout_of`); no `pub(crate) use improper_ctypes::ImproperCTypesLint` re-export (import cycle; lib.ts imports improper_ctypes.ts); `OVERFLOWING_LITERALS` imported from types.lints.gen.ts; `float_is_infinite<S>` takes the caller's `FloatTy`.
5. (lint-late-b) improper_ctypes: `known_safe: RefCell<FxHashSet<(Hash128, u8)>>` is a `Set<string>` keyed `${hash}:${flags}`; `bitflags! RootUseFlags` is a number with flag consts on a companion; `FnPtrFinder` (two traits both naming `visit_ty`) is split into `FnPtrFinder_HirVisitor` / `FnPtrFinder_TypeVisitor`; `cfg!(debug_assertions)` is false.
6. (lint-late-c) must_use: `MustUsePath::Array` length is a number and `saturating_add` is `+`; `iter().chain(iter::repeat(expr))` is an index lookup falling back to `expr`; `find_attr!(.., MustUse { reason, .. } => reason)` wraps `{ reason }` so a bare `#[must_use]` is found.
7. (lint-late-c) nonstandard_style: `to_snake_case` / `check_upper_case` are module fns; `NonUpperCaseGlobalGenerator` is a local Diagnostic class; `str::to_lowercase/to_uppercase` use std/unicode/str_case.ts; `char::to_titlecase` is not in src/std (nonstandard_style.ts:49).
8. (lint-late-c) impl_trait_overcaptures: `FxIndexMap<DefId,_>`/`FxIndexSet<DefId>` are `DefIdMap`/`DefIdSet` (`shift_remove` = `delete`); `LazyCell` is a small `Lazy<T>`; the opaque let-chain of `visit_ty` is the helper `owned_opaque`. lifetime_syntax: `FxIndexMap<LifetimeKind,_>` / `path_counts` are `KeyedMap`s; `LifetimeSyntaxCategories::select` (returns `&mut T`) returns the field name; methods on companion consts. if_let_rescope: `struct AltHead(Span)` is a `Span`.
9. (lint-late-d) reference_casting: `cx.layout_of(ty)` goes through a `LateLayoutOf` view of `LateContext`; non_local_def: `PathCollector` keeps the `hir::Path` nodes, `bool::then_some(Option<Span>)` is `{ $: "Some", _0 } | undefined`; foreign_modules: `seen_types: UnordSet<(Ty, Ty)>` is a `KeyedSet` on the pair's intern ids, `cfg!(debug_assertions)` check is a comment, `Iterator::eq_by` a local helper; internal.rs `TypeIr::check_expr` keeps the non-short-circuit `|`; non_fmt_panic `PanicMessageNotLiteral` manual Diagnostic is a class.
10. (lint-late-e1) `find_attr!(tcx, def_id, Pat)` is `find_attr(HasAttrs_DefId/LocalDefId.get_attrs(..), k => k.$ === "Pat" ? null : undefined) !== undefined`; `while let` / let-chains are early returns in order; HIR slice patterns check lengths explicitly.
11. (lint-late-e1) gpukernel_abi `CheckGpuKernelTypes` is a `TypeFolder` class forwarding to `TypeFolder_provided`, `iter::zip` stops at the shorter list; invalid_from_utf8 uses std/str.ts `from_utf8`, `LitKind::Int(b) => b.get() as u8` is `Number(BigInt.asUintN(8, b))`, local `strip_prefix`; `ExprPrecedence` PartialOrd compares `ExprPrecedence_discriminant`; deref_into_dyn_supertrait fold descriptors are local consts and `supertraits(..).find(..)` a `next()` loop; default_could_be_derived `WrongDefaultImpl` manual Diagnostic is `WrongDefaultImpl_into_diag` + `_diagnostic`.
12. (lint-late-e2) multiple_supertrait_upcastable's lazy filter_map/filter/count is a counting loop; shadowed_into_iter `take_while(..).position(..)` is `position_before`, `hir_parent_iter(..).nth(1)` a counted loop; opaque_hidden_inferred_bound's `fold_ClauseKind` is a local D4 descriptor from the generated ClauseKind fold fns; static_mut_refs `find_word`/`extend_trailing_space` work on the UTF-8 `Str` of `span_to_snippet`.
