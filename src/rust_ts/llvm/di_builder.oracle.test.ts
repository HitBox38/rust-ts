// rust-ts: the IR model's debug-info builder against the oracle (lane llir-di). Tests only.
//
// 1. **Against libLLVM.** The same sequence of `LLVMDIBuilder*` calls goes to the oracle toolchain's own libLLVM.dylib (through
//    bun:ffi, as capi.oracle.test.ts does) and to the model (ffi.ts); the printed modules must be equal, byte for byte, metadata
//    numbering included. The sequence follows the shapes rustc's debuginfo makes (rustc_codegen_llvm debuginfo/metadata.rs and
//    mod.rs): a file with an MD5 checksum, a compile unit, nested namespaces, basic, pointer, qualified and typedef types, a
//    struct made as a stub and filled by `replaceArrays` (members of a type with an identifier, the ODR case), a union, an
//    enumeration of arbitrary-precision enumerators, an array and a vector of subranges, a static member, a global variable
//    expression, a function whose body has parameter and auto variables with `#dbg_declare` / `#dbg_value` records placed as
//    the builder goes (trailing records adopted by the next instruction, records before a terminator), builder debug locations,
//    a lexical block and a lexical block file, then `finalize` (retained nodes, enums, globals). rustc's `LLVMRust*` wrappers are
//    not in libLLVM: where the sequence uses one on the model's side, the libLLVM side makes the same `DIBuilder` call through the
//    C API (RustWrapper.cpp's bodies are one call each), and the comment says which.
// 2. **Against rustc's IR.** gdb.rs (cg-di-a's fixture) at `-Cdebuginfo=2` on x86_64-unknown-linux-gnu and on the host
//    (aarch64-apple-darwin), and at `-Cdebuginfo=1`: the model builds that IR's debug info through the wrappers rustc calls (compile unit with `nameTableKind: None`, `DISPFlagMainSubprogram`, template
//    parameters, `setSubprogram`), and the metadata graph and the bodies' debug records and locations must equal the oracle
//    file's, metadata numbering aside (each `!N` is compared by what it is, recursively).
import { describe, expect, test } from "bun:test";
import { CString, dlopen, type Pointer } from "bun:ffi";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIN } from "../../../scripts/lib/common.ts";
import * as L from "./ffi.ts";
import { Bool, type MetadataKindId } from "./support.ts";
import { DIBuilder } from "./di_builder.ts";
import type { BasicBlock, Builder, Context, DIFlags, DISPFlags, Metadata, Module, Type, Value } from "./ffi.ts";
import { printModule } from "./printer.ts";

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
  LLVMInt8TypeInContext: { args: [P], returns: P },
  LLVMInt32TypeInContext: { args: [P], returns: P },
  LLVMPointerTypeInContext: { args: [P, "u32"], returns: P },
  LLVMFunctionType: { args: [P, P, "u32", "i32"], returns: P },
  LLVMAddFunction: { args: [P, P, P], returns: P },
  LLVMAddGlobal: { args: [P, P, P], returns: P },
  LLVMSetInitializer: { args: [P, P], returns: "void" },
  LLVMGlobalSetMetadata: { args: [P, "u32", P], returns: "void" },
  LLVMGetParam: { args: [P, "u32"], returns: P },
  LLVMSetValueName2: { args: [P, P, "usize"], returns: "void" },
  LLVMConstInt: { args: [P, "u64", "i32"], returns: P },
  LLVMAppendBasicBlockInContext: { args: [P, P, P], returns: P },
  LLVMCreateBuilderInContext: { args: [P], returns: P },
  LLVMPositionBuilderAtEnd: { args: [P, P], returns: "void" },
  LLVMDisposeBuilder: { args: [P], returns: "void" },
  LLVMBuildAlloca: { args: [P, P, P], returns: P },
  LLVMSetAlignment: { args: [P, "u32"], returns: "void" },
  LLVMBuildStore: { args: [P, P, P], returns: P },
  LLVMBuildAdd: { args: [P, P, P, P], returns: P },
  LLVMBuildRet: { args: [P, P], returns: P },
  LLVMSetCurrentDebugLocation2: { args: [P, P], returns: "void" },
  LLVMPrintModuleToString: { args: [P], returns: P },
  LLVMDisposeMessage: { args: [P], returns: "void" },
  LLVMCreateDIBuilder: { args: [P], returns: P },
  LLVMDisposeDIBuilder: { args: [P], returns: "void" },
  LLVMDIBuilderFinalize: { args: [P], returns: "void" },
  LLVMDIBuilderCreateFile: { args: [P, P, "usize", P, "usize"], returns: P },
  LLVMDIBuilderCreateFileWithChecksum: { args: [P, P, "usize", P, "usize", "u32", P, "usize", P, "usize"], returns: P },
  LLVMDIBuilderCreateCompileUnit: { args: [P, "u32", P, P, "usize", "i32", P, "usize", "u32", P, "usize", "u32", "u32", "i32", "i32", P, "usize", P, "usize"], returns: P },
  LLVMDIBuilderCreateNameSpace: { args: [P, P, P, "usize", "i32"], returns: P },
  LLVMDIBuilderCreateBasicType: { args: [P, P, "usize", "u64", "u32", "u32"], returns: P },
  LLVMDIBuilderCreatePointerType: { args: [P, P, "u64", "u32", "u32", P, "usize"], returns: P },
  LLVMDIBuilderCreateQualifiedType: { args: [P, "u32", P], returns: P },
  LLVMDIBuilderCreateTypedef: { args: [P, P, P, "usize", P, "u32", P, "u32"], returns: P },
  LLVMDIBuilderCreateSubroutineType: { args: [P, P, P, "u32", "u32"], returns: P },
  LLVMDIBuilderCreateStructType: { args: [P, P, P, "usize", P, "u32", "u64", "u32", "u32", P, P, "u32", "u32", P, P, "usize"], returns: P },
  LLVMDIBuilderCreateMemberType: { args: [P, P, P, "usize", P, "u32", "u64", "u32", "u64", "u32", P], returns: P },
  LLVMDIBuilderCreateStaticMemberType: { args: [P, P, P, "usize", P, "u32", P, "u32", P, "u32"], returns: P },
  LLVMReplaceArrays: { args: [P, P, P, "u32"], returns: "void" },
  LLVMDIBuilderCreateUnionType: { args: [P, P, P, "usize", P, "u32", "u64", "u32", "u32", P, "u32", "u32", P, "usize"], returns: P },
  LLVMDIBuilderCreateEnumeratorOfArbitraryPrecision: { args: [P, P, "usize", "u64", P, "i32"], returns: P },
  LLVMDIBuilderCreateEnumerationType: { args: [P, P, P, "usize", P, "u32", "u64", "u32", P, "u32", P], returns: P },
  LLVMDIBuilderGetOrCreateSubrange: { args: [P, "i64", "i64"], returns: P },
  LLVMDIBuilderGetOrCreateArray: { args: [P, P, "usize"], returns: P },
  LLVMDIBuilderCreateArrayType: { args: [P, "u64", "u32", P, P, "u32"], returns: P },
  LLVMDIBuilderCreateVectorType: { args: [P, "u64", "u32", P, P, "u32"], returns: P },
  LLVMDIBuilderCreateExpression: { args: [P, P, "usize"], returns: P },
  LLVMDIBuilderCreateGlobalVariableExpression: { args: [P, P, P, "usize", P, "usize", P, "u32", P, "i32", P, P, "u32"], returns: P },
  LLVMDIBuilderCreateFunction: { args: [P, P, P, "usize", P, "usize", P, "u32", P, "i32", "i32", "u32", "u32", "i32"], returns: P },
  LLVMSetSubprogram: { args: [P, P], returns: "void" },
  LLVMDIBuilderCreateLexicalBlock: { args: [P, P, P, "u32", "u32"], returns: P },
  LLVMDIBuilderCreateLexicalBlockFile: { args: [P, P, P, "u32"], returns: P },
  LLVMDIBuilderCreateDebugLocation: { args: [P, "u32", "u32", P, P], returns: P },
  LLVMDIBuilderCreateParameterVariable: { args: [P, P, P, "usize", "u32", P, "u32", P, "i32", "u32"], returns: P },
  LLVMDIBuilderCreateAutoVariable: { args: [P, P, P, "usize", P, "u32", P, "i32", "u32", "u32"], returns: P },
  LLVMDIBuilderInsertDeclareRecordAtEnd: { args: [P, P, P, P, P, P], returns: P },
  LLVMDIBuilderInsertDbgValueRecordAtEnd: { args: [P, P, P, P, P, P], returns: P },
} as const;

