# Handoff: miri-perf (plan-m6 D11)

Branch `t3/profile-miri-performance`. Speed work on the interpreter path. No representation change, no change to
`harness/`, `scripts/` or baselines, and no output change found: 0 DIFF in every check below.

## Result

Every near-limit case is now inside the 60 s limit on a quiet machine, and `tests/ui/moves/move-3-unique.rs` is clearly
inside it: about 33 s CPU and 29 s wall, down from about 70 s CPU and 65 s wall.

"Before" is `integ-w38` at `df0180bc`. "After" is that commit merged with this branch (the trial merge had no conflicts).
All outputs are byte-identical before and after, and all 12 cases MATCH the oracle on the merge
(`difftest --suite S --filter ..`, one at a time).

| case | CPU s before | CPU s after | wall s before | wall s after | RSS MB before | RSS MB after | Ginstr before | Ginstr after |
|---|---|---|---|---|---|---|---|---|
| hello (3 runs) | 2.65-2.74 | **2.47-2.58** | 1.7-1.8 | 1.6-1.7 | 698-712 | 643-648 | 31 | 29 |
| `moves/move-3-unique.rs` (2 runs) | 69.2-71.3 | **32.3-34.6** | 64.2-65.6 | 28.2-30.0 | 1,440 | 1,345 | 845 | 366 |
| `test-attrs/terse.rs` | 103.0 | **54.4** | 93.9 | 44.5 | 2,327 | 2,109 | 864 | 420 |
| `drop/dynamic-drop.rs` | 119.2 | **61.0** | 111.5 | 53.3 | 2,012 | 2,024 | 1,027 | 495 |
| `threads-sendsync/issue-8827.rs` | 116.1 | **58.0** | 110.2 | 52.0 | 1,801 | 1,819 | 1,071 | 499 |
| `panics/panic-in-ffi.rs` | 26.1 | **19.8** | 20.5 | 13.4 | 1,293 | 1,252 | 270 | 165 |
| `coroutine/smoke.rs#default` | 22.6 | **19.9** | 15.1 | 10.8 | 1,241 | 1,220 | 212 | 136 |
| `macros/macro-comma-support-rpass.rs#core` | 35.5 | **27.4** | 27.4 | 17.8 | 1,580 | 1,527 | 352 | 202 |
| `sanitizer/cfi/coroutine.rs#cfi` | 17.7 | **16.6** | 11.4 | 9.2 | 1,191 | 1,167 | 168 | 114 |
| miri-pass `tests/pass/float.rs` | 28.7 | **36.5** (see below) | 13.9 | 15.5 | 2,332 | 2,504 | 269 | 252 |
| miri-pass `tests/pass/panic/nested_panic_caught.rs` | 29.7 | **23.1** | 23.7 | 16.3 | 1,278 | 1,264 | 305 | 185 |
| miri-pass `tests/pass/shims/time-with-isolation.rs` | 22.2 | **16.9** | 17.5 | 12.1 | 1,194 | 1,242 | 240 | 141 |

Conditions: load about 4-22. Hello and move-3 are the repeat runs; the other rows are one run with 3 + 3 cases at once,
so the before and after sides shared the machine. In that first batch move-3 took 80.3 s CPU and 74.2 s wall before, 44.6
and 39.1 after. The figures quoted to this lane (float about 60 s CPU, panic-in-ffi 48-56 s wall, ...) were taken under
higher load.

Notes on the table:
- **`float.rs` did not get faster.** Instructions fell only 6%; its CPU and wall figures are one noisy run each (a profiled
  run took 29.5 s CPU). A profile shows 67% in front-end analysis and 21% in the interpreter, so this lane's work barely
  touches it. It finishes in about 15 s wall when the machine is not overloaded, so it should stop timing out.
- **`dynamic-drop.rs` and `issue-8827.rs` have the least margin** (52-53 s wall with five other cases running; 57 s for
  dynamic-drop in a synchronous-JIT run). They should pass, and the difftest rerun alone helps, but a loaded pool can still
  push them past 60 s. Both were TIMEOUT at the last gate, so neither is protected yet.

Run-pass sample (the same 200 cases, sorted by sha1 of the id; same run conditions; 0 outputs differ):

| | before p50 | after p50 | before p99 | after p99 | before max | after max |
|---|---|---|---|---|---|---|
| CPU s | 3.74 | 3.65 | 15.03 | **11.11** | 15.84 | 11.45 |
| wall s | 3.25 | 3.18 | 12.41 | 7.86 | 15.38 | 8.99 |
| RSS MB | 658 | 593 | 951 | 974 | 999 | 984 |
| Ginstr | 29.8 | 28.7 | 113.1 | 80.7 | 117.9 | 84.6 |

### D11 targets

