# Handoff: miri-x86-a (M6 wave 38: x86 intrinsics, SSE family)

Branch `t3/port-miri-x86-intrinsics`, base main `c9d3c553`. Scope: `src/tools/miri/src/intrinsics/x86/{mod, sse, sse2, sse3,
ssse3, sse41, sse42}.rs`. Lane miri-x86-b ports the other x86 files against this lane's `mod.ts`; its branch
`t3/miri-x86-b-on-x86-a` merges both lanes and removes its stand-ins.

## For root

1. **`-C target-feature` stops the port before Miri runs** (also miri-x86-b's item 1). `src/rust_ts/codegen_backend.ts`
   `non_default_llvm_input` stops `unported("rustc_codegen_llvm::llvm_util::configure_llvm (-C target-feature)")`. So a real
   program using SSE3 or later reports UNPORTED, although the intrinsics themselves are ported. The target's defaults are only
   `fxsr, sse, sse2, x87`, so SSE and SSE2 are unaffected. The run-pass-miri sample below has 2 such cases (both sanitizer
   `kcfi`, unprotected). Not this lane's file. Needs a lane that computes the feature set. Until then this lane's tests go through
   `probes/driver.mts`, which adds the features to `target_config`.
2. **Merge this lane and miri-x86-b together.** `x86.test.ts` "values: wide" needs miri-x86-b's real `avx2.ts`. On this branch
   alone it skips, with a printed reason, and the gate's skip allowlist rejects a skip. On the merge it runs and passes (checked,
   see below). The stale comments in `src/miri/intrinsics/mod.ts` (lines 8-9, 305-306: "stops `unported` until ported") belong to
   that file's owner.
3. **Cost.** `x86.test.ts` takes about 3.5 CPU-minutes (203 s user for its 23 tests before "wide" was added; 18 min wall at load
   ~100). Each test has a 20 min timeout. It adds 750 KB of fixtures; the `*.oracle.out` files are binary to git (they contain NUL).

## Files touched

- `src/miri/intrinsics/x86/{mod,sse,sse2,sse3,ssse3,sse41,sse42}.ts`: ported; they replace the stubs.
- `src/miri/intrinsics/x86/x86.test.ts` (new): the oracle fixture test.
- `src/miri/intrinsics/x86/probes/` (new):
  - `common.rs`: the probes' runtime.
  - Value probes: `sse.rs`, `sse2.rs`, `ssse3.rs`, `sse41.rs`, `sse42.rs`, `adx_pclmul.rs`, `wide.rs`.
  - Error probes: `err_*.rs` (14).
  - `<case>.oracle.{out,stderr,exit}`: fixtures from the isolated Miri.
  - `regen.sh`: regenerates every fixture (`RUST_TS_DATA=<data> src/miri/intrinsics/x86/probes/regen.sh`).
  - `driver.mts`: test scaffold, the port's `miri` entry plus `$X86_PROBE_FEATURES`. It is `.mts` because
    `src/miri/contract.test.ts` requires every `.ts` under `src/miri` to mirror an upstream file.
- `docs/handoff/miri-x86-a.md` (this file).

## Coverage

`bun scripts/coverage.ts --missing <file>`: mod.rs 35/35, sse.rs 1/1, sse2.rs 1/1, sse3.rs 1/1, ssse3.rs 1/1, sse41.rs 1/1,
sse42.rs 5/5. `--check --offline`: markers ok.

## `unported(...)` left

None in these files.

## Verification

Results marked (F) are from the final commit, see "Final run" at the end. The difftests and upstream programs ran on `0001ccf9` +
the driver rename; the lane's ported code has not changed since `542e1adb`.

**Oracle fixtures (`x86.test.ts`)**: each probe runs end to end on the port and must equal what the isolated Miri produced, on
target x86_64-unknown-linux-gnu, default seed.

- **Value probes.** Every string in the match arms of the seven files (112 arms, checked mechanically against the probes'
  `link_name`s, 0 missing) is called directly by link name. Inputs:
  - NaN (quiet, payload, negative, signaling), ±0, ±inf, denormals, MAX/MIN, ties, and the i32/i64 conversion limits.
  - All 16 rounding values on `round.{ss,ps,sd,pd}`.
  - Shift counts 0..=256 and beyond, including counts above 2^32 and with garbage in the high qword.
  - Saturation limits, including the `pmaddwd` overflow case.
  - The sse42 string compares: all 128 imm values on 4 string pairs (implicit length), 12 imm on 4 more, 26 imm on 10 explicit
    length pairs including negative and over-long lengths, plus imm bit 7.
  - `crc32.*`, `addcarry` / `subborrow`, `pclmulqdq{,.256,.512}`, `sse2.pause`.
- **Float noise.** `sse`, `sse2` and `sse41` run both by default and with `-Zmiri-deterministic-floats`. The two fixtures of each
  differ, so the seeded `rcp` / `rsqrt` error and the NaN choices are compared bit for bit, not just skipped.
- **`wide.rs`** covers what only the AVX files reach: `shift_simd_by_simd`, `test_high_bits_masked`, `permute`, `permute2`, the 2-
  and 4-chunk paths of `split_simd_to_128bit_chunks`, and `cmp_from_imm`'s AVX bits (imm 0..32). Run on `t3/miri-x86-b-on-x86-a`
  (`07c3ecaf`) with this test file copied in: 1 pass, byte-identical.
- **Error probes.** 12 compare the whole stderr and exit status: missing target features, AVX imm bit without AVX, unknown names
  (`can't call LLVM intrinsic ...`), wrong argument count, uninit operand, null `ldu.dq`. The 2 panic probes (`cmp_from_imm`,
  `rounding_from_imm`) compare the panic text and exit 101; the ICE frame around the text is the driver's and differs by design.
