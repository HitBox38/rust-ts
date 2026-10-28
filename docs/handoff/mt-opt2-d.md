# Handoff: mt-opt2-d (wave 27, MIR passes at -Zmir-opt-level >= 2, part d)

Branch `lane/mt-opt2-d` (base `fbb8fa9a` on integ-w25, no merges). Commits: `42b6d20f` the three policies (first, as asked),
`e9012fb0` the three pass bodies plus the stub count, then this handoff.

## Files touched
All in `src/rustc_mir_transform/`. Each one replaces an mt-opt2 stub and keeps the stub's names and shapes.
- `ref_prop.ts`: `ReferencePropagation`, `move_to_copy_pointers` (+ `MoveToCopyVisitor`), `propagate_ssa`, `Value`,
  `compute_replacement` (+ `ReplacementFinder`), `fully_replaceable_locals`, `Replacer`.
- `sroa.ts`: `ScalarReplacementOfAggregates`, `escaping_locals` (+ `EscapeVisitor`), `ReplacementMap`
  (`replace_place`, `place_fragments`), `compute_flattening`, `replace_flattened_locals`, `ReplacementVisitor`
  (`expand_var_debug_info` and the `MutVisitor` methods).
- `early_otherwise_branch.ts`: `EarlyOtherwiseBranch`, `OptimizationData`, `evaluate_candidate`, `verify_candidate_branch`.
- `pass_manager.test.ts`: the stub-module count goes from 16 to 13 (−3: these three stub files became ports). The
  parallel lanes mt-opt2-a/b/c change the same line by their own deltas, so root must combine them when merging.

No other file is changed. The scratch runs used a temporary copy of mt-opt2-b's `value_analysis.ts`; it was reverted and
is not committed (see below).

## Coverage (`bun scripts/coverage.ts --missing compiler/rustc_mir_transform/src/<f>.rs`)
ref_prop 14/14, sroa 17/17, early_otherwise_branch 4/4. `bun scripts/coverage.ts --check`: markers ok (22383; vendor
4351). `bunx tsc --noEmit -p .`: clean.

