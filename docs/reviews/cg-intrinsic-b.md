# Review: lane `cg-intrinsic-b` (wave 40s)

- **Reviewer:** an independent, read-only session (AGENTS.md §1).
- **Subject:** branch `t3/port-simd-vaarg-abis`, `git diff 2bf7435a d4aa3ac2`.
  - Commits: `e9082cc8` (SIMD), `8741851a` (va_arg), `d4aa3ac2` (handoff).
  - Upstream: `compiler/rustc_codegen_llvm/src/{intrinsic,va_arg}.rs` at the pin `6f5da406`.
- **Setup:** reviewed on `t3/review-cg-intrinsic-b`, reset to `d4aa3ac2`.
  - `.env.local` was copied from `integ-w39`, with `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`.
  - The machine was on AC power, with no `GATE_RUNNING` file. Agent `rev-cgib-w40s`.

## Verdict: APPROVE WITH NITS

- **Fidelity:** every new `generic_simd_intrinsic` arm and every new `va_arg.rs` body matches upstream line by line. I found no logic, order, name, constant, diagnostic or marker difference that changes output.
- **Evidence:** the evidence the handoff gives reproduces.
- **What a test cannot see yet:**
  - The arms that only the IR model can run are untested today (N1).
  - So are the four va_arg bodies that have no target spec.
  - The tests are built so this cannot later turn into a silent pass with wrong IR (N2).

## 1. Fidelity

### `generic_simd_intrinsic` (intrinsic.ts :2393–:3258 vs intrinsic.rs :2411–:3472)
I read these myself, side by side with upstream.

- **Arm order is the same as upstream:** select, bitmask, `simd_simple_float_intrinsic`, the float-name guard, `llvm_vector_ty`, gather, `llvm_alignment`, masked load, masked store, scatter, `arith_red!`, `minmax_red!`, `bitwise_red!`, `cast_ptr`, `expose_provenance`, `with_exposed_provenance`, cast/as, `arith_binary!`, `arith_unary!`, the unary integer arm, `arith_offset`, the saturating arms, and the final `span_bug!`.
- **Markers** :2496, :2567 and :2671 are right. `coverage --missing` reports `31/31` and `15/15`.
- **`simd_select`:**
  - `require_simd_or_scalable!(.., SimdArgument)`, then `MismatchedLengths`.
  - Scalable branch: a `Bool` check, then `trunc` to `<vscale x n x i1>`, which is the inherent `trunc_inherent`, as Rust resolves it (builder.rs:112).
  - Otherwise `require_int_or_uint_ty!` and `vector_mask_to_bitmask`.
- **Float name table:** all 16 entries match, including `relaxed_fma→llvm.fmuladd` and `round_ties_even→llvm.rint`. The guard list uses upstream's order (`fsin, fsqrt, relaxed_fma, ...`). `BasicFloatType` uses `in_ty`, as upstream does.
- **Gather, scatter and masked load/store:**
  - `require_simd!` uses the variants `SimdFirst/Second/Third/Return` in upstream order. Masked store has no `SimdReturn`, as upstream.
  - The length checks are `Second`/`ThirdArgumentLength`, with masked's `in_len: mask_len, in_ty: mask_ty`.
  - The pointer predicates add `is_mut()` for scatter and store. Mutability is `Not` for gather and load, `Mut` for scatter and store.
  - PORT 1 (`p_ty.kind() == other.kind()` becomes `===` on the interned `Ty`) is sound.
  - Gather and scatter alignment is `align_of(in_elem)`. Masked alignment goes through `llvm_alignment` (Unaligned 1, Element, Vector).
  - Overload types: gather and scatter take `[elem vec, ptr vec]`, masked load and store `[elem vec, ptr]`.
  - Argument order: gather `[ptrs, mask, values]`, scatter `[values, ptrs, mask]`, load `[ptr, mask, passthru]`, store `[values, ptr, mask]`.
  - The `align` call-site attribute goes on `Argument(0)` for gather and load, and on `Argument(1)` for scatter and store. All as upstream.
