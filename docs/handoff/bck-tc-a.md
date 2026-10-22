# Handoff: bck-tc-a (M4 wave 23, borrowck fill): `rustc_borrowck/src/type_check/mod.rs`

Branch `lane/bck-tc-a` (from `e138140f` on integ-w19, no merges).

## Files touched
- `src/rustc_borrowck/type_check/mod.ts`: every stub of mod.rs filled (lane row of the split table).
- `src/rustc_borrowck/contract.test.ts`: my row only (`"bck-tc-a": 39` removed, a comment marks it filled: a lane with no
  stub left has no key in `per_lane`), markers 42 → **81** (+39), stubs 859 → **820** (−39). Root merges by deltas.

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_borrowck/src/type_check/mod.rs`: **40/40 ported** (39 stubs + the
  `NormalizeLocation::to_locations` trait member marker that was already there).
- `bun scripts/coverage.ts --check`: markers ok (20459; vendor 4330).

## What is ported
`type_check`, `mirbug`, `MirTypeckRegionConstraints::placeholder_region`, `Locations::{from_location, span}`, the whole
`TypeChecker` (`tcx`, `body`, `check_user_type_annotations`, `push_region_constraints`, `sub_types`, `eq_types`,
`relate_type_and_user_type`, `check_promoted`; the `Visitor` impl `visit_span`, `visit_body`, `visit_statement`,
`visit_terminator`, `visit_local_decl`, `visit_rvalue`, `visit_operand`, `visit_const_operand`, `visit_place`,
`visit_projection_elem`; `check_call_dest`, `check_call_inputs`, `check_iscleanup`, `assert_iscleanup`,
`assert_iscleanup_unwind`, `ensure_place_sized`, `aggregate_field_ty`, `rvalue_user_ty`, `check_aggregate_rvalue`,
`add_reborrow_constraint`, `add_generic_reborrow_constraint`, `prove_aggregate_predicates`, `prove_closure_bounds`), both
`NormalizeLocation` impls, `TypeOp for InstantiateOpaqueType::fully_perform`.

## `unported(...)` left
None in mod.ts. The runtime path does not reach this code yet: `mir_borrowck` still stops at bck-nll's
`rustc_borrowck::nll::replace_regions_in_mir` (contract test pin unchanged, no re-pin needed). Once bck-nll / bck-core
land, `type_check` will stop at the first stub of another lane on its path, in order:
1. `free_region_relations::create` (bck-tc-b) — first call of `type_check`.
2. `LivenessValues::with_specific_points` (bck-regions-a) — runs before (1) actually: it is the first statement.
3. `TypeChecker::{instantiate_canonical, ascribe_user_type, normalize, deeply_normalize, prove_trait_ref, prove_clause(s),
   normalize_and_prove_instantiated_clauses, struct_tail, fully_perform_op}` (canonical.rs, bck-tc-b),
   `relate_types` / `eq_args` (relate_tys.rs, bck-tc-b), `equate_inputs_and_outputs` / `check_signature_annotation`
   (input_output.rs, bck-tc-b), `ConstraintConversion::{new, convert_all}` (bck-tc-b).
4. `liveness::generate` (bck-tc-live).
5. `UniversalRegions::{to_region_vid, encountered_re_error}`, `DefiningTy::{is_const, def_id, args}` (bck-nll),
   `OutlivesConstraintSet::{push, outlives}` (bck-regions-b), `LivenessValues::{add_location, live_regions_unordered,
   without_specific_points}` / `PlaceholderIndices::insert` (bck-regions-a), `BorrowSet::borrows_at_location` /
   `path_utils::is_upvar_field_projection` (bck-core), `PoloniusLocationTable::mid_index` (bck-nll),
   `PoloniusRegionVid_from_RegionVid` (bck-polonius-legacy; legacy facts only).

## `// PORT:` decisions (all in mod.ts)
- Header: `span_mirbug!` is the module helper `span_mirbug(cx, elem_debug, msg)` (message formatted eagerly, as
  `format!`); `debug!`/`trace!`/`#[instrument]` stay comments; `location.to_locations()` is
  `NormalizeLocation_Location.to_locations(location)` (local helper `to_locations`), the `Locations` impl is the identity.
