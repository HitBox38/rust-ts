# Handoff: collect-rbv (wave 16, M3): rustc_hir_analysis collect/resolve_bound_vars.rs + rustc_middle middle/resolve_bound_vars.rs

Branch `lane/collect-rbv` (from `5171055`, no merges).

## Result
- `resolve_bound_vars`, `named_variable_map`, `is_late_bound_map`, `object_lifetime_default`, `late_bound_vars_map` and
  `opaque_captured_lifetimes` now have real providers (`collect::resolve_bound_vars::provide` is ported; it was a no-op
  stub). So `tcx.named_bound_var`, `tcx.is_late_bound`, `tcx.late_bound_vars` and
  `tcx.map_opaque_lifetime_to_parent_lifetime` (context.ts) work.
- End to end on `#![no_core]` crates (real parse/expand/resolve/lower), the rbv results agree with the pinned rustc
  wherever the oracle shows them (tydump probe: fn_sig binders, opaque generics incl. the DefIds `create_def` makes),
  and two rbv diagnostics are byte-identical to rustc's stderr (see Tests).

## Files touched
- `src/rustc_middle/middle/resolve_bound_vars.ts` (new): middle/resolve_bound_vars.rs 1/1. `ResolvedArg`, `Set1` (+ `insert`),
  `ObjectLifetimeDefault`, `ResolveBoundVars` with Debug / Clone / `default_ResolveBoundVars`, `ResolvedArg_eq`,
  `key_ResolvedArg` (derive(Hash) as a `KeyedMap` key).
- `src/rustc_hir_analysis/collect/resolve_bound_vars.ts`: 68/68 fns (was the contract stub).
- `src/rustc_hir_analysis/decls.ts` (root's contract; see "For root" 1): the three `Pending<..>` aliases are now type-only
  re-exports of the real types.
- `src/rustc_hir_analysis/contract.test.ts` (test 10 only): it pinned the no-op stub (`32` providers,
  `resolve_bound_vars` undefined); now `38` and the 6 rbv providers.
- Tests: `src/rustc_hir_analysis/collect/resolve_bound_vars.test.ts` and `collect/rbv_oracle/` (`run.ts`, 6 cases, fixtures).

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs`: 68/68 ported.
- `--missing compiler/rustc_middle/src/middle/resolve_bound_vars.rs`: 1/1 ported.
- `bun scripts/coverage.ts --check`: markers ok (12330; vendor 3888).

## Tests (`resolve_bound_vars.test.ts`, 10 tests)
- Units: `Set1::insert`; `ResolvedArgExt` (`early`/`late`/`id`/`shifted`) and `ResolvedArg`'s Eq/Hash.
- `rbv_oracle/run.ts` runs the ported driver and, in `after_expansion`, prints `resolve_bound_vars` (defs, late_bound_vars,
  opaque captures) and `is_late_bound_map` of every HIR owner, then `abort_if_errors`.
  - `late_bound.rs` (2021: early/late split, `'b: 'b` / where-clause / output-only lifetimes, nested `for<>` fn pointers
    (DebruijnIndex 1), elided `&dyn Tr` (fresh `'_` + object default), `+ 'static`, `'static`, `Free` in bodies and
    closures, opaque `impl Tr + 'p` (create_def of `{opaque#0}::'p`), HRTB where-clause with concatenated trait ref
    binder, struct / type alias) and `capture_2024.rs` (2024: fully capturing opaques, reversed capture order).
  - Fixture `<case>.rbv.stdout`, values checked by reading upstream, plus an **oracle cross-check** against the
    tydump probe on the same crate: each fn's own `late_bound_vars` = its `fn_sig` binder's `bound_vars`; each opaque's
    captured-lifetime DefIds (in order) = the opaque's `generics_of` own params (same DefId numbers); late-bound
    lifetimes => `has_late_bound_regions: Some`. Negative control: editing one fixture line fails both tests.
  - `err_closure.rs` (ClosureImplicitHrtb) and `err_nlb.rs` (`late-bound type parameter not allowed on function pointer
    types`): subject stderr == the pinned rustc's (`--emit=metadata`) stderr, byte for byte, exit 1.
  - `err_anon.rs` (E0658 anonymous lifetime in `impl Trait`) stops UNPORTED at `asyncness provider (not ported)`;
    `err_precise.rs` (`use<'static>`) stops UNPORTED at `..::precise_captures::BadPreciseCapture`. Their oracle stderr is
    kept as fixtures for when those land.
- Limits of what can run today: rbv calls `generics_of` (lane collect-a) for every path with generic args whose
  `eligible_container` is a trait / ADT / alias, for the `Root { opt_parent_item }` of trait / impl items and for
  RPITIT capture. So the cases are free items without such paths; E0657 / LateBoundInApit cases need `Tr<'a, Assoc = ..>`
  and wait for collect-a.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see "Test run".
- Fresh-process loads: `rustc_middle/middle/resolve_bound_vars.ts`, `rustc_hir_analysis/collect/resolve_bound_vars.ts`,
  `rustc_hir_analysis/lib.ts`, `rustc_interface/passes.ts`.
- Samples: see "Samples".

## `unported(...)` left
- `rustc_hir_analysis::diagnostics::precise_captures::BadPreciseCapture` and `..::PreciseCaptureSelfAlias`
  (visit_precise_capturing_arg): diagnostics/precise_captures.rs is in no codegen set (see "For root" 4).
- `debug_ResolveBoundVars`'s `opaque_captured_lifetimes` field: `unported_debug` (a `LocalDefIdMap` prints in hash
  order; the generator emits the same). Reached only by `{:?}` of the whole struct (tracing).
