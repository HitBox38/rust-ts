# Handoff: res-macros (wave 10, M2: rustc_resolve macros.rs + effective_visibilities.rs)

Branch `lane/res-macros`, from main bb96986. There are no merges.

## Pin facts that differ from the brief
- At the pin, `resolve_macro_path` and `define_macro` are not in macros.rs:
  - `define_macro` is in build_reduced_graph.rs (lane res-graph).
  - The macros.rs equivalents of `resolve_macro_path` are `resolve_derive_macro_path` and `resolve_macro_or_delegation_path`.
- The ResolverExpand impl also has `has_derive_ord`, `macro_accessible`, `append_stripped_cfg_item`, `register_glob_delegation`, `glob_delegation_suffixes` and `insert_impl_trait_name`. All of them are ported.

## Files
- `src/rustc_resolve/macros.ts`: all of macros.rs. res-lib's four ports are kept.
- `src/rustc_resolve/effective_visibilities.ts`: all of effective_visibilities.rs.
- `src/rustc_index/bit_set.ts` (new): a subset of bit_set.rs, enough for `unused_macro_rules`.
  - It contains `DenseBitSet` (`new_empty`, `new_filled`, `clear_excess_bits`, `domain_size`, `count`, `contains`, `is_empty`, `insert`, `remove`, `iter`) and `BitIter`, plus the private helpers.
  - `Word` is a `bigint`.
- `src/rustc_index/bit_set/tests.test.ts`: the three upstream DenseBitSet tests whose API is ported.
- Tests:
  - `src/rustc_resolve/macros.test.ts`
  - `src/rustc_resolve/macros_oracle.test.ts`
  - `src/rustc_resolve/macros_oracle/`, which holds:
    - `gen.ts`: the oracle generator;
    - `expected.json`;
    - `with_resolver.ts`: test driver;
    - `cases/*.rs`: 10 cases;
    - `unit/paths.rs`.
- **Outside my files** (root please review):
  - `decls.ts`, one fix: `compile_macro`'s `attrs` is `readonly HirAttribute[]` (`rustc_attr_ir::Attribute`, as upstream). It was the rustc_ast `Attribute`. I added a type import.
  - `lib.ts`, one change: the `DenseBitSet` stand-in (it said "owner: the macros lane") is now `export { DenseBitSet } from "../rustc_index/bit_set.ts"`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok (6212; vendor 2403).
- `--missing` results:
  - macros.rs: 40/40.
  - effective_visibilities.rs: 16/16.
  - bit_set.rs: partial. Only the DenseBitSet subset is ported, which is intended.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3048 pass, 1 skip, 14 fail.
  - All 14 failures are in `rustc_driver_impl/driver.oracle.test.ts` and `rustc_session/output.oracle.test.ts`. Both expect the stale PENDING `Resolver::arenas (pending res-lib)`.
  - These failures already exist at the branch base bb96986, and main 9c56091 fixed them. Those two files pass on main (99/99).
  - Every rustc_resolve test passes: 32/32.
  - Note: run the tests with `.env.local` exported. `bun test` does not load it, and the resolver_new freshness test then reports the probe as missing.
- Sample difftests:
  - `RUST_TS_AGENT=res-macros difftest --suite parse --sample 200`: 200/200 MATCH (run `20261013-124427-res-macros-39bu`).
  - `--suite unpretty-expanded-nocore --sample 50`: 1 MATCH, 49 UNPORTED, 0 DIFF (run `20261013-124434-res-macros-20d8`). Every UNPORTED case stops at `rustc_lint::late::unerased_lint_store`, which belongs to lint-early-a.

## Tests
- **macros.test.ts** (in-process, on the real `Resolver` right after `Resolver::new`). It has 5 tests:
  - `sub_namespace_match`: the full truth table, which is upstream's definition written out.
  - `fast_print_path`: the paths `a`, `a::b`, `::c::d`, `crate::e`, `self::f::g` and `super::h` give exactly the oracle's `-Zunpretty=expanded,hygiene` expansion descriptions.
  - `register_builtin_macro`: `rustc_builtin_macros::register_builtin_macros(resolver)` gives bm-a's oracle registry (names, kinds, order). A second registration is an ICE.
  - `compile_macro` + `record_macro_rule_usage` + `check_unused_macros`, on `cases/macro_rules_basic.rs`:
    - The test sets up the state that `define_macro` and macro resolution would leave.
    - The lint buffer equals the resdump oracle's `lint_buffer`: lint names and spans; the NodeIds are not compared.
    - Negative control: dropping the `swap_remove` makes this test fail.
  - Bookkeeping methods: derive markers, `take_derive_resolutions`, impl-Trait names, glob delegations, `registered_*_tools`.
