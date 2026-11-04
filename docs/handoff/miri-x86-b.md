# Handoff: miri-x86-b (M6 wave 38: x86 AVX, AES, BMI, GFNI, SHA intrinsics)

Branch `t3/port-miri-x86-intrinsics-1`, base main `c9d3c553`. It builds on its own, with stand-ins for miri-x86-a's helpers.

**Integration aid:** branch `t3/miri-x86-b-on-x86-a` merges this lane with miri-x86-a's `t3/port-miri-x86-intrinsics` and
adds one commit that removes the stand-ins (see "Stand-ins to remove"). Replay that commit, or use the branch, when merging both lanes.

## Decisions root needs to look at

1. **`-C target-feature` stops the port before Miri runs.** `src/rust_ts/codegen_backend.ts` `non_default_llvm_input` stops
   `unported("rustc_codegen_llvm::llvm_util::configure_llvm (-C target-feature)")`, and `target_config` takes the feature
   set from the oracle table only. So **no real program can reach most x86 intrinsics through the port yet**: without the
   flag, `expect_target_feature_for_intrinsic` reports the feature as missing. Upstream's x86 tests pass this flag
   (`compile-flags: -C target-feature=..`), so they will all report UNPORTED. Not this lane's file, and not Miri-specific:
   it needs an owner before x86 counts towards miri-pass. Root's rerun of the fixtures (below) hits this too.
2. **The `aes` crate stays `unported`, as plan-m6 D5 says, although the lane brief asks for AES known vectors.** I followed
   D5 and my file list rather than adding `src/vendor/aes` and a `harness/scope.json` entry. So aesenc, aesenclast, aesdec,
   aesdeclast (all widths) and aesimc stop `unported` in the port. `aeskeygenassist` needs no crate and is fully checked.
   The known vectors are in the oracle fixtures, so they are ready for the crate (`aes_rounds.oracle.txt`, FIPS-197 C.1).
   To lift it, port `aes-0.9.0/src/soft/fixslice64.rs`'s `mod hazmat` and fill the four `hazmat_*` stand-ins in aesni.ts;
   the closures around them are ported already, and `x86b.test.ts`'s AES-unported test then needs updating. The version is
   aes 0.9.0 (the root `Cargo.lock`, which the component is built from).

## Files touched

- `src/miri/intrinsics/x86/{avx,avx2,avx512,aesni,bmi,gfni,sha}.ts` (ported; they replace the stubs)
- `src/miri/intrinsics/x86/x86b.test.ts` (new)
- `src/miri/intrinsics/x86/fixtures/` (new): the oracle programs (`*.rs`, `prelude.rs`) beside their output (`*.oracle.txt`)
- `docs/handoff/miri-x86-b-probe/gen.ts` (regenerates the fixtures) and `e2e.ts` (runs them through the port). They live
  here because `contract.test.ts` rejects any other `.ts` under `src/miri`.

## Coverage

`bun scripts/coverage.ts --missing`: avx.rs 1/1, avx2.rs 1/1, avx512.rs 2/2, aesni.rs 3/3, bmi.rs 1/1, gfni.rs 3/3, sha.rs 7/7:
18/18, nothing missing. `coverage.ts --check --offline`: `markers ok`.

## Verification

- `bunx tsc --noEmit -p .`: 0 errors, on this branch and on the integration branch with the stand-ins removed (so the
  signatures agreed with miri-x86-a hold).
- `bun test src/miri`: 258 pass, 0 fail, on this branch.

### Fixtures

From the isolated Miri (`bun docs/handoff/miri-x86-b-probe/gen.ts`, target x86_64-unknown-linux-gnu, default seed), 24 programs:

- `bmi`: all eight forms, with zero inputs, counts at and past the width, and all-ones masks (480 lines)
- `gfni`: mulb and both affine forms at 128/256/512: identity, zero, all-ones and bit-reversal matrices, the AES matrix, a
  different matrix per chunk, and the AES S-box as a known value (asserted in the program)
- `sha`: random and zero / all-ones cases, and SHA-256("abc") computed through the intrinsics (asserted against FIPS 180-4)
- `aes_keygen`: FIPS-197 A.1 key expansion (asserted). `aes_rounds`: all widths, and FIPS-197 C.1 encrypt and decrypt (asserted)
- `avx`, `avx2`, `avx512`: every match arm. Includes all 32 cmp predicates, NaN / ±0 / ±inf, gather with masks, scales, negative
  offsets and length mismatches, shift counts past the width, and `_mm512_mask(z)_*` forms for mask-register behaviour
- `err_*`: missing-feature UB, unknown-name "can't call LLVM intrinsic", wrong argument count, gather out of bounds, and the two
  gather panics. ICE fixtures keep only the panic message, since the rest of the report is host paths.

All 127 string match arms of avx, avx2, avx512, aesni, gfni and sha appear in a fixture; bmi's are all in `bmi.rs`.

### Checked directly (`x86b.test.ts`, on this branch alone)

The entry points run on a stand-in `ecx` over byte buffers, against the oracle's lines. All match: bmi 480, gfni 48, sha 52,
aeskeygenassist 9, avx512 pternlog + vpdpbusd 16, avx vpermilvar + ldu 9, avx2 gather 41. Also the missing-feature texts, NotSupported
outcomes and their order of checks, the two gather panic texts, and that the aes calls stop `unported`.

