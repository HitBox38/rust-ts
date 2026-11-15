// rust-ts: unit tests of the IR model's debug-info builder (lane llir-di) for what libLLVM's C API cannot drive, so
// di_builder.oracle.test.ts cannot compare: rustc's `LLVMRust*` wrappers (discriminators, methods, variant parts, template
// parameters), the builder's insertion head bit, debug records on an erased instruction, and printing details. Expected values
// are derived from the cited LLVM source by hand, in the comments.
import { describe, expect, test } from "bun:test";
import { DIBuilder } from "./di_builder.ts";
import { DICompositeType, DIExpression, DILexicalBlockFile, DILocation, DISubprogram } from "./di_nodes.ts";
import * as L from "./ffi.ts";
import type { DIFlags, DISPFlags, Metadata } from "./ffi.ts";
import type { Inst } from "./inst.ts";
import { printModule } from "./printer.ts";
import { Bool } from "./support.ts";

const F0 = 0 as DIFlags;

/** A context, module, builder, file, compile unit and a function definition with its subprogram. */
function setup() {
  const ctx = L.LLVMContextCreate();
  const M = L.LLVMModuleCreateWithNameInContext("t", ctx);
  const DIB = L.LLVMCreateDIBuilder(M)!;
  const file = L.LLVMRustDIBuilderCreateFile(DIB, "a.rs", 4, ".", 1, "None", undefined, 0, undefined, 0);
  L.LLVMRustDIBuilderCreateCompileUnit(DIB, 0x1c, file, "p", 1, false, "", 0, undefined, 0, "FullDebug", 0n, false, "None");
  const i32 = L.LLVMInt32TypeInContext(ctx);
  const fn = L.LLVMAddFunction(M, "f", L.LLVMFunctionType(L.LLVMVoidTypeInContext(ctx), [], 0, Bool.FALSE));
  const subTy = L.LLVMDIBuilderCreateSubroutineType(DIB, undefined, [undefined], 1, F0);
  const sp = L.LLVMRustDIBuilderCreateFunction(DIB, file, "f", 1, "f", 1, file, 1, subTy, 1, F0, 8 as DISPFlags, fn, L.LLVMDIBuilderGetOrCreateArray(DIB, [], 0), undefined);
  const bb = L.LLVMAppendBasicBlockInContext(ctx, fn, "start");
  return { ctx, M, DIB, file, i32, fn, sp, bb };
}

