# Handoff: interp-intrinsics (M4 wave 24, CTFE fill lane)

Branch `lane/interp-intrinsics` (from `f0e9a0cf`, no merges). Commits: the port (`f73f4e07`), then this handoff.
Lane: the `interp-intrinsics` row of the split table in `docs/handoff/interp-contract.md`: rustc_const_eval
`interpret/intrinsics.rs` and `interpret/intrinsics/atomic.rs` (28 stubs).

## Result
- **All 28 stubs ported** (0 `unported(..)` left in either file), in upstream order, with `// rustc:` markers.
  `ptr_offset_inbounds` (used by every `OffsetMode::Inbounds` field projection into memory) is done.
  - intrinsics.ts: `alloc_type_name`, `write_type_id`, `read_type_id`, `eval_intrinsic` (every arm: type_name /
    needs_drop / type_id / type_id_eq / size_of / align_of / offset_of / variant_count / caller_location /
    size_of_val / align_of_val / f*_algebraic / ctpop.. bitreverse / saturating_* / discriminant_value / exact_div /
    copy / write_bytes / compare_bytes / arith_offset / ptr_offset_from(_unsigned) / black_box / raw_eq /
    typed_swap_nonoverlapping / volatile_* / vtable_size / vtable_align / every float min / max / copysign / fabs /
    floor / ceil / trunc / round / round_ties_even / fma / fmuladd arm / va_copy / va_end / va_arg),
    `validate_c_variadic_argument`, `validate_c_variadic_compatible_ty`, `eval_nondiverging_intrinsic`,
    `numeric_intrinsic`, `exact_div`, `saturating_arith`, `ptr_offset_inbounds`, `copy_intrinsic`,
    `typed_swap_nonoverlapping_intrinsic`, `write_bytes_intrinsic`, `compare_bytes_intrinsic`, `raw_eq_intrinsic`,
    the float helpers, `float_to_int_checked` (its nested `float_to_int_inner` is inside it now), `va_list_key_field`.
  - atomic.ts: `eval_atomic_intrinsic`.
- **rustc_middle `Scalar::to_float` ported** (src/rustc_middle/mir/interpret/value.ts, marker value.rs:431), as the
  assignment allowed: `to_f16..to_f128` work now. The `Half` / `Single` / `Double` / `Quad` placeholders
  (`Pending<..>`) in value.ts are now the vendored rustc_apfloat types (re-exported). Nothing outside value.ts imported
  the placeholders; `from_f16..from_f128` lost their `as never` casts. operator.ts / cast.ts keep their `ap<T>()` casts
  (still correct, now no-ops). This also unblocks the float `binary_op` / `unary_op` Neg / `float_to_float_or_int`
  paths of interp-ops.

