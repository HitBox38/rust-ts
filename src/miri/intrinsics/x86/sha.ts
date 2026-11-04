//! Implements sha256 SIMD instructions of x86 targets
//!
//! The functions that actually compute SHA256 were copied from [RustCrypto's sha256 module].
//!
//! [RustCrypto's sha256 module]: https://github.com/RustCrypto/hashes/blob/6be8466247e936c415d8aafb848697f39894a386/sha2/src/sha256/soft.rs
// Port of src/tools/miri/src/intrinsics/x86/sha.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-x86-b` (plan-m6 wave 38): ported by this lane.
//
// PORT:
// - `sha256::{round, sigma0, sigma1}` are flattened into intrinsics/math.ts (lane miri-shims-d).
// - `[u32; 4]` is a `number[]`; `u32` values stay unsigned with `>>> 0`.
// - Rust shadows `a` / `b` / `k` / `dest` with their projections, then their contents; the projections here are `*_v` and
//   the contents `*_r`.
import { type MPlaceTy, type OpTy } from "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import { EmulateItemResult } from "../../shims/mod.ts";
import { round, sigma0, sigma1 } from "../math.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { interp_ok, type InterpResult, Scalar } from "../../../rustc_middle/mir/interpret/mod.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { assert_eq, unwrap } from "../../../std/panic.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- intrinsics/x86/sha.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // intrinsics/x86/sha.rs:14
    emulate_x86_sha_intrinsic(this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult>;
  }
}

/** `assert_eq!` of two `u64` lengths. */
function assert_eq_len(left: bigint, right: bigint): void {
  assert_eq(left, right, (v) => `${v}`);
}

/** `str::strip_prefix` */
function strip_prefix(s: string, prefix: string): string | undefined {
  return s.startsWith(prefix) ? s.slice(prefix.length) : undefined;
}

// rustc: src/tools/miri/src/intrinsics/x86/sha.rs:14 emulate_x86_sha_intrinsic
InterpCx.prototype.emulate_x86_sha_intrinsic = function (this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult> {
  const this_ = this.eval_context_mut();
  const f = this_.expect_target_feature_for_intrinsic(link_name, "sha");
  if (f.$ === "Err") return f;
  // Prefix should have already been checked.
  const unprefixed_name = unwrap(strip_prefix(Symbol.as_str(link_name), "llvm.x86.sha"));

  // rustc: src/tools/miri/src/intrinsics/x86/sha.rs:25 read
  function read(ecx: MiriInterpCx, vec: OpTy): InterpResult<number[]> {
    const res = [0, 0, 0, 0];
    // We reverse the order because x86 is little endian but the copied implementation uses
    // big endian.
    for (let i = 0; i < 4; i++) {
      const projected = ecx.project_index(vec, BigInt(i));
      if (projected.$ === "Err") return projected;
      const s = ecx.read_scalar(projected._0);
      if (s.$ === "Err") return s;
      const u = Scalar.to_u32(s._0);
      if (u.$ === "Err") return u;
      res[3 - i] = u._0;
    }
    return interp_ok(res);
  }

  // rustc: src/tools/miri/src/intrinsics/x86/sha.rs:36 write
  function write(ecx: MiriInterpCx, dest: MPlaceTy, val: readonly number[]): InterpResult {
    // We reverse the order because x86 is little endian but the copied implementation uses
    // big endian.
    for (let i = 0; i < 4; i++) {
      const part = val[3 - i]!;
      const projected = ecx.project_index(dest, BigInt(i));
      if (projected.$ === "Err") return projected;
      const w = ecx.write_scalar(Scalar.from_u32(part), projected._0);
      if (w.$ === "Err") return w;
    }
    return interp_ok(undefined);
  }

  switch (unprefixed_name) {
    // Used to implement the _mm_sha256rnds2_epu32 function.
    case "256rnds2": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 3);
      if (sig.$ === "Err") return sig;
      const [a, b, k] = sig._0 as [OpTy, OpTy, OpTy];

      const a_s = this_.project_to_simd(a);
      if (a_s.$ === "Err") return a_s;
      const [a_v, a_len] = a_s._0;
      const b_s = this_.project_to_simd(b);
      if (b_s.$ === "Err") return b_s;
      const [b_v, b_len] = b_s._0;
      const k_s = this_.project_to_simd(k);
      if (k_s.$ === "Err") return k_s;
      const [k_v, k_len] = k_s._0;
      const dest_s = this_.project_to_simd(dest);
      if (dest_s.$ === "Err") return dest_s;
      const [dest_v, dest_len] = dest_s._0;

      assert_eq_len(a_len, 4n);
      assert_eq_len(b_len, 4n);
      assert_eq_len(k_len, 4n);
      assert_eq_len(dest_len, 4n);

      const a_r = read(this_, a_v);
      if (a_r.$ === "Err") return a_r;
      const b_r = read(this_, b_v);
      if (b_r.$ === "Err") return b_r;
      const k_r = read(this_, k_v);
      if (k_r.$ === "Err") return k_r;

      const result = sha256_digest_round_x2(a_r._0, b_r._0, k_r._0);
      const w = write(this_, dest_v, result);
      if (w.$ === "Err") return w;
      break;
    }
    // Used to implement the _mm_sha256msg1_epu32 function.
    case "256msg1": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [a, b] = sig._0 as [OpTy, OpTy];

      const a_s = this_.project_to_simd(a);
      if (a_s.$ === "Err") return a_s;
      const [a_v, a_len] = a_s._0;
      const b_s = this_.project_to_simd(b);
      if (b_s.$ === "Err") return b_s;
      const [b_v, b_len] = b_s._0;
      const dest_s = this_.project_to_simd(dest);
      if (dest_s.$ === "Err") return dest_s;
      const [dest_v, dest_len] = dest_s._0;

      assert_eq_len(a_len, 4n);
      assert_eq_len(b_len, 4n);
      assert_eq_len(dest_len, 4n);

      const a_r = read(this_, a_v);
      if (a_r.$ === "Err") return a_r;
      const b_r = read(this_, b_v);
      if (b_r.$ === "Err") return b_r;

      const result = sha256msg1(a_r._0, b_r._0);
      const w = write(this_, dest_v, result);
      if (w.$ === "Err") return w;
      break;
    }
    // Used to implement the _mm_sha256msg2_epu32 function.
    case "256msg2": {
      const sig = this_.check_shim_sig_llvm_intrinsic(link_name, args, 2);
      if (sig.$ === "Err") return sig;
      const [a, b] = sig._0 as [OpTy, OpTy];

      const a_s = this_.project_to_simd(a);
      if (a_s.$ === "Err") return a_s;
      const [a_v, a_len] = a_s._0;
      const b_s = this_.project_to_simd(b);
      if (b_s.$ === "Err") return b_s;
      const [b_v, b_len] = b_s._0;
      const dest_s = this_.project_to_simd(dest);
      if (dest_s.$ === "Err") return dest_s;
      const [dest_v, dest_len] = dest_s._0;

      assert_eq_len(a_len, 4n);
      assert_eq_len(b_len, 4n);
      assert_eq_len(dest_len, 4n);

      const a_r = read(this_, a_v);
      if (a_r.$ === "Err") return a_r;
      const b_r = read(this_, b_v);
      if (b_r.$ === "Err") return b_r;

      const result = sha256msg2(a_r._0, b_r._0);
      const w = write(this_, dest_v, result);
      if (w.$ === "Err") return w;
      break;
    }
    default:
      return interp_ok(EmulateItemResult.NotSupported);
  }
  return interp_ok(EmulateItemResult.NeedsReturn);
};

