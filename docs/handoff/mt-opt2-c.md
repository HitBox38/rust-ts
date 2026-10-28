# Handoff: mt-opt2-c (wave 27, MIR passes at -Zmir-opt-level >= 2, part c)

Branch `lane/mt-opt2-c` (base `fbb8fa9a` on integ-w25, no merges). Commits: `4a4660d1` the four policies (first, as
asked), `cf737030` tail_copy_to_move + match_branches, `517422f0` dest_prop, `0dcc21a5` jump_threading, then this
handoff.

## Files touched
All in `src/rustc_mir_transform/`; each replaces an mt-opt2 stub and keeps the stub's names and shapes.
- `jump_threading.ts`: `JumpThreading`, `TOFinder`, `ConditionIndex`, `Condition`, `Polarity`, `EdgeEffect`,
  `ConditionSet`, `simplify_conditions`, `remove_costly_conditions`, `OpportunitySet`, `maybe_loop_headers`.
- `dest_prop.ts`: `DestinationPropagation`, `apply_merges`, `Merger`, `RelevantLocal(s)`, `Candidates`,
  `FindAssignments`, `is_local_required`, `dest_prop_mir_dump`, `Effect`, `TwoStepIndex`, `save_as_intervals` (+ its
  inner `GenKillIntervalMatrix` and its `GenKill` impl, hoisted after it).
- `match_branches.ts`: `MatchBranchSimplification`, `SimplifyMatch`, `candidate_match`, `simplify_match`, `can_cast`,
  `candidate_assign`, `candidate_const`, `split_first_case`, `identical_stmts`.
- `tail_copy_to_move.ts`: `TailCopyToMove`, `TailState`, `scan_block`, `record_place_locals`, `process_rvalue`,
  `process_operand`.
