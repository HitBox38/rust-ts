# Handoff: vendor-apfloat-a (wave 21 foundations; plan-m4 D9)

Branch `lane/vendor-apfloat-a`, base `970d2365`. No merges.

**rustc_apfloat 0.2.3+llvm-462a31f5a5ab** is the version in the pinned `Cargo.lock` (checksum `486c2179…`). This
lane ports `src/lib.rs` and `src/ieee.rs` in full, plus `tests/ieee.rs` except 4 tests. Every IEEE format is
included: Half, Single, Double, Quad, BFloat, Float8E5M2, Float8E4M3FN and X87DoubleExtended. Results are
bit-exact. A differential test checks the port against the crate the pinned rustc links, on 202,277 operations with
every rounding mode, and all of them are identical (NaN payloads, sNaNs, subnormals, status flags, `loses_info` /
`is_exact`, parse errors, Display/Debug text).

## Files (all new)
- `src/vendor/rustc_apfloat/lib.ts` (lib.rs):
  - `Status` (a bitflags companion; `debug_Status` prints `Status(INVALID_OP | INEXACT)` / `Status(0x0)`, as the oracle does), `Status.and`;
  - `StatusAnd` (+ `map`, `unwrap`, `debug_StatusAnd`), `Category`, `Round` (+ `Round.neg`), `ExpInt`, `IEK_*`, `ParseError`;
  - the `Float` trait, split into `Float<Self>` (the instance side) and `FloatType<Self>` (the static side); `Float_provided`;
  - `FloatConvert` + `FloatConvert_provided`; `float_common_impls` (Default, FromStr, the operators, `*_assign`).
- `src/vendor/rustc_apfloat/ieee.ts` (ieee.rs):
  - `IeeeFloat<S>`; `IeeeFloatType<S>` (its static side: ZERO / INFINITY / NAN / SMALLEST, qnan, snan, largest,
    smallest_normalized, from_bits, from_u128_r, from_i128_r, from_str_r, ...); `ieee_float_type(S)`;
  - the `Semantics` interface, its defaults (`semantics(..)`) and `Semantics_provided`;
  - the semantics values `HalfS`, `SingleS`, `DoubleS`, `QuadS`, `BFloatS`, `Float8E5M2S`, `Float8E4M3FNS`, `X87DoubleExtendedS`;
  - the float types `Half`, `Single`, `Double`, `Quad`, `BFloat`, `Float8E5M2`, `Float8E4M3FN`, `X87DoubleExtended`
    (each name is both a type and a value);
  - `NonfiniteBehavior`, `NegExt`, `Loss` (+ `combine`, `through_truncation`), `IeeeDefaultExceptionHandling`,
    `sig` (the `mod sig` functions), `debug_IeeeFloat`.
