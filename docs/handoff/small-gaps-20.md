# Handoff: small-gaps-20 (M3, wave 20): cheap UNPORTED stops of `tydump-ui`

Branch `lane/small-gaps-20`, based on `b4b2793b` (lane/harness-w20). No baselines, oracle outputs, suites, `harness/`,
`scripts/` or `UPSTREAM.json` touched. Nothing in rustc_hir_typeck, rustc_trait_selection error reporting / solve, or
rustc_next_trait_solver. **Root: this lane changed tools/codegen configs and one tools test (no generator code); see
"tools/ changes".**

## Results (`RUST_TS_AGENT=small-gaps-20`; MATCH / DIFF / UNPORTED, no CRASH)
| suite | base (b4b2793b) | after | run (after) |
|---|---|---|---|
| tydump-ui (full, 1849) | 970 / 10 / 868 (+1 TIMEOUT; `hw20-full2-tydump`) | **1342 / 22 / 484** (+1 TIMEOUT) | `sg20-full-tydump-1` (before commit 7: the 8 `next_type_param_name` cases were re-run alone afterwards: 4 MATCH, 4 `layout_of`) |
| tydump-ui `--sample 400` | 208 / 1 / 191 (cases taken from the full base run) | **286 / 6 / 108** | `sg20-tydump-ui-400` |
| thirdump-ui `--sample 400` | 207 / 1 / 192 (from `hw20-full2-thirdump`) | **283 / 6 / 111** | `sg20-thirdump-ui-400` |
| tydump-minicore (46) | 41 / 0 / 5 | **42 / 0 / 4** (`lang-items/lang-item-generic-requirements.rs`) | `sg20-minicore` (base `sg20-base-minicore`) |
| tydump-nocore `--sample 300 --seed m17` | 290 / 0 / 10 | 290 / 0 / 10 (no case changed) | `sg20-nocore` (base `sg20-base-nocore`) |
| hir-tree `--sample 300` | 300 / 0 / 0 | 300 / 0 / 0 | `sg20-hirtree` (base `sg20-base-hirtree`) |
| resdump `--sample 300` | 300 / 0 / 0 | 300 / 0 / 0 | `sg20-resdump` (base `sg20-base-resdump`) |

Base runs for minicore / nocore / hir-tree / resdump came from a temporary detached worktree at `b4b2793b` (removed).