- **`arith_red!`:**
  - Ordered integer reductions compute `integer_reduce` and then `op(acc, r)`.
  - Unordered integer reductions call `integer_reduce` a second time. That is faithful: upstream emits the reduction twice.
  - Float reductions take `args[1]` as the accumulator when ordered. Unordered ones use `const_real(f32|f64, identity)`, with identity `-0.0` for add and `1.0` for mul. Any other width gives `UnsupportedSymbolOfSize { size: v }`.
  - The four expansions use the right `*_reassoc` builders.
- **`cast_ptr`, `expose_provenance` and `with_exposed_provenance`:** the `ptr_metadata_ty` and `normalize_erasing_regions` check, then `CastWidePointer`, `ExpectedPointer` and `ExpectedUsize`. The check order is in, then out.
- **`simd_cast` / `simd_as`:**
  - `require_simd_or_scalable!(ret, SimdReturn)`, then `ReturnLengthInputType`, then `ReturnNumVecsInputType`, which defaults to 1. `NumScalableVectors` is a branded number, so `===` is right.
  - The nominal identity check comes next.
  - Widths come from `normalize(pointer_width).bit_width().unwrap()`.
  - Int/int casts: `>` gives trunc, `==` gives the identity, `<` gives sext or zext, by the *input* sign.
  - Int to float gives `sitofp`/`uitofp` by the input sign.
  - Float to int: `simd_cast` gives `fptoui`/`fptosi`, and `simd_as` gives `cast_float_to_int(signed)` by the *output* sign.
  - Float to float: fptrunc, identity or fpext. Anything else gives `UnsupportedCast`.
- **Unary integer arm:**
  - The `UnsupportedOperation` check comes before `type_vector`.
  - The intrinsic names include `funnel_shl→llvm.fshl`, `funnel_shr→llvm.fshr` and `carryless_mul→llvm.clmul`.
  - `bswap` is a no-op when `int_size == 8`. ctlz and cttz add `i1 0`. Funnel shifts take three operands, `clmul` two.
- **`arith_offset`:** both `span_bug!` texts match, and so does the `gep(backend_type(layout_of(pointee)))` call.
- **Saturating arms:** `llvm.{s,u}{add,sub}.sat`. The `ExpectedVectorElementType` arguments match upstream.

### `va_arg.rs` (va_arg.ts)
A sub-agent compared every body line by line; I re-read aapcs, xtensa and s390x myself.

- **aapcs (:189):**
  - Offsets: gr_top 8, vr_top 16, gr_offs 24, vr_offs 28.
  - Slots: `div_ceil(8)*8` for general registers, `div_ceil(16)*16` for vector registers. The general/vector choice is `is_any_ptr() || is_integral()`.
  - Comparisons: `IntSGE 0`, then the over-8 alignment round-up (+15, &-16), then `IntSGT 0` on the new offset, which is the value stored back.
  - The big-endian `ptradd` uses `slot_size - size`.
  - Blocks, in order: maybe_reg, in_reg, on_stack, end. The stack path calls `emit_ptr_va_arg(Direct, 8, Yes, No)`. Phi incoming order is `[reg, stack]`.
- **The other bodies:**
  - powerpc (:293), s390x (:423), hexagon musl and bare metal (:832, :915) and xtensa (:952) match, with every constant, predicate (`IntULT`/`IntULE`), block name, alignment and `bug!`/`assert!` text the same.
  - `emit_va_arg`'s `assert_matches!` text, the MIPS `bug!` (`LlvmAbi.display`) and the switch to the inherent `va_arg_inherent` (builder.rs:1875) are right.
  - The `Math.ceil` forms of `div_ceil`/`next_multiple_of` (PORT 3) are exact for small non-negative values, including 0.

