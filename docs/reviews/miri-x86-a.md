# Independent review: miri-x86-a

Branch `t3/port-miri-x86-intrinsics`, head `45a51f79`, merge base `c9d3c553`. Upstream: `src/tools/miri/src/intrinsics/x86/{mod,sse,sse2,sse3,ssse3,sse41,sse42}.rs`.

## Verdict: APPROVE WITH NITS

I found no semantic difference from upstream or from the oracle in the lane's code. Nothing below blocks the merge. As the lane says, merge it together
with miri-x86-b, because "values: wide" skips on this branch alone and the gate rejects that skip.

## Findings

Severity is about the lane's work. The two issues outside the lane are listed separately.

| # | Where | Severity | Finding and failing scenario | Fix |
|---|---|---|---|---|
| N1 | `docs/handoff/miri-x86-a.md:99-100`, `src/miri/intrinsics/x86/probes/driver.mts:6` | low (wrong statement) | The handoff says the driver does not set `cfg(target_feature)` in the user crate. It does: `add_configuration` (`compiler/rustc_interface/src/util.rs:54-70`) derives the cfg from `internal_target_features`. A `cfg!` / `is_x86_feature_detected!` program under the driver with `sse3,ssse3,sse4.1` gave stdout byte-identical to the oracle with `-C target-feature=+sse4.1`. That is also why upstream's `assert!(is_x86_feature_detected!(..))` passes through the driver. A reader trusting the handoff would look for a gap that isn't there. | Correct both comments. |
| N2 | `src/miri/intrinsics/x86/x86.test.ts:70`, `probes/driver.mts:19` | low (coverage, after tail-a) | The test still bypasses the real flag path once miri-tail-a is in. A regression in the real `-C target-feature` path, such as a broken implied-feature closure, leaves `x86.test.ts` green, because the driver takes a hand-written list (`adx_pclmul` lists `pclmulqdq,vpclmulqdq,avx512f`, without the features they imply). | After tail-a merges, pass `regen.sh`'s flags to `src/miri/bin/miri.ts` and delete `driver.mts`. I checked this works: all 22 non-panic fixtures match on the merge with the real flags (below), and the 2 panic probes give the same text. |
| N3 | `src/miri/intrinsics/x86/x86.test.ts:25`, `scripts/gate.ts:270` | low | A hang costs 20 min per test, and the gate caps the whole unit step at 30 min. The last accepted step took 934 s. With a hang, 934 s + about 250 s + 1200 s exceeds the cap. The gate would then kill the step and report "wrote no junit report", without naming the test. Tests are short: the longest took 94 s at load about 45. | Use about 5 min. Gates run with lanes stopped; for lane runs under load, an environment override would do. |
| N4 | `src/miri/intrinsics/x86/mod.ts:123`, `probes/sse2.rs` | low (coverage) | No fixture sees the effect of `yield_active_thread`. Removing the call passes `sse2.rs`, which is single-threaded. A three-thread `_mm_pause` program with `-Zmiri-preemption-rate=0` kills that mutant (`m0 m1 m2 m3 b0..` against the oracle's `m0 b0 m1 a0..`). The port's code matches the oracle on that program. | Add a threaded probe, or rely on upstream's tests once a suite covers them. |
| N5 | `src/miri/intrinsics/x86/x86.test.ts:111-114` | nit | The `AVX_PORTED` guard is dead once both lanes merge. | Remove it at integration. |
| N6 | `src/miri/intrinsics/mod.ts:8-9,305-306` | nit (not this lane's file) | The comments still say x86 "stops `unported` until ported". The handoff already flags this. | Root or the file's owner updates them. |
| N7 | `docs/handoff/miri-x86-a.md:103-104` | nit | `-Zmiri-max-float-error` is named as an unchecked flag, but `src/bin/miri.rs` at the pin has no such flag. | Drop it. |

## Issues outside this lane

- **O1, medium, `src/miri/diagnostics.ts:477` (not in this lane's diff; reproduced on base `c9d3c553`).**
  `process.stderr.write` is asynchronous in Bun, while the rest of the output uses `writeSync`. When Miri's allocation dump is larger than the pipe
  buffer, later output overtakes it. For a UB report on a 512 KB static, `error: aborting due to 1 previous error` lands at line 781 of 32782 in a pipe.
  With stderr redirected to a file it lands correctly at the end. The total byte count is unchanged, so only the order differs. By arithmetic, an
  allocation over about 13 KB would be enough. I did not check whether any suite case reaches this. Lines 839-840 use the same call.
  **Fix:** write through the synchronous stderr handle.
- **O2, thin margin, not a regression: `tests/ui/coroutine/smoke.rs#default` (protected).**
  It reported TIMEOUT in my sample and on the pool's alone re-run, at load about 54, against the 60 s limit. It costs about 50 s of CPU: base 50.4 s
  user, head 53.4 s user (one run each). Run directly, it finishes with stdout identical to the oracle's. My direct argv was `--cfg default --test`,
  not the suite's exact argv. A gate on a quiet machine should pass, but with little room.

## What I checked

### 1. `mod.rs` and the dispatch

- **Arms and markers, mechanically:** all 112 arm strings are the same and in the same order. The `check_shim_sig_llvm_intrinsic` argument count of every
  arm matches its upstream `let [..]`. `mod.rs` has 35 fns and 35 markers, in order and on the right lines, and the other files have the same 1:1 match.
  `coverage.ts --check --offline` is ok on the head and on the merge.
- **By reading:** I compared all seven files with upstream line by line, including the guard order of the `llvm.x86.` prefixes (`sha`, `sse.`, `sse2.`, ...).

### 2. Bit-level semantics and JS pitfalls

No differences found:

- **Shifts:** `checked_shr` / `u128_checked_shl` at 128, the saturation to `u32::MAX`, and `left >> 127`.
- **Integer arithmetic:** `pmaddwd` wrapping via `| 0`, `pmulhrsw` narrowing, the `~` bigint in `test_high_bits_masked`, carry-in as non-zero.
- **`sse42`:**
  - the polarity uses the outer `len1`, not the arm-local even one;
  - `pcmpistria` uses `str1`, as upstream does;
  - the zero mask for MSB and LSB (`>>> 0` wraps to `u32::MAX`, then `min`);
  - negative lengths in `pcmpestriz` (`i32`) against `deconstruct_args` (`u32`, then `min`).
- **Floats:** `partial_cmp` tests, `!=` true on NaN, `Min` / `Max` zero and NaN clauses.

**My own mutants against the lane's fixtures:** 34 mutants, 33 killed. The survivor is N4. They include:

- the polarity shadowing trap;
- `pcmpistria` on `str2`;
- MSB without the wrap;
- `pcmpestriz` unsigned;
- shift count truncated to 32 bits;
- the arithmetic-shift fallback;
- the `rcp` / `rsqrt` error exponents;
- a reversed lane order for the RNG draws;
- NaN clauses of `Min` / `Max`.

### 3. Observable order

- **Overlap:** a `custom_mir` program makes `dest` overlap a source (left and right, same shape and through a pointer to another shape) for 33 calls: `pshufb`,
  `psign`, `pmulhrsw`, shifts, `min` / `max`, `rcp` / `rsqrt`, `cmp`, `insertps`, `round`, `dpps`, `phminposuw`, packs, `pmadd*`, `psadbw`, `mpsadbw`,
  conversions, `pcmpistrm`. It matches the oracle, default and `-Zmiri-deterministic-floats`.
- **Faults:** 33 programs with pointer bytes or uninit in operands, covering which lanes get read at all, partial uninit tails, lengths, `imm`, and `ldu.dq`.
  All match except one: `rv_p_adc`, the first reproduction of O1, not an x86 difference. Its stderr has the same bytes in a different order.
- **RNG:** `sse`, `sse2` and `sse41` at seeds 1, 7, 2^32 and `u64::MAX`, on real flags, match (9 runs; `sse2` at seed 7 only). The handoff had left other seeds unchecked.

### 4. The test driver

- **Production paths:** `driver.mts` is imported by nothing except `x86.test.ts`, and `X86_PROBE_FEATURES` is read nowhere else. Its entry glue is the same as
  `src/miri/bin/miri.ts`. It patches only its own process.
- **Could it hide a difference?** The `cfg` concern does not hold (N1). The driver's feature lists are subsets of what the oracle gets, so a missing feature fails
  loudly rather than passing silently. What it does hide is the real flag path itself (N2).
- **Real flags on my merge of a + b + tail-a** (not committed), against the isolated Miri:

| Program set | Flags | Result |
|---|---|---|
| Feature-reporting programs (`cfg!`, `#[cfg]`, `is_x86_feature_detected!`, `#[target_feature]` calls), 2 programs × 12 flag sets | none, single and repeated flags, `+a,-b`, `+notafeature`, `-sse2` | 24/24 MATCH |
| Upstream `tests/pass/shims/x86`: the 8 the lane ran, plus `rounding-error.rs` | their own | 9/9 MATCH |
| The lane's value and error fixtures, plus the seed runs | real flags | 31/31 MATCH (including `wide`) |
| The two panic probes and 16 mismatched-shape programs | `-Ctarget-feature` | 17 of 18: same panic text and exit 101 (ICE frame differs by design); 1 of 18 (`rv_a_addc_ty`, no panic) fully MATCH |

### 5. Fixtures

- **Reproducible:** `regen.sh` on a scratch copy of the head reproduced all 72 files byte for byte.
- **Oracle values:** `x86.test.ts` compares against those fixtures only. `sse`, `sse2` and `sse41` differ from their `.det` fixtures, so the noise is compared.
- **All 112 arms are called:** I wrapped `emulate_x86_intrinsic` in a scratch copy of the driver and logged every name. The probes reached all 112, and every
  logged call returned `NeedsReturn`. The fixtures exercise the error paths separately.
- **Panic probes are scoped correctly:** only 2 tests use the text-and-exit comparison, and the other 22 compare stdout, stderr and exit. The comparison reads one
  message line, which is enough for those two messages. The lane left `assert_eq!` / `assert!` texts unchecked, so I checked them. Multi-line texts match, including a
  `TyAndLayout` `Debug` in the text.

### 6. Merging with miri-x86-b

On `t3/miri-x86-b-on-x86-a` + `45a51f79`:

- `x86.test.ts` + `contract.test.ts` with `RUST_TS_REQUIRE_PROBES=1`, `CI=true` and junit: **32 pass, 0 fail, `skipped="0"`**. "values: wide" ran.
- `contract.test.ts`: 8 pass, so the `.mts` rename holds.
- `tsc`: 0 errors. Adding tail-a: `tsc` 0 errors, contract 8 pass.

A plain merge of the two lane heads (`2cd2817a` + `45a51f79`) also has `tsc` 0 and a passing "values: wide", but it keeps the 47 lines of stand-ins in `avx*.ts`.
Merge through `t3/miri-x86-b-on-x86-a`, or replay `07c3ecaf`, as miri-x86-b's handoff says.

### 7. Cost

**Acceptable as it is.**

| Measure | Result |
|---|---|
| `x86.test.ts` on the head (23 tests, 1 skip) | 184 s user + 37 s sys, 12:13 wall at load about 100 |
| `x86.test.ts` + `contract.test.ts` on the merge (32 tests) | 201 s user + 48 s sys, 8:47 wall at load about 45 |
| Unit step of the last accepted gate (`gate-20261102-174727-root-kxpt`), cap 1800 s | 934 s |

This adds about 250 s, or about 27%, to that step. It fits, but wave 38's other test files add up too, so root should watch the step time against the cap.

If time must be cut, `.det` runs for `sse` and `sse2` are the first to go (49 s and 56 s at that load). The 14 error probes cost about 9 s each, mostly startup. They
test paths nothing else covers, so I would keep them. The 752 KB of fixtures is fine.

**Default path:** nothing slows it.

- `miri` hello world, 7 runs each, median CPU: base 6.29 s, head 6.31 s.
- `run-pass-miri --sample 200` on the head (agent `review-x86-a`, run `20261104-091014-review-x86-a-rcb9`, a different sample from the lane's): **MATCH=196, DIFF=0,
  UNPORTED=3, TIMEOUT=1.** The UNPORTED cases are unprotected: `each_linked_rlib` (1) and `pipe2` (2), both miri-tail's scope. The TIMEOUT is O2.
- The `pause` DIFF in my first adversarial run (SIGTERM at 900 s, load about 150) was the machine: alone it matches in 21 s.

## What I did not check

- The gate and full suites, per the brief. `run-pass-miri` only as the sample above.
- **32-bit paths:** the `arch != X86_64` branches of `addcarry.64`, `subborrow.64` and `crc32.64.64`. Read only, since the Miri sysroot is x86_64 only.
- **`-Zmiri-many-seeds`**, and seeds beyond the four above.
- **miri-x86-b's and miri-tail-a's own code:** reviewed separately. I only ran them as part of the merges.
- **Code the lane calls but didn't change** (`apply_random_float_error`, `sqrt`, apfloat, `float_to_int_checked`, `compute_crc32`): covered through the fixtures, not read
  line by line against upstream.
- **`mod.gen.ts`:** generated, not read.

## Reproducing

- **Scope of the evidence:** a reboot and a T3 restart hit this review. The feature-reporting, overlap and fault runs were done before the reboot on a merge whose tree is identical to
  the rebuilt one (`2dc250c3da`). Their programs were in the scratchpad and are gone, and they are not committed. Their results above are from my session log, and the descriptions
  above say what they did. Everything else was run after the restart.
- **Timings** come from a machine that other sessions were loading, except the CPU figures, which do not depend on load much.