const cstr = (s: string): Buffer => Buffer.concat([Buffer.from(s, "latin1"), Buffer.from([0])]);
const ptrs = (ps: readonly (Pointer | null)[]): BigUint64Array => new BigUint64Array(ps.map((p) => BigInt(p ?? 0)));
/** A module's text without comment lines (`; ModuleID`), which the model does not print. */
const noComments = (t: string): string =>
  t
    .split("\n")
    .filter((l) => !l.startsWith(";"))
    .join("\n")
    .trim();

/** One value on both sides: libLLVM's pointer and the model's object. */
interface Both<T> {
  r: Pointer;
  m: T;
}

// DWARF and flag values the sequence uses (Dwarf.def, DebugInfoFlags.def).
const DW_ATE_boolean = 0x02;
const DW_ATE_float = 0x04;
const DW_ATE_signed = 0x05;
const DW_ATE_unsigned = 0x07;
const DW_ATE_UTF = 0x10;
const DW_TAG_const_type = 0x26;
const FlagPrototyped = 1 << 8;
const FlagArtificial = 1 << 6;
const DW_OP_deref = 0x06n;
const DW_OP_plus_uconst = 0x23n;
const DW_OP_stack_value = 0x9fn;
const DW_OP_LLVM_fragment = 0x1000n;
const MD_dbg = 0;

