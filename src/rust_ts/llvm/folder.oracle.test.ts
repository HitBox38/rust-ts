// rust-ts: differential tests of lane llir-folder's additions to the IR model against the oracle toolchain's own libLLVM.dylib,
// through bun:ffi, as capi.oracle.test.ts does. **Tests only**: the model never calls libLLVM.
// 1. `ATTR_KIND_ENUM` (ir.ts) is libLLVM's `Attribute::AttrKind` numbering.
// 2. Attribute sets print in LLVM's sorted order: the same attributes added in shuffled orders, at the function, return and
//    parameter indices of declarations and of call sites, give libLLVM's module text.
// 3. `LLVMRustCreateRangeAttribute`, `LLVMRustCreateAttrNoValue(DeadOnReturn)` and the three captures kinds print as libLLVM's
//    attributes of the same kind and value (the values replay.ts decodes).
// 4. `printCallingConv`: every calling convention from 0 to 1023 on a declaration, and 0 to 130 on calls.
// 5. `atomicrmw` / `cmpxchg` built without an alignment get libLLVM's, over several data layouts and operand types.
// 6. `LLVMGetInlineAsm` values in calls, and the `allocsize` / `allockind` int values replay.ts decodes.
// 7. The folds item 6 of the lane added: `extractelement` / `insertelement` of constants, and `and (ptrtoint @g), C` by the
//    global's pointer alignment.
// 8. `armExclusiveIntrinsic` (and so `LLVMRustGetElementTypeArgIndex`) against libLLVM's intrinsic IDs, and the ARM names it
//    relies on.
import { describe, expect, test } from "bun:test";
import { CString, dlopen, type Pointer, toArrayBuffer } from "bun:ffi";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PIN } from "../../../scripts/lib/common.ts";
import { ATTR_NAME } from "./core.ts";
import * as L from "./ffi.ts";
import { armExclusiveIntrinsic } from "./intrinsics.ts";
import { ATTR_KIND_ENUM } from "./ir.ts";
import { printModule, printValueToString } from "./printer.ts";

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
if (!HAVE && REQUIRE) console.log(`ERROR: the oracle's libLLVM.dylib is unavailable (looked for ${DYLIB})`);

const P = "ptr" as const;
const C_API = {
  LLVMContextCreate: { args: [], returns: P },
  LLVMModuleCreateWithNameInContext: { args: [P, P], returns: P },
  LLVMSetDataLayout: { args: [P, P], returns: "void" },
  LLVMIntTypeInContext: { args: [P, "u32"], returns: P },
  LLVMHalfTypeInContext: { args: [P], returns: P },
  LLVMFloatTypeInContext: { args: [P], returns: P },
  LLVMDoubleTypeInContext: { args: [P], returns: P },
  LLVMPointerTypeInContext: { args: [P, "u32"], returns: P },
  LLVMVoidTypeInContext: { args: [P], returns: P },
  LLVMFunctionType: { args: [P, P, "u32", "i32"], returns: P },
  LLVMAddFunction: { args: [P, P, P], returns: P },
  LLVMSetFunctionCallConv: { args: [P, "u32"], returns: "void" },
  LLVMSetInstructionCallConv: { args: [P, "u32"], returns: "void" },
  LLVMGetEnumAttributeKindForName: { args: [P, "usize"], returns: "u32" },
  LLVMCreateEnumAttribute: { args: [P, "u32", "u64"], returns: P },
  LLVMCreateTypeAttribute: { args: [P, "u32", P], returns: P },
  LLVMCreateStringAttribute: { args: [P, P, "u32", P, "u32"], returns: P },
  LLVMCreateConstantRangeAttribute: { args: [P, "u32", "u32", P, P], returns: P },
  LLVMAddAttributeAtIndex: { args: [P, "u32", P], returns: "void" },
  LLVMAddCallSiteAttribute: { args: [P, "u32", P], returns: "void" },
  LLVMAppendBasicBlockInContext: { args: [P, P, P], returns: P },
  LLVMCreateBuilderInContext: { args: [P], returns: P },
  LLVMPositionBuilderAtEnd: { args: [P, P], returns: "void" },
  LLVMBuildCall2: { args: [P, P, P, P, "u32", P], returns: P },
  LLVMBuildRetVoid: { args: [P], returns: P },
  LLVMBuildAtomicRMW: { args: [P, "u32", P, P, "u32", "i32"], returns: P },
  LLVMBuildAtomicCmpXchg: { args: [P, P, P, P, "u32", "u32", "i32"], returns: P },
  LLVMGetPoison: { args: [P], returns: P },
  LLVMGetParam: { args: [P, "u32"], returns: P },
  LLVMPrintModuleToString: { args: [P], returns: P },
  LLVMPrintValueToString: { args: [P], returns: P },
  LLVMDisposeMessage: { args: [P], returns: "void" },
  LLVMGetInlineAsm: { args: [P, P, "usize", P, "usize", "i32", "i32", "u32", "i32"], returns: P },
  LLVMVectorType: { args: [P, "u32"], returns: P },
  LLVMConstInt: { args: [P, "u64", "i32"], returns: P },
  LLVMConstNull: { args: [P], returns: P },
  LLVMGetUndef: { args: [P], returns: P },
  LLVMConstVector: { args: [P, "u32"], returns: P },
  LLVMConstPtrToInt: { args: [P, P], returns: P },
  LLVMAddGlobal: { args: [P, P, P], returns: P },
  LLVMSetAlignment: { args: [P, "u32"], returns: "void" },
  LLVMSetInitializer: { args: [P, P], returns: "void" },
  LLVMBuildAnd: { args: [P, P, P, P], returns: P },
  LLVMBuildExtractElement: { args: [P, P, P, P], returns: P },
  LLVMBuildInsertElement: { args: [P, P, P, P, P], returns: P },
  LLVMIntrinsicGetName: { args: ["u32", P], returns: P },
  LLVMLookupIntrinsicID: { args: [P, "usize"], returns: "u32" },
} as const;

