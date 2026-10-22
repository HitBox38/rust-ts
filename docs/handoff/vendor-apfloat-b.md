# Handoff: vendor-apfloat-b (wave 21; continues vendor-apfloat-a; plan-m4 D9)

Branch `lane/vendor-apfloat-b`, base `6f0e52f1` (integ-w19 + vendor-apfloat-a + the `rustc_apfloat` scope entry). No merges.

rustc_apfloat 0.2.3+llvm-462a31f5a5ab is now ported whole: **308/308** fns of the published crate are covered (the
two non-library files are `crate-skip`). Every rustc_apfloat `unported(..)` call site listed by vendor-apfloat-a's
handoff is repointed except the `rustc_middle/mir` placeholders (out of bounds for this lane, see below).

## Files
New:
- `src/vendor/rustc_apfloat/ppc.ts` (src/ppc.rs): `DoubleFloat<F>` (class) and its static side `DoubleFloatType<F>`
  (`double_float_type(F)`), `DoubleDouble` (type + value = `double_float_type(Double)`), `debug_DoubleFloat`,
  `DoubleFloatInner` (the bounds on `F`). `FallbackS<F>` / `FallbackExtendedS<F>` and their `IeeeFloatType`s live on the
  `DoubleFloatType` (`.FallbackS`, `.Fallback`, `.FallbackExtendedS`, `.FallbackExtended`).
- `src/vendor/rustc_apfloat/ppc.test.ts`: src/ppc.rs's `#[test] is_integer`.
- `src/vendor/rustc_apfloat/tests/ppc.test.ts` (tests/ppc.rs, 19 tests), `tests/downstream.test.ts` (tests/downstream.rs, 3).
- `src/vendor/rustc_apfloat/callers.oracle.test.ts`: oracle test of the repointed compiler paths (below).

Changed:
- `ieee.ts`: `semantics(..)` is exported and takes optional `MAX_EXP` / `MIN_EXP` (needed by the Fallback semantics);
  when both are set, `IEEE_MIN_EXP` / `IEEE_MAX_EXP` are getters that panic (Rust never evaluates them there; for
  `EXP_BITS = 0` they would not compile). The 8 IEEE semantics are unchanged (same values).
- `lib.ts`: `crate-skip` markers for `build.rs` and `benches/decimal.rs` (bottom of the file).
- `tests/ieee.test.ts`: `add` (2194), `subtract` (2423), `multiply` (2652), `divide` (3011) ported (generated from the
  upstream tables by a one-off converter, then checked: 77/77 tests pass, 535k expects); `DoubleDouble` joins
  `FLOAT_TYPES` (`for_each_float_type!`), so `is_smallest_normalized` and `f8_to_string` run on it as upstream.
- `oracle/apfloat_oracle.rs`, `oracle/cases.ts`: new format `dd` (DoubleDouble), see "Oracle".

Repointed call sites (outside the vendor dir; each with an oracle test):
- `src/rustc_mir_build/thir/constant.ts` `parse_float_into_scalar`: the stand-in now has upstream's body
  (builder/mod.rs:1100) on the vendored crate. Still **no marker** (it belongs to builder/mod.rs, planned lane mb-mod):
  mb-mod should move it (and `core_parse_float`, below) into builder/mod.ts with the marker.
- `src/rustc_middle/ty/consts/int.ts`: `to_float<F>(F)` (takes the `FloatType` dictionary), `to_f16..to_f128`, and the
  `From<Half/Single/Double/Quad> for ScalarInt` / back impls (`ScalarInt.from_Half(f)`, `ScalarInt.into_Half(int)`, ...).