describe.skipIf(!HAVE && !REQUIRE)("llir-di vs libLLVM", () => {
  // PORT: an FFI edge (PORTING §7), as capi.oracle.test.ts.
  // biome-ignore lint/suspicious/noExplicitAny: FFI edge
  const lib = (HAVE ? dlopen(DYLIB, C_API).symbols : undefined) as unknown as Record<keyof typeof C_API, (...a: any[]) => any>;
  const message = (p: Pointer): string => {
    const s = new CString(p).toString();
    lib.LLVMDisposeMessage(p);
    return s;
  };
  const b = (s: string): Buffer => Buffer.from(s, "latin1");
  const flags = (f: number): DIFlags => f as DIFlags;

  test("a module of rustc's debug-info shapes prints the same, numbering included", () => {
    const ctx: Both<Context> = { r: lib.LLVMContextCreate(), m: L.LLVMContextCreate() };
    const mod: Both<Module> = { r: lib.LLVMModuleCreateWithNameInContext(cstr("di"), ctx.r), m: L.LLVMModuleCreateWithNameInContext("di", ctx.m) };
    const dib = { r: lib.LLVMCreateDIBuilder(mod.r) as Pointer, m: L.LLVMCreateDIBuilder(mod.m)! };
    const md = <T extends Metadata>(r: Pointer, m: T): Both<T> => ({ r, m });
    const arr = (xs: readonly (Both<Metadata> | undefined)[]): Both<Metadata> =>
      md(lib.LLVMDIBuilderGetOrCreateArray(dib.r, ptrs(xs.map((x) => x?.r ?? null)), xs.length), L.LLVMDIBuilderGetOrCreateArray(dib.m, xs.map((x) => x?.m), xs.length));

    // Files. rustc: LLVMRustDIBuilderCreateFile, whose body is `createFile(Filename, Directory, CSInfo, Source)`; the C API's
    // LLVMDIBuilderCreateFileWithChecksum makes the same call (no source: length 0 is none there, a null pointer here).
    const fname = "src/lib.rs";
    const dir = "/work/dir";
    const sum = "0123456789abcdef0123456789abcdef";
    const file = md(
      lib.LLVMDIBuilderCreateFileWithChecksum(dib.r, b(fname), fname.length, b(dir), dir.length, 0 /* CSK_MD5 */, b(sum), sum.length, null, 0),
      L.LLVMRustDIBuilderCreateFile(dib.m, fname, fname.length, dir, dir.length, "MD5", sum, sum.length, undefined, 0),
    );
    const cuName = "lib.rs/@/di.cgu.0";
    const cuFile = md(lib.LLVMDIBuilderCreateFile(dib.r, b(cuName), cuName.length, b("."), 1), L.LLVMRustDIBuilderCreateFile(dib.m, cuName, cuName.length, ".", 1, "None", undefined, 0, undefined, 0));
    // Compile unit. rustc: LLVMRustDIBuilderCreateCompileUnit; the C API passes NameTableKind Default where rustc's wrapper passes
    // its argument, so the model's side passes "Default" (the oracle-IR test below checks rustc's None).
    const producer = "clang LLVM (rustc version 1.101.0-nightly)";
    lib.LLVMDIBuilderCreateCompileUnit(dib.r, 27 /* LLVMDWARFSourceLanguageRust */, cuFile.r, b(producer), producer.length, 0, null, 0, 0, null, 0, 1 /* Full */, 0, 0, 0, null, 0, null, 0);
    L.LLVMRustDIBuilderCreateCompileUnit(dib.m, 0x1c, cuFile.m, producer, producer.length, false, "", 0, undefined, 0, "FullDebug", 0n, false, "Default");

    const ns = md(lib.LLVMDIBuilderCreateNameSpace(dib.r, null, b("di"), 2, 0), L.LLVMDIBuilderCreateNameSpace(dib.m, undefined, "di", 2, Bool.FALSE));
    const inner = md(lib.LLVMDIBuilderCreateNameSpace(dib.r, ns.r, b("inner"), 5, 0), L.LLVMDIBuilderCreateNameSpace(dib.m, ns.m, "inner", 5, Bool.FALSE));
    // The same namespace again is the same node (uniqued).
    expect(L.LLVMDIBuilderCreateNameSpace(dib.m, ns.m, "inner", 5, Bool.FALSE)).toBe(inner.m);

    const basic = (name: string, size: bigint, enc: number, f = 0) =>
      md(lib.LLVMDIBuilderCreateBasicType(dib.r, b(name), name.length, size, enc, f), L.LLVMDIBuilderCreateBasicType(dib.m, name, name.length, size, enc, flags(f)));
    const i32 = basic("i32", 32n, DW_ATE_signed);
    const u8 = basic("u8", 8n, DW_ATE_unsigned);
    const unit = basic("()", 0n, DW_ATE_unsigned);
    const boolT = basic("bool", 8n, DW_ATE_boolean);
    const f64 = basic("f64", 64n, DW_ATE_float);
    const charT = basic("char", 32n, DW_ATE_UTF);
    const ptr = (to: Both<Metadata>, name: string) =>
      md(lib.LLVMDIBuilderCreatePointerType(dib.r, to.r, 64n, 64, 0, b(name), name.length), L.LLVMDIBuilderCreatePointerType(dib.m, to.m, 64n, 64, 0, name, name.length));
    const pU8 = ptr(u8, "*const u8");
    const ppU8 = ptr(pU8, "*const *const u8");
    const constU8 = md(lib.LLVMDIBuilderCreateQualifiedType(dib.r, DW_TAG_const_type, u8.r), L.LLVMDIBuilderCreateQualifiedType(dib.m, DW_TAG_const_type, u8.m));
    const myInt = md(lib.LLVMDIBuilderCreateTypedef(dib.r, i32.r, b("MyInt"), 5, file.r, 10, inner.r, 32), L.LLVMDIBuilderCreateTypedef(dib.m, i32.m, "MyInt", 5, file.m, 10, inner.m, 32));

    // A struct as metadata.rs makes one: a stub with no members (`create_DIArray(&[])`), members whose scope is the stub, then
    // LLVMRustDICompositeTypeReplaceArrays (on the libLLVM side LLVMReplaceArrays, the same `replaceArrays(T, Elements)`).
    const uid = "a1b2c3d4e5f6";
    const fooR: Pointer = lib.LLVMDIBuilderCreateStructType(dib.r, inner.r, b("Foo"), 3, file.r, 3, 64n, 32, 0, null, ptrs([]), 0, 0, null, b(uid), uid.length);
    const fooM = L.LLVMDIBuilderCreateStructType(dib.m, inner.m, "Foo", 3, file.m, 3, 64n, 32, flags(0), undefined, [], 0, 0, undefined, uid, uid.length);
    const member = (name: string, off: bigint, ty: Both<Metadata>, f = 0) =>
      md(lib.LLVMDIBuilderCreateMemberType(dib.r, fooR, b(name), name.length, file.r, 4, 32n, 32, off, f, ty.r), L.LLVMDIBuilderCreateMemberType(dib.m, fooM, name, name.length, file.m, 4, 32n, 32, off, flags(f), ty.m));
    const fa = member("a", 0n, i32);
    const fb = member("b", 32n, myInt);
    // A member of a type with an identifier is uniqued by name and scope alone (MDNodeSubsetEqualImpl<DIDerivedType>).
    expect(L.LLVMDIBuilderCreateMemberType(dib.m, fooM, "a", 1, file.m, 99, 8n, 8, 0n, flags(FlagArtificial), u8.m)).toBe(fa.m);
    const sm = md(
      lib.LLVMDIBuilderCreateStaticMemberType(dib.r, fooR, b("S"), 1, file.r, 5, i32.r, 0, lib.LLVMConstInt(lib.LLVMInt32TypeInContext(ctx.r), 7n, 0), 32),
      L.LLVMDIBuilderCreateStaticMemberType(dib.m, fooM, "S", 1, file.m, 5, i32.m, flags(0), L.LLVMConstInt(L.LLVMInt32TypeInContext(ctx.m), 7n, Bool.FALSE), 32),
    );
    const fooElems = [fa, fb, sm];
    const slot = new BigUint64Array([BigInt(fooR)]);
    lib.LLVMReplaceArrays(dib.r, slot, ptrs(fooElems.map((e) => e.r)), fooElems.length);
    L.LLVMRustDICompositeTypeReplaceArrays(dib.m, fooM, L.LLVMDIBuilderGetOrCreateArray(dib.m, fooElems.map((e) => e.m), fooElems.length), undefined);
    const foo = md(Number(slot[0]) as Pointer, fooM);
    expect(foo.r).toBe(fooR);

    const un = md(
      lib.LLVMDIBuilderCreateUnionType(dib.r, inner.r, b("U"), 1, file.r, 20, 64n, 64, 0, ptrs([fa.r]), 1, 0, b("uid-U"), 5),
      L.LLVMDIBuilderCreateUnionType(dib.m, inner.m, "U", 1, file.m, 20, 64n, 64, flags(0), [fa.m], 1, 0, "uid-U", 5),
    );

    // Enumerators of arbitrary precision (metadata/enums/mod.rs), unsigned and signed, 8 and 128 bits.
    const enumr = (name: string, bits: bigint, words: bigint[], unsigned: boolean) =>
      md(
        lib.LLVMDIBuilderCreateEnumeratorOfArbitraryPrecision(dib.r, b(name), name.length, bits, new BigUint64Array(words), unsigned ? 1 : 0),
        L.LLVMDIBuilderCreateEnumeratorOfArbitraryPrecision(dib.m, name, name.length, bits, words, unsigned ? Bool.TRUE : Bool.FALSE),
      );
    const ens = [enumr("A", 8n, [0n], true), enumr("B", 8n, [255n], true), enumr("C", 64n, [0xffffffffffffffffn], false), enumr("D", 128n, [5n, 1n], false), enumr("E", 128n, [0xfffffffffffffffen, 0xffffffffffffffffn], false)];
    // rustc: LLVMRustDIBuilderCreateEnumerationType(.., IsScoped false), `createEnumerationType(.., RunTimeLang 0, "", false)`,
    // the call the C API makes.
    const enumTy = md(
      lib.LLVMDIBuilderCreateEnumerationType(dib.r, inner.r, b("E"), 1, file.r, 30, 8n, 8, ptrs(ens.map((e) => e.r)), ens.length, u8.r),
      L.LLVMRustDIBuilderCreateEnumerationType(dib.m, inner.m, "E", 1, file.m, 30, 8n, 8, arr(ens).m, u8.m, false),
    );
    void enumTy;

    const sub4 = md(lib.LLVMDIBuilderGetOrCreateSubrange(dib.r, 0n, 4n), L.LLVMDIBuilderGetOrCreateSubrange(dib.m, 0n, 4n));
    const arrTy = md(lib.LLVMDIBuilderCreateArrayType(dib.r, 128n, 32, i32.r, ptrs([sub4.r]), 1), L.LLVMDIBuilderCreateArrayType(dib.m, 128n, 32, i32.m, [sub4.m], 1));
    // rustc: LLVMRustDICreateVectorType with no bit stride, `createVectorType(Size, Align, Ty, Subscripts, nullptr)`, the C API's call.
    const vecTy = md(lib.LLVMDIBuilderCreateVectorType(dib.r, 128n, 128, f64.r, ptrs([sub4.r]), 1), L.LLVMRustDICreateVectorType(dib.m, 128n, 128, f64.m, arr([sub4]).m, undefined));

    // A global variable with its expression, attached as `!dbg` (metadata.rs build_global_var_di_node).
    const i32T: Both<Type> = { r: lib.LLVMInt32TypeInContext(ctx.r), m: L.LLVMInt32TypeInContext(ctx.m) };
    const g: Both<Value> = { r: lib.LLVMAddGlobal(mod.r, i32T.r, cstr("G")), m: L.LLVMAddGlobal(mod.m, i32T.m, "G") };
    lib.LLVMSetInitializer(g.r, lib.LLVMConstInt(i32T.r, 3n, 0));
    L.LLVMSetInitializer(g.m, L.LLVMConstInt(i32T.m, 3n, Bool.FALSE));
    const noOps = md(lib.LLVMDIBuilderCreateExpression(dib.r, new BigUint64Array(0), 0), L.LLVMDIBuilderCreateExpression(dib.m, [], 0));
    const gve = md(
      lib.LLVMDIBuilderCreateGlobalVariableExpression(dib.r, inner.r, b("G"), 1, b("_ZN2di5inner1GE"), 15, file.r, 7, arrTy.r, 1, noOps.r, null, 32),
      L.LLVMDIBuilderCreateGlobalVariableExpression(dib.m, inner.m, "G", 1, "_ZN2di5inner1GE", 15, file.m, 7, arrTy.m, Bool.TRUE, noOps.m, undefined, 32),
    );
    lib.LLVMGlobalSetMetadata(g.r, MD_dbg, gve.r);
    L.LLVMGlobalSetMetadata(g.m, MD_dbg as MetadataKindId, gve.m);

    // A function: `fn add(a: i32, b: i32) -> i32`.
    const fnTy: Both<Type> = { r: lib.LLVMFunctionType(i32T.r, ptrs([i32T.r, i32T.r]), 2, 0), m: L.LLVMFunctionType(i32T.m, [i32T.m, i32T.m], 2, Bool.FALSE) };
    const fn: Both<Value> = { r: lib.LLVMAddFunction(mod.r, cstr("_ZN2di3add"), fnTy.r), m: L.LLVMAddFunction(mod.m, "_ZN2di3add", fnTy.m) };
    const subTy = md(
      lib.LLVMDIBuilderCreateSubroutineType(dib.r, file.r, ptrs([i32.r, i32.r, i32.r, vecTy.r, null]), 5, 0),
      L.LLVMDIBuilderCreateSubroutineType(dib.m, file.m, [i32.m, i32.m, i32.m, vecTy.m, undefined], 5, flags(0)),
    );
    // rustc: LLVMRustDIBuilderCreateFunction(.., SPFlags LocalToUnit | Definition, MaybeFn, TParam, None); the C API's
    // LLVMDIBuilderCreateFunction makes `createFunction` with no template parameters, then LLVMSetSubprogram attaches it.
    const spR: Pointer = lib.LLVMDIBuilderCreateFunction(dib.r, ns.r, b("add"), 3, b("_ZN2di3add"), 10, file.r, 12, subTy.r, 1, 1, 12, FlagPrototyped, 0);
    lib.LLVMSetSubprogram(fn.r, spR);
    const spM = L.LLVMRustDIBuilderCreateFunction(dib.m, ns.m, "add", 3, "_ZN2di3add", 10, file.m, 12, subTy.m, 12, flags(FlagPrototyped), (4 | 8) as DISPFlags, fn.m, undefined as unknown as Metadata, undefined);
    const sp = md(spR, spM);

    const bb: Both<BasicBlock> = { r: lib.LLVMAppendBasicBlockInContext(ctx.r, fn.r, cstr("start")), m: L.LLVMAppendBasicBlockInContext(ctx.m, fn.m, "start") };
    const bld: Both<Builder> = { r: lib.LLVMCreateBuilderInContext(ctx.r), m: L.LLVMCreateBuilderInContext(ctx.m) };
    lib.LLVMPositionBuilderAtEnd(bld.r, bb.r);
    L.LLVMPositionBuilderAtEnd(bld.m, bb.m);
    const params = [0, 1].map((i) => {
      const p: Both<Value> = { r: lib.LLVMGetParam(fn.r, i), m: L.LLVMGetParam(fn.m, i) };
      const n = i === 0 ? "a" : "b";
      lib.LLVMSetValueName2(p.r, b(n), 1);
      L.LLVMSetValueName2(p.m, n, 1);
      return p;
    });
    // Alignments are set on both sides: the model leaves a default alignment unprinted (inst.ts header; the parser restores it).
    const aligned = (v: Both<Value>): Both<Value> => {
      lib.LLVMSetAlignment(v.r, 4);
      L.LLVMSetAlignment(v.m, 4);
      return v;
    };
    const alloca = (name: string): Both<Value> => aligned({ r: lib.LLVMBuildAlloca(bld.r, i32T.r, cstr(name)), m: L.LLVMBuildAlloca(bld.m, i32T.m, name) });
    const spills = [alloca("a.dbg.spill"), alloca("b.dbg.spill")];
    const loc = (line: number, col: number, scope: Both<Metadata>, at?: Both<Metadata>) =>
      md(lib.LLVMDIBuilderCreateDebugLocation(ctx.r, line, col, scope.r, at?.r ?? null), L.LLVMDIBuilderCreateDebugLocation(ctx.m, line, col, scope.m, at?.m));
    const expr = (ops: bigint[]) => md(lib.LLVMDIBuilderCreateExpression(dib.r, new BigUint64Array(ops), ops.length), L.LLVMDIBuilderCreateExpression(dib.m, ops, ops.length));
    const vars = params.map((_, i) => {
      const n = i === 0 ? "a" : "b";
      return md(
        lib.LLVMDIBuilderCreateParameterVariable(dib.r, sp.r, b(n), 1, i + 1, file.r, 12, i32.r, 1, 0),
        L.LLVMDIBuilderCreateParameterVariable(dib.m, sp.m, n, 1, i + 1, file.m, 12, i32.m, Bool.TRUE, flags(0)),
      );
    });
    for (let i = 0; i < 2; i++) {
      aligned({ r: lib.LLVMBuildStore(bld.r, params[i]!.r, spills[i]!.r), m: L.LLVMBuildStore(bld.m, params[i]!.m, spills[i]!.m) });
      // At the end of a block with no terminator: the record trails, and the next instruction adopts it.
      const l = loc(12, 8 + 10 * i, sp);
      lib.LLVMDIBuilderInsertDeclareRecordAtEnd(dib.r, spills[i]!.r, vars[i]!.r, noOps.r, l.r, bb.r);
      L.LLVMDIBuilderInsertDeclareRecordAtEnd(dib.m, spills[i]!.m, vars[i]!.m, noOps.m, l.m, bb.m);
    }
    const lb = md(lib.LLVMDIBuilderCreateLexicalBlock(dib.r, sp.r, file.r, 13, 5), L.LLVMDIBuilderCreateLexicalBlock(dib.m, sp.m, file.m, 13, 5));
    const lbf = md(lib.LLVMDIBuilderCreateLexicalBlockFile(dib.r, lb.r, file.r, 2), L.LLVMDIBuilderCreateLexicalBlockFile(dib.m, lb.m, file.m, 2));
    const cVar = md(
      lib.LLVMDIBuilderCreateAutoVariable(dib.r, lb.r, b("c"), 1, file.r, 13, foo.r, 1, 0, 32),
      L.LLVMDIBuilderCreateAutoVariable(dib.m, lb.m, "c", 1, file.m, 13, foo.m, Bool.TRUE, flags(0), 32),
    );
    const l13 = loc(13, 13, lb);
    lib.LLVMSetCurrentDebugLocation2(bld.r, l13.r);
    L.LLVMSetCurrentDebugLocation2(bld.m, l13.m);
    const sum2: Both<Value> = { r: lib.LLVMBuildAdd(bld.r, params[0]!.r, params[1]!.r, cstr("c")), m: L.LLVMBuildAdd(bld.m, params[0]!.m, params[1]!.m, "c") };
    for (const ops of [[DW_OP_LLVM_fragment, 0n, 32n], [DW_OP_plus_uconst, 8n, DW_OP_deref], [DW_OP_stack_value], [0x10n, 7n, DW_OP_stack_value, DW_OP_LLVM_fragment, 32n, 32n]]) {
      const e = expr(ops);
      lib.LLVMDIBuilderInsertDbgValueRecordAtEnd(dib.r, sum2.r, cVar.r, e.r, l13.r, bb.r);
      L.LLVMDIBuilderInsertDbgValueRecordAtEnd(dib.m, sum2.m, cVar.m, e.m, l13.m, bb.m);
    }
    const lInl = loc(3, 1, lbf, loc(14, 2, sp));
    lib.LLVMSetCurrentDebugLocation2(bld.r, lInl.r);
    L.LLVMSetCurrentDebugLocation2(bld.m, lInl.m);
    aligned({ r: lib.LLVMBuildStore(bld.r, sum2.r, spills[0]!.r), m: L.LLVMBuildStore(bld.m, sum2.m, spills[0]!.m) });
    const lRet = loc(15, 2, sp);
    lib.LLVMSetCurrentDebugLocation2(bld.r, lRet.r);
    L.LLVMSetCurrentDebugLocation2(bld.m, lRet.m);
    lib.LLVMBuildRet(bld.r, sum2.r);
    L.LLVMBuildRet(bld.m, sum2.m);
    // After the terminator: a declare goes before it.
    lib.LLVMDIBuilderInsertDeclareRecordAtEnd(dib.r, spills[1]!.r, cVar.r, noOps.r, l13.r, bb.r);
    L.LLVMDIBuilderInsertDeclareRecordAtEnd(dib.m, spills[1]!.m, cVar.m, noOps.m, l13.m, bb.m);
    expect(L.LLVMGetCurrentDebugLocation2(bld.m)).toBe(lRet.m);
    lib.LLVMSetCurrentDebugLocation2(bld.r, null);
    L.LLVMSetCurrentDebugLocation2(bld.m, undefined);
    expect(L.LLVMGetCurrentDebugLocation2(bld.m)).toBeUndefined();
    lib.LLVMDisposeBuilder(bld.r);
    L.LLVMDisposeBuilder(bld.m);

    lib.LLVMDIBuilderFinalize(dib.r);
    L.LLVMDIBuilderFinalize(dib.m);
    lib.LLVMDisposeDIBuilder(dib.r);
    L.LLVMDisposeDIBuilder(dib.m);
    void ppU8;
    void constU8;
    void unit;
    void boolT;
    void charT;
    void un;

    const want = noComments(message(lib.LLVMPrintModuleToString(mod.r)));
    const got = noComments(printModule(mod.m));
    expect(got).toBe(want);
    lib.LLVMContextDispose(ctx.r);
  });
});