- `pass_manager.test.ts`: stub-module count 16 -> 12 (this lane's delta: -4). The other mt-opt2 lanes change the same
  line; at integration the count is 16 minus every lane's delta.

## Coverage (`bun scripts/coverage.ts --missing compiler/rustc_mir_transform/src/<f>.rs`)
jump_threading 34/34, dest_prop 21/21, match_branches 15/15, tail_copy_to_move 6/6.
`bun scripts/coverage.ts --check`: markers ok (22424; vendor 4351). `bunx tsc --noEmit -p .`: clean.

## Tests
- `bun test src/rustc_mir_transform`: 77 pass, 0 fail.
- No test pinned the four stubs' stops.

## Runtime stops left (`unported(...)`) and cross-lane dependencies
- **`match_branches.ts` `remove_successors_from_switch`** (local stand-in, stops with
  `rustc_mir_transform::unreachable_prop::remove_successors_from_switch (lane mt-opt2-a)`). unreachable_prop.ts is a
  stub at this base without that fn; mt-opt2-a ports it (`lane/mt-opt2-a`, `export function
  remove_successors_from_switch(tcx, bb, body, patch, is_unreachable_block)`, same signature as the stand-in).
  **Root, at integration:** delete the local stand-in (and its `// PORT:` header lines) and add
  `import { remove_successors_from_switch } from "./unreachable_prop.ts";`. Reached when a `SwitchInt` has exactly one
  reachable target (e.g. `match` arms ending in an inlined `unreachable_unchecked`).
- **jump_threading stops at `value_analysis::Map::new`** (rustc_mir_dataflow value_analysis.ts, stubbed at this base).
  It is called as declared; mt-opt2-b has ported value_analysis.rs (`lane/mt-opt2-b` `59ad08b9`; the stub file names
  mt-opt2-a, but b did it). Nothing to change in jump_threading.ts once that lands.
- Nothing else: every other path is ported.

## `// PORT:` decisions
- jump_threading: `Condition` / `EdgeEffect` are never mutated in place (`retain_mut` / `for_each_mut` store a modified
  copy, `EdgeEffect.replace_block` returns the new value and the caller stores it), so the derived `Clone` of
  `ConditionSet` copies arrays only. `FxIndexSet<Condition>` = `Map<intern_key(condition), index>`; the duplicates map
  is keyed `${bb}:${cond}`; derived `Ord` of `EdgeEffect` = `EdgeEffect_cmp`; `u8` costs use a saturating add and a
  `<= 255` check for `try_into`. `bug!("{term:?} invalid")` prints the `TerminatorKind` Debug (Terminator's derived
  Debug is not ported; unreachable after drop elaboration). `MAX_COST` is a plain const (comment, no marker: the
  marker checker only takes fns).
- dest_prop: `RelevantLocal` / `TwoStepIndex` are `newtype_index!`es (`TwoStepIndex(n)` Debug for the dataflow dump);
  `current + 1` is `from_u32(current + 1)`; `GenKillIntervalMatrix` and its `GenKill` table are hoisted out of
  `save_as_intervals` (placed after it, markers in upstream order); the derived Debug of `RelevantLocals` / `Candidates`
  is only used by `trace!` and is not ported.
- match_branches: derived `PartialEq` of `StatementKind` / `TerminatorKind` (`all_equal`) = `intern_key_eq`
  (precedent known_panics_lint.ts); `Place ==` compares `local` and the interned projection; `i128 as u128` =
  `BigInt.asUintN(128, ..)`; the `remove_successors_from_switch` stand-in above.
- tail_copy_to_move / dest_prop: `*operand = ..` is `replace_in_place`, `*local = ..` writes the `MutRef` (precedent
  copy_prop.ts).

## Oracle verification (`-Zdump-mir`, scratch: `$RUST_TS_DATA/scratch/mt-opt2-c/`, not committed)
mt-opt1 / fix-ubchecks-alias's driver (`cwrap.ts`, `cmp.sh`, `batch.sh`), repointed at this worktree, with:
- the 9 other mt-opt2 passes (GVN, UnreachablePropagation, ReferencePropagation, SROA, DeadStoreElimination, SsaRangeProp,
  DataflowConstProp, EarlyOtherwiseBranch, SimplifyComparisonIntegral) **disabled on both sides** with
  `-Zmir-enable-passes=-...` (`off.txt`), so the oracle runs exactly the pipeline we can run;
- `CWRAP_VA=1`: `Map::new` taken from an untracked copy of mt-opt2-b's value_analysis.ts (scratch only, removed);
- for c10 only, mt-opt2-a's `remove_successors_from_switch` through a temporary, uncommitted edit (reverted);
- `CWRAP_NOOP_INLINE=0` (real inliner), `--target x86_64-unknown-linux-gnu`; `first.sh` rewritten in Python (the zsh one
  is quadratic). "equal" = byte-identical after the allocN normalisation.

| input | flags | dumps compared | equal | bodies changed by the lane's passes |
|---|---|---|---|---|
| c8.rs (new) | default level | 1886 | 1886 | (passes off) |
| c8.rs | level 2 | 2006 | 2006 | JT 2, MBS 5, DP 2 |
| c8.rs | level 2, `-Zmir-move-elimination`, JT off | 2006 | 2006 | TailCopyToMove 7 |
| c9.rs (new) | level 2 | 2429 | 2429 | JT 11, MBS 1, DP 4 |
| c10.rs (new) | level 2, `-Zinline-mir -Zub-checks=no` | 288 | 288 | MBS 3 (single-target switch path) |
| c7 / c8 / c9 | level 2, `-Zinline-mir` | 3640 / 2046 / 2475 | all | c7: DP 2 |
| tests/ui/mir (53 files, `uimir.list`) | level 2 | 149806 (52 files) | 149806 | |

- ui/mir: `issue-75419-validation-impl-trait` hits the known RPIT driver ICE before any pass (as at mt-opt1);
  `validate-various-comparison-behavior`'s oracle-only dumps are the borrowck (`nll`/`polonius`) dumps of the faked
  `mir_borrowck`. No body stopped.
- c7 at level 2 + inliner: `ast` stops at the known `QueryKey for (ValidityRequirement, ..)` (not this lane).

## Sample difftests
(see below)