## 2. Evidence
- **Fixture tests:**
  - `bun test simd_intrinsic.test.ts va_arg.test.ts`: **16 pass, 0 skip**.
  - That count includes the 5+2 "fixtures are current" tests. They re-run the pinned rustc and require byte equality, so `simd2*.ll/.stderr`, `simd_model*.ll` and both `va_targets.*.O.ll` are pinned-rustc output and regenerate unchanged.
  - `simd2_err.stderr` covers every reachable `InvalidMonomorphization` of the new arms. `SimdFirst` cannot fire, because `SimdInput` already checked `args[0]`.
- **How the model-stop tests switch over:**
  - Each accepts exit 70 only when stderr is exactly one named stop line (an anchored regex).
  - Any other exit requires stderr to be empty, exit 0, and the IR to equal the fixture under `comparable()`. Call-site `align` attributes are inline, so they are compared.
  - So once the model has those paths, a wrong IR fails, and a different stop fails too.
  - Today:
    - `simd_model.rs` stops at the first function, at `llvm.masked.gather`.
    - The aapcs case stops at `LLVMRustSetNormalizedTarget` (`src/rust_ts/llvm/core.ts:188`), when the module is created. That is before any function is code-generated, so `emit_aapcs_va_arg` does not run at all today (N1).
- **Spot checks (`difftest --suite run-pass-native --filter`):** all MATCH 1/1.
  - `simd/intrinsic/generic-as.rs` (`simd_as`);
  - `simd/intrinsic/generic-cast-pass.rs` (`simd_cast`);
  - `simd/libm_std_can_float.rs` (`simd_ceil`).

## 3. Deleting `simd_stop.rs`
- **Meaningless now:** the deleted test asserted that an unported arm stops naming `cg-intrinsic-b` (review ir-fix-a N4). Every arm is now ported, and `grep` finds no `unported("cg-intrinsic-b:` anywhere in `src/`, so that check has nothing left to test.
- **What still checks stop/lane naming:**
  - `skeleton.test.ts` "stub counts per lane", which counts `unported("<lane>:` per lane (:171);
  - "stubs name their fill lane", for cg-asm and cg-di-a.
- **For root:** delete `"cg-intrinsic-b": 2,` at `skeleton.test.ts:132`, and reword the comment at :112–113, which still names `simd_stop.rs` and says the arms stop by name. Both edits are root's, as the handoff says.

## 4. Mutations
Each mutation was applied in a scratch worktree, the lane's tests were run, and the line was reverted.

| # | mutation | test result |
|---|---|---|
| M1 | int/int cast `in_width > out_width` → `>=` (intrinsic.ts:3070) | survives. **Equivalent:** a same-width trunc folds to its operand (IRBuilder `CreateCast`), so the output does not change. |
| M2 | `simd_as` `sign === "Signed"` → `!==` (:3087) | **killed** (simd2.rs) |
| M2b | int/int cast `sext` → `zext` for signed input (:3074) | **killed** (simd2.rs) |
| M2c | masked store: drop `Mutability.is_mut` (:2760) | **killed** (simd2_err.rs) |
| M3 | gather alignment `align_of(in_elem)` → `1` (:2640) | **survives** (N1) |
| M4 | `llvm_alignment` `Element` → `align_of(vector_ty)` (:2662) | **survives** (N1) |
| M5 | unordered f32 reduction identity → `0.0` (:2874) | **survives** (N1) |
| M6 | aapcs `vr_offs` `3*ptr_offset + i32_offset` → `3*ptr_offset` (va_arg.ts:199) | **survives** (N1) |

## 5. Regressions
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: `markers ok`.
- `bun test ./src/rustc_codegen_llvm/ ./src/rustc_codegen_ssa/ ./scripts/lib/unit-steps.test.ts`: **370 pass, 1 fail**. The one failure is the expected `stub counts per lane` (`"cg-intrinsic-b": 2`).
- `--sample 200 --jobs 6` runs, `RUST_TS_AGENT=rev-cgib-w40s` (run ids `rev-cgib-s200-<suite>`):

