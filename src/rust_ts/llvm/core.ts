// rust-ts: the C API functions of llir-core-a's half of the model (lane llir-core-a): contexts, modules, types, constants,
// globals, functions and their parameters, attributes, value names, module flags and named metadata, and the printer's
// entry points. Each is the LLVM-C function (`// llvm:`, llvm/lib/IR/Core.cpp and Comdat.cpp) or rustc's C++ wrapper
// (`// rustc:`, compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp) of the same name, over the model in ir.ts. ffi_gen.ts binds
// every function exported here into ffi.ts; ffi.ts's signatures are the contract these must satisfy (tsc checks it).
import { writeFileSync } from "node:fs";
import { unported } from "../../std/panic.ts";
import { module_text } from "./tools.ts";
import {
  type AsmDialect,
  AttributeKind,
  type CodeModel,
  CallConv_discriminant,
  DLLStorageClass,
  Linkage,
  Linkage_discriminant,
  LLVMRustResult,
  type MemoryEffects,
  type ModuleFlagMergeBehavior,
  ModuleFlagMergeBehavior_discriminant,
  Opcode_discriminant,
  type ThreadLocalMode,
  type TypeKind,
  TypeKind_discriminant,
  type UnnamedAddr,
  Visibility,
  Visibility_discriminant,
} from "./ffi_types.ts";
import {
  Argument,
  ArrayType,
  addAttributesAtIndex,
  ATTR_KIND_ENUM,
  Attribute,
  bstrOfBytes,
  bstrOfString,
  Comdat,
  Constant,
  ConstantExpr,
  ConstantInt,
  Context,
  FUNCTION_INDEX,
  Function,
  FunctionType,
  getAggregateElement,
  getBitCast,
  getConstantArray,
  getConstantDataSequential,
  getConstantFPOfDouble,
  getConstantInt,
  getConstantIntU64,
  getConstantStruct,
  getGetElementPtr,
  getInlineAsm,
  getIntToPtr,
  getNullValue,
  getPointerCast,
  getPoison,
  getPtrToInt,
  getUndef,
  GlobalAlias,
  GlobalObject,
  GlobalValue,
  GlobalVariable,
  IntegerType,
  type LinkageTypes,
  MDNode,
  MDString,
  type Metadata,
  MetadataAsValue,
  Module,
  PointerType,
  StructType,
  stringOfBstr,
  type Type,
  type Value,
  ValueAsMetadata,
  VectorType,
} from "./ir.ts";
import { type BasicBlock, Inst } from "./inst.ts";
import { printEscapedString, printModule, printTypeToString, printValueToString } from "./printer.ts";
import { Bool, type MetadataKindId, type MutRef, type PtrLenStr, RawEnum, type RustString } from "./support.ts";

// ---- argument conversions ----------------------------------------------------------------------------------------------

/** A PTR_LEN_STR argument's first `len` bytes, as a byte string. `StringRef(nullptr, 0)` is the empty string; a null pointer
 * with a length is undefined behaviour in C, here an error. */
function bytesArg(s: PtrLenStr | undefined, len: number): string {
  if (s === undefined) {
    if (len === 0) return "";
    throw new Error(`llvm: a null pointer with length ${len}`);
  }
  if (typeof s === "string") {
    const b = bstrOfString(s);
    return len < b.length ? b.slice(0, len) : b;
  }
  return bstrOfBytes(s.subarray(0, len));
}
/** A `*const c_char` (NUL-terminated) argument, as a byte string. What LLVM makes of null depends on the type it becomes:
 * `StringRef(const char*)` takes null as the empty string (llvm/ADT/StringRef.h:94), `Twine(const char*)` reads `Str[0]`
 * (llvm/ADT/Twine.h:257), so a null there is a crash in the oracle and an error here. */
function cstrArg(s: string | undefined, as: "StringRef" | "Twine", fn: string): string {
  if (s === undefined) {
    if (as === "StringRef") return "";
    throw new Error(`llvm: ${fn}: Twine(const char*) of a null pointer`);
  }
  return bstrOfString(s);
}

const asFunction = (v: Value): Function => {
  if (!(v instanceof Function)) throw new Error("llvm: unwrap<Function> of a value that is not a function");
  return v;
};
const asGlobalVariable = (v: Value): GlobalVariable => {
  if (!(v instanceof GlobalVariable)) throw new Error("llvm: unwrap<GlobalVariable> of a value that is not a global variable");
  return v;
};
const asGlobalValue = (v: Value): GlobalValue => {
  if (!(v instanceof GlobalValue)) throw new Error("llvm: unwrap<GlobalValue> of a value that is not a global value");
  return v;
};
const asGlobalObject = (v: Value): GlobalObject => {
  if (!(v instanceof GlobalObject)) throw new Error("llvm: unwrap<GlobalObject> of a value that is not a global object");
  return v;
};
const asConstant = (v: Value): Constant => {
  if (!(v instanceof Constant)) throw new Error("llvm: unwrap<Constant> of a value that is not a constant");
  return v;
};

// ---- contexts ----------------------------------------------------------------------------------------------------------

// llvm: llvm/lib/IR/Core.cpp:104 LLVMContextCreate
export function LLVMContextCreate(): Context {
  return new Context();
}

// llvm: llvm/lib/IR/Core.cpp:143 LLVMContextDispose
export function LLVMContextDispose(_C: Context): void {
  // Garbage collection disposes of the context and its modules.
}

// llvm: llvm/lib/IR/Core.cpp:139 LLVMContextSetDiscardValueNames
export function LLVMContextSetDiscardValueNames(C: Context, Discard: Bool): void {
  C.discardValueNames = Discard.is_true();
}

// llvm: llvm/lib/IR/Core.cpp:147 LLVMGetMDKindIDInContext
export function LLVMGetMDKindIDInContext(C: Context, Name: PtrLenStr | undefined, SLen: number): MetadataKindId {
  return C.getMDKindID(bytesArg(Name, SLen)) as MetadataKindId;
}

// llvm: llvm/lib/IR/Core.cpp:73 LLVMGetVersion
export function LLVMGetVersion(major: MutRef<number>, minor: MutRef<number>, patch: MutRef<number>): void {
  // PORT: LLVM_VERSION_{MAJOR,MINOR,PATCH} of the oracle's LLVM: `rustc -vV` says `LLVM version: 23.1.3`; the C API
  // differential test checks these against libLLVM's own `LLVMGetVersion`.
  major.value = LLVM_VERSION[0];
  minor.value = LLVM_VERSION[1];
  patch.value = LLVM_VERSION[2];
}
export const LLVM_VERSION: readonly [number, number, number] = [23, 1, 3];

// ---- modules -----------------------------------------------------------------------------------------------------------

// llvm: llvm/lib/IR/Core.cpp:299 LLVMModuleCreateWithNameInContext
export function LLVMModuleCreateWithNameInContext(ModuleID: string | undefined, C: Context): Module {
  // `new Module(StringRef ModuleID, ...)`.
  return new Module(C, cstrArg(ModuleID, "StringRef", "LLVMModuleCreateWithNameInContext"));
}

// llvm: llvm/lib/IR/Core.cpp:329 LLVMGetDataLayoutStr
export function LLVMGetDataLayoutStr(M: Module): string | undefined {
  return stringOfBstr(M.dataLayout);
}

