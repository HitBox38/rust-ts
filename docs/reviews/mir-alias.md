# Independent review: mir-alias

Branch `t3/fix-mir-place-aliasing`, head `d060b78e`. The lane's own commits are `98846877`, `2b9ea72d`, `2833c58e` and `d060b78e`, on top of the merge
`99ca137f`. Code read-only: every revert, plant and instrumented run was in a throwaway worktree, since removed. Upstream checkout left clean. No gate or
full suite run.

- **On the lane head:** reverts, plants, difftest samples, unit tests, `tsc`, markers.
- **On lane + `integ-w39` tip (`706d437b`, merges without conflict):** every sweep, because the lane's merge is too old for `dyn` programs (F5).

## Verdict: APPROVE WITH NITS

**All the fixes are right.** Each clone is where upstream copies a `Copy` value, and nothing in the port depended on the sharing they remove. In 1,987 sweep
runs of my own, the checker reported **no hits and no divergence from the oracle**, including `dyn` programs, revisions, aux crates and programs I wrote for
each uncovered shape. All samples are clean; the two non-MATCH cases are not this lane's (item 7).

**The checker does what it says, with limits M7 should know about.** It reports every shared `Place`, `Operand`, plain list and `UnwindAction` with a field
that I planted. It is blind to five narrow things, none of which exists in a real body today (F2). Every exemption in the table held under a test that makes
those values throw on write.

**One handoff claim is wrong.** "Each fix reverted alone fails its test: items 1, ..." holds for only one of item 1's five clones (F1).

| # | Severity | Where | Finding |
|---|---|---|---|
| F1 | **medium, test gap only** | `alias_check.test.ts:188-222`, `alias_check_oracle/oracle_programs.rs`; handoff "Each fix reverted alone" | Four of the five `match_branches` clones can be reverted with all tests green. 11 lines close three of them, plus 3a and 6 (F3) |
| F2 | low, checker | `alias_check.ts:28,106,118-122,127,130` | Map keys, Set members, children of frozen objects, any field named `cache`, and symbol or non-enumerable props are not walked. All planted, none reported |
| F3 | low, test gap | `coroutine/by_move_body.ts:246`, `promote_consts.ts:1179` | Items 3a and 6 have no test, and should: a four-line addition fails on each revert. `lib.ts:697` cannot have one: it is a no-op |
| F4 | low, sweep tool | `sweep.ts:237,245` | `mono` counts exit 1 as `CHECKED`, and `BOTH_ICE` compares nothing |
| F5 | nit, for root | handoff "What is not covered" | The vtable gap is stale once merged: this branch lacks `7c5030f1`. Rerun on the merge: no stop, no hit |
| N1 | nit, wording | `shims.rs:3`, `alias_check.test.ts:224`, handoff item 4 | `build_fn_ptr_addr_shim` does not exist: it is `build_fn_ptr_as_ptr_shim` (`shim.rs:1083`) |
| N2 | nit, footgun | `hooks.ts:79`, `mir/mod.gen.ts:449` | Plain `clone_Body` stays exported, and the `CLONE` check exempts its annotations. `CROSS` still catches a misuse. The handoff's generator fix removes both |

Not blocking. F1 and F3 should land before an M7 lane leans on `-O`; it is one small edit.

## 1. The fixes against upstream

