# Handoff: mono-partition (wave 38, M7 groundwork, plan-m6 section 5)

Branch `t3/mono-partitioning-groundwork`, on top of `integ-w38` (ddcf02fe).

## Files

Assigned, ported:
- `src/rustc_middle/mono.ts`: the rest of `compiler/rustc_middle/src/mono.rs`. The brief says `src/rustc_middle/mir/mono.ts`,
  but upstream's file is `rustc_middle/src/mono.rs` and `src/rustc_middle/mono.ts` already existed. What was there is unchanged.
- `src/rustc_monomorphize/partitioning.ts`
- `src/rustc_monomorphize/graph_checks/{mod,statics}.ts`

Not a port:
- `src/rustc_monomorphize/pending_mono_collector.ts`: stand-ins, see "At the merge".
- `src/rustc_monomorphize/partitioning.oracle.test.ts`, and `partitioning_oracle/`: `run.ts` (driver), `common.ts` (cases),
  `regen.ts`, `check_markers.ts`, `upstream/` (`tests/codegen-units/partitioning` at the pin, unedited, taken with
  `git show` because the sparse checkout lacks it), `programs/` (this lane's), `oracle/` (the pinned rustc's output).

Nothing outside this crate imports it, and `rustc_interface` is not wired, so no protected path reaches the new queries.
`mono.ts`'s new imports are the only change on a protected path.

## Coverage

`rustc_monomorphize` is not in `harness/scope.json`, so `scripts/coverage.ts` does not count it. **Root: add it in a harness
batch.** Until then `bun src/rustc_monomorphize/partitioning_oracle/check_markers.ts` checks every upstream `fn` line against
the markers, stale markers and marker order:

| Upstream file | Ported | Missing | Stale | Order inversions |
|---|---|---|---|---|
| `compiler/rustc_monomorphize/src/partitioning.rs` | 20/20 | 0 | 0 | 0 |
| `compiler/rustc_monomorphize/src/graph_checks/mod.rs` | 1/1 | 0 | 0 | 0 |
| `compiler/rustc_monomorphize/src/graph_checks/statics.rs` | 6/6 (3 `rustc-skip`: the `Idx`/`From` impls of a number) | 0 | 0 | 0 |
| `compiler/rustc_middle/src/mono.rs` | 41/41 (`scripts/coverage.ts` agrees) | 0 | 0 | 0 |

`bun scripts/coverage.ts --check` reports nothing for these files.

## Checks run

