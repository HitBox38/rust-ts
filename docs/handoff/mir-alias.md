# Handoff: mir-alias (M7 preflight; review fixers-39 F1, and the rest of its class)

Branch `t3/fix-mir-place-aliasing`, on `integ-w39`. The head commit is in the final report. Nothing here changes a baseline, a
suite or a script.

## Is the class exhausted?

**No, and I can't show that it is.** What I can say:

- **Sharing visible at a pass boundary:** on everything the sweep ran, no mutable MIR node is left shared. That is 8,603 runs and
  7.7M walks on the code just before the last fixes, then 1,847 runs on the final code with no hits (see "Sweep results"). This part I
  trust for the paths it ran.
- **Paths it did not run:** those rest on reading the code, and that reading is incomplete (see "What is not covered"). The
  largest gaps are the shims behind vtables, which the collector cannot reach yet, and `rustc_mir_build`, where I did not read the
  static candidates.
- **A second clue that the class was larger than reported:** the review called `map_unwind` and F1 "isolated misses". This lane
  found four more, in shims and in `clone_Body`. The old checker could not see any of them, because it never ran on shims or checked
  clones. Expect more when new paths open, such as vtables, `-Zdump-mir` graphviz, or M7's codegen reading MIR. Rerun the sweep then.

## Hits and outcomes

| # | Where | Shared value | Wrong output? | Fix | Test |
|---|---|---|---|---|---|
| 1 | `match_branches.ts`, `unify_if_equal_const`, `unify_by_eq_op`, `unify_by_int_to_int`, `unify_by_copy` | `dest`, `copy_src_place` | **Yes.** ICE at `-O`, and silently wrong: `_9 = Eq(..)` where the oracle has `_10`, exit 0 | 5 `clone_Place` | `oracle_programs.rs` |
| 2 | `clone_Body` (generated), through `rustc_borrowck/lib.ts:366` | each `CanonicalUserTypeAnnotation` | **Yes, only in dumps.** With `-Zdump-mir -Zverbose-internals`, `CleanupPostBorrowck.before` prints `inferred_ty: &'?6 i32` where the oracle prints `&'{erased} i32`: borrowck's region variables leaked into the input body | `clone_Body_with_annotations` (`mir/mod.ts`) | `oracle_programs.rs` |
| 3 | Same clone, `coroutine/by_move_body.ts:246`, `lib.ts:697` (const fn in `mir_for_ctfe`) | same | No: nothing there writes to the annotations. By-move found by the sweep, const fn by reading | same helper | none of its own |
| 4 | `shim.ts:1215`, `build_fn_ptr_addr_shim` | `raw_ptr` | No | `clone_Place` | `shims.rs` |
| 5 | `shim/async_destructor_ctor.ts:416,433`, `build_adrop_for_adrop_shim` | `cor_ref_place`, `cor_pin_place` | No | `clone_Place` | `shims.rs` |
| 6 | `promote_consts.ts:1178` | `BorrowKind` | No: nothing writes to it | `clone_BorrowKind` | none: inspection and the sweep |

**Why 4 and 5 can't show:** none of `make_shim`'s passes renames a local, and `Inline` goes through `clone_Body`, which separates the
values. Only the checker sees them. I fixed them because `Place` is `Copy` upstream, and any later in-place edit would hit them.

**Each fix reverted alone fails its test:** items 1, 2, 4, and both sites of 5. For item 1, reverting makes `oracle_programs.rs` ICE;
the silent `wrong` program alone gives `_9` against `_10`, also checked with the fix reverted.

**Fixed at the call site, not at the cause (item 2):** see "For root".

## The checker

It already existed from wave 26 (`alias_check_oracle/`, lane fix-ubchecks-alias), so I extended it rather than add a second one. Not
loaded by production paths: only `driver.ts`, `run.ts` and the test import it.

| File | What it does |
|---|---|
| `alias_check.ts` | The walker and the table of what counts as immutable |
| `hooks.ts` | Replaces `MirDumper::new` / `dump_mir` and wraps `MirPatch::apply`, for that one process |
| `driver.ts` | The real driver with the hooks, so one run gives both hits and real `-Zunpretty=mir`. `RUST_TS_ALIAS_MONO=1` runs the collector instead, which is what reaches shims |
| `sweep.ts` | Runs a directory or recorded crates through modes, against the oracle |

