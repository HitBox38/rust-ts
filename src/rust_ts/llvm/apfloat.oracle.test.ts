// rust-ts: differential test of the IR model's floating-point constants against the oracle toolchain's own libLLVM.dylib
// through bun:ffi (lane llir-apfloat; tests only, as capi.oracle.test.ts: the model never calls libLLVM). Each case builds
// the same fold on both sides and compares `LLVMPrintValueToString`, which checks the value and the printer's spelling
// (AsmWriter's decimal-or-hex choice, NaN payloads, signs) at once: FP arithmetic, fneg and fcmp of constants, the six FP
// casts with their poison rules, bitcasts, `LLVMConstReal`, vector splats, and casts of casts. Inputs are the special values
// of each format (signed zeros, infinities, quiet and signalling NaNs with payloads, the subnormal and normal boundaries,
// rounding ties) and a fixed pseudo-random sample of bit patterns.
import { describe, expect, test } from "bun:test";
import { CString, dlopen, type Pointer } from "bun:ffi";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PIN } from "../../../scripts/lib/common.ts";
import { Unported } from "../../std/panic.ts";
import * as L from "./ffi.ts";
import { Inst } from "./inst.ts";
import { ConstantFP, type Context as IrContext } from "./ir.ts";
import { printValueToString } from "./printer.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const SYSROOT = (() => {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } });
    return r.exitCode === 0 ? r.stdout.toString().trim() : "";
  } catch {
    return "";
  }
})();
const DYLIB = join(SYSROOT, "lib", "libLLVM.dylib");
const HAVE = SYSROOT !== "" && existsSync(DYLIB) && process.platform === "darwin";
if (!HAVE && !REQUIRE) console.log(`SKIP: the oracle's libLLVM.dylib is unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const P = "ptr" as const;
const C_API = {
  LLVMContextCreate: { args: [], returns: P },
  LLVMContextDispose: { args: [P], returns: "void" },
  LLVMModuleCreateWithNameInContext: { args: [P, P], returns: P },
  LLVMAddGlobal: { args: [P, P, P], returns: P },
  LLVMIntTypeInContext: { args: [P, "u32"], returns: P },
  LLVMPointerTypeInContext: { args: [P, "u32"], returns: P },
  LLVMHalfTypeInContext: { args: [P], returns: P },
  LLVMBFloatTypeInContext: { args: [P], returns: P },
  LLVMFloatTypeInContext: { args: [P], returns: P },
  LLVMDoubleTypeInContext: { args: [P], returns: P },
  LLVMX86FP80TypeInContext: { args: [P], returns: P },
  LLVMFP128TypeInContext: { args: [P], returns: P },
  LLVMPPCFP128TypeInContext: { args: [P], returns: P },
  LLVMVectorType: { args: [P, "u32"], returns: P },
  LLVMConstIntOfArbitraryPrecision: { args: [P, "u32", P], returns: P },
  LLVMConstBitCast: { args: [P, P], returns: P },
  LLVMConstIntToPtr: { args: [P, P], returns: P },
  LLVMConstPtrToInt: { args: [P, P], returns: P },
  LLVMConstReal: { args: [P, "f64"], returns: P },
  LLVMConstNull: { args: [P], returns: P },
  LLVMConstVector: { args: [P, "u32"], returns: P },
  LLVMGetUndef: { args: [P], returns: P },
  LLVMGetPoison: { args: [P], returns: P },
  LLVMPrintValueToString: { args: [P], returns: P },
  LLVMDisposeMessage: { args: [P], returns: "void" },
  LLVMCreateBuilderInContext: { args: [P], returns: P },
  LLVMDisposeBuilder: { args: [P], returns: "void" },
  LLVMBuildBinOp: { args: [P, "u32", P, P, P], returns: P },
  LLVMBuildCast: { args: [P, "u32", P, P, P], returns: P },
  LLVMBuildFCmp: { args: [P, "u32", P, P, P], returns: P },
  LLVMBuildFNeg: { args: [P, P, P], returns: P },
  LLVMIsAConstant: { args: [P], returns: P },
} as const;

type FT = "Half" | "BFloat" | "Float" | "Double" | "X86_FP80" | "FP128";
const FTS: readonly FT[] = ["Half", "BFloat", "Float", "Double", "X86_FP80", "FP128"];
const WIDTH: Readonly<Record<FT, number>> = { Half: 16, BFloat: 16, Float: 32, Double: 64, X86_FP80: 80, FP128: 128 };
/** Exponent and trailing significand bits of the interchange formats (x86_fp80 has its explicit integer bit). */
const LAYOUT: Readonly<Record<Exclude<FT, "X86_FP80">, [number, number]>> = { Half: [5, 10], BFloat: [8, 7], Float: [8, 23], Double: [11, 52], FP128: [15, 112] };

/** A fixed 64-bit LCG, so every run (and every agent) sees the same sample. */
function lcg(seed: bigint): (bits: number) => bigint {
  let s = seed;
  return (bits) => {
    let r = 0n;
    for (let i = 0; i < bits; i += 31) {
      s = (s * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
      r = (r << 31n) | (s >> 33n);
    }
    return BigInt.asUintN(bits, r);
  };
}

/** The special values of a format: zeros, the subnormal and normal boundaries, one and its neighbours, ties, infinities,
 * quiet and signalling NaNs with and without payloads, all with both signs. */
function specials(t: FT): bigint[] {
  const out: bigint[] = [];
  if (t === "X86_FP80") {
    const I = 1n << 63n;
    for (const e of [0n, 1n, 16382n, 16383n, 16384n, 16383n + 63n, 16383n + 64n, 0x7ffen, 0x7fffn]) {
      for (const m of [0n, 1n, I, I | 1n, (1n << 64n) - 1n, 1n << 62n, I | (1n << 62n), I | (1n << 62n) | 5n, I | (1n << 10n) | (1n << 11n)]) out.push((e << 64n) | m);
    }
    return [...out, ...out.map((b) => b | (1n << 79n))];
  }
  const [e, m] = LAYOUT[t];
  const M = BigInt(m);
  const EM = ((1n << BigInt(e)) - 1n) << M;
  const MM = (1n << M) - 1n;
  const Q = 1n << (M - 1n);
  const bias = (1n << BigInt(e - 1)) - 1n;
  const exp = (x: bigint): bigint => x << M;
  for (const b of [
    0n, 1n, 2n, MM, MM - 1n, 1n << M, (1n << M) | 1n, exp(bias), exp(bias) | 1n, exp(bias) | Q, exp(bias) - 1n, exp(bias + 1n), exp(bias + 1n) | Q,
    exp(bias - 1n), exp(bias + M), exp(bias + M) | 1n, exp(bias + M + 1n) | 1n, exp(bias + 31n), exp(bias + 63n) | MM, exp(bias + 64n), exp(bias + 127n) | MM,
    exp(bias + 128n), EM - 1n, EM, EM | 1n, EM | Q, EM | Q | 1n, EM | MM, EM | (Q >> 1n),
  ]) {
    if (b < 1n << BigInt(e + m)) out.push(b);
  }
  return [...out, ...out.map((b) => b | (1n << BigInt(e + m)))];
}

describe.skipIf(!HAVE && !REQUIRE)("APFloat: model vs libLLVM", () => {
  // PORT: an FFI edge (PORTING §7): bun:ffi's inferred types do not let a returned `ptr` flow into a `ptr` parameter.
  // biome-ignore lint/suspicious/noExplicitAny: FFI edge
  const lib = (HAVE ? dlopen(DYLIB, C_API).symbols : undefined) as unknown as Record<keyof typeof C_API, (...a: any[]) => any>;
  const cstr = (s: string): Buffer => Buffer.from(`${s}\0`, "utf8");
  const noName = cstr("");
  const owned = (p: Pointer | null): string => {
    const s = new CString(p!).toString();
    lib.LLVMDisposeMessage(p);
    return s;
  };
  const rc = lib.LLVMContextCreate();
  const rb = lib.LLVMCreateBuilderInContext(rc);
  const mc = L.LLVMContextCreate();
  const mb = L.LLVMCreateBuilderInContext(mc);
  const rT: Record<FT | "PPC_FP128", Pointer> = {
    Half: lib.LLVMHalfTypeInContext(rc),
    BFloat: lib.LLVMBFloatTypeInContext(rc),
    Float: lib.LLVMFloatTypeInContext(rc),
    Double: lib.LLVMDoubleTypeInContext(rc),
    X86_FP80: lib.LLVMX86FP80TypeInContext(rc),
    FP128: lib.LLVMFP128TypeInContext(rc),
    PPC_FP128: lib.LLVMPPCFP128TypeInContext(rc),
  };
  const mT: Record<FT | "PPC_FP128", L.Type> = {
    Half: L.LLVMHalfTypeInContext(mc),
    BFloat: L.LLVMBFloatTypeInContext(mc),
    Float: L.LLVMFloatTypeInContext(mc),
    Double: L.LLVMDoubleTypeInContext(mc),
    // ffi.rs has no LLVMX86FP80TypeInContext (rustc never makes the type); the model's context gives it.
    X86_FP80: (mc as unknown as IrContext).getFloatingType("X86_FP80") as unknown as L.Type,
    FP128: L.LLVMFP128TypeInContext(mc),
    PPC_FP128: L.LLVMPPCFP128TypeInContext(mc),
  };
  const rInt = (n: number): Pointer => lib.LLVMIntTypeInContext(rc, n);
  const mInt = (n: number): L.Type => L.LLVMIntTypeInContext(mc, n);
  const words = (n: number, v: bigint): bigint[] => {
    const out: bigint[] = [];
    let x = BigInt.asUintN(n, v);
    for (let i = 0; i < Math.max(1, Math.ceil(n / 64)); i++, x >>= 64n) out.push(x & ((1n << 64n) - 1n));
    return out;
  };
  const rIntC = (n: number, v: bigint): Pointer => {
    const w = words(n, v);
    return lib.LLVMConstIntOfArbitraryPrecision(rInt(n), w.length, new BigUint64Array(w));
  };
  const mIntC = (n: number, v: bigint): L.Value => {
    const w = words(n, v);
    return L.LLVMConstIntOfArbitraryPrecision(mInt(n), w.length, w);
  };
  const rFP = (t: FT, bits: bigint): Pointer => lib.LLVMConstBitCast(rIntC(WIDTH[t], bits), rT[t]);
  const mFP = (t: FT, bits: bigint): L.Value => L.LLVMConstBitCast(mIntC(WIDTH[t], bits), mT[t]);

  // Every case: [what, the oracle's printed answer, the model's]. A model stop is reported as such, never compared away.
  let agreed = 0;
  const wrong: string[] = [];
  const stops = new Map<string, number>();
  function check(what: string, real: Pointer | null, mine: () => L.Value): void {
    let m: string;
    try {
      const v = mine();
      // Neither side folded: both made an instruction (not in a block), which this test does not print.
      if (lib.LLVMIsAConstant(real) === null) {
        if (v instanceof Inst) agreed++;
        else wrong.push(`${what}: llvm made an instruction, the model \`${printValueToString(v)}\``);
        return;
      }
      m = printValueToString(v);
    } catch (e) {
      if (!(e instanceof Unported)) throw e;
      const k = String(e.message);
      stops.set(k, (stops.get(k) ?? 0) + 1);
      return;
    }
    const r = owned(lib.LLVMPrintValueToString(real));
    if (r === m) agreed++;
    else if (wrong.length < 40) wrong.push(`${what}: llvm \`${r}\`, model \`${m}\``);
    else wrong.push("...");
  }
  /** The end of each test: no disagreement, and only the stops the handoff lists (per-element vector folds, a ConstantVector
   * of fp128/x86_fp80 elements). */
  function done(minAgreed: number): void {
    if (process.env.APFLOAT_TEST_VERBOSE) console.log(`agreed ${agreed}; stops ${JSON.stringify([...stops])}`);
    const [w, st, a] = [[...wrong], [...stops.keys()], agreed];
    total += agreed;
    agreed = 0;
    wrong.length = 0;
    stops.clear();
    expect(w).toEqual([]);
    for (const k of st) expect(k).toMatch(/non-splat vector|ConstantVector::get of other elements/);
    expect(a).toBeGreaterThanOrEqual(minAgreed);
  }
  let total = 0;
  const rnd = lcg(0x6c6c69722d617066n);
  /** Every `stride`-th special value and `n` random bit patterns. fp128 and x86_fp80 get fewer: their huge exponents make
   * the printer's decimal round trip (rustc_apfloat's bigint decimal conversion) slow. */
  const sample = (t: FT, n: number, stride = 1): bigint[] => {
    const wide = t === "X86_FP80" || t === "FP128";
    const v = specials(t).filter((_, i) => i % (wide ? stride * 2 : stride) === 0);
    for (let i = 0; i < (wide ? Math.ceil(n / 4) : n); i++) v.push(rnd(WIDTH[t]));
    return v;
  };

  const hex = (b: bigint): string => `0x${b.toString(16)}`;
  const BIN = { FAdd: 9, FSub: 11, FMul: 13, FDiv: 16, FRem: 19 } as const;
  const mBin = { FAdd: L.LLVMBuildFAdd, FSub: L.LLVMBuildFSub, FMul: L.LLVMBuildFMul, FDiv: L.LLVMBuildFDiv, FRem: L.LLVMBuildFRem } as const;
  const CAST = { FPToUI: 33, FPToSI: 34, UIToFP: 35, SIToFP: 36, FPTrunc: 37, FPExt: 38, BitCast: 41 } as const;
  const mCast = { FPToUI: L.LLVMBuildFPToUI, FPToSI: L.LLVMBuildFPToSI, UIToFP: L.LLVMBuildUIToFP, SIToFP: L.LLVMBuildSIToFP, FPTrunc: L.LLVMBuildFPTrunc, FPExt: L.LLVMBuildFPExt, BitCast: L.LLVMBuildBitCast } as const;

  test("constants of every bit pattern print as AsmWriter prints them (decimal round trip, hex, NaN payloads)", () => {
    for (const t of FTS) for (const b of sample(t, 200)) check(`${t} ${hex(b)}`, rFP(t, b), () => mFP(t, b));
    done(1200);
  });

  test("LLVMConstReal: a double converted to each format (ConstantFP::get(Type*, double))", () => {
    const dv = new DataView(new ArrayBuffer(8));
    const fromBits = (b: bigint): number => (dv.setBigUint64(0, b), dv.getFloat64(0));
    const ds = [0, -0, 1, -1, 1.5, 0.1, 1 / 3, 2 ** -24, 2 ** -25, 2 ** -149, 2 ** -150, 2 ** -1074, 65504, 65520, 3.4028234663852886e38, 3.4028235677973366e38, 1e308, Infinity, -Infinity, Number.NaN];
    for (const b of [0x7ff4000000000000n, 0xfff8000000000001n, 0x7ff0000000000001n, 0x7ff8000000000123n, 0x3ff0000000000001n, 0x3ff0000010000000n, 0x3ff0000008000000n, 0x3ff0000018000000n]) ds.push(fromBits(b));
    for (let i = 0; i < 200; i++) ds.push(fromBits(rnd(64)));
    for (const t of FTS) for (const d of ds) check(`LLVMConstReal(${t}, ${d})`, lib.LLVMConstReal(rT[t], d), () => L.LLVMConstReal(mT[t], d));
    done(1000);
  });

  test("fadd, fsub, fmul, fdiv, frem of two constants", () => {
    for (const t of FTS) {
      const vs = sample(t, 4, 3);
      const rv = vs.map((b) => rFP(t, b));
      const mv = vs.map((b) => mFP(t, b));
      for (let i = 0; i < vs.length; i++) {
        for (let j = 0; j < vs.length; j++) {
          for (const [op, code] of Object.entries(BIN) as [keyof typeof BIN, number][]) {
            check(`${t} ${hex(vs[i]!)} ${op} ${hex(vs[j]!)}`, lib.LLVMBuildBinOp(rb, code, rv[i], rv[j], noName), () => mBin[op](mb, mv[i]!, mv[j]!, ""));
          }
        }
      }
    }
    done(8000);
  }, 60_000);

  test("fneg and every fcmp predicate of constants", () => {
    for (const t of FTS) {
      const vs = sample(t, 8);
      for (const b of vs) check(`fneg ${t} ${hex(b)}`, lib.LLVMBuildFNeg(rb, rFP(t, b), noName), () => L.LLVMBuildFNeg(mb, mFP(t, b), ""));
      const few = vs.filter((_, i) => i % 3 === 0);
      for (const a of few) {
        for (const b of few) {
          for (let p = 0; p <= 15; p++) check(`fcmp ${p} ${t} ${hex(a)}, ${hex(b)}`, lib.LLVMBuildFCmp(rb, p, rFP(t, a), rFP(t, b), noName), () => L.LLVMBuildFCmp(mb, p, mFP(t, a), mFP(t, b), ""));
        }
      }
    }
    done(3000);
  });

  test("fptrunc and fpext between every pair of formats", () => {
    for (const s of FTS) {
      for (const d of FTS) {
        if (WIDTH[s] === WIDTH[d]) continue;
        const op = WIDTH[d] > WIDTH[s] ? "FPExt" : "FPTrunc";
        for (const b of sample(s, 40, 2)) check(`${op} ${s} ${hex(b)} to ${d}`, lib.LLVMBuildCast(rb, CAST[op], rFP(s, b), rT[d], noName), () => mCast[op](mb, mFP(s, b), mT[d], ""));
      }
    }
    done(1500);
  });

  test("fptoui and fptosi, with poison when out of range", () => {
    for (const s of FTS) {
      for (const w of [1, 8, 16, 32, 64, 128]) {
        for (const op of ["FPToUI", "FPToSI"] as const) {
          for (const b of sample(s, 30)) check(`${op} ${s} ${hex(b)} to i${w}`, lib.LLVMBuildCast(rb, CAST[op], rFP(s, b), rInt(w), noName), () => mCast[op](mb, mFP(s, b), mInt(w), ""));
        }
      }
      // Values near each integer width's limits: 2^(w-1) and 2^w, and their neighbours.
      const d = (x: number): Pointer => lib.LLVMConstReal(rT[s], x);
      const md = (x: number): L.Value => L.LLVMConstReal(mT[s], x);
      for (const x of [-1, -0.5, -0.9999, 0.5, 0.9999, 127, 127.5, 128, 255, 255.9, 256, -128, -128.5, -129, 2 ** 31, 2 ** 31 - 1, 2 ** 32, -(2 ** 31), 2 ** 63, 2 ** 64, -(2 ** 63), 2 ** 127, 2 ** 128]) {
        for (const w of [8, 32, 64, 128]) for (const op of ["FPToUI", "FPToSI"] as const) check(`${op} ${s} ${x} to i${w}`, lib.LLVMBuildCast(rb, CAST[op], d(x), rInt(w), noName), () => mCast[op](mb, md(x), mInt(w), ""));
      }
    }
    done(5000);
  });

  test("uitofp and sitofp, rounding to nearest-even", () => {
    for (const d of FTS) {
      for (const w of [1, 8, 16, 32, 64, 128]) {
        const ints = [0n, 1n, -1n, 2n, 3n, 1n << BigInt(w - 1), (1n << BigInt(w - 1)) - 1n, 0x7ffn, 0x801n, 0x803n, 0xfffn, 0x1001n, (1n << 24n) + 1n, (1n << 24n) + 3n, (1n << 53n) + 1n, (1n << 54n) + 3n, (1n << 64n) - 1n, (1n << 113n) + 1n];
        for (let i = 0; i < 24; i++) ints.push(rnd(w));
        for (const op of ["UIToFP", "SIToFP"] as const) {
          for (const x of ints) check(`${op} i${w} ${hex(BigInt.asUintN(w, x))} to ${d}`, lib.LLVMBuildCast(rb, CAST[op], rIntC(w, x), rT[d], noName), () => mCast[op](mb, mIntC(w, x), mT[d], ""));
        }
      }
    }
    done(2500);
  });

  test("bitcasts between floats and integers, and half <-> bfloat", () => {
    for (const t of FTS) {
      for (const b of sample(t, 30)) {
        check(`bitcast ${t} ${hex(b)} to i${WIDTH[t]}`, lib.LLVMBuildCast(rb, CAST.BitCast, rFP(t, b), rInt(WIDTH[t]), noName), () => L.LLVMBuildBitCast(mb, mFP(t, b), mInt(WIDTH[t]), ""));
        if (t === "Half" || t === "BFloat") {
          const o: FT = t === "Half" ? "BFloat" : "Half";
          check(`bitcast ${t} ${hex(b)} to ${o}`, lib.LLVMBuildCast(rb, CAST.BitCast, rFP(t, b), rT[o], noName), () => L.LLVMBuildBitCast(mb, mFP(t, b), mT[o], ""));
        }
      }
    }
    done(300);
  });

  test("vector-typed ConstantFP splats: building, folding, casting, printing", () => {
    for (const t of FTS) {
      const rv = lib.LLVMVectorType(rT[t], 4);
      const mv = L.LLVMVectorType(mT[t], 4);
      const vs = sample(t, 4).filter((_, i) => i % 8 === 0);
      const rSplat = (b: bigint): Pointer => lib.LLVMConstVector(new BigUint64Array(Array(4).fill(BigInt(rFP(t, b)))), 4);
      const mSplat = (b: bigint): L.Value => L.LLVMConstVector(Array(4).fill(mFP(t, b)), 4);
      check(`null <4 x ${t}>`, lib.LLVMConstNull(rv), () => L.LLVMConstNull(mv));
      for (const a of vs) {
        check(`splat ${t} ${hex(a)}`, rSplat(a), () => mSplat(a));
        check(`fneg splat ${t} ${hex(a)}`, lib.LLVMBuildFNeg(rb, rSplat(a), noName), () => L.LLVMBuildFNeg(mb, mSplat(a), ""));
        check(`bitcast splat ${t} ${hex(a)}`, lib.LLVMBuildCast(rb, CAST.BitCast, rSplat(a), lib.LLVMVectorType(rInt(WIDTH[t]), 4), noName), () => L.LLVMBuildBitCast(mb, mSplat(a), L.LLVMVectorType(mInt(WIDTH[t]), 4), ""));
        check(`fptosi splat ${t} ${hex(a)}`, lib.LLVMBuildCast(rb, CAST.FPToSI, rSplat(a), lib.LLVMVectorType(rInt(32), 4), noName), () => L.LLVMBuildFPToSI(mb, mSplat(a), L.LLVMVectorType(mInt(32), 4), ""));
        for (const d of FTS) {
          if (WIDTH[d] === WIDTH[t]) continue;
          const op = WIDTH[d] > WIDTH[t] ? "FPExt" : "FPTrunc";
          check(`${op} splat ${t} ${hex(a)} to ${d}`, lib.LLVMBuildCast(rb, CAST[op], rSplat(a), lib.LLVMVectorType(rT[d], 4), noName), () => mCast[op](mb, mSplat(a), L.LLVMVectorType(mT[d], 4), ""));
        }
        for (const b of vs) {
          for (const [op, code] of Object.entries(BIN) as [keyof typeof BIN, number][]) {
            check(`${t} splat ${hex(a)} ${op} splat ${hex(b)}`, lib.LLVMBuildBinOp(rb, code, rSplat(a), rSplat(b), noName), () => mBin[op](mb, mSplat(a), mSplat(b), ""));
          }
        }
      }
      // A data vector of floats (two different elements), and a splat of an integer converted to floats.
      if (t !== "X86_FP80" && t !== "FP128") {
        const [a, b] = [vs[1]!, vs[2]!];
        check(`<${t} ${hex(a)}, ${hex(b)}, ...>`, lib.LLVMConstVector(new BigUint64Array([a, b, a, b].map((x) => BigInt(rFP(t, x)))), 4), () => L.LLVMConstVector([a, b, a, b].map((x) => mFP(t, x)), 4));
      }
      const r7 = lib.LLVMConstVector(new BigUint64Array(Array(4).fill(BigInt(rIntC(32, 7n)))), 4);
      const m7 = L.LLVMConstVector(Array(4).fill(mIntC(32, 7n)), 4);
      check(`sitofp splat i32 7 to ${t}`, lib.LLVMBuildCast(rb, CAST.SIToFP, r7, rv, noName), () => L.LLVMBuildSIToFP(mb, m7, mv, ""));
      // The FAdd identity of a vector is a -0.0 splat.
      check(`fadd <4 x ${t}> poison, -0.0`, lib.LLVMBuildBinOp(rb, BIN.FAdd, lib.LLVMGetPoison(rv), rSplat(1n << BigInt(WIDTH[t] - 1)), noName), () => L.LLVMBuildFAdd(mb, L.LLVMGetPoison(mv), mSplat(1n << BigInt(WIDTH[t] - 1)), ""));
    }
    done(2000);
  }, 60_000);

  test("casts of casts (foldConstantCastPair / CastInst::isEliminableCastPair without a data layout)", () => {
    const rm = lib.LLVMModuleCreateWithNameInContext(cstr("m"), rc);
    const mm = L.LLVMModuleCreateWithNameInContext("m", mc);
    const rp = lib.LLVMPointerTypeInContext(rc, 0);
    const mp = L.LLVMPointerTypeInContext(mc, 0);
    const rg = lib.LLVMAddGlobal(rm, rInt(8), cstr("g"));
    const mg = L.LLVMAddGlobal(mm, mInt(8), "g");
    const rP2I = (w: number): Pointer => lib.LLVMConstPtrToInt(rg, rInt(w));
    const mP2I = (w: number): L.Value => L.LLVMConstPtrToInt(mg, mInt(w));
    for (const w of [8, 32, 64, 128]) {
      for (const v of [16, 32, 64, 128]) {
        if (v < w) check(`trunc (ptrtoint @g to i${w}) to i${v}`, lib.LLVMBuildCast(rb, 30, rP2I(w), rInt(v), noName), () => L.LLVMBuildTrunc(mb, mP2I(w), mInt(v), ""));
        if (v > w) check(`zext (ptrtoint @g to i${w}) to i${v}`, lib.LLVMBuildCast(rb, 31, rP2I(w), rInt(v), noName), () => L.LLVMBuildZExt(mb, mP2I(w), mInt(v), ""));
        if (v > w) check(`sext (ptrtoint @g to i${w}) to i${v}`, lib.LLVMBuildCast(rb, 32, rP2I(w), rInt(v), noName), () => L.LLVMBuildSExt(mb, mP2I(w), mInt(v), ""));
      }
      check(`inttoptr (ptrtoint @g to i${w})`, lib.LLVMConstIntToPtr(rP2I(w), rp), () => L.LLVMConstIntToPtr(mP2I(w), mp));
      check(`ptrtoint (inttoptr i${w} 8) to i64`, lib.LLVMConstPtrToInt(lib.LLVMConstIntToPtr(rIntC(w, 8n), rp), rInt(64)), () => L.LLVMConstPtrToInt(L.LLVMConstIntToPtr(mIntC(w, 8n), mp), mInt(64)));
      check(`bitcast (ptrtoint @g to i${w})`, lib.LLVMBuildCast(rb, CAST.BitCast, rP2I(w), rInt(w), noName), () => L.LLVMBuildBitCast(mb, mP2I(w), mInt(w), ""));
      check(`uitofp (ptrtoint @g to i${w}) to double`, lib.LLVMBuildCast(rb, CAST.UIToFP, rP2I(w), rT.Double, noName), () => L.LLVMBuildUIToFP(mb, mP2I(w), mT.Double, ""));
    }
    done(30);
  });

  test("undef operands and identities", () => {
    for (const t of FTS) {
      for (const [op, code] of Object.entries(BIN) as [keyof typeof BIN, number][]) {
        check(`${op} ${t} undef, 1.0`, lib.LLVMBuildBinOp(rb, code, lib.LLVMGetUndef(rT[t]), lib.LLVMConstReal(rT[t], 1), noName), () => mBin[op](mb, L.LLVMGetUndef(mT[t]), L.LLVMConstReal(mT[t], 1), ""));
        check(`${op} ${t} -0.0, undef`, lib.LLVMBuildBinOp(rb, code, lib.LLVMConstReal(rT[t], -0), lib.LLVMGetUndef(rT[t]), noName), () => mBin[op](mb, L.LLVMConstReal(mT[t], -0), L.LLVMGetUndef(mT[t]), ""));
      }
    }
    done(60);
  });

  test("ppc_fp128: bits only; DoubleAPFloat arithmetic, conversions and decimal printing stop", () => {
    const zero = L.LLVMConstNull(mT.PPC_FP128);
    // `fneg 0.0` flips both doubles' signs (DoubleAPFloat::changeSign). Printing tries the decimal round trip even when the
    // second double is nonzero (writeAPFloatInternal's ForceBitwiseOutput only skips the inf/NaN spellings), so it stops.
    const negZero = L.LLVMBuildFNeg(mb, zero, "");
    expect((negZero as unknown as ConstantFP).bits).toBe((1n << 127n) | (1n << 63n));
    expect(owned(lib.LLVMPrintValueToString(lib.LLVMBuildFNeg(rb, lib.LLVMConstNull(rT.PPC_FP128), noName)))).toBe("ppc_fp128 -0.000000e+00");
    expect(() => printValueToString(negZero)).toThrow(Unported);
    expect(() => printValueToString(zero)).toThrow(Unported);
    expect(() => L.LLVMBuildFAdd(mb, zero, zero, "")).toThrow(Unported);
    expect(() => L.LLVMConstReal(mT.PPC_FP128, 1)).toThrow(Unported);
    expect(() => L.LLVMBuildFPToSI(mb, L.LLVMBuildFNeg(mb, zero, ""), mInt(32), "")).toThrow(Unported);
  });

  test("in all, more than 50,000 cases agree", () => {
    expect(total).toBeGreaterThan(50000);
    lib.LLVMDisposeBuilder(rb);
    lib.LLVMContextDispose(rc);
  });
});
