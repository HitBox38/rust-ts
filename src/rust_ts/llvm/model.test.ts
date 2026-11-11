// rust-ts: unit tests of the IR model's own rules (lane llir-core-a), through ffi.ts as the ported codegen calls it. The
// differential tests against libLLVM are capi.oracle.test.ts; the proof against rustc's IR is proof.oracle.test.ts.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Unported } from "../../std/panic.ts";
import * as L from "./ffi.ts";
import { ConstantExpr, GlobalVariable } from "./ir.ts";
import { printModule, printValueToString } from "./printer.ts";

function fresh() {
  const C = L.LLVMContextCreate();
  const M = L.LLVMModuleCreateWithNameInContext("t", C);
  return { C, M, i8: L.LLVMInt8TypeInContext(C), i32: L.LLVMInt32TypeInContext(C), i64: L.LLVMInt64TypeInContext(C), ptr: L.LLVMPointerTypeInContext(C, 0) };
}

describe("types and constants are uniqued", () => {
  test("types", () => {
    const { C, i8 } = fresh();
    expect(L.LLVMInt8TypeInContext(C)).toBe(i8);
    expect(L.LLVMArrayType2(i8, 3)).toBe(L.LLVMArrayType2(i8, 3));
    expect(L.LLVMStructTypeInContext(C, [i8, i8], 2, L.FALSE)).toBe(L.LLVMStructTypeInContext(C, [i8, i8], 2, L.FALSE));
    expect(L.LLVMStructTypeInContext(C, [i8], 1, L.TRUE)).not.toBe(L.LLVMStructTypeInContext(C, [i8], 1, L.FALSE));
    // Identified structs are distinct even with one name (the second is renamed).
    expect(L.LLVMStructCreateNamed(C, "T")).not.toBe(L.LLVMStructCreateNamed(C, "T"));
  });
  test("constants", () => {
    const { C, i8, i64 } = fresh();
    expect(L.LLVMConstInt(i64, 5n, L.FALSE)).toBe(L.LLVMConstInt(i64, 5n, L.FALSE));
    // Truncation to the width makes 0x105 and 5 the same i8.
    expect(L.LLVMConstInt(i8, 0x105n, L.FALSE)).toBe(L.LLVMConstInt(i8, 5n, L.FALSE));
    const s1 = L.LLVMConstStringInContext2(C, "ab", 2, L.TRUE);
    expect(L.LLVMConstStringInContext2(C, new Uint8Array([97, 98]), 2, L.TRUE)).toBe(s1);
    expect(L.LLVMCreateStringAttribute(C, "k", 1, "v", 1)).toBe(L.LLVMCreateStringAttribute(C, "k", 1, "v", 1));
  });
});

describe("read-back", () => {
  test("ints and linkage", () => {
    const { M, i64, C } = fresh();
    const big = L.LLVMConstInt(L.LLVMIntTypeInContext(C, 128), 0xffffffffffffffffn, L.TRUE) as L.ConstantInt;
    const hi = { value: 0n };
    const lo = { value: 0n };
    expect(L.LLVMRustConstInt128Get(big, false, hi, lo)).toBe(true);
    expect([hi.value, lo.value]).toEqual([0xffffffffffffffffn, 0xffffffffffffffffn]);
    const z = { value: 0n };
    expect(L.LLVMRustConstIntGetZExtValue(L.LLVMConstInt(i64, 7n, L.FALSE) as L.ConstantInt, z)).toBe(true);
    expect(z.value).toBe(7n);
    const g = L.LLVMAddGlobal(M, i64, "g");
    expect(L.LLVMGetLinkage(g).to_rust()).toBe("ExternalLinkage");
    L.LLVMSetLinkage(g, "LinkerPrivateLinkage");
    expect(L.LLVMGetLinkage(g).to_rust()).toBe("PrivateLinkage");
    expect(L.LLVMIsDeclaration(g).is_true()).toBe(true);
    L.LLVMSetInitializer(g, L.LLVMConstInt(i64, 1n, L.FALSE));
    expect(L.LLVMIsDeclaration(g).is_true()).toBe(false);
    expect(L.LLVMGetNamedGlobal(M, "g")).toBe(g);
    expect(L.LLVMRustGetOrInsertGlobal(M, "g", 1, i64)).toBe(g);
  });
  test("get-or-insert keeps a declaration of another type", () => {
    const { M, C, i32 } = fresh();
    const f1 = L.LLVMGetOrInsertFunction(M, "f", 1, L.LLVMFunctionType(i32, [], 0, L.FALSE));
    expect(L.LLVMGetOrInsertFunction(M, "f", 1, L.LLVMFunctionType(L.LLVMVoidTypeInContext(C), [], 0, L.FALSE))).toBe(f1);
  });
});

