// rust-ts: the IR model's debug-info builder (lane llir-di, plan-m7 D5, D9). Not ported code.
//
// LLVM's `DIBuilder` (llvm/lib/IR/DIBuilder.cpp) as rustc's FFI uses it: the `LLVMDIBuilder*` C API (llvm/lib/IR/DebugInfo.cpp)
// and rustc's `LLVMRustDIBuilder*` / `LLVMRustDI*` wrappers (compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp), the functions of
// ffi.rs that a `-Cdebuginfo` compile reaches. The nodes they make are di_nodes.ts's; debug records (`#dbg_declare`,
// `#dbg_value`) are `DbgVariableRecord`s hung on inst.ts's instructions. Only the `DIBuilder` methods these functions call are
// here, each with its marker; the default arguments the C API leaves to DIBuilder.h are written out at the call.
//
// What the model leaves out, because no path of rustc's makes it: temporary nodes (`trackIfUnresolved` and `UnresolvedNodes`
// track only temporaries, so they are no-ops here), macros, imported entities, labels, `dbg.assign`.
import { unported } from "../../std/panic.ts";
import { bytesArg, cstrArg } from "./core.ts";
import {
  canonicalMDString,
  DIBasicType,
  DICompileUnit,
  DICompositeType,
  DIDerivedType,
  DIEnumerator,
  DIExpression,
  DIFile,
  DIGlobalVariable,
  DIGlobalVariableExpression,
  DILexicalBlock,
  DILexicalBlockFile,
  DILocalVariable,
  DILocation,
  DINamespace,
  DINode,
  DISubprogram,
  DISubrange,
  DISubroutineType,
  DITemplateTypeParameter,
  DW_TAG_array_type,
  DW_TAG_base_type,
  DW_TAG_enumeration_type,
  DW_TAG_member,
  DW_TAG_pointer_type,
  DW_TAG_structure_type,
  DW_TAG_typedef,
  DW_TAG_union_type,
  DW_TAG_variant_part,
  FlagEnumClass,
  FlagStaticMember,
  FlagVector,
  i64AsMetadata,
  i64SignedAsMetadata,
  isLocalScope,
  localScopeSubprogram,
  replaceOperandWith,
  SPFlagDefinition,
  storeImpl,
} from "./di_nodes.ts";
import { type ChecksumKind, ChecksumKind_discriminant, type DebugEmissionKind, DebugEmissionKind_discriminant, type DebugNameTableKind, DebugNameTableKind_discriminant, type DIFlags, type DISPFlags } from "./ffi_types.ts";
import { type BasicBlock, type DbgRecordHook, insertDbgRecordBefore } from "./inst.ts";
import { Constant, ConstantInt, type Context, Function as IrFunction, MDNode, type Metadata, type Module, type Value, ValueAsMetadata } from "./ir.ts";
import type { Printer } from "./printer.ts";
import { type Bool, type PtrLenStr } from "./support.ts";

// ---- debug records -------------------------------------------------------------------------------------------------------

/** `DbgVariableRecord` (llvm/IR/DebugProgramInstruction.h): a `#dbg_declare` or `#dbg_value`. The location is the value's
 * `ValueAsMetadata`, so RAUW of the value reaches it as it reaches LLVM's. */
export class DbgVariableRecord implements DbgRecordHook {
  constructor(
    readonly type: "declare" | "value",
    readonly location: ValueAsMetadata,
    readonly variable: DILocalVariable,
    readonly expression: DIExpression,
    readonly debugLoc: DILocation,
  ) {}

  // llvm: llvm/lib/IR/AsmWriter.cpp:4921 AssemblyWriter::printDbgVariableRecord
  printRecord(p: Printer): string {
    const printOrNull = (m: Metadata | undefined): string => (m === undefined ? "(null)" : p.metadataOperand(m));
    return `#dbg_${this.type}(${printOrNull(this.location)}, ${printOrNull(this.variable)}, ${printOrNull(this.expression)}, ${printOrNull(this.debugLoc)})`;
  }
}

// ---- DIBuilder -----------------------------------------------------------------------------------------------------------

/** `getNonCompileUnitScope` (DIBuilder.cpp:138): a compile unit (or null) is no scope. */
function getNonCompileUnitScope(n: Metadata | undefined): Metadata | undefined {
  if (n === undefined || n instanceof DICompileUnit) return undefined;
  return n;
}

/** `DICompositeType::get(Context, Tag, Name, File, Line, Scope, BaseType, uint64_t SizeInBits, AlignInBits, uint64_t
 * OffsetInBits, Flags, Elements, RuntimeLang, EnumKind, VTableHolder, TemplateParams, Identifier, Discriminator, DataLocation,
 * Associated, Allocated, Rank, Annotations, Specification, NumExtraInhabitants, BitStride)` (DebugInfoMetadata.h:1646). */
interface CompositeArgs {
  tag: number;
  name: string;
  file: Metadata | undefined;
  line: number;
  scope: Metadata | undefined;
  baseType: Metadata | undefined;
  size: bigint;
  align: number;
  offset: bigint;
  flags: number;
  elements: Metadata | undefined;
  runtimeLang: number;
  vtableHolder?: Metadata;
  templateParams?: Metadata;
  identifier: string;
  discriminator?: Metadata;
  bitStride?: Metadata;
}
function getComposite(ctx: Context, a: CompositeArgs): DICompositeType {
  // Ops: File, Scope, Name, SizeInBits, OffsetInBits, BaseType, Elements, VTableHolder, TemplateParams, Identifier,
  // Discriminator, DataLocation, Associated, Allocated, Rank, Annotations, Specification, BitStride.
  const ops = [a.file, a.scope, canonicalMDString(ctx, a.name), i64AsMetadata(ctx, a.size), i64AsMetadata(ctx, a.offset), a.baseType, a.elements, a.vtableHolder, a.templateParams, canonicalMDString(ctx, a.identifier), a.discriminator, undefined, undefined, undefined, undefined, undefined, undefined, a.bitStride];
  return storeImpl(new DICompositeType(ctx, a.tag, a.line, a.runtimeLang, a.align, 0, undefined, a.flags, ops));
}

/** `DIDerivedType::get(Context, Tag, StringRef Name, File, Line, Scope, BaseType, uint64_t SizeInBits, AlignInBits, uint64_t
 * OffsetInBits, DWARFAddressSpace, PtrAuthData = none, Flags, ExtraData, Annotations)` (DebugInfoMetadata.h:1326). */
function getDerived(ctx: Context, tag: number, name: string, file: Metadata | undefined, line: number, scope: Metadata | undefined, baseType: Metadata | undefined, size: bigint, align: number, offset: bigint, dwarfAddressSpace: number | undefined, flags: number, extraData: Metadata | undefined): DIDerivedType {
  return storeImpl(new DIDerivedType(ctx, tag, canonicalMDString(ctx, name), file, line, scope, baseType, i64AsMetadata(ctx, size), align, i64AsMetadata(ctx, offset), dwarfAddressSpace, flags, extraData, undefined));
}

/** `getConstantOrNull` (DIBuilder.cpp:478). */
function getConstantOrNull(c: Constant | undefined): ValueAsMetadata | undefined {
  return c === undefined ? undefined : c.context.constantAsMetadata(c);
}