**The gaps that hid these bugs:** the old filter named the mutable types, so a type nobody listed could not be reported. It also ran
only without `-O`, never reached shims, and checked other bodies only at the end.

**Three kinds of hit:**

- `ALIAS`: reachable twice in one body. Checked before and after each pass, at phase changes, and after each `MirPatch::apply`, so a
  share a pass removes again is still seen.
- `CROSS`: still held by another body. Every object remembers its last owner. On a collision the old owner is walked again, because
  promotion moves objects and a body that gave one away is not a share.
- `CLONE`: `clone_Body(body)` still holds an object of `body`. Checked at phase changes.

**How interned or frozen values are told apart.** Everything counts as mutable unless the table says otherwise:

- **Frozen objects:** not walked, as writing to one throws. `Object.isFrozen` is shallow, so the `PlaceElem`s in a projection list are
  not frozen. I read the writers: `process_projection_elem` builds new elements, and the one `field_mut(elem, "_1")`, in
  `super_var_debug_info`, only reaches SROA's own fresh fragments, after the only `visit_ty` overrides that write have run.
- **Unit variants:** not walked, as they have no field to write.
- **`IMMUTABLE`:** value classes such as `DefId`, `Size`, `ScalarInt`.
- **`IMMUTABLE_POSITIONS`:** `Copy` payloads at named positions, each with its reason. The type and both paths must match, because
  the same position can hold something mutable (`.msg._0` is also an `Operand`). This rests on reading every `_0`/`_1`/`_2` write and
  every `field_mut` in `rustc_mir_transform` and `rustc_middle/mir`.

Upstream genuinely shares only the `&'tcx` slices of `InlineAsm` (`template`, `line_spans`) and `BasicBlocks.cache` (an `Arc`). The
other rows are values upstream copies; sharing them here is harmless only because nothing writes to them.

## Sweep results

Run from a snapshot of the code with the shim and borrowck fixes, in scratch directories. The upstream checkout was not touched by
these runs (see "Incidents").

| Input | Programs | Modes | Runs | Oracle exit 0 | Result |
|---|---|---|---|---|---|
| `tests/mir-opt` (400 of 408) | 400 | o0 o2 o3 o4 dbg abort inl miropt all mono dump | 4,400 | 3,680 | No divergence |
| `tests/ui/async-await`, passing | 166 | o0 o3 dbg mono dump | 830 | 664 | No divergence |
| `tests/ui/coroutine`, passing | 61 | same | 305 | 244 | No divergence |
| `tests/ui`, passing, sample | 300 | o0 o2 o3 o4 dbg abort inl all mono dump | 3,000 | 2,626 | 4 TIMEOUT, below |
| ripgrep, `x86_64-linux`, cargo's release flags | 34 | mir mono | 68 | 34 | 34/34 byte-identical |

- **Modes:** `dbg` is `-Copt-level=3 -Zmir-opt-level=4 -Cdebuginfo=2`. `abort` is `-Copt-level=2 -Cpanic=abort`. `inl` is `-Copt-level=3`
  with inline thresholds 2000 and 4000. `miropt` is compiletest's mir-opt flags with the test's own `test-mir-pass`. `all` enables every
  pass except `InstrumentCoverage`, which ICEs on the oracle too without its flag. `dump` byte-compares every pass's dump.
- **Hits left after these runs:** only the two below, both handled.
- **`CROSS {$: Mut}`:** item 6. Those runs predate its fix.
- **`CROSS` on `user_type_annotations[]`:** item 3. Those runs predate its fix.
- **Recheck on the exact final code: 0 distinct hits in 1,847 runs.** `tests/mir-opt` at o3, dbg, mono (1,200 runs, no divergence, 3 stops
  on `dump_dataflow.rs`); 100 other `tests/ui` programs at o0, o3, mono, dump (400 runs, 1 stop); `async-closures` (85),
  `closures/2229_closure_analysis` (159) and a const-fn program (3).

