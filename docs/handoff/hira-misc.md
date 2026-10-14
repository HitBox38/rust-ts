# Handoff: hira-misc (wave 16, M3): rustc_hir_analysis constrained_generic_params.rs + delegation.rs

Branch `lane/hira-misc` (from `5171055`, the hirtylowerer-contract branch; no merges).

## Result
Both files are ported in full, in upstream order, with markers. The contract had no stubs for them, so they are new
modules loaded by `lib.ts`. No `unported(..)` is left in either file.

## Files touched
- `src/rustc_hir_analysis/constrained_generic_params.ts` (new): `Parameter` + 3 `From` impls, `parameters_for_impl`,
  `parameters_for`, `ParameterCollector` (`TypeVisitor`), `identify_constrained_generic_params`,
  `setup_constraining_clauses`. It also exports the D4 descriptors `d_TraitRef`, `d_AliasTerm`, `d_Ty` and `d_Term`.
- `src/rustc_hir_analysis/delegation.ts` (new): all 22 fns. These include `ParamIndexRemapper`, the nested
  `ClausesCollector` and `Replacer`, and the exported `inherit_clauses_for_delegation_item`,
  `inherit_sig_for_delegation_item` and `delegation_user_specified_args`.
- `src/rustc_hir_analysis/lib.ts`: only the load order changed. `// mod constrained_generic_params;` is followed by
  `import "./constrained_generic_params.ts";`, and `// pub mod delegation;` by
  `import * as delegation from "./delegation.ts"; export { delegation };`. The local binding lets the commented
  provider lines be uncommented verbatim.
- `src/rustc_hir_analysis/hira_misc.test.ts` (new): 11 tests.

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_hir_analysis/src/constrained_generic_params.rs`: 10/10 ported.
- `bun scripts/coverage.ts --missing compiler/rustc_hir_analysis/src/delegation.rs`: 22/22 ported.
- `bun scripts/coverage.ts --check`: `markers ok (12293; vendor 3888)`.

## Tests
`hira_misc.test.ts` uses a stubbed `TyCtxt` (an `Object.create(tcx)` view), as ty/util.test.ts and collect-b do. 11 pass:
- **cgp:**
  - `Parameter` Debug;
  - `parameters_for` visit order over type, region and const params;
  - projections are skipped unless `include_nonconstraining`;
  - `parameters_for_impl` uses the trait ref when there is one, else the self type, and the result is a set;
  - `setup_constraining_clauses` on the doc example `impl<T: Debug, U: Iterator<Item = T>>` (order
    `[Item, U: Iterator, T: Debug]`, T constrained), a 2-step chain, and a stuck projection;
  - the "sneaky" projection out of the impl's own trait ref constrains nothing.
- **delegation:**
  - `inherit_clauses_for_delegation_item` for free-to-free `reuse foo` over `fn foo<'a, T: Tr>`, with both identity
    args and user args `foo::<'static, u8>`. The clause is remapped and instantiated.
  - `inherit_sig_for_delegation_item` gives `[u8, u8]` for `fn(T) -> T`.
  - `delegation_user_specified_args` stops at the PENDING text below.
- **Delegation on tests/ui/delegation inputs:** not reachable yet (PENDING). In
  `RUST_TS_AGENT=hira-misc bun scripts/difftest.ts --suite hir-tree-nocore --sample 100`, 97 MATCH / 0 DIFF /
  3 UNPORTED / 0 CRASH (run `20261014-145750-hira-misc-agef`). The 3 UNPORTED were there before this lane and none is
  protected:
  - `delegation/generics/const-predicates-ice-158675.rs` at `rustc_hir_analysis::collect::fn_sig` (collect-a);
  - one `StableHash without a TS impl`;
  - one proc-macro `quote!` case.
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see "Full test run".

## `unported(...)` left
None in these files.