| suite | MATCH | DIFF | UNPORTED | UNSTABLE | protected in sample | protected not MATCH |
|---|---|---|---|---|---|---|
| run-pass-native | 193 | 0 | 6 | 1 | 191 | **0** |
| ir-run-pass | 189 | 1 | 10 | 0 | 187 | **0** |
| mir-o2 | 200 | 0 | 0 | 0 | 200 | **0** |

- The ir-run-pass DIFF is `tests/ui/sepcomp/sepcomp-statics.rs`, which is not protected. It had the same DIFF, at the same first line, in gate `gate-20261114-162816-root-vc2v`.
- Every UNPORTED case stops outside this lane: `cg-asm`, `LLVMRustModuleCost`, thin LTO, the aarch64 intrinsic table, `rustc_sanitizers`.

## Findings

No F findings.

- **N1. Today no test can see the arms that only the IR model runs.** Mutations M3–M6 survive.
  - Code involved: intrinsic.ts:2640, :2662, :2874 and the rest of gather, scatter, masked load/store and the float reductions; va_arg.ts:172–267 (aapcs).
  - Upstream: intrinsic.rs:2578–2936 and :2938–2990; va_arg.rs:189–291.
  - The aapcs body does not even execute: the run stops when the target triple is set, before codegen.
  - powerpc, s390x, hexagon and xtensa (va_arg.rs:293, :423, :832, :915, :952) are run by nothing.
  - These bodies are covered only by this review's line-by-line read, which found them faithful, and by the lane's reverted local model patch.
  - The lane cannot fix this: the model is ir-fix-b's, and target specs are out of scope.
  - **Ask root:** add a `docs/next.md` item, "when ir-fix-b lands the six signatures and `Triple::normalize`/global features for aarch64-unknown-linux-gnu, confirm `simd_model.rs` and the aapcs test now compare IR, and re-run M3–M6". Also keep the four ABI bodies on the list for target-spec work.
- **N2. `simd_model.rs` stops as a single crate** (simd_intrinsic.test.ts:109).
  - If ir-fix-b lands only some of the six signatures (say the masked ones but not `vector.reduce.f*`), the crate still exits 70 at a later function. The arms that could compile by then stay unchecked, and nothing says so.
  - This is not a silent pass with wrong IR, but the switch-over happens only when all six land.
  - Two possible fixes: split the fixture per intrinsic family, or, in the exit-70 branch, require the stop to name the *first* unmodelled intrinsic in source order.
  - Also, unlike the simd2.rs test, this test does not check that the fixture holds the expected `@fn(` names.
- **N3. The six new va_arg bodies copy ir-fix-a's `list.immediate(String)`.**
  - Lines: va_arg.ts:188, :280, :413, :820, :888, :935; the pattern was already at :52 and :1176.
  - `String` is not a `Debug<Value>`. It writes nothing to the formatter, so if the `bug!("not immediate: ..")` path in `OperandRef::immediate` were ever reached, the ICE text would be wrong.
  - It only affects an ICE path that upstream also ICEs on. `debug_Value`, as intrinsic.ts uses, would be right.
- **N4. `skeleton.test.ts:132` and :112–113 are root's edits (§3).** The lane's handoff already lists them.
- **N5. One spurious failure under load.** One run of the lane's `simd_intrinsic.test.ts`, during the `--jobs 6` sample runs, reported 1 fail.
  - The M5 mutation it ran under cannot affect any compared test. Two reruns of the same mutation passed 10/10.
  - The failing test's name was not captured. These tests spawn the whole driver, and under heavy load one may pass bun's default 5 s timeout.
  - Worth watching in the gate's unit step. Running these with a longer per-test timeout would rule it out.
