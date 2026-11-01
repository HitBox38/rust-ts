# Handoff: fixer lane `miri-eval-fix` (M6 wave 36)

Branch `t3/miri-eval-fix` (worktree t3-77c0ea0d). It merges `integ-w36` (0b118d0b) and `t3/port-miri-eval-core`
(a28f9600). Both merges were clean. It then fixes the REQUEST CHANGES review of miri-eval (`docs/reviews/miri-eval.md`,
worktree t3-228bb9d7).

## Summary for root

- **Review finding #1 (f16 `powi`) is not a port bug.** The pinned Miri binary computes f16 `powi` as
  `fcvt s0, h0; bl ___powisf2; fcvt h0, s0`, so each step is rounded to f32. The predecessor's `HOST_F16 = HOST_F32`
  was right.
  - Proof: real Miri (the isolated toolchain, `-Zmiri-deterministic-floats`) ran over all 65,536 f16 inputs with a
    runtime exponent.
    - The port has 0 mismatches.
    - The reviewer's per-step-f16 model has exactly 5,176 mismatches, the count in the review.
  - The review's "oracle" was a natively compiled `x.powi(3)`. With a constant exponent, LLVM expands it into f16
    multiplies. Miri passes a runtime exponent, so that expansion never happens there.
  - The f16 `powi` path is now also checked exhaustively in the test: 65,536 inputs × 15 exponents, hashed.
- **Findings #2 / #3 (f32 host math, f64 `exp2`): fixed and byte-identical.**
  - Miri's host ops call the host libm: libSystem's `sinf`/`sin`/`exp2`... on this Mac.
  - Apple's libm has no open source at this macOS version, so option (a), a faithful port, is impossible.
  - The port now calls the host libm through `bun:ffi` (option (b)): the new glue module `src/rust_ts/host_libm.ts`.
  - **Root decision requested** (see "Decision" below).
  - Every host op of every width now matches the oracle bit for bit:
    - f64 and f32: 200,000 inputs per op.
    - f16: all 65,536 inputs; `powf` × 8 exponents; `powi` × 15 exponents.
  - These are assertions, not printed differences. There is no known-divergence list, because nothing diverges.
- **#4 host guard:** the fixture records its host (`tuple aarch64-apple-darwin`). The host-op tests are
  `test.skipIf` on any other `RUST_TS_HOST_TUPLE`, and print the reason. The RNG-helper part of the fixture does not
  depend on the host and always runs.