## PENDING (stops reached from these files, in other lanes' code)
- `rustc_hir_analysis::collect::ItemCtxt::new_for_delegation` (collect-a): first stop of `delegation_user_specified_args`.
  Both other delegation entry points reach it through the query.
- After it come `HirTyLowerer::lower_generic_args_of_path` (hir-ty-lowering-a) and, for `reuse <X as Trait>::f`,
  `ItemCtxt::new` / `ItemCtxt::lower_ty` (collect-a, in `get_delegation_self_ty`).
- `rustc_type_ir::predicate::TraitRef::from_assoc (predicate.rs, lane tyir-misc)`: the **stale stub** in rustc_middle
  `ty/context/impl_interner.ts` `trait_ref_and_own_args_for_alias`, which collect-b already reported with the body to
  use. `setup_constraining_clauses` reaches it for every impl **of a trait** that has a projection clause (the
  `projection_term.trait_ref(tcx)` check). Inherent impls and impls without projection clauses do not reach it.

## PORT decisions (please record)
1. `struct Parameter(pub u32)` is a branded number (`number & { __brand: "Parameter" }`), like the `newtype_index!`
   handles. `FxHashSet<Parameter>` is a `Set<Parameter>`. The `From` impls are `Parameter.from_ParamTy` /
   `from_EarlyParamRegion` / `from_ParamConst`, and `debug_Parameter` prints `Parameter(n)`.
2. `parameters_for(tcx, value, include_nonconstraining, d_T)` takes the D4 descriptor last. cgp exports the descriptors
   for the 4 value types upstream passes.
3. `TraitRef == TraitRef` (derived PartialEq, non-interned) is `intern_key(a) === intern_key(b)`, as relate.ts's
   `eq_by_key`.
4. delegation's `FxHashSet<ty::ParamConst>` is a `KeyedSet` over `intern_key`. `RemapTable` is a `Map<number, number>`.
5. `fn_kind(tcx, impl Into<DefId>)` takes `DefId | LocalDefId` through `into_query_key_DefId`.
6. `&v[a..b]` is a local `slice_range` in delegation.ts, with core's `slice_index_fail` check order and texts
   (library/core/src/slice/index.rs:39). **For root:** consider moving it to `src/std/slice.ts`, which has only
   `slice_to` / `slice_from`.
7. The nested `ClausesCollector` (with `with_own_clauses` / `with_clauses`, which consume and return `self`) is a
   fn-local class whose methods mutate and return `this`. `Replacer` stays nested in the loop, as upstream.
8. The derived Debug impls of the private enums (`SelfPositionKind`, `FnKind`, `InheritanceKind`) are hand-written
   `debug_*` fns. These files are not in the codegen set.

## For root
1. **Wire the call sites** in collect-b's `collect/clauses_of.ts`:
   - The impl branch: replace the `void self_ty; void trait_ref; return unported(...)` with
     `setup_constraining_clauses(tcx, clauses, trait_ref, parameters_for_impl(tcx, self_ty, trait_ref));` (import both from
     `../constrained_generic_params.ts`).
   - The delegation branch: replace the `unported("rustc_hir_analysis::delegation::inherit_clauses_for_delegation_item")`
     with `return inherit_clauses_for_delegation_item(tcx, def_id, sig_id);` (import from `../delegation.ts`).
2. **Uncomment the two delegation providers** in `lib.ts` `provide`. The brief allowed me only the load order, so I did
   not change `provide`. The lines are `providers.inherit_sig_for_delegation_item = ...` and
   `providers.delegation_user_specified_args = ...`, and `delegation` is now a local binding there.
3. Fill the stale `trait_ref_and_own_args_for_alias` stub (collect-b's handoff gives the body).
4. Record the PORT decisions above.

## Full test run
`RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4509 pass, 1 skip (the linux-only skip that was already
there), 0 fail (4510 tests, 272 files, 1124 s), including hira_misc.test.ts 11/11 and contract.test.ts 10/10. Run at `1a555dd`.