const cstr = (s: string): Buffer => Buffer.concat([Buffer.from(s, "latin1"), Buffer.from([0])]);
const ptrs = (ps: (Pointer | null)[]): BigUint64Array => new BigUint64Array(ps.map((p) => BigInt(p ?? 0)));
/** A module's text without comment lines (`; ModuleID`, `; Function Attrs:`), which the model does not print. */
const noComments = (t: string): string =>
  t
    .split("\n")
    .filter((l) => !l.startsWith(";"))
    .join("\n")
    .trim();

/** A deterministic shuffle (a linear congruential generator; the order only has to differ between runs of the loop). */
function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe.skipIf(!HAVE && !REQUIRE)("llir-folder vs libLLVM", () => {
  // PORT: an FFI edge (PORTING §7), as capi.oracle.test.ts.
  // biome-ignore lint/suspicious/noExplicitAny: FFI edge
  const lib = (HAVE ? dlopen(DYLIB, C_API).symbols : undefined) as unknown as Record<keyof typeof C_API, (...a: any[]) => any>;
  const message = (p: Pointer): string => {
    const s = new CString(p).toString();
    lib.LLVMDisposeMessage(p);
    return s;
  };
  const kindOf = (name: string): number => lib.LLVMGetEnumAttributeKindForName(cstr(name), name.length);

  test("ATTR_KIND_ENUM is libLLVM's Attribute::AttrKind numbering", () => {
    const names: Record<string, string> = {
      ...ATTR_NAME,
      Alignment: "align",
      AllocKind: "allockind",
      AllocSize: "allocsize",
      Captures: "captures",
      Dereferenceable: "dereferenceable",
      DereferenceableOrNull: "dereferenceable_or_null",
      Memory: "memory",
      Range: "range",
    };
    const got: Record<string, number> = {};
    for (const k of Object.keys(ATTR_KIND_ENUM)) got[k] = kindOf(names[k] ?? `<no name for ${k}>`);
    expect(got).toEqual({ ...ATTR_KIND_ENUM });
    // Every kind the model can print has a value.
    for (const k of Object.keys(ATTR_NAME)) expect(ATTR_KIND_ENUM[k]).toBeDefined();
  });

  /** One attribute, made through libLLVM's C API and through the model's rustc-facing creators. */
  interface Spec {
    readonly real: (c: Pointer) => Pointer;
    readonly model: (c: L.Context) => L.Attribute;
  }
  const enumSpec = (llvmName: string, rust: L.AttributeKind): Spec => ({ real: (c) => lib.LLVMCreateEnumAttribute(c, kindOf(llvmName), 0n), model: (c) => L.LLVMRustCreateAttrNoValue(c, rust) });
  const intSpec = (llvmName: string, v: bigint, model: (c: L.Context) => L.Attribute): Spec => ({ real: (c) => lib.LLVMCreateEnumAttribute(c, kindOf(llvmName), v), model });
  const strSpec = (k: string, v: string): Spec => ({
    real: (c) => lib.LLVMCreateStringAttribute(c, cstr(k), k.length, cstr(v), v.length),
    model: (c) => L.LLVMCreateStringAttribute(c, k, k.length, v, v.length),
  });
  const rangeSpec = (bits: number, lo: bigint[], hi: bigint[]): Spec => ({
    real: (c) => lib.LLVMCreateConstantRangeAttribute(c, kindOf("range"), bits, new BigUint64Array(lo), new BigUint64Array(hi)),
    model: (c) => L.LLVMRustCreateRangeAttribute(c, bits, lo, hi),
  });
  const SPECS: Spec[] = [
    enumSpec("noundef", "NoUndef"),
    enumSpec("nonnull", "NonNull"),
    enumSpec("noalias", "NoAlias"),
    enumSpec("nofree", "NoFree"),
    enumSpec("readonly", "ReadOnly"),
    enumSpec("zeroext", "ZExt"),
    enumSpec("signext", "SExt"),
    enumSpec("inreg", "InReg"),
    enumSpec("nounwind", "NoUnwind"),
    enumSpec("noreturn", "NoReturn"),
    enumSpec("cold", "Cold"),
    enumSpec("nonlazybind", "NonLazyBind"),
    enumSpec("writable", "Writable"),
    enumSpec("dead_on_unwind", "DeadOnUnwind"),
    enumSpec("willreturn", "WillReturn"),
    intSpec("align", 8n, (c) => L.LLVMRustCreateAlignmentAttr(c, 8n)),
    intSpec("dereferenceable", 16n, (c) => L.LLVMRustCreateDereferenceableAttr(c, 16n)),
    intSpec("captures", 0n, (c) => L.LLVMRustCreateAttrNoValue(c, "CapturesNone")),
    intSpec("dead_on_return", (1n << 64n) - 1n, (c) => L.LLVMRustCreateAttrNoValue(c, "DeadOnReturn")),
    intSpec("uwtable", 2n, (c) => L.LLVMRustCreateUWTableAttr(c, true)),
    intSpec("allockind", 1n, (c) => L.LLVMRustCreateAllocKindAttr(c, 1n)),
    rangeSpec(32, [0n], [10n]),
    strSpec("target-cpu", "x86-64"),
    strSpec("probe-stack", "inline-asm"),
    strSpec("frame-pointer", "all"),
    strSpec("target-features", "+sse2"),
    strSpec("a", ""),
    strSpec("zz", "1"),
  ];
  const typeSpecs = (realTy: (c: Pointer) => Pointer, modelTy: (c: L.Context) => L.Type): Spec[] => [
    { real: (c) => lib.LLVMCreateTypeAttribute(c, kindOf("byval"), realTy(c)), model: (c) => L.LLVMRustCreateByValAttr(c, modelTy(c)) },
    { real: (c) => lib.LLVMCreateTypeAttribute(c, kindOf("sret"), realTy(c)), model: (c) => L.LLVMRustCreateStructRetAttr(c, modelTy(c)) },
  ];

  test("attribute sets print in LLVM's sorted order, on declarations and call sites", () => {
    const rc = lib.LLVMContextCreate();
    const rm = lib.LLVMModuleCreateWithNameInContext(cstr("m"), rc);
    const mc = L.LLVMContextCreate();
    const mm = L.LLVMModuleCreateWithNameInContext("m", mc);
    const specs = [...SPECS, ...typeSpecs((c) => lib.LLVMIntTypeInContext(c, 32), (c) => L.LLVMIntTypeInContext(c, 32))];
    const rPtr = lib.LLVMPointerTypeInContext(rc, 0);
    const mPtr = L.LLVMPointerTypeInContext(mc, 0);
    const rFt = lib.LLVMFunctionType(rPtr, ptrs([rPtr, rPtr]), 2, 0);
    const mFt = L.LLVMFunctionType(mPtr, [mPtr, mPtr], 2, L.FALSE);
    const rCaller = lib.LLVMAddFunction(rm, cstr("caller"), lib.LLVMFunctionType(lib.LLVMVoidTypeInContext(rc), ptrs([]), 0, 0));
    const mCaller = L.LLVMAddFunction(mm, "caller", L.LLVMFunctionType(L.LLVMVoidTypeInContext(mc), [], 0, L.FALSE));
    const rB = lib.LLVMCreateBuilderInContext(rc);
    const mB = L.LLVMCreateBuilderInContext(mc);
    lib.LLVMPositionBuilderAtEnd(rB, lib.LLVMAppendBasicBlockInContext(rc, rCaller, cstr("start")));
    L.LLVMPositionBuilderAtEnd(mB, L.LLVMAppendBasicBlockInContext(mc, mCaller, "start"));
    // Each function gets a shuffled subset at each index, added one at a time (libLLVM: `addAttributeAtIndex`) on the reference
    // side and in one LLVMRustAddFunctionAttributes call per index on the model's; a call site does the same.
    for (let seed = 1; seed <= 24; seed++) {
      const name = `f${seed}`;
      const rf = lib.LLVMAddFunction(rm, cstr(name), rFt);
      const mf = L.LLVMAddFunction(mm, name, mFt);
      const rArgs = ptrs([lib.LLVMGetPoison(rPtr), lib.LLVMGetPoison(rPtr)]);
      const rCall = lib.LLVMBuildCall2(rB, rFt, rf, rArgs, 2, cstr(""));
      const mCall = L.LLVMBuildCallWithOperandBundles(mB, mFt, mf, [L.LLVMGetPoison(mPtr), L.LLVMGetPoison(mPtr)], 2, [], 0, "");
      for (const [k, index] of [0xffffffff, 0, 1, 2].entries()) {
        const pick = shuffled(specs, seed * 7 + k).slice(0, 4 + ((seed + k) % 9));
        for (const s of pick) {
          lib.LLVMAddAttributeAtIndex(rf, index, s.real(rc));
          lib.LLVMAddCallSiteAttribute(rCall, index, s.real(rc));
        }
        // A second, partly overlapping batch: replacement keeps one attribute per kind.
        const again = shuffled(specs, seed * 13 + k).slice(0, 3);
        for (const s of again) {
          lib.LLVMAddAttributeAtIndex(rf, index, s.real(rc));
          lib.LLVMAddCallSiteAttribute(rCall, index, s.real(rc));
        }
        const mPick = pick.map((s) => s.model(mc));
        const mAgain = again.map((s) => s.model(mc));
        L.LLVMRustAddFunctionAttributes(mf, index, mPick, mPick.length);
        L.LLVMRustAddFunctionAttributes(mf, index, mAgain, mAgain.length);
        L.LLVMRustAddCallSiteAttributes(mCall, index, mPick, mPick.length);
        L.LLVMRustAddCallSiteAttributes(mCall, index, mAgain, mAgain.length);
      }
    }
    lib.LLVMBuildRetVoid(rB);
    L.LLVMBuildRetVoid(mB);
    const want = noComments(message(lib.LLVMPrintModuleToString(rm)));
    const got = noComments(printModule(mm as never));
    expect(got.split("\n")).toEqual(want.split("\n"));
  });

  test("range, dead_on_return and captures attributes print as libLLVM's", () => {
    const rc = lib.LLVMContextCreate();
    const rm = lib.LLVMModuleCreateWithNameInContext(cstr("m"), rc);
    const mc = L.LLVMContextCreate();
    const mm = L.LLVMModuleCreateWithNameInContext("m", mc);
    const M64 = (1n << 64n) - 1n;
    const cases: [number, bigint[], bigint[]][] = [
      [1, [0n], [1n]],
      [1, [1n], [0n]],
      [8, [0n], [2n]],
      [8, [1n], [0n]],
      [8, [0xffn], [0x10n]],
      [8, [0x180n], [0x7fn]], // bits above NumBits are cleared
      [16, [0x8000n], [0x7fffn]],
      [32, [0n], [1114112n]],
      [32, [0x80000000n], [0n]],
      [32, [0xfffffff0n], [5n]],
      [64, [0n], [2305843009213693952n]],
      [64, [1n], [0n]],
      [64, [M64], [1n]],
      [64, [1n << 63n], [(1n << 63n) - 1n]],
      [65, [M64, 1n], [0n, 0n]],
      [128, [0n, 0n], [0n, 1n << 63n]],
      [128, [5n, M64], [7n, 0n]],
      [128, [M64, M64], [0n, 0n]],
    ];
    const specs: Spec[] = cases.map(([bits, lo, hi]) => rangeSpec(bits, lo, hi));
    specs.push(
      intSpec("dead_on_return", M64, (c) => L.LLVMRustCreateAttrNoValue(c, "DeadOnReturn")),
      intSpec("captures", 0n, (c) => L.LLVMRustCreateAttrNoValue(c, "CapturesNone")),
      intSpec("captures", 51n, (c) => L.LLVMRustCreateAttrNoValue(c, "CapturesAddress")),
      intSpec("captures", 119n, (c) => L.LLVMRustCreateAttrNoValue(c, "CapturesReadOnly")),
      // replay.ts: `allocsize` is `ElemSizeArg << 32 | 0xFFFFFFFF`, `allockind` rustc's flags.
      intSpec("allocsize", 0xffffffffn, (c) => L.LLVMRustCreateAllocSizeAttr(c, 0)),
      intSpec("allocsize", (3n << 32n) | 0xffffffffn, (c) => L.LLVMRustCreateAllocSizeAttr(c, 3)),
      ...[1n, 2n, 4n, 41n, 49n, 63n].map((k) => intSpec("allockind", k, (c) => L.LLVMRustCreateAllocKindAttr(c, k))),
    );
    const diffs: string[] = [];
    specs.forEach((s, i) => {
      const bits = i < cases.length ? cases[i]![0] : 64;
      const rT = lib.LLVMIntTypeInContext(rc, bits);
      const mT = L.LLVMIntTypeInContext(mc, bits);
      const rf = lib.LLVMAddFunction(rm, cstr(`g${i}`), lib.LLVMFunctionType(rT, ptrs([rT]), 1, 0));
      const mf = L.LLVMAddFunction(mm, `g${i}`, L.LLVMFunctionType(mT, [mT], 1, L.FALSE));
      lib.LLVMAddAttributeAtIndex(rf, 0, s.real(rc));
      lib.LLVMAddAttributeAtIndex(rf, 1, s.real(rc));
      const a = s.model(mc);
      L.LLVMRustAddFunctionAttributes(mf, 0, [a], 1);
      L.LLVMRustAddFunctionAttributes(mf, 1, [a], 1);
      const want = noComments(message(lib.LLVMPrintValueToString(rf)));
      const got = printValueToString(mf as never).trim();
      if (got !== want) diffs.push(`model: ${got}\nllvm:  ${want}`);
    });
    expect(diffs).toEqual([]);
    // The attribute is uniqued per context by its value, as LLVM's are.
    expect(L.LLVMRustCreateRangeAttribute(mc, 8, [0x180n], [0x7fn])).toBe(L.LLVMRustCreateRangeAttribute(mc, 8, [0x80n], [0x17fn]));
  });

  test("printCallingConv: every convention 0..1023 on a declaration, 0..130 on calls", () => {
    const rc = lib.LLVMContextCreate();
    const rm = lib.LLVMModuleCreateWithNameInContext(cstr("m"), rc);
    const mc = L.LLVMContextCreate();
    const mm = L.LLVMModuleCreateWithNameInContext("m", mc);
    const rFt = lib.LLVMFunctionType(lib.LLVMVoidTypeInContext(rc), ptrs([]), 0, 0);
    const mFt = L.LLVMFunctionType(L.LLVMVoidTypeInContext(mc), [], 0, L.FALSE);
    const diffs: string[] = [];
    for (let cc = 0; cc < 1024; cc++) {
      const rf = lib.LLVMAddFunction(rm, cstr(`d${cc}`), rFt);
      const mf = L.LLVMAddFunction(mm, `d${cc}`, mFt);
      lib.LLVMSetFunctionCallConv(rf, cc);
      L.LLVMSetFunctionCallConv(mf, cc);
      const want = noComments(message(lib.LLVMPrintValueToString(rf)));
      const got = printValueToString(mf as never).trim();
      if (got !== want) diffs.push(`${cc}: model ${got} / llvm ${want}`);
    }
    expect(diffs).toEqual([]);
    // Call sites, in one definition: the whole module's text.
    const rCaller = lib.LLVMAddFunction(rm, cstr("caller"), rFt);
    const mCaller = L.LLVMAddFunction(mm, "caller", mFt);
    const rB = lib.LLVMCreateBuilderInContext(rc);
    const mB = L.LLVMCreateBuilderInContext(mc);
    lib.LLVMPositionBuilderAtEnd(rB, lib.LLVMAppendBasicBlockInContext(rc, rCaller, cstr("start")));
    L.LLVMPositionBuilderAtEnd(mB, L.LLVMAppendBasicBlockInContext(mc, mCaller, "start"));
    const rCallee = lib.LLVMAddFunction(rm, cstr("callee"), rFt);
    const mCallee = L.LLVMAddFunction(mm, "callee", mFt);
    for (let cc = 0; cc <= 130; cc++) {
      lib.LLVMSetInstructionCallConv(lib.LLVMBuildCall2(rB, rFt, rCallee, ptrs([]), 0, cstr("")), cc);
      L.LLVMSetInstructionCallConv(L.LLVMBuildCallWithOperandBundles(mB, mFt, mCallee, [], 0, [], 0, ""), cc);
    }
    lib.LLVMBuildRetVoid(rB);
    L.LLVMBuildRetVoid(mB);
    expect(noComments(printModule(mm as never)).split("\n")).toEqual(noComments(message(lib.LLVMPrintModuleToString(rm))).split("\n"));
  });

  test("atomicrmw and cmpxchg without an alignment get libLLVM's, per data layout and operand type", () => {
    const layouts = [
      "",
      "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128",
      "e-m:o-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-n32:64-S128-Fn32",
      "e-p:32:32-i64:64",
      "e-p:16:16-p1:64:64",
    ];
    for (const dl of layouts) {
      const rc = lib.LLVMContextCreate();
      const rm = lib.LLVMModuleCreateWithNameInContext(cstr("m"), rc);
      const mc = L.LLVMContextCreate();
      const mm = L.LLVMModuleCreateWithNameInContext("m", mc);
      lib.LLVMSetDataLayout(rm, cstr(dl));
      L.LLVMSetDataLayout(mm, dl);
      // [libLLVM type, model type, integer?]
      const types: [Pointer, L.Type, boolean][] = [
        ...[8, 16, 32, 64, 128].map((n): [Pointer, L.Type, boolean] => [lib.LLVMIntTypeInContext(rc, n), L.LLVMIntTypeInContext(mc, n), true]),
        [lib.LLVMPointerTypeInContext(rc, 0), L.LLVMPointerTypeInContext(mc, 0), false],
        [lib.LLVMPointerTypeInContext(rc, 1), L.LLVMPointerTypeInContext(mc, 1), false],
        [lib.LLVMHalfTypeInContext(rc), L.LLVMHalfTypeInContext(mc), false],
        [lib.LLVMFloatTypeInContext(rc), L.LLVMFloatTypeInContext(mc), false],
        [lib.LLVMDoubleTypeInContext(rc), L.LLVMDoubleTypeInContext(mc), false],
      ];
      const rPtr = lib.LLVMPointerTypeInContext(rc, 0);
      const mPtr = L.LLVMPointerTypeInContext(mc, 0);
      const rf = lib.LLVMAddFunction(rm, cstr("atoms"), lib.LLVMFunctionType(lib.LLVMVoidTypeInContext(rc), ptrs([rPtr]), 1, 0));
      const mf = L.LLVMAddFunction(mm, "atoms", L.LLVMFunctionType(L.LLVMVoidTypeInContext(mc), [mPtr], 1, L.FALSE));
      const rB = lib.LLVMCreateBuilderInContext(rc);
      const mB = L.LLVMCreateBuilderInContext(mc);
      lib.LLVMPositionBuilderAtEnd(rB, lib.LLVMAppendBasicBlockInContext(rc, rf, cstr("start")));
      L.LLVMPositionBuilderAtEnd(mB, L.LLVMAppendBasicBlockInContext(mc, mf, "start"));
      const rP = lib.LLVMGetParam(rf, 0);
      const mP = L.LLVMGetParam(mf, 0);
      for (const [rT, mT, isInt] of types) {
        // xchg takes every type here; add only integers. cmpxchg takes integers and pointers.
        for (const op of isInt ? (["AtomicXchg", "AtomicAdd"] as const) : (["AtomicXchg"] as const)) {
          lib.LLVMBuildAtomicRMW(rB, L.AtomicRmwBinOp_discriminant[op], rP, lib.LLVMGetPoison(rT), 7, 0);
          L.LLVMBuildAtomicRMW(mB, op, mP, L.LLVMGetPoison(mT), "SequentiallyConsistent", L.FALSE);
        }
        if (isInt || mT === L.LLVMPointerTypeInContext(mc, 0) || mT === L.LLVMPointerTypeInContext(mc, 1)) {
          lib.LLVMBuildAtomicCmpXchg(rB, rP, lib.LLVMGetPoison(rT), lib.LLVMGetPoison(rT), 6, 4, 1);
          L.LLVMBuildAtomicCmpXchg(mB, mP, L.LLVMGetPoison(mT), L.LLVMGetPoison(mT), "AcquireRelease", "Acquire", L.TRUE);
        }
      }
      lib.LLVMBuildRetVoid(rB);
      L.LLVMBuildRetVoid(mB);
      expect(`${dl}\n${printValueToString(mf as never).trim()}`).toBe(`${dl}\n${noComments(message(lib.LLVMPrintValueToString(rf)))}`);
    }
  });

  test("inline asm values print as libLLVM's in calls", () => {
    const rc = lib.LLVMContextCreate();
    const rm = lib.LLVMModuleCreateWithNameInContext(cstr("m"), rc);
    const mc = L.LLVMContextCreate();
    const mm = L.LLVMModuleCreateWithNameInContext("m", mc);
    const rFt = lib.LLVMFunctionType(lib.LLVMVoidTypeInContext(rc), ptrs([]), 0, 0);
    const mFt = L.LLVMFunctionType(L.LLVMVoidTypeInContext(mc), [], 0, L.FALSE);
    const rI = lib.LLVMIntTypeInContext(rc, 32);
    const mI = L.LLVMIntTypeInContext(mc, 32);
    const rFt2 = lib.LLVMFunctionType(rI, ptrs([rI]), 1, 0);
    const mFt2 = L.LLVMFunctionType(mI, [mI], 1, L.FALSE);
    const rf = lib.LLVMAddFunction(rm, cstr("f"), rFt);
    const mf = L.LLVMAddFunction(mm, "f", mFt);
    const rB = lib.LLVMCreateBuilderInContext(rc);
    const mB = L.LLVMCreateBuilderInContext(mc);
    lib.LLVMPositionBuilderAtEnd(rB, lib.LLVMAppendBasicBlockInContext(rc, rf, cstr("start")));
    L.LLVMPositionBuilderAtEnd(mB, L.LLVMAppendBasicBlockInContext(mc, mf, "start"));
    const asms: [string, string, number, number, number, number][] = [
      ["", "~{memory}", 1, 0, 0, 0],
      ["nop", "", 0, 0, 0, 0],
      ["mov $0, $1\n\t\"q\"", "=r,r,~{dirflag},~{fpsr},~{flags}", 1, 1, 1, 1],
      ["\\ \u00e9", "=&r,0", 0, 1, 0, 1],
    ];
    for (const [asm, cons, se, as, dialect, canThrow] of asms) {
      const two = cons.startsWith("=");
      const rT = two ? rFt2 : rFt;
      const mT = two ? mFt2 : mFt;
      const ra = lib.LLVMGetInlineAsm(rT, Buffer.from(asm, "utf8"), Buffer.byteLength(asm, "utf8"), Buffer.from(cons), cons.length, se, as, dialect, canThrow);
      const ma = L.LLVMGetInlineAsm(mT, asm, Buffer.byteLength(asm, "utf8"), cons, cons.length, L.Bool.of(se), L.Bool.of(as), dialect === 0 ? "Att" : "Intel", L.Bool.of(canThrow));
      // Uniqued per context by key.
      expect(L.LLVMGetInlineAsm(mT, asm, Buffer.byteLength(asm, "utf8"), cons, cons.length, L.Bool.of(se), L.Bool.of(as), dialect === 0 ? "Att" : "Intel", L.Bool.of(canThrow))).toBe(ma);
      lib.LLVMBuildCall2(rB, rT, ra, two ? ptrs([lib.LLVMGetPoison(rI)]) : ptrs([]), two ? 1 : 0, cstr(""));
      L.LLVMBuildCallWithOperandBundles(mB, mT, ma, two ? [L.LLVMGetPoison(mI)] : [], two ? 1 : 0, [], 0, "");
    }
    lib.LLVMBuildRetVoid(rB);
    L.LLVMBuildRetVoid(mB);
    expect(printValueToString(mf as never).trim()).toBe(noComments(message(lib.LLVMPrintValueToString(rf))));
  });

  test("constant extractelement / insertelement and and(ptrtoint @g, C) fold as libLLVM's", () => {
    const layouts = ["", "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128", "e-m:o-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-n32:64-S128-Fn32", "e-Fi8", "e-Fn64-i32:64"];
    for (const dl of layouts) {
      const rc = lib.LLVMContextCreate();
      const rm = lib.LLVMModuleCreateWithNameInContext(cstr("m"), rc);
      const mc = L.LLVMContextCreate();
      const mm = L.LLVMModuleCreateWithNameInContext("m", mc);
      lib.LLVMSetDataLayout(rm, cstr(dl));
      L.LLVMSetDataLayout(mm, dl);
      const rI = (n: number) => lib.LLVMIntTypeInContext(rc, n);
      const mI = (n: number) => L.LLVMIntTypeInContext(mc, n);
      const rF = lib.LLVMAddFunction(rm, cstr("f"), lib.LLVMFunctionType(lib.LLVMVoidTypeInContext(rc), ptrs([]), 0, 0));
      const mF = L.LLVMAddFunction(mm, "f", L.LLVMFunctionType(L.LLVMVoidTypeInContext(mc), [], 0, L.FALSE));
      const rB = lib.LLVMCreateBuilderInContext(rc);
      const mB = L.LLVMCreateBuilderInContext(mc);
      lib.LLVMPositionBuilderAtEnd(rB, lib.LLVMAppendBasicBlockInContext(rc, rF, cstr("start")));
      L.LLVMPositionBuilderAtEnd(mB, L.LLVMAppendBasicBlockInContext(mc, mF, "start"));
      const got: string[] = [];
      const want: string[] = [];
      // A folded result is compared as a constant; an instruction (no fold, on both sides or one) through the function's text.
      const show = (r: Pointer, m: L.Value): void => {
        const isInst = L.LLVMIsAInstruction(m) !== undefined;
        want.push(isInst ? "(instruction)" : message(lib.LLVMPrintValueToString(r)));
        got.push(isInst ? "(instruction)" : printValueToString(m as never));
      };
      // Vectors: data, all-zero, undef, poison-free splat; indices in range, out of range, undef.
      const vecs: [Pointer, L.Value][] = [
        [lib.LLVMConstVector(ptrs([1n, 2n, 3n, 4n].map((v) => lib.LLVMConstInt(rI(32), v, 0))), 4), L.LLVMConstVector([1n, 2n, 3n, 4n].map((v) => L.LLVMConstInt(mI(32), v, L.FALSE)), 4)],
        [lib.LLVMConstNull(lib.LLVMVectorType(rI(8), 8)), L.LLVMConstNull(L.LLVMVectorType(mI(8), 8))],
        [lib.LLVMGetUndef(lib.LLVMVectorType(rI(16), 2)), L.LLVMGetUndef(L.LLVMVectorType(mI(16), 2))],
        [lib.LLVMConstVector(ptrs([7n, 7n].map((v) => lib.LLVMConstInt(rI(64), v, 0))), 2), L.LLVMConstVector([7n, 7n].map((v) => L.LLVMConstInt(mI(64), v, L.FALSE)), 2)],
      ];
      for (const [rv, mv] of vecs) {
        const mEl = (L.LLVMTypeOf(mv) as unknown as { elementType: L.Type }).elementType;
        const bits = (mEl as unknown as { bits: number }).bits;
        for (const idx of [0n, 1n, 3n, 9n, -1n]) {
          const ri = idx < 0n ? lib.LLVMGetUndef(rI(32)) : lib.LLVMConstInt(rI(32), idx, 0);
          const mi = idx < 0n ? L.LLVMGetUndef(mI(32)) : L.LLVMConstInt(mI(32), idx, L.FALSE);
          show(lib.LLVMBuildExtractElement(rB, rv, ri, cstr("")), L.LLVMBuildExtractElement(mB, mv, mi, ""));
          for (const elt of [0n, 5n]) {
            show(lib.LLVMBuildInsertElement(rB, rv, lib.LLVMConstInt(rI(bits), elt, 0), ri, cstr("")), L.LLVMBuildInsertElement(mB, mv, L.LLVMConstInt(mI(bits), elt, L.FALSE), mi, ""));
          }
        }
      }
      // and (ptrtoint @g), C: a function, globals with alignments 1, 2, 8, 16, and declarations of i8 / [4 x i32] / i64.
      const ptrTo = (n: number) => [lib.LLVMIntTypeInContext(rc, n), L.LLVMIntTypeInContext(mc, n)] as const;
      const globals: [Pointer, L.Value][] = [[rF, mF]];
      for (const align of [1, 2, 8, 16]) {
        const rg = lib.LLVMAddGlobal(rm, rI(8), cstr(`a${align}`));
        const mg = L.LLVMAddGlobal(mm, mI(8), `a${align}`);
        lib.LLVMSetInitializer(rg, lib.LLVMConstInt(rI(8), 0n, 0));
        L.LLVMSetInitializer(mg, L.LLVMConstInt(mI(8), 0n, L.FALSE));
        lib.LLVMSetAlignment(rg, align);
        L.LLVMSetAlignment(mg, align);
        globals.push([rg, mg]);
      }
      for (const [name, rt, mt] of [["d8", rI(8), mI(8)], ["d32", rI(32), mI(32)], ["d64", rI(64), mI(64)], ["d128", rI(128), mI(128)]] as const) globals.push([lib.LLVMAddGlobal(rm, rt, cstr(name)), L.LLVMAddGlobal(mm, mt, name)]);
      for (const [rg, mg] of globals) {
        for (const w of [32, 64]) {
          const [rT, mT] = ptrTo(w);
          for (const c of [1n, 2n, 3n, 7n, 8n, 15n, 16n]) {
            show(lib.LLVMBuildAnd(rB, lib.LLVMConstPtrToInt(rg, rT), lib.LLVMConstInt(rT, c, 0), cstr("")), L.LLVMBuildAnd(mB, L.LLVMConstPtrToInt(mg, mT), L.LLVMConstInt(mT, c, L.FALSE), ""));
          }
        }
      }
      lib.LLVMBuildRetVoid(rB);
      L.LLVMBuildRetVoid(mB);
      want.push(noComments(message(lib.LLVMPrintValueToString(rF))));
      got.push(printValueToString(mF as never).trim());
      expect(got.map((g) => `${dl}: ${g}`)).toEqual(want.map((w) => `${dl}: ${w}`));
    }
  });

  test("armExclusiveIntrinsic is libLLVM's arm_ldrex / arm_strex, and the ARM names it relies on", () => {
    const lookup = (name: string): number => lib.LLVMLookupIntrinsicID(cstr(name), Buffer.byteLength(name, "latin1"));
    const len = new BigUint64Array(1);
    const arm: string[] = [];
    for (let id = 1; id < 20000; id++) {
      const p = lib.LLVMIntrinsicGetName(id, len) as Pointer | null;
      const n = Number(len[0]);
      if (p === null || n <= 5 || n > 200) break;
      const name = Buffer.from(toArrayBuffer(p, 0, n)).toString("latin1");
      if (name.startsWith("llvm.arm.")) arm.push(name);
    }
    expect(arm.length).toBeGreaterThan(100);
    // The derivation in intrinsics.ts: only these four ARM names start with the two prefixes.
    expect(arm.filter((n) => n.startsWith("llvm.arm.ldrex") || n.startsWith("llvm.arm.strex")).sort()).toEqual(["llvm.arm.ldrex", "llvm.arm.ldrexd", "llvm.arm.strex", "llvm.arm.strexd"]);
    const ldrex = lookup("llvm.arm.ldrex");
    const strex = lookup("llvm.arm.strex");
    expect(ldrex).not.toBe(0);
    expect(strex).not.toBe(0);
    const names = new Set<string>();
    for (const n of arm) for (const v of [n, `${n}.p0`, `${n}.p1`, `${n}.p0.x`, `${n}x`, `${n}.`, n.slice(0, -1)]) names.add(v);
    for (const v of ["llvm.arm.ldrex.p0", "llvm.arm.strex.p0", "llvm.arm.ldrexd.p0", "llvm.arm.ldrexfoo", "llvm.arm.strexb", "llvm.aarch64.ldxr.p0", "llvm.memcpy.p0.p0.i64", "llvm.arm", "llvm.arm.", "llvm.x86.sse2.pause", "foo", "arm.ldrex"]) names.add(v);
    const diffs: string[] = [];
    for (const n of names) {
      const id = n.startsWith("llvm.") ? lookup(n) : 0;
      const real = id === ldrex ? "arm_ldrex" : id === strex ? "arm_strex" : undefined;
      if (armExclusiveIntrinsic(n) !== real) diffs.push(`${n}: model ${armExclusiveIntrinsic(n)}, libLLVM ${real}`);
    }
    expect(diffs).toEqual([]);

    // Through the wrapper: direct calls to functions of those names, a plain function and an indirect call.
    const mc = L.LLVMContextCreate();
    const mm = L.LLVMModuleCreateWithNameInContext("m", mc);
    const mPtr = L.LLVMPointerTypeInContext(mc, 0);
    const ft = L.LLVMFunctionType(L.LLVMIntTypeInContext(mc, 32), [mPtr], 1, L.FALSE);
    const caller = L.LLVMAddFunction(mm, "caller", L.LLVMFunctionType(L.LLVMVoidTypeInContext(mc), [mPtr], 1, L.FALSE));
    const B = L.LLVMCreateBuilderInContext(mc);
    L.LLVMPositionBuilderAtEnd(B, L.LLVMAppendBasicBlockInContext(mc, caller, "start"));
    const call = (callee: L.Value): number => L.LLVMRustGetElementTypeArgIndex(L.LLVMBuildCallWithOperandBundles(B, ft, callee, [L.LLVMGetPoison(mPtr)], 1, [], 0, ""));
    const fn = (name: string): L.Value => L.LLVMAddFunction(mm, name, ft);
    expect([fn("llvm.arm.ldrex.p0"), fn("llvm.arm.strex.p0"), fn("llvm.arm.ldrexd"), fn("llvm.arm.strexd"), fn("llvm.arm.ldrex"), fn("ldrex"), L.LLVMGetParam(caller, 0)].map(call)).toEqual([0, 1, -1, -1, 0, -1, -1]);
  });
});