## Tests
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_mir_transform`: **77 pass, 0 fail**. This includes `alias_check.test.ts`.
  Its fixtures run at the default opt level, so none of these three passes runs in it (all three are `optional(level >= 2)`).
  The level-2 alias audit is below.
- No test pinned any of the three stubs' stops.

## Runtime dependency on another lane: `value_analysis.ts` (mt-opt2-a's stub tags, ported by mt-opt2-b in `59ad08b9`)
`ScalarReplacementOfAggregates::run_pass` calls `rustc_mir_dataflow::value_analysis::{excluded_locals, iter_fields}`.
At this base they are stubs. Until mt-opt2-b's port is merged, SROA (level >= 2 only) stops at
`unported("rustc_mir_dataflow::value_analysis::excluded_locals")`. With `59ad08b9` merged, it runs; that is the
configuration the oracle runs below checked.

## Oracle verification (`-Zdump-mir`, scratch, not committed)
Scratch: `$RUST_TS_DATA/scratch/mt-opt2-d/{cwrap.ts,cmp.sh,l2.sh,first.sh,changed.sh,batch.sh,runall.sh,run2.sh,d1.rs,d2.rs,c2..c7.rs,uimir.list}`.
It is fix-ubchecks-alias's driver, repointed at this worktree, with these changes:
- The real ForceInline/Inline run (`CWRAP_NOOP_INLINE` now defaults to off; mt-inline is merged).
- **Stand-ins, in the driver only**: the other mt-opt2 lanes' 10 passes (UnreachablePropagation, DeadStoreElimination,
  GVN, SimplifyComparisonIntegral, SsaRangePropagation, MatchBranchSimplification, DataflowConstProp, JumpThreading,
  DestinationPropagation, TailCopyToMove) get their real upstream policy, and their `run_pass` throws.
- `l2.sh` runs `-Zmir-opt-level=2` with those passes turned off **on both sides**
  (`-Zmir-enable-passes=-UnreachablePropagation,-DeadStoreElimination-initial,-DeadStoreElimination-final,-GVN,-SimplifyComparisonIntegral,-SsaRangePropagation,-MatchBranchSimplification,-JumpThreading,-DestinationPropagation`),
  so the comparison is exact. DataflowConstProp (level >= 3) and TailCopyToMove (`-Zmir-move-elimination`) are off
  anyway.
- **Temporary overlay**: for these runs, the worktree's `src/rustc_mir_dataflow/value_analysis.ts` was mt-opt2-b's
  `59ad08b9` version (`git show 59ad08b9:...`). It was reverted with `git checkout` before the sample difftests and is
  not committed.
- All runs use `--target x86_64-unknown-linux-gnu`. "equal" means byte-identical after the allocN normalisation.
- `changed.sh` counts the bodies whose `<Pass>.before` / `.after` dumps differ below the header line (oracle side).

| input | flags | dumps compared | equal | RefProp / SROA / EOB bodies changed |
|---|---|---|---|---|
| d1.rs (new: 10 ref_prop, 10 sroa, 6 eob fns) | l2 | 2852 | 2852 | 12 / 14 / 2 of 28 |
| d1.rs | l2 + `-Copt-level=3` (lifetime markers on) | 2684 | 2684 | 12 / 15 / 2 |
| d1.rs | default (level 1: the three passes off) | 2684 | 2684 | — |
| d2.rs (new: nested aggregates, unions, consts, closures, fn ptrs, 3-way / nested eob, dangling-pointer ref_prop) | l2 + alias check | 2551 | 2551 | 11 / 13 / 2 of 25 |
| c2.rs / c3.rs / c5.rs / c6.rs / c7.rs | l2 | 2341 / 2949 / 1202 / 1011 / 3570 | all | RefProp 13 / 14 / 1 / 3 / 8 |
| c7.rs | default | 3360 | 3360 | — |
| tests/ui/mir batch (53 files, `uimir.list`) | l2 | 149806 (52 files) | 149806 | 602 / 528 / 0 dump pairs |

- In the tests/ui/mir batch, 1820 bodies ran the whole optimization pipeline. `issue-75419-validation-impl-trait` still
  hits the RPIT driver ICE before any pass (as in mt-opt1 / fix-ubchecks-alias).
- c7 at l2: one body stops at the known `QueryKey for (ValidityRequirement, ty::PseudoCanonicalInput<Ty>)` stop
  (InstSimplify, pre-existing).
- No body stopped in, or after, these three passes.

**Alias audit (level 2, `CWRAP_ALIAS=1`, d1.rs and d2.rs).** The checker runs at every dump point, before and after
every pass, plus over the final bodies together.
- No MIR node is shared in or after ReferencePropagation, SROA or EarlyOtherwiseBranch, and none between the final
  bodies (`CWRAP-XALIAS`: 0 over 31 + 27 bodies).
- The only reports are the known, harmless mir_build `BlockTailInfo` shares in `local_info` at `built.after` (listed in
  fix-ubchecks-alias's handoff).

## Samples (`RUST_TS_AGENT=root-f5de`, lane at `e9012fb0`, overlay reverted)
| suite | run | M / D / U / UNSTABLE | vs base run (w27 brief) | vs fix-ubchecks-alias run (`89fc2a0c`) |
|---|---|---|---|---|
| tydump-minicore | `20261028-161338-root-f5de-6d5m` | 46 / 0 / 0 / 0 | `wos5` 45/0/1: 1 UNPORTED->MATCH | `nvmf` identical |
| mirdump-minicore | `20261028-161353-root-f5de-e7ln` | 46 / 0 / 0 / 0 | `p8q4` 45/0/1: 1 UNPORTED->MATCH | `d82j` identical |
| tydump-ui `--sample 300` | `20261028-161409-root-f5de-ayhn` | 295 / 0 / 3 / 2 | `zjq3`: 34 UNPORTED->MATCH | `0vhl`: no status moves |
| mirdump-ui `--sample 300` | `20261028-161537-root-f5de-lwlf` | 300 / 0 / 0 / 0 | `mzgb`: 31 UNPORTED->MATCH | `kd24` identical |
| borrowck-ui `--sample 300` | `20261028-161713-root-f5de-6ptq` | 286 / 0 / 14 / 0 | `86qn`: 286 UNPORTED->MATCH | `sn2o`: no status moves |

- 0 DIFF, 0 CRASH, 0 TIMEOUT. No MATCH became anything else (`cmpruns.py`, case by case).
- Every case that is not MATCH has the same status as in fix-ubchecks-alias's runs. Those runs were made at
  `89fc2a0c`; this base (`fbb8fa9a`) is that branch merged into integ-w25. The remaining stops:
  - tydump-ui: `hash_result (StableHash of type_of)` ×2 and `IntoDiagArg` ×1;
  - borrowck-ui: polonius ×12, `UnreachablePropagation (pass not ported)` ×1 (mt-opt2-a) and `NonGenericOpaqueTypeParam`
    ×1.
  - No sampled case reaches these three passes' code. The borrowck-ui `-O` cases stop at mt-opt2-a's
    UnreachablePropagation policy, which runs before them.

## Full unit suite
`RUST_TS_REQUIRE_PROBES=1 bun test src` (run once, detached, after the overlay was reverted): **6223 pass, 1 skip, 0 fail**
(6224 tests, 464 files).

## `unported(...)` left
None in the three lane files.

## New runtime stops
- None at the default opt level: all three passes are `optional(mir_opt_level >= 2)`, so their bodies do not run there.
  Their policies no longer stop `optimized_mir`. The first remaining mt-opt2 stub stop at level 1 belongs to another lane
  (UnreachablePropagation's policy, mt-opt2-a), until those lanes merge.
- At level >= 2 (e.g. borrowck-ui cases with `-O`): SROA stops at `value_analysis::excluded_locals` until mt-opt2-b's
  `59ad08b9` is merged. ReferencePropagation and EarlyOtherwiseBranch have no stops.

## PORT decisions (phrased for `bun scripts/state.ts record decision`)
1. (mt-opt2-d) The fn-local structs `MoveToCopyVisitor`, `ReplacementFinder` (ref_prop) and `EscapeVisitor` (sroa) are
   module-level classes extending mir/visit.ts's `Visitor` / `MutVisitor` (field `tcx_`). `ReplacementFinder`'s generic
   `F: FnMut(Place, Location) -> bool` is a closure field. `*operand = ..` and `*place = ..` are `replace_in_place`.
2. (mt-opt2-d) ref_prop: `let mut place = *place` of an rvalue's place is `clone_Place`. The `Replacer` edits body places in
   place, so a target must not alias a body place. `Value::Pointer`'s place is never edited in place, so copying a `Value`
   shares it. `FxHashSet<(Local, Location)>` is a `KeyedSet` keyed `local:block:statement_index`.
3. (mt-opt2-d) sroa: `fragments` is `(([Ty, Local] | undefined)[] | undefined)[]`, and `IndexVec::insert` pads with
   `undefined`. `place_fragments` returns an array. `IndexVec` indexing of `fragments` / `fields` panics out of bounds,
   as upstream does. `body.local_decls.indices()` is the length taken before the loop pushes new locals.
   `Vec::flat_map_in_place` in `expand_var_debug_info` refills the same array in order (no shared
   rustc_data_structures `flat_map_in_place` port exists; rustc_ast/mut_visit.ts has a private copy).
   `std::mem::take(operands)` empties the aggregate's operand array, and the operands move into the new statements.
4. (mt-opt2-d) early_otherwise_branch: `*child_place` and `*source_info` copied out of the body are `clone_Place` /
   `clone_SourceInfo`, and `opt_data.child_place` is cloned again at its use in the new statement. The derived
   `PartialEq` of `Place` / `Operand` is a file-local `place_eq` plus a variant check. `body.basic_blocks.indices()` is
   the block count taken when the loop starts, so blocks added by the loop are not visited, as upstream.

## For root / other lanes
1. **root**: merge mt-opt2-b's `value_analysis.ts` (`59ad08b9`) with or before this lane. SROA needs `excluded_locals` /
   `iter_fields` at level >= 2.
2. **root**: combine the `pass_manager.test.ts` stub count with mt-opt2-a/b/c's deltas (this lane: −3).
3. **mt-opt2-a/b/c**: with all four lanes merged, re-run `$RUST_TS_DATA/scratch/mt-opt2-d/l2.sh <file> <out>` after
   deleting the stand-in block in `cwrap.ts` and the `-Zmir-enable-passes` list in `l2.sh`. That checks the full level-2
   pipeline together.
