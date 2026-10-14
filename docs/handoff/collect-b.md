# Handoff: collect-b (wave 16, M3): rustc_hir_analysis collect/clauses_of.rs, collect/item_bounds.rs, collect/dump.rs

Branch `lane/collect-b` (from `5171055`, the hirtylowerer-contract branch; no merges).

## Result
The three stub modules of the hirtylowerer contract are filled: every fn in upstream order, with markers. The pin's
file is `clauses_of.rs` (upstream renamed `predicates_of` -> `clauses_of`, `super_predicates_of` ->
`explicit_super_clauses_of`, ...); `inferred_outlives_of` is rustc_hir_analysis `outlives/` and not in this lane.
The providers `collect::provide` installs for these files (clauses_of, explicit_clauses_of,
explicit_super_clauses_of, explicit_implied_clauses_of, explicit_supertraits_containing_assoc_item,
trait_explicit_clauses_and_bounds, const_conditions, explicit_implied_const_bounds, type_param_clauses, item_bounds,
explicit_item_bounds, item_self_bounds, explicit_item_self_bounds, item_non_self_bounds, impl_super_outlives) now run
the ported bodies. They stop where they reach other lanes' stubs (see "PENDING").

## Files touched
- `src/rustc_hir_analysis/collect/clauses_of.ts`: clauses_of.rs 18/18 (15 free fns, nested `is_const_param_default`,
  `ConstCollector::visit_const`, `ItemCtxt::probe_ty_param_bounds_in_generics` on `ItemCtxt.prototype`; the
  `unported_methods` call is gone).
- `src/rustc_hir_analysis/collect/item_bounds.ts`: item_bounds.rs 18/18 (10 free fns; the `hand` types
  `MapAndCompressBoundVars` and `AssocTyToOpaque` are now `TypeFolder` classes).
- `src/rustc_hir_analysis/collect/dump.ts`: dump.rs 8/8 (6 fns; `AnonConstFinder` is a local `intravisit::Visitor`
  class inside `def_parents`, as upstream).
- New tests: `src/rustc_hir_analysis/collect/collect_b.test.ts`, `collect/collect_b_oracle/{run.ts, def_parents.rs,
  queries.rs}`.
- Nothing outside these files.

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_hir_analysis/src/collect/{clauses_of,item_bounds,dump}.rs`:
  18/18, 18/18, 8/8 ported (0 missing).
- `bun scripts/coverage.ts --check`: markers ok (12305; vendor 3888).
- `--crate rustc_hir_analysis`: 47/799 (was 3/799 at the contract).

## Tests
- `collect_b.test.ts` (18 tests):
  - stubbed-`TyCtxt` unit tests (as rustc_middle ty/util.test.ts): `clauses_of` (inferred outlives appended, `Self:
    Trait` at DUMMY_SP for traits, identity when nothing changes), `explicit_clauses_of` on a trait (drops bounds on its
    own associated types, keeps others, returns the query value itself when nothing is dropped),
    `implied_clauses_with_filter` on an extern trait (forwards to `explicit_super_clauses_of`; any other filter fails
    the `assert_matches!` with core's text), `assert_only_contains_clauses_from` (no-op: release oracle),
    `const_conditions` / `explicit_implied_const_bounds` ICE texts and the RPITIT forward, `type_param_clauses` on an
    impl RPITIT (`unreachable!` text), `remap_gat_vars_and_recurse_into_nested_projections` + `MapAndCompressBoundVars`
    (GAT bound vars mapped to the GAT's params, the rest compressed from var 0; duplicate / non-bound args; non-alias
    self type; SelfOnly vs All on a nested projection; the `unreachable!` filter), `item_non_self_bounds`;
  - driver tests on no_core crates (`collect_b_oracle/run.ts`, stops after expansion like hir_tree_oracle):
    - `def_parents.rs`: `#[rustc_dump_def_parents]` on nested fns with anon consts in signatures, bodies and nested
      items: stderr and exit code **equal the pinned rustc's** (the crate is otherwise clean, so the dumps that
      `check_crate` runs last are the whole stderr);
    - `queries.rs`: all six dumps on a crate without `#[rustc_dump_*]` print nothing;
    - `queries.rs`: `clauses_of` / `explicit_item_bounds` / `item_bounds` for every DefId. Each value must equal the
      tydump probe's line for that DefId and query (run directly, `probeBinary("tydump")`); each stop must be in
      `PENDING`. Today every `clauses_of` stops at collect-a's `ItemCtxt::new` and the assoc type's
      `explicit_item_bounds` at collect-a's `generics_of`; the type alias gives `EarlyBinder { value: [], .. }` for both
      bound queries (item_bounds.rs:486). When collect-a / hir-ty-lowering land, the same test compares real values
      against the probe.
