# Handoff: variance-outlives (wave 17, M3): rustc_hir_analysis variance/*, outlives/*, impl_wf_check

Branch `lane/variance-outlives`, from main 816b5c5, no merges. No baselines, suites, probes, oracle outputs, harness or
scripts touched.

## Files touched
All under `src/rustc_hir_analysis/`. No contract stubs existed for these files, so the modules are new (PORTING §2).
- `variance/{mod,terms,constraints,solve,dump}.ts` (new): variance/*.rs.
- `outlives/{mod,explicit,implicit_infer,utils,dump}.ts` (new): outlives/*.rs.
- `impl_wf_check.ts`, `impl_wf_check/min_specialization.ts` (new).
- `diagnostics/remove_or_use_generic.ts` (new): diagnostics/remove_or_use_generic.rs. Not in the brief; see PORT decision 9.
- `lib.ts` (call sites only): the `mod` lines of impl_wf_check / outlives / variance became imports, and five
  `provide` lines are uncommented: `inferred_outlives_crate`, `inferred_outlives_of`,
  `enforce_impl_non_lifetime_params_are_constrained`, `crate_variances`, `variances_of`.
- Tests (new): `variance_outlives.test.ts`, `variance_outlives_test/{run.ts,variances.rs,outlives.rs,pending.rs,implwf.rs,implwf_spec.rs}`.
- **Re-pins in other lanes' tests.** Each moves a stop or count past the providers this lane ports; no matching case
  is weakened.
  - `collect/collect_b.test.ts`: `inferred_outlives_of provider (not ported)` leaves `PENDING`. The type alias's
    `clauses_of` is now pinned to its computed value, `GenericClauses { parent: None, clauses: [] }`, which the loop
    above it also compares with the probe.
  - `contract.test.ts` test 10: 45 providers (was 40), and the 5 new ones are asserted to be functions.
    `check_unused_traits` is asserted unset (it replaces `variances_of`).
  - `rustc_ty_utils/ty_test/ty.expected.txt`: `param_env(::f)` now stops later, at `constness provider (not ported)`.

## Coverage (`bun scripts/coverage.ts --missing <file>`: 0 missing everywhere)
| upstream file | ported |
|---|---|
| variance/mod.rs | 6/6 |
| variance/terms.rs | 4/4 |
| variance/constraints.rs | 16/16 |
| variance/solve.rs | 6/6 |
| variance/dump.rs | 2/2 |
| outlives/mod.rs | 2/2 |
| outlives/explicit.rs | 2/2 |
| outlives/implicit_infer.rs | 4/4 |
| outlives/utils.rs | 2/2 |
| outlives/dump.rs | 1/1 |
| impl_wf_check.rs | 3/3 |
| impl_wf_check/min_specialization.rs | 11/11 |
| diagnostics/remove_or_use_generic.rs | 4/4 |

`bun scripts/coverage.ts --check`: markers ok (13398; vendor 3888). `bunx tsc --noEmit -p .`: clean.

## Fixpoint order
- **variance/solve.rs.** `solve` sweeps `constraints` in push order until no change. The constraints are pushed in
  `hir_crate_items(()).definitions()` order, with each ADT's ctors right after it, as upstream does. The lang-item
  override filter keeps that order.
- **outlives/implicit_infer.rs.** The `for i in 0..` loop walks `tcx.hir_free_items()` in order. `global_inferred_outlives`
  is a `DefIdMap` (insertion-ordered; `set` on a present key keeps its position, as `IndexMap::insert` does).
  `RequiredClauses` is a `KeyedMap` keyed by `intern_key` (insertion-ordered `FxIndexMap`; `.entry().or_insert` keeps the
  first span). So `inferred_outlives_crate`'s per-item clause lists come out in upstream's order.
- **Checks.** The chain C1→C2→C3→C4 in outlives.rs needs four rounds; its output is byte-identical to the oracle's. The
  order and spans of each `inferred_outlives_of` list are checked as the tail of the probe's `clauses_of` (see Results).

## Results
- **Dump stderr against the pinned rustc: byte-identical.**
  - `#[rustc_dump_variances]` on variances.rs: 16 items. They cover lang items PhantomData / UnsafeCell, `&`,
    `&mut`, `*const`, `*mut`, nested ADTs, recursion, mutual recursion, const params, tuples, unions, early-bound fn
    params and an inherent method.
  - `#[rustc_dump_inferred_outlives]` on outlives.rs: 13 items. They cover `&'a &'b T`, inferred clauses through ADTs,
    explicit `T: 'a` clauses, the 4-round chain, enums, `'static` and no clauses.
- **E0207 against the pinned rustc: byte-identical.** `check_impl_wf` on implwf.rs prints 7 E0207 errors, including
  the remove/use suggestions and the `'_` suggestion.
- **Facts against the tydump probe: 0 differences.**
  - variances.rs / outlives.rs: 31 + 24 `variances_of` lines and 56 + 42 `clauses_of` lines match.
  - With tydump-subject's two Debug fixes applied temporarily (not committed): every non-empty `inferred_outlives_of`
    list is exactly the tail of the probe's `clauses_of`. That was 12 lists in outlives.rs and 15 in variances.rs.
- **The 46 tydump-minicore cases** (probe vs run.ts `facts`, measured only):
  - 148 `variances_of`, 1104 `clauses_of` and 25 `inferred_outlives_of` lines match; 0 differ.
  - With check_abi as a temporary no-op plus the tydump-subject Debug fixes: 424 `variances_of` and 1286 `clauses_of`
    lines match; 0 differ.
- `RUST_TS_AGENT=variance-outlives bun scripts/difftest.ts --suite hir-tree-nocore --sample 100`: 100 MATCH / 0 DIFF /
  0 UNPORTED (run 20261014-170159-variance-outlives-evhy).
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4738 pass, 1 skip (the pre-existing linux-only test), 0 fail (4739 tests, 294 files), including variance_outlives.test.ts 7/7.

## Why fn-pointer / dyn / projection fields still stop (for root)
`crate_variances` and `inferred_outlives_crate` are crate-wide queries. They lower the type of every ADT field in
the crate. If one field's lowering stops, the whole query stops, and every later `variances_of` /
`inferred_outlives_of` / `clauses_of` of that crate is FATAL (poisoned). The stops reached, all in other lanes'
stand-ins:
- fn pointer types: `rustc_hir_analysis::check::check::check_abi` (hir_ty_lowering/mod.ts stand-in; lane check-check);
- `dyn Trait`: `rustc_trait_selection::traits::util::expand_trait_aliases`;
- `T::Item`: `rustc_infer::traits::util::transitive_bounds_that_define_assoc_item`.

pending.rs pins these, and turns into an oracle comparison when they land. check_abi matters most: it causes 316
FATAL facts in the minicore corpus.

## `unported(...)` left (all in this lane's files)
- constraints.ts `Pattern_kind`: `rustc_middle::ty::Pattern (deref to PatternKind; ty/pattern.rs not ported)`, the
  same stand-in rustc_type_ir walk.ts uses. It is reached only by pattern types (`ty::Pat`).
- min_specialization.ts stand-ins, reached only with `#![feature(min_specialization)]`:
  - `rustc_trait_selection::traits::ObligationCtxt::new_with_diagnostics`
  - `rustc_trait_selection::traits::specialize::translate_args_with_cause`
  - `rustc_trait_selection::error_reporting::InferCtxtErrorExt::err_ctxt`
  - `rustc_infer::infer::InferCtxt::deeply_resolve_via_region_graph`
  - `rustc_trait_selection::traits::wf::obligations`
  - `rustc_middle::ty::elaborate_impl: impl Elaboratable for (Clause, Span)`
  - `rustc_infer::traits::util: impl Elaboratable for PredicateObligation`

  Today the path stops even earlier, at `specialization_graph_of provider (not ported)` (`TraitDef::ancestors`).
  `elaborate(.., Clause)` uses rustc_type_ir elaborate.ts's existing `Elaboratable_Clause`.

## PORT decisions (please record)
1. **variance/terms.rs.**
   - `DroplessArena` is erased; a term is its own object.
   - `VarianceTerm` is a `$`-tagged union with a hand Debug (`(a × b)`, `[i]`).
   - `InferredIndex` is a branded number, like cgp's `Parameter`.
2. **ConstraintContext fields.** The fields `contravariant` / `invariant` clash with the methods of the same names, so
   they are `contravariant_` / `invariant_`.
3. **`map[&k]` on a hash map** is `unwrap(map.get(k), "key not found")`, std's `Index` panic message.
4. **`RequiredClauses`** is `KeyedMap<OutlivesClause<GenericArg>, Span>(intern_key)`, built by `new_RequiredClauses()`.
   `d_ArgOutlivesClause` is its D4 descriptor.
5. **`OpaqueTypeLifetimeCollector`** (fn-local in `variance_of_opaque`) is a module-level class after the fn. The
   `zip_eq` length mismatch panics with itertools' message.
6. **outlives/dump.rs.**
   - `p.to_string()` of an `OutlivesClause` is `display_OutlivesClause` over a local `IrPrint` built from
     `print_OutlivesClause` and `IrPrint_print`.
   - `preds.sort()` is a UTF-8 byte sort (`sort_strings`).
7. **`Result::and(x)`** is a local `and(res, x)` with `x` evaluated first (an eager argument).
8. **min_specialization.**
   - `partition_dedup` ports std's swap algorithm, because which duplicate comes first depends on the swaps.
   - `TraitRef ==` is `DefId_eq` plus `args` identity.
9. **remove_or_use_generic.rs** (unassigned in the contract handoff) is ported here. Its only caller is
   impl_wf_check.rs, and E0207 cannot be emitted without it. It is imported from its own module; diagnostics.ts (not
   this lane's file) has no `mod` line for it yet (see "For root" 3).
10. **`impl_wf_check` stays crate-private.** lib.ts imports it but does not re-export it, as upstream. The wfcheck lane
    should import `./impl_wf_check.ts` directly and call `check_impl_wf`.
11. **Query values typed `unknown`** in queries.gen.ts (`crate_variances`, `inferred_outlives_crate`, `variances_of`'s
    element type, `inferred_outlives_of`'s clause) are cast at the use sites. `inferred_outlives_of` returns
    `readonly [Clause, Span][]`, the provider slot's tuple type.

## For root
1. **check-check lane.** `check_crate` (lib.rs:220-221) should call `outlives.dump.inferred_outlives(tcx)` and then
   `variance.dump.variances(tcx)`. lib.ts already holds the `outlives` / `variance` namespace imports. Both fns are
   verified against the oracle (run.ts `dump` mode).
2. **wfcheck lane.** wfcheck.rs:278 calls `check_impl_wf(tcx, def_id, of_trait)` from `./impl_wf_check.ts`.
3. **Optional:** diagnostics.ts could add `export * as remove_or_use_generic from "./diagnostics/remove_or_use_generic.ts"`,
   mirroring diagnostics.rs:17.
4. **Optional, a tools change:** type `crate_variances` (`CrateVariancesMap`), `inferred_outlives_crate`
   (`CrateClausesMap`) and `variances_of` (`Variance`) in tools/codegen's queries config, so the casts can go.
