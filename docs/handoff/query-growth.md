# Handoff: query-growth (M3, wave 15, plan-m3 D12): query engine growth, dep graph stays off

Branch `lane/query-growth` (from main `ab2cdfc`, no merges). Commits: engine pieces (with_task/with_anon_task, typeck
wrappers, `with_no_queries`, feed_hir); cycle handlers + driver cycle oracle tests + limits repoint; QueryKey impls +
regenerated queries; `hir_ty_param_name` desc; engine tests; this handoff.

## What D12 / the brief asked for, and where it stands
- **Cycle detection and cycle errors.** Already present from tyctxt-min (single-threaded `find_cycle_in_stack`,
  `create_cycle_error`, `Cycle` / `NestedCycle`, `handle_cycle` nesting). This lane:
  - ported the rest of `handle_cycle_error.rs` (11/11): the custom handlers `fn_sig`, `check_representability`,
    `check_representability_adt_ty`, `check_representability_inner`, `variances_of`, `search_for_cycle_permutation`,
    `layout_of`, `recursive_type_error` (E0072), `find_item_ty_spans`. `CUSTOM` now dispatches to them (it was a table
    of `unported`).
  - `TaggedQueryKey::description` now runs under the real `ty::print::with_no_queries!`, and descriptions print paths
    with the real `def_path_str` (ty-print landed); the engine test's `def_path_str` stub is gone.
  - **`cycle_delay_bug` / `cycle_stash` / `cycle_fatal` do not exist at the pin.** rustc replaced them by the single
    `handle_cycle_error` modifier (rustc_middle/src/query/modifiers.rs) whose queries get a handler at
    `rustc_query_impl::handle_cycle_error::$name`; all others use `default` (emit + `raise_fatal`). Both paths are ported.