- Not mine, reached through rbv: `asyncness provider (not ported)` (resolve_lifetime_ref's APIT feature-error path);
  `generics_of` (collect-a).

## PORT decisions (please record)
1. **Types hand-written in the generator's shape.** middle/resolve_bound_vars.rs: a scratch `tools/codegen/types.ts`
   run on a set holding only that file (reverted, nothing in tools/ changed) gave the exact shape; its 3 unknown types
   (`DebruijnIndex`, `ItemLocalId`, `BoundVariableKind`) are imported from their ports. collect/resolve_bound_vars.rs's
   private types (`Scope`, `BinderScopeType`, `NonLifetimeBinderAllowed`, `OpaqueHigherRankedLifetimeCaptureErrors`,
   `SegIdx`, `RevSegIdx`) are hand-written (the typedefs probe cannot parse the `gen` block).
2. **`ResolvedArgExt`** (`#[extension]` trait) is a companion object of functions; `Set1::insert(&mut self)` takes a
   `{ value }` wrapper (PORTING §8 MutRef) and the `PartialEq` as `eq_T`.
3. **`Scope`** is a `$`-tagged union whose `s` is the parent object; `Scope::Opaque.captures`
   (`&RefCell<FxIndexMap<ResolvedArg, LocalDefId>>`) is a shared `KeyedMap` keyed by `key_ResolvedArg`;
   `IndexMap::reverse` is rebuild-in-place.
4. **`BoundVarContext`** extends intravisit's `Visitor` with `NestedFilter = OnlyBodies`; `with` builds a new context
   over the same `rbv` / `disambiguators` objects, moving `opaque_capture_errors` in and out like the `RefCell::take`.
   The second `impl BoundVarContext` block (after `object_lifetime_default`) is prototype assignments in upstream
   order; `supertrait_hrtb_vars` (no `self`) is a static. `for_each_trait_bound_on_res`'s `gen move` block is a
   generator (lazy, consumed with `next()` as upstream).
5. The nested items of `is_late_bound_map` (`ConstrainedCollectorPostHirTyLowering` as a `TypeVisitor`,
   `ConstrainedCollector`, `AllCollector`) are module-level classes; `FindInferInClosureWithBinder` stays a local class
   in `span_of_infer`.
6. Query values typed `unknown` in queries.gen.ts (`fn_sig`, `type_of`, `generics_of`, `object_lifetime_default`,
   `explicit_supertraits_containing_assoc_item`, `associated_items`, `resolve_bound_vars`) are cast at the use site.
7. `SortedMap::get_mut_or_insert_default` is not in sorted_map.ts: inlined (get, else insert `[]`).
8. `Vec<BoundVariableKind>` / `AssocItem` `!=` (try_append_return_type_notation_params) compare by value via
   `intern_key`; `LifetimeKind`'s derived `PartialEq` is a local helper.

## For root
1. **decls.ts** (`PORT(decls): pending root`): `ResolvedArg` / `ObjectLifetimeDefault` / `ResolveBoundVars` are
   `import type` + `export type` from rustc_middle/middle/resolve_bound_vars.ts instead of `Pending<..>` (a type alias
   cannot be augmented, and the real fns do not type-check against the brands). Please adopt.
2. **contract.test.ts test 10** now expects 38 providers and the 6 rbv ones (it pinned the stub).
3. **Typemap** (tools/codegen): map `rustc_middle::middle::resolve_bound_vars::{ResolvedArg, ObjectLifetimeDefault,
   ResolveBoundVars}` to `src/rustc_middle/middle/resolve_bound_vars.ts` and regenerate queries.gen.ts, so the 6 query
   values stop being `unknown` (then the casts in `provide` and context.ts's local `PendingEnum` `ResolvedArg` alias can
   go). Optionally add middle/resolve_bound_vars.rs to a codegen set (the shape is already the generator's).
4. **Codegen set rustc_hir_analysis**: add `diagnostics/precise_captures.rs` (6 plain `#[derive(Diagnostic)]`s); then
   the two `unported(..)` above become `emit_err(..)` calls.
5. **rustc_middle/lib.ts**: add `export * as resolve_bound_vars from "./middle/resolve_bound_vars.ts";` (not mine).
6. **rmeta**: cstore_impl.ts decodes `object_lifetime_default` with `decode_unported("ObjectLifetimeDefault")`; it needs
   the derived `Decodable` (extern `object_lifetime_default` stops UNPORTED until then).
7. rbv needs `generics_of` (collect-a) for most real code; after collect-a merges, the generic-path / trait / impl cases
   (E0657, LateBoundInApit, CannotCaptureLateBound) are worth adding to rbv_oracle.

## Samples (`RUST_TS_AGENT=collect-rbv`)
- `hir-tree-nocore --sample 150`: 149 MATCH / 0 DIFF / 1 UNPORTED / 0 CRASH (run `20261014-124004-collect-rbv-p7g8`).
  The UNPORTED is `tests/ui/delegation/impl-reuse-pass.rs` at `rustc_hir_analysis::collect::fn_sig` (pre-existing,
  collect-a's; not protected).
- `tydump-nocore --sample 100`: 5 MATCH / 95 UNPORTED, all at `rust_ts::tydump::prefix::run_required_analyses_prefix`
  (the tydump subject is a stub until check_crate lands; unprotected suite) (run `20261014-124036-collect-rbv-qe91`).
- No suite reaches rbv through the normal pipeline yet (it is first asked by check_crate / collect), so the
  rbv_oracle tests above are the end-to-end evidence.

## Test run
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4508 pass, 1 skip (pre-existing linux-only),
  0 fail (4509 tests, 272 files, 1393 s), including resolve_bound_vars.test.ts 10/10 and contract.test.ts 10/10.