describe("llir-di", () => {
  test("LLVMRustDILocationCloneWithBaseDiscriminator encodes the base discriminator in a DILexicalBlockFile", () => {
    const { ctx, file, sp } = setup();
    const loc = L.LLVMDIBuilderCreateDebugLocation(ctx, 3, 4, sp, undefined) as DILocation;
    // The same base discriminator (0) is the location itself.
    expect(L.LLVMRustDILocationCloneWithBaseDiscriminator(loc, 0)).toBe(loc);
    // BD 1: `encodeComponent(1)` is `getPrefixEncodingFromUnsigned(1) << 1` = 2; DF and CI are 0, so nothing more is encoded.
    const c1 = L.LLVMRustDILocationCloneWithBaseDiscriminator(loc, 1) as DILocation;
    expect(c1).toBeInstanceOf(DILocation);
    expect(c1.rawScope).toBeInstanceOf(DILexicalBlockFile);
    expect((c1.rawScope as DILexicalBlockFile).discriminator).toBe(2);
    expect((c1.rawScope as DILexicalBlockFile).rawScope).toBe(sp);
    expect((c1.rawScope as DILexicalBlockFile).ops[0]).toBe(file);
    expect([c1.line, c1.column]).toEqual([3, 4]);
    // Uniqued: the same clone again is the same node.
    expect(L.LLVMRustDILocationCloneWithBaseDiscriminator(loc, 1)).toBe(c1);
    expect(L.LLVMRustDILocationCloneWithBaseDiscriminator(c1, 1)).toBe(c1);
    // BD 40 (> 0x1f): prefix ((40 & 0xfe0) << 1) | (40 & 0x1f) | 0x20 = 104, shifted: 208. Cloning a clone skips the parent
    // block file that already has a discriminator.
    const c40 = L.LLVMRustDILocationCloneWithBaseDiscriminator(c1, 40) as DILocation;
    expect((c40.rawScope as DILexicalBlockFile).discriminator).toBe(208);
    expect((c40.rawScope as DILexicalBlockFile).rawScope).toBe(sp);
    // BD 0x1000 does not fit in 12 bits: the decode check fails, no location.
    expect(L.LLVMRustDILocationCloneWithBaseDiscriminator(loc, 0x1000)).toBeUndefined();
  });

  test("a column past 16 bits is unknown (0)", () => {
    const { ctx, DIB, file, sp } = setup();
    expect((L.LLVMDIBuilderCreateDebugLocation(ctx, 1, 0x10000, sp, undefined) as DILocation).column).toBe(0);
    expect((L.LLVMDIBuilderCreateDebugLocation(ctx, 1, 0xffff, sp, undefined) as DILocation).column).toBe(0xffff);
    expect(L.LLVMDIBuilderCreateDebugLocation(ctx, 1, 0x10000, sp, undefined)).toBe(L.LLVMDIBuilderCreateDebugLocation(ctx, 1, 0, sp, undefined));
    expect(L.LLVMDIBuilderCreateLexicalBlock(DIB, sp, file, 1, 0x10000)).not.toBe(L.LLVMDIBuilderCreateLexicalBlock(DIB, sp, file, 1, 0x10000));
  });

  test("method declarations in a type with an identifier are uniqued by scope, linkage name and template parameters", () => {
    const { DIB, file } = setup();
    const ty = L.LLVMDIBuilderCreateStructType(DIB, undefined, "S", 1, file, 1, 8n, 8, F0, undefined, [], 0, 0, undefined, "uid-S", 5);
    const sub = L.LLVMDIBuilderCreateSubroutineType(DIB, undefined, [undefined], 1, F0);
    const tp = L.LLVMDIBuilderGetOrCreateArray(DIB, [], 0);
    const m1 = L.LLVMRustDIBuilderCreateMethod(DIB, ty, "m", 1, "_Zm", 3, file, 2, sub, F0, 0 as DISPFlags, tp);
    expect(m1).toBeInstanceOf(DISubprogram);
    expect((m1 as DISubprogram).distinct).toBe(false);
    // Another line and name, the same scope, linkage name and parameters: `isDeclarationOfODRMember` makes it the same node.
    expect(L.LLVMRustDIBuilderCreateMethod(DIB, ty, "other", 5, "_Zm", 3, file, 9, sub, F0, 0 as DISPFlags, tp)).toBe(m1);
    // Another linkage name is another node.
    expect(L.LLVMRustDIBuilderCreateMethod(DIB, ty, "m", 1, "_Zn", 3, file, 2, sub, F0, 0 as DISPFlags, tp)).not.toBe(m1);
    // A definition is distinct and has the unit; with MaybeFn it is the function's `!dbg`.
    const def = L.LLVMRustDIBuilderCreateMethod(DIB, ty, "m", 1, "_Zm", 3, file, 2, sub, F0, 8 as DISPFlags, tp) as DISubprogram;
    expect(def.distinct).toBe(true);
    expect(def.ops[5]).toBeDefined();
    // A scope with no identifier: the full key, so another line is another node.
    const anon = L.LLVMDIBuilderCreateStructType(DIB, undefined, "T", 1, file, 1, 8n, 8, F0, undefined, [], 0, 0, undefined, "", 0);
    const a1 = L.LLVMRustDIBuilderCreateMethod(DIB, anon, "m", 1, "_Zm", 3, file, 2, sub, F0, 0 as DISPFlags, tp);
    expect(L.LLVMRustDIBuilderCreateMethod(DIB, anon, "m", 1, "_Zm", 3, file, 3, sub, F0, 0 as DISPFlags, tp)).not.toBe(a1);
  });

  test("variant parts, variant members and template parameters print as AsmWriter writes them", () => {
    const { ctx, M, DIB, file, sp } = setup();
    const u8 = L.LLVMDIBuilderCreateBasicType(DIB, "u8", 2, 8n, 0x07, F0);
    const enumTy = L.LLVMDIBuilderCreateStructType(DIB, undefined, "Opt", 3, file, 1, 16n, 8, F0, undefined, [], 0, 0, undefined, "uid-Opt", 7);
    const tag = L.LLVMDIBuilderCreateMemberType(DIB, enumTy, "tag", 3, file, 0, 8n, 8, 0n, 64 as DIFlags /* Artificial */, u8);
    const some = L.LLVMDIBuilderCreateStructType(DIB, enumTy, "Some", 4, file, 2, 16n, 8, F0, undefined, [], 0, 0, undefined, "uid-Some", 8);
    const part = L.LLVMRustDIBuilderCreateVariantPart(DIB, enumTy, "", 0, file, 0, 16n, 8, F0, tag, L.LLVMDIBuilderGetOrCreateArray(DIB, [], 0), "uid-part", 8);
    const v = L.LLVMRustDIBuilderCreateVariantMemberType(DIB, part, "Some", 4, file, 2, 16n, 8, 0n, L.LLVMConstInt(L.LLVMInt8TypeInContext(ctx), 1n, Bool.FALSE), F0, some);
    L.LLVMRustDICompositeTypeReplaceArrays(DIB, part, L.LLVMDIBuilderGetOrCreateArray(DIB, [v], 1), undefined);
    const tp = L.LLVMRustDIBuilderCreateTemplateTypeParameter(DIB, undefined, "T", 1, u8);
    L.LLVMRustDICompositeTypeReplaceArrays(DIB, enumTy, L.LLVMDIBuilderGetOrCreateArray(DIB, [part], 1), L.LLVMDIBuilderGetOrCreateArray(DIB, [tp], 1));
    // Replacing the arrays keeps the node (re-uniqued in place), so the variant part's scope still names it.
    expect((enumTy as DICompositeType).ops[6]).toBeDefined();
    const g = L.LLVMAddGlobal(M, L.LLVMInt8TypeInContext(ctx), "g");
    const gve = L.LLVMDIBuilderCreateGlobalVariableExpression(DIB, sp, "g", 1, "", 0, file, 3, enumTy, Bool.TRUE, L.LLVMDIBuilderCreateExpression(DIB, [], 0), undefined, 0);
    L.LLVMGlobalSetMetadata(g, 0 as L.MetadataKindId, gve);
    L.LLVMDIBuilderFinalize(DIB);
    const text = printModule(M);
    const line = (start: string): string => text.split("\n").find((l) => l.includes(start))!.replace(/^!\d+ = /, "").replace(/!\d+/g, "!N");
    expect(line("DW_TAG_variant_part")).toBe('!DICompositeType(tag: DW_TAG_variant_part, scope: !N, file: !N, size: 16, align: 8, elements: !N, identifier: "uid-part", discriminator: !N)');
    expect(line('name: "Some", scope: !')).toBeDefined();
    expect(line("extraData:")).toBe('!DIDerivedType(tag: DW_TAG_member, name: "Some", scope: !N, file: !N, line: 2, baseType: !N, size: 16, align: 8, extraData: i8 1)');
    expect(line("DIFlagArtificial")).toBe('!DIDerivedType(tag: DW_TAG_member, name: "tag", scope: !N, file: !N, baseType: !N, size: 8, align: 8, flags: DIFlagArtificial)');
    expect(line("DITemplateTypeParameter")).toBe('!DITemplateTypeParameter(name: "T", type: !N)');
    expect(line('identifier: "uid-Opt"')).toBe('!DICompositeType(tag: DW_TAG_structure_type, name: "Opt", file: !N, line: 1, size: 16, align: 8, elements: !N, templateParams: !N, identifier: "uid-Opt")');
    // A global in a function's scope is retained by the function, not listed in the unit's globals.
    expect(line("DICompileUnit")).not.toContain("globals:");
    expect(line("distinct !DISubprogram")).toContain("retainedNodes: !N");
    expect(line("distinct !DICompileUnit")).toContain("nameTableKind: None");
  });

  test("rustc's DIFlags and DISPFlags conversions", () => {
    const { DIB, file } = setup();
    const sub = L.LLVMDIBuilderCreateSubroutineType(DIB, undefined, [undefined], 1, F0);
    // rustc's MainSubprogram (1 << 5) is LLVM's 1 << 8; Optimized and LocalToUnit keep their bits.
    const sp = L.LLVMRustDIBuilderCreateFunction(DIB, file, "main", 4, "", 0, file, 1, sub, 1, F0, (4 | 8 | 16 | 32) as DISPFlags, undefined, L.LLVMDIBuilderGetOrCreateArray(DIB, [], 0), undefined) as DISubprogram;
    expect(sp.spFlags).toBe(4 | 8 | 16 | 256);
    // `fromRust(LLVMDIFlags)` rejects the bits no static assertion covers (1 << 21 among them).
    expect(() => L.LLVMRustDIBuilderCreateFunction(DIB, file, "x", 1, "", 0, file, 1, sub, 1, (1 << 21) as DIFlags, 8 as DISPFlags, undefined, L.LLVMDIBuilderGetOrCreateArray(DIB, [], 0), undefined)).toThrow("bad LLVMDIFlags");
  });

  test("a DIExpression that is not valid prints its raw elements; a valid one by operation", () => {
    const { DIB } = setup();
    const e = (ops: bigint[]) => (L.LLVMDIBuilderCreateExpression(DIB, ops, ops.length) as DIExpression).write(undefined as never);
    expect(e([])).toBe("!DIExpression()");
    expect(e([0x06n])).toBe("!DIExpression(DW_OP_deref)");
    // DW_OP_bregx takes two arguments (`getSize` 3).
    expect(e([0x92n, 3n, 8n])).toBe("!DIExpression(DW_OP_bregx, 3, 8)");
    // DW_OP_stack_value must be last or before a fragment: otherwise invalid, printed raw.
    expect(e([0x9fn, 0x06n])).toBe("!DIExpression(159, 6)");
    // A fragment must be last.
    expect(e([0x1000n, 0n, 8n, 0x06n])).toBe("!DIExpression(4096, 0, 8, 6)");
    // A truncated operand.
    expect(e([0x23n])).toBe("!DIExpression(35)");
    // Uniqued by elements.
    expect(L.LLVMDIBuilderCreateExpression(DIB, [6n], 1)).toBe(L.LLVMDIBuilderCreateExpression(DIB, [6n], 1));
  });

  test("insertion head bit, builder debug locations and records on an erased instruction", () => {
    const { ctx, DIB, file, i32, sp, bb } = setup();
    const noOps = L.LLVMDIBuilderCreateExpression(DIB, [], 0);
    const v = L.LLVMDIBuilderCreateAutoVariable(DIB, sp, "x", 1, file, 1, L.LLVMDIBuilderCreateBasicType(DIB, "i32", 3, 32n, 5, F0), Bool.TRUE, F0, 0);
    const loc = (line: number): Metadata => L.LLVMDIBuilderCreateDebugLocation(ctx, line, 1, sp, undefined);
    const bx = L.LLVMCreateBuilderInContext(ctx);
    L.LLVMPositionBuilderAtEnd(bx, bb);
    L.LLVMSetCurrentDebugLocation2(bx, loc(7));
    const a1 = L.LLVMBuildAlloca(bx, i32, "a1") as Inst;
    expect(a1.debugLoc).toBe(loc(7) as never);
    // A record at the end of the block trails until the next instruction at the end adopts it.
    L.LLVMDIBuilderInsertDeclareRecordAtEnd(DIB, a1, v, noOps, loc(8), bb);
    expect(bb.trailingDbgRecords?.length).toBe(1);
    L.LLVMSetCurrentDebugLocation2(bx, undefined);
    const s1 = L.LLVMBuildStore(bx, L.LLVMConstInt(i32, 1n, Bool.FALSE), a1) as Inst;
    expect(s1.debugLoc).toBeUndefined();
    expect(s1.dbgRecords?.length).toBe(1);
    expect(bb.trailingDbgRecords).toBeUndefined();
    const s0 = L.LLVMBuildStore(bx, L.LLVMConstInt(i32, 2n, Bool.FALSE), a1) as Inst;
    void s0;
    L.LLVMDIBuilderInsertDeclareRecordAtEnd(DIB, a1, v, noOps, loc(9), bb);
    const s2 = L.LLVMBuildStore(bx, L.LLVMConstInt(i32, 3n, Bool.FALSE), a1) as Inst;
    expect(s2.dbgRecords?.length).toBe(1);
    // LLVMRustPositionBuilderAtStart: `getFirstInsertionPt` has the head bit set, so a new first instruction goes before the
    // records of the old first one and does not take them; `SetInsertPoint(BB, IP)` takes IP's debug location.
    const ab = L.LLVMCreateBuilderInContext(ctx);
    L.LLVMRustPositionBuilderAtStart(ab, bb);
    expect(L.LLVMGetCurrentDebugLocation2(ab)).toBe(loc(7));
    const a0 = L.LLVMBuildAlloca(ab, i32, "a0") as Inst;
    expect(a0.debugLoc).toBe(loc(7) as never);
    const bb2 = L.LLVMAppendBasicBlockInContext(ctx, bb.parentFn!, "b2");
    const b2 = L.LLVMCreateBuilderInContext(ctx);
    L.LLVMPositionBuilderAtEnd(b2, bb2);
    L.LLVMDIBuilderInsertDeclareRecordAtEnd(DIB, a1, v, noOps, loc(10), bb2);
    const x = L.LLVMBuildStore(b2, L.LLVMConstInt(i32, 5n, Bool.FALSE), a1) as Inst;
    expect(x.dbgRecords?.length).toBe(1);
    const xb = L.LLVMCreateBuilderInContext(ctx);
    L.LLVMRustPositionBuilderAtStart(xb, bb2);
    const y = L.LLVMBuildStore(xb, L.LLVMConstInt(i32, 6n, Bool.FALSE), a1) as Inst;
    expect(bb2.insts[0]).toBe(y);
    expect(y.dbgRecords).toBeUndefined();
    expect(x.dbgRecords?.length).toBe(1);
    // LLVMRustPositionBuilderPastAllocas: past the allocas, without the head bit, so it takes the records at that point (s1's).
    const pb = L.LLVMCreateBuilderInContext(ctx);
    L.LLVMRustPositionBuilderPastAllocas(pb, bb.parentFn!);
    expect(L.LLVMGetCurrentDebugLocation2(pb)).toBeUndefined();
    const p = L.LLVMBuildStore(pb, L.LLVMConstInt(i32, 4n, Bool.FALSE), a0) as Inst;
    expect(p.dbgRecords?.length).toBe(1);
    expect(s1.dbgRecords).toBeUndefined();
    // Erasing an instruction moves its records to the head of the next one's (`DbgMarker::removeMarker`).
    p.eraseFromParent();
    expect(s1.dbgRecords?.length).toBe(1);
    s2.eraseFromParent();
    // s2 was last: its record becomes the block's trailing record, and a terminator takes it.
    expect(bb.trailingDbgRecords?.length).toBe(1);
    L.LLVMBuildRetVoid(bx);
    expect(bb.trailingDbgRecords).toBeUndefined();
    expect((bb.insts[bb.insts.length - 1] as Inst).dbgRecords?.length).toBe(1);
  });

  test("the C API's builder is the model's DIBuilder; finalize without a unit does nothing", () => {
    const ctx = L.LLVMContextCreate();
    const M = L.LLVMModuleCreateWithNameInContext("t", ctx);
    const DIB = L.LLVMCreateDIBuilder(M)!;
    expect(DIB).toBeInstanceOf(DIBuilder);
    L.LLVMDIBuilderFinalize(DIB);
    L.LLVMDisposeDIBuilder(DIB);
    expect(printModule(M)).not.toContain("llvm.dbg.cu");
  });
});
