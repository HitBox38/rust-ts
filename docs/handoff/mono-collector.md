# Handoff: mono-collector (wave 38, M7 groundwork, plan-m6 section 5)

Branch `t3/port-mono-collector`, merged with `integ-w38` at 8641777d. A trial merge (`git merge-tree`) with
`t3/mono-partitioning-groundwork` has no conflicts. Nothing outside `src/rustc_monomorphize/` and this file differs from `integ-w38`.

## Files

Ported: `src/rustc_monomorphize/{lib,util,collector}.ts`, `mono_checks/{mod,abi_check,move_check}.ts`.

Generated: `diagnostics.gen.ts`, re-exported by `diagnostics.ts`. diagnostics.rs was assigned to no lane. Lanes do not edit `tools/`, so this
is the generator's unedited output from a scratch copy of `tools/` holding this entry. **Root: add it to
`tools/codegen/types.sets.json` in a tools batch**; regenerating should then give the same file:

```json
"rustc_monomorphize": { "files": ["compiler/rustc_monomorphize/src/diagnostics.rs"], "class": [], "hand": [], "discriminant": [], "skip": [], "typemap_extra": ["tyir.typemap.json", "mir.typemap.json"] }
```

Stand-ins: `pending_mono_partition.ts`, see "At the merge".

Test only, no production path loads them: `collector.oracle.test.ts` and `collector_oracle/`:
- `run.ts`: the driver. It stops after `analysis`, installs `provide` through `override_queries`, and calls `collect_crate_mono_items`.
- `probe/main.rs`: a rustc-dev probe, built by `regen.ts`. It is not in `tools/probes`, which lanes do not edit.
- `regen.ts`, `common.ts`, `check_markers.ts`.
- `programs/` (30, this lane's; 3 are `tests/ui/codegen/normalization-overflow` with a header added), `upstream/` (30: `tests/codegen-units/item-collection`
  at the pin, unedited, without the 3 `cross-crate-*` tests that need aux crates; the sparse checkout lacks them, so they came from `git show`).
- `oracle/`: the pinned rustc's output.

`rustc_interface` is not wired, by instruction: `DEFAULT_QUERY_PROVIDERS` does not list this crate, so no protected path reaches the new queries.

## Coverage

`bun scripts/coverage.ts --missing` (it counts this crate on this `integ-w38`):

| Upstream file | Ported |
|---|---|
| `lib.rs` | 2/2 |
| `util.rs` | 1/1 |
| `collector.rs` | 42/42 |
| `mono_checks/mod.rs` | 2/2 |
| `mono_checks/abi_check.rs` | 7/7 |
| `mono_checks/move_check.rs` | 9/9 |

The crate reads 63/153 here; the rest is partitioning, graph_checks and offload. `coverage.ts --check` passes. `check_markers.ts` also
verifies each marker's line against upstream and the order: 0 stale, 0 out of order.

## Checks run, on the final commit

- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_monomorphize`: 60 pass, 0 fail, 0 skip. 59 compare in full; `vtable_static` is pinned to its stop (below).
- The same 60 from a fresh checkout at another path: 60 pass. `regen.ts` run there rewrote all 60 fixtures with no byte changed.
- `difftest --suite mir --sample 100`: 100 MATCH, 0 DIFF (20261104-121054-mono-collector-tkb6).
- `difftest --suite check-ui --sample 100`: 100 MATCH, 0 DIFF (20261104-121117-mono-collector-gaej).

## What was compared with the oracle

All programs compile for `x86_64-unknown-linux-gnu`, because `rustc_target::callconv::aarch64::compute_rust_abi_info` is unported and
`check_mono_item` needs an ABI. Each test compares:
- **Contents:** the `-Zprint-mono-items=yes` lines without their ` @@ cgu[linkage]` part.
- **Order and fingerprints:** `-Zprint-mono-items` sorts again by text, so it does not show the collector's order. The probe prints
  `MonoItem::to_stable_hash_key` for every item in a CGU; sorted, that is the order of `into_sorted(hcx, true)`. The test requires
  the port's whole list, fingerprint and text, to equal it line for line, and that the probe saw every item.
- **stderr and exit code**, from real rustc, in `-Zprint-mono-items` runs. This covers post-mono errors and their notes, `RecursionLimit`,
  both ABI errors, the `large_assignments` lint.
- **Walk order, for closures only:** the `-Zprofile-closures` csv is appended in `create_fn_mono_item` call order, the only view of it the oracle
  has. It covers `dump_closure_profile` too; `profile_closures_2018` has differing before and after sizes.

**Fixtures and paths** (root's report from mono-partition's rehearsal): closure names hold the program's absolute path, so 5 fixtures only
matched from the checkout that wrote them. `normalize_path` replaces only that program's path with `$FILE`, in every part of the fixture and of the port's output.
Old and new fixtures were compared: exactly those 5 changed, and by that replacement alone. The former `$DIR` replacement matched nothing and is gone.
`MONO_ITEM` lines keep the oracle's order, which it sorted with the real path in, so the test sorts both sides.

**Mutations:** 27 hand-made bugs: 26 caught, 1 equivalent (the reversed insert in `retain`: a set's contents do not depend on insert order).
All 27 ran from a second checkout at f0fa822e, with 19 caught. For the 7 non-equivalent survivors I added programs and reran those 7; only test programs changed
after that. An earlier run, from before the path fix, was stopped and discarded: those 5 tests would have failed in every mutant.
`panic_nounwind` and `panic_cannot_unwind` are only observable with local `#[inline]` lang items (`no_core_lang_items`): std's are reachable, so
`should_codegen_locally` is false for them. The script was a scratch file and is not committed.

