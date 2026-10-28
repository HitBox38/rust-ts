# Handoff: interp-simd (M4 wave 24, CTFE, last fill lane of the interp contract)

Branch `lane/interp-simd` (from `de448071` on integ-w19, no merges). Lane: the `interp-simd` row of the split table in
`docs/handoff/interp-contract.md`: `compiler/rustc_const_eval/src/interpret/intrinsics/simd.rs` (902 upstream lines, 6 stubs).

## Result
- **All 6 stubs ported**, in upstream order, with `// rustc:` markers: `eval_simd_intrinsic` (every `sym::simd_*` arm),
  `fminmax_op`, `check_simd_ptr_alignment`, `simd_bitmask_index`, `bool_to_simd_element`, `simd_element_to_bool`.
  No `unported(..)` left in `src/rustc_const_eval/interpret/intrinsics/simd.ts`.
- Coverage: `bun scripts/coverage.ts --missing compiler/rustc_const_eval/src/interpret/intrinsics/simd.rs` → 6/6.
  rustc_const_eval 736/764; TOTAL 20724/25518. `--check`: markers ok (21303; vendor 4330). `bunx tsc --noEmit -p .`: clean.
- `src/rustc_const_eval/interpret/contract.test.ts`: markers 623 → 629, stubs 34 → 28, the `interp-simd` row is gone
  (comment `// interp-simd: done (0)`). 4/4 pass. With interp-intrinsics (integ-w19 85f69e64) the merged numbers are
  **markers 657, stubs 0** (verified in the trial merge below).
- Commits: `0706e5ce` (port + oracle test + counts), `f4c26e7d` (test error rendering, PORT note), this handoff.

## For root: three integration fixes (all verified in a throwaway trial merge of integ-w19, see "Oracle test")
1. **Nothing loads `interpret/intrinsics/simd.ts` (nor `intrinsics/atomic.ts`)**, at this base and on integ-w19:
   upstream's `mod atomic; mod simd;` (intrinsics.rs:5-6) have no TS import, so `InterpCx.prototype.eval_simd_intrinsic`
   / `eval_atomic_intrinsic` are undefined at run time (`eval_intrinsic` calls them for every `simd_*` / `atomic_*`
   name). Fix (I used this in the trial; not edited here, interpret/mod.ts is not my file):
   ```ts
   // interpret/mod.ts, after `import "./intrinsics.ts";`
   import "./intrinsics/atomic.ts";
   import "./intrinsics/simd.ts";
   ```
   (or the same two imports in intrinsics.ts at its `mod atomic; mod simd;`). Both modules only import `.gen.ts` / other
   crates at load, so either place is TDZ-free.
2. **The `F_` dictionaries after merging interp-intrinsics**: at this base, intrinsics.ts declares `float_round<F>` /
   `float_minmax<F>` / `float_muladd<F>` without a `FloatType` parameter, so simd.ts calls them as declared
   (`this.float_round<ApHalf>(op_s, rounding)`, etc.). interp-intrinsics added a trailing `F_: FloatType<F>`; tsc then
   reports exactly 12 errors in simd.ts (lines 270-279, 1191-1200, 1305-1314). Fix: add
   `import { Double, Half, Quad, Single } from "../../../vendor/rustc_apfloat/ieee.ts";` and turn each call into
   `this.float_round(op_s, rounding, Half)` / `this.float_muladd(a._0, b._0, c._0, typ, Half)` /
   `this.float_minmax(left, right, op, Half)` (Single / Double / Quad likewise). A ready patch (also the other two fixes):
   `$RUST_TS_DATA/tmp/interp-simd/integration.patch`; the sed I used:
   `perl -pi -e 's/this\.(float_round|float_muladd|float_minmax)<Ap(Half|Single|Double|Quad)>\(([^;]*)\);/this.$1($3, $2);/' src/rustc_const_eval/interpret/intrinsics/simd.ts`
3. **interp-ops' operator.ts `compute_size_in_bytes` always stops on 64-bit targets**: it builds
   `max_size_of_val()` = `Size::from_bytes(isize::MAX)`, which is `unported("rustc_abi::Size beyond 2^53 ...")`. So
   **every in-memory array index projection** (`project_index` → `compute_size_in_bytes`) stops there, at this base and
   on integ-w19 (every simd lane access is one). Fix used in the trial (same comparison, in bigint):
   ```ts
   const total_bytes = BigInt(elem_size.bytes()) * count;
   if (total_bytes > U64_MAX) return undefined;
   return total_bytes <= PointerArithmetic_provided.target_isize_max(this) ? Size.from_bytes(total_bytes) : undefined;
   ```
   (needs a `// PORT:` there: `total <= self.max_size_of_val()` compared as bigints, because `Size` holds a number).