**Not divergences:**

| What | Why |
|---|---|
| `building/custom/unwind_action.rs`, `precise_liveness.rs` at `-Cpanic=abort` | Both sides ICE in validation (exit 101), with different wording. Now the `BOTH_ICE` outcome. I did not compare the two ICE texts |
| `dump_dataflow.rs` (12 runs), `graphviz.rs`, `inline/exponential_runtime.rs` at `dump` | Named stops on graphviz, from each test's own flags |
| `print_type_sizes/uninhabited.rs`, `future-sizes/*` | Named stop, `CodeStats` |
| `issue-54582.rs`, `log`, `rg` at `mono` | Named stop, `Allocation::new` in `vtable_allocation_provider`: plan-m7's O3 |

**One open performance item, not aliasing:** `tests/ui/match/match-stack-overflow-72933-.rs` timed out at o4, dbg, all and dump at 180 s
under the checker. Rerun alone with plain `main.ts` at `-Zmir-opt-level=4`, it had used over 52 CPU minutes when I stopped it, with no
result. The oracle takes 8 s of CPU. At o0, o2, o3, abort and inl it MATCHes, so a pass at level 4 is very slow on a 5,209-line match.
It matters if a `-Zmir-opt-level=4` suite includes this file. I did not find which pass.

## By inspection