| target | status |
|---|---|
| hello <= 3 s CPU | **Met**: 2.47-2.58 s |
| `run-pass-miri` p99 <= 10 s | **Not met on CPU**: 11.11 s (wall 7.86 s). In the sample only three cases exceed 10 s CPU: `test-attrs/issue-34932.rs`, `test-runner-hides-main.rs`, `tests-listing-format-default.rs` |
| every case within 60 s except a recorded list | **Not established for the whole suite**: all 12 cases above pass and the 200-case samples show no TIMEOUT, but I did not run the full suites |

`run-pass-miri-heavy` was not measured and I recommend no change to the heavy list. Its two slowest cases take 282 s and
451 s on the oracle Miri and this work does not bring them near the limit.

## rmeta-core

Budget untouched and 82,338/82,338 MATCH. Max RSS does not show a change either way, because readings spread by about 2 GB on both sides (GC timing):

| | max RSS MB | CPU s |
|---|---|---|
| gate `gate-20261102-174727-root-kxpt` | 11,294 | 142.8 |
| before (`integ-w38`, load 3-25) | 9,421 / 11,010 / 11,271 / 11,314 | 158-220 |
| after (merge or branch, load 4-23) | 10,017 / 10,187 / 10,778 / 11,344 / 11,959 (and 10,418 at higher load) | 151-192 |

The highest reading is an after one, 11,959 MB, which is 329 MB under the budget, so one run could come close to it
whatever this branch does. The new memos are small, and `LAYOUT_MEMO` and the per-type ones stop at 64 typing envs, so I
read this as GC noise rather than growth, but I have not proved that. Watch this figure at the gate. CPU overlaps within
noise.

## Correctness

On the trial merge (`caf1eab2`'s code; later commits change comments only):
- `bun test ./src/miri ./src/rustc_const_eval ./src/rustc_abi ./src/rustc_middle`: 848 pass, 0 fail.
- `--sample 200`, 0 DIFF and 0 TIMEOUT in all: `miri-pass` 186 MATCH, 13 UNPORTED, 1 UNSTABLE; `run-pass-miri` 200 MATCH;
  `run-fail-miri` 200 MATCH; `mir` 200 MATCH; `mirdump-ui` 199 MATCH, 1 UNSTABLE (`tests/ui/mir/lint/no-storage.rs`,
  UNSTABLE at the gate too). I did not compare the 13 UNPORTED against an unmerged run; this work adds no `unported` call.
- `tsc --noEmit` clean, `coverage.ts --check` ok.

New tests: `src/rustc_abi/size_perf.test.ts` and `src/rustc_middle/mir/interpret/target_uint_perf.test.ts` pin the fast
paths to the exact `bigint` formulas. They caught a real bug in this lane's `align_to` (`small + a - 1` rounded near 2^53,
reachable by no real size), fixed in the same commit.

Two things seen along the way, not caused by this lane:
- `mk_const_alloc oracle` (`src/rustc_middle/ty/mk_const_alloc.oracle.test.ts`) has bun's default 5 s limit and took 3.6 s
  alone. It failed once at 5,005 ms under load, so it can fail a run under load.
- At load 100-200 samples produced 13 and 8 false TIMEOUTs. Reruns at lower load showed no real loss.

Why this should be invisible (the lane's rule): nothing here runs earlier or later than it did. Every memo holds a pure
function of interned or immutable values, is filled by the first call and skipped only on repeats; failures are never
remembered. The dep graph is off, so skipped query reads change nothing. RNG draws, allocation order and scheduling are not
touched. `read_discriminant`'s memo keeps upstream's walk for each new `(adt, bits)` so explicit discriminants evaluate
exactly when they did. `InterpCx::resolve`'s memo is per `TyCtxt` (a `DefId` means something else in another one, and the
empty list is process-wide).

## Profile

Baseline top self time, `move-3-unique` (CPU profile; the raw profiles were lost in the 10:01 reboot, these are the figures
read at the time): `key_of` 12.5%, `lookup` 4.6%, `sorted_keys` 4.1%, `frame` 2.0%, `intern` 2.0%, `Ok` 1.7%, `walk_value`
1.5%, `BigInt` 1.4%, `has_type_flags` 1.4%, `Size` 1.0%. Inclusive: value validation 40%, `ty_and_layout_field` 11%, query
lookups 15%, `intern_key` 17%.

After, `dynamic-drop.rs` (on `b3e95520`, before the local-access commit): flat. `lookup` 2.9%, `Ok` 2.1%, `frame`
1.9%, `eval_statement` 1.5%, `walk_value` 1.5%, `generate_stacktrace_from_stack` 1.4%, `step` 1.3%, `local_to_op` 1.1%,
everything else about 1% or less. Validation is still the largest subtree (about a third on `move-3-unique`, last read on
an earlier build), but upstream does that work too.

Interpreter cost is now about 7x the oracle's on `move-3-unique` (34 vs 4.9 Minstr per loop iteration, from the two
benchmark lengths with synchronous JIT), down from about 18x (85). On a late build 83% of samples were in DFG/FTL code, so
slow JIT tiers are not the limit.