| Fix | Upstream | Result |
|---|---|---|
| `match_branches.ts:122,179,245,341` (5 clones) | `dest` and `copy_src_place` are `Place: Copy`, stored at `match_branches.rs:73,143,210,311-312` | Correct and complete: those are all the sites. The other stores in the file already copy (`clone_ConstOperand`, `clone_StatementKind`, `clone_Operand(discr)`) |
| `clone_Body_with_annotations` at `rustc_borrowck/lib.ts:366-367` | `input_body.clone()`, `borrowck/lib.rs:335`; `super_user_type_annotation` writes `inferred_ty` (`visit.rs:982`) | Correct. `{...annotation}` loses nothing, as `CanonicalUserTypeAnnotation` is an interface. `user_ty` stays shared, and nothing writes it |
| `by_move_body.ts:246` | `body.clone()` on `mir_built`, `by_move_body.rs:214` | Correct and needed: annotations exist at that point |
| `lib.ts:697` | `body.borrow().clone()`, `lib.rs:520` | Correct but a **no-op**: the body is past `CleanupPostBorrowck` (`cleanup_post_borrowck.ts:73`), so the list is empty |
| `shim.ts:1215` | `raw_ptr` is `Copy`, in `build_fn_ptr_as_ptr_shim`, `shim.rs:1083` | Correct. Function name wrong in the docs (N1) |
| `async_destructor_ctor.ts:417,434` | `Copy` places | Correct, and those are the only double uses in that function. The brief's 416, 433 are the lines before the lane's added import |
| `promote_consts.ts:1179` | `*borrow_kind`, `Copy` | Correct |

**Identity.** Nothing depends on these objects being the same object:
- No `Map` or `Set` is keyed by `Place` object in the path (`rustc_borrowck/lib.ts:501` and `ssa_range_prop.ts` key by value).
- Nothing compares `=== BorrowKind.*`.
- Interned `RawList`s and `Ty`s are not cloned by any of this.

**Remaining plain `clone_Body` callers before cleanup:** `liveness.ts:217` only rewrites terminators, and `rust_ts/mirdump.ts:65` only prints. Both are
harmless (N2).

**Cost.** Instrumented on the `mir-core` run: 45,346 clones, 12,214 annotations. The annotation copy took **32 ms** and `clone_Body` itself 2.76 s, out of
679 s. I did not run `rmeta-core`; it runs the same analysis pipeline, so I expect the same order, which is negligible.

**Can a protected result change?** Not through this.
- No suite passes `-Zverbose-internals` or `-Zdump-mir` (`harness/suites.ts`, `scripts/lib`).
- No `tests/ui` file has `-Zdump-mir` in its flags. 52 have `-Zverbose-internals`, but annotations are empty by the time `-Zunpretty=mir` prints.
- `mirdump-*` never runs borrowck, and `mir-opt-o4` (on `t3/m7-harness-ir-suites`) writes dumps without comparing them.
- `scripts/phase-diff.ts` does read these dumps. It is not a suite, and it gets more accurate.

The old `'?6` could only make a case fail, so the fix can only add passes.

## 2. The checker

**Plants,** each made in `MatchBranchSimplification::run_pass` through the real driver at `-Copt-level=3`:

| Planted | Reported? | Comment |
|---|---|---|
| `Place`, `Operand`, `Rvalue`, `Statement` shared | **yes** | |
| Plain array as projection list | **yes** | |
| Interned `RawList` as projection list, or one element in two lists | no | Correct: `&'tcx List` upstream, and `process_projection_elem` builds new elements |
| `UnwindAction::Cleanup`, `::Terminate` | **yes** | |
| `UnwindAction::Continue`, or a unit `TerminatorKind` | no | Correct: no field to write, and no code writes `.$` in `rustc_mir_transform` or `rustc_middle/mir` |
| Shared `args` array or `statements` array | **yes** | The array itself, not only its elements |
| Value in a `Map` | **yes** | |
| Typed array, class nobody listed | **yes** | |
| Share through `MirPatch::apply`, removed before the pass ends | **yes** | At `.apply` |
| One `Place` held by two bodies | **yes** | `CROSS` |
| Map key, Set member, frozen wrapper or array, `{cache: place}`, symbol prop, non-enumerable prop | **no** | F2 |
| Stored and removed within a pass, with no patch | **no** | The known gap, below |

`clone_Body` made shallow on `local_decls`, or sharing `var_debug_info`: reported as `CLONE` at `built.clone`. All six phase names in `PHASES` match what
really runs.