- **#5 probe parameters:**
  - Added `err_scale = -12` on f32, in Random and Max modes (production's x86 `rcp`/`rsqrt`).
  - Added an f128 (`Quad`) ulp case in Random and Max modes, f16 Random ulp, and f16/f128 `generate_nan`.
  - Every helper line records the running RNG draw counts `@ n32 n64 nbytes`, and the test asserts them line by line.
    rand 0.10's `StdRng` is not `Clone`, so the probe wraps the stream in a counting `TryRng`, and the test wraps the
    TS `StdRng`'s `try_*` methods the same way.
  - Miri has no f128 host ops (`impl_float_host_operations!` covers Half/Single/Double; `powif128` is `todo!`), so
    there is no f128 host-op case.
- **#6 nits:**
  - `make_signaling` is now nested inside `generate_nan` at its upstream position (operator.rs:82 inside :74).
  - `IeeeExt` is in upstream order: `one` 590, `two` 595, `three` 600, required `pi` 604, `clamp` 607.

## Decision (root): host libm through bun:ffi

- **What Miri does:** established from the pinned Miri binary,
  `$RUST_TS_DATA/rustup-miri/toolchains/nightly-2026-10-11-aarch64-apple-darwin/bin/miri`, with `nm -u` and
  `otool -tV`.
  - f64 calls libSystem `sin cos exp exp2 log log10 log2 pow`.
  - f32 calls `sinf cosf expf exp2f logf log10f log2f powf`.
  - f16 is `fcvt` to f32, then the f32 call, then `fcvt` back.
  - `powi` is compiler-builtins' `__powisf2` / `__powidf2`, statically linked. f16 uses `__powisf2`.
  - `math.rs` has no f128 host op.
- **The port:**
  - `src/rust_ts/host_libm.ts` `dlopen`s the host C math library and exposes those 16 entry points:
    - macOS: `/usr/lib/libSystem.B.dylib`.
    - Linux: `libm.so.6`.
    - Windows: `ucrtbase.dll` (untested).
    - Anything else: `unported`.
  - `math.ts` `HOST_F64` / `HOST_F32` / `HOST_F16` call it.
  - `powi` is a port of compiler-builtins `float/pow.rs:4 pow` (the pinned `library/compiler-builtins`).
  - JS `Math.*` is no longer used for host ops: JavaScriptCore has no `exp2`, its `pow` has its own fast paths, and
    f32 via f64 rounds twice.
- **Why it is faithful:** Miri itself uses the host libm, so on every host the port reproduces Miri on that same host.
  This is the D7 precedent (`proc_macro_host.ts`): an FFI edge where there is no Rust source to port.
- **Cost:** about 5 ns per call.
- **Caveat:** the results also depend on the macOS version. The fixture was recorded on macOS 26.7.1 (25G241). If an
  OS update changes Apple's libm, the oracle Miri and the port change together, but the fixture becomes stale.
  Regenerate it then, and treat a hash mismatch right after an OS update as that first.
- Not recorded with `state.ts record decision` (root's call). The `// PORT:` notes are in the `math.ts` header and the
  `host_libm.ts` header.

## Files touched

- Integration with integ-w36: stand-ins swapped for owners that landed.
  - `src/miri/bin/miri.ts` (miri-driver's file):
    - `MiriConfig_default()` / `PENDING_MIRI_CONFIG_DEFAULT` are removed; the code calls `MiriConfig.default()`.
    - The `eval_entry` results no longer pass through `as_exit_result`.
    - `run_genmc_mode`, still miri-threads' `Pending<"NonZeroI32">` stub, converts both ways with
      `as_exit_result` / `as_pending_exit_result`.
  - `src/miri/bin/miri.test.ts`: the pending hook becomes a `spyOn(MiriConfig, "default")` that wraps the real
    default. A new test checks the real default against the upstream listing, and checks the Fx types.
  - `src/miri/eval.ts`:
    - `MiriConfig.default()`: `set_env_vars` is `FxHashMap.default(String_key, LAYOUT_VEC)`, because shims/env.rs:47
      iterates it.
    - `tracked_pointer_tags` / `tracked_alloc_ids` are `FxHashSet.default(usize_key)` (`NonZero<u64>` hashes as a
      u64, which FxHasher treats as usize on 64-bit hosts).
    - The local `as_genmc_ref` is replaced by miri-race's `GlobalDataRaceHandler.as_genmc_ref`.
    - `MAIN_THREAD` stays local, because miri-threads has not landed.
  - `src/miri/helpers.ts`: `throw_machine_stop` boxes through miri-driver's `TerminationInfo_into_machine_stop`, no
    longer `unported`. This affects isolation aborts and `TerminationInfo::Exit` in eval.ts.
  - `src/miri/helpers.test.ts`: `isolation_abort_error` now asserts the `MachineStop(UnsupportedInIsolation(..))`
    error.
  - `src/miri/operator.ts`, `math.ts`, `helpers.ts`: `machine_rng(...)` casts are removed. `machine.rng` is typed
    `StdRng` by the typemap change miri-machine already applied; it was not re-applied here.
  - `src/miri/machine.ts` (miri-machine's file):
    - Removed the pending `generate_nan` overload declaration.
    - The `generate_nan` hook calls `ecx.generate_nan(inputs, F2_)` with miri-eval's signature. The inputs are cast to
      `IeeeFloat`, because interpret/machine.ts declares `F1` without its `Float + FloatConvert<F2>` bound.
- The fixes:
  - `src/rust_ts/host_libm.ts` (new): the FFI glue.
  - `src/miri/math.ts`: the host ops (above), the compiler-builtins `pow` port, `f16_round`, and the `IeeeExt` order.
  - `src/miri/operator.ts`: `make_signaling` is nested.
  - `src/miri/math.test.ts`:
    - Part 1: all helper lines, with per-line draw counts.
    - Part 2: three host-op tests (f64 / f32 / f16), each hashing its sample like the probe; `skipIf` on another host.
  - `src/miri/math.oracle.txt`: regenerated from the new probe (125 lines).
  - `docs/handoff/miri-eval-fix-probe/{Cargo.toml,Cargo.lock,main.rs}` (new): the probe source, following the
    vendor-rand precedent. `miri-f16-powi/` holds the real-Miri check.

## Probe (math.oracle.txt)

- **Source:** `docs/handoff/miri-eval-fix-probe/main.rs`.
- **Inputs:**
  - `Cargo.lock` pins rand 0.10.1 / chacha20 0.10.0 / rustc_apfloat 0.2.3, as in Miri's Cargo.lock.
- **Build:**
  `CARGO_TARGET_DIR=$RUST_TS_DATA/tmp/miri-eval-fix/mirimath-target cargo +nightly-2026-10-11 build --offline --release`,
  run in that directory.
- **Run:** `<target>/release/mirimath aarch64-apple-darwin > src/miri/math.oracle.txt`.
- **Locate a host-op mismatch:** `mirimath <tuple> dump <f64|f32|f16> <op>` prints the oracle words, in the order
  `math.test.ts` `port_hash` computes them.
- **Fidelity check:** its binary takes Miri's code paths. It has the same 16 libm imports, `fcvt`+`sinf`+`fcvt` for
  f16, `bl ___powisf2` / `___powidf2`, and no `fmul h` (f16 multiply) anywhere. All inputs and exponents go through
  `black_box`.
- **Queued harness item:** register it as `tools/probes/mirimath` (a harness batch). The real-Miri f16 `powi` check is in
  `docs/handoff/miri-eval-fix-probe/miri-f16-powi/` (`powih.rs` + `compare.ts`).

## Verification

- `bunx tsc --noEmit -p .`: 0 errors.
- `bun scripts/coverage.ts --check --offline`: `markers ok (23785; vendor 5050)`.
- Coverage `--missing`:
  - eval.rs 9/9
  - helpers.rs 71/71
  - operator.rs 4/4
  - math.rs 45/45
  - clock.rs 10/10
- Codegen: `bun tools/codegen/types.ts miri` regenerates with no diff (0 unknown types, missing debug 13 / clone 2,
  as before).
- `RUST_TS_REQUIRE_PROBES=1 bun test src/miri src/rustc_const_eval src/std` ×3, on the final tree: 201 pass,
  1 fail on each run, the same failure every time (no flake).
  - The failure is `src/std/result.test.ts` "non-test code never reaches the one-argument unwrap_result". It flags 5
    lines that exist unchanged on integ-w36, in other lanes' files:
    - `src/miri/alloc/alloc_bytes.ts:113`
    - `src/miri/alloc/alloc_bytes.ts:166`
    - `src/miri/machine.ts:865`
    - `src/miri/machine.ts:1135`
    - `src/miri/alloc_addresses/mod.ts:216`
  - Fix for each: pass `debug_AlignFromBytesError` / the `Layout` error's debug fn. Not edited here (owners' files;
    root or the owners).
  - This lane's two hits (`helpers.ts` `read_wide_str` / `read_c_str_with_char_size` call sites) are fixed.
  - The predecessor's unnamed first-run failure did not recur in 6 runs (3 on an intermediate tree, 3 on the final
    one). The predecessor ran only `src/std/time.test.ts`, so it never ran this lint.
- `bun scripts/difftest.ts --suite mir --sample 200` (agent `miri-eval-fix`): MATCH=200 DIFF=0 UNPORTED=0 CRASH=0, run
  `20261101-141509-miri-eval-fix-pqhz`.
- Mutation check: the tests fail with the reviewer's two divergences put back (f32 `sin` = `Math.fround(Math.sin)`,
  f64 `exp2` = `2 ** x`). Reverted after the check.
- Real-Miri f16 `powi`, exhaustive (65,536 inputs per exponent):
  - Command: the isolated Miri, `--target x86_64-unknown-linux-gnu -Zmiri-deterministic-floats`, running
    `docs/handoff/miri-eval-fix-probe/miri-f16-powi/powih.rs` (17 min).
  - Compared with `compare.ts` in the same directory. Results, as mismatches of the port / of the per-step-f16 model:

    | n | port | per-step-f16 model |
    |---|---|---|
    | 3 | 0 | 5,176 |
    | −3 | 0 | 14,018 |
    | 2 | 0 | 0 |
    | 5 | 0 | 6,786 |
    | −7 | 0 | 8,492 |
    | 11 | 0 | 4,700 |

  - NaN results are compared as NaN, because Miri's `adjust_nan` regenerates them.
- `math.test.ts` takes about 20 s (f64 5 s, f32 5 s, f16 10 s), almost all of it apfloat conversions; the FFI is
  about 5 ns per call.

## `unported(...)` left

- `rust_ts::host_libm (the host C math library on <platform>)`: only for platforms other than darwin, linux and
  win32.
- Unchanged from miri-eval:
  - `gen_random` with isolation off (getrandom, plan-m6 D5).
  - `MonotonicClock::sleep` past 2^53 ns (decision C5).
- Gone: the `throw_machine_stop` unported (miri-driver landed).

## `// PORT:` decisions

1. **Host float ops** (`math.ts` header and `host_libm.ts` header): call the host libm through FFI. See "Decision"
   above.
2. **`compiler_builtins_pow`:**
   - f32 products and the reciprocal are `Math.fround` of the f64 operation. That is correct rounding: the f64
     result of `*` or `/` on two f32 values, rounded again to f32, is correctly rounded, because 53 ≥ 2·24+2.
   - `Int::abs_diff(b, 0)` is `Math.abs(b)`, with `>>>= 1` so that 2^31 works.
3. **`f16_round`:** an f32 value is exact in an f64, so the apfloat Double→Half conversion is the same single rounding
   as `fcvt h0, s0`.
4. **NaN outputs are hashed as one canonical NaN** in the probe and the test. Every caller of a host op
   (`host_unary_float_op`, `pow_intrinsic`, `powi_intrinsic`, the SIMD ops) passes NaN results through `adjust_nan`,
   which picks the NaN again from the inputs. So a host NaN's sign and payload are not observable.
5. `machine.ts` `generate_nan` hook: the `IeeeFloat` cast (above).

## Notes for other lanes / root

- `shims/math.rs` (the `cbrtf sinhf tanhf asinhf tgammaf erff erfcf hypotf atan2f fdimf` foreign items and the f64
  ones) also computes with host floats. Its owner should check each op in the Miri binary, as done here:
  - Some std methods call libm (`cbrt` → `cbrtf`, ...). Those belong in `host_libm.ts`.
  - Others are Rust code in std (for example `asinh`, `acosh`). Those must be ported, not taken from libm or JS
    `Math.*`.
- `lib.ts` still re-exports only `type MiriConfig`, so bin/miri.ts imports the value from `../eval.ts`.
- miri-threads, when it lands:
  - Retype `run_genmc_mode` to `Result<null, number>` and drop `as_exit_result` / `as_pending_exit_result` in
    `bin/miri.ts`.
  - Export `ThreadId.MAIN_THREAD`, so eval.ts can drop its local.