// rustc: src/tools/miri/src/intrinsics/x86/sha.rs:114 sha256load
function sha256load(v2: readonly number[], v3: readonly number[]): number[] {
  return [v3[3]!, v2[0]!, v2[1]!, v2[2]!];
}

// rustc: src/tools/miri/src/intrinsics/x86/sha.rs:118 sha256_digest_round_x2
function sha256_digest_round_x2(cdgh: readonly number[], abef: readonly number[], wk: readonly number[]): number[] {
  // `sha256rnds2`: two rounds on the abef/cdgh permutation
  // Ref: https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm_sha256rnds2
  const [, , wk1, wk0] = wk as [number, number, number, number];
  const [a0, b0, e0, f0] = abef as [number, number, number, number];
  const [c0, d0, g0, h0] = cdgh as [number, number, number, number];

  let state = round([a0, b0, c0, d0, e0, f0, g0, h0], wk0);
  state = round(state, wk1);

  return [state[0]!, state[1]!, state[4]!, state[5]!];
}

// rustc: src/tools/miri/src/intrinsics/x86/sha.rs:131 sha256msg1
function sha256msg1(v0: readonly number[], v1: readonly number[]): number[] {
  const x = sha256load(v0, v1);
  return [
    (v0[0]! + sigma0(x[0]!)) >>> 0,
    (v0[1]! + sigma0(x[1]!)) >>> 0,
    (v0[2]! + sigma0(x[2]!)) >>> 0,
    (v0[3]! + sigma0(x[3]!)) >>> 0,
  ];
}

// rustc: src/tools/miri/src/intrinsics/x86/sha.rs:141 sha256msg2
function sha256msg2(v4: readonly number[], v3: readonly number[]): number[] {
  const [x3, x2, x1, x0] = v4 as [number, number, number, number];
  const [w15, w14] = v3 as [number, number, number, number];

  const w16 = (x0 + sigma1(w14)) >>> 0;
  const w17 = (x1 + sigma1(w15)) >>> 0;
  const w18 = (x2 + sigma1(w16)) >>> 0;
  const w19 = (x3 + sigma1(w17)) >>> 0;

  return [w19, w18, w17, w16];
}