## Gains per change

Benchmark: `move-3-unique` cut to 5,000 iterations, with `BUN_JSC_useConcurrentJIT=false` and
`BUN_JSC_useConcurrentGC=false` in the measuring environment only. Two runs agree to about 0.1% whatever the load, because
JIT and GC no longer depend on other processes. Base 486.1 Ginstr, branch 220.6 (-55%). Noise is about +-0.5.

| change | Ginstr |
|---|---|
| hot `PseudoCanonicalInput` query keys without `intern_key` | -79.2 |
| remember `TyAndLayout::field` and `for_variant` | -69.8 |
| remember frame instantiate + normalize | -19.7 |
| callee signature per callee type | -18.5 |
| scalar loads and stores without views or 128-bit loops | -15.0 |
| `Size` number fast paths | -14.1 |
| `read_discriminant` memo | -12.1 |
| pointer arithmetic in numbers | -8.4 |
| direct frame access | -6.4 |
| `is_opsem_inhabited` per type | -4.4 |
| shared small `Size` values | -3.8 |
| local reads and writes on the hit path | -3.2 |
| `interp_ok` shared results | -2.5 |
| `MutRef` class | -2.4 |
| always-live locals per body | -2.3 |
| per-step closures, `Set` and slice in `eval_callee_and_args` | -1.3 |
| required consts once | -1.0 |
| `FnSig` inputs and output | -1.0 |
| stacktrace reuse | -0.6 |
| `resolve` memo, with its per-`TyCtxt` guard | -0.4 |
| `PlaceTy` helpers | -0.3 |
| `Stack::new` shared slot | -0.1 |
| validity success paths | 0.0 |
| `InstanceKind` and `(def, args)` keys as numbers, `Size::bytes` | +0.1 |
| `visit_field` without closure | +0.5 |

The low-gain changes stayed because they are worth something together: taking out six of those commits (stacktrace reuse,
`resolve` and its guard, `PlaceTy`, validity, `visit_field`) cost 1.1% on this benchmark and 2.2% on `dynamic-drop.rs`, which is
near the limit. A reviewer who wants a smaller diff can drop any of those at that price. Gains have flattened: the last
nine commits together are about 2%.

Each change's figure is in a `Measured (...)` line beside its `// PORT(perf):` comment, and upstream's behaviour is in the
comment itself.

## Representation

**No proposal.** Nothing here needs a representation change, and the numbers do not justify one yet. In the late
`dynamic-drop.rs` profile the visible bigint cost is about 3% of self time: `BigInt` 0.9%, `asUintN` 0.3%, `asIntN` 0.1%,
`mir/interpret/value.ts` 1.2%, `ty/consts/int.ts` 0.6%. Arithmetic inlined into other functions is not counted, so that is
a floor, but the profile leaves little room. `u64` scalars as numbers would also touch every `ScalarInt` user. `Ok` objects
are 2.1%. `Size` kept its existing two forms (decision 2026-10-31); only its internals got faster.

## For root

**Bundling with bytecode would help every case, and that decision is yours (it changes the suites' subject).** Hello
spends about 19 of its 29 Ginstr loading modules, so p50 is startup and this lane barely moved it. Measured on hello once
each, at load about 30, with `bun build src/miri/bin/miri.ts --target=bun`:

| entry | Ginstr | CPU s |
|---|---|---|
| source (today) | 29.1 | 6.61 |
| bundle | 23.0 | 5.41 |
| bundle with `--bytecode` (25 MB + 36 MB, built in under a minute) | 16.0 | 4.00 |

I only checked that hello prints the right output. Any change to a subject needs its own batch and a rebuild per tree.

**Measuring.** Instruction counts are not stable under load: `dynamic-drop.rs` measured 571 Ginstr at load about 48 and 493
at load about 7, with no meaningful code change between, because starved JIT threads leave code in slow tiers longer. Use the synchronous-JIT
settings above to compare builds, and never compare user CPU across different loads.

## Files touched

Code: `src/rust_ts/typing_env_no.ts` (new), `src/rustc_abi/lib.ts`, `src/rustc_const_eval/interpret/{discriminant,
eval_context,memory,operand,place,stack,step,validity}.ts`, `src/rustc_middle/mir/interpret/{allocation,error,mod,pointer}.ts`,
`src/rustc_middle/query/keys.ts`, `src/rustc_middle/ty/{consts/int,inhabitedness/mod,layout,sty}.ts`,
`src/miri/alloc_addresses/mod.ts`, `src/miri/borrow_tracker/stacked_borrows/stack.ts`, `src/miri/concurrency/thread.ts`.
Tests: the two named above.

Coverage: no functions added or removed from upstream's list, markers unchanged. `unported(...)` left: none added. `// PORT:`
decisions: only the `// PORT(perf):` comments.