## Oracle test (new): `src/rustc_const_eval/interpret/intrinsics/simd.oracle.test.ts`
Differential, in the style of interp-ops' `operator_cast.oracle.test.ts`. 2144 value cases as `const` items of one Rust
file (`#![feature(repr_simd, core_intrinsics, f16, f128)]`, `std::intrinsics::simd::*`) built and run with the pinned
toolchain (the values come from the pinned rustc's CTFE), plus 14 UB cases in a failing crate (the oracle is each
`error[E0080]: <message>`). Our side: a no_core crate declaring the same `#[repr(simd)]` types; arguments and `dest` are
places allocated by the CTFE machine, then `eval_simd_intrinsic` runs directly (with `ret = None`, so success ends in
`throw_ub!(Unreachable)` after every lane is written).
- Coverage: u8..u128 / i8..i128 vectors × add/sub/mul/div/rem/shl/shr/and/or/xor, eq..ge (mask results),
  saturating add/sub, funnel shl/shr, ctlz/cttz/ctpop/bswap/bitreverse, neg, reduce and/or/xor/max/min/any/all,
  reduce add/mul ordered, select, select_bitmask (u8 / u16 / `[u8; 1]` masks), bitmask (u8 / u32 / `[u8; 1]`),
  insert(_dyn) / extract(_dyn) / splat, simd_cast / simd_as int → int / float; f16 / f32 / f64 / f128 vectors ×
  arithmetic, compares, neg / fabs / ceil / floor / round / round_ties_even / trunc, maximum/minimum_number_nsz, fma /
  relaxed_fma, reduce max/min/add/mul, select, simd_as / simd_cast float → float / int (signed zeros, subnormals, inf,
  NaN); simd_shuffle (2-, 4-, 8-lane results); UB: extract/insert out of bounds, overflowing shifts (lane message),
  division by zero, `MIN % -1`, invalid mask elements (select, reduce_any, bitmask), shuffle and funnel out of range,
  unrepresentable `simd_cast` float → int.
- Not covered (need pointers or const generic args): `simd_arith_offset`, `simd_gather` / `simd_scatter`,
  `simd_masked_load` / `simd_masked_store` (so `check_simd_ptr_alignment`), `simd_cast_ptr`,
  `simd_with_exposed_provenance`, `simd_shuffle_const_generic`; big-endian bitmask order.
- **At this base every case is "pending"** (counted, not failed): every lane access goes through `ptr_offset_inbounds`
  (interp-intrinsics stub) and `compute_size_in_bytes` (fix 3); float paths also need `Scalar::to_float` and the
  `float_*` helpers. The test prints `simd oracle: 0 equal, 2144 pending ...`; once nothing is pending it requires every
  case to equal the oracle. The test imports `./simd.ts` itself (fix 1).
- **Trial merge** (throwaway branch `tmp/interp-simd-trial`, deleted; nothing of it is on the lane branch): integ-w19
  merged + fixes 1-3 → **`simd oracle: 2144 equal, 0 pending`, `simd UB oracle: 14 equal, 0 pending`**
  (`RUST_TS_REQUIRE_PROBES=1`). Mutation check: `bool_to_simd_element` returning `1` for true makes it fail.

## `// PORT:` decisions (simd.ts)
- Header: `throw_ub_format!` / `err_ub_format!` / `throw_unsup_format!` are local helpers (the macros' expansions, as in
  memory.ts / intrinsics.ts); vector lengths and lane indices (`u64`) are bigints (`project_to_simd` / `project_index`);
  the arms' nested `enum Op`s are local unions; `::<Half>` etc. as in fix 2.
- `dest` parameter is `dest_` (upstream shadows it); the arms' shadowing `dest` are `dest_v` / `dest_i`.
- `read_lane` / `read_lane_scalar`: `self.read_immediate(&self.project_index(&v, i)?)` / `read_scalar` (the repeated
  lane read), not upstream fns.