**The table.** I read every row against the writers, then tested it: a scratch driver deep-froze each exempt value once walked (unit variants, the
`IMMUTABLE` classes, every `IMMUTABLE_POSITIONS` path, `RawList` elements), so any later write throws. **Nothing threw in 1,987 runs.** A control confirmed
that writes do throw in each category that ran. The categories reached include `.const_._0`, `.source.instance`, `inlined[N]`, `.local_info._0._0`, `user_ty`, cast
payloads, `InlineAsm`'s `template` and `line_spans`, `.operands[N].reg`, `coroutine_kind`, `DefId` and `HirId`. Only the `InlineAsm` slices and
`BasicBlocks.cache` are truly shared upstream; the handoff says so and it is correct. The freeze shows these rows are safe on what ran, not on every path.

**Reach.** A census walked what the checker cannot see, on the same runs: **no `Map`, `Set`, hidden prop, accessor, frozen holder of a mutable child, or other
`cache` field in any real body.** The only typed array is `storage_conflicts.words`, which the walker does see. So F2 is not hiding anything today.

**Mutation inside a pass.** A boundary walk cannot see two shapes:
- a share stored and removed within one pass, with no `MirPatch::apply` between;
- a pass holding a `Place` while a visitor edits it.

To size the first, I added walks after every `MutVisitor::visit_body` and `visit_body_preserves_cfg` (24 files define a visitor) on 440 runs: **no hits.** That leaves
about 20 pass files with neither a patch nor a visitor, which edit directly. For the second I read a sample of the 20 in-place writers (`.local =`,
`.projection =`, `replace_in_place`), including `ref_prop.ts:297` (a clone, as the handoff says), `gvn.ts:1139,2321` and `deref_separator.ts:101`. I found no case.
Only `dump` mode can show its effect, and it compares text. So this is a real but narrow gap. Six lines in `hooks.ts` would give the extra walks permanently; I suggest it but do not require it.

**Production paths.** Clean. Only `driver.ts`, `run.ts`, `sweep.ts` and `alias_check.test.ts` import this directory. The test imports only the pure `alias_check.ts`, and spawns `run.ts` and `driver.ts`. Nothing in
`src/rust_ts`, `scripts` or `harness` refers to it, so the replaced `MirDumper::new` and `MirPatch::apply` cannot reach the real driver.

### F2: what the walker skips

The header says "everything counts as mutable unless this file says why". These are exceptions it does not state or justify:

- `alias_check.ts:122`: `if (v instanceof Set) continue;` skips members.
- `alias_check.ts:119`: Map values are walked, keys are not.
- `alias_check.ts:106`: a frozen object's children are skipped, even if they are not frozen.
- `alias_check.ts:130`: `SKIP_FIELDS` matches `cache` on any object, not only `BasicBlocks`.
- `alias_check.ts:127`: `Object.keys` omits symbol and non-enumerable props.

**Failing scenario.** An M7 lane adds a `Set<Place>` or a `cache` field holding a `Place` to a body or a `CoroutineInfo`, sharing the statement's object. A
rename edits both, and the checker says nothing.

**Fix.** About five lines: walk Set members and Map keys, test `v instanceof BasicBlocks` (or the path) for `cache`, and report frozen non-interned objects
with an unfrozen child. Plants are in the table above.

## 3. Sweeps against the oracle

Each run also byte-compares `-Zunpretty=mir`, except `mono`.