**A wider one-off sweep, not committed:** 343 `tests/ui` programs (all 93 eligible `build-fail`, 250 sampled `build-pass`/`run-pass`; none with aux crates, revisions or
`needs-`/`only-`/`ignore-`). It ran on the port before the `integ-w38` merge; port code has only changed in a comment since.

| Result | Programs | Note |
|---|---|---|
| Items, order and stderr match | 243 | 4,200 items |
| Same errors, same exit code | 52 | |
| Oracle exited other than 0 or 1 | 3 | skipped |
| stderr differs | 23 | rechecked below |
| UNPORTED | 21 | 16 long-type file, 4 `vtable_allocation_provider`, 1 `CodeStats` (`-Zprint-type-sizes`) |
| ICE | 1 | `recursion/issue-83150.rs` |

I reran the 23, the 16 long-type stops and the ICE with `-Zwrite-long-types-to-disk=no` (compiletest passes it), against the probe's stderr, since the probe stops
right after `collect_and_partition_mono_items`:
- 32 of 40 match the probe. The real-rustc differences among them come from after collection: codegen (E0511, SIMD), `report_unused_features`, the symbol-names test, an LTO check.
- 7 are `symbol ... is already defined` (`duplicate/dupe-symbols-*` and one more): `assert_symbols_are_distinct`, in mono-partition's partitioning.
- 1 is `issue-83150.rs`, finding 2 below.

## Findings outside this lane