// ---- 2: rustc's IR ----------------------------------------------------------------------------------------------------------

/** cg-di-a's fixtures (gdb.rs and its x86_64 `-Cdebuginfo=2` IR) and this lane's (the same gdb.rs on the host, and at
 *  `-Cdebuginfo=1`), made as di_oracle/README.md says. */
const CG_FIXTURES = join(import.meta.dir, "..", "..", "rustc_codegen_llvm", "debuginfo", "di_oracle");
const FIXTURES = join(import.meta.dir, "di_oracle");
const GDB_CASES = [
  { ll: join(CG_FIXTURES, "x86_64-unknown-linux-gnu.gdb-g.ll"), target: "x86_64-unknown-linux-gnu", level: 2, ours: false },
  { ll: join(FIXTURES, "aarch64-apple-darwin.gdb-g.ll"), target: "aarch64-apple-darwin", level: 2, ours: true },
  { ll: join(FIXTURES, "x86_64-unknown-linux-gnu.gdb-g1.ll"), target: "x86_64-unknown-linux-gnu", level: 1, ours: true },
] as const;

/** `!N = text` lines of a module, and a function from a metadata reference to its content with every `!M` in it replaced by
 *  M's content, recursively: two modules' metadata equal up to numbering give equal contents. */
function metadataResolver(text: string): (s: string) => string {
  const defs = new Map<string, string>();
  for (const l of text.split("\n")) {
    const m = /^!(\d+) = (.*)$/.exec(l);
    if (m) defs.set(m[1]!, m[2]!);
  }
  const memo = new Map<string, string>();
  const resolve = (s: string, depth: number): string =>
    s.replace(/!(\d+)\b/g, (_, n: string) => {
      if (depth > 50) return "!<deep>";
      let r = memo.get(n);
      if (r === undefined) {
        const d = defs.get(n);
        if (d === undefined) return `!<undefined ${n}>`;
        r = `{${resolve(d, depth + 1)}}`;
        memo.set(n, r);
      }
      return r;
    });
  return (s) => resolve(s, 0);
}