| Input | Programs | Modes | Runs | Result |
|---|---|---|---|---|
| `tests/mir-opt`, sample | 80 | o2 o3 o4 mono | 320 | All match. 28 exit 1 on both sides |
| `tests/ui`, passing, sample | 100 | o2 o3 o4 mono | 400 | All match. 8 exit 1 on both sides |
| `dyn` directories of `tests/ui`, passing | 154 | mono o3 | 308 | All match, no stop |
| `tests/ui` with `revisions`, one revision each | 59 | o2 o3 o4 mono | 236 | All match. 12 exit 1 on both sides |
| `tests/mir-opt` with `revisions` | 5 | o2 o3 o4 mono | 20 | All match. 12 exit 1 on both sides |
| `tests/ui` with `aux-build` (crates built by the oracle) | 60 | o2 o3 o4 mono | 240 | All match, all exit 0 |
| My programs (`dyn` shims; MIR-building shapes; `match_branches` sites) | 3 | o0 o2 o3 o4 dbg abort inl all mono dump | 40 | All match. 10 runs were a first `build_shapes` that did not compile, exit 1 on both sides; redone after fixing it |
| `tests/mir-opt`, `tests/ui`, other samples, with in-pass walks | 140 | o3 o4 dbg | 420 | All match, 9 of them exit 1 on both sides. 3 named stops, `-Z llvm-target-feature` |
| `issue-54582.rs`, `log`, `rg` | 3 | mono | 3 | Finish, no hit |

**Total: 1,987 runs, 1.47M walks, 0 hits, 0 DIFF, 0 ICE.** 1,905 exit 0 on the port.

**Vtables: is this branch recent enough?** No. Its merge `99ca137f` lacks `7c5030f1` (`vtable_allocation_provider`). `git merge integ-w39` is clean and the lane's
`alias_check.test.ts` passes there (12/12). On that merge, all three programs the lane recorded as stopped at `Allocation::new` now finish, with no hit. So do
the `VTable` and other shims: `VTable`, `FnPtr`, `FnPtrAsPtr`, `Reify`, `Clone`, `ClosureOnce`, `DropGlue`, `ConstructCoroutineInClosure`, `AsyncDropGlue` and `FutureDropPoll` all ran. Not
reached: `FnPtrFromPtr` and `ThreadLocal`.

**`rustc_mir_build`'s 180 candidates.** They are nearly all a false alarm, and the handoff could say why: `CFG::push` and `CFG::terminate` (`cfg.ts:80,127`) deep-copy
every statement and terminator. For example, `build_drop_and_replace` (`scope.ts:1592-1596`) passes one `place` three times, and a real run gives no hit. That leaves
`local_decls`, `var_debug_info`, `source_scopes` and `builder/custom`, which the walker checks at `built.after`. I sampled about 20 sites and wrote
`build_shapes` for the rest: or-patterns with guards, slices, deref patterns, let-else, let chains, labelled breaks, drop flags, FRU, overloaded index assign, annotated
lets, raw borrows, unions, closures, inline asm, `become`, const blocks, `try`.

## 4. Regression tests

Each fix reverted alone, running `alias_check.test.ts -t 'fixed aliasing'`:

| Revert | Test | Reverted, does the walker see it? |
|---|---|---|
| 1, `unify_by_eq_op` dest | **fails** | |
| 1, `unify_if_equal_const` dest | **passes** | Yes, on `bar` in `matches_reduce_branches.rs`, at that test's `test-mir-pass` flags only |
| 1, `unify_by_int_to_int` dest | **passes** | Yes, at `-O` |
| 1, `unify_by_copy` dest | **passes** | Yes, at `-O` |
| 1, `unify_by_copy` src | **passes** | Yes, at `-O` |
| 2, borrowck | **fails** | |
| 3a, `by_move_body.ts:246` | passes | Yes, `CROSS` |
| 3b, `lib.ts:697` | passes | No: a no-op |
| 4, `raw_ptr` | **fails** | |
| 5, `cor_ref_place`, `cor_pin_place` | **both fail** | |
| 6, `promote_consts.ts:1179` | passes | Yes, `CROSS` |

**Expected values** all come from the oracle at test time (`_10 = Eq`, `inferred_ty: &'{erased} i32`, whole outputs). The shim test's expected value is "no hits", which is right.

### F1 and F3: the fix

Add this to `shims.rs`, which already runs through the driver with `hits == []`. Tried in a throwaway tree: the test stays green, and it **fails on each of `unify_by_int_to_int`, both `unify_by_copy`, 3a and 6 when reverted**:

```rust
#[repr(u8)]
pub enum EnumAu8 { U0 = 0, U127 = 127, U128 = 128, U255 = 255 }
pub fn match_u8_i8(i: EnumAu8) -> i8 {
    match i { EnumAu8::U0 => 0, EnumAu8::U127 => 127, EnumAu8::U128 => -128, EnumAu8::U255 => -1 }
}
pub fn match_option(i: &Option<i32>) -> Option<i32> {
    match i { Some(_) => *i, None => None }
}
pub fn promoted_mut() -> &'static mut [u8] { &mut [] }
pub fn by_move<'a>(y: &'a i32) -> impl AsyncFn() + 'a { async move || { let z: &'a i32 = y; let _ = z; } }
```

**Failing scenario today.** A refactor of `unify_by_int_to_int` drops the clone. Every test is green, and the walker would see it only when someone reruns the sweep. I did not find a program where these
four sites give wrong output when reverted, but the same shape at `unify_by_eq_op` gave `_9` where the oracle has `_10`.

`unify_if_equal_const` stays uncovered: at `-O`, `identical_stmts` takes that case first. It needs a separate run at `-Zmir-opt-level=0 -Zmir-enable-passes=+MatchBranchSimplification`, about 3.4 s of CPU, which would break the budget (below). I would leave it to the sweep.
`lib.ts:697` cannot have a test.

## 5. `match-stack-overflow-72933-.rs`

**Slow on every size I could finish; for the full file I can't rule out a hang.** I cut the match down and ran it at `-Zmir-opt-level=4` on the lane head. Up to 3,000 arms every size finished, and its output is byte-identical to the oracle. The full file did not finish in 40 minutes, against about 26 s wall for the oracle under the same load. The curve makes that plausible for a slow pass, since time keeps growing faster than the arm count, so I read it as slow, not hung, but I did not prove it:

| Arms | `DataflowConstProp` | Blocks | Whole run |
|---|---|---|---|
| 125 | 0.3 s | 751 | 5 s |
| 250 | 0.8 s | 1,501 | 6 s |
| 500 | 2.2 s | 3,001 | 9 s |
| 1,000 | 7.3 s | 6,001 | 17 s |
| 2,000 | 41.8 s | 12,001 | 64 s |
| 3,000 | 236 s | 18,001 | 247 s |
| 5,199 (the file) | not finished | 31,195 | stopped by me at 40 minutes, still in this pass |

**The pass is `DataflowConstProp`.** Everything before it takes about 30 s on the full file. It has no block limit at level 4 (`dataflow_const_prop.ts:135`, as upstream). A CPU profile at 1,000 arms puts 56% of self
time in `StateData`'s `clone_from` and `clone` (`value_analysis.ts:132-143`): a per-entry `Map` copy for each of N blocks, where upstream's `FxHashMap` of `Copy` values can copy in bulk. The algorithm is upstream's;
the constant is not. The growth steepens (time ×5.7 for 2,000 to 3,000 arms, where 1,000 to 2,000 gave ×5.7 for double the size), which looks like the garbage collector: the full file reached 9.3 GB RSS. A fix would be a `// PORT(perf):` change needing its own review. I did not try one.

**Gate cost: none.**
- `mir-opt-o4` on `t3/m7-harness-ir-suites` lists only `tests/mir-opt`, and this file is in `tests/ui`.
- `mir-o2` takes run-pass tests, and this file is `build-pass`; below level 4 the pass returns at 100 blocks anyway.
- No suite passes level 4 to it. The file is protected in `mir` and others, at level 1.
- `-Zmir-opt-level=4` on real code of this shape would be slow, but that is not a shipped default.

## 6. The two `-Cpanic=abort` ICEs

Compared at `-Copt-level=2 -Cpanic=abort -Zunpretty=mir`, with each test's own flags:

| Program | Both sides report (same body, phase and location) |
|---|---|
| `building/custom/unwind_action.rs` | `broken MIR in Item(DefId(0:5 ~ unwind_action[9cbf]::b)) (after phase change to runtime-optimized) at bb0[0]:` `` `UnwindAction::Continue` in no-unwind function `` |
| `precise_liveness.rs` | `broken MIR in Item(DefId(0:10 ~ precise_liveness[349c]::call)) (after phase change to runtime-optimized) at bb2[0]:` `` Cannot `UnwindResume` in a function that cannot unwind `` |