1. **`vtable_allocation_provider` (`rustc_middle/ty/vtable.ts`) stops**, at `Allocation::new`. A vtable pointer in a const or static reaches it through `collect_alloc`'s
   `GlobalAlloc::VTable` arm (`vtable_static`, 4 sweep programs, 2 of mono-partition's). `Allocation` looks available now, so this may be a small port. Until then that arm is unchecked.
2. **`tests/ui/recursion/issue-83150.rs`:** the `type_length_limit` suggestion prints 7486212072260643778342602134240551239680 where the oracle prints
   18446744073709551607. The value does not fit a `usize`, so `rustc_middle/ty/instance.ts`'s `type_length` looks wrong where upstream's `usize` limits it. I did not diagnose it further.
3. **`rustc_middle::ty::error::TyCtxt::short_string_namespace` stops** for the long-type file. `RecursionLimit` reaches it without `-Zwrite-long-types-to-disk=no`, which is rustc's default,
   and the same path gives the ICE above in that mode.
4. **The tail-call lint is codegen's:** `tail_call_track_caller` comes from `rustc_codegen_ssa/src/mir/block.rs`, so `tail_call.rs` allows it. M7 should drop that allow.

## At the merge

Mono-partition's handoff lists the rehearsed edits. On this side:
1. `lib.ts` `provide`: `partitioning.provide(providers)` in place of `collector.provide(providers)`, plus the import (partitioning.rs:1395 calls the collector's).
2. `collector.ts`: `NormalizationErrorInMono` from `mono.ts`. `MonoItem_is_instantiable(x, tcx)` becomes `MonoItem.is_instantiable(x, tcx)` at its 3 call sites.
3. `collector.ts` (`collect_crate_mono_items`) and `collector_oracle/run.ts`: `MonoItem_to_stable_hash_key(item, hcx)` from `mono.ts`, which has no `finish` argument. `run.ts`: `display_MonoItem` from `mono.ts`.
4. Delete `pending_mono_partition.ts`.
5. `run.ts` could then call `collect_and_partition_mono_items`, which would also compare the CGU part of `MONO_ITEM` lines, already covered by mono-partition's test.

Both lanes hand-wrote the same `#[derive(StableHash)]` for `MonoItem`, `InstanceKind`, `ShimKind`, `ReifyReason`; the merge keeps mono.ts's. A tools batch should generate them.

## Could not be checked against the oracle

- **`usage_map`:** only partitioning reads it, so my test does not check it. Mono-partition's rehearsal ran it through their cases.
- **`target_specific_checks` (graph_checks)** runs between collection and `abort_if_errors` upstream; my driver skips it.
- **Walk order beyond closures:** `collect_items_rec`'s order shows only through the csv, and through which error comes first in stderr.
- **Not reached by any program:**
  - `-Zoffload` paths: `unported`, or never run (`HostMetadata` roots); offload has no lane.
  - `NoOptimizedMir`; the `rustc_force_inline` delayed bug.
  - The thread-local shim (`needs_thread_local_shim` is false on this target).
  - ABI: `AbiRequiredTargetFeature`, `AbiErrorUnsupportedVectorType`, `AbiErrorUnsupportedUnsizedParameter`, the scalable-vector arm, and `codegen_handle_fn_abi_err`.
  - The `GlobalAlloc::VTable` arm (finding 1), and `custom_coerce_unsize_info`'s `bug!`.
- **aarch64:** nothing ran for the host target (above).
- **Cross-crate:** the `cross-crate-*` upstream tests are out because they need aux crates. Upstream items come only from std.

## `unported(...)` left

- `rustc_monomorphize::offload::manifest::read_manifest`, `collect_roots`, under `-Zoffload=Device=<manifest>`
- `rustc_monomorphize::offload::check_offload_kernels_instantiated`, `collect_crate_mono_items`, under `-Zoffload=Device`

Upstream's `write_host_metadata_offload_manifest` re-export is a comment in `lib.ts`.

## `// PORT:` decisions

- **Order:** `UnordSet`/`UnordMap`/`FxIndexMap` of `MonoItem` are `KeyedSet`/`KeyedMap` on `intern_key`. `MonoItems.items` is upstream's index map, insertion-ordered, and `retain` keeps order. The
  `Unord` containers are only read by key, apart from `state.visited`, which is sorted by fingerprint as upstream. No output rests on JS hash-container order.
- **`to_stable_hash_key` is used, not `rustc-skip`ped, though PORTING section 3 skips such impls:** it fixes the collector's order. Mono-partition asks for the same decision. **Root: record it.**
- `Lock` is the value; `par_for_each_in` runs in order with `check_dyn_thread_safe()` unset. The `OnceCell`s around the locks only avoid taking one, so they are gone.
- `debug!`/`trace!`/`#[instrument]`/`debug_assert!` are comments. `_prof_timer` in `collect_crate_mono_items` is a comment too.
- `MonoItems::items()` is `items_()`, since the field holds the name. `IntoIterator` is `into_iter()`, returning an array; `Extend` is `extend`.
- `MirUsedCollector`, `MoveCheckVisitor` extend `Visitor`. `monomorphize<T>` takes its fold descriptor; `move_check.ts`'s is only ever used on `Ty`, so it is not generic.
- Query values typed `unknown` by `queries.gen.ts` are cast at the call site (`codegen_fn_attrs`, `generics_of`, `hir_crate_items`, `impl_trait_header`, `constness`, `asyncness`, `typeck`, `entry_fn`, `items_of_instance`). `EntryFnType` is the stand-in in `rustc_passes/entry.ts`.
- `util.ts`: `OpenOptions` append is `openSync(.., "a")`, and `writeln!` is one `writeSync`.
- **Not a `PORT` note, but a choice:** the 30 `upstream/` tests and the 3 `ui_norm_overflow_*` copies live under `src/`, as other lanes' oracle inputs do.
