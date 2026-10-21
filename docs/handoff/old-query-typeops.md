# Handoff: old-query-typeops (M3 wave 18c, old trait solver)

Branch `lane/old-query-typeops`, from `integ` 60a45cf, no merges. Commits: port of the 8 files → unit tests + init-order
fix → this handoff.

## Result
Every fn of the scope is ported (markers, upstream order); no `unported(...)` is left in `traits/query/**` (except
`method_autoderef.ts`, not in scope).

| upstream (compiler/rustc_trait_selection/src/traits/) | coverage | TS |
|---|---|---|
| query/normalize.rs | 11/11 | query/normalize.ts |
| query/dropck_outlives.rs | 4/4 | query/dropck_outlives.ts |
| query/type_op/mod.rs | 5/5 (incl. the 3 trait decls) | query/type_op/mod.ts |
| query/type_op/custom.rs | 4/4 | query/type_op/custom.ts |
| query/type_op/ascribe_user_type.rs | 5/5 | query/type_op/ascribe_user_type.ts |
| query/type_op/normalize.rs | 8/8 (incl. the trait decl) | query/type_op/normalize.ts |
| query/type_op/outlives.rs | 2/2 | query/type_op/outlives.ts |
| query/type_op/prove_predicate.rs | 3/3 | query/type_op/prove_predicate.ts |

rustc_trait_selection 378 → 420/976; TOTAL 15638 → 15680/25518. `bun scripts/coverage.ts --check`: markers ok (16199).

## Files touched
- `src/rustc_trait_selection/traits/query/{normalize,dropck_outlives}.ts`, `query/type_op/{mod,custom,ascribe_user_type,normalize,outlives,prove_predicate}.ts`
- new: `src/rustc_trait_selection/traits/query/query_typeops.test.ts` (10 tests)
- re-pin: `src/rustc_infer/contract.test.ts` ("the contract's placeholders stop as UNPORTED": the example moves from
  `At::query_normalize` (now ported) to `InferCtxt::err_ctxt` (`rustc_trait_selection::error_reporting::InferCtxt::err_ctxt`,
  still a contract placeholder). Same assertion form, only the placeholder changed.)
- No signature in `decls.ts` changed.

## Checks
- `bunx tsc --noEmit -p .` clean.
- `bun test src/rustc_trait_selection src/rustc_infer src/rustc_traits --timeout=60000`: 146 pass, 0 fail.
- Each of the 8 modules loads as a fresh entry point (`bun -e "await import(..)"`).
- Samples, lane vs base 60a45cf (base in a temporary worktree, same args); per-case results byte-identical:
  - tydump-minicore (46): 14 MATCH / 0 DIFF / 32 UNPORTED both (runs `oqt-base-tydump-mc` / `oqt-lane-tydump-mc`, `oqt-lane2-tydump-mc`).
    Stops: 24× `SelectionContext::poly_select`, 6× `rustc_middle::mir::ConstraintCategory (mir, M4): BoringNoLocation`,
    1× `TyCtxt::mk_pat (Pattern class)`, 1× `QueryKey for PseudoCanonicalInput<Ty>`.
  - thirdump-minicore (46): 14 / 0 / 32 both, same stops.
  - tydump-nocore `--sample 100 --seed old-query-typeops`: 86 / 0 / 14 both (4× ConstraintCategory, 3× parse_data_layout,
    3× from_int_ty, ...).
  - No sample reaches this lane's code yet: the old-solver suites stop at `poly_select` (old-select-a) first, and the
    canonical queries this code calls have no query key (below).

## Tests (query_typeops.test.ts; mock `TyCtxt` with `-Znext-solver=coherence`, `recursion_limit` stubbed to 128)
`trivial_dropck_outlives` (scalars/refs/str/never/tuples/slices vs params); `dtorck_constraint_for_ty_inner` (params forwarded
as dtorck types, overflow past the limit, `value_within_limit(128)` holds); `compute_dropck_outlives_inner` on `(u8, T)`
(through `query_normalize` and the old `FulfillmentContext`); `QueryTypeOp_DropckOutlives.try_fast_path`; `query_normalize`
(old solver) on an alias-free value; `QueryTypeOp_Normalize(Normalizable_Ty).try_fast_path` and the
`PolyTypeOutlivesClause` unreachable; `CustomTypeOp` Debug (`"desc"`, checked against the oracle: `self.description.fmt(f)`
in the `Debug` impl resolves to `<&str as Debug>`) and `fully_perform` of a trivial op (no constraints); a `CustomTypeOp` that
equates `&'?0 u8` / `&'?1 u8` reaches the pinned stop `rustc_middle::mir::ConstraintCategory (mir, M4): BoringNoLocation`
in `make_query_region_constraints`; `TypeOp_ParamEnvAnd(QueryTypeOp_ProvePredicate).fully_perform` of `WellFormed(u8)`
through the fast path; `type_op_prove_predicate_with_cause`; `AscribeUserType` has no fast path.