stdout is empty on both sides and both exit 101. The rest of the text differs only by the port's known ICE format (`rust-ts: internal compiler error`, no span snippet, no query stack), which is the ICE report plan's subject.

**Is it a real rustc ICE at the pin?** Yes, reproduced on the oracle, but on invalid input: both are `custom_mir` tests with `//@ needs-unwind`, so compiletest would not run them at `panic=abort`. The port is right to fail here, and it fails the same way.

## 7. Samples and unit time

On the lane head, `RUST_TS_REQUIRE_PROBES=1`:

| Check | Result |
|---|---|
| `mir --sample 200` | 200/200 |
| `mirdump-ui --sample 200` | 199 MATCH, 1 UNSTABLE: `tests/ui/mir/lint/storage-return.rs`, the oracle's own output |
| `borrowck-ui --sample 200` | 200/200 |
| `thirdump-ui --sample 200` | 199 MATCH, 1 TIMEOUT, below |
| `run-pass-miri --sample 200` | 200/200 |
| `mir-core --sample 200` | 200/200. A sample still runs all of `core`: 680 s wall, 6.9 GB. The `core` run case is included |
| `bun test src/rustc_mir_transform` | 87 pass, 0 fail, 66 s user + 23 s system |
| `bunx tsc --noEmit -p .` | clean |
| `coverage --check --offline` | markers ok; `match_branches` 15/15 |

**The `thirdump-ui` timeout is not this lane's.** `projection-cache-rematch-impl-141124.rs#next` timed out alone at load 40+, also on the lane's base `99ca137f`, and it MATCHes on the lane at load 6. The file doesn't touch MIR. A note for root: the case is protected, so heavy load during a gate could report it as lost.

**Unit time.** The two new oracle tests take **4.85 s of CPU** (4.09 user + 0.76 system), counted from `bun test` start under load, against plan-m7 F5's 5 s. This matches the handoff (about 5 s) and leaves no room, which is why F1's fix goes in the existing `shims.rs` run. With it, that test measured 2.7 to 3.1 s across reverts, without a before-and-after of its own.

## F4: sweep tool

- `sweep.ts:237`: `mono` gives `CHECKED` for any exit other than 70 or 101, so a program that fails to compile looks checked. That was 16 of my 465 `mono` runs. The `checked` field does not help, as `driver.ts` writes the `CHECKED` line either way.
- `sweep.ts:245`: `BOTH_ICE` never compares messages, so a port ICE of a different kind on the same program would be filed as agreement. Item 6 shows this one was harmless. The first line of each ICE would be enough to compare.
- For anyone reading sweep totals: non-`miropt` modes pass no `--crate-type`, so a `tests/mir-opt` file with no `main` stops at E0601 and reaches no MIR. The handoff's "oracle exit 0" column shows this honestly.

## What I did not check

- The lane's full sweep totals (8,603 and 1,847 runs); I reproduced parts. Its table adds up.
- `rmeta-core`, or any full suite or gate.
- `tests/ui` beyond the samples above. `compile-fail` tests, as with the lane.
- 32 of ripgrep's 34 crates at `mono`. Only `log` and `rg`, the two that had stopped.
- Tests with proc macros or nested aux crates, which my expansion skips.
- The rest of `rustc_mir_build`'s candidates (about 160) and the `check_*` passes, beyond what the walker and `build_shapes` ran.
- The `FnPtrFromPtr` and `ThreadLocal` shims. `tests/mir-opt` at the `dump` and `miropt` modes, except through the lane's results.
- Codegen, which does not exist yet: an M7 path that edits an `instance_mir` result in place would need this checker rerun, as the handoff says.
- A fix for `DataflowConstProp`'s cost.
- Windows.
