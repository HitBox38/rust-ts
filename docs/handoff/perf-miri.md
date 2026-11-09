# Handoff: perf-miri

Branch `t3/optimize-miri-performance`, based on `74f215e6` (`main`). Speed work on the two protected `run-pass-miri` cases that time out in the gate's
12-job pool and match only on the solo retry: `drop/dynamic-drop.rs` and `threads-sendsync/issue-8827.rs`. No output change, no
representation change, nothing touched in `harness/`, `scripts/` or baselines. No `unported(...)` added, no markers added or moved.

| commit | what |
|---|---|
| `ae95bbec` | `FrameState::local_write` / `local_read` read the span after the `race_detecting()` check; unit test |

## Result

**One faithful change, worth 2.1% of `dynamic-drop.rs`'s instructions and nothing on `issue-8827.rs`. Neither case comes near
finishing inside 60 s in the 12-job pool, and no faithful change I found can get them there.** What remains is the runtime's
constant factor on upstream's algorithm, spread over the whole interpreter; the profile and the counts below show it.

**Alone**, default settings (the gate's), one process at a time, base and head alternated, AC power. Load is the 1-minute figure at
start and end of each run. Every run's output hash is equal to base's (`dynamic-drop.rs` `3b71bf232208`, `issue-8827.rs`
`43402cedebcc`), and both MATCH the oracle on head (`difftest --suite run-pass-miri --filter`, one at a time).

| case | side | wall s (3 runs) | user s | max RSS MB | Ginstr | load |
|---|---|---|---|---|---|---|
| `dynamic-drop.rs` | base | 36.2, 47.8\*, 37.7 | 43.1, 54.0\*, 44.5 | 2,146-2,169 | 478.4, 479.3, 476.5 | 3.9-2.6, 7.8-11.2\*, 5.3-4.1 |
| | head | 36.8, 40.0\*, 36.7 | 43.6, 47.1\*, 43.6 | 2,119-2,163 | **467.7, 471.0, 468.8** | 2.6-2.6, 11.2-7.3\*, 4.1-3.7 |
| `issue-8827.rs` | base | 44.5\*, 37.9, 37.0 | 48.7\*, 43.3, 42.6 | 1,975-1,988 | 485.0, 484.8, 483.8 | 2.6-6.4\*, 7.3-5.2, 3.7-3.3 |
| | head | 45.0\*, 35.8, 36.5 | 51.0\*, 41.4, 42.3 | 1,962-1,975 | 485.4, 483.9, 484.0 | 6.4-7.8\*, 5.2-5.3, 3.2-2.6 |
| oracle Miri (perf-near-limit's figures) | | | 4.1 / 4.2 CPU | | | |

\* Another lane's work started during these runs (load 6-11); compare the quiet runs. On the quiet runs `dynamic-drop.rs` is about
36.7 s on both sides: 2% of instructions is under the wall-time noise.

**Builds compared by instructions** (synchronous JIT and GC, base and head side by side at the same load, 19-22):
`dynamic-drop.rs` 480.3 → **470.3 Ginstr (-2.1%)**, `issue-8827.rs` 486.0 → 485.9 (no change).

**Beside a sample** (one run each side, the four runs one after another while `difftest --suite check-ui --sample 400` ran in a loop;
every sample 400/400 MATCH). The other two lanes were busy at the same time, so the load is theirs and mine together:

| | jobs | load | `dynamic-drop.rs` base / head | `issue-8827.rs` base / head |
|---|---|---|---|---|
| beside a 4-job sample | 4 | 4 → 25 | 57.7 / 75.0 s wall (54.7 / 60.5 user) | 56.6 / 71.3 s wall (55.1 / 56.7 user) |
| beside a 12-job sample | 12 | 24 → 44 | **109.5 / 105.8 s** (69.1 / 67.8 user) | **110.8 / 136.4 s** (65.7 / 67.2 user) |

All finished with the right output (no limit is applied in this runner), but beside a 12-job sample every run takes 106-136 s, about
twice the 60 s limit, on both sides. The head runs came later in each sequence, as the load rose; the instruction counts in the same
runs (468.8-469.3 head, 479.7-481.4 base for `dynamic-drop.rs`) still show the 2%.

## The profile

`bun --cpu-prof` on each case alone (load 1-4), aggregated by function, by line (`positionTicks`) and as a callee tree. The two cases
have the same shape. Of `dynamic-drop.rs`'s 35.2 s of main-thread samples:

| part | inclusive |
|---|---|
| start-up, parsing, analysis of the test | 4% |
| the interpreter loop (`step`) | 95% |
| of which: validation of typed copies (`validate_place` → `visit_value`) | 34% |
| of which: retagging inside validation (`sb_retag_ptr_value` → `sb_reborrow`) | 10% |
| of which: argument passing in `init_stack_frame` (`copy_op` with protectors) | 15% |
| of which: `return_from_current_stack_frame` | 11% |
| queries still executed during interpretation | about 1% |

Self time is flat: the top function is `Ok` (`std/result.ts`, the `InterpResult` objects) at 2.2-2.7%, then `frame()` 1.9%, query
cache `lookup` 1.9%, `step` 1.7%, `local_to_op` 1.5%, and everything else 1.5% or less. No file is above 7.4%
(`interpret/place.ts`). `issue-8827.rs` adds the data-race detector (`dedup_range_map` `iter_mut` 3.6%, `local_write` 2.7%,
`current_user_relevant_span` 3.3%).

### Counts per run

From a temporary counting build (not in the tree), one run each:

| | `dynamic-drop.rs` | `issue-8827.rs` |
|---|---|---|
| interpreter steps (`step`) | 15.3M | 17.2M |
| validations (`validate_place_internal`) | 7.1M | 7.5M |
| typed copies (`copy_op_inner`) | 4.6M | 5.2M |
| `current_user_relevant_span` | 32.2M | 31.2M |
| allocations (memory-map insert / remove) | 665k / 665k | 587k / 587k |
| leak backtraces (`generate_stacktrace_from_stack`), frames walked | 665k, 22.9M (34 per trace) | 587k, 10.6M |
| `random_bool` (preemption) / `random_range` (addresses) | 2.7M / 675k | 3.6M / 588k |

**About 2.3 µs per step, against about 0.27 µs for the oracle Miri** (4.1 s CPU for the same program, start-up included, over 15.3M steps): 8-9x.
Validation alone costs about 1.7 µs per call. Each of these is upstream's work, done the same number of times; the port pays more per
operation (result objects, `Size`/`Pointer`/place objects, `bigint` `u64`s, `Map` lookups, pointer chasing through a heap that peaks at
2.1 GB RSS).

## The causes I looked at, and what each is worth

Gains are of `dynamic-drop.rs`'s samples unless said. "Upstream does it" means the same calls in the same number.

| candidate | share | outcome |
|---|---|---|
| `current_user_relevant_span` read by `local_read`/`local_write` before the `race_detecting()` return | 2.0% (`dynamic-drop.rs`), 0 effect on `issue-8827.rs` | **done** (`ae95bbec`): -2.1% instructions |
| leak backtraces: 34 `WeakMap` lookups per allocation in `generate_stacktrace_from_stack`'s memo | 1.5% | left: the memo would have to live on `Frame`, a generated class (a dynamic property splits its hidden class across the interpreter); a suffix memo keyed by the caller frame would save about 1% and needs adversarial review of a stack-discipline argument |
| hashbrown table behind the memory map (`FxHashMap` keeps bucket order for leak reports): about 700 ns per insert or remove, `bigint` hashing and group emulation | 2.5% | left: spread over hashbrown's probe code; a number-based rewrite of the vendored crate touches every `FxHashMap` in the compiler for about 1-2% here |
| RNG: `random_bool` 160 ns, `random_range` 430 ns per call (`u64` as `bigint` through ChaCha12's block RNG) | 2.0% | left: the `bigint` is the `u64` representation; memoizing `Bernoulli::new(p)` saves about 0.2% |
| `typing_env_no` | 0.7% | no cause: 1,141 slow-path misses in 27.9M calls, the memo works |
| `instantiate_from_frame_and_normalize_erasing_regions` for each new frame's locals | 1.2% | left: already memoized (`FRAME_NORMALIZE_MEMO`); the remaining cost is its lookups |
| `frame()` / `stack()` chain | 3.1% | left: already inlined to two loads (miri-perf); the cost is the pointer chase |
| per-call closures in validation (`try_validation(.., (e) => ..)` at validity.ts:349, :460, `map_err_kind` at :511) | about 0.5% | left: under 0.2% each |
| `Ok` objects, `Size`, `Pointer`, `TyAndLayout`, `MiriAllocBytes` constructors | 4-5% together | representation (`InterpResult` without allocation, `u64` as numbers) needs a recorded decision |

Everything else is 1% or less per function. To reach the 60 s limit in the pool the cases need to lose about half their time
(next section), and the largest faithful items above add up to about 6%.

## Why the pool needs about half

- Total CPU (user + sys) is about 43 s alone, whether JIT and GC run concurrently or not (with `BUN_JSC_useConcurrentJIT=false
  BUN_JSC_useConcurrentGC=false` it is 45 s CPU on 44 s wall): helper threads add no work, they only move it.
- In the 12-job pool, on this 8 P-core + 4 E-core M4 Pro, every process gets about one core or less, often an E-core, and JIT threads
  starve. The w40e audit measured the TAIT cases there: 25 s alone, still **TIMEOUT at 60.0-60.1 s** beside a 12-job sample (34-35 s
  user). So a case needs roughly 20 s alone or less to finish in that pool, and these take 35-37 s.
- Measured here (table above): beside a 12-job sample both cases take 106-136 s, with 66-69 s of user time against 43 s alone. The
  work does not grow (instructions are within 2% of alone); each process just gets about half a core.

## What remains, and options for root

What remains is the constant factor: about 8-9x the oracle per interpreter step, with no function above 2.7% of the samples. Options,
none of them mine to take:

1. **Representation** (needs a recorded decision, PORTING §3): `InterpResult` without an allocation on success, `u64` scalars and
   RNG words as numbers. These are the only items that reach every step; I have not measured them.
2. **Bundling with bytecode** (`docs/handoff/miri-perf.md`, "For root"): saves start-up only, about 13 Ginstr of 470.
3. **Harness**: these two cases are what the solo retry exists for, as for the TAIT cases (decision 2026-11-08). They take 35-37 s alone
   (58-62% of 60 s), so the retry has room on a quiet host; a lane's default-jobs sample during a gate's `run-pass-miri` retries would
   lose them, as it would the TAIT cases (w40e audit N1).
4. The two 1-2% items above (suffix memo for backtraces, numbers in hashbrown) if root wants every percent; each needs adversarial
   review.

## Correctness

On head (`ae95bbec`), `RUST_TS_AGENT=perf-miri`, `--sample 200 --jobs 4`, at load 9-30 (the other lanes):

| suite | result |
|---|---|
| `miri-hello` | 1/1 MATCH |
| `run-pass-miri` | 200/200 MATCH |
| `run-fail-miri` | 200/200 MATCH |
| `miri-pass` | 197 MATCH, 1 DIFF, 2 UNPORTED; the same on base for all three, none protected: `tests/panic/mir-validation.rs` (an ICE: the port prints the JS stack instead of a Rust backtrace), `tests/pass/open_a_file_in_proc.rs` and `tests/pass/shims/socket-address.rs` (`unported` file and socket shims) |
| `run-pass-aux-miri` | 200/200 MATCH |
| `check-ui` (run as the load beside the timings) | 11 × 400/400 MATCH |

- `bun test src/miri`: 447 pass, 0 fail. `bunx tsc --noEmit -p .` clean. `coverage.ts --check`: markers ok.
- `mir` and `check-ui` samples: shared code is untouched (the change is in `src/miri/`, which only the Miri driver loads); `check-ui`
  ran anyway as the load above.

**Why the change cannot show, and what fails if it were wrong.** `current_user_relevant_span()` reads the active thread's stack:
`top_user_relevant_frame` (a field) and that frame's `current_span()` (`Body::source_info` of its location, or the unwinding span). It
writes nothing and cannot fail on a frame being interpreted (its location is always inside its body; with an empty stack it returns
`DUMMY_SP`). Its value is used only after the early return, so moving the read past it changes nothing but the work. With race
detection on, the span is read exactly where it was used before.
- Unit test `data_race.test.ts` "FrameState::local_write / local_read": with race detection on, each access records its thread's span
  in the clock entry; with it off, nothing is recorded and the span is not read. Replacing the span with a dummy one in `local_write`,
  or in `local_read`, fails it (2 of 2 mutations).
- `miri-fail` `tests/fail/data_race/local_variable_{alloc,read,write}_race.rs`: 3/3 MATCH on head; with the span replaced by a dummy in
  both functions, 3/3 DIFF (the race report names the earlier access's span). `miri-fail` is not a gated suite, hence the unit test.

Unit time added: under 1 ms.

## How I measured

- Alone: one process at a time, base (a detached worktree at `74f215e6`) and head alternated, `/usr/bin/time -l`, the suite's exact
  subject argv, env and cwd (`harness/suites.ts`), `RUSTC_ICE=0`. Output hashes (stdout, stderr, exit) compared on every run.
- Builds compared by instructions retired with `BUN_JSC_useConcurrentJIT=false BUN_JSC_useConcurrentGC=false`, base and head side by
  side at the same load: two runs agree to about 0.5%.
- Beside a sample: a loop of `difftest --suite check-ui --sample 400 --jobs N` (fresh seed each round), started 20 s before the four
  timed runs and kept going until they finished.
- Scratch tools (session scratchpad, not in the tree): the runner, a CPU-profile aggregator (self, inclusive, callers, callee tree,
  per line), the counting build, the heap-at-exit hook.

## Files touched

`src/miri/concurrency/data_race.ts`, `src/miri/concurrency/data_race.test.ts`, this file.

Coverage: `src/tools/miri/src/concurrency/data_race.rs` 78/78 ported, unchanged. `unported(...)` left: none. `// PORT:` decisions: the
one `// PORT(perf):` note above (on both functions).
