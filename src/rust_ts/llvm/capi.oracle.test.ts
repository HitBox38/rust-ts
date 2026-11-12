// rust-ts: differential tests of the IR model against the real LLVM C API, in the oracle toolchain's own libLLVM.dylib through
// bun:ffi (review plan-m7 F6 item 3; lane llir-core-a). **Tests only**: the model never calls libLLVM. These cover rules the
// corpus rarely reaches (the review saw 0 global and 0 struct-name collisions in 239 cases), and facts the model hard-codes
// (the LLVM version, the custom metadata kind numbering, which triples are their own normal form, string escapes).
import { describe, expect, test } from "bun:test";
import { CString, dlopen, type Pointer, toArrayBuffer } from "bun:ffi";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PIN } from "../../../scripts/lib/common.ts";
import { LLVM_VERSION, NORMAL_TRIPLES } from "./core.ts";
import * as L from "./ffi.ts";
import { Unported } from "../../std/panic.ts";
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
  LLVMIntTypeInContext: { args: [P, "u32"], returns: P },
  LLVMPointerTypeInContext: { args: [P, "u32"], returns: P },
  LLVMVoidTypeInContext: { args: [P], returns: P },
  LLVMFunctionType: { args: [P, P, "u32", "i32"], returns: P },
  LLVMAddGlobal: { args: [P, P, P], returns: P },
  LLVMAddFunction: { args: [P, P, P], returns: P },
  LLVMGetParam: { args: [P, "u32"], returns: P },
  LLVMGetValueName2: { args: [P, P], returns: P },
  LLVMSetValueName2: { args: [P, P, "usize"], returns: "void" },
  LLVMStructCreateNamed: { args: [P, P], returns: P },
  LLVMGetStructName: { args: [P], returns: P },
  LLVMGetMDKindIDInContext: { args: [P, P, "u32"], returns: "u32" },
  LLVMNormalizeTargetTriple: { args: [P], returns: P },
  LLVMDisposeMessage: { args: [P], returns: "void" },
  LLVMGetVersion: { args: [P, P, P], returns: "void" },
  LLVMPrintValueToString: { args: [P], returns: P },
  LLVMConstInt: { args: [P, "u64", "i32"], returns: P },
  LLVMConstNull: { args: [P], returns: P },
  LLVMGetUndef: { args: [P], returns: P },
  LLVMConstArray2: { args: [P, P, "u64"], returns: P },
  LLVMConstStructInContext: { args: [P, P, "u32", "i32"], returns: P },
  LLVMConstStringInContext2: { args: [P, P, "usize", "i32"], returns: P },
  LLVMConstInBoundsGEP2: { args: [P, P, P, "u32"], returns: P },
  LLVMConstIntToPtr: { args: [P, P], returns: P },
  LLVMConstPtrToInt: { args: [P, P], returns: P },
  LLVMConstPointerCast: { args: [P, P], returns: P },
  LLVMSetInitializer: { args: [P, P], returns: "void" },
  LLVMSetLinkage: { args: [P, "u32"], returns: "void" },
  LLVMSetVisibility: { args: [P, "u32"], returns: "void" },
  // llir-core-b: the builder's folds.
  LLVMCreateBuilderInContext: { args: [P], returns: P },
  LLVMDisposeBuilder: { args: [P], returns: "void" },
  LLVMBuildBinOp: { args: [P, "u32", P, P, P], returns: P },
  LLVMBuildICmp: { args: [P, "u32", P, P, P], returns: P },
  LLVMBuildFCmp: { args: [P, "u32", P, P, P], returns: P },
  LLVMBuildSelect: { args: [P, P, P, P, P], returns: P },
  LLVMBuildExtractValue: { args: [P, P, "u32", P], returns: P },
  LLVMBuildInsertValue: { args: [P, P, P, "u32", P], returns: P },
  LLVMBuildTrunc: { args: [P, P, P, P], returns: P },
  LLVMBuildZExt: { args: [P, P, P, P], returns: P },
  LLVMBuildSExt: { args: [P, P, P, P], returns: P },
  LLVMBuildNeg: { args: [P, P, P], returns: P },
  LLVMBuildNot: { args: [P, P, P], returns: P },
  LLVMBuildFNeg: { args: [P, P, P], returns: P },
  LLVMIsAConstant: { args: [P], returns: P },
  LLVMGetPoison: { args: [P], returns: P },
  LLVMConstReal: { args: [P, "f64"], returns: P },
  LLVMDoubleTypeInContext: { args: [P], returns: P },
  LLVMFloatTypeInContext: { args: [P], returns: P },
  LLVMVectorType: { args: [P, "u32"], returns: P },
  LLVMConstVector: { args: [P, "u32"], returns: P },
  LLVMBuildBitCast: { args: [P, P, P, P], returns: P },
  LLVMConstBitCast: { args: [P, P], returns: P },
  LLVMBuildNSWAdd: { args: [P, P, P, P], returns: P },
  LLVMBuildNUWAdd: { args: [P, P, P, P], returns: P },
  LLVMBuildNSWSub: { args: [P, P, P, P], returns: P },
  LLVMBuildNUWSub: { args: [P, P, P, P], returns: P },
  LLVMBuildNSWMul: { args: [P, P, P, P], returns: P },
  LLVMBuildNUWMul: { args: [P, P, P, P], returns: P },
  LLVMBuildExactUDiv: { args: [P, P, P, P], returns: P },
  LLVMBuildExactSDiv: { args: [P, P, P, P], returns: P },
  LLVMBuildGEPWithNoWrapFlags: { args: [P, P, P, P, "u32", P, "u32"], returns: P },
  LLVMBuildPtrToInt: { args: [P, P, P, P], returns: P },
  LLVMBuildIntToPtr: { args: [P, P, P, P], returns: P },
  LLVMBuildPointerCast: { args: [P, P, P, P], returns: P },
  LLVMBuildIntCast2: { args: [P, P, P, "i32", P], returns: P },
  LLVMStructTypeInContext: { args: [P, P, "u32", "i32"], returns: P },
  LLVMArrayType2: { args: [P, "u64"], returns: P },
} as const;

