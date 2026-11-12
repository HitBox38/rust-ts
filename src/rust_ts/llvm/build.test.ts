// rust-ts: unit tests of llir-core-b's half of the model (lane llir-core-b): the builder, instruction forms the proof cases do
// not reach, and the replay rules of review llir-core-a R1, R3, R6. Printed bodies are also parsed and verified by the pinned
// `opt` when the toolchain is present (the oracle's own parser, not a hand-written expectation of the whole text).
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIN, UPSTREAM } from "../../../scripts/lib/common.ts";
import { llvmBinDir } from "../../../scripts/lib/llvm-tools.ts";
import { Unported } from "../../std/panic.ts";
import * as L from "./ffi.ts";
import { Inst } from "./inst.ts";
import { printModule, printValueToString } from "./printer.ts";
import { parseScript, replay } from "./replay.ts";

function fresh() {
  const C = L.LLVMContextCreate();
  const M = L.LLVMModuleCreateWithNameInContext("m", C);
  const i1 = L.LLVMInt1TypeInContext(C);
  const i8 = L.LLVMInt8TypeInContext(C);
  const i32 = L.LLVMInt32TypeInContext(C);
  const i64 = L.LLVMInt64TypeInContext(C);
  const ptr = L.LLVMPointerTypeInContext(C, 0);
  const vd = L.LLVMVoidTypeInContext(C);
  const dbl = L.LLVMDoubleTypeInContext(C);
  return { C, M, i1, i8, i32, i64, ptr, vd, dbl };
}
const int = (t: L.Type, v: number | bigint) => L.LLVMConstInt(t, BigInt(v), L.FALSE);

describe("builder", () => {
  test("folds constant operands, builds instructions otherwise, and names them in the function's table", () => {
    const { C, M, i32 } = fresh();
    const f = L.LLVMAddFunction(M, "f", L.LLVMFunctionType(i32, [i32], 1, L.FALSE));
    const bb = L.LLVMAppendBasicBlockInContext(C, f, "start");
    const B = L.LLVMCreateBuilderInContext(C);
    L.LLVMPositionBuilderAtEnd(B, bb);
    expect(L.LLVMBuildAdd(B, int(i32, 2), int(i32, 3), "x")).toBe(int(i32, 5));
    const a = L.LLVMGetParam(f, 0);
    L.LLVMSetValueName2(a, "x", 1);
    const s = L.LLVMBuildAdd(B, a, int(i32, 3), "x");
    expect(s).toBeInstanceOf(Inst);
    // The argument holds `x`; the instruction collides, with the function's one counter and no dot.
    expect(s.name).toBe("x1");
    expect(L.LLVMGetInsertBlock(B)).toBe(bb);
    expect(L.LLVMGetBasicBlockParent(bb)).toBe(f);
    expect(L.LLVMGetFirstBasicBlock(f)).toBe(bb);
    expect(L.LLVMIsAInstruction(s)).toBe(s);
    expect(L.LLVMGetOperand(s, 1)).toBe(int(i32, 3));
  });

  test("LLVMRustPositionBuilderAtStart and PastAllocas, and alignment", () => {
    const { C, M, i8, i32, vd } = fresh();
    const f = L.LLVMAddFunction(M, "f", L.LLVMFunctionType(vd, [], 0, L.FALSE));
    const bb = L.LLVMAppendBasicBlockInContext(C, f, "start");
    const B = L.LLVMCreateBuilderInContext(C);
    L.LLVMPositionBuilderAtEnd(B, bb);
    L.LLVMBuildRetVoid(B);
    const A = L.LLVMCreateBuilderInContext(C);
    L.LLVMRustPositionBuilderAtStart(A, bb);
    const a1 = L.LLVMBuildAlloca(A, i32, "a");
    const a2 = L.LLVMBuildAlloca(A, i8, "b");
    L.LLVMSetAlignment(a1, 4);
    expect(L.LLVMGetAlignment(a1)).toBe(4);
    // The data layout's default alignment is not computed: asking for it stops.
    expect(() => L.LLVMGetAlignment(a2)).toThrow(Unported);
    const P = L.LLVMCreateBuilderInContext(C);
    L.LLVMRustPositionBuilderPastAllocas(P, f);
    const st = L.LLVMBuildStore(P, int(i8, 1), a2);
    expect((bb as unknown as { insts: unknown[] }).insts).toEqual([a1, a2, st, (bb as unknown as { insts: unknown[] }).insts[3]]);
  });

  test("the memory intrinsics declare llvm.memcpy.p0.p0.i64 and set the parameter alignments", () => {
    const { C, M, i8, i64, ptr, vd } = fresh();
    const f = L.LLVMAddFunction(M, "f", L.LLVMFunctionType(vd, [ptr, ptr], 2, L.FALSE));
    const B = L.LLVMCreateBuilderInContext(C);
    L.LLVMPositionBuilderAtEnd(B, L.LLVMAppendBasicBlockInContext(C, f, "start"));
    L.LLVMRustBuildMemCpy(B, L.LLVMGetParam(f, 0), 8, L.LLVMGetParam(f, 1), 1, int(i64, 64), false);
    L.LLVMRustBuildMemSet(B, L.LLVMGetParam(f, 0), 0, int(i8, 7), int(i64, 3), true);
    L.LLVMBuildRetVoid(B);
    const text = printModule(M);
    expect(text).toContain("call void @llvm.memcpy.p0.p0.i64(ptr align 8 %0, ptr align 1 %1, i64 64, i1 false)");
    expect(text).toContain("call void @llvm.memset.p0.i64(ptr %0, i8 7, i64 3, i1 true)");
    expect(text).toContain("declare void @llvm.memcpy.p0.p0.i64(ptr, ptr, i64, i1)");
  });

  test("an unsourced or out-of-lane form stops instead of guessing", () => {
    const { C, dbl } = fresh();
    const B = L.LLVMCreateBuilderInContext(C);
    // Two double constants fold (lane llir-apfloat); two ppc_fp128 zeros do not: DoubleAPFloat arithmetic stops.
    expect(printValueToString(L.LLVMBuildFAdd(B, L.LLVMConstReal(dbl, 1.5), L.LLVMConstReal(dbl, 2), ""))).toBe("double 3.500000e+00");
    const ppc0 = L.LLVMConstNull(L.LLVMPPCFP128TypeInContext(C));
    expect(() => L.LLVMBuildFMul(B, ppc0, ppc0, "")).toThrow(Unported);
    // A debug location is llir-di's.
    expect(() => L.LLVMSetCurrentDebugLocation2(B, L.LLVMMDStringInContext2(C, "x", 1))).toThrow(Unported);
  });
});