## Coverage / checks
- `bun scripts/coverage.ts --missing`: intrinsics.rs 27/27, intrinsics/atomic.rs 1/1, mir/interpret/value.rs 61/61.
  rustc_const_eval 758/764 (the 6 left are interp-simd's); TOTAL 20685/25518. `--check`: markers ok (21264; vendor 4330).
- `bunx tsc --noEmit -p .`: clean.
- `src/rustc_const_eval/interpret/contract.test.ts`: markers 623 → 651, stubs 34 → 6; the `interp-intrinsics` row is
  gone from the per-lane table (comment "done"). 3 pass; the 1 failure is the known runtime-stop pin (w24-common: not
  re-pinned by this lane; see "Runtime stop" below).
- Crate tests (`bun test src/rustc_const_eval src/rustc_middle/mir src/rustc_middle/ty/consts`): 125 pass, 3 fail, the
  three known failures (place_operand.test.ts 1, contract.test.ts runtime stop 1, operator_cast.oracle.test.ts 1: still
  "requires `Ordering` lang_item", as at the base).

## New test: `src/rustc_const_eval/interpret/intrinsics.oracle.test.ts` (differential, not a port)
Generates about 11k cases as `const` items that call `core::intrinsics::*` directly (`#![feature(core_intrinsics, f16,
f128)]`), builds them with the pinned toolchain (the oracle values come from the pinned rustc's CTFE) and runs the
same cases through the ported helpers: `numeric_intrinsic` (ctpop / ctlz / cttz / ctlz_nonzero / cttz_nonzero / bswap /
bitreverse on u/i 8..128), `saturating_arith` (add / sub), `exact_div` (exact operands only; the UB cases don't compile),
`unop_float_intrinsic` (fabs), `float_minmax_intrinsic` (minimum / maximum / minimum_number_nsz / maximum_number_nsz),
`float_copysign_intrinsic`, `float_round_intrinsic` (floor / ceil / trunc / round / round_ties_even) and
`float_muladd_intrinsic` (fma / fmuladd), on f16 / f32 / f64 / f128 with signed zeros, subnormals, inf and NaN payloads.
The `*_intrinsic` helpers read immediates and write into a fresh stack allocation that the test reads back, so
`write_scalar` / `read_scalar` / `allocate` run for real. A second test checks a few `float_to_int_checked` cases (no
`const` intrinsic reaches it) against Rust's documented semantics. Result: **all equal**
(`RUST_TS_REQUIRE_PROBES=1`, 2 pass). Mutation check: an off-by-one in `ctpop` plus swapping ties-to-even for
ties-to-away in `float_round` make it fail.

## Samples (`RUST_TS_AGENT=root-f5de`, at `f73f4e07`, clean tree) vs the base runs from w24-common
| suite | run | M / D / U | vs base |
|---|---|---|---|
| tydump-minicore (46) | `20261022-234855-root-f5de-7xw7` | 45 / 0 / 1 | `wos5`: same per case |
| mirdump-minicore (46) | `20261022-234937-root-f5de-o0wr` | 45 / 0 / 1 | `p8q4`: same per case |
| tydump-ui `--sample 300` | `20261022-235018-root-f5de-yp8q` | 261 / 0 / 37 (+2 UNSTABLE) | `zjq3`: same per case |
| mirdump-ui `--sample 300` | `20261022-235251-root-f5de-9yy1` | 271 / 0 / 29 | `mzgb`: 269 MATCH kept, 2 UNPORTED → MATCH |
| borrowck-ui `--sample 300` | `20261022-235549-root-f5de-axgt` | 0 / 0 / 300 | `86qn`: same per case |

**0 DIFF, 0 CRASH, no MATCH lost.** The 2 new matches (`tests/ui/mir/issue-76248.rs`,
`tests/ui/mir/mir-inlining/ice-issue-77564.rs`) stopped at `eval_queries::eval_in_interpreter` in the base run. They
still match with `ptr_offset_inbounds` forced to stop, so they most likely come from the integ-w19 base (the 23c CTFE
lanes), not from this lane. No remaining stop is in this lane's files. Remaining stops: `UniverseInfo::relate` (22 /
22 / 209), `OutlivesConstraintSet::push`, `CleanupPostBorrowck`, `try_to_bits_for_ty (M4)`, `hash_result`, metadata
decoding, polonius.

## Full unit suite
FULLTEST_PLACEHOLDER

## Runtime stop
The contract test's runtime-stop pin (`eval_to_allocation_raw` of `const C: u8 = 7;`) was already failing at the base
(known, w24-common) and this lane leaves it alone. This lane moves no stop on that path. Root / fix-w23-ctfe re-pin it.

## Signature changes to the contract (declarations; root: reconcile at merge)
1. **The generic float helpers take `F`'s `FloatType` dictionary as a trailing parameter** (contract decision 10):
   `unop_float_intrinsic(name, arg, F_)`, `float_minmax(a, b, op, F_)`, `float_minmax_intrinsic(args, op, dest, F_)`,
   `float_copysign_intrinsic(args, dest, F_)`, `float_round(x, mode, F_)`, `float_round_intrinsic(args, dest, mode, F_)`,
   `float_muladd(a, b, c, typ, F_)`, `float_muladd_intrinsic(args, dest, typ, F_)`, all `<F extends Float<F>>`.
   **interp-simd** (simd.rs calls `float_minmax`, `float_round`, `float_muladd`, ...) must pass `Half` / `Single` /
   `Double` / `Quad` (src/vendor/rustc_apfloat/ieee.ts) where upstream writes `::<Half>` etc.
2. `va_list_key_field<P extends Projectable<P>>(va_list: P): InterpResult<P>` (was `<P>(unknown): unknown`, as
   interp-step-call suggested). call.ts's `as MPlaceTy` cast is now redundant but harmless.
3. `Scalar.to_float<Prov, F extends Float<F>>(self, F: FloatType<F>)` in rustc_middle value.ts (was `<Prov, F>(self)`),
   the same convention as `ScalarInt.to_float(F)`.
4. `write_type_id(ty, dest: Writeable)` keeps the declared non-generic `Writeable` (ctfe-b's files call it with
   `Writeable` / `PlaceTy`). Inside, `dest` is cast to a local self-typed `AnyWriteable` for `project_field` (the
   discriminant.ts / cast.ts pattern) instead of switching to `P extends Writeable<P>`.

## `// PORT:` decisions
- `throw_ub_format!` / `err_ub_format!` / `err_unsup_format!` / `throw_inval!(TooGeneric)` / `throw_ub!(VaArgOutOfBounds)`
  are the file-local helpers (`ub_format`, `err_ub_format`, `err_unsup_format`, `throw_too_generic`, `err_ub`), with
  the macro kept as a comment (memory.ts precedent).
- `<F as Into<Scalar>>::into` is `F_into_Scalar(f, F_)`, dispatched on the dictionary (operator.ts precedent).
- In `eval_intrinsic`, the float arms whose body is an expression (`self.float_*_intrinsic::<F>(..)?`) return through
  `float_arm(ecx, r, ret)`, which does the shared tail (`trace!` comment, `return_to_block(ret)`, `interp_ok(true)`).
  The behaviour is the same as falling out of the `match`.
- `ptr_offset_from`: `M::Provenance::OFFSET_IS_ADDR` is false for `CtfeProvenance` (place.ts precedent), so only the
  `else` arm is ported, with a comment. `dist.checked_neg().unwrap()` is `-dist` (upstream's comment: `i64::MIN` is
  impossible).
- `ConstValue::Slice { meta: u64 }` is a `number` in mir consts.gen.ts: `alloc_type_name`'s `bigint` length is turned
  into a number (a type name is far below 2^53 bytes).
- `layout.align.bytes()` (`align_of`) is `layout.align.abi.bytes()` (`AbiAlign` derefs to `abi`).
- `arith_offset`: `i64::wrapping_mul` is `BigInt.asIntN(64, ..)`; `i64::try_from(size.bytes()).unwrap()` is `BigInt`
  (a `Size` is < 2^53).
- `u128` bit operations (`count_ones`, `leading_zeros`, `trailing_zeros`, `swap_bytes`, `reverse_bits`, `<<`) are
  bigint helpers at the end of the file; `Ord::cmp` of byte slices (`compare_bytes`, and `==` in `raw_eq`) is
  `bytes_cmp`; `std::iter::repeat_n` is a generator. The `io::Result::unwrap()` of `read_target_uint` /
  `write_target_uint` and the `&full_hash[a..][..n]` slicing panic as Rust does.
- `let [ptr, ..] = args else { span_bug!(..) }` is a length check, then indexing.
- `VecDeque::pop_front` (`va_arg`) is `shift()` on a copy of the returned list; `varargs.clone()` (`va_copy`) is a spread
  copy.
- `assert_eq!(layout, ret_layout)` / `assert_eq!(left.layout, right.layout)` use `TyAndLayout_eq` with
  `debug_TyAndLayout_Ty`. `assert_matches!(ty.kind(), ..)` prints the `Ty` with `debug_Ty`.
- value.ts: `Scalar::to_float` takes the dictionary (above); the header's placeholder note is updated.

## `unported(...)` left
None in this lane's files. At runtime these paths still stop elsewhere:
- `write_type_id` / `read_type_id` (and so `type_id`, `type_id_eq` and every ctfe-b `type_id_*` intrinsic) stop in
  rustc_middle `TyCtxt::type_id_hash` (`unported("rustc_middle::ty::Ty: StableHash (ty/impls_ty.rs) under
  StableHashState::while_hashing_spans")`). Once that is ported, `write_type_id`'s `Size::from_bytes(hash_fragment)` of
  a random 64-bit hash fragment will usually be above 2^53 and stop at the recorded `Size` limit (`SIZE_BEYOND_2_53`,
  rustc_abi). The `Size` representation decision then needs revisiting for type-id provenance offsets (root).
- `simd_*` intrinsics go to `eval_simd_intrinsic` (interp-simd stub).

## Files touched
- `src/rustc_const_eval/interpret/intrinsics.ts`, `src/rustc_const_eval/interpret/intrinsics/atomic.ts` (assigned).
- `src/rustc_middle/mir/interpret/value.ts` (`Scalar::to_float` + the apfloat types; allowed by the assignment).
- `src/rustc_const_eval/interpret/contract.test.ts` (this lane's counts only), new
  `src/rustc_const_eval/interpret/intrinsics.oracle.test.ts`, this handoff. No harness/, scripts/, tools/ edits.

## Full unit suite (root note)
The lane's final full-suite run was cut off by the API limit / machine reboot. Root ran the full suite at integration instead (merge into integ-w19).