- `bunx tsc --noEmit -p .`: clean. `bun test src/rustc_hir_analysis`: 28 pass.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see "Full test run".
- `RUST_TS_AGENT=collect-b bun scripts/difftest.ts --suite hir-tree-nocore --sample 100`: 99 MATCH / 0 DIFF /
  1 UNPORTED / 0 CRASH (run `20261014-121517-collect-b-vnax`); the UNPORTED is
  `tests/ui/delegation/generics/free-to-trait-self-reuse.rs` at `rustc_hir_analysis::collect::fn_sig` (collect-a,
  pre-existing, not protected). No suite runs `check_crate` yet, so no suite reaches these queries.

## `unported(...)` left (in my files)
1. `rustc_hir_analysis::delegation::inherit_clauses_for_delegation_item` (clauses_of.rs:148,
   `gather_explicit_clauses_of` of a delegation item): delegation.rs (773 lines) has no lane.
2. `rustc_hir_analysis::constrained_generic_params::parameters_for_impl` (clauses_of.rs:299-304, every **impl**'s
   `gather_explicit_clauses_of`, after all its clauses are collected): constrained_generic_params.rs (~230 lines) has
   no lane. Upstream evaluates `cgp::parameters_for_impl(..)` as the argument of `setup_constraining_clauses`, so that
   is the first stop. **Suggest a small lane soon** (it also serves impl_wf_check, wave 17): it blocks the clauses of
   every impl.
3. `rustc_middle::ty::vtable::TyCtxt::COMMON_VTABLE_ENTRIES` and `rustc_middle::ty::vtable::<VtblEntry as Debug>::fmt`
   (dump.rs `vtables`, only under `#[rustc_dump_vtable]`): ty/vtable.rs is M4/M6. (Before them, the `vtable_entries`
   query itself stops at its placeholder provider.)

## PENDING (stops in other lanes' code reached from these files; exact texts)
- `rustc_hir_analysis::collect::ItemCtxt::new` (collect-a): every `gather_explicit_clauses_of`,
  `implied_clauses_with_filter`, `type_param_clauses`, `const_conditions`, `associated_type_bounds`,
  `opaque_type_bounds`.
- `rustc_hir_analysis::collect::generics_of::generics_of` (collect-a): `GenericArgs::identity_for_item` in
  `associated_type_bounds` / `explicit_item_bounds_with_filter`.
- after those: the `HirTyLowerer` methods (`lower_bounds`, `add_implicit_sizedness_bounds`, `add_default_traits`,
  `lower_ty_param`, `lower_const_param`, `lower_lifetime`, `lower_ty_maybe_return_type_notation`; lanes
  hir-ty-lowering-b/-c) and `<ItemCtxt as HirTyLowerer>::probe_ty_param_bounds` (collect-a).
