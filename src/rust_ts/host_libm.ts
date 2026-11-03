// rust-ts glue (not an upstream mirror): the host C math library, for Miri's host float operations
// (src/tools/miri/src/math.rs `HostFloatOperation`, ported in src/miri/math.ts; lane miri-eval-fix, decision recorded
// in docs/handoff/miri-eval-fix.md).
//
// Also the libm calls of src/tools/miri/src/shims/math.rs (ported in src/miri/shims/math.ts, whose header has the
// evidence).
//
// Miri computes `sin cos exp exp2 ln log10 log2 powf` of `f16` / `f32` / `f64` with the host float types, i.e. with
// whatever std's `f32::sin` & co. compile to in the Miri binary. Established from the pinned Miri binary
// (`$RUST_TS_DATA/rustup-miri/toolchains/nightly-2026-10-11-aarch64-apple-darwin/bin/miri`, disassembled with
// `otool -tV`; `nm -u` lists the imports):
// - `f64`: a call to the C library's `sin cos exp exp2 log log10 log2 pow` (on macOS: libSystem's libsystem_m).
// - `f32`: a call to `sinf cosf expf exp2f logf log10f log2f powf`.
// - `f16`: `fcvt s0, h0` (exact widening), the `f32` call, `fcvt h0, s0` (round to nearest even); the rounding is
//   done by the caller (src/miri/math.ts, `ToSoft_f16`).
// - `powi` is not a libm call: it is compiler-builtins' `__powisf2` / `__powidf2`, linked into the binary (ported in
//   src/miri/math.ts).
//
// So Miri's results are the host libm's, bit for bit, and they differ between hosts (Apple's libm, glibc and the UCRT
// round differently in the last bit). Apple's libm is not open source at the macOS version the oracle runs on, so
// there is no routine to port; this module calls the host's own libm through bun:ffi instead (the same kind of FFI
// edge as src/rust_ts/proc_macro_host.ts, plan-m6 D7):
// - macOS: `/usr/lib/libSystem.B.dylib` (libsystem_m re-exported; the library Miri links).
// - Linux: `libm.so.6` (glibc; what Miri built for a Linux host links).
// - Windows: `ucrtbase.dll` (the UCRT; what the `*-pc-windows-msvc` Miri links). Untested.
// - anything else: `unported`.
// `dlopen` fails as a whole if any symbol is missing, and `ucrtbase.dll` has no `lgamma_r` / `lgammaf_r`. So those two are
// their own group (`host_libm_lgamma`): on Windows only they stop `unported`, not `sin` / `cos` / `pow`.
// Each of these reproduces Miri on that host only; tests that compare with recorded oracle values check the host tuple
// first (src/miri/math.test.ts). JS's `Math.sin` & co. are not used: JavaScriptCore's `Math.pow` has its own fast
// paths, there is no `exp2`, and `f32` operations would be an `f64` result rounded twice.
//
// Arguments and results are exact: a host `f32` value is a JS number holding an `f32` (bun:ffi's `f32` conversion is
// exact on such values), an `f64` is the number itself.

import { dlopen, type FFIFunction, FFIType, type Pointer } from "bun:ffi";
import { unported } from "../std/panic.ts";

/** The libm entry points Miri's host float operations reach (header). */
export interface HostLibm {
  sin(x: number): number;
  cos(x: number): number;
  exp(x: number): number;
  exp2(x: number): number;
  log(x: number): number;
  log10(x: number): number;
  log2(x: number): number;
  pow(x: number, y: number): number;
  sinf(x: number): number;
  cosf(x: number): number;
  expf(x: number): number;
  exp2f(x: number): number;
  logf(x: number): number;
  log10f(x: number): number;
  log2f(x: number): number;
  powf(x: number, y: number): number;
  // src/miri/shims/math.ts
  cbrt(x: number): number;
  cosh(x: number): number;
  sinh(x: number): number;
  tan(x: number): number;
  tanh(x: number): number;
  acos(x: number): number;
  asin(x: number): number;
  atan(x: number): number;
  acosh(x: number): number;
  asinh(x: number): number;
  log1p(x: number): number;
  expm1(x: number): number;
  tgamma(x: number): number;
  erf(x: number): number;
  erfc(x: number): number;
  hypot(x: number, y: number): number;
  atan2(x: number, y: number): number;
  fdim(x: number, y: number): number;
  cbrtf(x: number): number;
  coshf(x: number): number;
  sinhf(x: number): number;
  tanf(x: number): number;
  tanhf(x: number): number;
  acosf(x: number): number;
  asinf(x: number): number;
  atanf(x: number): number;
  acoshf(x: number): number;
  asinhf(x: number): number;
  log1pf(x: number): number;
  expm1f(x: number): number;
  tgammaf(x: number): number;
  erff(x: number): number;
  erfcf(x: number): number;
  hypotf(x: number, y: number): number;
  atan2f(x: number, y: number): number;
  fdimf(x: number, y: number): number;
}