- **Mutations** (each reverted):
  - Fixtures caught: `pmulhrsw` without the `+ 1`, rounding mode `0b100` falling through to the panic, sse42 polarity on `len2`,
    `packsswb` negative saturation to 0, `Min` without its ±0 clause.
  - One survived and is equivalent: dropping `==` from `left >= right` in `Min`. Equal non-zero floats have identical bits, and
    zeros take the earlier clause.

**Upstream's own programs** (`tests/pass/shims/x86/intrinsics-x86{,-sse,-sse2,-sse3-ssse3,-sse41,-sse42,-pclmulqdq,-adx}.rs`), one-off,
with their `-C target-feature` flags on the oracle and the same features through `driver.mts` on the port: exit 0 on both, all 8.

**Suites and checks**:

- `bunx tsc --noEmit -p .`: 0 errors.
- `bun scripts/difftest.ts --suite miri-hello`: MATCH=1, run `20261104-002159-miri-x86-a-acuo`.
- `bun scripts/difftest.ts --suite run-pass-miri --sample 200` (agent `miri-x86-a`): MATCH=193 DIFF=0 UNPORTED=6 TIMEOUT=1 CRASH=0,
  run `20261104-005040-miri-x86-a-i6x0`. None of the 7 reaches this lane's code:
  - UNPORTED, all unprotected: `-C lto` `each_linked_rlib` (2, `issue-64655-extern-rust-must-allow-unwind`), `parse_native_lib` (1,
    `library-override`), `-C target-feature` (3, `sanitizer/cfi/{async-closures,self-ref,supertraits}`; see "For root" 1).
  - TIMEOUT, protected: `tests/ui/macros/rfc-2011-nicer-assert-messages/feature-gate-generic_assert.rs` at load ~100-200. Run alone
    it matches: run `20261104-010404-miri-x86-a-we24`.
- `bun test src/miri`: see "Final run".

Two failures in the earlier full run, both resolved:
- `contract.test.ts` flagged `probes/driver.ts`: fixed by renaming to `.mts`. Now 8 pass.
- `files_stdout.test.ts` "Stdout write: a tail >= the buffer capacity": a 5 s timeout at load ~100. Passes alone; not this lane's.

## What I could not check against the oracle

- **The real `-C target-feature` path on the port** ("For root" 1). The tests add the same features to
  `Session::internal_target_features` instead, and `cfg(target_feature)` in the user crate is not set by that. The oracle's flag does
  set it. The value and error probes do not read `cfg(target_feature)`.
- **The 32-bit branches** (`arch != X86_64` → `NotSupported` in `addcarry.64`, `subborrow.64`, `crc32.64.64`): the Miri suites only
  run x86_64-unknown-linux-gnu.
- **Other seeds and float flags:** only the default seed and `-Zmiri-deterministic-floats` were compared, not `-Zmiri-seed=N` or
  `-Zmiri-max-float-error`.
- **`assert_eq!` / `assert!` failures on mismatched vector shapes:** not exercised. They would ICE on both sides, and their texts
  follow Rust's format by construction, not by comparison. The `.unwrap()` in `split_simd_to_128bit_chunks` is unreachable in practice.
- **AVX arms beyond `wide.rs`:** those are miri-x86-b's to report. Its merge run ran every avx, avx2 and avx512 arm through these
  helpers at least once with no differing line, not every line (docs/handoff/miri-x86-b.md).

## `// PORT:` decisions

- **Extension traits** (C2): `declare module` of `InterpCx`. Sibling `emulate_x86_*_intrinsic` calls are methods, and `mod.ts` does not
  import the sibling modules (PORTING §5; lib.ts loads them).
- **Generic floats:** `F: Float` fns take a trailing `F_` dictionary (src/miri/math.ts convention), agreed with miri-x86-b.
- **`impl FloatBinOp`** is on the companion const: `FloatBinOp.cmp_from_imm(ecx, imm, intrinsic)`.
- **Integers:** `u64` lengths and indices are `bigint` (C5, what `project_index` takes); `u128` is `bigint`; up to 32-bit values are
  `number`. `default_len::<T>` returns `number`; `u64` callers wrap it in `BigInt`.
- **`strict_*`** on SIMD lengths, indices and bounded u16 sums are plain operations: they cannot overflow.
- **Formatting:** `{imm:x}` / `{rounding:02x}` print two's-complement bits, matching the oracle's `0xff` and `0xfffffff7`.
- **Comparisons:** apfloat `<`, `<=`, `>`, `>=` are `partial_cmp` tests; `!=` is `partial_cmp !== 0` (true on NaN, like `!eq`).
- **`!op`** on a u128 in `test_high_bits_masked` is a bigint `~`: `& mask` gives the same value.
- **Helpers not in upstream** (private to their file): `u128_checked_shl`, `checked_shr`, `u32_saturating_from`,
  `u64_widening_carryless_mul`, `u64_is_power_of_two`, `read_u8` / `read_i8` / `read_i16` (the `?` chains of `pmaddwd`, `pmaddbw`,
  `pmulhrsw`, `pshufb`).
- **`shift_simd_by_*`** keep their duplicated match, as upstream.

## Exports for other lanes

All `mod.rs` fns are exported under upstream names with `ecx: MiriInterpCx` first, operands `OpTy`, `dest: MPlaceTy`, upstream
argument order. `split_simd_to_128bit_chunks` returns `[bigint, bigint, P]`, `extract_first_u64` a `bigint`, `pclmulqdq` takes
`len: bigint`.

## Final run
