// rust-ts glue (not an upstream mirror): the host C math library, for Miri's host float operations
// (src/tools/miri/src/math.rs `HostFloatOperation`, ported in src/miri/math.ts; lane miri-eval-fix, decision recorded
// in docs/handoff/miri-eval-fix.md).
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
// Each of these reproduces Miri on that host only; tests that compare with recorded oracle values check the host tuple
// first (src/miri/math.test.ts). JS's `Math.sin` & co. are not used: JavaScriptCore's `Math.pow` has its own fast
// paths, there is no `exp2`, and `f32` operations would be an `f64` result rounded twice.
//
// Arguments and results are exact: a host `f32` value is a JS number holding an `f32` (bun:ffi's `f32` conversion is
// exact on such values), an `f64` is the number itself.

import { dlopen, FFIType } from "bun:ffi";
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
} as const;

let LIBM: HostLibm | undefined;

/** The host libm, opened on first use (header). */
export function host_libm(): HostLibm {
  if (LIBM === undefined) {
    let lib: ReturnType<typeof dlopen<typeof SYMBOLS>>;
    try {
      lib = dlopen(host_libm_path(), SYMBOLS);
    } catch (e) {
      // A host without this libm (or without one of the symbols) cannot run Miri's host float ops: stop, don't crash.
      return unported(`host libm ${host_libm_path()}: ${e instanceof Error ? e.message : String(e)}`);
    }
    // PORT: bun:ffi types each symbol from its declaration; the shapes are the ones declared in `SYMBOLS`.
    LIBM = lib.symbols as unknown as HostLibm;
  }
  return LIBM;
}