On this branch alone:
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_monomorphize`: 5 pass, 0 fail, 0 skip. `bun test src/rustc_middle/mir`: 85 pass, 0 fail.
  `bun test src/rustc_symbol_mangling` (the existing user of `mono.ts`): 28 pass, 0 fail.
- `bun scripts/difftest.ts --suite mir --sample 100`: 100 MATCH, 0 DIFF (run 20261104-111459-mono-partition-mh6m).
- `bun scripts/difftest.ts --suite check-ui --sample 100`: 100 MATCH, 0 DIFF (run 20261104-111517-mono-partition-ol0g).
  Both samples ran before the last two edits (`DefIdMap`, `CodegenFnAttrFlags.intersects`), which only touch
  `partitioning.ts`, which no suite loads.

## What was compared with the oracle

**Without the collector, on this branch (5 tests):** `mangle_name` on 7 real names; `shorten_name` cut at an ASCII byte and
inside a two-byte character; a merged name in both forms; `CodegenUnitNameBuilder` on a real `TyCtxt` (crate prefix, stable
crate id, `-in-` for an upstream crate); the driver's stop at the stand-in.

**Everything else waited for mono-collector.** All of `place_mono_items`, `merge_codegen_units`, `internalize_symbols`, linkage,
size estimates, `-Zprint-mono-items`, `-Zdump-mono-stats`, `assert_symbols_are_distinct` and `graph_checks` need real mono
items. These 62 cases are committed and define themselves as soon as `collector.ts` is in the tree. On this branch they do not
run.

I ran them on a **merge rehearsal**: a fresh checkout of be5d0614 at another path, plus lane mono-collector's commit ed4a96a7,
with the edits listed under "At the merge" applied. Not committed anywhere:
- `tsc`: clean.
- This lane's 62 cases: 60 byte-identical to the oracle (exit code, stdout, stderr, dump file); 2 pinned stops
  (`vtable-through-const{,-nonincr}`, exit 70 at `rustc_middle::mir::interpret::Allocation::new (ty/vtable.rs
  vtable_allocation_provider, M4)`, before partitioning).
- Coverage of those cases: 13 upstream programs, incremental and not; 1 to 16 and default CGU counts; opt-levels 0, 1, 2, 3;
  mangled and human-readable names; truncated names; a binary through std; `-Clink-dead-code`; both stats formats.
- Mutations: 17 hand-made changes (swap_remove order, sort ties, overlap tie-break, CGU order on a line, internalization, stable
  vs ipnsort in the stats, the 1800 limit, suffix padding, name sorting, truncation point, and others). 16 were caught.
  The survivor removes the `size_estimate <= max_overlap` break, which cannot change a result (overlap <= size).
- `MonoItem_to_stable_hash_key` from `mono.ts` also ran through mono-collector's own test, which compares against the oracle's
  fingerprints: 49 of 54 pass. The other 5 stop on an earlier assertion before reaching fingerprints (next section).

## For root

**Bug in mono-collector's fixtures, not this lane:** `crate_types`, `hello`, `mixed`, `profile_closures` and
`up-non-generic-closures` fail from any checkout but theirs. Its committed `collector_oracle/oracle/*.txt` holds the absolute path
`.../t3-6bf0445a/...` inside closure names (`{closure@/Users/...}`), and `normalize_stderr` only covers stderr. All 27 differing
lines are identical once that path is normalized. They will fail at integration until that lane normalizes stdout too.

**Stops outside this lane:** `ty/vtable.ts` `vtable_allocation_provider` (above) stops any program with a vtable reaching the
collector.

### At the merge (rehearsed)

1. `partitioning.ts`: replace the `./pending_mono_collector.ts` import with
   `import * as collector from "./collector.ts"; import { type MonoItemCollectionStrategy, type UsageMap } from "./collector.ts";
   import { CouldntDumpMonoStats_diagnostic, SymbolAlreadyDefined_diagnostic } from "./diagnostics.ts";`
2. `graph_checks/mod.ts`: `UsageMap` from `../collector.ts`. `graph_checks/statics.ts`: `UsageMap` from `../collector.ts` and
   `StaticInitializerCyclic_diagnostic` from `../diagnostics.ts`.
3. Delete `pending_mono_collector.ts`, and the `pending` lines in `partitioning_oracle/run.ts`.
4. mono-collector's `lib.ts`: `provide` calls `partitioning.provide(providers)` in place of `collector.provide(providers)`,
   as upstream does.
5. mono-collector's `pending_mono_partition.ts`: delete it and call `mono.ts`. Its names match, except that
   `MonoItem_to_stable_hash_key(item, hcx)` takes no `finish` argument here. `MonoItem.is_instantiable(x, tcx)` is on the companion.

### Stand-ins (`PORT(contract)`), each with upstream's signature

Pending mono-collector, in `pending_mono_collector.ts`:
- `MonoItemCollectionStrategy` (collector.rs:243), `UsageMap` (:259, with `used_map`, `get_user_items`,
  `for_each_inlined_used_item`), `collect_crate_mono_items` (:1916), `collector::provide` (:1961).
- `SymbolAlreadyDefined`, `CouldntDumpMonoStats`, `StaticInitializerCyclic` (diagnostics.rs:41, :49, :212). diagnostics.rs was
  assigned to no lane; mono-collector generated it, with the same names.

Not of that lane:
- `mono.ts`: `#[derive(StableHash)]` of `MonoItem`, `InstanceKind`, `ShimKind`, `ReifyReason`, hand-written in the generator's shape.
  mono-collector wrote the same. **Tools batch:** add them to a set with `derive_stable_hash` and delete these.
- `partitioning.ts` `session_default_visibility`: `Session::default_visibility` (session.rs:908) is unported and `session.ts` is
  not this lane's. **Move it to `session.ts`.**

**Other tools batch items:** `tools/codegen/queries.config.json` types `collect_and_partition_mono_items`, `codegen_unit`,
`symbol_name`, `codegen_fn_attrs` and `reachable_non_generics` as `unknown`, so these call sites cast.

**Not done, by instruction:** `DEFAULT_QUERY_PROVIDERS` does not list `rustc_monomorphize`.

## Could not be checked against the oracle

`-Zprint-mono-items` is the only output before codegen, so nothing shows these until M7:
- `Visibility` results and `default_visibility` (including `-Zdefault-visibility`). `can_be_internalized` shows only through
  `Internal` linkage.
- `CodegenUnit::symbol_name` (`mangle_cgu`), `is_primary`, and `mark_code_coverage_dead_code_cgu` (`-Cinstrument-coverage`).
- `items_in_deterministic_order`, including `-Zcodegen-source-order`.
- `is_codegened_item` and `codegen_unit`: providers ported, nothing calls them. `size_estimate` shows only through merge results.

Other limits:
- `debug_dump` and `list` never run: `debug!` is compiled out of the oracle and is a comment here, so its text has no oracle.
- The `CouldntDumpMonoStats` error path was not exercised.
- **`-C incremental` is a stand-in.** rustc_incremental is out of scope, so the driver sets `sess.opts.incremental` after HIR
  lowering and clears it before `TyCtxt::finish`. The oracle runs real `-C incremental`. Partitioning only reads whether it is
  set, and every incremental case matches, but lowering and expansion do not see the flag in the port's runs.
- **The target is `x86_64-unknown-linux-gnu`, cross-compiled.** The port's aarch64 ABI is unported, and `check_mono_item` needs an
  ABI (same choice as mono-collector).
- **`static_cycle` differs in setup.** Upstream's target is `nvptx64-nvidia-cuda`, which the port lacks, and `--target <file>.json`
  stops at `TargetTuple::from_path`. The oracle takes a target JSON, the driver sets the one field on linux-gnu
  (`RUST_TS_PARTITION_ACYCLIC`), and both print the same. The real nvptx target was not run.

## `unported(...)` left

- `rustc_data_structures::profiling::SelfProfilerRef::artifact_size (-Z self-profile)`, partitioning.ts
- `rustc_middle::dep_graph::dep_node::make_compile_mono_item (incremental)`, mono.ts
- `rustc_middle::dep_graph::dep_node::make_compile_codegen_unit (incremental)`, mono.ts
- `rustc_middle::dep_graph::WorkProductId::from_cgu_name (incremental)`, mono.ts
- `rustc_middle::dep_graph::DepGraph::previous_work_product (incremental)`, mono.ts
- `rustc_monomorphize::collector::collect_crate_mono_items (pending mono-collector)`, the stand-in

## `// PORT:` decisions

- **`to_stable_hash_key` is ported for both types, not `rustc-skip`ped (PORTING section 3 would skip them).** `MonoItem`'s
  fixes the collector's item order, hence CGU interning order, hence the CGU order on a `MONO_ITEM` line. `CodegenUnit`'s is the
  `collect_sorted` key in `place_mono_items`. **This needs root's recorded decision.**
- `Symbol`'s `Ord` is its index, so `-Zprint-mono-items` orders an item's CGUs numerically by symbol. This relies on the interner
  numbering sequentially. The mutation sorting by name is caught.
- `UnordMap`/`UnordSet` are `Map`/`Set`: upstream only iterates them through `collect_sorted` or lookups, so hash order is not
  observable. `FxIndexMap` is a `KeyedMap` with `key_MonoItem` (`intern_key`); `IndexMap::append` is `set` of each entry then
  `clear` (indexmap 2.14.0 map.rs:810).
- `sort_by_key`/`sort_by`/`sort_by_cached_key` are `Array.prototype.sort`: stable, consistent total preorders.
- The one unstable sort with visible ties (`stats`) is std/slice_sort.ts's ipnsort, layout `{ size_of: 48, freeze: true,
  copy: false }`. The other `sort_unstable`s have indistinguishable or unique elements.
- `&str` order is code point order: `str_cmp` from `rustc_session/options.ts` in partitioning.ts. `mono.ts` keeps a private copy
  so that it does not add a session import to a module protected paths load (LOAD ORDER, rustc_session/config.ts).
- `debug!` calls are comments, and `debug_dump` keeps its unused closure. `f64_fixed` handles ties, which `toFixed` rounds up and
  Rust rounds to even; it is unverified, since it only runs in that closure.
- `_prof_timer` guards are `.run(..)` closures. `tcx.prof.enabled()` is `profiler !== undefined`.
- `JSON.stringify` stands for `serde_json::to_writer`: compact, same field order and string escapes.
- `Box<dyn Error>` is its string. `fs` errors go through `io_error_from_node` and `display_IoError`.
- `CodegenUnit`'s fields sharing a method's name carry a trailing `_`. `debug_MonoItemPartitions` is omitted: an `UnordSet`'s
  `Debug` follows hash order.
- `DepNode`, `WorkProduct` and `WorkProductId` are not ported: their functions return `never` and stop at `unported`.
