# Handoff: cg-intrinsic-b (M7c, wave 40s): the rest of SIMD codegen, and `va_arg`'s other ABIs

Branch `t3/port-simd-vaarg-abis` (from `2bf7435a`; no merges). Commits at the end.

## Summary
- **`intrinsic.rs` 28/31 → 31/31; `va_arg.rs` 9/15 → 15/15.** Both files are now whole. No `unported("cg-intrinsic-b: …")` is
  left anywhere.
- **`generic_simd_intrinsic`:** every arm ir-fix-a left as a stop is ported, in upstream order, with the three nested fns
  (`simd_simple_float_intrinsic` :2496, `llvm_vector_ty` :2567, `llvm_alignment` :2671).
- **`va_arg.rs`:** the six target bodies (aapcs, powerpc, s390x, hexagon musl and bare metal, xtensa), plus `emit_va_arg`'s
  `assert_matches!` and MIPS `bug!` texts, which ir-fix-a had left as stops.
- **run-pass-native: 10 of the gate's 16 cg-intrinsic-b stops now MATCH** (and the same 10 in ir-run-pass at N1). The other 6
  stop in the IR model (ir-fix-b's; below). No case left MATCH.
- **Every newly ported arm has oracle IR and every reachable diagnostic has oracle stderr**, all byte-equal on the port.
- **Two IR-model gaps keep part of this from being exercised end to end** (signatures, `Triple::normalize`, `LLVMRustOptimize`
  with global features). I checked those paths by patching the model locally (not committed): the port's IR was then the
  oracle's. The tests accept today's model stops and switch to an IR comparison once the model has them.

## Arms and ABIs ported
### `generic_simd_intrinsic` (intrinsic.rs :2411–:3466), commit `e9082cc8`
In upstream order:
- `simd_select` (:2411), including the scalable-vector branch;
- `simd_simple_float_intrinsic` (:2496) and its call for the 16 float names (`simd_ceil` … `simd_trunc`);
- `llvm_vector_ty` (:2567); `simd_gather` (:2578); `llvm_alignment` (:2671); `simd_masked_load` (:2684);
  `simd_masked_store` (:2771); `simd_scatter` (:2852);
- `arith_red!` (:2938) and its four expansions (`simd_reduce_{add,mul}_{ordered,unordered}`);
- `simd_cast_ptr` (:3091), `simd_expose_provenance` (:3137), `simd_with_exposed_provenance` (:3165);
- `simd_cast` / `simd_as` (:3193), every `Style` pair;
- the unary integer arm (:3357: `simd_bswap`, `simd_bitreverse`, `simd_ctlz`, `simd_ctpop`, `simd_cttz`,
  `simd_carryless_mul`, `simd_funnel_shl`, `simd_funnel_shr`);
- `simd_arith_offset` (:3425), `simd_saturating_add` / `simd_saturating_sub` (:3446).

The gate-reached ones first, as asked: `simd_cast`, `simd_gather`, `simd_fabs`, `simd_funnel_shl`, `simd_saturating_add`,
`simd_as`, `simd_bswap`, `simd_reduce_add_ordered`, `simd_select`, `simd_cast_ptr`, `simd_ceil`, `simd_masked_load` are all in.

### `va_arg.rs`, commit `8741851a`
- `emit_aapcs_va_arg` (:189), `emit_powerpc_va_arg` (:293), `emit_s390x_va_arg` (:423), `emit_hexagon_va_arg_musl` (:832),
  `emit_hexagon_va_arg_bare_metal` (:915), `emit_xtensa_va_arg` (:952), wired into `emit_va_arg`'s dispatch.
- `std::assert_matches!(stability, CVariadicStatus::Unstable { .. })` (RiscV32 ilp32e, Sparc, Avr/M68k/Msp430, custom
  targets) is `assert_unstable`, core's text through `std/panic.ts`'s `assert_matches` and `debug_CVariadicStatus`.
- MIPS's `bug!("unexpected LLVM ABI {other}")` uses `LlvmAbi.display`.
- `bx.va_arg(..)` (Avr/M68k/Msp430) is now `va_arg_inherent`: Rust resolves it to the inherent `Builder::va_arg`
  (builder.rs:1875), not the trait method. Both bodies are the same `LLVMBuildVAArg`, so the output does not change.

### Left
- Nothing in either file. `bun scripts/coverage.ts --missing`: `31/31 ported` and `15/15 ported`.

## Evidence
### Oracle fixtures (regenerated from the pinned rustc; `--crate-type lib --emit=llvm-ir -Cno-prepopulate-passes -O`)
- **`simd_oracle/simd2.rs`** → `simd2.x86_64-unknown-linux-gnu.O.ll`. 60 functions: one per arm the model can declare, and
  one per element kind or cast style where the arm branches (select with i32 and u8 masks; all 16 float intrinsics on f32
  and f64; the integer reductions; the three pointer casts; `simd_cast` identity / same-width / trunc / sext / zext /
  isize / sitofp / uitofp / fptoui / fptosi / fptrunc / fpext; `simd_as` float-to-int (both `fpto?i.sat`) and int-to-float;
  `simd_bswap` on u8 (the no-op) and u32; the rest of the unary integer arm; `simd_arith_offset` with isize and usize offsets;
  saturating add/sub, signed and unsigned). **The port's IR equals the oracle's.**
- **`simd_oracle/simd2_err.rs`** → `simd2_err.stderr`: 35 `InvalidMonomorphization` errors, every one the new arms can emit
  before they reach the model, except two that typeck makes unreachable (`ExpectedReturnType` of `simd_gather` and
  `simd_masked_load`; their return type is the type of `values`) and `CastWidePointer` (a SIMD element must be a scalar, so
  no vector of wide pointers gets this far). **The port's stderr equals the oracle's byte for byte.**
- **`simd_oracle/simd_model.rs`** → `simd_model.x86_64-unknown-linux-gnu.O.ll`: gather, scatter, masked load (Element and
  Vector alignment), masked store (Unaligned), and the four float reductions.
  - Today the port stops with `llir: the signature of llvm.masked.gather (Intrinsics.td) is not in the IR model`.
  - With the six signatures below added locally, its IR equaled the oracle's, call-site `align` attributes included. I
    reverted that patch.
  - The test accepts exit 70 with one of those six signature stops. Otherwise it requires the oracle's IR.
- **`simd_oracle/simd_stop.rs` deleted.** Nothing in `generic_simd_intrinsic` stops by lane any more.
- **`va_arg_oracle/va_targets.rs`:** `#![no_core]`, minicore's `VaList`; the `va_arg` intrinsic for i32, u32, i64, u64, f64, a
  pointer and usize. No sysroot needed.
  - `va_targets.aarch64-apple-darwin.O.ll` (the host, `emit_ptr_va_arg`): **the port's IR equals the oracle's.**
  - `va_targets.aarch64-unknown-linux-gnu.O.ll` (`emit_aapcs_va_arg`, all four blocks): the port stops in the model at
    `llir: Triple::normalize("aarch64-unknown-linux-gnu")`, and after that at `LLVMRustOptimize with global target features
    "+v8a,+outline-atomics"`.
    - With both bypassed locally (the triple added to `NORMAL_TRIPLES`, the features guard off), the port's IR equaled the
      oracle's at `-O` and at `-Copt-level=0`. I reverted that patch too.
    - The test accepts either stop, else requires the oracle's IR.
  - Both sides run with `MACOSX_DEPLOYMENT_TARGET=11.0` (the default) so the darwin triple is fixed. That sets a child's
    variable; it reads none.
- **powerpc, s390x, hexagon and xtensa have no oracle comparison.** The port has no built-in target spec for them; only
  `src/rustc_target/spec/targets/` has 6. A custom JSON target stops at `rustc_target::spec::TargetTuple::from_path`.
  - Those four bodies are ported line by line but run by no test.
  - The oracle's JSON specs for them are one `--print target-spec-json` away once either path exists.

### Unit tests
- `simd_intrinsic.test.ts`: 10 tests, about 5.4 s (was 6 tests, about 3.5 s).
- `va_arg.test.ts`: 6 tests, about 2.8 s (was 2, about 1.3 s).
- Added wall time: about 3.5 s, within the 15 s budget.
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rustc_codegen_llvm/ ./src/rustc_codegen_ssa/ ./scripts/lib/unit-steps.test.ts`:
  **370 pass, 1 fail.**
  - The failure is `skeleton.test.ts` "stub counts per lane". It expects `"cg-intrinsic-b": 2` and gets none (see For root).
  - `bunx tsc` clean.
  - `bun scripts/coverage.ts --check`: markers ok.

### run-pass-native's cg-intrinsic-b stops (`--filter tests/ui/simd/`, all 39 cases there; run `cgib-simd-rpn`)
The accepted gate `gate-20261114-162816-root-vc2v` had 16 cases stopping in this lane. Now:

| case | gate | now |
|---|---|---|
| `simd/intrinsic/float-math-pass.rs` | `simd_fabs` | **MATCH** |
| `simd/intrinsic/generic-arithmetic-pass.rs` | `simd_funnel_shl` | **MATCH** |
| `simd/intrinsic/generic-arithmetic-saturating-pass.rs` | `simd_saturating_add` | **MATCH** |
| `simd/intrinsic/generic-as.rs` | `simd_as` | **MATCH** |
| `simd/intrinsic/generic-bswap-byte.rs` | `simd_bswap` | **MATCH** |
| `simd/intrinsic/generic-cast-pass.rs` | `simd_cast` | **MATCH** |
| `simd/intrinsic/generic-cast-pointer-width.rs` | `simd_cast` | **MATCH** |
| `simd/intrinsic/ptr-cast.rs` | `simd_cast_ptr` | **MATCH** |
| `simd/issue-39720.rs` | `simd_cast` | **MATCH** |
| `simd/libm_std_can_float.rs` | `simd_ceil` | **MATCH** |
| `simd/intrinsic/generic-gather-scatter-pass.rs` | `simd_gather` | llir: `llvm.masked.gather` signature |
| `simd/issue-85915-simd-ptrs.rs` | `simd_gather` | llir: `llvm.masked.gather` signature |
| `simd/issue-89193.rs` | `simd_gather` | llir: `llvm.masked.gather` signature |
| `simd/masked-load-store.rs` | `simd_masked_load` | llir: `llvm.masked.load` signature |
| `simd/intrinsic/generic-reduction-pass.rs` | `simd_reduce_add_ordered` | llir: `llvm.vector.reduce.fadd` signature |
| `simd/intrinsic/generic-select-pass.rs` | `simd_select` | llir: `FoldBitCast scalar-to-vector` |

- `simd/simd-bitmask.rs` and `simd/simd-bitmask-notpow2.rs` were UNPORTED in the gate and still stop at
  `llir: FoldBitCast scalar-to-vector`.
- The other 21 cases there were MATCH and still are.
- ir-run-pass on the same filter (run `cgib-simd-irp`, N1): exactly the same table.

### `--sample 200 --jobs 6` (`RUST_TS_AGENT=cg-intrinsic-b`)
| suite | total | MATCH | DIFF | UNPORTED | UNSTABLE | run |
|---|---|---|---|---|---|---|
| run-pass-native | 200 | 188 | 0 | 9 | 3 | `cgib-s200-run-pass-native` |
| ir-run-pass | 200 | 196 | 0 | 4 | 0 | `cgib-s200-ir-run-pass` |
| mir-o2 | 200 | 200 | 0 | 0 | 0 | `cgib-s200-mir-o2` |

- **No protected case (`harness/baseline/<suite>.txt`) left MATCH in any of the three.**
- Against the gate's status for the same cases, exactly one case changed: `simd/intrinsic/generic-cast-pass.rs`, which went
  from UNPORTED to MATCH in run-pass-native and ir-run-pass.
- The 3 UNSTABLE cases are the same ones, with the same status, as in the gate.

## IR-model needs (lane ir-fix-b, `src/rust_ts/llvm/`)
### Signatures missing from `intrinsics.ts`'s `SIGNATURES`
All of them are in `GENERIC_INTRINSICS` already. Lines are Intrinsics.td at the pin (`llvm-src/aab11ee0…`):

| intrinsic | Intrinsics.td | `def` |
|---|---|---|
| `llvm.masked.load` | 2723 | `DefaultAttrsIntrinsic<[llvm_anyvector_ty], [llvm_anyptr_ty, LLVMScalarOrSameVectorWidth<0, llvm_i1_ty>, LLVMMatchType<0>], [IntrReadMem, IntrArgMemOnly, NoCapture<ArgIndex<0>>]>` |
| `llvm.masked.store` | 2729 | `DefaultAttrsIntrinsic<[], [llvm_anyvector_ty, llvm_anyptr_ty, LLVMScalarOrSameVectorWidth<0, llvm_i1_ty>], [IntrWriteMem, IntrArgMemOnly, NoCapture<ArgIndex<1>>]>` |
| `llvm.masked.gather` | 2735 | `DefaultAttrsIntrinsic<[llvm_anyvector_ty], [LLVMVectorOfAnyPointersToElt<0>, LLVMScalarOrSameVectorWidth<0, llvm_i1_ty>, LLVMMatchType<0>], [IntrReadMem]>` |
| `llvm.masked.scatter` | 2741 | `DefaultAttrsIntrinsic<[], [llvm_anyvector_ty, LLVMVectorOfAnyPointersToElt<0>, LLVMScalarOrSameVectorWidth<0, llvm_i1_ty>], [IntrWriteMem]>` |
| `llvm.vector.reduce.fadd` | 2911 | `DefaultAttrsIntrinsic<[LLVMVectorElementType<0>], [LLVMVectorElementType<0>, llvm_any_vector_float_ty]>` |
| `llvm.vector.reduce.fmul` | 2914 | `DefaultAttrsIntrinsic<[LLVMVectorElementType<0>], [LLVMVectorElementType<0>, llvm_any_vector_float_ty]>` |

- **New descriptor kinds these need:**
  - `llvm_anyvector_ty` (an `Any` of class vector);
  - `LLVMVectorOfAnyPointersToElt<n>` (`IIT_VEC_OF_ANYPTRS_TO_ELT`, its own overload slot);
  - `llvm_any_vector_float_ty`.
- **What my local check used:** generic `any` slots in their places, mangled as `llvm.masked.gather.v4f32.v4p0`,
  `llvm.masked.load.v4f32.p0` and `llvm.vector.reduce.fadd.v4f32`. That was enough for the call text and the declarations'
  names and types to equal the oracle's. The declarations' attribute groups are outside the comparison.
- **Calls the port makes:**
  - gather / scatter with `[elem vector, pointer vector]`;
  - masked load / store with `[elem vector, ptr]`;
  - `vector_reduce_f{add,mul}[_reassoc]` (builder.ts, already ported).

### Other model stops reached
- **`Triple::normalize("aarch64-unknown-linux-gnu")`** (core.ts `NORMAL_TRIPLES`): blocks every aarch64-unknown-linux-gnu
  compile. The triple is its own normal form.
- **`LLVMRustOptimize with global target features "+v8a,+outline-atomics"`** (tools.ts:234): the next stop on
  aarch64-unknown-linux-gnu, at `-O` and at `-Copt-level=0`.
- **`FoldBitCast scalar-to-vector`:** blocks `simd/intrinsic/generic-select-pass.rs`, `simd/simd-bitmask.rs` and
  `simd/simd-bitmask-notpow2.rs`.

## For root
1. **`src/rustc_codegen_llvm/skeleton.test.ts`, not this lane's file, now fails one test.**
   - "stub counts per lane": delete the `"cg-intrinsic-b": 2,` entry (line 132). Neither file has a cg-intrinsic-b stub now.
   - Also update the comment at :112–113, which names `simd_stop.rs`. That fixture is gone; every arm is ported, and the
     model-stopped ones are tested by `simd_model.rs`.
2. **The three model gaps above are ir-fix-b's.**
   - When ir-fix-b adds the six signatures, `simd_model.rs`'s test starts comparing IR on its own.
   - When the aarch64 Linux triple and the features stop are lifted, `va_targets.rs`'s aapcs test does the same.
3. **Built-in target specs for a powerpc, s390x, hexagon (musl and none) and xtensa target**, or custom JSON targets in the
   port, would let those four va_arg bodies be compared. That work belongs outside this lane.

## `unported(...)` left
- None with this lane's name.
- intrinsic.ts's other stops are unchanged: cg-intrinsic-a's and the D18 exclusion.
- va_arg.ts has no `unported` at all now.

## `// PORT:` decisions
1. **intrinsic.ts, gather / masked load / masked store / scatter:** `p_ty.kind() == other.kind()` inside the `matches!`
   guards is `p_ty === other`.
   - `Ty` is interned, so two kinds are equal exactly when the types are.
   - The comment sits above `simd_gather`'s arm.
2. **intrinsic.ts:** the `require_simd!` / `require_simd_or_scalable!` closures take every variant their macros are invoked
   with (`SimdFirst` / `SimdSecond` / `SimdThird`, and `SimdReturn` for `simd_cast`). No logic changed.
3. **va_arg.ts header:** the `div_ceil` / `next_multiple_of` of sizes are written as `Math.ceil` forms, on values far below
   2^53.
4. **Tests:** `simd_model.rs` and va_targets' aapcs case accept today's named model stops instead of being skipped.
   - That keeps the oracle fixtures in the tree and checked for freshness.
   - It makes the tests switch to a full IR comparison by themselves when ir-fix-b lands.
   - Any other outcome fails.

## Files touched
- `src/rustc_codegen_llvm/intrinsic.ts`, `src/rustc_codegen_llvm/simd_intrinsic.test.ts`.
- `src/rustc_codegen_llvm/simd_oracle/`:
  - new: `simd2.rs`, `simd2.x86_64-unknown-linux-gnu.O.ll`, `simd2_err.rs`, `simd2_err.stderr`, `simd_model.rs`,
    `simd_model.x86_64-unknown-linux-gnu.O.ll`;
  - deleted: `simd_stop.rs`.
- `src/rustc_codegen_llvm/va_arg.ts`, `src/rustc_codegen_llvm/va_arg.test.ts`.
- `src/rustc_codegen_llvm/va_arg_oracle/` (new: `va_targets.rs`, `va_targets.aarch64-apple-darwin.O.ll`,
  `va_targets.aarch64-unknown-linux-gnu.O.ll`).
- `docs/handoff/cg-intrinsic-b.md`.

## Commits
- `e9082cc8` cg-intrinsic-b: port the rest of generic_simd_intrinsic
- `8741851a` cg-intrinsic-b: port va_arg.rs's remaining target bodies
- (this file) cg-intrinsic-b: handoff