- `ap<T>()` casts between rustc_middle's placeholder float types (this base) and the vendored rustc_apfloat floats
  (precedent operator.ts); a no-op after interp-intrinsics' value.ts.
- `assert_ne!` is a local helper (core's `AssertKind::Ne` text); `assert_eq!(.., "msg")` uses operand.ts' `assert_eq_msg`.
- Integer helpers for `next_multiple_of`, `u32/u64::try_from(..).unwrap()`, `strict_shl/add/sub`, `unbounded_shl/shr`
  (u128), `from/to_le/be_bytes`, `copy_from_slice`, slicing (panic texts as core's).
- `i64::try_from(size.bytes()).unwrap()` (simd_arith_offset) is `BigInt(size.bytes())` (layout sizes are < 2^53 here).
- `trace!("{:?}", self.dump_place(..))` is a comment.

## Samples (`RUST_TS_AGENT=root-f5de`, code as at `f4c26e7d`; host load average ~300)
| suite | run | M / D / U / T | after re-running each TIMEOUT alone | base run (task list) M / D / U |
|---|---|---|---|---|
| tydump-minicore (46) | `20261027-234635-root-f5de-c54z` | 17 / 0 / 0 / 29 | 46 / 0 / 0 | `wos5` 45 / 0 / 1 |
| mirdump-minicore (46) | `20261027-235138-root-f5de-yvyr` | 45 / 0 / 1 / 0 | (none) | `p8q4` 45 / 0 / 1 |
| tydump-ui `--sample 300` | `20261027-235426-root-f5de-7r42` | 243 / 0 / 35 / 20 (+2 UNSTABLE) | 262 / 0 / 36 (+2 UNSTABLE) | `zjq3` 261 / 0 / 37 (+2 UNSTABLE) |
| mirdump-ui `--sample 300` | `20261028-000625-root-f5de-pnfz` | 261 / 0 / 27 / 12 | 273 / 0 / 27 | `mzgb` 269 / 0 / 31 |
| borrowck-ui `--sample 300` | `20261028-001908-root-f5de-yhxh` | 0 / 0 / 300 / 0 | (none) | `86qn` 0 / 0 / 300 |

**0 DIFF, 0 CRASH, no MATCH lost.** Per case against the base runs: every MATCH → TIMEOUT (28 + 19 + 12; the host load
average was ~300) is MATCH when re-run alone (`--filter <id> --jobs 2`, log `$RUST_TS_DATA/tmp/interp-simd/rerun.log`; 61
re-runs: 60 MATCH, and `traits/issue-83538-tainted-cache-after-cycle.rs`, UNPORTED in the base run too). The gains
(tydump-minicore `mini_core_hello_world.rs`, tydump-ui 1, mirdump-ui 4 UNPORTED → MATCH) and the moved stops (old
`eval_in_interpreter` / `replace_regions_in_mir` / `try_to_bits_for_ty` stops now at `UniverseInfo::relate`,
`OutlivesConstraintSet::push`, `CleanupPostBorrowck`, `const_eval_resolve_for_typeck`, metadata `Decodable`) come from
this lane's newer base (de448071) compared with the older base runs, not from this lane: `eval_simd_intrinsic` is only
reached through `eval_intrinsic` (a stub at this base) and is not even loaded (fix 1).

## Files touched
- `src/rustc_const_eval/interpret/intrinsics/simd.ts` (the assigned file).
- `src/rustc_const_eval/interpret/contract.test.ts` (this lane's counts only).
- New `src/rustc_const_eval/interpret/intrinsics/simd.oracle.test.ts`. This handoff. No harness/, scripts/, tools/ edits.
- Full unit suite not run (coordinator: root runs it at integration). Run here: contract.test.ts 4/4, simd.oracle.test.ts 2/2.

## `unported(...)` left
None in simd.ts. Paths stop in other files: `ptr_offset_inbounds`, `numeric_intrinsic`, `saturating_arith`,
`float_round`, `float_minmax`, `float_muladd`, `float_to_int_checked` (interp-intrinsics, merged on integ-w19),
`Scalar::to_float` (rustc_middle, ported by interp-intrinsics), `rustc_abi::Size beyond 2^53` (fix 3).
No sample case reaches `eval_simd_intrinsic` (it is only called from `eval_intrinsic`, a stub at this base); no runtime
stop moved because of this lane.