- **Byte-exact E0391 / E0072 through the driver** (`src/rustc_query_impl/cycle.oracle.test.ts`, 12 tests): the ported
  driver (real parse/expand/resolve/AST lowering, real HIR accessors) with stand-in providers for the analysis queries
  the cycle goes through (`check_well_formed`, `type_of`, `explicit_implied_clauses_of`, `check_representability`;
  `cycle_oracle/run.ts` header explains how each mirrors upstream's nested calls and spans). stderr + exit code equal
  the pinned rustc on: type-alias cycles of 1/2/3 frames ("immediately requires", "...which requires", "completing
  the cycle", alias note/helps, "cycle used when"), the same with `-Zverbose-internals` (`[\"type_of\"]`), a trait
  alias cycle, and E0072 on 1/2/3/6-item struct cycles (incl. "and 1 more"), enum-variant fields, tuple/array fields,
  and a field behind a type alias (whole-field label). Fixtures `cycle_oracle/*.stderr` are re-checked against the
  oracle on every run (`REGEN=1` rewrites them).
- **`ensure_ok` / `ensure_result` / `ensure_done`**: already ported (calls.rs 12/12, query_api.ts); checked against
  upstream; new test for `ensure_result` (Ok / Err / cached). `TyCtxt::typeck` and `TyCtxtEnsureOk::typeck` now call
  `typeck_root(typeck_root_def_id(..).expect_local())` (they stop at ty-util's `typeck_root_def_id` stub until it lands).
- **`TyCtxtAt` / span-carrying calls**: already ported (`tcx.at(span).q(..)`, `Deref` as `.deref()`); exercised by
  the cycle tests (spans of `B`, of the bound path, ...).
- **Feeding**: `TyCtxtFeed::feed_hir` (synthetic owners: `OwnerNodes::synthetic()`, empty maps, empty
  `DelayedLints`, `AttributeMap::EMPTY`) is ported and tested; `feed_anon_const_type` was already in context.ts.
  `Steal` and arena-cached values were already done (arenas are identities).
- **Query keys** (keys.rs 23/63 → 42/63): `QueryKey` impls for the type-system keys whose TS types exist:
  `(Ty, Option<ExistentialTraitRef>)`, `SimplifiedType`, `(DefId, Ident)`, `(LocalDefId, LocalDefId, Ident)`,
  `(CrateNum, SimplifiedType)` (with `as_local_key`), `(DefId, SizedTraitKind)`, `GenericArgsRef`,
  `(DefId, GenericArgsRef)`, `TraitRef`, `GenericArg`, `Ty`, `(Ty, Ty)`, `Clauses`, `AliasTyKind`, `&OsStr`, and
  `def_id_of_type(_cached)`. Unported key impls in queries.gen.ts: 44 → 30 (the rest need `Instance`, `ShimKind`,
  `GlobalId`, `PseudoCanonicalInput`, canonical goals, `ty::Value`, `LitToConstInput`, ...).
- **Dep graph**: `DepGraph::with_task` (graph.rs:330) and `DepGraph::with_anon_task` (:346) ported; with the
  disabled graph both are exactly upstream's `None => (op(), self.next_virtual_depnode_index())`; the `Some(data)`
  arms stop UNPORTED (D3).
  - `WithDepNode` is **not** ported here: it lives in `rustc_middle/src/traits/cache.rs` (lane middle-traits-thir).
    With the disabled graph it is a plain pair (`get` = `read_index` no-op + clone), so `mk_tracked` / `get_tracked`
    can call it once that lane lands.

## Files touched
- `src/rustc_query_impl/handle_cycle_error.ts` (rewritten: full file).
- `src/rustc_middle/query/keys.ts`, `src/rustc_middle/query/calls.ts`, `src/rustc_middle/query/query_api.ts`,
  `src/rustc_middle/dep_graph/graph.ts`.
- `src/rustc_middle/ty/context.ts`: `TyCtxtFeed::feed_hir` only (+ `middle_hir()` lazy require, 2 imports).
- `src/rustc_interface/limits.ts` (**outside the engine; please review**): the `hir_krate_attrs` stand-in (merge-w14
  root item) is replaced by the real `tcx.hir_krate_attrs()`. `recursive_type_error` calls `def_path_str` outside
  `with_no_queries`, so the printer reads `type_length_limit` → `limits`. Sample runs below are unchanged.
- **Codegen config (please review; root/codegen owns it)**: `tools/codegen/queries.config.json` `keys` (+14 key impls)
  and `methods` (+`hir_ty_param_name: Symbol`); regenerated `src/rustc_middle/queries.gen.ts` (`--check` clean).
- Tests: `src/rustc_middle/query/engine.test.ts` (real `def_path_str`; new: `variances_of` handler, `KEY_Ty`
  default_span / hash, `(DefId, Ident)` hash, `ensure_result`, `feed_hir`), new `src/rustc_query_impl/cycle.oracle.test.ts`
  + `src/rustc_query_impl/cycle_oracle/` (run.ts, 11 `.rs` cases, 12 `.stderr` fixtures).

## Coverage (`bun scripts/coverage.ts --missing`)
| upstream file | before | after |
|---|---|---|
| rustc_query_impl handle_cycle_error.rs | 2/11 | 11/11 |
| rustc_middle query/keys.rs | 23/63 | 42/63 |
| rustc_middle dep_graph/graph.rs | 10/62 | 12/62 (disabled graph only, D3) |
| rustc_middle query/calls.rs, query_api.rs, job.rs, caches.rs, ... | complete | complete |
| rustc_middle ty/context.rs | 202/202 | 202/202 (`feed_hir` body now real) |
| rustc_query_impl execution.rs / job.rs | 15/22, 10/16 | unchanged: the rest is incremental or parallel-only |

`--check`: markers ok (11082; vendor 3888).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4308 pass, 1 skip (pre-existing linux-only), 1 fail:
  `std/fmt.test.ts` "format_debug of a deep chain is linear" (a timing test; it ran while difftest samples loaded
  the machine; 3/3 green when re-run alone, file untouched by this lane).
- `bun tools/codegen/queries.ts --check`: up to date (unported desc 62 → 61, unported key impls 44 → 30).
- `RUST_TS_AGENT=query-growth` samples: expanded 100/100 MATCH (`20261014-071349-query-growth-2ouu`),
  hir-tree-nocore 100/100 MATCH (`20261014-071418-query-growth-x98d`), hir-tree 99 MATCH / 1 UNPORTED
  (`20261014-071449-query-growth-qchq`; `delegation/self-ty-ice-156388.rs` stops at `TyCtxt::is_method`, the known
  merge-w15a stop).
- Every touched module loads as a fresh entry point (`keys.ts`, `queries.gen.ts`, `query_api.ts`, `context.ts`, ...).

## Query descriptions (`desc`) still unported: 61 of 329
36 read a field of a key whose type is pending (`.value` of `PseudoCanonicalInput`, `.canonical`), 8 call a method on
a non-`tcx` receiver (`.to_def_id()`, `.def_id()`, `.self_ty()`: the generator does not translate these), 8 `Display`
of a type (5 × `Ty`, 3 × `Instance`), 6 `Debug` of a type (`SimplifiedType`, `GenericArgsRef` ×2, `AliasTyKind`,
`Clauses`, `Predicate`), plus `analysis` (path `LOCAL_CRATE`), `vtable_allocation` (closure expression) and
`resolve_instance_raw` (call of a path). **For root:** the 5 `Display of Ty` ones (and the `Ty`-typed keys/values
generally) are blocked by `tools/codegen/typemap.lint.json`, which maps `rustc_middle::ty::Ty` (and `Clause`,
`PolyFnSig`, ...) to `unknown` "pending"; the queries generator only loads `typemap*.json`, so `tyir.typemap.json`'s
real `Ty` entry is not seen. With that entry fixed, add `"rustc_middle::ty::Ty": { "ts": "display_Ty($v)", "imports":
{ "src/rustc_middle/ty/print/pretty.ts": ["display_Ty"] } }` to `display` (tried: it loads fine; it only fails tsc
because the key type is `unknown`).

## `unported(...)` / stand-ins left
- graph.ts: `DepGraphData::with_task`, `DepGraphData::with_anon_task_inner` (the `Some(data)` arms; D3).
- handle_cycle_error.ts reaches other lanes' stubs: `Ty::new_error` (ty-sty) in `fn_sig`; `Ty::ty_adt_def` (ty-sty) in
  `check_representability_inner`; local stand-ins (not markers) `AdtDef_did` (ty/adt.rs, ty-adt-assoc) and
  `PseudoCanonicalInput_value` (ty/mod.rs, ty-mod) — repoint when those land. `layout_of`'s handler is unreachable
  until `PseudoCanonicalInput` has a `QueryKey` impl.
- keys.ts: `AdtDef_did` stand-in (same as above) in `def_id_of_type_cached`; `principal_def_id` is a predicate.ts stub
  (ty-args). `debug_Ty` / `debug_GenericArg` / `debug_Clause` are stubs (structural_impls), so these keys' Debug (only
  used by ICE messages) stops UNPORTED until then.
- calls.ts: `typeck` goes through ty-util's `typeck_root_def_id` stub.
- Not ported (unreachable): parallel-only `job.rs` (`find_cycle`, `break_query_cycle`, ...), `latch_wait_on`,
  `wait_for_query`; incremental paths of execution.rs / incremental.rs / self_profile.rs (D3).

## PORT decisions (please record)
1. `TaggedQueryKey::description` reaches `ty::print::with_no_queries` through a lazy `require` of ty/print/pretty.ts
   (an extension module of `TyCtxt`), as ty-ctxt decision 5 (`middle_lint()`); `feed_hir` reaches hir/mod.ts's
   `ProjectedOwnerInfo` the same way (`middle_hir()`).
2. `DepKind` (dep_node.rs, not ported) is its variant name as a string in `with_anon_task`'s signature; the disabled
   graph never reads it. `with_task`'s `DepNode` is `undefined` (as `with_feed_task`).
3. `hash_key` of interned / composite type-system keys is `intern_key(k)` (the derived `Hash`+`Eq`; interned children
   by id, unique per process). `Ident` keys hash `name` + `span.ctxt()` (its manual `Hash`/`PartialEq`).
   `&OsStr` keys are JS strings with `debug_str` as Debug.
4. The CUSTOM handler table erases each handler's key type at the `$crate::handle_cycle_error::$name` call (the
   generated decls still type those keys `unknown`).
5. Driver-level cycle tests use stand-in providers that replay upstream's nested query calls with the same spans
   (cycle_oracle/run.ts); `check_representability_adt_ty(Ty)` is skipped in the stand-in (no effect on reports for
   non-generic ADTs; documented there).

## For root
- `src/rustc_middle/ty/context/impl_interner.ts` `with_cached_task` (ty-ctxt's file) can now be upstream's body:
  `return this.dep_graph.with_anon_task(this, "TraitSelect", task);` (DepKind::TraitSelect).
- Review `src/rustc_interface/limits.ts` (stand-in repointed), `tools/codegen/queries.config.json`, and the
  typemap.lint.json `Ty` shadowing described above.
- `src/rustc_middle/ty/print/pretty_oracle/run.ts` mentions limits.ts's `hir_krate_attrs` stand-in; that workaround
  can go now.