**No MATCH lost anywhere.** All changes are UNPORTED -> MATCH, except **12 tydump-ui cases that went from UNPORTED to DIFF**
(5 of them are in the 400 samples). All 12 run `-Znext-solver` (11 under `tests/ui/traits/next-solver` or
`#next`/`#bad_new` revisions, plus `typeck/bad-index-due-to-nested.rs#next`). They used to stop before the next solver's
error reporting and now reach it. They show the same pattern as base DIFFs 3-5 of harness-w20: an extra or different
E0277/E0271, or an extra duplicate error with a different span. Example: `cycles/use-impl-to-normalize-own-self-ty-ice.rs#next`
prints a sixth `&'static (): Trait` error at 20:18 with a `required by a bound` note, where the oracle prints 5. This is
trait-solver code (ui-diffs-20's area), not the code ported here. The 12 cases:
`next-solver/{consider_builtin_pointee_candidate-instantiate-result-fail, cycles/use-impl-to-normalize-own-self-ty-ice#next,
diagnostics/const-host-effect-hrtb-no-ice, diagnostics/projection-trait-ref, dont-ice-on-bad-transmute-in-typeck,
issue-118950-root-region, normalize/dont-ice-on-normalization-failure, object-projection-with-unsatisfied-bound-1#next,
overflow/incorrect-old-solver-caching-ice-148095#next}`, `traits/projection-cache-rematch-impl-122529#next`,
`traits/trivial-unsized-projection#bad_new`, `typeck/bad-index-due-to-nested#next`. Before this lane, 9 of them stopped at
the `(Predicate, WellFormedLoc)` key, and one each at `DenseBitSet`, `CodegenFnAttrs` and `iter_identity_copied`.

## How each targeted stop moved (base full run -> `sg20-full-tydump-1`)
| stop (base count) | now |
|---|---|
| `EarlyBinder::iter_identity_copied / bind_iter` (135) | gone: 119 MATCH, 8 `mir_borrowck`, 3 `thir_abstract_const`, rest scattered |
| metadata `DenseBitSet<u32>` (116) | gone: 77 MATCH; 11 `mir_borrowck`, 9 `SelectionContext::select`, 9 `layout_of`, ... |
| metadata `CodegenFnAttrs` (98) | gone: 70 MATCH; 12 `layout_of`, 7 `select`, 5 `mir_borrowck`, ... |
| metadata `ConstConditions` (76) | gone: 59 MATCH; 10 `select`, 5 `layout_of`, ... |
| `QueryKey for (Predicate, WellFormedLoc)` (28) | gone: 12 MATCH, 9 DIFF (above), 3 `TyCategory::from_ty`, 2 `mir_borrowck`, ... |
| `elaborate::supertrait_def_ids` (21) | gone: 19 MATCH, 2 `layout_of` |
| `ty::Value: valtree().kind()` (15) + `ValueConst::valtree` (3) | gone: 8 MATCH; rest `layout_of`, `const_eval_resolve_for_typeck`, `hash_result` |
| `TraitRefPrintOnlyTraitPath` / `TraitRefPrintSugared` TypeVisitable (5 + 4) | gone: 8 MATCH, 1 `layout_of` |
| `NextTypeParamName::next_type_param_name` (8) | gone (commit 7, re-run alone): 4 MATCH, 4 `layout_of provider` |
| `SelectionContext::select` (42) | **not done: in rustc_hir_typeck** (see "For root"); now 68 |
| `const_eval_resolve_for_typeck` (42) | not done: const eval (see below); now 49 |

## Fixes (one commit each)
1. `Interner::explicit_implied_const_bounds` (impl_interner.rs:457): `bind_iter(iter_identity_copied().map(skip_normalization).map(|(c, _)| c))`.
   `Decodable DenseBitSet` generated: new derive-only set `rustc_index` (bit_set.rs, `decodable_types: [DenseBitSet]`,
   `erase_params: [T]`) into `src/rustc_index/decodable.gen.ts`. cstore_impl `params_in_repr` and
   `args_known_to_outlive_alias_params` (`Vec<(usize, DenseBitSet<u32>)>`) now decode.
2. `TyDecodable CodegenFnAttrs`: hand-written in middle/codegen_fn_attrs.ts next to the hand types. The typedefs probe cannot
   parse codegen_fn_attrs.rs (`const impl Default`, 304:6), so the file already hand-writes its Debug/Clone/PartialEq.
   The decoders are `decode_CodegenFnAttrs` / `TargetFeatureKind` / `TargetFeature` / `PatchableFunctionEntry` /
   `CodegenFnAttrFlags` / `SanitizerFnAttrs` and `mono::Visibility`. They follow serialize.rs `decodable_body`: fields in
   declaration order, enum tag `read_u8`. They are wired into cstore_impl `codegen_fn_attrs`.
3. `TyDecodable ConstConditions` generated (set `rustc_middle`: `decodable_types` += ConstConditions; `files` += ty/predicate.rs
   so that the `PolyTraitRef` alias resolves). cstore_impl `const_conditions` now decodes.
4. `QueryKey for (ty::Predicate, WellFormedLoc)` (keys.rs:379) as `KEY_Predicate_WellFormedLoc`. The `diagnostic_hir_wf_check`
   key is now typed and its `desc` generated. `debug_WellFormedLoc` is read through `require` at call time: a static import
   of traits/mod.gen.ts crashed every case with "Cannot access 'ObligationCause' before initialization".
5. `Interner::supertrait_def_ids` calls the ported `rustc_type_ir::elaborate::supertrait_def_ids` (lazy require, extension module).
6. rustc_type_ir relate.ts / fast_reject.ts: the `ValueConst::valtree` stand-ins are replaced by valtree.ts's
   `Value.valtree(v)` (+ `.kind()`), as flags.ts does.
7. Generated TypeVisitable/TypeFoldable of the 5 print wrappers of ty/print/pretty.rs: new set `rustc_middle_ty_print`
   (`type_fold_hand`, every other type skipped) into `src/rustc_middle/ty/print/pretty.gen.ts`. hir_ty_lowering/errors.ts's
   `fold_TraitRefPrintOnlyTraitPath_` / `fold_TraitRefPrintSugared_` now use them.
8. rustc_hir_analysis collect.ts `placeholder_type_error_diag` and dyn_trait.ts `add_generic_param_suggestion` call
   suggestions.ts's ported `next_type_param_name(params, None)` (was `unported`).
9. tools/codegen/type_fold.test.ts golden: `ty/print/pretty.gen.ts` belongs to set `rustc_middle_ty_print` (exception, like `mod.gen.ts`).

Upstream code covered: about 250 lines (two `Interner` methods, one `QueryKey` impl, 7 derives and the call sites).

## Left (not cheap or not mine)
- `const_eval_resolve_for_typeck` (49 now): the path continues into `Instance::try_resolve` (resolve_instance_raw, rustc_ty_utils
  instance.rs) and then `const_eval_global_id_for_typeck` (eval_to_valtree). There is no small early-return prefix. M4.
- `vtable_entries` provider (8) / `COMMON_VTABLE_ENTRIES` (1): needs `Instance::expect_resolve_for_vtable` and `Display for
  Instance`. Not small.
- `thir_abstract_const` (7): 403 lines (small-gaps-19 left it too).
- `IntoDiagArg without a TS impl` (4, `RecursionLimitReached.ty`): set `rustc_middle_diagnostics` has `diag_args_skip:
  [rustc_middle::ty::Ty]` on purpose (TDZ, merge-w16a). Fixing it needs a lazy `Ty_into_diag_arg` adapter, which is a
  codegen design choice for root.
- `hash_result` StableHash of `type_of` (4), `precise_captures::LifetimeNotCaptured` (1), `IrPrint<PlaceholderType>` (1),
  `evaluate_obligation` desc (1), `short_string_namespace` (1): one case each, and each a different subsystem.

## For root (one-liners in files outside this lane)
- **`SelectionContext::select` (68 cases):** `rustc_hir_typeck/method/probe.ts:1620` `SelectionContext_select` is a stale
  stand-in. `SelectionContext.prototype.select` is ported (traits/select/mod.ts:254). The fix is
  `return SelectionContext.new(infcx).select(obligation);` (fn_ctxt/checks.ts:1795 already does this). Not tried here (rustc_hir_typeck).
- **`TyCategory::from_ty` (18):** `rustc_trait_selection/error_reporting/traits/fulfillment_errors.ts:4110` stand-in. Ported as
  `TyCategory_from_ty` in error_reporting/infer/mod.ts:2731.
- **`TraitClausePrintModifiersAndPath` TypeVisitable (4):** `error_reporting/traits/ambiguity.ts:741` stand-in. Now generated:
  `visit_with_/try_fold_with_/fold_with_TraitClausePrintModifiersAndPath` in rustc_middle/ty/print/pretty.gen.ts. suggestions.ts's
  hand descriptors `d_TraitRefPrintOnlyTraitPath` / `d_TraitClausePrintModifiersAndPath` can use them too.
- **`CapturedPlace` TypeVisitable (11):** `rustc_hir_typeck/writeback.ts:1256`. The decision of 2026-10-15 allows a hand-written derive.
- The 12 new next-solver DIFFs (above): for ui-diffs-20 or the next solver lane.

## Checks
- `bunx tsc --noEmit -p .` clean; `bun scripts/coverage.ts --check`: markers ok (16977; vendor 3888).
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools --timeout=120000`: 5343 pass / 11 fail. **All 11 also fail at base `b4b2793b`**
  (each re-run there): infer contract.test.ts placeholders, fnsugg_b.oracle plus_eq, std/result.test.ts (hir_typeck
  suggest.ts:2744), checks_b.test.ts stop_method/stop_single/stop_note, wfcheck_b static_wf, compare_impl_item.oracle e0053_sig
  / e0326, suggestions_b auto_trait / where_clause. This lane adds no test failures. The type_fold.test.ts golden, which this
  lane broke, is fixed in commit 9 (8 pass).
- Every type set regenerates with no diff beyond the committed files (`src/rustc_lexer/lib.gen.ts`, never committed, is
  deleted after the loop). `bun tools/codegen/queries.ts --check` up to date.
- Coverage: cstore_impl.rs 37/37, impl_interner.rs 115/115, query/keys.rs 48/63 (+1), codegen_fn_attrs.rs 9/9, relate.rs 23/23,
  fast_reject.rs 12/12, collect.rs 64/64, dyn_trait.rs 14/14, hir_ty_lowering/errors.rs 22/22, bit_set.rs 33/117 (unchanged;
  only the derive was added).

## tools/ changes (root: please review)
- `types.sets.json`: new set `rustc_index` (derive-only, `DenseBitSet` Decodable, `erase_params: [T]`); new set
  `rustc_middle_ty_print` (pretty.rs, `type_fold_hand` of the 5 print wrappers, other types skipped, `resolve_files`
  ty/print/mod.rs + ty/mod.rs); set `rustc_middle`: `decodable_types` += `ConstConditions`, `files` += `ty/predicate.rs`.
- `serialize.json`: `rustc_index::bit_set::Word` (`decode_u64`, a bigint); `&[(PolyTraitRef, Span)]` (arena RefDecodable);
  the `Binder` entry also matches `rustc_middle::ty::sty::Binder` / `rustc_middle::ty::Binder` (as the EarlyBinder entry does).
- `type_fold.json`: `rustc_middle::ty::TraitClause` entry; `rustc_middle::ty::BoundConstness` in `trivial`.
- `middle_traits_thir.typemap.json`: `rustc_middle::ty::BoundConstness`. `typemap.middle.json`: `rustc_middle::ty::Predicate`.
- `queries.config.json`: key `(Predicate, WellFormedLoc)` -> `Predicate_WellFormedLoc`.
- `type_fold.test.ts`: the golden's on-disk exception list gains `print/pretty.gen.ts`.

## Edits outside the ported files (small, noted)
- `rustc_index/bit_set.ts`: `DenseBitSet<T extends number = number>` (default type argument, for the erased decoder).
- `rustc_middle/ty/print/pretty.ts` is untouched: errors.ts imports the folds from pretty.gen.ts directly.

## unported(...) left / added
- None added. Removed: `iter_identity_copied / bind_iter` (impl_interner), `supertrait_def_ids` (impl_interner),
  `decode_unported` for `DenseBitSet<u32>`, `Vec<(usize, DenseBitSet<u32>)>`, `CodegenFnAttrs`, `ty::ConstConditions`,
  `key_unported("(ty::Predicate<'tcx>, WellFormedLoc)")` and its unported desc, `Value_valtree_kind` (relate.ts),
  `Value_valtree` (fast_reject.ts), the 6 TraitRefPrint* fold stand-ins (errors.ts), and 2 `next_type_param_name` stand-ins.

## PORT decisions to record
1. `TyDecodable` derives of codegen_fn_attrs.rs's types (and `mono::Visibility`, declared there) are hand-written in
   codegen_fn_attrs.ts, as its Debug/Clone/PartialEq already are, because the typedefs probe cannot parse the file
   (`const impl Default for SanitizerFnAttrs`). Same reasoning as the 2026-10-15 CapturedPlace decision.
2. `DenseBitSet<T>`'s decoder erases `T` (`erase_params`). It returns a `DenseBitSet<number>`, and bit_set.ts gives the class
   a `= number` default. `Word` (u64) decodes as a bigint through a serialize.json entry keyed by the alias.
3. rustc_middle `QueryKey` impls whose debug needs traits/mod.gen.ts read it via `require` at call time (init order).