- `src/rustc_middle/ty/util.ts` `numeric_min_and_max_as_bits` (floats: `(-F::INFINITY).to_bits()`, `F::INFINITY.to_bits()`).
- `src/rustc_middle/thir.ts` `PatRangeBoundary::compare_with` (float arms: `F::from_bits(a).partial_cmp(&F::from_bits(b))`).
- `src/rustc_middle/ty/print/pretty.ts`: the float `ScalarInt` printing stand-ins (`try_from`, `is_finite`, Display).
- `src/rustc_lint/types/literal.ts` `float_is_infinite::<S>` (takes the `Semantics` value).
- `src/rustc_lint/types.oracle.test.ts`: the PENDING "float literals stop at rustc_apfloat" case is now a normal case,
  extended (f32 / f64: round to MAX vs to infinity, underflow, negated, suffixed), plus a new f16 / f128 case. The two
  PENDING `utils::std_or_core` cases were already failing at the base (std_or_core is ported there): converted to
  normal cases as the file's header says (test-only change).

Not repointed: `src/rustc_middle/mir/interpret/value.ts` keeps its `Pending` placeholders for `Half` / `Single` /
`Double` / `Quad` (mir/ is the mir-* lanes'; they can now import `../../../vendor/rustc_apfloat/ieee.ts`).
`src/rustc_mir_build/thir/pattern/const_to_pat.ts` still casts `v.to_f32()` to `{ is_nan(): boolean }` with a stale
"stop as UNPORTED" comment: the casts are now no-ops and the code works (its owner can drop them).

## Coverage (`bun scripts/coverage.ts --missing rustc_apfloat-0.2.3+llvm-462a31f5a5ab/<file>`)
| file | covered |
|---|---|
| src/lib.rs | 77/77 |
| src/ieee.rs | 74/74 |
| src/ppc.rs | 33/33 |
| tests/ieee.rs | 94/94 |
| tests/ppc.rs | 19/19 |
| tests/downstream.rs | 3/3 |
| benches/decimal.rs | 7/7 (crate-skip: criterion benchmark harness, timing only) |
| build.rs | 1/1 (crate-skip: cargo build script checking the `+llvm-<hash>` version suffix at build time) |

Crate total 308/308. `bun scripts/coverage.ts --check`: `markers ok (18001; vendor 4196)`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/vendor/rustc_apfloat`: 102 pass, 0 fail (6 files; ~70 s on the loaded machine).
- `RUST_TS_REQUIRE_PROBES=1 bun test src/vendor/rustc_apfloat/apfloat.oracle.test.ts`: **225,353** lines (was 202,277),
  0 mismatches; 23,076 of them are `dd`.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/vendor/rustc_apfloat/callers.oracle.test.ts`: 4/4 (thirdump probe vs
  src/rust_ts/thirdump.ts, byte-identical stdout / stderr / exit). The same files stop at
  `unported: rustc_mir_build::builder::parse_float_into_scalar` on the base.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_lint/types.oracle.test.ts --timeout=120000`: 14/14.
- Difftests (RUST_TS_AGENT=vendor-apfloat-b):
  - tydump-minicore: 46 total, MATCH 45, DIFF 0, UNPORTED 1 (mini_core_hello_world: `const_eval_poly`, as before);
  - tydump-ui `--sample 200`: MATCH 183, DIFF 0, UNPORTED 17 (mir_borrowck 11, const_eval_resolve_for_typeck 5,
    IntoDiagArg 1; none apfloat);
  - thirdump-minicore: MATCH 45, DIFF 0, UNPORTED 1; thirdump-ui `--sample 200`: MATCH 179, DIFF 0, UNPORTED 21.
  - No run under `$RUST_TS_DATA/runs` (full tydump-ui / thirdump-ui / mirdump-ui runs included) ever stopped at one of
    the repointed `unported(..)`s, so no suite case changes status through them (they were reached only by cases
    stopping earlier for other reasons).
- `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (once, at the end, on e73ad32f): **5665 pass, 0 fail**
  (5666 tests across 385 files, 1978 s on the loaded machine; the other one is the existing skip).

## Oracle (`dd`)
`apfloat_oracle.rs`: `run<F: Float + Debug>` has every op but `cvt`; `run_ieee<F: .. FloatConvert<..>>` adds `cvt` and
is used for the 8 IEEE formats; `dd` uses `run::<DoubleDouble>` (DoubleDouble implements no `FloatConvert`, so there
is no `cvt` from or to it, upstream either). `cases.ts`: `ALL_FORMATS` = the IEEE formats + `dd`; `dd` inputs are
`(hi, lo)` pairs of Double patterns: `lo` canonical-ish (2^-53..2^-60 of `hi`, either sign), ±0, an edge, or anything;
a `dd` edge set (every Double edge × lo ∈ {±0, 1, an edge, canonical}, largest / smallest / smallest_normalized);
near operands flip signs / low bits of either half. All ops (add, sub, mul, div, fma, rem, mod, rti, nu/nd, toi/tou,
fu/fi, fs incl. long decimal round-trips of `dd` values, disp, dbg, scal, frexp, ilogb, nan, misc, consts) in random
rounding modes. Some `dd` inputs panic in the crate (the Fallback conversions assert `Status::OK`, e.g. sNaN halves):
both sides print `PANIC`.

## unported(...) left
- `src/rustc_mir_build/thir/constant.ts`: `core::fmt::Display for f32` in `parse_float_into_scalar`'s f32 assert
  message (Rust's host-`f32` Display is not ported). Unreachable: the assert compares two correctly rounded parses.
- None in the vendor files.

## PORT decisions (please record)
1. **`DoubleFloat<F>`** is an immutable value class (`_0`, `_1`); `mut self` methods work on a `clone()`. Its static
   side is `DoubleFloatType<F>` (one per `F`, `double_float_type(F)`, cached), reached from an instance through
   `self.0`'s type. `F` is `Float<F> & FloatConvert & { debug_fmt() }` (the impls' `FloatConvert` bounds and the
   derive's `Debug`). The derives (`PartialEq`, lexicographic `PartialOrd`, `Debug` = `DoubleFloat(a, b)`) are
   hand-written. `Neg`, `Display` (through `Fallback`), provided / `float_common_impls!` methods are installed as for
   `IeeeFloat`; the provided `is_integer` is not installed (DoubleFloat overrides it).
2. **The two `From` impls** are `DoubleFloatType.from(x: Fallback)` (`DoubleFloat::from`) and
   `DoubleFloatType.fallback_from(x: DoubleFloat)` (`Fallback::from`); their `assert_eq!`s panic with core's text.
3. **Fallback semantics** are built per `F` by ieee.ts `semantics(..)` (now exported, with `MAX_EXP` / `MIN_EXP`
   overrides; the never-evaluated `IEEE_MIN_EXP` / `IEEE_MAX_EXP` panic if read). `BITS = EXP_BITS = 0`, so
   `from_bits` / `to_bits` on them panic (upstream's `assert!(BITS > PRECISION)`), as intended upstream.
4. `u128` shifts by `F::BITS` (`from_bits`, `to_bits`) mask the amount with 127 (release rustc); `-*exp` in `frexp_r`
   is `i32` wrapping negation.
5. **`parse_float_into_scalar`'s host parse** (`num.parse::<f32 / f64>()`, core's dec2flt) is `core_parse_float` in
   constant.ts: dec2flt's syntax, and its result (nearest value, ties to even) computed exactly with bigints (not a port
   of Eisel-Lemire). Checked on 240k strings (random decimals with exponents, f32 midpoints ± one digit) against
   apfloat and, for f64, JS `Number`. Belongs in `src/std` (str parse) eventually; root's call.
6. `ScalarInt::to_float::<F>` takes the `FloatType` dictionary; `From<Half> for ScalarInt` is `ScalarInt.from_Half`,
   `From<ScalarInt> for Half` is `ScalarInt.into_Half` (names were already there). pretty.ts's `Half::try_from(int)` is
   the blanket infallible `TryFrom` of that `From`.
7. `float_is_infinite::<S>` takes the semantics value (`HalfS`, ...).
8. tests/downstream.rs's host `f32 as i128 as f32` / `f64 as i128 as f64` are emulated (saturating truncation, NaN 0,
   exact back-conversion for these cases).

## Root: needed outside this lane
- Nothing blocking. Optional: when mb-mod ports builder/mod.rs, move `parse_float_into_scalar` + `core_parse_float`
  there with the marker; mir-* lanes can replace value.ts's `Pending` float placeholders with the vendored types.