- **macros_oracle.test.ts** (end to end, subprocess, exactly as the suites run it):
  - Each case runs in two modes:
    - `resdump`: `src/rust_ts/resdump.ts` against the resdump probe;
    - `expanded`: `src/rust_ts/main.ts -Zunpretty=expanded` against the oracle rustc.
  - The 10 cases:
    - `macro_rules_basic`, `macro_rules_scopes`;
    - `derive_unresolved`, `builtin_macros` (`#[rustc_builtin_macro]`, `cfg_accessible`, an unknown builtin);
    - `tool_attrs` (rustfmt / clippy / `#![register_tool]` / unknown tool);
    - `macro_errors` (reserved `rustc` attributes, unresolved macros);
    - `effective_vis`, `out_of_scope` (`OUT_OF_SCOPE_MACRO_CALLS`);
    - `expand_positions` and `expand_errors`. These two are expand-core's mock-resolver scenarios rewritten with real `macro_rules`.
  - **All 20 runs are PENDING.** Each must still stop at `rustc_lint::late::unerased_lint_store (pending lint-early-a)` with exit 70.
    - After lint-early-a lands, update `PENDING` to the next stop for each run. Expected next stops: `def_collector::collect_definitions` (res-graph), then ident/imports.
    - The `resdump` runs also need `rust_ts::resdump::dump`, which is unported in src/rust_ts/resdump.ts.
  - A freshness test re-runs the oracle and probe and requires expected.json to be current.
  - To regenerate: `bun src/rustc_resolve/macros_oracle/gen.ts`.
- **Not reachable yet:** none of `effective_visibilities`, `resolve_macro_invocation`, `resolve_derives`, `finalize_macro_resolutions` or `path_accessible` can run in-process. They need build_reduced_graph, def_collector, ident and imports. The e2e cases cover them once those land.

## `unported(...)` left (own files)
- `stability_report_unstable` and `stability_early_report_macro_deprecation` in macros.ts.
  - These are `rustc_middle::middle::stability::{report_unstable, early_report_macro_deprecation}`; middle/stability.rs has no owner.
  - They are reached only for macros with `#[unstable]` that are not allowed, or with `#[deprecated]`.
- Everything else goes through other lanes' stubs (`collect_definitions`, `expect_module`, `resolve_ident_in_scope_set`, `maybe_resolve_path`, `resolve_path`, `report_error`, `unresolved_macro_suggestions`, `CStore`).

## PORT decisions (please record)
1. The `ResolverExpand` delegations `next_node_id` (:173) and `resolve_imports` (:255) carry their markers on comments and are not assigned. This follows res-lib's contract.
2. `ParentScope` is `Copy`, so copies are made with `clone_ParentScope` (shallow) wherever Rust copies (`*parent_scope`, `ParentScope { x, ..p }`). `EffectiveVisibility` copies (`*eff_vis`, `.copied()`) use a local `copy_EffectiveVisibility`.
3. `IndexMap::swap_remove` on `unused_macros` / `unused_macro_rules` uses rustc_errors' `index_map_swap_remove`, so FxIndexMap order is kept.
4. `mem::take(&mut self.derive_data)` / `builtin_attrs` swap in an empty Map/array. `CmRefCell::take` gets `() => []`.
5. `macro_reachable` (`FxHashSet<(LocalDefId, LocalDefId)>`) is a `KeyedSet` with a `"a:b"` key. `exported_ambiguities` (`FxHashSet<Decl>`) is an identity `Set`: its only use is `contains` (imports.rs:1048), so hash order is never observable.
6. `index_map` (HashMap `Index`) is a private copy in both files. lib.ts's copy is not exported.
7. `DenseBitSet`: `Word = u64` becomes `bigint`. `BitIter`'s degenerate `usize::MAX - (WORD_BITS-1)` offset becomes `-WORD_BITS`, which gives the same offsets after wrapping.
8. `compile_declarative_macro` is imported from `rustc_expand/mbe/macro_rules.ts`, because rustc_expand/lib.ts does not re-export it yet (see its PORT(pending mbe-b) note).

## For root
1. Review the decls.ts and lib.ts one-liners above.
2. Optional cleanups:
   - add `compile_declarative_macro` to rustc_expand/lib.ts's re-export;
   - export lib.ts's `index_map`;
   - move `index_map_swap_remove` to src/rust_ts.
3. After lint-early-a, res-graph, res-ident and res-imports integrate, update `PENDING` in macros_oracle.test.ts. Then write `rust_ts::resdump::dump`.
4. Delete `docs/claims/wave10-res-macros.md` on integration.