// llvm: llvm/lib/IR/Core.cpp:337 LLVMSetDataLayout
export function LLVMSetDataLayout(M: Module, Triple: string | undefined): void {
  // `Module::setDataLayout(StringRef)`: `DataLayout::parseLayoutString` keeps the string as given.
  M.dataLayout = cstrArg(Triple, "StringRef", "LLVMSetDataLayout");
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:145 LLVMRustSetNormalizedTarget
export function LLVMRustSetNormalizedTarget(M: Module, triple: string | undefined): void {
  // `Triple::normalize(StringRef Str)`: a null target is the empty string, which no D3 target is.
  if (triple === undefined) return unported("llir: Triple::normalize(\"\")");
  // PORT: `Triple::normalize` is not in the model. The triples the D3 targets give LLVM are their own normal form, which the
  // C API differential test checks with libLLVM's `LLVMNormalizeTargetTriple`; any other triple stops.
  if (!NORMAL_TRIPLES.includes(triple)) return unported(`llir: Triple::normalize(${JSON.stringify(triple)})`);
  M.targetTriple = cstrArg(triple, "StringRef", "LLVMRustSetNormalizedTarget");
}
/** Triples checked to be their own `Triple::normalize` (capi.oracle.test.ts); aarch64-unknown-linux-gnu: lane ir-fix-b, for
 *  cg-intrinsic-b's AAPCS `va_arg` fixture. */
export const NORMAL_TRIPLES: readonly string[] = ["x86_64-unknown-linux-gnu", "arm64-apple-macosx11.0.0", "aarch64-unknown-linux-gnu"];

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:929 LLVMRustAddModuleFlagU32
export function LLVMRustAddModuleFlagU32(M: Module, MergeBehavior: ModuleFlagMergeBehavior, Name: PtrLenStr | undefined, NameLen: number, Value: number): void {
  // `fromRust(LLVMRustModuleFlagMergeBehavior)` maps each to the `Module::ModFlagBehavior` of the same value (1-8).
  // `Module::addModuleFlag(Behavior, Key, uint32_t)`: an i32 constant (Module.cpp:393).
  M.addModuleFlag(ModuleFlagMergeBehavior_discriminant[MergeBehavior], bytesArg(Name, NameLen), M.context.constantAsMetadata(getConstantInt(M.context.getIntType(32), BigInt(Value >>> 0))));
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:936 LLVMRustAddModuleFlagString
export function LLVMRustAddModuleFlagString(M: Module, MergeBehavior: ModuleFlagMergeBehavior, Name: PtrLenStr | undefined, NameLen: number, Value: PtrLenStr | undefined, ValueLen: number): void {
  M.addModuleFlag(ModuleFlagMergeBehavior_discriminant[MergeBehavior], bytesArg(Name, NameLen), M.context.getMDString(bytesArg(Value, ValueLen)));
}

// rustc: compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:1202 LLVMRustSetModulePICLevel
export function LLVMRustSetModulePICLevel(M: Module): void {
  // `setPICLevel(PICLevel::Level::BigPIC)`; BigPIC is 2 (llvm/Support/CodeGen.h:36).
  M.setPICLevel(2);
}

// rustc: compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:1206 LLVMRustSetModulePIELevel
export function LLVMRustSetModulePIELevel(M: Module): void {
  // `setPIELevel(PIELevel::Level::Large)`; Large is 2 (llvm/Support/CodeGen.h:40).
  M.setPIELevel(2);
}

// rustc: compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:1210 LLVMRustSetModuleCodeModel
export function LLVMRustSetModuleCodeModel(M: Module, Model: CodeModel): void {
  // `fromRust(LLVMRustCodeModel)` (PassWrapper.cpp:138): `None` is no code model (nothing is set), the others map by name
  // to `CodeModel::Model`, whose values are its order (CodeGen.h:31: Tiny, Small, Kernel, Medium, Large).
  if (Model === "None") return;
  M.setCodeModel(["Tiny", "Small", "Kernel", "Medium", "Large"].indexOf(Model));
}

// rustc: compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:1218 LLVMRustSetModuleLargeDataThreshold
export function LLVMRustSetModuleLargeDataThreshold(M: Module, Threshold: bigint): void {
  M.setLargeDataThreshold(BigInt.asUintN(64, Threshold));
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:881 LLVMRustDebugMetadataVersion
export function LLVMRustDebugMetadataVersion(): number {
  // `DEBUG_METADATA_VERSION` (llvm/include/llvm/IR/Metadata.h:54) is 3.
  return 3;
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:885 LLVMRustVersionMajor
export function LLVMRustVersionMajor(): number {
  return LLVM_VERSION[0];
}

// llvm: llvm/lib/IR/Core.cpp:1489 LLVMAddNamedMetadataOperand
export function LLVMAddNamedMetadataOperand(M: Module, Name: string | undefined, Val: Value): void {
  const n = M.getOrInsertNamedMetadata(cstrArg(Name, "StringRef", "LLVMAddNamedMetadataOperand"));
  // `extractMDNode(MetadataAsValue*)`: the wrapped node; a wrapped value (ValueAsMetadata) would become a fresh MDNode.
  if (!(Val instanceof MetadataAsValue)) throw new Error("llvm: unwrap<MetadataAsValue> of a value that is not metadata");
  if (!(Val.md instanceof MDNode)) return unported("llir: LLVMAddNamedMetadataOperand of a non-node (extractMDNode wraps it)");
  n.push(Val.md);
}

// llvm: llvm/lib/IR/Core.cpp:1322 LLVMMDStringInContext2
export function LLVMMDStringInContext2(C: Context, Str: PtrLenStr | undefined, SLen: number): Metadata {
  return C.getMDString(bytesArg(Str, SLen));
}

// llvm: llvm/lib/IR/Core.cpp:1327 LLVMMDNodeInContext2
export function LLVMMDNodeInContext2(C: Context, Vals: readonly Metadata[], Count: number): Metadata {
  return C.getMDNode(Vals.slice(0, Count));
}

// llvm: llvm/lib/IR/Core.cpp:1378 LLVMValueAsMetadata
export function LLVMValueAsMetadata(Node: Value): Metadata {
  if (Node instanceof Constant) return Node.context.constantAsMetadata(Node);
  if (Node instanceof MetadataAsValue) return Node.md;
  return Node.context.constantAsMetadata(Node);
}

// llvm: llvm/lib/IR/Core.cpp:1374 LLVMMetadataAsValue
export function LLVMMetadataAsValue(C: Context, MD: Metadata): Value {
  return C.getMetadataAsValue(MD);
}

// ---- types -------------------------------------------------------------------------------------------------------------

// llvm: llvm/lib/IR/Core.cpp:613 LLVMGetTypeKind
export function LLVMGetTypeKind(Ty: Type): RawEnum<TypeKind> {
  return new RawEnum(TypeKind_discriminant[Ty.typeID], TypeKind_discriminant);
}

// llvm: llvm/lib/IR/Core.cpp:700 LLVMInt1TypeInContext
export function LLVMInt1TypeInContext(C: Context): Type {
  return C.getIntType(1);
}

// llvm: llvm/lib/IR/Core.cpp:703 LLVMInt8TypeInContext
export function LLVMInt8TypeInContext(C: Context): Type {
  return C.getIntType(8);
}

// llvm: llvm/lib/IR/Core.cpp:706 LLVMInt16TypeInContext
export function LLVMInt16TypeInContext(C: Context): Type {
  return C.getIntType(16);
}

// llvm: llvm/lib/IR/Core.cpp:709 LLVMInt32TypeInContext
export function LLVMInt32TypeInContext(C: Context): Type {
  return C.getIntType(32);
}

// llvm: llvm/lib/IR/Core.cpp:712 LLVMInt64TypeInContext
export function LLVMInt64TypeInContext(C: Context): Type {
  return C.getIntType(64);
}

// llvm: llvm/lib/IR/Core.cpp:718 LLVMIntTypeInContext
export function LLVMIntTypeInContext(C: Context, NumBits: number): Type {
  return C.getIntType(NumBits);
}

// llvm: llvm/lib/IR/Core.cpp:744 LLVMGetIntTypeWidth
export function LLVMGetIntTypeWidth(IntegerTy: Type): number {
  return (IntegerTy as IntegerType).bits;
}

// llvm: llvm/lib/IR/Core.cpp:750 LLVMHalfTypeInContext
export function LLVMHalfTypeInContext(C: Context): Type {
  return C.getFloatingType("Half");
}

// llvm: llvm/lib/IR/Core.cpp:756 LLVMFloatTypeInContext
export function LLVMFloatTypeInContext(C: Context): Type {
  return C.getFloatingType("Float");
}

// llvm: llvm/lib/IR/Core.cpp:759 LLVMDoubleTypeInContext
export function LLVMDoubleTypeInContext(C: Context): Type {
  return C.getFloatingType("Double");
}

// llvm: llvm/lib/IR/Core.cpp:765 LLVMFP128TypeInContext
export function LLVMFP128TypeInContext(C: Context): Type {
  return C.getFloatingType("FP128");
}

// llvm: llvm/lib/IR/Core.cpp:753 LLVMBFloatTypeInContext
export function LLVMBFloatTypeInContext(C: Context): Type {
  return C.getFloatingType("BFloat");
}

// llvm: llvm/lib/IR/Core.cpp:768 LLVMPPCFP128TypeInContext
export function LLVMPPCFP128TypeInContext(C: Context): Type {
  return C.getFloatingType("PPC_FP128");
}

// llvm: llvm/lib/IR/Core.cpp:980 LLVMVoidTypeInContext
export function LLVMVoidTypeInContext(C: Context): Type {
  return C.getVoidType();
}

// llvm: llvm/lib/IR/Core.cpp:802 LLVMFunctionType
export function LLVMFunctionType(ReturnType: Type, ParamTypes: readonly Type[], ParamCount: number, IsVarArg: Bool): Type {
  return ReturnType.context.getFunctionType(ReturnType, ParamTypes.slice(0, ParamCount), IsVarArg.is_true());
}

// llvm: llvm/lib/IR/Core.cpp:817 LLVMCountParamTypes
export function LLVMCountParamTypes(FunctionTy: Type): number {
  return (FunctionTy as FunctionType).params.length;
}

// llvm: llvm/lib/IR/Core.cpp:821 LLVMGetParamTypes
export function LLVMGetParamTypes(FunctionTy: Type, Dest: Type[]): void {
  (FunctionTy as FunctionType).params.forEach((p, i) => (Dest[i] = p));
}

// llvm: llvm/lib/IR/Core.cpp:813 LLVMGetReturnType
export function LLVMGetReturnType(FunctionTy: Type): Type {
  return (FunctionTy as FunctionType).returnType;
}

// llvm: llvm/lib/IR/Core.cpp:809 LLVMIsFunctionVarArg
export function LLVMIsFunctionVarArg(FunctionTy: Type): Bool {
  return Bool.from_bool((FunctionTy as FunctionType).isVarArg);
}

// llvm: llvm/lib/IR/Core.cpp:829 LLVMStructTypeInContext
export function LLVMStructTypeInContext(C: Context, ElementTypes: readonly Type[], ElementCount: number, Packed: Bool): Type {
  return C.getLiteralStructType(ElementTypes.slice(0, ElementCount), Packed.is_true());
}

// llvm: llvm/lib/IR/Core.cpp:976 LLVMPointerTypeInContext
export function LLVMPointerTypeInContext(C: Context, AddressSpace: number): Type {
  return C.getPointerType(AddressSpace);
}

// llvm: llvm/lib/IR/Core.cpp:922 LLVMVectorType
export function LLVMVectorType(ElementType: Type, ElementCount: number): Type {
  return ElementType.context.getVectorType(ElementType, ElementCount, false);
}

// llvm: llvm/lib/IR/Core.cpp:926 LLVMScalableVectorType
export function LLVMScalableVectorType(ElementType: Type, ElementCount: number): Type {
  return ElementType.context.getVectorType(ElementType, ElementCount, true);
}

// llvm: llvm/lib/IR/Core.cpp:931 LLVMGetElementType
export function LLVMGetElementType(Ty: Type): Type {
  if (Ty instanceof ArrayType) return Ty.elementType;
  return (Ty as VectorType).elementType;
}

// llvm: llvm/lib/IR/Core.cpp:954 LLVMGetVectorSize
export function LLVMGetVectorSize(VectorTy: Type): number {
  // `getElementCount().getKnownMinValue()`.
  return (VectorTy as VectorType).numElements;
}

// llvm: llvm/lib/IR/Core.cpp:909 LLVMArrayType2
export function LLVMArrayType2(ElementType: Type, ElementCount: bigint): Type {
  return ElementType.context.getArrayType(ElementType, ElementCount);
}

// llvm: llvm/lib/IR/Core.cpp:841 LLVMStructCreateNamed
export function LLVMStructCreateNamed(C: Context, Name: string | undefined): Type {
  // `StructType::create(Context, StringRef Name)`.
  return C.createNamedStruct(cstrArg(Name, "StringRef", "LLVMStructCreateNamed"));
}

// llvm: llvm/lib/IR/Core.cpp:854 LLVMStructSetBody
export function LLVMStructSetBody(StructTy: Type, ElementTypes: readonly Type[], ElementCount: number, Packed: Bool): void {
  (StructTy as StructType).setBody(ElementTypes.slice(0, ElementCount), Packed.is_true());
}

// llvm: llvm/lib/IR/Core.cpp:860 LLVMCountStructElementTypes
export function LLVMCountStructElementTypes(StructTy: Type): number {
  return (StructTy as StructType).body?.length ?? 0;
}

// llvm: llvm/lib/IR/Core.cpp:864 LLVMGetStructElementTypes
export function LLVMGetStructElementTypes(StructTy: Type, Dest: Type[]): void {
  ((StructTy as StructType).body ?? []).forEach((t, i) => (Dest[i] = t));
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1166 LLVMRustWriteTypeToString
export function LLVMRustWriteTypeToString(Type: Type, s: RustString): void {
  for (const c of printTypeToString(Type)) s.bytes.push(c.charCodeAt(0));
}

// ---- values ------------------------------------------------------------------------------------------------------------

// llvm: llvm/lib/IR/Core.cpp:1041 LLVMTypeOf
export function LLVMTypeOf(Val: Value): Type {
  return Val.type;
}

// llvm: llvm/lib/IR/Core.cpp:1057 LLVMGetValueName2
export function LLVMGetValueName2(Val: Value, Length: MutRef<number>): string | undefined {
  // PORT: `Length` is the name's byte length and the result its bytes decoded as UTF-8, where C hands back the bytes (rustc's
  // `get_value_name` works on `&[u8]`). Lossless because every name rustc gives is a Rust `&str` (review llir-core-a N13).
  Length.value = Val.name.length;
  return stringOfBstr(Val.name);
}

// llvm: llvm/lib/IR/Core.cpp:1063 LLVMSetValueName2
export function LLVMSetValueName2(Val: Value, Name: PtrLenStr | undefined, NameLen: number): void {
  Val.setName(bytesArg(Name, NameLen));
}

// llvm: llvm/lib/IR/Core.cpp:1107 LLVMReplaceAllUsesWith
export function LLVMReplaceAllUsesWith(OldVal: Value, NewVal: Value): void {
  OldVal.replaceAllUsesWith(NewVal);
}

// llvm: llvm/lib/IR/Core.cpp:2267 LLVMGlobalSetMetadata
export function LLVMGlobalSetMetadata(Val: Value, KindID: MetadataKindId, Metadata: Metadata): void {
  asGlobalObject(Val).setMetadata(KindID, Metadata as MDNode);
}

// llvm: llvm/lib/IR/Core.cpp:2272 LLVMGlobalAddMetadata
export function LLVMGlobalAddMetadata(Val: Value, KindID: MetadataKindId, Metadata: Metadata): void {
  asGlobalObject(Val).addMetadata(KindID, Metadata as MDNode);
}

// llvm: llvm/lib/IR/Core.cpp:529 LLVMGetInlineAsm
export function LLVMGetInlineAsm(Ty: Type, AsmString: PtrLenStr | undefined, AsmStringSize: number, Constraints: PtrLenStr | undefined, ConstraintsSize: number, HasSideEffects: Bool, IsAlignStack: Bool, Dialect: AsmDialect, CanThrow: Bool): Value {
  // `LLVMInlineAsmDialectATT` -> `AD_ATT`, `LLVMInlineAsmDialectIntel` -> `AD_Intel` (ffi.rs's `AsmDialect` mirrors the C enum).
  const AD = Dialect === "Att" ? "AD_ATT" : "AD_Intel";
  if (!(Ty instanceof FunctionType)) throw new Error("llvm: unwrap<FunctionType> of a type that is not a function type");
  return getInlineAsm(Ty, bytesArg(AsmString, AsmStringSize), bytesArg(Constraints, ConstraintsSize), HasSideEffects.value !== 0, IsAlignStack.value !== 0, AD, CanThrow.value !== 0);
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:654 LLVMRustInlineAsmVerify
export function LLVMRustInlineAsmVerify(Ty: Type, Constraints: PtrLenStr | undefined, ConstraintsLen: number): boolean {
  // PORT (plan-m7 D10; root at integ-w57 from lane cg-register's handoff, review cg-register N3): `InlineAsm::verify`
  // (InlineAsm.cpp:274) is not ported yet, so this answers "valid" for every constraint string. Upstream answers "invalid" only
  // where rustc then ICEs (rustc_codegen_llvm asm.rs:363 `span_bug!`, intrinsic.rs:173 `bug!`), so the stand-in differs from
  // upstream only on a path that would be a compiler bug. A port of `InlineAsm::verify` belongs with lane cg-asm.
  void Constraints;
  void ConstraintsLen;
  if (!(Ty instanceof FunctionType)) throw new Error("llvm: unwrap<FunctionType> of a type that is not a function type");
  return true;
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1171 LLVMRustWriteValueToString
export function LLVMRustWriteValueToString(value_ref: Value, s: RustString): void {
  // `(<type>:<value>)`. This reaches rustc's `Debug` for `Value`. Floating-point constants print as AsmWriter's
  // `writeAPFloatInternal` (lane llir-apfloat) and calling conventions by name (`printCallingConv`, lane llir-folder).
  const text = `(${printTypeToString(value_ref.type)}:${printValueToString(value_ref)})`;
  for (const c of text) s.bytes.push(c.charCodeAt(0));
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1690 LLVMRustStripPointerCasts
export function LLVMRustStripPointerCasts(V: Value): Value {
  return V.stripPointerCasts();
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1679 LLVMRustIsNonGVFunctionPointerTy
export function LLVMRustIsNonGVFunctionPointerTy(V: Value): boolean {
  if (V.type.isPointerTy()) {
    if (V instanceof GlobalValue && V.valueType.isFunctionTy()) return false;
    return true;
  }
  return false;
}

// ---- constants ---------------------------------------------------------------------------------------------------------

// llvm: llvm/lib/IR/Core.cpp:1282 LLVMConstNull
export function LLVMConstNull(Ty: Type): Value {
  return getNullValue(Ty);
}

// llvm: llvm/lib/IR/Core.cpp:1290 LLVMGetUndef
export function LLVMGetUndef(Ty: Type): Value {
  return getUndef(Ty);
}

// llvm: llvm/lib/IR/Core.cpp:1294 LLVMGetPoison
export function LLVMGetPoison(Ty: Type): Value {
  return getPoison(Ty);
}

// llvm: llvm/lib/IR/Core.cpp:1579 LLVMConstInt
export function LLVMConstInt(IntTy: Type, N: bigint, SignExtend: Bool): Value {
  return getConstantIntU64(IntTy as IntegerType, BigInt.asUintN(64, N), SignExtend.is_true());
}

// llvm: llvm/lib/IR/Core.cpp:1584 LLVMConstIntOfArbitraryPrecision
export function LLVMConstIntOfArbitraryPrecision(IntTy: Type, Wn: number, Ws: readonly bigint[]): Value {
  // `APInt(BitWidth, ArrayRef(Words, NumWords))`: little-endian 64-bit words, truncated to the width.
  let v = 0n;
  for (let i = Wn - 1; i >= 0; i--) v = (v << 64n) | BigInt.asUintN(64, Ws[i]!);
  return getConstantInt(IntTy as IntegerType, v);
}

// llvm: llvm/lib/IR/Core.cpp:1628 LLVMConstReal
export function LLVMConstReal(RealTy: Type, N: number): Value {
  return getConstantFPOfDouble(RealTy, N);
}

// llvm: llvm/lib/IR/Core.cpp:1738 LLVMConstArray2
export function LLVMConstArray2(ElementTy: Type, ConstantVals: readonly Value[], Length: bigint): Value {
  const ty = ElementTy.context.getArrayType(ElementTy, Length);
  return getConstantArray(ty, ConstantVals.slice(0, Number(Length)).map(asConstant))!;
}

// llvm: llvm/lib/IR/Core.cpp:1693 LLVMConstStringInContext2
export function LLVMConstStringInContext2(C: Context, Str: PtrLenStr | undefined, Length: number, DontNullTerminate: Bool): Value {
  // `ConstantDataArray::getString(Context, Str, AddNull = DontNullTerminate == 0)`: an [N x i8] data array.
  let bytes = bytesArg(Str, Length);
  if (!DontNullTerminate.is_true()) bytes += "\0";
  const i8 = C.getIntType(8);
  const elems = [...bytes].map((c) => getConstantInt(i8, BigInt(c.charCodeAt(0))));
  return getConstantDataSequential(C.getArrayType(i8, BigInt(elems.length)), elems);
}

// llvm: llvm/lib/IR/Core.cpp:1751 LLVMConstStructInContext
export function LLVMConstStructInContext(C: Context, ConstantVals: readonly Value[], Count: number, Packed: Bool): Value {
  // `ConstantStruct::getAnon`: the literal struct type of the elements' types.
  const elems = ConstantVals.slice(0, Count).map(asConstant);
  const ty = C.getLiteralStructType(
    elems.map((e) => e.type),
    Packed.is_true(),
  );
  return getConstantStruct(ty, elems)!;
}

// llvm: llvm/lib/IR/Core.cpp:1765 LLVMConstNamedStruct
export function LLVMConstNamedStruct(StructTy: Type, ConstantVals: readonly Value[], Count: number): Value {
  return getConstantStruct(StructTy as StructType, ConstantVals.slice(0, Count).map(asConstant))!;
}

// llvm: llvm/lib/IR/Core.cpp:1914 LLVMConstInBoundsGEP2
export function LLVMConstInBoundsGEP2(Ty: Type, ConstantVal: Value, ConstantIndices: readonly Value[], NumIndices: number): Value {
  // `ConstantExpr::getInBoundsGetElementPtr`: `GEPNoWrapFlags::inBounds()`, which is InBounds | NUSW (raw 3).
  return getGetElementPtr(Ty, asConstant(ConstantVal), ConstantIndices.slice(0, NumIndices).map(asConstant), GEP_INBOUNDS);
}
/** `GEPNoWrapFlags::inBounds()` raw bits: `InBoundsFlag | NUSWFlag` (GEPNoWrapFlags.h). */
const GEP_INBOUNDS = 3;

// llvm: llvm/lib/IR/Core.cpp:1940 LLVMConstPtrToInt
export function LLVMConstPtrToInt(ConstantVal: Value, ToType: Type): Value {
  return getPtrToInt(asConstant(ConstantVal), ToType);
}

// llvm: llvm/lib/IR/Core.cpp:1945 LLVMConstIntToPtr
export function LLVMConstIntToPtr(ConstantVal: Value, ToType: Type): Value {
  return getIntToPtr(asConstant(ConstantVal), ToType);
}

// llvm: llvm/lib/IR/Core.cpp:1950 LLVMConstBitCast
export function LLVMConstBitCast(ConstantVal: Value, ToType: Type): Value {
  return getBitCast(asConstant(ConstantVal), ToType);
}

// llvm: llvm/lib/IR/Core.cpp:1967 LLVMConstPointerCast
export function LLVMConstPointerCast(ConstantVal: Value, ToType: Type): Value {
  return getPointerCast(asConstant(ConstantVal), ToType);
}

// llvm: llvm/lib/IR/Core.cpp:1708 LLVMGetAggregateElement
export function LLVMGetAggregateElement(ConstantVal: Value, Idx: number): Value | undefined {
  return getAggregateElement(asConstant(ConstantVal), Idx);
}

// llvm: llvm/lib/IR/Core.cpp:1838 LLVMGetConstOpcode
export function LLVMGetConstOpcode(ConstantVal: Value): import("./ffi_types.ts").Opcode {
  // `map_to_llvmopcode`: the C API's opcode numbering, which ffi.rs's `Opcode` mirrors by name.
  const op = (ConstantVal as ConstantExpr).opcode;
  if (!(op in Opcode_discriminant)) return unported(`llir: LLVMGetConstOpcode of ${op}`);
  return op as import("./ffi_types.ts").Opcode;
}

// `LLVMIsAConstantExpr`: Core.cpp:1183's `LLVM_FOR_EACH_VALUE_SUBCLASS(LLVM_DEFINE_VALUE_CAST)` (a macro, no definition line to mark).
export function LLVMIsAConstantExpr(Val: Value): Value | undefined {
  return Val instanceof ConstantExpr ? Val : undefined;
}

// `LLVMIsAConstantInt`: Core.cpp:1183's `LLVM_FOR_EACH_VALUE_SUBCLASS(LLVM_DEFINE_VALUE_CAST)` (a macro, no definition line to mark).
export function LLVMIsAConstantInt(value_ref: Value): ConstantInt | undefined {
  return value_ref instanceof ConstantInt ? value_ref : undefined;
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1446 LLVMRustConstIntGetZExtValue
export function LLVMRustConstIntGetZExtValue(ConstantVal: ConstantInt, Value: MutRef<bigint>): boolean {
  if (ConstantVal.intType.bits > 64) return false;
  Value.value = ConstantVal.value;
  return true;
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1456 LLVMRustConstInt128Get
export function LLVMRustConstInt128Get(ConstantVal: ConstantInt, SExt: boolean, high: MutRef<bigint>, low: MutRef<bigint>): boolean {
  if (ConstantVal.intType.bits > 128) return false;
  const ap = BigInt.asUintN(128, SExt ? ConstantVal.sextValue : ConstantVal.value);
  low.value = BigInt.asUintN(64, ap);
  high.value = ap >> 64n;
  return true;
}

// ---- globals -----------------------------------------------------------------------------------------------------------

// llvm: llvm/lib/IR/Core.cpp:2023 LLVMIsDeclaration
export function LLVMIsDeclaration(Global: Value): Bool {
  return Bool.from_bool(asGlobalValue(Global).isDeclaration());
}

// llvm: llvm/lib/IR/Core.cpp:2027 LLVMGetLinkage
export function LLVMGetLinkage(Global: Value): RawEnum<Linkage> {
  return new RawEnum(Linkage_discriminant[asGlobalValue(Global).linkage], Linkage_discriminant);
}

// llvm: llvm/lib/IR/Core.cpp:2056 LLVMSetLinkage
export function LLVMSetLinkage(Global: Value, RustLinkage: Linkage): void {
  const gv = asGlobalValue(Global);
  let lt: LinkageTypes | undefined;
  switch (RustLinkage) {
    case "LinkerPrivateLinkage":
    case "LinkerPrivateWeakLinkage":
      lt = "PrivateLinkage";
      break;
    // "no longer supported": LLVM_DEBUG only, the linkage is unchanged.
    case "LinkOnceODRAutoHideLinkage":
    case "DLLImportLinkage":
    case "DLLExportLinkage":
    case "GhostLinkage":
      lt = undefined;
      break;
    default:
      lt = RustLinkage;
  }
  if (lt !== undefined) gv.setLinkage(lt);
}

// llvm: llvm/lib/IR/Core.cpp:2127 LLVMSetSection
export function LLVMSetSection(Global: Value, Section: string | undefined): void {
  // `setSection(StringRef)`.
  asGlobalObject(Global).setSection(cstrArg(Section, "StringRef", "LLVMSetSection"));
}

// llvm: llvm/lib/IR/Core.cpp:2131 LLVMGetVisibility
export function LLVMGetVisibility(Global: Value): RawEnum<Visibility> {
  return new RawEnum(Visibility_discriminant[asGlobalValue(Global).visibility], Visibility_discriminant);
}

// llvm: llvm/lib/IR/Core.cpp:2136 LLVMSetVisibility
export function LLVMSetVisibility(Global: Value, Viz: Visibility): void {
  asGlobalValue(Global).setVisibility(Viz);
}

/** The instructions that have an alignment (`AllocaInst`, `LoadInst`, `StoreInst`, `AtomicRMWInst`, `AtomicCmpXchgInst`). */
const ALIGNED_OPCODES = ["alloca", "load", "store", "atomicrmw", "cmpxchg"];

// llvm: llvm/lib/IR/Core.cpp:2192 LLVMGetAlignment
export function LLVMGetAlignment(Global: Value): number {
  if (Global instanceof GlobalVariable || Global instanceof Function) return Global.alignment ?? 0;
  if (Global instanceof Inst && ALIGNED_OPCODES.includes(Global.opcode)) {
    // An instruction's `getAlign()` is always set; the model leaves the data layout's default undefined (inst.ts header).
    if (Global.align === undefined) return unported("llir: LLVMGetAlignment of an instruction with the data layout's default alignment");
    return Global.align;
  }
  throw new Error("llvm: only GlobalValue, AllocaInst, LoadInst, StoreInst, AtomicRMWInst, and AtomicCmpXchgInst have alignment");
}

// llvm: llvm/lib/IR/Core.cpp:2214 LLVMSetAlignment
export function LLVMSetAlignment(Global: Value, Bytes: number): void {
  if (Global instanceof GlobalVariable || Global instanceof Function) return Global.setAlignment(Bytes);
  if (Global instanceof Inst && ALIGNED_OPCODES.includes(Global.opcode)) {
    // `setAlignment(Align(Bytes))`: an `Align` of 0 is an assertion (off in the oracle's build), never passed by rustc.
    Global.align = Bytes;
    return;
  }
  throw new Error("llvm: only GlobalValue, AllocaInst, LoadInst, StoreInst, AtomicRMWInst, and AtomicCmpXchgInst have alignment");
}

// llvm: llvm/lib/IR/Core.cpp:2146 LLVMSetDLLStorageClass
export function LLVMSetDLLStorageClass(V: Value, C: DLLStorageClass): void {
  asGlobalValue(V).dllStorageClass = C;
}

// llvm: llvm/lib/IR/Core.cpp:2186 LLVMGlobalGetValueType
export function LLVMGlobalGetValueType(Global: Value): Type {
  return asGlobalValue(Global).valueType;
}

// `LLVMIsAGlobalVariable`: Core.cpp:1183's `LLVM_FOR_EACH_VALUE_SUBCLASS(LLVM_DEFINE_VALUE_CAST)` (a macro, no definition line to mark).
export function LLVMIsAGlobalVariable(GlobalVar: Value): Value | undefined {
  return GlobalVar instanceof GlobalVariable ? GlobalVar : undefined;
}

/** `new GlobalVariable(M, Ty, false, ExternalLinkage, nullptr, Name, nullptr, NotThreadLocal, AddressSpace)`. */
function newGlobalVariable(M: Module, ty: Type, name: string, addressSpace: number): GlobalVariable {
  const gv = new GlobalVariable(M.context.getPointerType(addressSpace), ty, "ExternalLinkage");
  // GlobalValue's constructor sets the name with no symbol table; joining the module re-inserts it (`reinsertValue`).
  gv.name = name;
  M.insertGlobalVariable(gv);
  return gv;
}

// llvm: llvm/lib/IR/Core.cpp:2292 LLVMAddGlobal
export function LLVMAddGlobal(M: Module, Ty: Type, Name: string | undefined): Value {
  // The name is a `Twine`.
  return newGlobalVariable(M, Ty, cstrArg(Name, "Twine", "LLVMAddGlobal"), M.layoutAddressSpace("G"));
}

// llvm: llvm/lib/IR/Core.cpp:2306 LLVMGetNamedGlobal
export function LLVMGetNamedGlobal(M: Module, Name: string | undefined): Value | undefined {
  // `Module::getNamedGlobal(Name)` is `getGlobalVariable(Name, AllowLocal = true)` (Module.h:521).
  return M.getGlobalVariable(cstrArg(Name, "StringRef", "LLVMGetNamedGlobal"), true);
}

// llvm: llvm/lib/IR/Core.cpp:2315 LLVMGetFirstGlobal
export function LLVMGetFirstGlobal(M: Module): Value | undefined {
  return M.globals[0];
}

// llvm: llvm/lib/IR/Core.cpp:2331 LLVMGetNextGlobal
export function LLVMGetNextGlobal(GlobalVar: Value): Value | undefined {
  const gv = asGlobalVariable(GlobalVar);
  const list = gv.parent!.globals;
  return list[list.indexOf(gv) + 1];
}

// llvm: llvm/lib/IR/Core.cpp:2347 LLVMDeleteGlobal
export function LLVMDeleteGlobal(GlobalVar: Value): void {
  const gv = asGlobalVariable(GlobalVar);
  gv.removeFromParent();
  gv.dropAllReferences();
}

// llvm: llvm/lib/IR/Core.cpp:2351 LLVMGetInitializer
export function LLVMGetInitializer(GlobalVar: Value): Value | undefined {
  return asGlobalVariable(GlobalVar).initializer;
}

// llvm: llvm/lib/IR/Core.cpp:2358 LLVMSetInitializer
export function LLVMSetInitializer(GlobalVar: Value, ConstantVal: Value): void {
  asGlobalVariable(GlobalVar).setInitializer(ConstantVal === undefined ? undefined : asConstant(ConstantVal));
}

// llvm: llvm/lib/IR/Core.cpp:2363 LLVMIsThreadLocal
export function LLVMIsThreadLocal(GlobalVar: Value): Bool {
  return Bool.from_bool(asGlobalVariable(GlobalVar).threadLocalMode !== "NotThreadLocal");
}

// llvm: llvm/lib/IR/Core.cpp:2396 LLVMSetThreadLocalMode
export function LLVMSetThreadLocalMode(GlobalVar: Value, Mode: ThreadLocalMode): void {
  asGlobalVariable(GlobalVar).threadLocalMode = Mode;
}

// llvm: llvm/lib/IR/Core.cpp:2371 LLVMIsGlobalConstant
export function LLVMIsGlobalConstant(GlobalVar: Value): Bool {
  return Bool.from_bool(asGlobalVariable(GlobalVar).isConstantGlobal);
}

// llvm: llvm/lib/IR/Core.cpp:2375 LLVMSetGlobalConstant
export function LLVMSetGlobalConstant(GlobalVar: Value, IsConstant: Bool): void {
  asGlobalVariable(GlobalVar).isConstantGlobal = IsConstant.is_true();
}

// llvm: llvm/lib/IR/Core.cpp:2422 LLVMSetExternallyInitialized
export function LLVMSetExternallyInitialized(GlobalVar: Value, IsExtInit: Bool): void {
  asGlobalVariable(GlobalVar).isExternallyInitialized = IsExtInit.is_true();
}

// llvm: llvm/lib/IR/Core.cpp:2428 LLVMAddAlias2
export function LLVMAddAlias2(M: Module, ValueTy: Type, AddressSpace: number, Aliasee: Value, Name: string | undefined): Value {
  // `GlobalAlias::create(Ty, AddressSpace, ExternalLinkage, Name, Aliasee, M)`.
  const ga = new GlobalAlias(M.context.getPointerType(AddressSpace), ValueTy, "ExternalLinkage", asConstant(Aliasee));
  ga.name = cstrArg(Name, "Twine", "LLVMAddAlias2");
  M.insertAlias(ga);
  return ga;
}

// llvm: llvm/lib/IR/Core.cpp:2441 LLVMGetFirstGlobalAlias
export function LLVMGetFirstGlobalAlias(M: Module): Value | undefined {
  return M.aliases[0];
}

// llvm: llvm/lib/IR/Core.cpp:2457 LLVMGetNextGlobalAlias
export function LLVMGetNextGlobalAlias(GA: Value): Value | undefined {
  const list = (GA as GlobalAlias).parent!.aliases;
  return list[list.indexOf(GA as GlobalAlias) + 1];
}

// llvm: llvm/lib/IR/Core.cpp:2163 LLVMSetUnnamedAddress
export function LLVMSetUnnamedAddress(Global: Value, UnnamedAddr: UnnamedAddr): void {
  asGlobalValue(Global).unnamedAddr = UnnamedAddr === "No" ? "None" : UnnamedAddr;
}

// llvm: llvm/lib/IR/Comdat.cpp:34 LLVMGetOrInsertComdat
export function LLVMGetOrInsertComdat(M: Module, Name: string | undefined): Comdat {
  // `Module::getOrInsertComdat` (Module.cpp:621): a new comdat selects `Any`.
  const n = cstrArg(Name, "StringRef", "LLVMGetOrInsertComdat");
  let c = M.comdats.get(n);
  if (c === undefined) M.comdats.set(n, (c = new Comdat(n)));
  return c;
}

// llvm: llvm/lib/IR/Comdat.cpp:43 LLVMSetComdat
export function LLVMSetComdat(V: Value, C: Comdat): void {
  asGlobalObject(V).comdat = C;
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1473 LLVMRustSetDSOLocal
export function LLVMRustSetDSOLocal(Global: Value, is_dso_local: boolean): void {
  asGlobalValue(Global).isDSOLocal = is_dso_local;
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:221 LLVMRustGetOrInsertGlobal
export function LLVMRustGetOrInsertGlobal(M: Module, Name: PtrLenStr | undefined, NameLen: number, T: Type): Value {
  return LLVMRustGetOrInsertGlobalInAddrspace(M, Name, NameLen, T, M.layoutAddressSpace("G"));
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:201 LLVMRustGetOrInsertGlobalInAddrspace
export function LLVMRustGetOrInsertGlobalInAddrspace(M: Module, Name: PtrLenStr | undefined, NameLen: number, T: Type, AddressSpace: number): Value {
  // We don't use Module::getOrInsertGlobal because that returns a Constant*, which may either be the real GlobalVariable*,
  // or a constant bitcast of it if our type doesn't match the original declaration.
  const name = bytesArg(Name, NameLen);
  return M.getGlobalVariable(name, true) ?? newGlobalVariable(M, T, name, AddressSpace);
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:169 LLVMRustGetNamedValue
export function LLVMRustGetNamedValue(M: Module, Name: PtrLenStr | undefined, NameLen: number): Value | undefined {
  return M.getNamedValue(bytesArg(Name, NameLen));
}

// ---- functions ---------------------------------------------------------------------------------------------------------

// llvm: llvm/lib/IR/Core.cpp:2624 LLVMSetFunctionCallConv
export function LLVMSetFunctionCallConv(Fn: Value, CC: number): void {
  asFunction(Fn).callingConv = CC;
}

// llvm: llvm/lib/IR/Core.cpp:2483 LLVMAddFunction
export function LLVMAddFunction(Mod: Module, Name: string | undefined, FunctionTy: Type): Value {
  // `Function::Create(Ty, ExternalLinkage, Name, M)`: the address space is the data layout's program address space.
  return new Function(FunctionTy as FunctionType, "ExternalLinkage", Mod.layoutAddressSpace("P"), cstrArg(Name, "Twine", "LLVMAddFunction"), Mod);
}

// llvm: llvm/lib/IR/Core.cpp:2538 LLVMDeleteFunction
export function LLVMDeleteFunction(Fn: Value): void {
  // `Function::eraseFromParent`: the body goes first (`dropAllReferences` of every instruction, then the blocks).
  const f = asFunction(Fn);
  for (const bb of f.blocks as BasicBlock[]) for (const I of bb.insts) I.dropAllReferences();
  f.blocks.length = 0;
  f.removeFromParent();
  f.dropAllReferences();
}

// llvm: llvm/lib/IR/Core.cpp:2489 LLVMGetOrInsertFunction
export function LLVMGetOrInsertFunction(M: Module, Name: PtrLenStr | undefined, NameLen: number, FunctionTy: Type): Value {
  // `Module::getOrInsertFunction(Name, Ty)` (Module.cpp:211): the named value if there is one, whatever its type.
  const name = bytesArg(Name, NameLen);
  return M.getNamedValue(name) ?? new Function(FunctionTy as FunctionType, "ExternalLinkage", M.layoutAddressSpace("P"), name, M);
}

// `LLVMIsAArgument`: Core.cpp:1183's `LLVM_FOR_EACH_VALUE_SUBCLASS(LLVM_DEFINE_VALUE_CAST)` (a macro, no definition line to mark).
export function LLVMIsAArgument(Val: Value): Value | undefined {
  return Val instanceof Argument ? Val : undefined;
}

// llvm: llvm/lib/IR/Core.cpp:2724 LLVMCountParams
export function LLVMCountParams(Fn: Value): number {
  // `Function::arg_size`: the function type's parameter count.
  return asFunction(Fn).args.length;
}

// llvm: llvm/lib/IR/Core.cpp:2736 LLVMGetParam
export function LLVMGetParam(Fn: Value, Index: number): Value {
  return asFunction(Fn).args[Index]!;
}

// ---- attributes --------------------------------------------------------------------------------------------------------

/** `Attribute::getNameFromAttrKind` of the enum kinds the model creates (Attributes.td's `EnumAttr<"name">`, by C++ kind). */
export const ATTR_NAME: Readonly<Record<string, string>> = {
  AlwaysInline: "alwaysinline", ByVal: "byval", Cold: "cold", InlineHint: "inlinehint", MinSize: "minsize", Naked: "naked",
  NoAlias: "noalias", NoCfCheck: "nocf_check", NoInline: "noinline", NonNull: "nonnull", NoRedZone: "noredzone",
  NoReturn: "noreturn", NoUnwind: "nounwind", OptimizeForSize: "optsize", ReadOnly: "readonly", SExt: "signext",
  StructRet: "sret", UWTable: "uwtable", ZExt: "zeroext", InReg: "inreg", SanitizeThread: "sanitize_thread",
  SanitizeAddress: "sanitize_address", SanitizeMemory: "sanitize_memory", NonLazyBind: "nonlazybind", OptimizeNone: "optnone",
  ReadNone: "readnone", SanitizeHWAddress: "sanitize_hwaddress", WillReturn: "willreturn", StackProtectReq: "sspreq",
  StackProtectStrong: "sspstrong", StackProtect: "ssp", NoUndef: "noundef", SanitizeMemTag: "sanitize_memtag",
  ShadowCallStack: "shadowcallstack", AllocSize: "allocsize", AllocatedPointer: "allocptr", AllocAlign: "allocalign",
  SafeStack: "safestack", FnRetThunkExtern: "fn_ret_thunk_extern", Writable: "writable", DeadOnUnwind: "dead_on_unwind",
  DeadOnReturn: "dead_on_return", SanitizeRealtime: "sanitize_realtime", SanitizeRealtimeBlocking: "sanitize_realtime_blocking",
  Convergent: "convergent", NoFree: "nofree", ElementType: "elementtype", ByRef: "byref",
};

/** `fromRust(LLVMRustAttributeKind)` (RustWrapper.cpp:285): the C++ attribute kind of each Rust-side kind. */
function fromRust(k: AttributeKind): string {
  switch (k) {
    case "SanitizeSafeStack":
      return "SafeStack";
    case "SanitizeRealtimeNonblocking":
      return "SanitizeRealtime";
    case "CapturesAddress":
    case "CapturesReadOnly":
    case "CapturesNone":
      throw new Error("llvm: report_fatal_error: Should be handled separately");
    default:
      return k;
  }
}

/** The Rust-side kind that `LLVMRustCreateAttrNoValue` makes into the enum attribute printed as `llvmName` (for replay.ts). */
export function rustAttributeKindOf(llvmName: string): AttributeKind | undefined {
  for (const k of Object.keys(AttributeKind) as AttributeKind[]) {
    if (k === "CapturesAddress" || k === "CapturesReadOnly" || k === "CapturesNone") continue;
    if (ATTR_NAME[fromRust(k)] === llvmName) return k;
  }
  return undefined;
}

const enumAttr = (kind: string): Attribute => new Attribute(kind, () => ATTR_NAME[kind] ?? unported(`llir: attribute name of ${kind}`), false);

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:431 LLVMRustCreateAttrNoValue
export function LLVMRustCreateAttrNoValue(C: Context, RustAttr: AttributeKind): Attribute {
  // Captures attributes print as `captures(...)` (ModRef.cpp's `operator<<(CaptureInfo)`): with no `ret:` part when the
  // return components equal the others, which `CaptureInfo(CC)` makes them.
  if (RustAttr === "CapturesNone") return C.getAttribute("captures:none", () => new Attribute("Captures", () => "captures(none)", false));
  if (RustAttr === "CapturesAddress") return C.getAttribute("captures:address", () => new Attribute("Captures", () => "captures(address)", false));
  if (RustAttr === "CapturesReadOnly") return C.getAttribute("captures:address,read_provenance", () => new Attribute("Captures", () => "captures(address, read_provenance)", false));
  // `#if LLVM_VERSION_GE(23, 0)` (the model's LLVM is 23.1.3): `Attribute::getWithDeadOnReturnInfo(C, DeadOnReturnInfo())`
  // (Attributes.cpp:291) is the int attribute `DeadOnReturn` with `DeadOnReturnInfo().toIntValue()`, `UINT64_MAX` for "all
  // reachable memory" (Attributes.h:85); `getAsString` prints that value as the bare `dead_on_return` (Attributes.cpp:592).
  if (RustAttr === "DeadOnReturn") return getWithDeadOnReturnInfo(C, U64_MAX);
  const kind = fromRust(RustAttr);
  // `Attribute::get(Context, Kind)` of an int attribute kind takes a value; only enum kinds are created with none.
  if (kind === "AllocSize" || kind === "UWTable") return unported(`llir: LLVMRustCreateAttrNoValue(${kind}) (an int attribute without a value)`);
  return C.getAttribute(`enum:${kind}`, () => enumAttr(kind));
}

const U64_MAX = (1n << 64n) - 1n;

// llvm: llvm/lib/IR/Attributes.cpp:291 Attribute::getWithDeadOnReturnInfo
function getWithDeadOnReturnInfo(C: Context, DI: bigint): Attribute {
  // `get(Context, DeadOnReturn, DI.toIntValue())`; `getAsString` (Attributes.cpp:592): the maximum prints bare, any other value
  // as `AttrWithBytesToString("dead_on_return")`.
  return C.getAttribute(`int:DeadOnReturn:${DI}`, () => new Attribute("DeadOnReturn", (g) => (DI === U64_MAX ? "dead_on_return" : g ? `dead_on_return=${DI}` : `dead_on_return(${DI})`), false));
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:453 LLVMRustCreateAlignmentAttr
export function LLVMRustCreateAlignmentAttr(C: Context, bytes: bigint): Attribute {
  return C.getAttribute(`align:${bytes}`, () => new Attribute("Alignment", (g) => (g ? `align=${bytes}` : `align ${bytes}`), false));
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:458 LLVMRustCreateDereferenceableAttr
export function LLVMRustCreateDereferenceableAttr(C: Context, bytes: bigint): Attribute {
  return C.getAttribute(`deref:${bytes}`, () => new Attribute("Dereferenceable", (g) => (g ? `dereferenceable=${bytes}` : `dereferenceable(${bytes})`), false));
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:464 LLVMRustCreateDereferenceableOrNullAttr
export function LLVMRustCreateDereferenceableOrNullAttr(C: Context, bytes: bigint): Attribute {
  return C.getAttribute(`deref_or_null:${bytes}`, () => new Attribute("DereferenceableOrNull", (g) => (g ? `dereferenceable_or_null=${bytes}` : `dereferenceable_or_null(${bytes})`), false));
}

const typeAttr = (kind: string, ty: Type): Attribute => ty.context.getAttribute(`type:${kind}:${ty.id}`, () => new Attribute(kind, () => `${ATTR_NAME[kind]}(${printTypeToString(ty)})`, false, ty));

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:468 LLVMRustCreateByValAttr
export function LLVMRustCreateByValAttr(_C: Context, ty: Type): Attribute {
  return typeAttr("ByVal", ty);
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:473 LLVMRustCreateByRefAttr
export function LLVMRustCreateByRefAttr(_C: Context, ty: Type): Attribute {
  return typeAttr("ByRef", ty);
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:478 LLVMRustCreateStructRetAttr
export function LLVMRustCreateStructRetAttr(_C: Context, ty: Type): Attribute {
  return typeAttr("StructRet", ty);
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:483 LLVMRustCreateElementTypeAttr
export function LLVMRustCreateElementTypeAttr(_C: Context, ty: Type): Attribute {
  return typeAttr("ElementType", ty);
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:488 LLVMRustCreateUWTableAttr
export function LLVMRustCreateUWTableAttr(C: Context, async_: boolean): Attribute {
  // `UWTableKind::Default` is `Async` (Attributes.cpp prints the default kind as plain `uwtable`).
  return C.getAttribute(`uwtable:${async_}`, () => new Attribute("UWTable", () => (async_ ? "uwtable" : "uwtable(sync)"), false));
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:495 LLVMRustCreateAllocSizeAttr
export function LLVMRustCreateAllocSizeAttr(C: Context, ElementSizeArg: number): Attribute {
  return C.getAttribute(`allocsize:${ElementSizeArg}`, () => new Attribute("AllocSize", () => `allocsize(${ElementSizeArg})`, false));
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:501 LLVMRustCreateRangeAttribute
export function LLVMRustCreateRangeAttribute(C: Context, NumBits: number, LowerWords: readonly bigint[], UpperWords: readonly bigint[]): Attribute {
  // "There appears to be no stable guarantee that C++ `AttrKind` values correspond directly to the `unsigned KindID` values
  // accepted by LLVM-C API functions, though in practice they currently do."
  return LLVMCreateConstantRangeAttribute(C, ATTR_KIND_ENUM.Range!, NumBits, LowerWords, UpperWords);
}

// llvm: llvm/lib/IR/Core.cpp:198 LLVMCreateConstantRangeAttribute
function LLVMCreateConstantRangeAttribute(C: Context, KindID: number, NumBits: number, LowerWords: readonly bigint[], UpperWords: readonly bigint[]): Attribute {
  if (KindID !== ATTR_KIND_ENUM.Range) return unported(`llir: LLVMCreateConstantRangeAttribute of attribute kind ${KindID} (only Range is modelled)`);
  // `APInt(NumBits, ArrayRef(Words, NumWords))` with `NumWords = divideCeil(NumBits, 64)`: the words little-endian, the bits above
  // `NumBits` cleared (`clearUnusedBits`).
  const NumWords = Math.ceil(NumBits / 64);
  const apint = (words: readonly bigint[]): bigint => {
    let v = 0n;
    for (let i = 0; i < NumWords; i++) v |= BigInt.asUintN(64, words[i] ?? unported("llir: LLVMCreateConstantRangeAttribute with fewer words than NumBits needs")) << BigInt(64 * i);
    return BigInt.asUintN(NumBits, v);
  };
  const Lower = apint(LowerWords);
  const Upper = apint(UpperWords);
  // `ConstantRange(Lower, Upper)` asserts `Lower != Upper` unless both are the minimum or maximum value (ConstantRange.cpp:57):
  // an assertion, off in the oracle's build; rustc never passes such a range (`apply_range_attr` skips a full range).
  // `Attribute::getAsString` (Attributes.cpp:731): `range(i<bits> <lower>, <upper>)`, each bound printed signed
  // (`operator<<(raw_ostream &, const APInt &)` is `print(OS, /*isSigned=*/true)`, APInt.h:2214), the same in a group.
  const signed = (v: bigint): bigint => BigInt.asIntN(NumBits, v);
  return C.getAttribute(`range:${NumBits}:${Lower}:${Upper}`, () => new Attribute("Range", () => `range(i${NumBits} ${signed(Lower)}, ${signed(Upper)})`, false));
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:558 LLVMRustCreateAllocKindAttr
export function LLVMRustCreateAllocKindAttr(C: Context, size_arg: bigint): Attribute {
  // `allocKindFromRust` maps each Rust flag to the AllocFnKind of the same name; `getAsString` lists the set ones in order.
  const k = Number(BigInt.asUintN(32, size_arg));
  const parts = (["alloc", "realloc", "free", "uninitialized", "zeroed", "aligned"] as const).filter((_, i) => k & (1 << i));
  return C.getAttribute(`allockind:${parts.join(",")}`, () => new Attribute("AllocKind", () => `allockind("${parts.join(",")}")`, false));
}

// ---- `MemoryEffects` (llvm/include/llvm/Support/ModRef.h at the pin; lane ir-fix-a) ----------------------------------------
// `MemoryEffectsBase<IRMemLocation>` is a `uint32_t` holding a 2-bit `ModRefInfo` per location (`BitsPerLoc`), at
// `(uint32_t)Loc * 2`; `IRMemLocation` is ArgMem 0, InaccessibleMem 1, ErrnoMem 2, Other 3, TargetMem0 4, TargetMem1 5
// (`First` ArgMem, `Last` TargetMem1). `ModRefInfo`: NoModRef 0, Ref 1, Mod 2, ModRef 3.
const MEM_LOC = { ArgMem: 0, InaccessibleMem: 1, ErrnoMem: 2, Other: 3, TargetMem0: 4, TargetMem1: 5 } as const;
const MEM_LOCATIONS: readonly number[] = [0, 1, 2, 3, 4, 5];
const MEM_TARGET_LOCATIONS: readonly number[] = [MEM_LOC.TargetMem0, MEM_LOC.TargetMem1];
/** `MemoryEffectsBase(ModRefInfo MR)`: every location with `MR` (`none()` is 0, `readOnly()` Ref). */
const memAll = (MR: number): number => MEM_LOCATIONS.reduce((d, loc) => d | (MR << (loc * 2)), 0);
/** `getModRef(Loc)`. */
const memModRef = (Data: number, Loc: number): number => (Data >>> (Loc * 2)) & 3;

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:578 LLVMRustCreateMemoryEffectsAttr
export function LLVMRustCreateMemoryEffectsAttr(C: Context, Effects: MemoryEffects): Attribute {
  switch (Effects) {
    case "None":
      return getWithMemoryEffects(C, memAll(0));
    case "ReadOnly":
      return getWithMemoryEffects(C, memAll(1));
    case "InaccessibleMemOnly":
      // `MemoryEffects::inaccessibleMemOnly()`: `MemoryEffectsBase(Location::InaccessibleMem, ModRefInfo::ModRef)`.
      return getWithMemoryEffects(C, 3 << (MEM_LOC.InaccessibleMem * 2));
    case "ReadOnlyNotPure":
      return getWithMemoryEffects(C, memAll(1) | (3 << (MEM_LOC.InaccessibleMem * 2)));
    default:
      throw new Error("llvm: report_fatal_error: bad MemoryEffects.");
  }
}

// llvm: llvm/lib/IR/Attributes.cpp:281 Attribute::getWithMemoryEffects
function getWithMemoryEffects(C: Context, ME: number): Attribute {
  // `get(Context, Memory, ME.toIntValue())`: an int attribute, printed by `getAsString`'s Memory arm (`memoryAsString`).
  return C.getAttribute(`int:Memory:${ME}`, () => new Attribute("Memory", () => memoryAsString(ME), false));
}

// llvm: llvm/lib/IR/Attributes.cpp:538 getModRefStr
function getModRefStr(MR: number): string {
  switch (MR) {
    case 0:
      return "none";
    case 1:
      return "read";
    case 2:
      return "write";
    case 3:
      return "readwrite";
  }
  throw new Error("llvm: llvm_unreachable: Invalid ModRefInfo");
}

/** `Attribute::getAsString(InAttrGrp)`'s `hasAttribute(Attribute::Memory)` arm (Attributes.cpp:644-703), the same in a group. */
function memoryAsString(ME: number): string {
  let OS = "";
  let First = true;
  OS += "memory(";

  // Print access kind for "other" as the default access kind. This way it will apply to any new location kinds that get split
  // out of "other".
  const OtherMR = memModRef(ME, MEM_LOC.Other);
  // `ME.getModRef()`: the union over all locations.
  const AllMR = MEM_LOCATIONS.reduce((mr, loc) => mr | memModRef(ME, loc), 0);
  if (OtherMR !== 0 || AllMR === OtherMR) {
    First = false;
    OS += getModRefStr(OtherMR);
  }

  let TargetPrintedForAll = false;
  for (const Loc of MEM_LOCATIONS) {
    const MR = memModRef(ME, Loc);
    if (MR === OtherMR) continue;

    if (!First && !TargetPrintedForAll) OS += ", ";
    First = false;

    // isTargetMemLocSameForAll is fine for target location < 3. If more targets are added it should do something like:
    // memory(target_mem:read, target_mem3:none, target_mem5:write).
    const isTargetMemLocSameForAll = MEM_TARGET_LOCATIONS.every((l) => memModRef(ME, l) === memModRef(ME, MEM_LOC.TargetMem0));
    if (MEM_TARGET_LOCATIONS.includes(Loc) && isTargetMemLocSameForAll) {
      if (!TargetPrintedForAll) {
        OS += "target_mem: ";
        OS += getModRefStr(MR);
        TargetPrintedForAll = true;
      }
      // Only works when target memories are last to be listed in Location.
      continue;
    }

    switch (Loc) {
      case MEM_LOC.ArgMem:
        OS += "argmem: ";
        break;
      case MEM_LOC.InaccessibleMem:
        OS += "inaccessiblemem: ";
        break;
      case MEM_LOC.ErrnoMem:
        OS += "errnomem: ";
        break;
      case MEM_LOC.Other:
        throw new Error("llvm: llvm_unreachable: This is represented as the default access kind");
      case MEM_LOC.TargetMem0:
        OS += "target_mem0: ";
        break;
      case MEM_LOC.TargetMem1:
        OS += "target_mem1: ";
        break;
    }
    OS += getModRefStr(MR);
  }
  OS += ")";
  return OS;
}

// llvm: llvm/lib/IR/Core.cpp:228 LLVMCreateStringAttribute
export function LLVMCreateStringAttribute(C: Context, Name: PtrLenStr | undefined, NameLen: number, Value: PtrLenStr | undefined, ValueLen: number): Attribute {
  // `StringRef(K, KLength)`, `StringRef(V, VLength)`: rustc passes a null value with length 0 for a valueless attribute
  // (`llvm::CreateAttrString`, llvm/mod.rs:104), which is the empty string.
  const k = bytesArg(Name, NameLen);
  const v = bytesArg(Value, ValueLen);
  // `Attribute::getAsString` of a string attribute: `"key"`, then `="value"` with the value escaped when it is not empty.
  return C.getAttribute(`str:${k}\0${v}`, () => new Attribute(k, () => (v === "" ? `"${k}"` : `"${k}"="${printEscapedString(v)}"`), true));
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:404 LLVMRustAddFunctionAttributes
export function LLVMRustAddFunctionAttributes(Fn: Value, index: number, Attrs: readonly Attribute[], AttrsLen: number): void {
  // `AddAttributes`: an AttrBuilder over the index's attributes; `addAttribute` replaces an attribute of the same kind.
  const f = asFunction(Fn);
  addAttributesAtIndex(f.attributes, index, Attrs.slice(0, AttrsLen));
}
export { FUNCTION_INDEX };

// ---- printing ----------------------------------------------------------------------------------------------------------

// rustc: compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp:1154 LLVMRustPrintModule
export function LLVMRustPrintModule(M: Module, Output: string | undefined, _Demangle: unknown): LLVMRustResult {
  // `raw_fd_ostream(Path, EC, OF_None)`: a null path is `StringRef()`, the empty path, whose `open` fails with ENOENT; the
  // error's message becomes the last error and the result Failure (review llir-core-a R3).
  if (Output === undefined || Output === "") {
    LLVMRustSetLastError("No such file or directory");
    return LLVMRustResult.Failure;
  }
  // PORT: the oracle prints through an annotation writer that adds `; <demangled>` comments; the normal form drops every
  // comment line (plan-m7 §1b), so the model prints none.
  // Once a tool (tools.ts, lane llir-tools) has rewritten the module, its text is the module.
  const text = module_text(M);
  try {
    writeFileSync(Output, Buffer.from(text, "latin1"));
  } catch (e) {
    // PORT: `std::error_code::message()` of an `open` failure is the C library's strerror text, which Node does not expose;
    // stop rather than guess it.
    return unported(`llir: LLVMRustPrintModule could not open ${JSON.stringify(Output)} (${(e as Error).message}): raw_fd_ostream's error message`);
  }
  return LLVMRustResult.Success;
}

/** `LastError` (RustWrapper.cpp:82), thread-local in C++; one thread here. */
let LAST_ERROR: string | undefined;

/** `LLVMRustSetLastError` (RustWrapper.cpp:140), internal to the wrappers (tools.ts sets it too). */
export function LLVMRustSetLastError(Err: string): void {
  LAST_ERROR = Err;
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:134 LLVMRustGetLastError
export function LLVMRustGetLastError(): string | undefined {
  const ret = LAST_ERROR;
  LAST_ERROR = undefined;
  return ret;
}