Mutation check (12 mutations, all reverted): 11 fail the tests. The twelfth, dropping `| 0` in vpdpbusd, is equivalent because
`Scalar.from_i32` truncates. One other mutant exposed a test gap, now closed (destinations are prefilled with junk).

### End to end

Run on a throwaway merge with miri-x86-a's `f9f88ec7`..`542e1adb` through `src/miri/bin/miri.ts`, under a load average of 50-370.
**Every program with a `-Ctarget-feature` flag (19 of 24) needed a temporary rig that is not committed:** a local patch to
`codegen_backend.ts` accepting the flag, with feature sets taken from the oracle's `rustc --print cfg`. So this shows the intrinsics
agree once decision 1 is resolved; it does not show that the port accepts the flag.

| program | result |
|---|---|
| all 16 `err_*` | MATCH: stdout, exit and stderr byte-identical (panics by message; the port's ICE format is lane ice-report's) |
| `aes_keygen`, `sha` | MATCH in full |
| `aes_rounds` | UNPORTED, as expected: `aes::hazmat::cipher_round` |
| `avx`, `avx2`, `avx512` | timed out at 50 min: first 60/141, 45/164, 19/62 lines identical, then the tails below |
| `bmi` | timed out at 50 min: first 201/480 lines identical (32-bit forms); the 64-bit forms are checked directly only |
| `gfni` | timed out at 50 min: first 38/48 lines identical (all 128-bit forms and mulb at every width); affine at 256/512 is checked directly only |

For the tails, I ran scratch copies whose `t!` calls each not-yet-seen link name once: avx 19 lines, avx2 30, avx512 17 (with
masks at one mask value each). Every line is in the fixture. Together with the prefixes, every arm of avx, avx2 and avx512 has run
through the real interpreter and miri-x86-a's helpers at least once. **Not yet compared in full:** the later lines of those three, of
bmi and of gfni. No line that ran differed from the oracle.

The port took 2,180 s on `sha` against 16 s for the oracle, under that load.

### For root after merging

`bun docs/handoff/miri-x86-b-probe/e2e.ts [--jobs N] [--timeout-ms N] [name..]`. Without decision 1 resolved, every program with a
`-Ctarget-feature` flag reports UNPORTED at `configure_llvm`; only the five flagless `err_*` programs can run.
Allow hours per large program, or more once the machine is quiet. On a timeout it reports how many stdout lines matched.
Then remove the stand-ins (below) and `bun test src/miri` as a whole.

## Stand-ins to remove at merge

All marked `// PORT(contract): pending miri-x86-a`. Delete them and the calls keep working, because they go through `x86.` / the companion:

- `avx.ts`: `declare module "./mod.ts"` with `bin_op_simd_float_all`, `round_all`, `unary_op_ps`, `conditional_dot_product`,
  `convert_float_to_int`, `test_bits_masked`, `test_high_bits_masked`
- `avx.ts`: `function cmp_from_imm`, a forwarder to `FloatBinOp.cmp_from_imm` (replace its two calls)
- `avx2.ts`: `declare module "./mod.ts"` with `pmaddbw`, `mpsadbw`, `pmulhrsw`, `packsswb`, `packssdw`, `packuswb`, `packusdw`, `permute`,
  `psadbw`, `pshufb`, `psign`, `shift_simd_by_scalar`, `shift_simd_by_simd`, `pmaddwd`
- `avx512.ts`: `declare module "./mod.ts"` with `permute2`

While these blocks are present, TS merges them with the real exports as overloads without complaint, so a signature mismatch only
shows once they are deleted. It showed none (0 errors).

## `unported(...)` left

Only `aesni.ts`: `aes::hazmat::cipher_round`, `equiv_inv_cipher_round`, `mix_columns`, `inv_mix_columns` (plan-m6 D5).

## `// PORT:` decisions

- Trailing `F_` float dictionary for `bin_op_simd_float_all` / `round_all` (src/miri/math.ts convention, agreed with miri-x86-a).
- Indices, `u64` and `i64` are `bigint` (C5); `u128` is `bigint`; `u32` lanes are numbers kept unsigned with `>>> 0`.
- Rust's shadowed projections are named `*_v` and per-element values `*_i` / `*_p` (TS has no same-scope shadowing, and a nested
  `const` would hit the temporal dead zone).
- `strict_*` that cannot overflow are plain arithmetic, with the reason in each file's header. The gather's `i64::strict_mul` can
  overflow, so it is checked; the oracle confirms the text `attempt to multiply with overflow`.
- `aes::Block` is a 16-element `number[]`, mutated in place as `&mut Block` is.
- `static TABLE` in gfni.ts is computed once at module load, from its own hoisted `gf2p8_mul` (C10 holds).
- `sha.rs`'s nested `read` / `write` stay nested, with their markers; `mod sha256` is math.ts's flattened `round` / `sigma0` / `sigma1`.

## Signatures

The seven `emulate_x86_*_intrinsic` declarations are unchanged. miri-x86-a calls them as `InterpCx` methods.

## Notes

- Fixture programs use `extern "llvm-intrinsic"` and `simd_ffi`: at this pin `abi_unadjusted` is merged into `link_llvm_intrinsics`.
- Oracle ICE runs write `rustc-ice-*.txt` into their cwd unless `RUSTC_ICE=0`; gen.ts and e2e.ts set it. Any other harness running
  ICE cases from a source directory may want the same.