A type-aware scan (scratch, TS6's API from the bun cache, so not committed) listed every store of an existing mutable MIR object, including
through helpers' parameters and calls that return an inner object: 768 candidates. I read the ones in `rustc_mir_transform` and
`rustc_middle/mir`. It found items 4 and 5 before the sweep confirmed them.

**The brief's list, by reading plus the sweep:**

| Pass | Result |
|---|---|
| `remove_dead_blocks`, `simplify`, `SimplifyLocals` | Move or swap only; `successors_mut` writes through a `MutRef` |
| `gvn` | `try_as_place` and `try_as_operand` build new values. Its tables hold no `Place` |
| `jump_threading` | Reads places before its apply step; duplicated blocks are `clone_BasicBlockData` |
| `copy_prop`, `dest_prop` | Local numbers only |
| `ref_prop` | `targets` holds a clone and is never edited; rewrites build new places (`project_deeper`) |
| `elaborate_drops`, `elaborate_drop` | `this.place` is cloned at every store; `yield_value` is cloned for the first of its two uses |
| `coroutine` | `resume_arg` is cloned before `replace_base` edits it; moved terminators replace their holder |

**The other shape: a pass holding a `Place` while a visitor edits it in place.** No walk at a pass boundary can see this. I read the
writers (`.local =`, `.projection =`, `replace_in_place`, `field_mut`) and found no case. The `dump` mode checks for its effect by
comparing every pass's MIR with the oracle, with regions visible. It reports the annotation leak when that fix is reverted, and otherwise
found no difference: 920 of 927 programs MATCH, and the other 7 are 6 named stops and the 1 timeout.

## What is not covered

- **Paths no program ran.** A share only shows if the store runs. `F1` needed an or-pattern arm, for example.
- **Shims behind vtables.** `Allocation::new` stops the collector on `dyn` programs, so `VTableShim`, `Virtual` and vtable-reached glue
  barely ran. `shim.ts` was read, not exercised, for those.
- **`rustc_mir_build`.** About 180 static candidates not read. It relies on the walker at `built.after` on the programs above.
- **`check_*` passes.** Relied on wave 26's audit plus the sweep, not re-read in full.
- **Tests with `revisions`, `aux-build` or proc macros.** The sweep skips them, and `--passing` skips anything that should fail.
- **Mutation inside one pass, between two patches.** `MirPatch::apply` is the only mid-pass hook.
- **Codegen.** No M7 path exists yet; check that it does not edit `instance_mir`'s results in place.
- **`clone_*` other than `clone_Body`.** Only what `clone_Body` reaches is checked, and only at phase changes.
- **Windows,** per `AGENTS.md` §5.

## For root

1. **`tools/codegen` (outside this lane):** generate `clone_CanonicalUserTypeAnnotation`, and clone `user_type_annotations` deeply in
   `clone_Body`, where it now emits `[...v.user_type_annotations]`. Then remove `clone_Body_with_annotations` and the
   `.user_type_annotations[N]` exemption in `hooks.ts` `check_clone`.
2. **Stray files in the upstream checkout:** a difftest of mine printed `ERROR: the upstream checkout is not clean` for
   `rustc-ice-2026-11-05T03_03_40-5497.txt` and `..._41-5508.txt`, written at 05:03 local by an oracle ICE (`rustc_ty_utils/src/abi.rs:556`)
   with its cwd there. They are not from this lane: my runs set `RUSTC_ICE=0` and use scratch cwds. I did not delete them, and a later
   status check showed the checkout clean, so someone else did. Any gate that started between 05:03 and then would carry the note.
3. **`match-stack-overflow-72933-.rs`:** the performance item above.

## Rerunning the sweep

Not a unit test: the mir-opt pass alone took about 45 minutes at 4 jobs on the shared host. Run it from a clean copy, or edits mix results.

```sh
git -C "$RUST_TS_DATA/rust" archive <pin> tests/mir-opt | tar x -C <scratch>     # until harness-m7a's sparse addition lands
bun src/rustc_mir_transform/alias_check_oracle/sweep.ts --tests <scratch>/tests/mir-opt \
  --modes o0,o2,o3,o4,dbg,abort,inl,miropt,all,mono,dump --jobs 4 --timeout 180000 --name <name>
bun src/rustc_mir_transform/alias_check_oracle/sweep.ts --tests "$RUST_TS_DATA/rust/tests/ui" --passing --sample 300 \
  --modes o0,o2,o3,o4,dbg,abort,inl,all,mono,dump --jobs 4 --name <name2>       # RUST_TS_AGENT changes the sample
```

Results: `$RUST_TS_DATA/tmp/mir-alias/<name>/summary.txt` (outcomes, then each distinct hit) and `runs.jsonl`. **Any line under
`distinct hits` is either a bug or a missing table row with a reason: read the write sites before adding a row.**

**Real crates:** use a private copy of the source and `CARGO_HOME`, not `$RUST_TS_DATA/ripgrep`, which harness-m7a uses. Build with
`--target x86_64-unknown-linux-gnu` (host `aarch64` calling conventions are unported) and a `RUSTC_WRAPPER` that appends one
`{"cwd","args","env"}` line per crate, keeping the `CARGO*` and `OUT_DIR` variables. Keep only target crates, then run `--argv-file <jsonl>
--modes mir,mono --jobs 2 --timeout 1500000`. The final `rg` link fails without a linker, after its argv is recorded.

## Unit time

Plan-m7 F5's budget is 5 s of CPU per lane. The two new oracle tests measure 4.26 s user + 0.79 s system under load (about 5 s), counted from
`bun test` start, so that includes startup and the sysroot probe. The four new walker tests are pure and take milliseconds.

## Checks

Final tree, `RUST_TS_REQUIRE_PROBES=1`:

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `bun scripts/coverage.ts --check --offline` | markers ok; `match_branches` 15/15, `shim` 38/38 |
| `bun test src/rustc_mir_transform` | 87 pass, 0 fail |
| `mir --sample 200` | 200/200 |
| `mirdump-ui --sample 200` | 199 MATCH, 1 UNSTABLE, listed |
| `run-pass-miri --sample 200` | 200/200 |
| `borrowck-ui --sample 200` (borrowck's clone changed) | 200/200 |

## Unported and `// PORT:`

No new `unported(...)`. New `// PORT:` notes: `match_branches.ts` (`dest`'s copy) and `clone_Body_with_annotations` (the generator gap).

## Incidents

- **A `pkill` of mine went too wide.** A stray `cat` in one of my scripts blocked on stdin, and I ran `pkill -f cat -x` under this user rather
  than stopping my own task. It matched every process whose whole command line was `cat`, so another lane's bare `cat` early in this
  lane's run would have died too. I saw no sign of it, but can't rule it out. If a lane saw a pipeline fail around then, that may be why.
- **Worktree symlink:** this worktree has a gitignored `node_modules` symlink to the main checkout's, which `tsc` needs.