/** `lgamma_r` / `lgammaf_r`, a group of their own (header). `signp` is a pointer to the `i32` sign. */
export interface HostLibmLgamma {
  lgamma_r(x: number, signp: Pointer): number;
  lgammaf_r(x: number, signp: Pointer): number;
}

/** The C library holding the host's libm (header). */
export function host_libm_path(): string {
  switch (process.platform) {
    case "darwin":
      return "/usr/lib/libSystem.B.dylib";
    case "linux":
      return "libm.so.6";
    case "win32":
      return "ucrtbase.dll";
    default:
      return unported(`rust_ts::host_libm (the host C math library on ${process.platform})`);
  }
}

const d1 = { args: [FFIType.f64], returns: FFIType.f64 } as const;
const d2 = { args: [FFIType.f64, FFIType.f64], returns: FFIType.f64 } as const;
const f1 = { args: [FFIType.f32], returns: FFIType.f32 } as const;
const f2 = { args: [FFIType.f32, FFIType.f32], returns: FFIType.f32 } as const;
const SYMBOLS = {
  sin: d1,
  cos: d1,
  exp: d1,
  exp2: d1,
  log: d1,
  log10: d1,
  log2: d1,
  pow: d2,
  sinf: f1,
  cosf: f1,
  expf: f1,
  exp2f: f1,
  logf: f1,
  log10f: f1,
  log2f: f1,
  powf: f2,
  cbrt: d1,
  cosh: d1,
  sinh: d1,
  tan: d1,
  tanh: d1,
  acos: d1,
  asin: d1,
  atan: d1,
  acosh: d1,
  asinh: d1,
  log1p: d1,
  expm1: d1,
  tgamma: d1,
  erf: d1,
  erfc: d1,
  hypot: d2,
  atan2: d2,
  fdim: d2,
  cbrtf: f1,
  coshf: f1,
  sinhf: f1,
  tanf: f1,
  tanhf: f1,
  acosf: f1,
  asinf: f1,
  atanf: f1,
  acoshf: f1,
  asinhf: f1,
  log1pf: f1,
  expm1f: f1,
  tgammaf: f1,
  erff: f1,
  erfcf: f1,
  hypotf: f2,
  atan2f: f2,
  fdimf: f2,
} as const;
const LGAMMA_SYMBOLS = {
  lgamma_r: { args: [FFIType.f64, FFIType.ptr], returns: FFIType.f64 },
  lgammaf_r: { args: [FFIType.f32, FFIType.ptr], returns: FFIType.f32 },
} as const;

/** `dlopen` of the host libm; a host without the library or one of `symbols` stops, it doesn't crash. */
function open_libm<T extends Record<string, FFIFunction>>(symbols: T): unknown {
  try {
    return dlopen(host_libm_path(), symbols).symbols;
  } catch (e) {
    return unported(`host libm ${host_libm_path()}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

let LIBM: HostLibm | undefined;
let LIBM_LGAMMA: HostLibmLgamma | undefined;

/** The host libm, opened on first use (header). */
export function host_libm(): HostLibm {
  // PORT: bun:ffi types each symbol from its declaration; the shapes are the ones declared in `SYMBOLS`.
  LIBM ??= open_libm(SYMBOLS) as HostLibm;
  return LIBM;
}

/** The host libm's `lgamma_r` / `lgammaf_r`, opened on first use (header). */
export function host_libm_lgamma(): HostLibmLgamma {
  LIBM_LGAMMA ??= open_libm(LGAMMA_SYMBOLS) as HostLibmLgamma;
  return LIBM_LGAMMA;
}
