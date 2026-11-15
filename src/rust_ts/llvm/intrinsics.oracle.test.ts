// rust-ts: the IR model's intrinsic table (intrinsics.ts, lane cg-intrinsic-a) against the oracle toolchain's own libLLVM.dylib
// through bun:ffi, as capi.oracle.test.ts does. **Tests only**: the model never calls libLLVM.
// 1. The generic, x86 and aarch64 name tables and their overload bits, the target tables' offsets, and the target prefixes, re-read
//    from libLLVM: they must equal the model's data.
// 2. `LLVMLookupIntrinsicID` on every generic, x86 and aarch64 name and on variants of it (overload suffixes, near misses), against
//    libLLVM; a name with another target's prefix must stop in the model.
// 3. `LLVMGetIntrinsicDeclaration` of every modelled signature with concrete overload types: the declaration's name and function
//    type, against libLLVM's.
import { describe, expect, test } from "bun:test";
import { CString, dlopen, type Pointer, toArrayBuffer } from "bun:ffi";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PIN } from "../../../scripts/lib/common.ts";
import { Unported } from "../../std/panic.ts";
import * as L from "./ffi.ts";
import { GENERIC_INTRINSICS, MODELLED_SIGNATURES, TARGET_PREFIXES, overloadClasses } from "./intrinsics.ts";
import { AARCH64_INTRINSICS, AARCH64_INTRINSICS_OFFSET } from "./intrinsics_aarch64.ts";
import { X86_INTRINSICS, X86_INTRINSICS_OFFSET } from "./intrinsics_x86.ts";
import type { Function as IrFunction } from "./ir.ts";
import { printTypeToString } from "./printer.ts";

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
  LLVMIntrinsicGetName: { args: ["u32", P], returns: P },
  LLVMIntrinsicIsOverloaded: { args: ["u32"], returns: "i32" },
  LLVMLookupIntrinsicID: { args: [P, "usize"], returns: "u32" },
  LLVMGetIntrinsicDeclaration: { args: [P, "u32", P, "usize"], returns: P },
  LLVMContextCreate: { args: [], returns: P },
  LLVMContextDispose: { args: [P], returns: "void" },
  LLVMModuleCreateWithNameInContext: { args: [P, P], returns: P },
  LLVMIntTypeInContext: { args: [P, "u32"], returns: P },
  LLVMHalfTypeInContext: { args: [P], returns: P },
  LLVMFloatTypeInContext: { args: [P], returns: P },
  LLVMDoubleTypeInContext: { args: [P], returns: P },
  LLVMFP128TypeInContext: { args: [P], returns: P },
  LLVMPointerTypeInContext: { args: [P, "u32"], returns: P },
  LLVMVectorType: { args: [P, "u32"], returns: P },
  LLVMGlobalGetValueType: { args: [P], returns: P },
  LLVMPrintTypeToString: { args: [P], returns: P },
  LLVMDisposeMessage: { args: [P], returns: "void" },
  LLVMGetValueName2: { args: [P, P], returns: P },
} as const;

const cstr = (s: string): Buffer => Buffer.concat([Buffer.from(s, "latin1"), Buffer.from([0])]);
const ptrs = (ps: (Pointer | null)[]): BigUint64Array => new BigUint64Array(ps.map((p) => BigInt(p ?? 0)));