/** `DIBuilder` (llvm/IR/DIBuilder.h): the compile unit and the lists `finalize` writes into it. */
export class DIBuilder {
  readonly VMContext: Context;
  CUNode: DICompileUnit | undefined;
  readonly EnumTypes: Metadata[] = [];
  readonly AllRetainTypes: Metadata[] = [];
  readonly AllSubprograms: DISubprogram[] = [];
  readonly Globals: Metadata[] = [];
  readonly ImportedModules: Metadata[] = [];
  /** `SubprogramTrackedNodes`: the nodes a subprogram retains (its `AlwaysPreserve` variables and local types). */
  readonly SubprogramTrackedNodes = new Map<DISubprogram, MDNode[]>();

  // llvm: llvm/lib/IR/DIBuilder.cpp:27 DIBuilder::DIBuilder
  constructor(
    readonly M: Module,
    readonly AllowUnresolvedNodes = true,
  ) {
    // No compile unit is passed by the C API, so nothing is read back from one.
    this.VMContext = M.context;
  }

  /** `getSubprogramNodesTrackingVector(S)` (DIBuilder.h:83). */
  private getSubprogramNodesTrackingVector(s: Metadata): MDNode[] {
    const sp = localScopeSubprogram(s);
    if (sp === undefined) return unported("llir: DIBuilder tracking vector of a scope that is not a DILocalScope");
    let v = this.SubprogramTrackedNodes.get(sp);
    if (v === undefined) this.SubprogramTrackedNodes.set(sp, (v = []));
    return v;
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:54 DIBuilder::finalizeSubprogram
  finalizeSubprogram(SP: DISubprogram): void {
    const PN = this.SubprogramTrackedNodes.get(SP);
    if (PN === undefined) return;
    // `SetVector`: insertion order, no duplicates.
    const RetainedNodes: MDNode[] = [];
    const existing = SP.ops[7];
    const prior = existing instanceof MDNode ? (existing.ops as MDNode[]) : [];
    for (const N of [...prior, ...PN]) {
      // If the tracked node N was temporary, and the DIBuilder user replaced it with a node that does not belong to SP or is
      // non-local, do not add N to SP's retainedNodes list.
      const scope = getRawRetainedNodeScope(N);
      if (isLocalScope(scope) && localScopeSubprogram(scope) === SP && !RetainedNodes.includes(N)) RetainedNodes.push(N);
    }
    // `SP->replaceRetainedNodes(MDTuple::get(VMContext, RetainedNodes))`.
    replaceOperandWith(SP, 7, this.VMContext.getMDNode(RetainedNodes));
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:74 DIBuilder::finalize
  finalize(): void {
    const CU = this.CUNode;
    if (CU === undefined) return;
    if (this.EnumTypes.length !== 0) replaceOperandWith(CU, 4, this.VMContext.getMDNode(this.EnumTypes));
    // Declarations and definitions of the same type may be retained. Use a set to remove the duplicates.
    const RetainValues: Metadata[] = [];
    for (const N of this.AllRetainTypes) if (!RetainValues.includes(N)) RetainValues.push(N);
    if (RetainValues.length !== 0) replaceOperandWith(CU, 5, this.VMContext.getMDNode(RetainValues));
    for (const SP of this.AllSubprograms) this.finalizeSubprogram(SP);
    for (const N of RetainValues) if (N instanceof DISubprogram) this.finalizeSubprogram(N);
    if (this.Globals.length !== 0) replaceOperandWith(CU, 6, this.VMContext.getMDNode(this.Globals));
    if (this.ImportedModules.length !== 0) replaceOperandWith(CU, 7, this.VMContext.getMDNode(this.ImportedModules));
    // No macros (`AllMacrosPerParent` is empty) and no temporaries (`UnresolvedNodes` is empty) on rustc's paths.
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:145 DIBuilder::createCompileUnit
  createCompileUnit(Lang: number, File: Metadata | undefined, Producer: string, isOptimized: boolean, Flags: string, RunTimeVer: number, SplitName: string, Kind: number, DWOId: bigint, SplitDebugInlining: boolean, DebugInfoForProfiling: boolean, NameTableKind: number, RangesBaseAddress = false, SysRoot = "", SDK = ""): DICompileUnit {
    // assert(!CUNode && "Can only make one compile unit per DIBuilder instance");
    const ctx = this.VMContext;
    this.CUNode = new DICompileUnit(ctx, Lang, isOptimized, RunTimeVer, Kind, DWOId, SplitDebugInlining, DebugInfoForProfiling, NameTableKind, RangesBaseAddress, [
      File,
      canonicalMDString(ctx, Producer),
      canonicalMDString(ctx, Flags),
      canonicalMDString(ctx, SplitName),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      canonicalMDString(ctx, SysRoot),
      canonicalMDString(ctx, SDK),
    ]);
    // Create a named metadata so that it is easier to find cu in a module.
    this.M.getOrInsertNamedMetadata("llvm.dbg.cu").push(this.CUNode);
    return this.CUNode;
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:221 DIBuilder::createFile
  /** `CS` is the checksum kind (1 MD5, 2 SHA1, 3 SHA256) and value; `Source` undefined is none. Strings are byte strings. */
  createFile(Filename: string, Directory: string, CS: [number, string] | undefined, Source: string | undefined): DIFile {
    const ctx = this.VMContext;
    // `DIFile::get(Context, StringRef...)` (DebugInfoMetadata.h:629): the source is not canonicalized (empty is a source).
    return storeImpl(new DIFile(ctx, canonicalMDString(ctx, Filename), canonicalMDString(ctx, Directory), CS?.[0], CS === undefined ? undefined : canonicalMDString(ctx, CS[1]), Source === undefined ? undefined : ctx.getMDString(Source)));
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:259 DIBuilder::createEnumerator
  /** The `APSInt` overload: `value` is the bit pattern of width `bits`. */
  createEnumerator(Name: string, value: bigint, bits: number, isUnsigned: boolean): DIEnumerator {
    // assert(!Name.empty() && "Unable to create enumerator without name");
    const ctx = this.VMContext;
    return storeImpl(new DIEnumerator(ctx, value, bits, isUnsigned, canonicalMDString(ctx, Name)));
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:273 DIBuilder::createBasicType
  createBasicType(Name: string, SizeInBits: bigint, Encoding: number, Flags = 0, NumExtraInhabitants = 0, DataSizeInBits = 0): DIBasicType {
    const ctx = this.VMContext;
    return storeImpl(new DIBasicType(ctx, DW_TAG_base_type, canonicalMDString(ctx, Name), undefined, 0, undefined, i64AsMetadata(ctx, SizeInBits), 0, Encoding, NumExtraInhabitants, DataSizeInBits, Flags));
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:362 DIBuilder::createQualifiedType
  createQualifiedType(Tag: number, FromTy: Metadata | undefined): DIDerivedType {
    return getDerived(this.VMContext, Tag, "", undefined, 0, undefined, FromTy, 0n, 0, 0n, undefined, 0, undefined);
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:382 DIBuilder::createPointerType
  createPointerType(PointeeTy: Metadata | undefined, SizeInBits: bigint, AlignInBits: number, DWARFAddressSpace: number | undefined, Name: string): DIDerivedType {
    // FIXME: Why is there a name here?
    return getDerived(this.VMContext, DW_TAG_pointer_type, Name, undefined, 0, undefined, PointeeTy, SizeInBits, AlignInBits, 0n, DWARFAddressSpace, 0, undefined);
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:414 DIBuilder::createTypedef
  createTypedef(Ty: Metadata | undefined, Name: string, File: Metadata | undefined, LineNo: number, Context: Metadata | undefined, AlignInBits: number, Flags = 0): DIDerivedType {
    const T = getDerived(this.VMContext, DW_TAG_typedef, Name, File, LineNo, getNonCompileUnitScope(Context), Ty, 0n, AlignInBits, 0n, undefined, Flags, undefined);
    if (isLocalScope(Context)) this.getSubprogramNodesTrackingVector(Context!).push(T);
    return T;
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:473 DIBuilder::createMemberType
  createMemberType(Scope: Metadata | undefined, Name: string, File: Metadata | undefined, LineNumber: number, SizeInBits: bigint, AlignInBits: number, OffsetInBits: bigint, Flags: number, Ty: Metadata | undefined): DIDerivedType {
    return getDerived(this.VMContext, DW_TAG_member, Name, File, LineNumber, getNonCompileUnitScope(Scope), Ty, SizeInBits, AlignInBits, OffsetInBits, undefined, Flags, undefined);
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:489 DIBuilder::createVariantMemberType
  createVariantMemberType(Scope: Metadata | undefined, Name: string, File: Metadata | undefined, LineNumber: number, SizeInBits: bigint, AlignInBits: number, OffsetInBits: bigint, Discriminant: Constant | undefined, Flags: number, Ty: Metadata | undefined): DIDerivedType {
    // "ExtraData" is overloaded for bit fields and for variants, so make sure to disallow this.
    // assert((Flags & DINode::FlagBitField) == 0);
    return getDerived(this.VMContext, DW_TAG_member, Name, File, LineNumber, getNonCompileUnitScope(Scope), Ty, SizeInBits, AlignInBits, OffsetInBits, undefined, Flags, getConstantOrNull(Discriminant));
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:545 DIBuilder::createStaticMemberType
  createStaticMemberType(Scope: Metadata | undefined, Name: string, File: Metadata | undefined, LineNumber: number, Ty: Metadata | undefined, Flags: number, Val: Constant | undefined, Tag: number, AlignInBits: number): DIDerivedType {
    Flags |= FlagStaticMember;
    return getDerived(this.VMContext, Tag, Name, File, LineNumber, getNonCompileUnitScope(Scope), Ty, 0n, AlignInBits, 0n, undefined, Flags, getConstantOrNull(Val));
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:576 DIBuilder::createTemplateTypeParameter
  createTemplateTypeParameter(Context: Metadata | undefined, Name: string, Ty: Metadata | undefined, isDefault: boolean): DITemplateTypeParameter {
    // assert((!Context || isa<DICompileUnit>(Context)) && "Expected compile unit");
    const ctx = this.VMContext;
    return storeImpl(new DITemplateTypeParameter(ctx, canonicalMDString(ctx, Name), Ty, isDefault));
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:655 DIBuilder::createStructType
  createStructType(Context: Metadata | undefined, Name: string, File: Metadata | undefined, LineNumber: number, SizeInBits: bigint, AlignInBits: number, Flags: number, DerivedFrom: Metadata | undefined, Elements: Metadata | undefined, RunTimeLang: number, VTableHolder: Metadata | undefined, UniqueIdentifier: string): DICompositeType {
    const R = getComposite(this.VMContext, { tag: DW_TAG_structure_type, name: Name, file: File, line: LineNumber, scope: getNonCompileUnitScope(Context), baseType: DerivedFrom, size: SizeInBits, align: AlignInBits, offset: 0n, flags: Flags, elements: Elements, runtimeLang: RunTimeLang, vtableHolder: VTableHolder, identifier: UniqueIdentifier });
    if (isLocalScope(Context)) this.getSubprogramNodesTrackingVector(Context!).push(R);
    return R;
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:673 DIBuilder::createUnionType
  createUnionType(Scope: Metadata | undefined, Name: string, File: Metadata | undefined, LineNumber: number, SizeInBits: bigint, AlignInBits: number, Flags: number, Elements: Metadata | undefined, RunTimeLang: number, UniqueIdentifier: string): DICompositeType {
    const R = getComposite(this.VMContext, { tag: DW_TAG_union_type, name: Name, file: File, line: LineNumber, scope: getNonCompileUnitScope(Scope), baseType: undefined, size: SizeInBits, align: AlignInBits, offset: 0n, flags: Flags, elements: Elements, runtimeLang: RunTimeLang, identifier: UniqueIdentifier });
    if (isLocalScope(Scope)) this.getSubprogramNodesTrackingVector(Scope!).push(R);
    return R;
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:691 DIBuilder::createVariantPart
  createVariantPart(Scope: Metadata | undefined, Name: string, File: Metadata | undefined, LineNumber: number, SizeInBits: bigint, AlignInBits: number, Flags: number, Discriminator: Metadata | undefined, Elements: Metadata | undefined, UniqueIdentifier: string): DICompositeType {
    return getComposite(this.VMContext, { tag: DW_TAG_variant_part, name: Name, file: File, line: LineNumber, scope: getNonCompileUnitScope(Scope), baseType: undefined, size: SizeInBits, align: AlignInBits, offset: 0n, flags: Flags, elements: Elements, runtimeLang: 0, identifier: UniqueIdentifier, discriminator: Discriminator });
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:705 DIBuilder::createSubroutineType
  createSubroutineType(ParameterTypes: Metadata | undefined, Flags = 0, CC = 0): DISubroutineType {
    return storeImpl(new DISubroutineType(this.VMContext, Flags, CC, ParameterTypes));
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:711 DIBuilder::createEnumerationType
  createEnumerationType(Scope: Metadata | undefined, Name: string, File: Metadata | undefined, LineNumber: number, SizeInBits: bigint, AlignInBits: number, Elements: Metadata | undefined, UnderlyingType: Metadata | undefined, RunTimeLang = 0, UniqueIdentifier = "", IsScoped = false): DICompositeType {
    const CTy = getComposite(this.VMContext, { tag: DW_TAG_enumeration_type, name: Name, file: File, line: LineNumber, scope: getNonCompileUnitScope(Scope), baseType: UnderlyingType, size: SizeInBits, align: AlignInBits, offset: 0n, flags: IsScoped ? FlagEnumClass : 0, elements: Elements, runtimeLang: RunTimeLang, identifier: UniqueIdentifier });
    if (isLocalScope(Scope)) this.getSubprogramNodesTrackingVector(Scope!).push(CTy);
    else this.EnumTypes.push(CTy);
    return CTy;
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:754 DIBuilder::createArrayType
  /** The full overload, as the short one (DIBuilder.cpp:744) calls it: no scope, name or file, and null bounds expressions. */
  createArrayType(Size: bigint, AlignInBits: number, Ty: Metadata | undefined, Subscripts: Metadata | undefined): DICompositeType {
    return getComposite(this.VMContext, { tag: DW_TAG_array_type, name: "", file: undefined, line: 0, scope: undefined, baseType: Ty, size: Size, align: AlignInBits, offset: 0n, flags: 0, elements: Subscripts, runtimeLang: 0, identifier: "" });
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:780 DIBuilder::createVectorType
  createVectorType(Size: bigint, AlignInBits: number, Ty: Metadata | undefined, Subscripts: Metadata | undefined, BitStride: Metadata | undefined): DICompositeType {
    return getComposite(this.VMContext, { tag: DW_TAG_array_type, name: "", file: undefined, line: 0, scope: undefined, baseType: Ty, size: Size, align: AlignInBits, offset: 0n, flags: FlagVector, elements: Subscripts, runtimeLang: 0, identifier: "", bitStride: BitStride });
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:875 DIBuilder::getOrCreateArray
  getOrCreateArray(Elements: readonly (Metadata | undefined)[]): MDNode {
    return this.VMContext.getMDNode(Elements);
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:884 DIBuilder::getOrCreateTypeArray
  getOrCreateTypeArray(Elements: readonly (Metadata | undefined)[]): MDNode {
    // `cast<DIType>(E)` for the nodes, the others as they are: the same operands.
    return this.VMContext.getMDNode(Elements);
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:895 DIBuilder::getOrCreateSubrange
  getOrCreateSubrange(Lo: bigint, Count: bigint): DISubrange {
    const ctx = this.VMContext;
    const LB = i64SignedAsMetadata(ctx, Lo);
    const CountNode = i64SignedAsMetadata(ctx, Count);
    return DISubrange.get(ctx, CountNode, LB, undefined, undefined);
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:909 DIBuilder::getOrCreateSubrange
  getOrCreateSubrangeMD(CountNode: Metadata | undefined, LB: Metadata | undefined, UB: Metadata | undefined, Stride: Metadata | undefined): DISubrange {
    return DISubrange.get(this.VMContext, CountNode, LB, UB, Stride);
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:948 DIBuilder::createGlobalVariableExpression
  createGlobalVariableExpression(Context: Metadata | undefined, Name: string, LinkageName: string, F: Metadata | undefined, LineNumber: number, Ty: Metadata | undefined, IsLocalToUnit: boolean, isDefined: boolean, Expr: DIExpression | undefined, Decl: Metadata | undefined, TemplateParams: Metadata | undefined, AlignInBits: number): DIGlobalVariableExpression {
    const ctx = this.VMContext;
    const name = canonicalMDString(ctx, Name);
    // Ops: Scope, Name, File, Type, Name, LinkageName, StaticDataMemberDeclaration, TemplateParams, Annotations.
    const GV = new DIGlobalVariable(ctx, true, LineNumber, IsLocalToUnit, isDefined, AlignInBits, [Context, name, F, Ty, name, canonicalMDString(ctx, LinkageName), Decl, TemplateParams, undefined]);
    if (Expr === undefined) Expr = this.createExpression([]);
    const N = storeImpl(new DIGlobalVariableExpression(ctx, [GV, Expr], false));
    if (isLocalScope(Context)) this.getSubprogramNodesTrackingVector(Context!).push(N);
    else this.Globals.push(N);
    return N;
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:1004 DIBuilder::createAutoVariable
  createAutoVariable(Scope: Metadata, Name: string, File: Metadata | undefined, LineNo: number, Ty: Metadata | undefined, AlwaysPreserve: boolean, Flags: number, AlignInBits: number): DILocalVariable {
    // assert(Scope && isa<DILocalScope>(Scope) && "Unexpected scope for a local variable.");
    return this.createLocalVariable(Scope, Name, 0, File, LineNo, Ty, AlwaysPreserve, Flags, AlignInBits);
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:1016 DIBuilder::createParameterVariable
  createParameterVariable(Scope: Metadata, Name: string, ArgNo: number, File: Metadata | undefined, LineNo: number, Ty: Metadata | undefined, AlwaysPreserve: boolean, Flags: number): DILocalVariable {
    // assert(ArgNo && "Expected non-zero argument number for parameter");
    // assert(Scope && isa<DILocalScope>(Scope) && "Unexpected scope for a local variable.");
    return this.createLocalVariable(Scope, Name, ArgNo, File, LineNo, Ty, AlwaysPreserve, Flags, 0);
  }

  /** `createLocalVariable` (DIBuilder.cpp:984, a static helper given `getSubprogramNodesTrackingVector(Scope)`). */
  private createLocalVariable(Context: Metadata, Name: string, ArgNo: number, File: Metadata | undefined, LineNo: number, Ty: Metadata | undefined, AlwaysPreserve: boolean, Flags: number, AlignInBits: number): DILocalVariable {
    const ctx = this.VMContext;
    const PreservedNodes = this.getSubprogramNodesTrackingVector(Context);
    // `DILocalVariable::getImpl` (DebugInfoMetadata.cpp:1631).
    const Node = storeImpl(new DILocalVariable(ctx, Context, canonicalMDString(ctx, Name), File, LineNo, Ty, ArgNo, Flags, AlignInBits, undefined));
    // The optimizer may remove local variables. If there is an interest to preserve variable info in such situation then stash
    // it in a named mdnode.
    if (AlwaysPreserve) PreservedNodes.push(Node);
    return Node;
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:1046 DIBuilder::createExpression
  createExpression(Addr: readonly bigint[]): DIExpression {
    // `DIExpression::getImpl` (DebugInfoMetadata.cpp:1700): uniqued by its elements.
    return storeImpl(new DIExpression(this.VMContext, Addr.map((a) => BigInt.asUintN(64, a))));
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:1057 DIBuilder::createFunction
  createFunction(Context: Metadata | undefined, Name: string, LinkageName: string, File: Metadata | undefined, LineNo: number, Ty: Metadata | undefined, ScopeLine: number, Flags: number, SPFlags: number, TParams: Metadata | undefined, Decl: Metadata | undefined): DISubprogram {
    const IsDefinition = (SPFlags & SPFlagDefinition) !== 0;
    // `getSubprogram(IsDistinct, ...)` with ContainingType null, VirtualIndex 0, ThisAdjustment 0, ThrownTypes and Annotations
    // null, TargetFuncName "", UseKeyInstructions false (DIBuilder.h's defaults).
    const Node = this.getSubprogram(IsDefinition, getNonCompileUnitScope(Context), Name, LinkageName, File, LineNo, Ty, ScopeLine, undefined, 0, 0, Flags, SPFlags, IsDefinition ? this.CUNode : undefined, TParams, Decl, false);
    this.AllSubprograms.push(Node);
    return Node;
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:1091 DIBuilder::createMethod
  createMethod(Context: Metadata | undefined, Name: string, LinkageName: string, F: Metadata | undefined, LineNo: number, Ty: Metadata | undefined, VIndex: number, ThisAdjustment: number, VTableHolder: Metadata | undefined, Flags: number, SPFlags: number, TParams: Metadata | undefined): DISubprogram {
    // assert(getNonCompileUnitScope(Context) && "Methods should have both a Context and a context that isn't the compile unit.");
    // FIXME: Do we want to use different scope/lines?
    const IsDefinition = (SPFlags & SPFlagDefinition) !== 0;
    const SP = this.getSubprogram(IsDefinition, Context, Name, LinkageName, F, LineNo, Ty, LineNo, VTableHolder, VIndex, ThisAdjustment, Flags, SPFlags, IsDefinition ? this.CUNode : undefined, TParams, undefined, false);
    this.AllSubprograms.push(SP);
    return SP;
  }

  /** `getSubprogram(IsDistinct, ...)` (DIBuilder.cpp:1050), `DISubprogram::get[Distinct]` with RetainedNodes, ThrownTypes,
   * Annotations and TargetFuncName null (DebugInfoMetadata.cpp:1405). */
  private getSubprogram(IsDistinct: boolean, Scope: Metadata | undefined, Name: string, LinkageName: string, File: Metadata | undefined, Line: number, Type: Metadata | undefined, ScopeLine: number, ContainingType: Metadata | undefined, VirtualIndex: number, ThisAdjustment: number, Flags: number, SPFlags: number, Unit: Metadata | undefined, TemplateParams: Metadata | undefined, Declaration: Metadata | undefined, UsesKeyInstructions: boolean): DISubprogram {
    const ctx = this.VMContext;
    // Ops: File, Scope, Name, LinkageName, Type, Unit, Declaration, RetainedNodes, ContainingType, TemplateParams, ThrownTypes,
    // Annotations, TargetFuncName.
    const ops = [File, Scope, canonicalMDString(ctx, Name), canonicalMDString(ctx, LinkageName), Type, Unit, Declaration, undefined, ContainingType, TemplateParams, undefined, undefined, undefined];
    return storeImpl(new DISubprogram(ctx, IsDistinct, Line, ScopeLine, VirtualIndex, ThisAdjustment, Flags, SPFlags, UsesKeyInstructions, ops));
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:1120 DIBuilder::createNameSpace
  createNameSpace(Scope: Metadata | undefined, Name: string, ExportSymbols: boolean): DINamespace {
    // It is okay to *not* make anonymous top-level namespaces distinct.
    const ctx = this.VMContext;
    return storeImpl(new DINamespace(ctx, getNonCompileUnitScope(Scope), canonicalMDString(ctx, Name), ExportSymbols));
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:1141 DIBuilder::createLexicalBlockFile
  createLexicalBlockFile(Scope: Metadata, File: Metadata | undefined, Discriminator: number): DILexicalBlockFile {
    return DILexicalBlockFile.get(this.VMContext, Scope, File, Discriminator);
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:1147 DIBuilder::createLexicalBlock
  createLexicalBlock(Scope: Metadata, File: Metadata | undefined, Line: number, Col: number): DILexicalBlock {
    // Make these distinct, to avoid merging two lexical blocks on the same file/line/column.
    // `DILexicalBlock::getImpl` (DebugInfoMetadata.cpp:1500): the column is set to 0 when it does not fit in 16 bits;
    // assert(Scope && "Expected scope").
    return new DILexicalBlock(this.VMContext, true, getNonCompileUnitScope(Scope)!, File, Line, Col >= 1 << 16 ? 0 : Col);
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:1155 DIBuilder::insertDeclare
  /** The `BasicBlock *InsertAtEnd` overload: before the block's terminator if it has one, else at its end. */
  insertDeclare(Storage: Value, VarInfo: DILocalVariable, Expr: DIExpression, DL: DILocation, InsertAtEnd: BasicBlock): DbgVariableRecord {
    const last = InsertAtEnd.insts[InsertAtEnd.insts.length - 1];
    const at = last !== undefined && last.isTerminator() ? InsertAtEnd.insts.length - 1 : InsertAtEnd.insts.length;
    // The `InsertPosition` overload (DIBuilder.cpp:1208): `createDVRDeclare`, then `insertDbgVariableRecord`.
    // assert(DL->getScope()->getSubprogram() == VarInfo->getScope()->getSubprogram() && "Expected matching subprograms");
    const DVR = new DbgVariableRecord("declare", this.VMContext.constantAsMetadata(Storage), VarInfo, Expr, DL);
    this.insertDbgVariableRecord(DVR, InsertAtEnd, at);
    return DVR;
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:1197 DIBuilder::insertDbgValueIntrinsic
  insertDbgValueIntrinsic(Val: Value, VarInfo: DILocalVariable, Expr: DIExpression, DL: DILocation, InsertBB: BasicBlock, at: number): DbgVariableRecord {
    // `DbgVariableRecord::createDbgVariableRecord(Val, VarInfo, Expr, DL)`.
    const DVR = new DbgVariableRecord("value", this.VMContext.constantAsMetadata(Val), VarInfo, Expr, DL);
    this.insertDbgVariableRecord(DVR, InsertBB, at);
    return DVR;
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:1241 DIBuilder::insertDbgVariableRecord
  /** `at` indexes the instruction the record goes before (`insts.length` is `end()`); the position's head bit is unset. */
  private insertDbgVariableRecord(DVR: DbgVariableRecord, BB: BasicBlock, at: number): void {
    // `trackIfUnresolved` of the variable and expression: they are never temporary here.
    insertDbgRecordBefore(BB, DVR, at, false);
  }

  // llvm: llvm/lib/IR/DIBuilder.cpp:1314 DIBuilder::replaceArrays
  replaceArrays(T: DICompositeType, Elements: Metadata | undefined, TParams: Metadata | undefined): void {
    // `N->replaceElements(Elements)` (operand 6) and `N->replaceTemplateParams(TParams)` (operand 8), each only when given.
    if (Elements !== undefined) replaceOperandWith(T, 6, Elements);
    if (TParams !== undefined) replaceOperandWith(T, 8, TParams);
    // Tracking unresolved arrays after a self-reference cycle only matters for temporaries, which rustc does not make.
  }
}

/** `DISubprogram::getRawRetainedNodeScope` (DebugInfoMetadata.cpp:1460): the scope of a retained local variable, type or global
 * variable expression (labels and imported entities are not made here). */
function getRawRetainedNodeScope(N: MDNode): Metadata | undefined {
  if (N instanceof DILocalVariable) return N.rawScope;
  if (N instanceof DIGlobalVariableExpression) {
    const v = N.ops[0];
    return v instanceof DIGlobalVariable ? v.ops[0] : undefined;
  }
  if (N instanceof DIBasicType || N instanceof DIDerivedType || N instanceof DICompositeType || N instanceof DISubroutineType) return N.ops[1];
  return undefined;
}

// ---- argument conversions ------------------------------------------------------------------------------------------------

const asDIBuilder = (b: unknown): DIBuilder => {
  if (!(b instanceof DIBuilder)) throw new Error("llvm: unwrap<DIBuilder> of something that is not a DIBuilder");
  return b;
};
const asLocation = (m: Metadata | undefined): DILocation => {
  if (!(m instanceof DILocation)) throw new Error("llvm: unwrap<DILocation> of metadata that is not a DILocation");
  return m;
};
const asLocalVariable = (m: Metadata): DILocalVariable => {
  if (!(m instanceof DILocalVariable)) throw new Error("llvm: unwrap<DILocalVariable> of metadata that is not a DILocalVariable");
  return m;
};
const asExpression = (m: Metadata | undefined): DIExpression => {
  if (!(m instanceof DIExpression)) throw new Error("llvm: unwrap<DIExpression> of metadata that is not a DIExpression");
  return m;
};
const asComposite = (m: Metadata): DICompositeType => {
  if (!(m instanceof DICompositeType)) throw new Error("llvm: unwrap<DICompositeType> of metadata that is not a DICompositeType");
  return m;
};
/** `unwrap<MDTuple>` / `DINodeArray(unwrapDI<MDTuple>(...))`: an array node (an MDTuple), or null. */
const asTuple = (m: Metadata | undefined): MDNode | undefined => {
  if (m === undefined) return undefined;
  if (!(m instanceof MDNode) || m instanceof DINode) throw new Error("llvm: unwrap<MDTuple> of metadata that is not a tuple");
  return m;
};
const asConstant = (v: Value | undefined): Constant | undefined => {
  if (v === undefined) return undefined;
  if (!(v instanceof Constant)) throw new Error("llvm: unwrap<Constant> of a value that is not a constant");
  return v;
};
/** A `LLVMDIFlags` / `DINode::DIFlags`: the same bits (`map_from_llvmDIFlags` is a cast). */
const diFlags = (f: DIFlags): number => f >>> 0;

/** RustWrapper.cpp `fromRust(LLVMDIFlags)` (:734): unknown bits are a fatal error, otherwise a cast. */
function fromRustDIFlags(Flags: DIFlags): number {
  // Check that all set bits are covered by the static assertions above.
  const UNKNOWN_BITS = ((1 << 31) | (1 << 30) | (1 << 29) | (1 << 21)) >>> 0;
  if ((Flags & UNKNOWN_BITS) !== 0) throw new Error("llvm: bad LLVMDIFlags");
  return Flags >>> 0;
}

/** RustWrapper.cpp `fromRust(LLVMRustDISPFlags)` (:785): virtuality, then each flag to LLVM's bit (MainSubprogram is 1 << 5 in
 * rustc's enum and 1 << 8 in LLVM's). */
function fromRustDISPFlags(SPFlags: DISPFlags): number {
  let Result = 0;
  switch (SPFlags & 0x3) {
    case 1:
      Result |= 1; // SPFlagVirtual
      break;
    case 2:
      Result |= 2; // SPFlagPureVirtual
      break;
    default:
      // The rest are handled below
      break;
  }
  if (SPFlags & (1 << 2)) Result |= 1 << 2; // SPFlagLocalToUnit
  if (SPFlags & (1 << 3)) Result |= 1 << 3; // SPFlagDefinition
  if (SPFlags & (1 << 4)) Result |= 1 << 4; // SPFlagOptimized
  if (SPFlags & (1 << 5)) Result |= 1 << 8; // SPFlagMainSubprogram
  return Result;
}

// ---- the C API (llvm/lib/IR/DebugInfo.cpp) -------------------------------------------------------------------------------

// llvm: llvm/lib/IR/DebugInfo.cpp:1156 LLVMCreateDIBuilder
export function LLVMCreateDIBuilder(M: Module): DIBuilder | undefined {
  return new DIBuilder(M);
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1168 LLVMDisposeDIBuilder
export function LLVMDisposeDIBuilder(_Builder: DIBuilder): void {
  // `delete unwrap(Builder)`: the builder holds nothing the module needs.
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1172 LLVMDIBuilderFinalize
export function LLVMDIBuilderFinalize(Builder: DIBuilder): void {
  asDIBuilder(Builder).finalize();
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1251 LLVMDIBuilderCreateNameSpace
export function LLVMDIBuilderCreateNameSpace(Builder: DIBuilder, ParentScope: Metadata | undefined, Name: PtrLenStr | undefined, NameLen: number, ExportSymbols: Bool): Metadata {
  return asDIBuilder(Builder).createNameSpace(ParentScope, bytesArg(Name, NameLen), ExportSymbols.is_true());
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1274 LLVMDIBuilderCreateLexicalBlock
export function LLVMDIBuilderCreateLexicalBlock(Builder: DIBuilder, Scope: Metadata, File: Metadata, Line: number, Column: number): Metadata {
  return asDIBuilder(Builder).createLexicalBlock(Scope, File, Line, Column);
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1283 LLVMDIBuilderCreateLexicalBlockFile
export function LLVMDIBuilderCreateLexicalBlockFile(Builder: DIBuilder, Scope: Metadata, File: Metadata, Discriminator: number): Metadata {
  return asDIBuilder(Builder).createLexicalBlockFile(Scope, File, Discriminator);
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1344 LLVMDIBuilderCreateDebugLocation
export function LLVMDIBuilderCreateDebugLocation(Ctx: Context, Line: number, Column: number, Scope: Metadata, InlinedAt: Metadata | undefined): Metadata {
  return DILocation.get(Ctx, Line, Column, Scope, InlinedAt);
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1420 LLVMDIBuilderCreateEnumeratorOfArbitraryPrecision
export function LLVMDIBuilderCreateEnumeratorOfArbitraryPrecision(Builder: DIBuilder, Name: PtrLenStr | undefined, NameLen: number, SizeInBits: bigint, Words: readonly bigint[], IsUnsigned: Bool): Metadata {
  const NumWords = Number((SizeInBits + 63n) / 64n);
  // `APInt(SizeInBits, ArrayRef(Words, NumWords))`: the words little-endian, truncated to the width.
  let v = 0n;
  for (let i = 0; i < NumWords; i++) v |= BigInt.asUintN(64, Words[i]!) << BigInt(64 * i);
  const bits = Number(SizeInBits);
  return asDIBuilder(Builder).createEnumerator(bytesArg(Name, NameLen), BigInt.asUintN(bits, v), bits, IsUnsigned.is_true());
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1498 LLVMDIBuilderCreateUnionType
export function LLVMDIBuilderCreateUnionType(Builder: DIBuilder, Scope: Metadata | undefined, Name: PtrLenStr | undefined, NameLen: number, File: Metadata, LineNumber: number, SizeInBits: bigint, AlignInBits: number, Flags: DIFlags, Elements: readonly (Metadata | undefined)[], NumElements: number, RunTimeLang: number, UniqueId: PtrLenStr | undefined, UniqueIdLen: number): Metadata {
  const B = asDIBuilder(Builder);
  const Elts = B.getOrCreateArray(Elements.slice(0, NumElements));
  return B.createUnionType(Scope, bytesArg(Name, NameLen), File, LineNumber, SizeInBits, AlignInBits, diFlags(Flags), Elts, RunTimeLang, bytesArg(UniqueId, UniqueIdLen));
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1514 LLVMDIBuilderCreateArrayType
export function LLVMDIBuilderCreateArrayType(Builder: DIBuilder, Size: bigint, Align: number, Ty: Metadata, Subscripts: readonly Metadata[], NumSubscripts: number): Metadata {
  const B = asDIBuilder(Builder);
  const Subs = B.getOrCreateArray(Subscripts.slice(0, NumSubscripts));
  return B.createArrayType(Size, Align, Ty, Subs);
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1536 LLVMDIBuilderCreateBasicType
export function LLVMDIBuilderCreateBasicType(Builder: DIBuilder, Name: PtrLenStr | undefined, NameLen: number, SizeInBits: bigint, Encoding: number, Flags: DIFlags): Metadata {
  return asDIBuilder(Builder).createBasicType(bytesArg(Name, NameLen), SizeInBits, Encoding, diFlags(Flags));
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1545 LLVMDIBuilderCreatePointerType
export function LLVMDIBuilderCreatePointerType(Builder: DIBuilder, PointeeTy: Metadata, SizeInBits: bigint, AlignInBits: number, AddressSpace: number, Name: PtrLenStr | undefined, NameLen: number): Metadata {
  // The `unsigned AddressSpace` becomes the `std::optional<unsigned>` DWARFAddressSpace, always present (0 included).
  return asDIBuilder(Builder).createPointerType(PointeeTy, SizeInBits, AlignInBits, AddressSpace, bytesArg(Name, NameLen));
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1554 LLVMDIBuilderCreateStructType
export function LLVMDIBuilderCreateStructType(Builder: DIBuilder, Scope: Metadata | undefined, Name: PtrLenStr | undefined, NameLen: number, File: Metadata, LineNumber: number, SizeInBits: bigint, AlignInBits: number, Flags: DIFlags, DerivedFrom: Metadata | undefined, Elements: readonly (Metadata | undefined)[], NumElements: number, RunTimeLang: number, VTableHolder: Metadata | undefined, UniqueId: PtrLenStr | undefined, UniqueIdLen: number): Metadata {
  const B = asDIBuilder(Builder);
  const Elts = B.getOrCreateArray(Elements.slice(0, NumElements));
  return B.createStructType(Scope, bytesArg(Name, NameLen), File, LineNumber, SizeInBits, AlignInBits, diFlags(Flags), DerivedFrom, Elts, RunTimeLang, VTableHolder, bytesArg(UniqueId, UniqueIdLen));
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1570 LLVMDIBuilderCreateMemberType
export function LLVMDIBuilderCreateMemberType(Builder: DIBuilder, Scope: Metadata, Name: PtrLenStr | undefined, NameLen: number, File: Metadata, LineNo: number, SizeInBits: bigint, AlignInBits: number, OffsetInBits: bigint, Flags: DIFlags, Ty: Metadata): Metadata {
  return asDIBuilder(Builder).createMemberType(Scope, bytesArg(Name, NameLen), File, LineNo, SizeInBits, AlignInBits, OffsetInBits, diFlags(Flags), Ty);
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1586 LLVMDIBuilderCreateStaticMemberType
export function LLVMDIBuilderCreateStaticMemberType(Builder: DIBuilder, Scope: Metadata, Name: PtrLenStr | undefined, NameLen: number, File: Metadata, LineNumber: number, Type: Metadata, Flags: DIFlags, ConstantVal: Value | undefined, AlignInBits: number): Metadata {
  return asDIBuilder(Builder).createStaticMemberType(Scope, bytesArg(Name, NameLen), File, LineNumber, Type, diFlags(Flags), asConstant(ConstantVal), DW_TAG_member, AlignInBits);
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1633 LLVMDIBuilderCreateTypedef
export function LLVMDIBuilderCreateTypedef(Builder: DIBuilder, Type: Metadata, Name: PtrLenStr | undefined, NameLen: number, File: Metadata, LineNo: number, Scope: Metadata | undefined, AlignInBits: number): Metadata {
  return asDIBuilder(Builder).createTypedef(Type, bytesArg(Name, NameLen), File, LineNo, Scope, AlignInBits);
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1679 LLVMDIBuilderCreateQualifiedType
export function LLVMDIBuilderCreateQualifiedType(Builder: DIBuilder, Tag: number, Type: Metadata): Metadata {
  return asDIBuilder(Builder).createQualifiedType(Tag, Type);
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1789 LLVMDIBuilderCreateSubroutineType
export function LLVMDIBuilderCreateSubroutineType(Builder: DIBuilder, _File: Metadata | undefined, ParameterTypes: readonly (Metadata | undefined)[], NumParameterTypes: number, Flags: DIFlags): Metadata {
  const B = asDIBuilder(Builder);
  const Elts = B.getOrCreateTypeArray(ParameterTypes.slice(0, NumParameterTypes));
  return B.createSubroutineType(Elts, diFlags(Flags));
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1800 LLVMDIBuilderCreateExpression
export function LLVMDIBuilderCreateExpression(Builder: DIBuilder, Addr: readonly bigint[], Length: number): Metadata {
  return asDIBuilder(Builder).createExpression(Addr.slice(0, Length));
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1812 LLVMDIBuilderCreateGlobalVariableExpression
export function LLVMDIBuilderCreateGlobalVariableExpression(Builder: DIBuilder, Scope: Metadata | undefined, Name: PtrLenStr | undefined, NameLen: number, Linkage: PtrLenStr | undefined, LinkLen: number, File: Metadata, LineNo: number, Ty: Metadata, LocalToUnit: Bool, Expr: Metadata, Decl: Metadata | undefined, AlignInBits: number): Metadata {
  // `isDefined` true, no template parameters.
  return asDIBuilder(Builder).createGlobalVariableExpression(Scope, bytesArg(Name, NameLen), bytesArg(Linkage, LinkLen), File, LineNo, Ty, LocalToUnit.is_true(), true, asExpression(Expr), Decl, undefined, AlignInBits);
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1891 LLVMDIBuilderInsertDeclareRecordAtEnd
export function LLVMDIBuilderInsertDeclareRecordAtEnd(Builder: DIBuilder, Storage: Value, VarInfo: Metadata, Expr: Metadata, DebugLoc: Metadata, Block: BasicBlock): DbgVariableRecord {
  return asDIBuilder(Builder).insertDeclare(Storage, asLocalVariable(VarInfo), asExpression(Expr), asLocation(DebugLoc), Block);
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1925 LLVMDIBuilderInsertDbgValueRecordAtEnd
export function LLVMDIBuilderInsertDbgValueRecordAtEnd(Builder: DIBuilder, Val: Value, VarInfo: Metadata, Expr: Metadata, DebugLoc: Metadata, Block: BasicBlock): DbgVariableRecord {
  // `InsertPosition(unwrap(Block)->end())`: the end of the block, past a terminator if there is one.
  return asDIBuilder(Builder).insertDbgValueIntrinsic(Val, asLocalVariable(VarInfo), asExpression(Expr), asLocation(DebugLoc), Block, Block.insts.length);
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1942 LLVMDIBuilderCreateAutoVariable
export function LLVMDIBuilderCreateAutoVariable(Builder: DIBuilder, Scope: Metadata, Name: PtrLenStr | undefined, NameLen: number, File: Metadata, LineNo: number, Ty: Metadata, AlwaysPreserve: Bool, Flags: DIFlags, AlignInBits: number): Metadata {
  return asDIBuilder(Builder).createAutoVariable(Scope, bytesArg(Name, NameLen), File, LineNo, Ty, AlwaysPreserve.is_true(), diFlags(Flags), AlignInBits);
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1952 LLVMDIBuilderCreateParameterVariable
export function LLVMDIBuilderCreateParameterVariable(Builder: DIBuilder, Scope: Metadata, Name: PtrLenStr | undefined, NameLen: number, ArgNo: number, File: Metadata, LineNo: number, Ty: Metadata, AlwaysPreserve: Bool, Flags: DIFlags): Metadata {
  return asDIBuilder(Builder).createParameterVariable(Scope, bytesArg(Name, NameLen), ArgNo, File, LineNo, Ty, AlwaysPreserve.is_true(), diFlags(Flags));
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1962 LLVMDIBuilderGetOrCreateSubrange
export function LLVMDIBuilderGetOrCreateSubrange(Builder: DIBuilder, LowerBound: bigint, Count: bigint): Metadata {
  return asDIBuilder(Builder).getOrCreateSubrange(LowerBound, Count);
}

// llvm: llvm/lib/IR/DebugInfo.cpp:1967 LLVMDIBuilderGetOrCreateArray
export function LLVMDIBuilderGetOrCreateArray(Builder: DIBuilder, Data: readonly (Metadata | undefined)[], NumElements: number): Metadata {
  return asDIBuilder(Builder).getOrCreateArray(Data.slice(0, NumElements));
}

// ---- rustc's wrappers (RustWrapper.cpp) ----------------------------------------------------------------------------------

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1005 LLVMRustDIBuilderCreateCompileUnit
export function LLVMRustDIBuilderCreateCompileUnit(Builder: DIBuilder, Lang: number, File: Metadata, Producer: PtrLenStr | undefined, ProducerLen: number, isOptimized: boolean, Flags: string | undefined, RuntimeVer: number, SplitName: PtrLenStr | undefined, SplitNameLen: number, kind: DebugEmissionKind, DWOId: bigint, SplitDebugInlining: boolean, TableKind: DebugNameTableKind): Metadata {
  // `fromRust(Kind)` and `fromRust(TableKind)` map rustc's enums to LLVM's one to one (RustWrapper.cpp:824, :846);
  // `DebugInfoForProfiling` false.
  return asDIBuilder(Builder).createCompileUnit(Lang, File, bytesArg(Producer, ProducerLen), isOptimized, cstrArg(Flags, "StringRef", "LLVMRustDIBuilderCreateCompileUnit"), RuntimeVer, bytesArg(SplitName, SplitNameLen), DebugEmissionKind_discriminant[kind], BigInt.asUintN(64, DWOId), SplitDebugInlining, false, DebugNameTableKind_discriminant[TableKind]);
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1020 LLVMRustDIBuilderCreateFile
export function LLVMRustDIBuilderCreateFile(Builder: DIBuilder, Filename: PtrLenStr | undefined, FilenameLen: number, Directory: PtrLenStr | undefined, DirectoryLen: number, CSKind: ChecksumKind, Checksum: PtrLenStr | undefined, ChecksumLen: number, Source: PtrLenStr | undefined, SourceLen: number): Metadata {
  // `fromRust(CSKind)` (:866): None is no checksum, the others are CSK_MD5 (1), CSK_SHA1 (2), CSK_SHA256 (3).
  const llvmCSKind = CSKind === "None" ? undefined : ChecksumKind_discriminant[CSKind];
  const CSInfo: [number, string] | undefined = llvmCSKind === undefined ? undefined : [llvmCSKind, bytesArg(Checksum, ChecksumLen)];
  const oSource = Source === undefined ? undefined : bytesArg(Source, SourceLen);
  return asDIBuilder(Builder).createFile(bytesArg(Filename, FilenameLen), bytesArg(Directory, DirectoryLen), CSInfo, oSource);
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1038 LLVMRustDIBuilderCreateFunction
export function LLVMRustDIBuilderCreateFunction(Builder: DIBuilder, Scope: Metadata, Name: PtrLenStr | undefined, NameLen: number, LinkageName: PtrLenStr | undefined, LinkageNameLen: number, File: Metadata, LineNo: number, Ty: Metadata, ScopeLine: number, Flags: DIFlags, SPFlags: DISPFlags, MaybeFn: Value | undefined, TParam: Metadata, Decl: Metadata | undefined): Metadata {
  const TParams = asTuple(TParam);
  const llvmSPFlags = fromRustDISPFlags(SPFlags);
  const llvmFlags = fromRustDIFlags(Flags);
  const Sub = asDIBuilder(Builder).createFunction(Scope, bytesArg(Name, NameLen), bytesArg(LinkageName, LinkageNameLen), File, LineNo, Ty, ScopeLine, llvmFlags, llvmSPFlags, TParams, Decl);
  if (MaybeFn !== undefined) {
    if (!(MaybeFn instanceof IrFunction)) throw new Error("llvm: unwrap<Function> of a value that is not a function");
    // `Function::setSubprogram(SP)`: `setMetadata(LLVMContext::MD_dbg, SP)`.
    MaybeFn.setMetadata(0, Sub);
  }
  return Sub;
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1058 LLVMRustDIBuilderCreateMethod
export function LLVMRustDIBuilderCreateMethod(Builder: DIBuilder, Scope: Metadata, Name: PtrLenStr | undefined, NameLen: number, LinkageName: PtrLenStr | undefined, LinkageNameLen: number, File: Metadata, LineNo: number, Ty: Metadata, Flags: DIFlags, SPFlags: DISPFlags, TParam: Metadata): Metadata {
  const TParams = asTuple(TParam);
  const llvmSPFlags = fromRustDISPFlags(SPFlags);
  const llvmFlags = fromRustDIFlags(Flags);
  // VTable params aren't used.
  return asDIBuilder(Builder).createMethod(Scope, bytesArg(Name, NameLen), bytesArg(LinkageName, LinkageNameLen), File, LineNo, Ty, 0, 0, undefined, llvmFlags, llvmSPFlags, TParams);
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1076 LLVMRustDIBuilderCreateVariantPart
export function LLVMRustDIBuilderCreateVariantPart(Builder: DIBuilder, Scope: Metadata, Name: PtrLenStr | undefined, NameLen: number, File: Metadata, LineNumber: number, SizeInBits: bigint, AlignInBits: number, Flags: DIFlags, Discriminator: Metadata | undefined, Elements: Metadata, UniqueId: PtrLenStr | undefined, UniqueIdLen: number): Metadata {
  return asDIBuilder(Builder).createVariantPart(Scope, bytesArg(Name, NameLen), File, LineNumber, SizeInBits, AlignInBits, fromRustDIFlags(Flags), Discriminator, asTuple(Elements), bytesArg(UniqueId, UniqueIdLen));
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1090 LLVMRustDIBuilderCreateVariantMemberType
export function LLVMRustDIBuilderCreateVariantMemberType(Builder: DIBuilder, Scope: Metadata, Name: PtrLenStr | undefined, NameLen: number, File: Metadata, LineNo: number, SizeInBits: bigint, AlignInBits: number, OffsetInBits: bigint, Discriminant: Value | undefined, Flags: DIFlags, Ty: Metadata): Metadata {
  let D: ConstantInt | undefined;
  if (Discriminant !== undefined) {
    if (!(Discriminant instanceof ConstantInt)) throw new Error("llvm: unwrap<ConstantInt> of a value that is not a constant integer");
    D = Discriminant;
  }
  return asDIBuilder(Builder).createVariantMemberType(Scope, bytesArg(Name, NameLen), File, LineNo, SizeInBits, AlignInBits, OffsetInBits, D, fromRustDIFlags(Flags), Ty);
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1105 LLVMRustDIBuilderCreateEnumerationType
export function LLVMRustDIBuilderCreateEnumerationType(Builder: DIBuilder, Scope: Metadata, Name: PtrLenStr | undefined, NameLen: number, File: Metadata, LineNumber: number, SizeInBits: bigint, AlignInBits: number, Elements: Metadata, ClassTy: Metadata, IsScoped: boolean): Metadata {
  // RunTimeLang 0, no identifier.
  return asDIBuilder(Builder).createEnumerationType(Scope, bytesArg(Name, NameLen), File, LineNumber, SizeInBits, AlignInBits, asTuple(Elements), ClassTy, 0, "", IsScoped);
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1117 LLVMRustDIBuilderCreateTemplateTypeParameter
export function LLVMRustDIBuilderCreateTemplateTypeParameter(Builder: DIBuilder, Scope: Metadata | undefined, Name: PtrLenStr | undefined, NameLen: number, Ty: Metadata): Metadata {
  const IsDefault = false; // FIXME: should we ever set this true?
  return asDIBuilder(Builder).createTemplateTypeParameter(Scope, bytesArg(Name, NameLen), Ty, IsDefault);
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1126 LLVMRustDICompositeTypeReplaceArrays
export function LLVMRustDICompositeTypeReplaceArrays(Builder: DIBuilder, CompositeTy: Metadata, Elements: Metadata | undefined, Params: Metadata | undefined): void {
  asDIBuilder(Builder).replaceArrays(asComposite(CompositeTy), asTuple(Elements), asTuple(Params));
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1137 LLVMRustDIGetOrCreateSubrange
export function LLVMRustDIGetOrCreateSubrange(Builder: DIBuilder, CountNode: Metadata | undefined, LB: Metadata, UB: Metadata, Stride: Metadata | undefined): Metadata {
  return asDIBuilder(Builder).getOrCreateSubrangeMD(CountNode, LB, UB, Stride);
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1148 LLVMRustDICreateVectorType
export function LLVMRustDICreateVectorType(Builder: DIBuilder, Size: bigint, AlignInBits: number, Type: Metadata, Subscripts: Metadata, BitStride: Metadata | undefined): Metadata {
  return asDIBuilder(Builder).createVectorType(Size, AlignInBits, Type, asTuple(Subscripts), BitStride);
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1159 LLVMRustDILocationCloneWithBaseDiscriminator
export function LLVMRustDILocationCloneWithBaseDiscriminator(Location: Metadata, BD: number): Metadata | undefined {
  return asLocation(Location).cloneWithBaseDiscriminator(BD);
}