/** A module exercising the forms rustc emits that the proof cases do not: flags, metadata attachments, funclet pads,
 * landingpad clauses, vector operations, bundles, tail kinds, atomics with a sync scope. */
function formsModule() {
  const { C, M, i1, i8, i32, i64, ptr, vd, dbl } = fresh();
  const pers = L.LLVMAddFunction(M, "pers", L.LLVMFunctionType(i32, [], 0, L.TRUE));
  const callee = L.LLVMAddFunction(M, "callee", L.LLVMFunctionType(i32, [i32], 1, L.FALSE));
  const ft = L.LLVMFunctionType(vd, [i32, ptr, dbl], 3, L.FALSE);
  const f = L.LLVMAddFunction(M, "forms", ft);
  const [x, p, d] = [0, 1, 2].map((i) => L.LLVMGetParam(f, i));
  const bb = (n: string) => L.LLVMAppendBasicBlockInContext(C, f, n);
  const start = bb("start");
  const lp = bb("lp");
  const done = bb("done");
  const ehpad = bb("ehpad");
  const B = L.LLVMCreateBuilderInContext(C);
  L.LLVMPositionBuilderAtEnd(B, start);
  const nsw = L.LLVMBuildNSWAdd(B, x!, int(i32, 1), "nsw");
  const nuw = L.LLVMBuildNUWMul(B, nsw, x!, "nuw");
  const ex = L.LLVMBuildExactUDiv(B, nuw, int(i32, 4), "ex");
  const or = L.LLVMBuildOr(B, ex, x!, "or");
  L.LLVMSetIsDisjoint(or, L.TRUE);
  const tr = L.LLVMBuildTrunc(B, or, i8, "tr");
  L.LLVMSetNUW(tr, L.TRUE);
  const ld = L.LLVMBuildLoad2(B, i8, p!, "ld");
  L.LLVMSetAlignment(ld, 1);
  L.LLVMSetVolatile(ld, L.TRUE);
  const md = (ops: L.Metadata[]) => L.LLVMMetadataAsValue(C, L.LLVMMDNodeInContext2(C, ops, ops.length));
  const kind = (k: string) => L.LLVMGetMDKindIDInContext(C, k, k.length);
  L.LLVMSetMetadata(ld, kind("range"), md([L.LLVMValueAsMetadata(int(i8, 0)), L.LLVMValueAsMetadata(int(i8, 2))]));
  L.LLVMSetMetadata(ld, kind("noundef"), md([]));
  const lp2 = L.LLVMBuildLoad2(B, ptr, p!, "lp");
  L.LLVMSetAlignment(lp2, 8);
  L.LLVMSetMetadata(lp2, kind("nonnull"), md([]));
  L.LLVMSetMetadata(lp2, kind("align"), md([L.LLVMValueAsMetadata(int(i64, 8))]));
  const st = L.LLVMBuildStore(B, tr, p!);
  L.LLVMSetAlignment(st, 1);
  L.LLVMSetOrdering(st, "Release");
  const fn = L.LLVMBuildFNeg(B, d!, "fn");
  const fc = L.LLVMBuildFCmp(B, L.RealPredicate_discriminant.RealUNO, fn, d!, "fc");
  L.LLVMBuildSelect(B, fc, x!, int(i32, 7), "sel");
  const v = L.LLVMBuildInsertElement(B, L.LLVMGetPoison(L.LLVMVectorType(i32, 4)), x!, int(i32, 0), "v");
  L.LLVMBuildShuffleVector(B, v, L.LLVMGetPoison(L.LLVMVectorType(i32, 4)), L.LLVMConstNull(L.LLVMVectorType(i32, 4)), "splat");
  L.LLVMBuildExtractElement(B, v, int(i32, 0), "e0");
  const rmw = L.LLVMBuildAtomicRMW(B, "AtomicXchg", p!, int(i8, 1), "Monotonic", L.TRUE);
  L.LLVMSetAlignment(rmw, 1);
  const cx = L.LLVMBuildAtomicCmpXchg(B, p!, int(i8, 0), int(i8, 1), "SequentiallyConsistent", "Monotonic", L.FALSE);
  L.LLVMSetWeak(cx, L.TRUE);
  L.LLVMSetAlignment(cx, 1);
  L.LLVMBuildFence(B, "Acquire", L.TRUE, "");
  L.LLVMBuildGEPWithNoWrapFlags(B, i8, p!, [x!], 1, "g", L.GEPNoWrapFlags.NUSW);
  const bundle = L.LLVMCreateOperandBundle("funclet", 7, [], 0)!;
  const call = L.LLVMBuildCallWithOperandBundles(B, L.LLVMGlobalGetValueType(callee), callee, [x!], 1, [L.LLVMCreateOperandBundle("deopt", 5, [x!], 1)!], 1, "c");
  L.LLVMSetTailCallKind(call, "NoTail");
  L.LLVMRustAddCallSiteAttributes(call, 0xffffffff, [L.LLVMRustCreateAttrNoValue(C, "Cold")], 1);
  L.LLVMRustAddCallSiteAttributes(call, 1, [L.LLVMRustCreateAttrNoValue(C, "NoUndef")], 1);
  void bundle;
  L.LLVMBuildInvokeWithOperandBundles(B, L.LLVMGlobalGetValueType(callee), callee, [x!], 1, done, lp, [], 0, "inv");
  L.LLVMPositionBuilderAtEnd(B, lp);
  L.LLVMSetPersonalityFn(f, pers);
  const pad = L.LLVMBuildLandingPad(B, L.LLVMStructTypeInContext(C, [ptr, i32], 2, L.FALSE), undefined, 2, "pad");
  L.LLVMAddClause(pad, L.LLVMConstNull(ptr));
  L.LLVMAddClause(pad, L.LLVMConstArray2(ptr, [], 0n));
  L.LLVMSetCleanup(pad, L.TRUE);
  L.LLVMBuildResume(B, pad);
  L.LLVMPositionBuilderAtEnd(B, done);
  const sw = L.LLVMBuildSwitch(B, x!, ehpad, 1);
  L.LLVMAddCase(sw, int(i32, 3), ehpad);
  // A second function for the MSVC funclet forms (they need their own personality-free setup).
  const g = L.LLVMAddFunction(M, "funclets", L.LLVMFunctionType(vd, [], 0, L.FALSE));
  L.LLVMSetPersonalityFn(g, pers);
  const gs = L.LLVMAppendBasicBlockInContext(C, g, "start");
  const cs = L.LLVMAppendBasicBlockInContext(C, g, "cs");
  const h = L.LLVMAppendBasicBlockInContext(C, g, "h");
  const cl = L.LLVMAppendBasicBlockInContext(C, g, "cl");
  const out = L.LLVMAppendBasicBlockInContext(C, g, "out");
  L.LLVMPositionBuilderAtEnd(B, gs);
  L.LLVMBuildInvokeWithOperandBundles(B, L.LLVMGlobalGetValueType(callee), callee, [int(i32, 0)], 1, out, cs, [], 0, "");
  L.LLVMPositionBuilderAtEnd(B, cs);
  const sws = L.LLVMBuildCatchSwitch(B, undefined, cl, 1, "sw")!;
  L.LLVMAddHandler(sws, h);
  L.LLVMPositionBuilderAtEnd(B, h);
  const cp = L.LLVMBuildCatchPad(B, sws, [L.LLVMConstNull(ptr)], 1, "cp")!;
  L.LLVMBuildCatchRet(B, cp, out);
  L.LLVMPositionBuilderAtEnd(B, cl);
  const clp = L.LLVMBuildCleanupPad(B, undefined, [], 0, "clp")!;
  L.LLVMBuildCleanupRet(B, clp, undefined);
  L.LLVMPositionBuilderAtEnd(B, out);
  L.LLVMBuildRetVoid(B);
  L.LLVMPositionBuilderAtEnd(B, ehpad);
  L.LLVMBuildUnreachable(B);
  void i1;
  return M;
}