describe("replaceAllUsesWith", () => {
  test("a global replaced inside a constant expression and an initializer", () => {
    const { M, i8, i64, ptr } = fresh();
    const old = L.LLVMAddGlobal(M, i8, "old");
    const gep = L.LLVMConstInBoundsGEP2(i8, old, [L.LLVMConstInt(i64, 4n, L.FALSE)], 1);
    const user = L.LLVMAddGlobal(M, ptr, "user");
    L.LLVMSetInitializer(user, gep);
    const direct = L.LLVMAddGlobal(M, ptr, "direct");
    L.LLVMSetInitializer(direct, old);
    const neu = L.LLVMAddGlobal(M, i8, "new");
    L.LLVMReplaceAllUsesWith(old, neu);
    L.LLVMDeleteGlobal(old);
    // The expression was updated in place (LLVM keeps its identity), and the direct use now names the new global.
    expect(L.LLVMGetInitializer(user)).toBe(gep);
    expect(printValueToString(gep)).toBe("ptr getelementptr inbounds (i8, ptr @new, i64 4)");
    expect(L.LLVMGetInitializer(direct)).toBe(neu);
    expect(printModule(M)).not.toContain("@old");
  });
});

describe("printer", () => {
  test("dso_local only where it is not implied; names quoted when needed", () => {
    const { M, i8 } = fresh();
    const a = L.LLVMAddGlobal(M, i8, "a");
    L.LLVMRustSetDSOLocal(a, true);
    const b = L.LLVMAddGlobal(M, i8, "0b c");
    L.LLVMSetLinkage(b, "InternalLinkage");
    L.LLVMSetInitializer(b, L.LLVMConstInt(i8, 1n, L.FALSE));
    expect(printValueToString(a)).toBe("@a = external dso_local global i8");
    expect(printValueToString(b)).toBe('@"0b c" = internal global i8 1');
  });
  test("an unnamed global is numbered", () => {
    const { M, i8 } = fresh();
    const g = L.LLVMAddGlobal(M, i8, "");
    L.LLVMSetInitializer(g, L.LLVMConstInt(i8, 0n, L.FALSE));
    expect(printModule(M)).toContain("@0 = global i8 0");
  });
  test("folded and unfolded constant expressions", () => {
    const { i64, ptr, M, i8 } = fresh();
    expect(printValueToString(L.LLVMConstIntToPtr(L.LLVMConstInt(i64, 0n, L.FALSE), ptr))).toBe("ptr null");
    const g = L.LLVMAddGlobal(M, i8, "g");
    const e = L.LLVMConstPtrToInt(g, i64);
    expect(e).toBeInstanceOf(ConstantExpr);
    expect(L.LLVMIsAConstantExpr(e)).toBe(e);
    expect(L.LLVMGetConstOpcode(e)).toBe("PtrToInt");
    expect(g).toBeInstanceOf(GlobalVariable);
  });
});

describe("stops", () => {
  test("a function body is llir-core-b's", () => {
    const { C } = fresh();
    expect(() => L.LLVMCreateBuilderInContext(C)).toThrow(Unported);
  });
  test("an unsourced fold stops instead of guessing", () => {
    const { C, i64, ptr, M, i8 } = fresh();
    const g = L.LLVMAddGlobal(M, i8, "g");
    // ptrtoint of inttoptr: a cast of a cast needs CastInst::isEliminableCastPair, which the model does not have.
    const ip = L.LLVMConstIntToPtr(L.LLVMConstInt(i64, 8n, L.FALSE), ptr);
    expect(() => L.LLVMConstPtrToInt(ip, i64)).toThrow(Unported);
    expect(() => L.LLVMConstReal(L.LLVMHalfTypeInContext(C), 1.5)).toThrow(Unported);
    expect(g).toBeDefined();
  });
});

test("trace: the port's side of the call trace (scripts/lib/llvm-trace.ts's format)", () => {
  const dir = mkdtempSync(join(tmpdir(), "llir-trace-"));
  const file = join(dir, "t.trace");
  try {
    const script = `import * as L from ${JSON.stringify(join(import.meta.dir, "ffi.ts"))};
const C = L.LLVMContextCreate(); const M = L.LLVMModuleCreateWithNameInContext("m", C);
const t = L.LLVMInt32TypeInContext(C); L.LLVMAddGlobal(M, t, "g"); L.LLVMAddGlobal(M, t, "g");
const f = L.LLVMAddFunction(M, "f", L.LLVMFunctionType(t, [t, t], 2, L.FALSE));
L.LLVMSetValueName2(L.LLVMGetParam(f, 0), "x", 1); L.LLVMSetValueName2(L.LLVMGetParam(f, 1), "x", 1);`;
    const p = Bun.spawnSync(["bun", "-e", script], { env: { ...process.env, RUST_TS_LLVM_TRACE: file } });
    expect(p.exitCode).toBe(0);
    expect(readFileSync(file, "latin1")).toBe(
      ["LLVMContextCreate", "LLVMModuleCreateWithNameInContext", "LLVMInt32TypeInContext", "LLVMAddGlobal\tg\tg", "LLVMAddGlobal\tg\tg.1", "LLVMFunctionType", "LLVMAddFunction", "LLVMGetParam", "LLVMSetValueName2\tx\tx", "LLVMGetParam", "LLVMSetValueName2\tx\tx1", ""].join("\n"),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