- `src/vendor/rustc_apfloat/ieee.test.ts`: `sig::test_add_or_sub` (src/ieee.rs's `#[test]`).
- `src/vendor/rustc_apfloat/tests/ieee.test.ts`: tests/ieee.rs. The helpers are ported, as are 73 of the 77 `#[test]`s
(~533k expects). add / subtract / multiply / divide (lines 2194–3296) are left for lane b.
- `src/vendor/rustc_apfloat/apfloat.oracle.test.ts`, plus `oracle/apfloat_oracle.rs` and `oracle/cases.ts`: the
  differential test, described in "Oracle" below. Running `bun src/vendor/rustc_apfloat/oracle/cases.ts` times the
  TS side per op.

## Coverage (`bun scripts/coverage.ts --missing rustc_apfloat-0.2.3+llvm-462a31f5a5ab/<file>`, with the scope entry)
| file | covered |
|---|---|
| src/lib.rs | 77/77 |
| src/ieee.rs | 74/74 |
| tests/ieee.rs | 90/94 (missing: `add` 2194, `subtract` 2423, `multiply` 2652, `divide` 3011) |
| src/ppc.rs | 0/33 (lane b) |
| tests/ppc.rs | 0/19 (lane b) |
| tests/downstream.rs | 0/3 (lane b) |
| benches/decimal.rs | 0/7 (lane b) |
| build.rs | 0/1 (lane b) |

Crate total: 241/308. `bun scripts/coverage.ts --check` gives `markers ok (17284; vendor 4129)` with the scope
entry in place. Without it, the new `crate:` markers report the expected "names no harness/scope.json vendor crate"
errors.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/vendor/rustc_apfloat`: all pass. The non-oracle tests take about 5 s.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/vendor/rustc_apfloat/apfloat.oracle.test.ts`: 202,277 lines, 0 mismatches.
  It takes about 25 s on the TS side, plus a one-time ~20 s rustc build of the oracle program.
- `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`: see the final line of this file.
- No difftest sample was run. Nothing on a compiler path imports the module yet, so every suite's output is unchanged
  by construction.

## Oracle
- `oracle/apfloat_oracle.rs` is a rustc-dev program: `#![feature(rustc_private)]`, `extern crate rustc_driver;
  extern crate rustc_apfloat;`.
  - The test builds it in `beforeAll` with the pinned toolchain (`rustc +nightly -O`, rpath to `<sysroot>/lib`).
    The approach follows `src/std/slice_sort.test.ts`, so the oracle is exactly the oracle compiler's copy of the crate.
  - It needs the `rustc-dev` component. Without it the test is a visible skip; with `RUST_TS_REQUIRE_PROBES=1` it fails.
  - On Windows, `<sysroot>/bin` is put on PATH, since there is no rpath. This path is untested.
- Ops, run in each of the 8 formats with random rounding modes:
  - `add`, `sub`, `mul`, `div`, `fma`, `rem` (ieee_rem), `mod` (c_fmod), `rti` (round_to_integral), `nu` / `nd` (next_up / next_down);
  - `cvt` (convert_r to each of the 8 formats); `toi` / `tou` (to_i128_r / to_u128_r, widths 2..128); `fu` / `fi` (from_u128_r / from_i128_r);
  - `fs` (from_str_r): random decimal and hex strings, specials and NaN payload forms, invalid and non-ASCII strings,
    and exact decimal midpoints between adjacent values (± one digit);
  - `disp` (Display with width / precision / `#` combinations), `dbg`;
  - `scal` (scalbn_r, including i32::MIN / MAX), `frexp`, `ilogb`, `nan` (qnan / snan payloads), `consts`;
  - `misc`: partial_cmp, eq, bitwise_eq, min / max / minimum / maximum, abs, copy_sign, every `is_*`, category,
    get_exact_inverse;
  - `status` (Debug of `Status` / `StatusAnd`).
- Inputs:
  - uniform random bit patterns;
  - a per-format edge grid: sign × exponent field {0, 1, 2, bias±, max-2..max} × mantissa {0, 1, 2, 3, half±1,
    quarter, all-1, all}. For x87, the grid is used both with and without the explicit integer bit, so it covers
    pseudo-NaN, unnormal and pseudo-denormal patterns;
  - values with moderate exponents;
  - near operands (sign flip, low-bit flips), for cancellation and ties.
- Panics: the crate itself panics on some inputs. For example, Display with precision 0 can empty its digit buffer
  (`no characters in buffer!`). Both sides catch the panic and print `PANIC`, and the port panics on the same inputs.

## Using it (for the MIR-build / const-eval / ty lanes)
```ts
import { Double, Single, Half, Quad, type IeeeFloat, ieee_float_type } from "../vendor/rustc_apfloat/ieee.ts";
import { Round, Status, type Float, type FloatType } from "../vendor/rustc_apfloat/lib.ts";
const r = Double.from_str_r("0.1", Round.NearestTiesToEven);  // Result<StatusAnd<Double>, ParseError>
const x = Double.from_bits(0x3ff0000000000000n);              // F::from_bits(u128): bigint in, bigint out
const s = x.add(Double.from_u128(2n).value);                  // StatusAnd<Double>; `x + y` / `x.add_r(y, round)`
s.value.to_bits(); s.status === Status.OK;
const loses = { value: false };
const h = x.convert(Half, loses);                             // FloatConvert: the target float type as an argument
x.fmt();  x.fmt({ width: 0, precision: 17, alternate: true }); // Display (`{}` / `{:#0.17}`); x.debug_fmt() is `{:?}`
// generic `fn f<F: Float>()`: take the dictionary, `F: FloatType<X>` (e.g. `Double`), and use `F.ZERO`, `F.from_bits(..)`, ...
```
Existing `unported(...)` call sites that this unblocks. They are outside this lane and untouched:
- `src/rustc_mir_build/thir/constant.ts:23` `parse_float_into_scalar`;
- `src/rustc_middle/thir.ts:495`;
- `src/rustc_middle/ty/util.ts:1313-1319` (`<F>::INFINITY.to_bits()`);
- `src/rustc_middle/ty/print/pretty.ts:4474-4486`;
- `src/rustc_middle/ty/consts/int.ts:561, 726-757` (`From<Half/Single/Double/Quad>` for / from ScalarInt).

## For lane vendor-apfloat-b (ppc.rs + the rest of the tests)
- `ppc.rs`:
  - `DoubleFloat<F>` implements `Float<DoubleFloat<F>>` and `FloatConvert`. Follow `IeeeFloat`'s pattern: a class
    for the instance side, a `FloatType` value for the static side (`DoubleDouble`), `Float_provided` /
    `float_common_impls` / `FloatConvert_provided.convert` installed on the prototype (see the end of `IeeeFloat` in
    ieee.ts), and a `Self()` returning the type value.
  - `FallbackS<F>` / `FallbackExtendedS<F>` are new `Semantics` values. `semantics(..)` in ieee.ts is
    module-private, so export it (or build the `Semantics` object the same way).
  - `IeeeFloat.convert_r` currently panics for non-`IeeeFloatType` targets (ieee.ts:1881, a `// PORT:` guard). The
    `FloatConvert<DoubleFloat<..>>` impls live in ppc.rs.
- `tests/ieee.rs`:
  - Port `add` (2194), `subtract` (2423), `multiply` (2652) and `divide` (3011) into `tests/ieee.test.ts` at the
    `// tests/ieee.rs:2194..3296 ... lane vendor-apfloat-b` comment.
  - Add `DoubleDouble` to `FLOAT_TYPES`, which is `for_each_float_type!`'s list; upstream includes
    `rustc_apfloat::ppc::DoubleDouble`.
  - Shared helpers in that file: `parse` / `p` (`.parse().unwrap()`), `parse_err`, `aeq` (`assert_eq!` with `0.0 == -0.0`),
    `f32` (Math.fround), `feq`, `from_f32` / `single_to_f32` / `from_f64` / `double_to_f64` (SingleExt / DoubleExt),
    and `to_f32` / `to_f64` (lossless via convert).
- Extend `oracle/cases.ts` + `apfloat_oracle.rs` with a `dd` format (`DoubleDouble`) for the differential test.
- `tests/downstream.rs`, `benches/decimal.rs` and `build.rs` also count toward the crate's coverage (`crate-skip` where
  they don't apply, e.g. criterion benches).

## unported(...) left
None in the ported files.

## PORT decisions (please record)
1. **The Float trait is split.**
   - `Float<Self>` (instance methods; `Self()` returns the static side) plus `FloatType<Self>` (associated consts and
     fns without `self`, plus Default / FromStr).
   - A float type is a value (`Double`), and generic `F: Float` code takes that dictionary.
   - Provided methods are `Float_provided`; the `float_common_impls!` items are `float_common_impls`, installed on
     the prototype.
   - `FloatConvert`'s target type is a `FloatType` argument (`x.convert(Single, loses_info)`).
2. **`IeeeFloat<S>` is an immutable value class.**
   - Its fields keep upstream names; `marker` holds the `Semantics` dictionary `S`. `mut self` methods work on a
     `clone()`, and the shared constants are frozen.
   - `x op= y` (`*_assign`) returns the new value.
   - Display is `fmt(f?: FloatFmt)` (width / precision / alternate), returning the text; Debug is `debug_fmt()` /
     `debug_IeeeFloat`.
3. **Semantics.**
   - The `Semantics` trait is an interface whose provided consts are computed by `semantics(NAME, impl)` in upstream's
     order. Its provided `from_bits` / `to_bits` are `Semantics_provided`, and X87 overrides them.
   - `NAME` is a rust-ts addition: it brands `IeeeFloat<HalfS>` and `IeeeFloat<SingleS>` as different TS types.
   - The inherent `const fn qnan` is `IeeeFloat.qnan_const(S, payload)`; the trait's `qnan` is on `IeeeFloatType`.
4. **Representation.**
   - `Limb` (`u128`) is a `bigint` in 0..2^128, and `[Limb; N]` / slices / `DynPrecisionLimbVec` are `Limb[]`.
     Shifts mask the shift amount with 127, matching rustc's release build (no overflow checks).
   - `ExpInt` and `usize` are `number`, with explicit `saturating_*` / `checked_*` helpers.
   - `&mut` out-params are `MutRef`s, and `Option<u128>` payloads are `bigint | undefined`.
   - The one mutable sub-slice (`sig::extract`'s `shift_right(&mut dst[..n])`) is copied out and written back.
5. **Parsers** take JS strings. Byte offsets are computed as UTF-8, and every slice at such an offset follows only
   ASCII, because any other character is rejected first. `u128::from_str_radix` is re-implemented locally with core's
   rules: `+` is accepted, a lone sign is rejected, and overflow is rejected.
6. **Performance deviations.** Both have identical results, are checked by the oracle, and carry a `// PORT:` comment.
   - `sig::widening_mul` multiplies once and splits the result, instead of summing four half-limb products.
   - Display reads the significand's decimal digits from its decimal string, instead of dividing by 10 chunk by chunk
     with `each_chunk` for each digit. Without this, an f128 subnormal takes 7.6 s to print; with it, 18 ms.
7. **`lib.rs` re-exports.** lib.ts does not re-export `ieee` / `ppc`, because the re-export would be an ESM cycle
   evaluated in the wrong order. Import `ieee.ts` directly.
8. **Bug found by the ported tests and fixed:** `Ordering::reverse` must not produce `-0`.

## Root: needed outside this lane
1. `harness/scope.json` `vendor`: add `"rustc_apfloat": "=0.2.3+llvm-462a31f5a5ab"`.
2. Optionally, move `oracle/apfloat_oracle.rs` to `tools/probes/apfloat` as a regular rustc-dev probe. As it stands,
   the test builds it inline, following the slice_sort precedent, because porting lanes may not edit `tools/`.
