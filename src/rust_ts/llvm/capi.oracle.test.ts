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
      ["array of zeros", lib.LLVMConstArray2(R.i8, ptrs([lib.LLVMConstInt(R.i8, 0n, 0), lib.LLVMConstInt(R.i8, 0n, 0)]), 2n), L.LLVMConstArray2(M.i8, [L.LLVMConstInt(M.i8, 0n, L.FALSE), L.LLVMConstInt(M.i8, 0n, L.FALSE)], 2)],
      ["array of undef", lib.LLVMConstArray2(R.i8, ptrs([lib.LLVMGetUndef(R.i8)]), 1n), L.LLVMConstArray2(M.i8, [L.LLVMGetUndef(M.i8)], 1)],
      ["array of i64", lib.LLVMConstArray2(R.i64, ptrs([lib.LLVMConstInt(R.i64, 1n, 0), lib.LLVMConstInt(R.i64, 2n, 0)]), 2n), L.LLVMConstArray2(M.i64, [L.LLVMConstInt(M.i64, 1n, L.FALSE), L.LLVMConstInt(M.i64, 2n, L.FALSE)], 2)],
      ["array of pointers", lib.LLVMConstArray2(R.ptr, ptrs([rg, lib.LLVMConstNull(R.ptr)]), 2n), L.LLVMConstArray2(M.ptr, [mg, L.LLVMConstNull(M.ptr)], 2)],
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
});