/** The debug-info view of a module: each function's `!dbg` attachment (definitions without one, such as the C `main` wrapper the
 *  model's side does not build, are left out), and each body line holding a debug record or a `!dbg`
 *  location, metadata resolved; the `!llvm.dbg.cu` operands; the set of all metadata nodes reachable from them. `!guid`
 *  attachments (which the oracle's pipeline adds) are dropped. */
function debugView(text: string): string[] {
  const resolve = metadataResolver(text);
  const out: string[] = [];
  for (const l of text.split("\n")) {
    const line = l.replace(/ !guid !\d+/, "");
    if (line.startsWith("define ") && line.includes(" !dbg !")) out.push(`define ${/@(\S+?)\(/.exec(line)![1]} ${resolve(/ !dbg !\d+/.exec(line)![0])}`);
    else if (line.startsWith("    #dbg_") || line.includes(", !dbg !")) out.push(resolve(line));
    else if (line.startsWith("!llvm.dbg.cu")) out.push(resolve(line));
  }
  return out;
}

/** gdb.rs's module as rustc's debuginfo builds it at `-Cdebuginfo=<level>` (Full or Limited), through the model's wrappers. */
function buildGdb(level: 1 | 2): Module {
  const ctx = L.LLVMContextCreate();
  const M = L.LLVMModuleCreateWithNameInContext("gdb.59a7e0cc6e7fded4-cgu.0", ctx);
  const DIB = L.LLVMCreateDIBuilder(M)!;
  expect(DIB).toBeInstanceOf(DIBuilder);
  // metadata.rs build_compile_unit_di_node: the unit's file (no checksum), then the unit.
  const cuName = "gdb.rs/@/gdb.59a7e0cc6e7fded4-cgu.0";
  const cuFile = L.LLVMRustDIBuilderCreateFile(DIB, cuName, cuName.length, ".", 1, "None", "", 0, undefined, 0);
  const producer = "clang LLVM (rustc version 1.101.0-nightly (6f5da406b 2026-10-10))";
  L.LLVMRustDIBuilderCreateCompileUnit(DIB, 0x1c, cuFile, producer, producer.length, false, "", 0, "", 0, "FullDebug", 0n, false, "None");
  // file_metadata: the source file with its MD5.
  const file = L.LLVMRustDIBuilderCreateFile(DIB, "gdb.rs", 6, ".", 1, "MD5", "56dce56332d59085aa6f4c717bb36acb", 32, undefined, 0);
  const ns = L.LLVMDIBuilderCreateNameSpace(DIB, undefined, "gdb", 3, Bool.FALSE);
  const i64 = L.LLVMInt64TypeInContext(ctx);
  const i8 = L.LLVMInt8TypeInContext(ctx);
  const ptrT = L.LLVMPointerTypeInContext(ctx, 0);
  const start = L.LLVMAddFunction(M, "_RINvCs7HeBztP8FDI_3gdb5startuEB2_", L.LLVMFunctionType(i64, [ptrT, i64, ptrT, i8], 4, Bool.FALSE));
  const noTParams = L.LLVMDIBuilderGetOrCreateArray(DIB, [], 0);
  let sp: Metadata;
  let mainTy: Metadata;
  const entry = L.LLVMAppendBasicBlockInContext(ctx, start, "start");
  const bx = L.LLVMCreateBuilderInContext(ctx);
  L.LLVMPositionBuilderAtEnd(bx, entry);
  const names = ["_main", "_argc", "_argv", "_sigpipe"];
  const args = names.map((n, i) => {
    const a = L.LLVMGetParam(start, i);
    L.LLVMSetValueName2(a, n, n.length);
    return a;
  });
  if (level === 1) {
    // Limited: mod.rs dbg_scope_fn gives an empty signature (`create_DIArray(DIB(cx), &[])`) and no template parameters, and no
    // variable is described.
    const emptyTy = L.LLVMDIBuilderCreateSubroutineType(DIB, undefined, [], 0, 0 as DIFlags);
    sp = L.LLVMRustDIBuilderCreateFunction(DIB, ns, "start<()>", 9, "_RINvCs7HeBztP8FDI_3gdb5startuEB2_", 34, file, 17, emptyTy, 17, FlagPrototyped as DIFlags, (4 | 8) as DISPFlags, start, noTParams, undefined);
    mainTy = emptyTy;
  } else {
    const basic = (n: string, size: bigint, enc: number) => L.LLVMDIBuilderCreateBasicType(DIB, n, n.length, size, enc, 0 as DIFlags);
    const isize = basic("isize", 64n, DW_ATE_signed);
    const u8 = basic("u8", 8n, DW_ATE_unsigned);
    const unitT = basic("()", 0n, DW_ATE_unsigned);
    const fnUnit = L.LLVMDIBuilderCreateSubroutineType(DIB, undefined, [undefined], 1, 0 as DIFlags);
    const pFn = L.LLVMDIBuilderCreatePointerType(DIB, fnUnit, 64n, 64, 0, "fn()", 4);
    const pU8 = L.LLVMDIBuilderCreatePointerType(DIB, u8, 64n, 64, 0, "*const u8", 9);
    const ppU8 = L.LLVMDIBuilderCreatePointerType(DIB, pU8, 64n, 64, 0, "*const *const u8", 16);
    const startTy = L.LLVMDIBuilderCreateSubroutineType(DIB, undefined, [isize, pFn, isize, ppU8, u8], 5, 0 as DIFlags);
    const tparam = L.LLVMRustDIBuilderCreateTemplateTypeParameter(DIB, undefined, "T", 1, unitT);
    // mod.rs dbg_scope_fn: LocalToUnit | Definition, Prototyped, the template parameters, MaybeFn.
    sp = L.LLVMRustDIBuilderCreateFunction(DIB, ns, "start<()>", 9, "_RINvCs7HeBztP8FDI_3gdb5startuEB2_", 34, file, 17, startTy, 17, FlagPrototyped as DIFlags, (4 | 8) as DISPFlags, start, L.LLVMDIBuilderGetOrCreateArray(DIB, [tparam], 1), undefined);
    mainTy = fnUnit;
    // Per argument (rustc_codegen_ssa debuginfo spill_operand_to_stack): an alloca from a fresh builder at the start of the
    // entry block (builder.rs `alloca`: LLVMRustPositionBuilderAtStart, so each new one goes first), a store, and a
    // `#dbg_declare` at the end of the block, which the next instruction adopts.
    const diTypes = [pFn, isize, ppU8, u8];
    const cols = [13, 31, 45, 70];
    const noOps = L.LLVMDIBuilderCreateExpression(DIB, [], 0);
    for (let i = 0; i < 4; i++) {
      const ab = L.LLVMCreateBuilderInContext(ctx);
      L.LLVMRustPositionBuilderAtStart(ab, entry);
      const al = L.LLVMBuildAlloca(ab, L.LLVMArrayType2(i8, i === 3 ? 1n : 8n), `${names[i]}.dbg.spill`);
      L.LLVMSetAlignment(al, i === 3 ? 1 : 8);
      const st = L.LLVMBuildStore(bx, args[i]!, al);
      L.LLVMSetAlignment(st, i === 3 ? 1 : 8);
      const v = L.LLVMDIBuilderCreateParameterVariable(DIB, sp, names[i]!, names[i]!.length, i + 1, file, 17, diTypes[i]!, Bool.TRUE, 0 as DIFlags);
      const loc = L.LLVMDIBuilderCreateDebugLocation(ctx, 17, cols[i]!, sp, undefined);
      L.LLVMDIBuilderInsertDeclareRecordAtEnd(DIB, al, v, noOps, loc, entry);
    }
  }
  L.LLVMSetCurrentDebugLocation2(bx, L.LLVMDIBuilderCreateDebugLocation(ctx, 19, 2, sp, undefined));
  L.LLVMBuildRet(bx, L.LLVMConstInt(i64, 0n, Bool.FALSE));
  // `main`: MainSubprogram (rustc's 1 << 5, LLVM's 1 << 8), no template parameters (an empty array).
  const main = L.LLVMAddFunction(M, "_RNvCs7HeBztP8FDI_3gdb4main", L.LLVMFunctionType(L.LLVMVoidTypeInContext(ctx), [], 0, Bool.FALSE));
  const mainSp = L.LLVMRustDIBuilderCreateFunction(DIB, ns, "main", 4, "_RNvCs7HeBztP8FDI_3gdb4main", 27, file, 21, mainTy, 21, FlagPrototyped as DIFlags, (4 | 8 | 32) as DISPFlags, main, noTParams, undefined);
  const mb = L.LLVMCreateBuilderInContext(ctx);
  L.LLVMPositionBuilderAtEnd(mb, L.LLVMAppendBasicBlockInContext(ctx, main, "start"));
  L.LLVMSetCurrentDebugLocation2(mb, L.LLVMDIBuilderCreateDebugLocation(ctx, 21, 13, mainSp, undefined));
  L.LLVMBuildRetVoid(mb);
  L.LLVMDIBuilderFinalize(DIB);
  L.LLVMDisposeDIBuilder(DIB);
  return M;
}

