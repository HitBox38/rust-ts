# Handoff: merge-w19 (fixer on integ-w19, after the 16 wave-19 error-reporting lanes)

Branch `integ-w19`, commits `1efd8b06`..`805030da` (plus this handoff). Typecheck clean, `coverage --check` ok
(markers 16977), coverage TOTAL 16458/25518 (rustc_trait_selection 947/976, rustc_hir_typeck 1041/1041).

## 1. Unit tests

Scoped run (trait_selection / hir_typeck / hir_analysis / infer) had 11 failures at `d5cecdfc` (entry `args_main.rs`
already passed). Each was a pin on another lane's stop. All are now **exact oracle matches**; no assertion weakened, no
oracle output edited (fixtures regenerated from the oracle only):

| test | old pin | now |
|---|---|---|
| rustc_infer contract "placeholders stop as UNPORTED" | `describe_closure` placeholder | renamed "former placeholders are ported"; asserts `describe_closure(Closure) == "a closure"` |
| fnsugg_b.oracle `plus_eq` | `FnCtxt::suggest_fn_call` | full oracle compare (PENDING empty) |
| checks_b `stop_method` / `stop_single` / `stop_note` | `confusable_method_name` / `report_and_explain_type_error` / `note_type_err` | MATCH cases (fixtures unchanged, equal) |
| entry `args_main.rs` | `note_field_shadowed_by_private_candidate_in_cause` | NOW_EXACT |
| wfcheck_a `field_bound.rs` | `error_implies`, then `QueryKey (Predicate, WellFormedLoc)` | NOW_EXACT (key ported, below) |
| wfcheck_b `static_wf.rs` | `error_implies` | NOW_EXACT; the crate now declares the `freeze` lang item so the oracle has no MIR-phase "requires `freeze` lang_item" error, which `wf` mode never reaches (test input change, oracle untouched) |
| compare_impl_item in-process `e0053_sig` / `e0326` | `note_field_shadowed_by_private_candidate_in_cause` | exact (IN_PROCESS_PENDING empty) |
| suggestions_b `auto_trait.rs` / `where_clause.rs` | `is_recursive_obligation` / `point_at_assoc_type_restriction` | run.ts dropped its `report_fulfillment_errors` stand-in; all 6 cases compare full stderr + exit with the oracle |

Further tightening (all pass): region.oracle PENDING empty; suggest_a 12/13 NOW_EXACT, PENDING = `SelectionContext::select`
(ambiguity.rs) only; wf_dyn PENDING_E0038 empty; demand_adjust: runner without any stand-in (no `NO_SUGGESTION_*`, no
suggestions.rs:5459 span-move emulation, the ported `note_function_argument_obligation` does it), fixtures are now the
oracle's human stderr/exit (`REGEN=1`), JSON projections deleted; nice_region runner calls util.ts
`find_param_with_region` instead of reproducing it.