- Init order: the fns `type_check` calls in free_region_relations.ts, constraint_conversion.ts, liveness/mod.ts,
  path_utils.ts, universal_regions.ts (`DefiningTy` companion) and polonius/legacy/facts.ts are read lazily through cached
  `require` (as root_cx.ts reads lib.ts), and `rustc_session/config.ts` (`Polonius::is_next_enabled`) too, since config.ts
  is not a fresh entry point. `OutlivesConstraintSet` / `clone_OutlivesConstraint` are imported from the hand module
  constraints/mod.ts (importing constraints/mod.gen.ts first created a cycle through type_check/mod.gen.ts →
  constraints/mod.ts that hit the TDZ; the contract test's fresh-entry check caught it).
- Derived `Default`s spelled out: `PlaceholderIndices` with `new KeyedSet<PlaceholderRegion>(intern_key)` (struct-keyed
  `FxIndexSet`, contract rule 7; bck-regions-a's `insert` must use the set's insertion index), `OutlivesConstraintSet([])`,
  `PoloniusContext(undefined, [], new Set(), new DeferredRegionLiveness([], []), undefined)`, `VarianceDiagInfo.None`.
- `reported_errors` is `KeyedSet<[Ty, Span]>(intern_key)`; `IndexSet::replace(..).is_none()` = "was absent" (has → add).
- `check_promoted`'s `mem::swap`s: the `MutRef` option value, the two fields of the shared `MirTypeckRegionConstraints`,
  and the *contents* of `deferred_closure_requirements` (`splice`), so the caller's vector keeps its identity.
- `visit_body`: each statement gets `clone_Location(location)` (a `Copy` value that upstream mutates in place; visitors
  store it in `Locations::Single`).
- `sig != unnormalized_sig`: local `FnSig_eq` (derived `PartialEq`: interned `inputs_and_output` + `fn_sig_kind` fields).
- `Rvalue::Cast` arm split into the private method `visit_rvalue_cast` (size only, no marker, same order).
- `binder_ty.into()` (`UnsafeBinderInner` → `Binder<Ty>`) is `UnsafeBinderInner_deref`.
- `PoloniusFacts` is `unknown` (D7): the `loan_issued_at` pushes cast it to a local `{ loan_issued_at: [...] }` view;
  unreachable until legacy facts exist (`PoloniusFacts_default` stops unported in lib.ts).
- `CustomTypeOp<()>` uses `fold_unit` from rustc_trait_selection solve/inspect/analyse.ts (the only `TypeFoldable<null>`
  in the tree; root may want it moved to rustc_type_ir) and `ToUniverseInfo_never`.
- `tcx.prof` timer (`polonius_fact_generation`) dropped (driver-m2 decision 8).

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun test src/rustc_borrowck`: 6 pass, 0 fail (contract test included).
- Full `RUST_TS_AGENT=bck-tc-a bun test src --timeout=120000` (once, at the end): **6095 pass, 1 skip, 12 fail**. All 12
  are stale oracle-test pins outside this lane, not reached by this code (`type_check` runs only after bck-nll's
  `replace_regions_in_mir`): 11 cases of `src/rustc_hir_analysis/check/compare_impl_item.oracle.test.ts` (e0049_*, e0050,
  e0053_*, e0185, e0186, e0195, e0643, refine_rpitit) and 1 of `src/rustc_hir_analysis/hir_ty_lowering/errors.oracle.test.ts`
  (e0109_kinds) still expect `rust-ts: unported: mir_borrowck provider (not ported)`; they now get
  `rustc_borrowck::nll::replace_regions_in_mir` (11) and `rustc_mir_transform::cleanup_post_borrowck::CleanupPostBorrowck
  (pass not ported)` (1, a tainted body: `mir_borrowck` returns `Err`). The borrowck-contract handoff re-pinned other such
  tests but not these; root (or the owner of those test files) should re-pin them on integ-w19.

## Samples (`RUST_TS_AGENT=root-f5de`, vs the given base runs)
| suite | lane run | M / D / U / C / T | vs base |
|---|---|---|---|
| tydump-minicore (46) | `20261022-210053-root-f5de-7baa` | 45 / 0 / 1 / 0 / 0 | same; 1 UNPORTED message changed (const-eval stop moved, not this lane) |
| mirdump-minicore (46) | `20261022-210200-root-f5de-cjvp` | 45 / 0 / 1 / 0 / 0 | +28 UNPORTED→MATCH (integ-w19 progress), no new DIFF/CRASH |
| tydump-ui `--sample 300` | `20261022-210301-root-f5de-l7kx` | 261 / 0 / 37 / 0 / 0 (+2 UNSTABLE) | +3 UNPORTED→MATCH, 35 stop messages changed (`mir_borrowck provider` → `replace_regions_in_mir`, const-eval stops), no MATCH lost |
| mirdump-ui `--sample 300` | `20261022-210730-root-f5de-74xc` | 269 / 0 / 31 / 0 / 0 | +252 UNPORTED→MATCH (integ-w19 MIR/transform progress), 31 stop messages changed, no MATCH lost; stops: 16 `eval_in_interpreter`, 13 `replace_regions_in_mir`, 2 `try_to_bits_for_ty` |
| borrowck-ui `--sample 300` (no base run given) | `20261022-211247-root-f5de-y9bb` | 0 / 0 / 300 / 0 / 0 | 287 stop at `rustc_borrowck::nll::replace_regions_in_mir` (bck-nll), 13 at `eval_in_interpreter` (CTFE) |

No MATCH turned into anything else; no new DIFF/CRASH/TIMEOUT.

## For other lanes / root
- bck-regions-a: `PlaceholderIndices.indices` is constructed here as `KeyedSet<PlaceholderRegion>(intern_key)`.
- bck-tc-b: `fully_perform_op` is called with `TypeOp_CustomTypeOp<null>(fold_unit)` + `ToUniverseInfo_never`
  (`add_generic_reborrow_constraint`); `normalize`/`deeply_normalize` with `Normalizable_Ty`/`_FnSig`/`_PolyFnSig` and
  `display_Ty` / `display_FnSig` / `display_PolyFnSig`.
- No shared file outside my row was edited.