describe.skipIf(!HAVE && !REQUIRE)("intrinsic table vs libLLVM", () => {
  // PORT: an FFI edge (PORTING §7), as capi.oracle.test.ts.
  // biome-ignore lint/suspicious/noExplicitAny: FFI edge
  const lib = (HAVE ? dlopen(DYLIB, C_API).symbols : undefined) as unknown as Record<keyof typeof C_API, (...a: any[]) => any>;
  const realLookup = (name: string): number => lib.LLVMLookupIntrinsicID(cstr(name), Buffer.byteLength(name, "latin1"));
  const modelLookup = (name: string): number | "stop" => {
    try {
      return L.LLVMLookupIntrinsicID(name, name.length);
    } catch (e) {
      if (e instanceof Unported) return "stop";
      throw e;
    }
  };

  test("the generic, x86 and aarch64 name tables, their overload bits and the target prefixes are libLLVM's", () => {
    const len = new BigUint64Array(1);
    const all: [string, 0 | 1][] = [];
    for (let id = 1; ; id++) {
      const p = lib.LLVMIntrinsicGetName(id, len) as Pointer | null;
      const n = Number(len[0]);
      if (p === null || n <= 5 || n > 200) break;
      const name = Buffer.from(toArrayBuffer(p, 0, n)).toString("latin1");
      if (!name.startsWith("llvm.") || realLookup(name) !== id) break;
      all.push([name, lib.LLVMIntrinsicIsOverloaded(id) !== 0 ? 1 : 0]);
    }
    // The generic table ends where the names stop being sorted (the first target table starts).
    let end = 1;
    while (end < all.length && all[end]![0] > all[end - 1]![0]) end++;
    expect(all.slice(0, end)).toEqual(GENERIC_INTRINSICS.map(([n, o]) => [n, o]));
    const targets = [...new Set(all.slice(end).map(([n]) => n.slice(5).split(".")[0]!))];
    expect(targets).toEqual([...TARGET_PREFIXES]);
    // The x86 table: the run of names whose target component is `x86`; its first ID is the offset plus one.
    const x86Start = all.findIndex(([n]) => n.startsWith("llvm.x86."));
    let x86End = x86Start;
    while (x86End < all.length && all[x86End]![0].startsWith("llvm.x86.")) x86End++;
    expect(x86Start + 1).toBe(X86_INTRINSICS_OFFSET + 1);
    expect(all.slice(x86Start, x86End)).toEqual(X86_INTRINSICS.map(([n, o]) => [n, o]));
    // The aarch64 table, likewise (lane ir-fix-b).
    const a64Start = all.findIndex(([n]) => n.startsWith("llvm.aarch64."));
    let a64End = a64Start;
    while (a64End < all.length && all[a64End]![0].startsWith("llvm.aarch64.")) a64End++;
    expect(a64Start + 1).toBe(AARCH64_INTRINSICS_OFFSET + 1);
    expect(all.slice(a64Start, a64End)).toEqual(AARCH64_INTRINSICS.map(([n, o]) => [n, o]));
  });

  test("LLVMLookupIntrinsicID: every generic name and variants of it; target names stop", () => {
    const names = new Set<string>();
    for (const [n] of GENERIC_INTRINSICS) {
      for (const v of [n, `${n}.i32`, `${n}.f64`, `${n}.p0.i64`, `${n}x`, `${n}.x.y`, n.slice(0, -1), `${n}.`]) names.add(v);
    }
    for (const [n] of X86_INTRINSICS) {
      for (const v of [n, `${n}.i32`, `${n}.v4f32`, `${n}x`, `${n}.x.y`, n.slice(0, -1), `${n}.`]) names.add(v);
    }
    for (const v of ["llvm.", "llvm.x", "llvm.zzz", "llvm.a", "llvm.ctpop.i32.junk", "llvm.trap.x", "llvm.prefetch.p0", "llvm.sadd.with.overflow.i32", "llvm.with.overflow"]) names.add(v);
    for (const v of ["llvm.x86", "llvm.x86.", "llvm.x86.zzz", "llvm.x86.a", "llvm.x86.sse2", "llvm.x86.sse2.pausex", "llvm.x86.sse2.pause.i8", "llvm.x86x.sse2.pause", "llvm.x8"]) names.add(v);
    for (const [n] of AARCH64_INTRINSICS) {
      for (const v of [n, `${n}.i32`, `${n}.v4f32`, `${n}x`, `${n}.x.y`, n.slice(0, -1), `${n}.`]) names.add(v);
    }
    for (const v of ["llvm.aarch64", "llvm.aarch64.", "llvm.aarch64.zzz", "llvm.aarch64.a", "llvm.aarch64.isbx", "llvm.aarch64.isb.i32", "llvm.aarch64x.isb", "llvm.aarch6"]) names.add(v);
    const diffs: string[] = [];
    for (const n of names) {
      const real = realLookup(n);
      const mine = modelLookup(n);
      if (mine !== real) diffs.push(`${n}: model ${mine}, libLLVM ${real}`);
    }
    expect(diffs).toEqual([]);
    // Other targets' names: libLLVM finds them in their target's table; the model stops.
    for (const n of ["llvm.arm.isb", "llvm.wasm.get.exception", "llvm.amdgcn.dispatch.ptr"]) {
      expect(realLookup(n)).toBeGreaterThan(GENERIC_INTRINSICS.length);
      expect(modelLookup(n)).toBe("stop");
    }
  });

  test("LLVMGetIntrinsicDeclaration: name and function type of every modelled signature", () => {
    const rc = lib.LLVMContextCreate();
    const rm = lib.LLVMModuleCreateWithNameInContext(cstr("m"), rc);
    const mc = L.LLVMContextCreate();
    const mm = L.LLVMModuleCreateWithNameInContext("m", mc);
    /** Concrete overload types per class: one set of choices, then a second (other widths, f32, a vector where it applies). */
    const pick = (cls: string, alt: number): [Pointer, L.Type] => {
      switch (cls) {
        case "float":
          return alt === 0 ? [lib.LLVMDoubleTypeInContext(rc), L.LLVMDoubleTypeInContext(mc)] : [lib.LLVMFloatTypeInContext(rc), L.LLVMFloatTypeInContext(mc)];
        case "int":
          return alt === 0 ? [lib.LLVMIntTypeInContext(rc, 32), L.LLVMIntTypeInContext(mc, 32)] : [lib.LLVMIntTypeInContext(rc, 128), L.LLVMIntTypeInContext(mc, 128)];
        case "ptr":
          return [lib.LLVMPointerTypeInContext(rc, alt), L.LLVMPointerTypeInContext(mc, alt)];
        case "vecint":
          return alt === 0
            ? [lib.LLVMVectorType(lib.LLVMIntTypeInContext(rc, 32), 4), L.LLVMVectorType(L.LLVMIntTypeInContext(mc, 32), 4)]
            : [lib.LLVMVectorType(lib.LLVMIntTypeInContext(rc, 1), 16), L.LLVMVectorType(L.LLVMIntTypeInContext(mc, 1), 16)];
        // lane ir-fix-b: any vector, a float vector, a vector of pointers; 4 lanes, then 2 (so a gather's slots agree in each set).
        case "vec":
          return alt === 0
            ? [lib.LLVMVectorType(lib.LLVMFloatTypeInContext(rc), 4), L.LLVMVectorType(L.LLVMFloatTypeInContext(mc), 4)]
            : [lib.LLVMVectorType(lib.LLVMIntTypeInContext(rc, 64), 2), L.LLVMVectorType(L.LLVMIntTypeInContext(mc, 64), 2)];
        case "vecfloat":
          return alt === 0
            ? [lib.LLVMVectorType(lib.LLVMFloatTypeInContext(rc), 4), L.LLVMVectorType(L.LLVMFloatTypeInContext(mc), 4)]
            : [lib.LLVMVectorType(lib.LLVMDoubleTypeInContext(rc), 2), L.LLVMVectorType(L.LLVMDoubleTypeInContext(mc), 2)];
        case "vecptr":
          return alt === 0
            ? [lib.LLVMVectorType(lib.LLVMPointerTypeInContext(rc, 0), 4), L.LLVMVectorType(L.LLVMPointerTypeInContext(mc, 0), 4)]
            : [lib.LLVMVectorType(lib.LLVMPointerTypeInContext(rc, 1), 2), L.LLVMVectorType(L.LLVMPointerTypeInContext(mc, 1), 2)];
        default:
          return alt === 0 ? [lib.LLVMPointerTypeInContext(rc, 0), L.LLVMPointerTypeInContext(mc, 0)] : [lib.LLVMIntTypeInContext(rc, 16), L.LLVMIntTypeInContext(mc, 16)];
      }
    };
    const realDecl = (name: string, tys: Pointer[]): [string, string] => {
      const id = realLookup(name);
      const f = lib.LLVMGetIntrinsicDeclaration(rm, id, ptrs(tys), tys.length);
      const len = new BigUint64Array(1);
      const np = lib.LLVMGetValueName2(f, len);
      const fname = Buffer.from(toArrayBuffer(np, 0, Number(len[0]))).toString("latin1");
      const tp = lib.LLVMPrintTypeToString(lib.LLVMGlobalGetValueType(f));
      const ty = new CString(tp).toString();
      lib.LLVMDisposeMessage(tp);
      return [fname, ty];
    };
    const modelDecl = (name: string, tys: L.Type[]): [string, string] => {
      const id = L.LLVMLookupIntrinsicID(name, name.length);
      const f = L.LLVMGetIntrinsicDeclaration(mm, id, tys, tys.length) as unknown as IrFunction;
      return [f.name, printTypeToString(f.functionType)];
    };
    let n = 0;
    for (const name of MODELLED_SIGNATURES) {
      const classes = overloadClasses(name);
      for (const alt of classes.length === 0 ? [0] : [0, 1]) {
        const tys = classes.map((c) => pick(c, alt));
        expect(modelDecl(name, tys.map((t) => t[1]))).toEqual(realDecl(name, tys.map((t) => t[0])));
        n++;
      }
    }
    // The with.overflow result for a vector overload: `{ <4 x i32>, <4 x i1> }`.
    const rv = lib.LLVMVectorType(lib.LLVMIntTypeInContext(rc, 32), 4);
    const mv = L.LLVMVectorType(L.LLVMIntTypeInContext(mc, 32), 4);
    expect(modelDecl("llvm.uadd.with.overflow", [mv])).toEqual(realDecl("llvm.uadd.with.overflow", [rv]));
    // A second request returns the same declaration.
    const id = L.LLVMLookupIntrinsicID("llvm.trap", 9);
    expect(L.LLVMGetIntrinsicDeclaration(mm, id, [], 0)).toBe(L.LLVMGetIntrinsicDeclaration(mm, id, [], 0));
    expect(n).toBeGreaterThan(100);
    lib.LLVMContextDispose(rc);
  });
});