Full `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: at `1efd8b06` 5353 pass / 1 fail (result.test.ts guard: a
one-argument `unwrap_result` in method/suggest.ts, fixed in `3ef7e3a4`). Final run at `805030da`: 0 fail (§6).

## 2. Code changes (root items)

- rustc_middle query/keys.ts `KEY_Predicate_WellFormedLoc` (keys.rs:379) + queries.config.json; queries.gen.ts
  regenerated (`diagnostic_hir_wf_check` reachable).
- rustc_trait_selection decls.ts imports rustc_span `Symbol`; `PORT(decls)` casts removed (note_and_explain.ts,
  suggestions.ts `get_closure_name` / `suggest_fn_call`).
- `NiceRegionError` namespace: `export function new_from_span` / `get_impl_ident_and_self_ty_from_trait`; local views removed.
- rustc_hir_typeck decls.ts: `report_failed_method_call_on_numerical_infer_var(.., long_ty_path: MutRef<PathBuf | undefined>)`;
  `create_missing_writer_err` keeps `PathBuf | undefined` (upstream takes it **by value**: `mut long_ty_path: Option<PathBuf>`);
  the four `&mut bool` params `MutRef<boolean>`; `bound_spans` `SortedMap<OrdSpan, string[]>`; `FnCtxt_suggest_a` view and
  the `ty_file` PORT removed (`ty_file` is a real cell now).
- Stand-ins replaced: diagnostics.ts `ObligationCauseAsDiagArg_into_diag_arg` (lazy forward to infer/mod.ts);
  fulfillment_errors `TyCategory::from_ty` (lazy infer/mod.ts); need_type_info `Highlighted_to_string` (placeholder_error.ts);
  suggestions.ts `CoroutineData` bridge wrappers (direct method calls); hir_analysis collect.ts / dyn_trait.ts
  `next_type_param_name` and dyn_trait.ts `AssocTypeWithSameName` subdiagnostic; mir_build const_to_pat.ts
  `compute_applicable_impls_for_diagnostics` / `CandidateSource` (ambiguity.ts; obligation is now a `PolyTraitObligation`
  as upstream).
- Duplicates collapsed (no behaviour change): suggestions.ts `d_TraitClause_b/_c` -> `d_TraitClause()`,
  `d_PolyTraitClause_b` -> `d_PolyTraitClause` (return type widened to the super-foldable), `d_Binder_Ty_c` -> `d_Binder_Ty`,
  `d_TraitClausePrintModifiersAndPath_c` -> `d_TraitClausePrintModifiersAndPath`, `print_/display_PolyTraitClausePrintModifiersAndPath_b`
  + sugg-c's `display_Binder_TraitClausePrintModifiersAndPath` -> one `print_/display_Binder_TraitClausePrintModifiersAndPath`;
  fulfillment_errors.ts `d_TraitClause_b` / `d_PolyTraitClause_b` -> lane a's `d_TraitClause` / `d_PolyTraitClause`.
- **Sort**: `report_similar_impl_candidates`' tuple-arity comparator is **not** a consistent total preorder (`Equal` unless
  both self types are tuples: tuple(2) = X = tuple(1) but tuple(2) > tuple(1)), and JS's stable sort differs from Rust on
  ~90% of mixed inputs > 20. Ported core's stable sort (driftsort) to `src/std/slice_sort.ts` (`slice_sort_by`, element
  layout `size_of`/`Freeze` as a parameter); `slice_sort.test.ts` checks it against a program built with the pinned
  toolchain (sizes 24/16/8, Freeze and `Cell`, total and non-transitive comparators, lengths 0..5000). The call uses
  `(TraitRef, DefId)` = 24 bytes, Freeze. `sort_by_key` callers (String / tuple `Ord` keys, total orders) keep JS's sort.
- prelude_edition_lints.ts `lint_edition_dependent_dot_call`: `boxed_ty()` evaluated in the `else if` (upstream order;
  typeck-fnsugg-a note).
- Reviewed errrep-infer-b's out-of-lane edits (specialize/mod.ts, coherence_specialize.test.ts): fine, tests pass.

## 3. Samples (`RUST_TS_AGENT=merge-w19`; base = main checkout `8a484a38`, `RUST_TS_AGENT=merge-w19-base`)

| suite | lane run | M / D / U | base run | M / D / U |
|---|---|---|---|---|
| tydump-minicore (46) | mw19-tydump-minicore | 41 / 0 / 5 | mw19-base-tydump-minicore | 21 / 0 / 25 |
| thirdump-minicore (46) | mw19-thirdump-minicore | 41 / 0 / 5 | mw19-base-thirdump-minicore | 21 / 0 / 25 |
| tydump-nocore `--sample 300 --seed m17` | mw19-tydump-nocore | 290 / 0 / 10 | mw19-base-tydump-nocore | 289 / 0 / 11 |
| hir-tree `--sample 300 --seed merge-w19` | mw19-hir-tree | 300 / 0 / 0 | mw19-base-hir-tree | 300 / 0 / 0 |
| resdump (same) | mw19-resdump | 300 / 0 / 0 | mw19-base-resdump | 300 / 0 / 0 |
| expanded (same) | mw19-expanded | 300 / 0 / 0 | mw19-base-expanded | 300 / 0 / 0 |

No CRASH / TIMEOUT, no case lost vs base. New nocore MATCH: `proc-macro/auxiliary/expect-modules.rs` (was `all_traits`).
The 12 `start_lang_item_args.rs` cases (base: `note_type_err`) and the other 8 error-reporting stops all MATCH.

Remaining minicore stops (both suites identical), all outside error reporting:
1. `layout_of provider (not ported)` x2 (mini_core.rs, lang-items/issue-87573.rs)
2. `mir::interpret::TyCtxt::const_eval_poly (M4)` (mini_core_hello_world.rs)
3. `ty::Value: valtree().kind() (ty::Value is pending)` (lang-items/lang-item-generic-requirements.rs)
4. `LayoutOf::layout_of (Const::from_bits; layouts are M4)` (no_std/no-core-edition2018-syntax.rs)

nocore sample stops: `const_eval_resolve_for_typeck` x7, `thir_abstract_const provider`, `layout_of provider`, `const_eval_poly`.

## 4. For root

- Codegen follow-ups from the lanes (not done): `TypeFoldable`/`TypeVisitable` derives for pretty.rs print wrappers
  (`TraitClausePrintModifiersAndPath`, `TraitClausePrintWithBoundConstness`, `TraitRefPrintOnlyTraitPath`); `PolyFnSig`
  in the typemap for `ValuePairs::PolySigs`; a typed `$print` for generic `IntoDiagArg` impls (`Highlighted<T>`);
  shared `Binder<T>` Display / fold descriptors (errrep-infer-a item 3).
- The query values typed `unknown` in queries.gen.ts that lanes cast at use sites (`typeck`, `fn_sig`, `associated_item`,
  `upvars_mentioned`, `mir_coroutine_witnesses`, ...).
- `desc` of `diagnostic_hir_wf_check` is still `unported` (Debug of `Predicate` in the generator); only reached by cycle
  errors / query stacks.
- harness/scripts untouched. tools/codegen/queries.config.json got one key entry (generator config, as merge-w18c did).

## 5. Consolidated PORT decisions (for `bun scripts/state.ts record decision`; not recorded here)

- Wave 19 PORT decisions (merge-w19): integration tests that pinned another lane's stop are promoted to full oracle
  comparisons once the stop is gone; a test crate may gain lang items (e.g. `freeze`) so the oracle's output stays within
  what the harness mode runs (input change, never an output edit). core's stable sort is ported (src/std/slice_sort.ts,
  element layout `size_of`/`Freeze` passed by the caller) and used where a comparator is not a consistent total
  preorder; `sort_by_key` with totally ordered keys may use JS's stable sort. `(Predicate, WellFormedLoc)` has a QueryKey.
  `create_missing_writer_err` keeps `long_ty_path` by value (upstream); `report_failed_method_call_on_numerical_infer_var`
  takes `MutRef<PathBuf | undefined>`.
- (errrep-infer-a) `(DiagStyledString, DiagStyledString)` is a tuple; local `DiagStyledString_eq` / `AliasTy_eq`;
  `into_sorted_stable_ord()` on Strings sorts by UTF-8 bytes; `cmp`'s `split_at` splits UTF-8 bytes; OpaqueTypesVisitor's
  `FxIndexMap<TyCategory, FxIndexSet<Span>>` is a `KeyedMap` on `intern_key`; `find_attr!` returning `Option<Option<_>>`
  wraps the outer `Some`; `Display for TyCategory` takes the `{:#}` flag; local D4 descriptors / `display_Binder_with`.
- (errrep-infer-b) fn-local `collect_blocks` / `IfVisitor` stay local; `T: Relate` args are `relate_*` descriptors;
  the big `(expected.kind(), found.kind())` match is a labeled block of ifs in arm order; `Option<Span>` passed to
  `span_labels` is a 0/1-element array; `SourceKindSubdiag` / `ActualImplExplNotes` constructors on companions.
- (errrep-traits-a) `report_fulfillment_errors` sorts a copy; `ErrorSortKey` is a `[variant, ..fields]` array compared
  lexicographically (`None < Some`); `UnordSet<(String, DefId)>` / `FxIndexSet<DynCompatibilityViolation>` are `KeyedSet`s
  on `intern_key`; `potential_solutions` sorted with a hand derived-`Ord`; `find_attr!(..).flatten()` keeps the first
  matching attribute even if its directive is `None`; owned `mut obligation` is `clone_Obligation`; derived `PartialEq`
  on predicates / cause codes uses `intern_key`; `Goal` equality is `ParamEnv_eq` + predicate identity.
- (errrep-traits-b) nested `fn type_category` / `struct ParamToVarFolder` move to module level above their parent;
  lazy iterator chains evaluate per element in order; `(a, b).references_error()` visits both; `usize::MAX` ->
  `Number.MAX_SAFE_INTEGER`, `u64::MAX` -> `Infinity` (only compared); tuple sort keys compare lexicographically, strings by
  `str_cmp`; `UnordSet<(DefId, String)>` is an array of distinct pairs; local fold descriptors for the print wrappers.
- (errrep-sugg-a) `NextTypeParamName` etc. per sugg-c (the stand-ins are gone); `Binder<TraitClausePrintModifiersAndPath>`
  printed as `Binder<TraitClause>` with the newtype's `Print` on the bound value; `upvars_mentioned` cast to
  `Map<HirId, hir::Upvar>`; `sort_by_cached_key` computes each key once; `Option::get_or_insert` builds eagerly;
  `err.messages = ..` is `err.deref_mut().messages = ..`.
- (errrep-sugg-b) `unknown`-typed query values cast at use sites; `mir_coroutine_witnesses` read through a local
  `CoroutineLayoutView` until M4; hand-written `TypeFoldable` for `TraitClausePrintModifiersAndPath` /
  `TraitRefPrintOnlyTraitPath`; lazy `filter_map` + two `next()` as a generator.
- (errrep-sugg-c) `NextTypeParamName` (only impl for `&[hir::GenericParam]`) is interface + free fn
  `next_type_param_name(self_, name)` + companion; `ReplaceImplTraitVisitor.ty_spans` is the caller's array; struct
  default field values are constructor defaults.
- (errrep-need-type-info) need_type_info.rs is hand-typed (syn cannot parse `do yeet`); `try {}` blocks are IIFEs;
  lazy iterators are generators so query / infer-var side effects keep upstream order; let-chain match guards are small
  local helpers; fn-local `struct CostCtxt` is a module-level class.
- (errrep-region) same-crate modules read through lazy `require` (init order); `error.clone()` not cloned (payloads never
  mutated); `process_errors` `sort_by_key(lo_hi)` is a stable sort on `(lo, hi)`; region.rs:892..918's let-chain is the
  helper `boxed_dyn_trait_with_implicit_static`; `LifetimeReplaceVisitor` module-level; `trim_start()` is a local helper
  over std `is_whitespace` (not JS `trimStart`); `Highlighted` formatting now uses its `Display` (merge-w19).
- (errrep-nice-region) `Highlighted_into_diag_arg` picks `T`'s `Print` from the value's shape (until a typed `$print`
  template exists); `Highlighted` is `Copy`, so the `RegionHighlightMode` is cloned; `Display` panics with
  `ToString::to_string`'s / `.expect("could not print type")`'s messages; `ValuePairs` equality is `intern_key`;
  fn-local `HighlightBuilder` module-level; `Span::lo_hi()` ordering is `cmp_lo_hi`; the untracked compare-impl cases
  (all E0803 at the pin) were dropped.
- (typeck-demand-adjust) `&mut &hir::Expr` / `&mut Option<&hir::Expr>` are `MutRef` cells (setters write back); local
  visitors / enum are module-level; `&mut FulfillmentError` edited in place; `ParamTerm::index` a companion fn.
- (typeck-checks-b) fn-local `SameModuloVars` is a module-level `TypeRelation` class (provided `relate` forwards to
  `TypeRelation_provided`); `params.get(a..len - c_variadic)` out of range (release wrap) is `undefined`;
  `SelectionContext::new(self)` passes `this.infcx`; associated fns assigned with the `(X as unknown as { new: .. })` form.
- (typeck-suggest-a) `TraitBoundDuplicateTracker::has_ref_dupes(&self)` is a static (field has the method's name);
  `FxIndexMap`/`FxIndexSet` insertion-ordered; `Vec<String>` sort/dedup by `str_cmp`; `Iterator::eq_by` = length check +
  `every`.
- (typeck-suggest-b) local `TypeFoldable` descriptors for `TraitRef` / `TraitClause` / `PredicateKind`; `sort_by_key` ->
  stable `sort_by_cached_key` (pure string keys); derived tuple `Ord` of `(String, OrdSpan, Symbol)` via `cmp_derive`
  (`Symbol` by index); `skippable.contains` on `[Option<DefId>; 5]` is `skippable_contains`; the three lazy `filter`s are
  one per-element predicate in order.
- (typeck-fnsugg-a) `Ord` on `Applicability` / `ExprPrecedence` via `*_discriminant` tables; pure `filter_map().peekable()`
  collected eagerly; `collect::<Result<Vec<_>>>` stops at the first `Err`; `str::to_uppercase` is `toUpperCase`;
  `impl Diagnostic for X` is `X_into_diag` + `X_diagnostic`.
- (typeck-fnsugg-b) `associated_item` query value cast to `AssocItem`; local `trim_end_matches` / `is_some_and`;
  diagnostics.ts reads `op::contains_let_in_chain` through a lazy `require` (a static import closes a load cycle).

## 6. Final test run

`RUST_TS_REQUIRE_PROBES=1 bun test src tools --timeout=120000` at `805030da` (clean snapshot worktree): **5356 pass, 0 fail**
(5357 tests, 358 files, 754 s).