- `rustc_type_ir::predicate::TraitRef::from_assoc (predicate.rs, lane tyir-misc)`: **stale stub** in
  `src/rustc_middle/ty/context/impl_interner.ts` `trait_ref_and_own_args_for_alias` (impl_interner.rs:223). rustc_type_ir
  predicate.ts now ports `TraitRef.from_assoc`, so root (or the owner of impl_interner.ts) can fill the body:
  `const trait_def_id = this.parent(def_id); const trait_ref = TraitRef.from_assoc(as_interner(this), trait_def_id,
  args); return [trait_ref, args.slice(trait_ref.args.length)];`. It is reached from `AliasTy::trait_ref`, i.e. from
  `remap_gat_vars_and_recurse_into_nested_projections` for every `where Self::Assoc: ..` clause of a trait. The unit
  test stands in exactly that body on its stubbed `tcx`.
- `object_lifetime_default` (placeholder provider; collect-rbv's `provide` is a no-op) under
  `#[rustc_dump_object_lifetime_defaults]`; `vtable_entries provider (not ported)` under `#[rustc_dump_vtable]`.

## PORT decisions (please record)
1. `FxIndexSet<(ty::Clause, Span)>` is a `KeyedSet<[Clause, Span]>` keyed by `${clause.id}:${span}` (interned clause,
   span-interner index: equal exactly when the tuples are `==`), insertion-ordered like the IndexSet.
2. Query values typed `unknown` in queries.gen.ts (`explicit_clauses_of`, `generics_of`, `type_of`, `fn_sig`,
   `impl_trait_ref`, `explicit_item_bounds`, `item_bounds`, `impl_trait_header`, ...) are cast to upstream's value type
   at the read, as rustc_middle generics.ts / impl_interner.ts do.
3. `cfg!(debug_assertions)` (assert_only_contains_clauses_from) is a module const `DEBUG_ASSERTIONS = false`; the
   checks after the early return are ported anyway, with `assert_eq!(l, r, "..")` as a local `assert_eq_args`
   (core's `assertion \`left == right\` failed: <args>` text).
4. dump.rs `object_lifetime_defaults`: `ObjectLifetimeDefault` is still `Pending` in decls.ts, so the query value is
   viewed as a local PORTING §5 shape of middle/resolve_bound_vars.rs:42 (`Empty | Static | Ambiguous | Param(DefId)`),
   marked `PORT(decls): pending root`. Replace with the real type when collect-rbv (or root) ports it.
5. Nested types stay nested: `ConstCollector` (local class in `const_evaluatable_clauses_of`), `AnonConstFinder`
   (local `Visitor` subclass in `def_parents`, `NestedFilter = nested_filter::All`, `maybe_tcx` =
   `TyCtxt_as_HirTyCtxt`). Their provided trait methods delegate to `TypeVisitor_provided` / `TypeFolder_provided`.
6. `ty::print::with_reduced_queries!({..})` is `with_reduced_queries(() => ..)` (rustc_middle print/pretty.ts).
7. `HashMap` indexing (`param_def_id_to_index[&id]`) is `unwrap(map.get(id), "no entry found for key")` (std's
   `Index` text).
8. Static trait-impl call `icx.probe_ty_param_bounds(..)` (type_param_clauses) is
   `HirTyLowerer_ItemCtxt.probe_ty_param_bounds.call(icx, ..)` (contract rule).

## Contract (decls.ts)
No declaration was wrong or missing; no local `declare module` was needed.

## For root
1. Record the PORT decisions above.
2. Assign `constrained_generic_params.rs` (blocks every impl's clauses) and, later, `delegation.rs`.
3. Fill the stale `trait_ref_and_own_args_for_alias` stub in rustc_middle impl_interner.ts (body above).
4. When collect-rbv ports middle/resolve_bound_vars.rs, drop dump.ts's local `ObjectLifetimeDefault_` view.

## Full test run
`RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4516 pass, 1 skip (pre-existing linux-only), 0 fail
(4517 tests, 272 files, 1385 s), including collect_b.test.ts 18/18 and contract.test.ts 10/10. Run at `4cd97e0`; the two
later commits change only a panic text and dump.ts imports (`tsc` clean, `bun test src/rustc_hir_analysis` 28 pass after them).