describe("intrinsic table (model only)", () => {
  test("IDs, overload bits, target intrinsics", () => {
    const id = L.LLVMLookupIntrinsicID("llvm.sqrt.f64", 13);
    expect(GENERIC_INTRINSICS[id - 1]![0]).toBe("llvm.sqrt");
    expect(L.LLVMIntrinsicIsOverloaded(id).is_true()).toBe(true);
    expect(L.LLVMIntrinsicIsOverloaded(L.LLVMLookupIntrinsicID("llvm.trap", 9)).is_true()).toBe(false);
    expect(L.LLVMLookupIntrinsicID("llvm.trap.x", 11)).toBe(0);
    expect(L.LLVMRustIsTargetIntrinsic(id)).toBe(false);
    // A byte string with a length: only the first `NameLen` bytes count.
    expect(L.LLVMLookupIntrinsicID(new TextEncoder().encode("llvm.trapXYZ"), 9)).toBe(L.LLVMLookupIntrinsicID("llvm.trap", 9));
  });

  test("an x86 intrinsic: ID, target bit, declaration", () => {
    const id = L.LLVMLookupIntrinsicID("llvm.x86.sse2.pause", 19);
    expect(X86_INTRINSICS[id - X86_INTRINSICS_OFFSET - 1]![0]).toBe("llvm.x86.sse2.pause");
    expect(L.LLVMRustIsTargetIntrinsic(id)).toBe(true);
    expect(L.LLVMIntrinsicIsOverloaded(id).is_true()).toBe(false);
    // Not overloaded: a suffix is not the intrinsic.
    expect(L.LLVMLookupIntrinsicID("llvm.x86.sse2.pause.i8", 22)).toBe(0);
    const mc = L.LLVMContextCreate();
    const mm = L.LLVMModuleCreateWithNameInContext("m", mc);
    const f = L.LLVMGetIntrinsicDeclaration(mm, id, [], 0) as unknown as IrFunction;
    expect([f.name, printTypeToString(f.functionType)]).toEqual(["llvm.x86.sse2.pause", "void ()"]);
  });

  test("an aarch64 intrinsic: ID, target bit, declaration", () => {
    const id = L.LLVMLookupIntrinsicID("llvm.aarch64.isb", 16);
    expect(AARCH64_INTRINSICS[id - AARCH64_INTRINSICS_OFFSET - 1]![0]).toBe("llvm.aarch64.isb");
    expect(L.LLVMRustIsTargetIntrinsic(id)).toBe(true);
    expect(L.LLVMIntrinsicIsOverloaded(id).is_true()).toBe(false);
    expect(L.LLVMLookupIntrinsicID("llvm.aarch64.isb.i32", 20)).toBe(0);
    const mc = L.LLVMContextCreate();
    const mm = L.LLVMModuleCreateWithNameInContext("m", mc);
    const f = L.LLVMGetIntrinsicDeclaration(mm, id, [], 0) as unknown as IrFunction;
    expect([f.name, printTypeToString(f.functionType)]).toEqual(["llvm.aarch64.isb", "void (i32)"]);
    const dmb = L.LLVMLookupIntrinsicID("llvm.aarch64.dmb", 16);
    expect(() => L.LLVMGetIntrinsicDeclaration(mm, dmb, [], 0)).toThrow(/llir: the signature of llvm.aarch64.dmb \(IntrinsicsAArch64.td\) is not in the IR model/);
  });

  test("aarch64 CRC32 and SHA intrinsics (lane cargo-fix-a): fixed i32, i64, <4 x i32> and <2 x i64> signatures", () => {
    const mc = L.LLVMContextCreate();
    const mm = L.LLVMModuleCreateWithNameInContext("m", mc);
    const decl = (name: string): [string, string] => {
      const f = L.LLVMGetIntrinsicDeclaration(mm, L.LLVMLookupIntrinsicID(name, name.length), [], 0) as unknown as IrFunction;
      return [f.name, printTypeToString(f.functionType)];
    };
    expect(decl("llvm.aarch64.crc32b")).toEqual(["llvm.aarch64.crc32b", "i32 (i32, i32)"]);
    expect(decl("llvm.aarch64.crc32cx")).toEqual(["llvm.aarch64.crc32cx", "i32 (i32, i64)"]);
    expect(decl("llvm.aarch64.crypto.sha1h")).toEqual(["llvm.aarch64.crypto.sha1h", "i32 (i32)"]);
    expect(decl("llvm.aarch64.crypto.sha1c")).toEqual(["llvm.aarch64.crypto.sha1c", "<4 x i32> (<4 x i32>, i32, <4 x i32>)"]);
    expect(decl("llvm.aarch64.crypto.sha256h")).toEqual(["llvm.aarch64.crypto.sha256h", "<4 x i32> (<4 x i32>, <4 x i32>, <4 x i32>)"]);
    expect(decl("llvm.aarch64.crypto.sha256su0")).toEqual(["llvm.aarch64.crypto.sha256su0", "<4 x i32> (<4 x i32>, <4 x i32>)"]);
    expect(decl("llvm.aarch64.crypto.sha512h")).toEqual(["llvm.aarch64.crypto.sha512h", "<2 x i64> (<2 x i64>, <2 x i64>, <2 x i64>)"]);
    expect(decl("llvm.aarch64.crypto.sha512su0")).toEqual(["llvm.aarch64.crypto.sha512su0", "<2 x i64> (<2 x i64>, <2 x i64>)"]);
    // Neighbours outside the three crates' reach stay stops.
    const rax1 = L.LLVMLookupIntrinsicID("llvm.aarch64.crypto.rax1", 24);
    expect(() => L.LLVMGetIntrinsicDeclaration(mm, rax1, [], 0)).toThrow(/llir: the signature of llvm.aarch64.crypto.rax1 \(IntrinsicsAArch64.td\) is not in the IR model/);
  });

  test("stops: target tables, signatures the model lacks, unnamed struct overloads", () => {
    expect(() => L.LLVMLookupIntrinsicID("llvm.arm.isb", 12)).toThrow(/llir: the arm intrinsic table/);
    const mc = L.LLVMContextCreate();
    const mm = L.LLVMModuleCreateWithNameInContext("m", mc);
    const lfence = L.LLVMLookupIntrinsicID("llvm.x86.sse2.lfence", 20);
    expect(() => L.LLVMGetIntrinsicDeclaration(mm, lfence, [], 0)).toThrow(/llir: the signature of llvm.x86.sse2.lfence \(IntrinsicsX86.td\) is not in the IR model/);
    const memcpy = L.LLVMLookupIntrinsicID("llvm.memcpy", 11);
    expect(memcpy).toBeGreaterThan(0);
    expect(() => L.LLVMGetIntrinsicDeclaration(mm, memcpy, [], 0)).toThrow(/llir: the signature of llvm.memcpy \(Intrinsics.td\) is not in the IR model/);
  });

  test("an existing declaration of another type is renamed `.invalid`", () => {
    const mc = L.LLVMContextCreate();
    const mm = L.LLVMModuleCreateWithNameInContext("m", mc);
    const i32 = L.LLVMIntTypeInContext(mc, 32);
    const old = L.LLVMAddFunction(mm, "llvm.ctpop.i32", L.LLVMFunctionType(i32, [], 0, L.FALSE));
    const f = L.LLVMGetIntrinsicDeclaration(mm, L.LLVMLookupIntrinsicID("llvm.ctpop", 10), [i32], 1);
    expect(f).not.toBe(old);
    expect(old.name).toBe("llvm.ctpop.i32.invalid");
    expect(f.name).toBe("llvm.ctpop.i32");
  });
});