## `unported(...)` left
None in the ported files. Reached through other parts (stops a real compilation will hit here):
- The canonical queries called by this code have `key_unported` keys in `rustc_middle/queries.gen.ts`:
  `normalize_canonicalized_{projection,free_alias,inherent_projection}` (`CanonicalAliasGoal`), `type_op_ascribe_user_type`,
  `type_op_normalize_{ty,clause,poly_fn_sig,fn_sig}`, `type_op_prove_predicate`, `dropck_outlives`. Note: their
  `key_unported(...)` message reads `"(LocalExpnId, &'tcx TokenStream)"` for all of them (wrong label from codegen?).
  Root / a small-gaps item: add `KEY_<goal>` values with keys.ts's `canonical_query_input_key` builder (as selcx-contract
  did for `KEY_CanonicalPredicateGoal`) + `tools/codegen/queries.config.json`, regenerate (not done here: outside my files).
- `infcx.err_ctxt()` (error_reporting, wave 19): `report_overflow_obligation` (next-solver overflow arm of `query_normalize`)
  and `build_overflow_error(..).delay_as_bug()` (opaque recursion limit in `QueryNormalizer::try_fold_ty`).
- `mir_coroutine_witnesses` (M4) for `ty::Coroutine` in `dtorck_constraint_for_ty_inner`.
- `make_query_region_constraints` → `ConstraintCategory` (M4 stand-in) whenever region constraints are scraped.

## PORT decisions (please record)
1. `QueryNormalizer` (generated class) implements `FallibleTypeFolder<NoSolution>` via `declare module "./normalize.gen.ts"`
   with its methods assigned on the prototype (precedent freshen.ts); the private `try_fold_free_or_assoc` is declared there
   too. `MaxEscapingBoundVarVisitor` (generated interface) is visited by the local class `MaxEscapingBoundVarVisitorImpl`
   (precedent `ContainsBevyParamSetVisitor`). `QueryNormalizer.cause` is the `At`'s cause, shared (upstream `&ObligationCause`).
2. `NoSolution` values are a local frozen `{}` per module (ZST; precedent query_response.ts / implied_outlives_bounds.ts).
   `?` on `InferResult` / `ocx.eq` maps the `TypeError` to `NoSolution` (`impl From<TypeError> for NoSolution`).
3. `TypeOpOutput.constraints` (`Option<&'tcx QueryRegionConstraints>`) holds the value itself (`tcx.arena.alloc(x)` is `x`).
4. `Normalizable_<T>` descriptors carry `T`'s `TypeFoldable` as forwarding closures (read at call time: init order);
   `d_TypeOutlivesClause` / `d_FnSig` are local descriptors of the derived impls.
5. dropck_outlives.ts: `Vec::append` / `drain(..)` are `push(...x.splice(0))` / `x.splice(0)` (the reused `constraints`
   is emptied in place); `mir::CoroutineLayout` is the local view `CoroutineLayout_` (precedent needs_drop.ts);
   `TypingEnv: TypeFoldable` is the local `d_TypingEnv` (precedent const_to_pat.ts).
6. Trait-decl methods (`TypeOp::fully_perform`, `QueryTypeOp::{try_fast_path, perform_query}`, `Normalizable::type_op_method`)
   carry `// rustc:` markers on the interface members (precedent rustc_infer `TraitEngine`).

## For root
- PORT(decls): pending root: `TypeErrCtxtView` (traits/mod.ts) lacks `build_overflow_error(cause, span, suggest) -> Diag`
  (with `delay_as_bug()`); query/normalize.ts reads it through a local view `OverflowErrCtxtView`. Add it to the view (or the
  wave-19 contract) and drop the local view.
- The canonical query keys above (and the odd `key_unported` label).
- Importing a `*.gen.ts` module directly as a fresh entry can fail (`rustc_infer/infer/mod.gen.ts`, `rustc_type_ir/predicate.gen.ts`:
  TDZ); import through the re-exporting module instead (done here).
- Temporary base worktree used for comparison: `.data/lanes/oqt-base` (detached at 60a45cf; safe to remove with
  `git worktree remove .data/lanes/oqt-base`).