describe("instruction forms", () => {
  test("print every flag, attachment and clause", () => {
    const text = printModule(formsModule());
    for (const line of [
      "%nsw = add nsw i32 %0, 1",
      "%nuw = mul nuw i32 %nsw, %0",
      "%ex = udiv exact i32 %nuw, 4",
      "%or = or disjoint i32 %ex, %0",
      "%tr = trunc nuw i32 %or to i8",
      "%ld = load volatile i8, ptr %1, align 1, !range !0, !noundef !1",
      // The block `lp` holds the name, so the load collides (one counter per function).
      "%lp1 = load ptr, ptr %1, align 8, !nonnull !1, !align !2",
      "store atomic i8 %tr, ptr %1 release, align 1",
      "%fn = fneg double %2",
      "%fc = fcmp uno double %fn, %2",
      "%sel = select i1 %fc, i32 %0, i32 7",
      "%splat = shufflevector <4 x i32> %v, <4 x i32> poison, <4 x i32> zeroinitializer",
      '%3 = atomicrmw xchg ptr %1, i8 1 syncscope("singlethread") monotonic, align 1',
      "%4 = cmpxchg weak ptr %1, i8 0, i8 1 seq_cst monotonic, align 1",
      'fence syncscope("singlethread") acquire',
      "%g = getelementptr nusw i8, ptr %1, i32 %0",
      '%c = notail call i32 @callee(i32 noundef %0) #0 [ "deopt"(i32 %0) ]',
      "%inv = invoke i32 @callee(i32 %0)\n          to label %done unwind label %lp",
      "%pad = landingpad { ptr, i32 }\n          cleanup\n          catch ptr null\n          filter [0 x ptr] zeroinitializer",
      "switch i32 %0, label %ehpad [\n    i32 3, label %ehpad\n  ]",
      "%sw = catchswitch within none [label %h] unwind label %cl",
      "%cp = catchpad within %sw [ptr null]",
      "catchret from %cp to label %out",
      "%clp = cleanuppad within none []",
      "cleanupret from %clp unwind to caller",
      "attributes #0 = { cold }",
      "!0 = !{i8 0, i8 2}",
    ]) {
      expect(text).toContain(line);
    }
  });

  const SYSROOT = (() => {
    try {
      const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } });
      return r.exitCode === 0 ? r.stdout.toString().trim() : "";
    } catch {
      return "";
    }
  })();
  const HAVE = SYSROOT !== "" && process.platform === "darwin" && process.arch === "arm64";
  test.skipIf(!HAVE && process.env.RUST_TS_REQUIRE_PROBES !== "1")("the pinned opt parses and verifies the printed module", () => {
    const dir = mkdtempSync(join(tmpdir(), "llir-forms-"));
    try {
      const opt = join(llvmBinDir(SYSROOT, "aarch64-apple-darwin"), "opt");
      const p = Bun.spawnSync([opt, "-passes=verify", "-S", "-o", join(dir, "out.ll")], { stdin: Buffer.from(printModule(formsModule()), "latin1"), stderr: "pipe" });
      expect(p.stderr.toString().split("\n")[0]).toBe("");
      expect(p.exitCode).toBe(0);
      expect(existsSync(join(dir, "out.ll")) && readFileSync(join(dir, "out.ll"), "utf8")).toContain("cmpxchg weak");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("review llir-core-a nits", () => {
  const header = (flag: string) =>
    [`1\t%1 = LLVMContextCreate()`, `1\t%2 = LLVMModuleCreateWithNameInContext("m", %1)`, `1\t?flag %2 1 "${flag}" i 3`, `1\tLLVMContextDispose(%1)`, ""].join("\n");
  test.skipIf(!existsSync(UPSTREAM))("R1: an integer module flag no call site adds fails unless the case names its key", () => {
    expect(() => replay(parseScript(header("Bogus Flag")), UPSTREAM)).toThrow(/no rustc call site adds integer flag Bogus Flag/);
    const r = replay(parseScript(header("Bogus Flag")), UPSTREAM, { flagKeys: ["Bogus Flag"] });
    expect([...r.inferredBy.keys()]).toEqual(["LLVMRustAddModuleFlagU32 (key from the target or -Z llvm-module-flag)"]);
  });

  test.skipIf(!existsSync(UPSTREAM))("R6: a handle whose constant LLVM destroyed may name a new constant", () => {
    // `@g`'s initializer `[1 x ptr] [ptr @a]` is rebuilt when `@a` is replaced; the old array is destroyed, and its address
    // (%7) comes back for an unrelated constant.
    const script = [
      `1\t%1 = LLVMContextCreate()`,
      `1\t%2 = LLVMModuleCreateWithNameInContext("m", %1)`,
      `1\t%3 = LLVMInt8TypeInContext(%1)`,
      `1\t%4 = LLVMPointerTypeInContext(%1, 0)`,
      `1\t%5 = LLVMAddGlobal(%2, %3, "a")`,
      `1\t%6 = LLVMAddGlobal(%2, %4, "g")`,
      `1\t%7 = LLVMConstArray2(%4, [%5], 1)`,
      `1\tLLVMSetInitializer(%6, %7)`,
      `1\t%8 = LLVMAddGlobal(%2, %3, "b")`,
      `1\t%9 = LLVMConstArray2(%4, [%8], 1)`,
      `1\tLLVMReplaceAllUsesWith(%5, %8)`,
      `1\t%7 = LLVMConstInt(%3, 5, 0)`,
      `1\tLLVMContextDispose(%1)`,
      "",
    ].join("\n");
    expect(() => replay(parseScript(script), UPSTREAM)).not.toThrow();
  });

  test("R3: LLVMRustPrintModule(null) returns Failure and sets the last error, as the C++ does", () => {
    const { M } = fresh();
    expect(L.LLVMRustPrintModule(M, undefined, undefined)).toBe(L.LLVMRustResult.Failure);
    expect(L.LLVMRustGetLastError()).toBe("No such file or directory");
    expect(L.LLVMRustGetLastError()).toBeUndefined();
  });
});

describe("review llir-core-b F1: replay infers a builder position only in rustc's alloca pattern", () => {
  const script = (): string => readFileSync(join(import.meta.dir, "proof", "switch.script"), "latin1");
  /** The committed switch script with one line changed; the mutation must have applied. */
  const mutate = (from: string, to: string): string => {
    const s = script();
    expect(s.includes(from)).toBe(true);
    return s.replace(from, to);
  };
  test.skipIf(!existsSync(UPSTREAM))("the committed script replays", () => {
    expect(() => replay(parseScript(script()), UPSTREAM)).not.toThrow();
  });
  test.skipIf(!existsSync(UPSTREAM))("M1: a deleted LLVMPositionBuilderAtEnd fails replay", () => {
    const s = mutate("1\tLLVMPositionBuilderAtEnd(%34, %26)\n", "");
    expect(() => replay(parseScript(s), UPSTREAM)).toThrow(/not in rustc's alloca pattern/);
  });
  test.skipIf(!existsSync(UPSTREAM))("M2: LLVMPositionBuilderAtEnd pointed at the wrong block fails replay", () => {
    const s = mutate("1\tLLVMPositionBuilderAtEnd(%34, %26)\n", "1\tLLVMPositionBuilderAtEnd(%34, %28)\n");
    expect(() => replay(parseScript(s), UPSTREAM)).toThrow(/not in rustc's alloca pattern/);
  });
});