const cstr = (s: string | Uint8Array): Buffer => Buffer.concat([typeof s === "string" ? Buffer.from(s, "utf8") : Buffer.from(s), Buffer.from([0])]);
const ptrs = (ps: (Pointer | null)[]): BigUint64Array => new BigUint64Array(ps.map((p) => BigInt(p ?? 0)));

describe.skipIf(!HAVE && !REQUIRE)("model vs libLLVM C API", () => {
  // PORT: an FFI edge (PORTING §7): bun:ffi's inferred types do not let a returned `ptr` flow into a `ptr` parameter.
  // biome-ignore lint/suspicious/noExplicitAny: FFI edge
  const lib = (HAVE ? dlopen(DYLIB, C_API).symbols : undefined) as unknown as Record<keyof typeof C_API, (...a: any[]) => any>;
  /** The name of a value, read through the real C API. */
  const realName = (v: Pointer | null): string => {
    const len = new BigUint64Array(1);
    const p = lib.LLVMGetValueName2(v, len)!;
    return Buffer.from(toArrayBuffer(p, 0, Number(len[0]))).toString("latin1");
  };
  const owned = (p: Pointer | null): string => {
    const s = new CString(p!).toString();
    lib.LLVMDisposeMessage(p);
    return s;
  };
  const modelName = (v: L.Value): string => v.name;

  test("LLVMGetVersion", () => {
    const a = new Uint32Array(3);
    lib.LLVMGetVersion(a.subarray(0, 1), a.subarray(1, 2), a.subarray(2, 3));
    expect([...a]).toEqual([...LLVM_VERSION]);
  });

  test("global name collisions: one `.N` counter per module, shared by every name", () => {
    const names = ["A", "A", "B", "A", "B", "A.1", "x.2"];
    const rc = lib.LLVMContextCreate();
    const rm = lib.LLVMModuleCreateWithNameInContext(cstr("m"), rc);
    const ri32 = lib.LLVMIntTypeInContext(rc, 32);
    const real = names.map((n) => realName(lib.LLVMAddGlobal(rm, ri32, cstr(n))));
    const mc = L.LLVMContextCreate();
    const mm = L.LLVMModuleCreateWithNameInContext("m", mc);
    const mine = names.map((n) => modelName(L.LLVMAddGlobal(mm, L.LLVMIntTypeInContext(mc, 32), n)));
    expect(mine).toEqual(real);
    // Renaming: the old name is freed, a taken name collides.
    const rg = lib.LLVMAddGlobal(rm, ri32, cstr("C"));
    lib.LLVMSetValueName2(rg, cstr("A"), 1);
    const mg = L.LLVMAddGlobal(mm, L.LLVMIntTypeInContext(mc, 32), "C");
    L.LLVMSetValueName2(mg, "A", 1);
    expect(mg.name).toBe(realName(rg));
    lib.LLVMContextDispose(rc);
  });

  test("argument names: one counter per function, no dot, shared with every local", () => {
    const names = ["self", "self", "x", "self", "x", "self1", "e.0", "e.0"];
    const rc = lib.LLVMContextCreate();
    const rm = lib.LLVMModuleCreateWithNameInContext(cstr("m"), rc);
    const ri = lib.LLVMIntTypeInContext(rc, 64);
    const rft = lib.LLVMFunctionType(lib.LLVMVoidTypeInContext(rc), ptrs(names.map(() => ri)), names.length, 0);
    const rf = lib.LLVMAddFunction(rm, cstr("f"), rft);
    const real = names.map((n, i) => {
      const a = lib.LLVMGetParam(rf, i);
      lib.LLVMSetValueName2(a, cstr(n), Buffer.byteLength(n));
      return realName(a);
    });
    const mc = L.LLVMContextCreate();
    const mm = L.LLVMModuleCreateWithNameInContext("m", mc);
    const mi = L.LLVMIntTypeInContext(mc, 64);
    const mf = L.LLVMAddFunction(mm, "f", L.LLVMFunctionType(L.LLVMVoidTypeInContext(mc), names.map(() => mi), names.length, L.FALSE));
    const mine = names.map((n, i) => {
      const a = L.LLVMGetParam(mf, i);
      L.LLVMSetValueName2(a, n, n.length);
      return a.name;
    });
    expect(mine).toEqual(real);
    lib.LLVMContextDispose(rc);
  });

  test("named struct type collisions", () => {
    const names = ["T", "T", "U", "T", "T.0"];
    const rc = lib.LLVMContextCreate();
    // `LLVMGetStructName` returns the type's own string (not to be disposed).
    const real = names.map((n) => new CString(lib.LLVMGetStructName(lib.LLVMStructCreateNamed(rc, cstr(n)))!).toString());
    const mc = L.LLVMContextCreate();
    const mine = names.map((n) => (L.LLVMStructCreateNamed(mc, n) as unknown as { name: string }).name);
    expect(mine).toEqual(real);
    lib.LLVMContextDispose(rc);
  });

  test("custom metadata kind IDs follow the fixed kinds", () => {
    const rc = lib.LLVMContextCreate();
    const mc = L.LLVMContextCreate();
    for (const k of ["rust.custom.a", "dbg", "rust.custom.b", "rust.custom.a"]) {
      expect(L.LLVMGetMDKindIDInContext(mc, k, k.length) as number).toBe(lib.LLVMGetMDKindIDInContext(rc, cstr(k), k.length));
    }
    lib.LLVMContextDispose(rc);
  });

  test("the D3 targets' triples are their own Triple::normalize", () => {
    for (const t of NORMAL_TRIPLES) expect(owned(lib.LLVMNormalizeTargetTriple(cstr(t)))).toBe(t);
  });

  test("constants: folds, collapses and their printed form (LLVMPrintValueToString)", () => {
    const rc = lib.LLVMContextCreate();
    const rm = lib.LLVMModuleCreateWithNameInContext(cstr("m"), rc);
    const mc = L.LLVMContextCreate();
    const mm = L.LLVMModuleCreateWithNameInContext("m", mc);
    const R = { i8: lib.LLVMIntTypeInContext(rc, 8), i64: lib.LLVMIntTypeInContext(rc, 64), i128: lib.LLVMIntTypeInContext(rc, 128), ptr: lib.LLVMPointerTypeInContext(rc, 0) };
    const M = { i8: L.LLVMIntTypeInContext(mc, 8), i64: L.LLVMIntTypeInContext(mc, 64), i128: L.LLVMIntTypeInContext(mc, 128), ptr: L.LLVMPointerTypeInContext(mc, 0) };
    const rg = lib.LLVMAddGlobal(rm, R.i8, cstr("g weird\"name\\"));
    const mg = L.LLVMAddGlobal(mm, M.i8, 'g weird"name\\');
    const bytes = new Uint8Array(256).map((_, i) => i);
    const cases: [string, Pointer | null, L.Value][] = [
      ["i128 -1 sign-extended", lib.LLVMConstInt(R.i128, 0xffffffffffffffffn, 1), L.LLVMConstInt(M.i128, 0xffffffffffffffffn, L.TRUE)],
      ["i8 truncated", lib.LLVMConstInt(R.i8, 0x1ffn, 0), L.LLVMConstInt(M.i8, 0x1ffn, L.FALSE)],
      ["array of zeros", lib.LLVMConstArray2(R.i8, ptrs([lib.LLVMConstInt(R.i8, 0n, 0), lib.LLVMConstInt(R.i8, 0n, 0)]), 2n), L.LLVMConstArray2(M.i8, [L.LLVMConstInt(M.i8, 0n, L.FALSE), L.LLVMConstInt(M.i8, 0n, L.FALSE)], 2n)],
      ["array of undef", lib.LLVMConstArray2(R.i8, ptrs([lib.LLVMGetUndef(R.i8)]), 1n), L.LLVMConstArray2(M.i8, [L.LLVMGetUndef(M.i8)], 1n)],
      ["array of i64", lib.LLVMConstArray2(R.i64, ptrs([lib.LLVMConstInt(R.i64, 1n, 0), lib.LLVMConstInt(R.i64, 2n, 0)]), 2n), L.LLVMConstArray2(M.i64, [L.LLVMConstInt(M.i64, 1n, L.FALSE), L.LLVMConstInt(M.i64, 2n, L.FALSE)], 2n)],
      ["array of pointers", lib.LLVMConstArray2(R.ptr, ptrs([rg, lib.LLVMConstNull(R.ptr)]), 2n), L.LLVMConstArray2(M.ptr, [mg, L.LLVMConstNull(M.ptr)], 2n)],
      ["every byte", lib.LLVMConstStringInContext2(rc, bytes, 256, 1), L.LLVMConstStringInContext2(mc, bytes, 256, L.TRUE)],
      ["string with NUL", lib.LLVMConstStringInContext2(rc, cstr("a\\b"), 3, 0), L.LLVMConstStringInContext2(mc, "a\\b", 3, L.FALSE)],
      ["all-undef struct", lib.LLVMConstStructInContext(rc, ptrs([lib.LLVMGetUndef(R.i8), lib.LLVMGetUndef(R.i64)]), 2, 0), L.LLVMConstStructInContext(mc, [L.LLVMGetUndef(M.i8), L.LLVMGetUndef(M.i64)], 2, L.FALSE)],
      ["packed struct", lib.LLVMConstStructInContext(rc, ptrs([rg, lib.LLVMConstInt(R.i8, 3n, 0)]), 2, 1), L.LLVMConstStructInContext(mc, [mg, L.LLVMConstInt(M.i8, 3n, L.FALSE)], 2, L.TRUE)],
      ["GEP by zero folds", lib.LLVMConstInBoundsGEP2(R.i8, rg, ptrs([lib.LLVMConstInt(R.i64, 0n, 0)]), 1), L.LLVMConstInBoundsGEP2(M.i8, mg, [L.LLVMConstInt(M.i64, 0n, L.FALSE)], 1)],
      ["GEP by 8", lib.LLVMConstInBoundsGEP2(R.i8, rg, ptrs([lib.LLVMConstInt(R.i64, 8n, 0)]), 1), L.LLVMConstInBoundsGEP2(M.i8, mg, [L.LLVMConstInt(M.i64, 8n, L.FALSE)], 1)],
      ["inttoptr 0 is null", lib.LLVMConstIntToPtr(lib.LLVMConstInt(R.i64, 0n, 0), R.ptr), L.LLVMConstIntToPtr(L.LLVMConstInt(M.i64, 0n, L.FALSE), M.ptr)],
      ["inttoptr 16", lib.LLVMConstIntToPtr(lib.LLVMConstInt(R.i64, 16n, 0), R.ptr), L.LLVMConstIntToPtr(L.LLVMConstInt(M.i64, 16n, L.FALSE), M.ptr)],
      ["ptrtoint of a global", lib.LLVMConstPtrToInt(rg, R.i64), L.LLVMConstPtrToInt(mg, M.i64)],
      ["pointer cast to the same type", lib.LLVMConstPointerCast(rg, R.ptr), L.LLVMConstPointerCast(mg, M.ptr)],
    ];
    for (const [what, r, m] of cases) expect([what, printValueToString(m)]).toEqual([what, owned(lib.LLVMPrintValueToString(r))]);
    // A global's whole line, after linkage and visibility changes (local linkage resets visibility; dso_local is implied).
    lib.LLVMSetInitializer(rg, cases[6]![1]);
    L.LLVMSetInitializer(mg, cases[6]![2]);
    lib.LLVMSetVisibility(rg, L.Visibility_discriminant.Hidden);
    L.LLVMSetVisibility(mg, "Hidden");
    expect(printValueToString(mg)).toBe(owned(lib.LLVMPrintValueToString(rg)));
    lib.LLVMSetLinkage(rg, L.Linkage_discriminant.PrivateLinkage);
    L.LLVMSetLinkage(mg, "PrivateLinkage");
    expect(printValueToString(mg)).toBe(owned(lib.LLVMPrintValueToString(rg)));
    lib.LLVMContextDispose(rc);
  });

  /** The builder's constant folds (ConstantFolder; fold.ts), op by op over corner-case operands: the model gives LLVM's printed
   * constant, or an instruction where LLVM makes one, or stops `unported` (never another answer). Returns the stop count. */
  /** A printed `double` constant as its bit pattern (the model prints hex, LLVM a decimal that round-trips; llir-core-a
   * PORT decision 4); anything else unchanged. */
  const fpBits = (t: string): string => {
    const m = /^double (f?0x[0-9A-F]+|[-+0-9.e]+|[-+](?:inf|qnan))$/.exec(t);
    if (m === null) return t;
    const v = m[1]!;
    // LLVM's spelling of the special values (`+qnan`, `-inf`, ...): the default quiet NaN and the infinities.
    const special: Record<string, bigint> = { "+qnan": 0x7ff8000000000000n, "-qnan": 0xfff8000000000000n, "+inf": 0x7ff0000000000000n, "-inf": 0xfff0000000000000n };
    if (v in special) return `double bits ${special[v]}`;
    if (/^f?0x/.test(v)) return `double bits ${BigInt(`0x${v.replace(/^f?0x/, "")}`)}`;
    const dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, Number(v));
    return `double bits ${dv.getBigUint64(0)}`;
  };
  const foldCases = (run: (r: (name: string) => Pointer | null, m: () => L.Value | "unported", what: string) => void) => run;
  test("builder folds of integer and floating-point constants (lane llir-core-b)", () => {
    const rc = lib.LLVMContextCreate();
    const rb = lib.LLVMCreateBuilderInContext(rc);
    const mc = L.LLVMContextCreate();
    const mb = L.LLVMCreateBuilderInContext(mc);
    const noName = cstr("");
    let agree = 0;
    const stops: string[] = [];
    const check = (what: string, r: Pointer | null, m: () => L.Value): void => {
      let mv: L.Value;
      try {
        mv = m();
      } catch (e) {
        if ((e as Error).constructor.name === "Unported") {
          stops.push(what);
          return;
        }
        throw new Error(`${what}: ${(e as Error).message}`);
      }
      const realConst = lib.LLVMIsAConstant(r) !== null;
      if (!realConst) {
        expect([what, mv.constructor.name]).toEqual([what, "Inst"]);
      } else {
        expect([what, fpBits(printValueToString(mv))]).toEqual([what, fpBits(owned(lib.LLVMPrintValueToString(r)))]);
      }
      agree++;
    };
    const ints = (bits: number): [string, (rt: Pointer | null) => Pointer | null, (mt: L.Type) => L.Value][] => {
      const mask = (1n << BigInt(bits)) - 1n;
      const vals = bits === 1 ? [0n, 1n] : [0n, 1n, 2n, 7n, mask, 1n << BigInt(bits - 1), (1n << BigInt(bits - 1)) - 1n, BigInt(bits)];
      return [
        ...vals.map((v): [string, (rt: Pointer | null) => Pointer | null, (mt: L.Type) => L.Value] => [`i${bits} ${v}`, (rt) => lib.LLVMConstInt(rt, v, 0), (mt) => L.LLVMConstInt(mt, v, L.FALSE)]),
        [`undef i${bits}`, (rt) => lib.LLVMGetUndef(rt), (mt) => L.LLVMGetUndef(mt)],
        [`poison i${bits}`, (rt) => lib.LLVMGetPoison(rt), (mt) => L.LLVMGetPoison(mt)],
      ];
    };
    const OPS: [string, number][] = [["Add", 8], ["Sub", 10], ["Mul", 12], ["UDiv", 14], ["SDiv", 15], ["URem", 17], ["SRem", 18], ["Shl", 20], ["LShr", 21], ["AShr", 22], ["And", 23], ["Or", 24], ["Xor", 25]];
    const lib2 = L as unknown as Record<string, (...a: unknown[]) => L.Value>;
    for (const bits of [1, 8, 32]) {
      const rt = lib.LLVMIntTypeInContext(rc, bits);
      const mt = L.LLVMIntTypeInContext(mc, bits);
      const vs = ints(bits);
      for (const [op, code] of OPS)
        for (const [an, ar, am] of vs)
          for (const [bn, br, bm] of vs) check(`${op} ${an}, ${bn}`, lib.LLVMBuildBinOp(rb, code, ar(rt), br(rt), noName), () => lib2[`LLVMBuild${op}`]!(mb, am(mt), bm(mt), ""));
      // Every integer predicate.
      for (let p = 32; p <= 41; p++) for (const [an, ar, am] of vs) for (const [bn, br, bm] of vs) check(`icmp ${p} ${an}, ${bn}`, lib.LLVMBuildICmp(rb, p, ar(rt), br(rt), noName), () => L.LLVMBuildICmp(mb, p, am(mt), bm(mt), ""));
      for (const [an, ar, am] of vs) {
        check(`neg ${an}`, lib.LLVMBuildNeg(rb, ar(rt), noName), () => L.LLVMBuildNeg(mb, am(mt), ""));
        check(`not ${an}`, lib.LLVMBuildNot(rb, ar(rt), noName), () => L.LLVMBuildNot(mb, am(mt), ""));
        for (const to of [1, 8, 16, 64]) {
          if (to === bits) continue;
          const rto = lib.LLVMIntTypeInContext(rc, to);
          const mto = L.LLVMIntTypeInContext(mc, to);
          if (to < bits) check(`trunc ${an} to i${to}`, lib.LLVMBuildTrunc(rb, ar(rt), rto, noName), () => L.LLVMBuildTrunc(mb, am(mt), mto, ""));
          else {
            check(`zext ${an} to i${to}`, lib.LLVMBuildZExt(rb, ar(rt), rto, noName), () => L.LLVMBuildZExt(mb, am(mt), mto, ""));
            check(`sext ${an} to i${to}`, lib.LLVMBuildSExt(rb, ar(rt), rto, noName), () => L.LLVMBuildSExt(mb, am(mt), mto, ""));
          }
        }
      }
      // select over every i1 condition.
      const i1 = ints(1);
      for (const [cn, cr, cm] of i1) for (const [an, ar, am] of vs) for (const [bn, br, bm] of vs.slice(-3)) {
        check(`select ${cn}, ${an}, ${bn}`, lib.LLVMBuildSelect(rb, cr(lib.LLVMIntTypeInContext(rc, 1)), ar(rt), br(rt), noName), () => L.LLVMBuildSelect(mb, cm(L.LLVMIntTypeInContext(mc, 1)), am(mt), bm(mt), ""));
      }
    }
    // Doubles: the identities and undef/poison rules fold; arithmetic of two values stops (APFloat), comparisons fold.
    const rd = lib.LLVMDoubleTypeInContext(rc);
    const md = L.LLVMDoubleTypeInContext(mc);
    const ds: [string, () => Pointer | null, () => L.Value][] = [
      ...[0, -0, 1, 1.5, -2, Number.NaN, Number.POSITIVE_INFINITY].map((v): [string, () => Pointer | null, () => L.Value] => [`double ${v}`, () => lib.LLVMConstReal(rd, v), () => L.LLVMConstReal(md, v)]),
      ["undef double", () => lib.LLVMGetUndef(rd), () => L.LLVMGetUndef(md)],
      ["poison double", () => lib.LLVMGetPoison(rd), () => L.LLVMGetPoison(md)],
    ];
    const FOPS: [string, number][] = [["FAdd", 9], ["FSub", 11], ["FMul", 13], ["FDiv", 16], ["FRem", 19]];
    for (const [op, code] of FOPS) for (const [an, ar, am] of ds) for (const [bn, br, bm] of ds) check(`${op} ${an}, ${bn}`, lib.LLVMBuildBinOp(rb, code, ar(), br(), noName), () => lib2[`LLVMBuild${op}`]!(mb, am(), bm(), ""));
    for (let p = 0; p <= 15; p++) for (const [an, ar, am] of ds) for (const [bn, br, bm] of ds) check(`fcmp ${p} ${an}, ${bn}`, lib.LLVMBuildFCmp(rb, p, ar(), br(), noName), () => L.LLVMBuildFCmp(mb, p, am(), bm(), ""));
    for (const [an, ar, am] of ds) check(`fneg ${an}`, lib.LLVMBuildFNeg(rb, ar(), noName), () => L.LLVMBuildFNeg(mb, am(), ""));
    // extractvalue / insertvalue of constant aggregates.
    const r8 = lib.LLVMIntTypeInContext(rc, 8);
    const m8 = L.LLVMIntTypeInContext(mc, 8);
    const rs = lib.LLVMConstStructInContext(rc, ptrs([lib.LLVMConstInt(r8, 1n, 0), lib.LLVMGetUndef(r8), lib.LLVMConstInt(r8, 0n, 0)]), 3, 0);
    const ms = L.LLVMConstStructInContext(mc, [L.LLVMConstInt(m8, 1n, L.FALSE), L.LLVMGetUndef(m8), L.LLVMConstInt(m8, 0n, L.FALSE)], 3, L.FALSE);
    for (let i = 0; i < 3; i++) {
      check(`extractvalue ${i}`, lib.LLVMBuildExtractValue(rb, rs, i, noName), () => L.LLVMBuildExtractValue(mb, ms, i, ""));
      for (const v of [0n, 5n]) check(`insertvalue ${i} ${v}`, lib.LLVMBuildInsertValue(rb, rs, lib.LLVMConstInt(r8, v, 0), i, noName), () => L.LLVMBuildInsertValue(mb, ms, L.LLVMConstInt(m8, v, L.FALSE), i, ""));
      check(`insertvalue ${i} undef`, lib.LLVMBuildInsertValue(rb, rs, lib.LLVMGetUndef(r8), i, noName), () => L.LLVMBuildInsertValue(mb, ms, L.LLVMGetUndef(m8), i, ""));
    }
    // Every other case agrees; the only stops are the APFloat arithmetic of two doubles.
    expect(agree).toBeGreaterThan(6500);
    expect(stops.filter((w) => !/^F(Add|Sub|Mul|Div|Rem) double \S+, double \S+$/.test(w))).toEqual([]);
    lib.LLVMDisposeBuilder(rb);
    lib.LLVMContextDispose(rc);
    void foldCases;
  });

  test("vector constants: all-ones splats fold through bitcast, FP-vector identities stop (review llir-core-b F2, F3)", () => {
    const rc = lib.LLVMContextCreate();
    const rb = lib.LLVMCreateBuilderInContext(rc);
    const mc = L.LLVMContextCreate();
    const mb = L.LLVMCreateBuilderInContext(mc);
    const noName = cstr("");
    const R = (bits: number) => lib.LLVMIntTypeInContext(rc, bits);
    const M = (bits: number) => L.LLVMIntTypeInContext(mc, bits);
    const rvec = (bits: number, vals: bigint[]) => lib.LLVMConstVector(ptrs(vals.map((v) => lib.LLVMConstInt(R(bits), v, 0))), vals.length);
    const mvec = (bits: number, vals: bigint[]) => L.LLVMConstVector(vals.map((v) => L.LLVMConstInt(M(bits), v, L.FALSE)), vals.length);
    const ones32 = 0xffffffffn;
    const cases: [string, Pointer | null, () => L.Value][] = [];
    for (const [what, bits, vals] of [
      ["<2 x i32> all ones", 32, [ones32, ones32]],
      ["<2 x i32> <-1, 1>", 32, [ones32, 1n]],
      ["<4 x i16> all ones", 16, [0xffffn, 0xffffn, 0xffffn, 0xffffn]],
      ["<8 x i8> all ones", 8, new Array<bigint>(8).fill(0xffn)],
      ["<2 x i32> <7, 7>", 32, [7n, 7n]],
    ] as [string, number, bigint[]][]) {
      for (const [to, rt, mt] of [
        ["i64", R(64), M(64)],
        ["<4 x i16>", lib.LLVMVectorType(R(16), 4), L.LLVMVectorType(M(16), 4)],
        ["<2 x i32>", lib.LLVMVectorType(R(32), 2), L.LLVMVectorType(M(32), 2)],
        ["<8 x i8>", lib.LLVMVectorType(R(8), 8), L.LLVMVectorType(M(8), 8)],
      ] as [string, Pointer | null, L.Type][]) {
        cases.push([`builder bitcast ${what} to ${to}`, lib.LLVMBuildBitCast(rb, rvec(bits, vals), rt, noName), () => L.LLVMBuildBitCast(mb, mvec(bits, vals), mt, "")]);
        cases.push([`const bitcast ${what} to ${to}`, lib.LLVMConstBitCast(rvec(bits, vals), rt), () => L.LLVMConstBitCast(mvec(bits, vals), mt)]);
      }
    }
    for (const [what, r, m] of cases) expect([what, printValueToString(m())]).toEqual([what, owned(lib.LLVMPrintValueToString(r))]);
    // An all-ones vector bitcast to a float vector, and FP-vector identities, are vector-typed ConstantFPs (lane llir-apfloat).
    const rf2 = lib.LLVMVectorType(lib.LLVMFloatTypeInContext(rc), 2);
    const mf2 = L.LLVMVectorType(L.LLVMFloatTypeInContext(mc), 2);
    expect(printValueToString(L.LLVMBuildBitCast(mb, mvec(32, [ones32, ones32]), mf2, ""))).toBe(owned(lib.LLVMPrintValueToString(lib.LLVMBuildBitCast(rb, rvec(32, [ones32, ones32]), rf2, noName))));
    const rd2 = lib.LLVMVectorType(lib.LLVMDoubleTypeInContext(rc), 2);
    const md2 = L.LLVMVectorType(L.LLVMDoubleTypeInContext(mc), 2);
    for (const [what, rv, mv, perElement] of [
      ["fadd <2 x float> undef, undef", [lib.LLVMGetUndef(rf2), lib.LLVMGetUndef(rf2)], [L.LLVMGetUndef(mf2), L.LLVMGetUndef(mf2)], true],
      ["fadd <2 x float> poison, undef", [lib.LLVMGetPoison(rf2), lib.LLVMGetUndef(rf2)], [L.LLVMGetPoison(mf2), L.LLVMGetUndef(mf2)], false],
      ["fadd <2 x double> undef, undef", [lib.LLVMGetUndef(rd2), lib.LLVMGetUndef(rd2)], [L.LLVMGetUndef(md2), L.LLVMGetUndef(md2)], true],
    ] as [string, (Pointer | null)[], L.Value[], boolean][]) {
      const real = lib.LLVMBuildBinOp(rb, 9, rv[0], rv[1], noName);
      expect([what, lib.LLVMIsAConstant(real) !== null]).toEqual([what, true]);
      // An undef vector has no splat value (`getSplatValue`), so LLVM folds it per element (`getExtractElement`), which the
      // model does not: it stops, never a plain Error (review llir-core-b F3).
      if (perElement) expect(() => L.LLVMBuildFAdd(mb, mv[0]!, mv[1]!, "")).toThrow(Unported);
      else expect([what, printValueToString(L.LLVMBuildFAdd(mb, mv[0]!, mv[1]!, ""))]).toEqual([what, owned(lib.LLVMPrintValueToString(real))]);
    }
    lib.LLVMDisposeBuilder(rb);
    lib.LLVMContextDispose(rc);
  });

  test("builder folds with flags, wide integers, global operands, GEPs and pointer casts (review llir-core-b N3)", () => {
    const rc = lib.LLVMContextCreate();
    const rm = lib.LLVMModuleCreateWithNameInContext(cstr("m"), rc);
    const rb = lib.LLVMCreateBuilderInContext(rc);
    const mc = L.LLVMContextCreate();
    const mm = L.LLVMModuleCreateWithNameInContext("m", mc);
    const mb = L.LLVMCreateBuilderInContext(mc);
    const noName = cstr("");
    let agree = 0;
    const stops: string[] = [];
    const check = (what: string, r: Pointer | null, m: () => L.Value): void => {
      let mv: L.Value;
      try {
        mv = m();
      } catch (e) {
        if ((e as Error).constructor.name !== "Unported") throw new Error(`${what}: ${(e as Error).message}`);
        stops.push(`${what}: ${(e as Error).message}`);
        return;
      }
      if (lib.LLVMIsAConstant(r) === null) expect([what, mv.constructor.name]).toEqual([what, "Inst"]);
      else expect([what, printValueToString(mv)]).toEqual([what, owned(lib.LLVMPrintValueToString(r))]);
      agree++;
    };
    const Rt = (b: number) => lib.LLVMIntTypeInContext(rc, b);
    const Mt = (b: number) => L.LLVMIntTypeInContext(mc, b);
    const rptr = lib.LLVMPointerTypeInContext(rc, 0);
    const mptr = L.LLVMPointerTypeInContext(mc, 0);
    const rg = lib.LLVMAddGlobal(rm, Rt(8), cstr("g"));
    const mg = L.LLVMAddGlobal(mm, Mt(8), "g");
    const rstruct = lib.LLVMStructTypeInContext(rc, ptrs([Rt(8), Rt(32), Rt(64)]), 3, 0);
    const mstruct = L.LLVMStructTypeInContext(mc, [Mt(8), Mt(32), Mt(64)], 3, L.FALSE);
    const rh = lib.LLVMAddGlobal(rm, rstruct, cstr("h"));
    const mh = L.LLVMAddGlobal(mm, mstruct, "h");
    type V = [string, () => Pointer | null, () => L.Value];
    const ints = (b: number): V[] => {
      const mask = (1n << BigInt(b)) - 1n;
      const vs: V[] = [0n, 1n, 3n, mask, 1n << BigInt(b - 1), (1n << BigInt(b - 1)) - 1n].map((v) => [`i${b} ${v}`, () => lib.LLVMConstInt(Rt(b), v & 0xffffffffffffffffn, 0), () => L.LLVMConstInt(Mt(b), v & 0xffffffffffffffffn, L.FALSE)]);
      if (b === 64 || b === 8) vs.push([`ptrtoint @g i${b}`, () => lib.LLVMConstPtrToInt(rg, Rt(b)), () => L.LLVMConstPtrToInt(mg, Mt(b))]);
      vs.push([`undef i${b}`, () => lib.LLVMGetUndef(Rt(b)), () => L.LLVMGetUndef(Mt(b))], [`poison i${b}`, () => lib.LLVMGetPoison(Rt(b)), () => L.LLVMGetPoison(Mt(b))]);
      return vs;
    };
    const FLAGGED = ["NSWAdd", "NUWAdd", "NSWSub", "NUWSub", "NSWMul", "NUWMul", "ExactUDiv", "ExactSDiv"] as const;
    const PLAIN: [string, number][] = [["Add", 8], ["Sub", 10], ["Mul", 12], ["And", 23], ["Or", 24], ["Xor", 25], ["Shl", 20], ["LShr", 21], ["URem", 17]];
    const libAny = lib as unknown as Record<string, (...a: unknown[]) => Pointer | null>;
    const modelAny = L as unknown as Record<string, (...a: unknown[]) => L.Value>;
    for (const b of [8, 64, 128]) {
      const vs = ints(b);
      for (const [an, ar, am] of vs)
        for (const [bn, br, bm] of vs) {
          for (const op of FLAGGED) check(`${op} ${an}, ${bn}`, libAny[`LLVMBuild${op}`]!(rb, ar(), br(), noName), () => modelAny[`LLVMBuild${op}`]!(mb, am(), bm(), ""));
          for (const [op, code] of PLAIN) check(`${op} ${an}, ${bn}`, lib.LLVMBuildBinOp(rb, code, ar(), br(), noName), () => modelAny[`LLVMBuild${op}`]!(mb, am(), bm(), ""));
        }
      for (const [an, ar, am] of vs) {
        check(`inttoptr ${an}`, lib.LLVMBuildIntToPtr(rb, ar(), rptr, noName), () => L.LLVMBuildIntToPtr(mb, am(), mptr, ""));
        for (const to of [8, 32, 64, 128]) for (const signed of [0, 1]) check(`intcast2 ${an} to i${to} ${signed}`, lib.LLVMBuildIntCast2(rb, ar(), Rt(to), signed, noName), () => L.LLVMBuildIntCast2(mb, am(), Mt(to), L.Bool.of(signed), ""));
      }
    }
    // GEPs with every flag combination over global, null, inttoptr, undef and poison bases, with i8, array and struct types.
    const bases: V[] = [
      ["@g", () => rg, () => mg],
      ["@h", () => rh, () => mh],
      ["null", () => lib.LLVMConstNull(rptr), () => L.LLVMConstNull(mptr)],
      ["inttoptr 16", () => lib.LLVMConstIntToPtr(lib.LLVMConstInt(Rt(64), 16n, 0), rptr), () => L.LLVMConstIntToPtr(L.LLVMConstInt(Mt(64), 16n, L.FALSE), mptr)],
      ["undef ptr", () => lib.LLVMGetUndef(rptr), () => L.LLVMGetUndef(mptr)],
      ["poison ptr", () => lib.LLVMGetPoison(rptr), () => L.LLVMGetPoison(mptr)],
    ];
    const tys: [string, Pointer | null, L.Type][] = [
      ["i8", Rt(8), Mt(8)],
      ["[4 x i32]", lib.LLVMArrayType2(Rt(32), 4n), L.LLVMArrayType2(Mt(32), 4n)],
      ["struct", rstruct, mstruct],
    ];
    for (const [bn, br, bm] of bases)
      for (const [tn, rt, mt] of tys)
        for (const flags of [0, 1, 2, 4, 5, 6])
          for (const idx of tn === "i8" ? [[0n], [1n], [3n]] : [[0n], [1n], [0n, 2n], [3n]])
            check(
              `gep ${tn} ${bn} ${idx} nw=${flags}`,
              lib.LLVMBuildGEPWithNoWrapFlags(rb, rt, br(), ptrs(idx.map((i) => lib.LLVMConstInt(Rt(32), i, 0))), idx.length, noName, flags),
              () => L.LLVMBuildGEPWithNoWrapFlags(mb, mt, bm(), idx.map((i) => L.LLVMConstInt(Mt(32), i, L.FALSE)), idx.length, "", flags as L.GEPNoWrapFlags),
            );
    for (const [bn, br, bm] of bases) {
      for (const b of [8, 64]) check(`ptrtoint ${bn} to i${b}`, lib.LLVMBuildPtrToInt(rb, br(), Rt(b), noName), () => L.LLVMBuildPtrToInt(mb, bm(), Mt(b), ""));
      check(`pointercast ${bn} to i64`, lib.LLVMBuildPointerCast(rb, br(), Rt(64), noName), () => L.LLVMBuildPointerCast(mb, bm(), Mt(64), ""));
      check(`pointercast ${bn} to ptr`, lib.LLVMBuildPointerCast(rb, br(), rptr, noName), () => L.LLVMBuildPointerCast(mb, bm(), mptr, ""));
    }
    // Every model answer agrees; the stops are the rules the model does not have (ptrtoint(@g) AND a constant, a cast of a
    // cast, pointer relations), never another answer.
    expect(agree).toBeGreaterThan(4400);
    expect(stops.filter((w) => !/ptrtoint\(@global\)|cast of a cast|evaluateICmpRelation/.test(w))).toEqual([]);
    lib.LLVMDisposeBuilder(rb);
    lib.LLVMContextDispose(rc);
  });
});