/** The specialized nodes of a module, numbers resolved, sorted. */
function diNodes(text: string): string[] {
  const r = metadataResolver(text);
  return text
    .split("\n")
    .filter((l) => /^!\d+ = (distinct )?!DI/.test(l))
    .map((l) => r(l.replace(/^!\d+ = /, "")))
    .sort();
}

describe.skipIf(!existsSync(GDB_CASES[0].ll))("llir-di vs rustc's -g IR", () => {
  for (const c of GDB_CASES) {
    test(`gdb.rs, ${c.target}, -Cdebuginfo=${c.level}: the debug info rustc's wrappers make equals the oracle's`, () => {
      const oracle = readFileSync(c.ll, "latin1");
      const got = printModule(buildGdb(c.level));
      const wantView = debugView(oracle);
      expect(debugView(got)).toEqual(wantView);
      // The view is not empty: the two definitions, 4 records at Full (none at Limited), the unit list.
      expect(wantView.filter((l) => l.startsWith("define")).length).toBe(2);
      expect(wantView.filter((l) => l.startsWith("    #dbg_declare")).length).toBe(c.level === 2 ? 4 : 0);
      // Every specialized node, as the oracle prints it, numbers resolved.
      expect(diNodes(got)).toEqual(diNodes(oracle));
    });
  }

  // With the pinned toolchain, this lane's fixtures are re-made (from inside di_oracle/, as the README says) and must not change.
  test.skipIf(!HAVE && !REQUIRE)("this lane's fixtures are the pinned rustc's output", () => {
    const tmp = mkdtempSync(join(tmpdir(), "llir-di-"));
    try {
      for (const c of GDB_CASES.filter((c) => c.ours)) {
        const out = join(tmp, "out.ll");
        const argv = ["rustc", `+${PIN.toolchain}`, "--edition=2021", "-Copt-level=0", "-Cno-prepopulate-passes", "-Ccodegen-units=1", "--emit=llvm-ir", `--remap-path-prefix=${FIXTURES}=.`, "--crate-type", "bin", "--target", c.target, `-Cdebuginfo=${c.level}`, "-o", out, "gdb.rs"];
        const r = Bun.spawnSync(argv, { cwd: FIXTURES, env: { ...process.env, RUSTC_ICE: "0", RUSTUP_AUTO_INSTALL: "0" } });
        expect(r.exitCode).toBe(0);
        expect(readFileSync(out, "latin1")).toBe(readFileSync(c.ll, "latin1"));
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
