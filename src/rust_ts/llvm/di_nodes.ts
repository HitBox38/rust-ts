// rust-ts: the IR model's specialized debug-info metadata (lane llir-di, plan-m7 D5, D9). Not ported code.
//
// LLVM's `DINode` subclasses as rustc's debuginfo reaches them: each class keeps LLVM's operand layout (the `Ops[]` of its
// `getImpl` in llvm/lib/IR/DebugInfoMetadata.cpp), its integer fields, its uniquing key (`MDNodeKeyImpl<CLASS>::isKeyOf` and
// `MDNodeSubsetEqualImpl`, llvm/lib/IR/LLVMContextImpl.h) and its textual form (`write<CLASS>`, llvm/lib/IR/AsmWriter.cpp:2096
// and on, with `MDFieldPrinter` at :1892). They extend ir.ts's `MDNode`, so the printer's slot numbering walks their operands as
// `SlotTracker::CreateMetadataSlot` does (a node, then the nodes among its operands; `DIExpression` gets no slot).
//
// Uniquing: one store per context and class, keyed by the class's key as a string of operand ids and integer fields (operands are
// compared by identity in LLVM, so by `id` here). The ODR special cases (`MDNodeSubsetEqualImpl<DIDerivedType>` for a member of a
// type with an identifier, `<DISubprogram>` for a method declaration in one) key on the subset LLVM compares, which is the same
// equality: a lookup that is eligible hashes only that subset, and any stored node it can meet is eligible too.
//
// PORT: DebugInfoMetadata.cpp/.h, LLVMContextImpl.h, Discriminator.h are not in harness/llvm-manifest.json yet (handoff llir-di
// lists them for root to pin), so functions that follow them are cited in comments without `// llvm:` markers. AsmWriter.cpp
// is pinned and its writers carry markers.
import { unported } from "../../std/panic.ts";
import { DW_ATE_NAMES, DW_CC_NAMES, DW_LANG_NAMES, DW_OP_NAMES, DW_TAG_NAMES, diFlagString, diSplitFlags, dispFlagString, dispSplitFlags, operationEncodingString } from "./dwarf.ts";
import { ConstantInt, type Context, getConstantInt, MDNode, MDString, type Metadata, ValueAsMetadata } from "./ir.ts";
import { printEscapedString } from "./printer.ts";

// ---- DWARF constants the classes use (Dwarf.def; values as dwarf::Tag) --------------------------------------------------

export const DW_TAG_array_type = 0x01;
export const DW_TAG_enumeration_type = 0x04;
export const DW_TAG_member = 0x0d;
export const DW_TAG_pointer_type = 0x0f;
export const DW_TAG_compile_unit = 0x11;
export const DW_TAG_structure_type = 0x13;
export const DW_TAG_subroutine_type = 0x15;
export const DW_TAG_typedef = 0x16;
export const DW_TAG_union_type = 0x17;
export const DW_TAG_inheritance = 0x1c;
export const DW_TAG_lexical_block = 0x0b;
export const DW_TAG_subrange_type = 0x21;
export const DW_TAG_base_type = 0x24;
export const DW_TAG_enumerator = 0x28;
export const DW_TAG_file_type = 0x29;
export const DW_TAG_subprogram = 0x2e;
export const DW_TAG_template_type_parameter = 0x2f;
export const DW_TAG_variable = 0x34;
export const DW_TAG_variant_part = 0x33;
export const DW_TAG_namespace = 0x39;

/** `DINode::FlagStaticMember`, `FlagEnumClass`, `FlagVector`, `FlagBitField` (DebugInfoFlags.def). */
export const FlagStaticMember = 1 << 12;
export const FlagEnumClass = 1 << 24;
export const FlagVector = 1 << 11;
export const FlagBitField = 1 << 19;
/** `DISubprogram::SPFlagDefinition`, `SPFlagVirtuality` (DebugInfoFlags.def:85, DebugInfoMetadata.h). */
export const SPFlagDefinition = 1 << 3;
const SPFlagVirtuality = 3;

// ---- uniquing ------------------------------------------------------------------------------------------------------------

type KeyField = number | bigint | boolean | string | undefined;
const STORES = new WeakMap<Context, Map<string, DINode>>();

function storeOf(ctx: Context): Map<string, DINode> {
  let s = STORES.get(ctx);
  if (s === undefined) STORES.set(ctx, (s = new Map()));
  return s;
}

const opId = (m: Metadata | undefined): number => m?.id ?? 0;

/** `getCanonicalMDString` (DebugInfoMetadata.h:163): the empty string is no operand (null). `s` is a byte string. */
export function canonicalMDString(ctx: Context, s: string): MDString | undefined {
  return s === "" ? undefined : ctx.getMDString(s);
}

/** `ConstantAsMetadata::get(ConstantInt::get(Type::getInt64Ty(Context), V))`, how the `uint64_t` overloads of `get` wrap a size
 * or offset (DebugInfoMetadata.h:891 and on). `v` is the `uint64_t`. */
export function i64AsMetadata(ctx: Context, v: bigint): ValueAsMetadata {
  return ctx.constantAsMetadata(getConstantInt(ctx.getIntType(64), BigInt.asUintN(64, v)));
}

/** `ConstantAsMetadata::get(ConstantInt::getSigned(Type::getInt64Ty(Context), V))`. */
export function i64SignedAsMetadata(ctx: Context, v: bigint): ValueAsMetadata {
  return ctx.constantAsMetadata(getConstantInt(ctx.getIntType(64), BigInt.asUintN(64, v)));
}

/** A node of DebugInfoMetadata.h. `ops` is LLVM's operand array for the class; the integer fields are the subclass's. */
export abstract class DINode extends MDNode {
  constructor(
    readonly ctx: Context,
    ops: (Metadata | undefined)[],
    distinct: boolean,
  ) {
    super(ops, distinct);
  }
  /** `Metadata::getMetadataID` as the class name: the store's key prefix, and what `isa<CLASS>` tests. */
  abstract readonly cls: string;
  /** The integer fields `MDNodeKeyImpl<CLASS>::isKeyOf` compares besides the operands. */
  abstract keyInts(): readonly KeyField[];
  /** `MDNodeSubsetEqualImpl<CLASS>`'s subset when this node is eligible for it, else undefined. */
  odrKey(): string | undefined {
    return undefined;
  }
  /** The uniquing key: the ODR subset where it applies, else the class, every operand and the key's integer fields. */
  key(): string {
    return this.odrKey() ?? `${this.cls}|${this.ops.map(opId).join(",")}|${this.keyInts().join(",")}`;
  }
  /** `write<CLASS>` (AsmWriter.cpp): the body after `distinct `. */
  abstract write(p: FieldPrinter): string;
  override writeSpecialized(operand: (md: Metadata | undefined) => string): string {
    return this.write(new FieldPrinter(operand));
  }
}

/** `storeImpl(N, Storage, Store)` (MetadataImpl.h) after `DEFINE_GETIMPL_LOOKUP`: a uniqued node is the stored one with its key
 * if there is one, else this one, stored; a distinct node is never looked up. */
export function storeImpl<T extends DINode>(n: T): T {
  if (n.distinct) return n;
  const store = storeOf(n.ctx);
  const k = n.key();
  const found = store.get(k);
  if (found !== undefined) return found as T;
  store.set(k, n);
  return n;
}

/** `MDNode::replaceOperandWith(I, New)` (Metadata.cpp): a distinct node changes in place; a uniqued one leaves its store, takes
 * the operand and is uniqued again (`handleChangedOperand`). A collision with another node (which LLVM resolves by RAUW or by
 * making the node distinct) does not happen on rustc's paths, whose composite types carry unique identifiers; it stops. */
export function replaceOperandWith(n: DINode, i: number, New: Metadata | undefined): void {
  if (n.ops[i] === New) return;
  if (n.distinct) {
    n.ops[i] = New;
    return;
  }
  const store = storeOf(n.ctx);
  if (store.get(n.key()) === n) store.delete(n.key());
  const old = n.ops[i];
  n.ops[i] = New;
  // "Drop uniquing for self-reference cycles and deleted constants."
  if (New === n || (New === undefined && old instanceof ValueAsMetadata)) return unported("llir: MDNode::handleChangedOperand making a uniqued node distinct (self reference)");
  const k = n.key();
  const other = store.get(k);
  if (other !== undefined && other !== n) return unported("llir: MDNode::handleChangedOperand collision on re-uniquing (RAUW or storeDistinctInContext)");
  store.set(k, n);
}

// ---- MDFieldPrinter ------------------------------------------------------------------------------------------------------

const opsString = (md: Metadata | undefined): string => (md instanceof MDString ? md.str : "");

/** `MDFieldPrinter` (AsmWriter.cpp:1892): `name: value` fields joined by `, ` (its `ListSeparator FS`). */
export class FieldPrinter {
  o = "";
  constructor(readonly operand: (md: Metadata | undefined) => string) {}
  private fs(): string {
    const s = this.o === "" ? "" : ", ";
    return s;
  }
  private field(name: string, value: string): void {
    this.o += `${this.fs()}${name}: ${value}`;
  }

  // llvm: llvm/lib/IR/AsmWriter.cpp:1930 MDFieldPrinter::printTag
  printTag(tag: number): void {
    this.field("tag", DW_TAG_NAMES.get(tag) ?? String(tag));
  }

  // llvm: llvm/lib/IR/AsmWriter.cpp:1948 MDFieldPrinter::printChecksum
  printChecksum(kind: number, value: string): void {
    // `getKindAsString`: `ChecksumKindName[CSKind - 1]` (DebugInfoMetadata.cpp:1182).
    this.field("checksumkind", ["CSK_MD5", "CSK_SHA1", "CSK_SHA256"][kind - 1] ?? unported(`llir: DIFile checksum kind ${kind}`));
    this.printString("checksum", value, false);
  }

  // llvm: llvm/lib/IR/AsmWriter.cpp:1954 MDFieldPrinter::printString
  /** `value` is a byte string. */
  printString(name: string, value: string, shouldSkipEmpty = true): void {
    if (shouldSkipEmpty && value === "") return;
    this.field(name, `"${printEscapedString(value)}"`);
  }

  // llvm: llvm/lib/IR/AsmWriter.cpp:1974 MDFieldPrinter::printMetadata
  printMetadata(name: string, md: Metadata | undefined, shouldSkipNull = true): void {
    if (shouldSkipNull && md === undefined) return;
    // `writeMetadataAsOperand`: `null`, or the operand.
    this.field(name, md === undefined ? "null" : this.operand(md));
  }

  // llvm: llvm/lib/IR/AsmWriter.cpp:1983 MDFieldPrinter::printMetadataOrInt
  printMetadataOrInt(name: string, md: Metadata | undefined, isUnsigned: boolean, shouldSkipZero = true): void {
    if (md === undefined) return;
    if (md instanceof ValueAsMetadata && md.value instanceof ConstantInt) {
      const cv = md.value;
      this.printInt(name, isUnsigned ? cv.value : cv.sextValue, shouldSkipZero);
    } else this.printMetadata(name, md);
  }

  // llvm: llvm/lib/IR/AsmWriter.cpp:1999 MDFieldPrinter::printInt
  printInt(name: string, int: number | bigint, shouldSkipZero = true): void {
    if (shouldSkipZero && (int === 0 || int === 0n)) return;
    this.field(name, String(int));
  }

  // llvm: llvm/lib/IR/AsmWriter.cpp:2006 MDFieldPrinter::printAPInt
  /** `v` is the APInt's bit pattern of width `bits`; `Int.print(Out, !IsUnsigned)`. */
  printAPInt(name: string, v: bigint, bits: number, isUnsigned: boolean, shouldSkipZero: boolean): void {
    if (shouldSkipZero && v === 0n) return;
    this.field(name, String(isUnsigned ? v : BigInt.asIntN(bits, v)));
  }

  // llvm: llvm/lib/IR/AsmWriter.cpp:2015 MDFieldPrinter::printBool
  printBool(name: string, value: boolean, default_?: boolean): void {
    if (default_ !== undefined && value === default_) return;
    this.field(name, value ? "true" : "false");
  }

  // llvm: llvm/lib/IR/AsmWriter.cpp:2022 MDFieldPrinter::printDIFlags
  printDIFlags(name: string, flags: number): void {
    if (!flags) return;
    const split: number[] = [];
    const extra = diSplitFlags(flags, split);
    const parts = split.map((f) => diFlagString(f));
    if (extra || split.length === 0) parts.push(String(extra));
    this.field(name, parts.join(" | "));
  }

  // llvm: llvm/lib/IR/AsmWriter.cpp:2041 MDFieldPrinter::printDISPFlags
  printDISPFlags(name: string, flags: number): void {
    // Always print this field, because no flags in the IR at all will be interpreted as old-style isDefinition: true.
    if (!flags) {
      this.field(name, "0");
      return;
    }
    const split: number[] = [];
    const extra = dispSplitFlags(flags, split);
    const parts = split.map((f) => dispFlagString(f));
    if (extra || split.length === 0) parts.push(String(extra));
    this.field(name, parts.join(" | "));
  }

  // llvm: llvm/lib/IR/AsmWriter.cpp:2065 MDFieldPrinter::printEmissionKind
  printEmissionKind(name: string, ek: number): void {
    // `DICompileUnit::emissionKindString` (DebugInfoMetadata.cpp:1278).
    this.field(name, ["NoDebug", "FullDebug", "LineTablesOnly", "DebugDirectivesOnly"][ek] ?? unported(`llir: emission kind ${ek}`));
  }

  // llvm: llvm/lib/IR/AsmWriter.cpp:2070 MDFieldPrinter::printNameTableKind
  printNameTableKind(name: string, ntk: number): void {
    if (ntk === 0) return; // Default
    // `DICompileUnit::nameTableKindString` (DebugInfoMetadata.cpp:1292).
    this.field(name, ["", "GNU", "None", "Apple"][ntk] ?? unported(`llir: name table kind ${ntk}`));
  }

  // llvm: llvm/lib/IR/AsmWriter.cpp:2083 MDFieldPrinter::printDwarfEnum
  printDwarfEnum(name: string, value: number, toString: ReadonlyMap<number, string>, shouldSkipZero = true): void {
    if (shouldSkipZero && !value) return;
    this.field(name, toString.get(value) ?? String(value));
  }
}

// ---- the classes, in Metadata.def's order --------------------------------------------------------------------------------

/** `DILocation`: ops `{Scope, InlinedAt?}`. */
export class DILocation extends DINode {
  readonly cls = "DILocation";
  constructor(
    ctx: Context,
    distinct: boolean,
    readonly line: number,
    readonly column: number,
    scope: Metadata,
    inlinedAt: Metadata | undefined,
    readonly implicitCode: boolean,
    readonly atomGroup: bigint,
    readonly atomRank: number,
  ) {
    super(ctx, inlinedAt === undefined ? [scope] : [scope, inlinedAt], distinct);
  }
  get rawScope(): Metadata {
    return this.ops[0]!;
  }
  get rawInlinedAt(): Metadata | undefined {
    return this.ops.length === 2 ? this.ops[1] : undefined;
  }
  keyInts(): readonly KeyField[] {
    return [this.line, this.column, opId(this.rawInlinedAt), this.implicitCode, this.atomGroup, this.atomRank];
  }
  /** `DILocation::getImpl` (DebugInfoMetadata.cpp:87): the column is set to 0 (unknown) when it does not fit in 16 bits. */
  static get(ctx: Context, line: number, column: number, scope: Metadata, inlinedAt: Metadata | undefined, implicitCode = false, atomGroup = 0n, atomRank = 0): DILocation {
    // `adjustColumn`.
    if (column >= 1 << 16) column = 0;
    return storeImpl(new DILocation(ctx, false, line >>> 0, column, scope, inlinedAt, implicitCode, atomGroup, atomRank));
  }
  /** `getDiscriminator` (DebugInfoMetadata.h:3085): the scope's, when it is a `DILexicalBlockFile`. */
  getDiscriminator(): number {
    const f = this.rawScope;
    return f instanceof DILexicalBlockFile ? f.discriminator : 0;
  }
  /** `DILocation::getFile`: the scope's file. */
  getFile(): Metadata | undefined {
    return scopeFile(this.rawScope);
  }
  /** `cloneWithDiscriminator` (DebugInfoMetadata.h:3092). */
  cloneWithDiscriminator(discriminator: number): DILocation {
    let scope = this.rawScope;
    // Skip all parent DILexicalBlockFile that already have a discriminator assigned.
    for (let lbf = scope instanceof DILexicalBlockFile ? scope : undefined; lbf !== undefined && lbf.discriminator !== 0; lbf = scope instanceof DILexicalBlockFile ? scope : undefined) scope = lbf.rawScope;
    const newScope = DILexicalBlockFile.get(this.ctx, scope, this.getFile(), discriminator);
    return DILocation.get(this.ctx, this.line, this.column, newScope, this.rawInlinedAt, this.implicitCode, this.atomGroup, this.atomRank);
  }
  /** `cloneWithBaseDiscriminator` (DebugInfoMetadata.h:3123), without `-enable-fs-discriminator` (off by default). */
  cloneWithBaseDiscriminator(d: number): DILocation | undefined {
    // Do not interfere with pseudo probes.
    if (isPseudoProbeDiscriminator(this.getDiscriminator())) return this;
    const [bd, df, ci] = decodeDiscriminator(this.getDiscriminator());
    if (d === bd) return this;
    const encoded = encodeDiscriminator(d, df, ci);
    if (encoded !== undefined) return this.cloneWithDiscriminator(encoded);
    return undefined;
  }
  // llvm: llvm/lib/IR/AsmWriter.cpp:2114 writeDILocation
  write(p: FieldPrinter): string {
    // Always output the line, since 0 is a relevant and important value for it.
    p.printInt("line", this.line, false);
    p.printInt("column", this.column);
    p.printMetadata("scope", this.rawScope, false);
    p.printMetadata("inlinedAt", this.rawInlinedAt);
    p.printBool("isImplicitCode", this.implicitCode, false);
    p.printInt("atomGroup", this.atomGroup);
    p.printInt("atomRank", this.atomRank);
    return `!DILocation(${p.o})`;
  }
}

// Discriminator.h:23-51 and DebugInfoMetadata.cpp:417-455: the prefix encoding of discriminator components.
const getPrefixEncodingFromUnsigned = (u: number): number => {
  u &= 0xfff;
  return u > 0x1f ? ((u & 0xfe0) << 1) | (u & 0x1f) | 0x20 : u;
};
const getUnsignedFromPrefixEncoding = (u: number): number => {
  if (u & 1) return 0;
  u >>>= 1;
  return u & 0x20 ? ((u >>> 1) & 0xfe0) | (u & 0x1f) : u & 0x1f;
};
const getNextComponentInDiscriminator = (d: number): number => ((d & 1) === 0 ? d >>> (d & 0x40 ? 14 : 7) : d >>> 1);
const encodeComponent = (c: number): number => (c === 0 ? 1 : getPrefixEncodingFromUnsigned(c) << 1);
const encodingBits = (c: number): number => (c === 0 ? 1 : c > 0x1f ? 14 : 7);
const isPseudoProbeDiscriminator = (d: number): boolean => (d & 0x7) === 0x7 && (d & 0xfffffff8) !== 0;

/** `DILocation::decodeDiscriminator` (DebugInfoMetadata.cpp:451). */
function decodeDiscriminator(d: number): [number, number, number] {
  const bd = getUnsignedFromPrefixEncoding(d);
  const df = getUnsignedFromPrefixEncoding(getNextComponentInDiscriminator(d));
  const ci = getUnsignedFromPrefixEncoding(getNextComponentInDiscriminator(getNextComponentInDiscriminator(d)));
  return [bd, df, ci];
}

/** `DILocation::encodeDiscriminator` (DebugInfoMetadata.cpp:417): undefined when a component does not fit. */
function encodeDiscriminator(bd: number, df: number, ci: number): number | undefined {
  const components = [bd, df, ci];
  let remainingWork = bd + df + ci;
  let i = 0;
  let ret = 0;
  let nextBitInsertionIndex = 0;
  while (remainingWork > 0) {
    const c = components[i++]!;
    remainingWork -= c;
    const ec = encodeComponent(c);
    // `unsigned` arithmetic: a shift past 31 bits is what the C++ does on its 32-bit `unsigned` (bits fall off).
    ret = (ret | (nextBitInsertionIndex < 32 ? ec << nextBitInsertionIndex : 0)) >>> 0;
    nextBitInsertionIndex += encodingBits(c);
  }
  const [tbd, tdf, tci] = decodeDiscriminator(ret);
  if (tbd === bd && tdf === df && tci === ci) return ret;
  return undefined;
}

/** `DIScope::getFile` / `DILocalScope`: operand 0 of a scope is its file (a `DIFile` is its own file). */
function scopeFile(s: Metadata | undefined): Metadata | undefined {
  if (s instanceof DIFile) return s;
  if (s instanceof DINode) return s.ops[0];
  return undefined;
}

/** `DISubrange`: ops `{CountNode, LowerBound, UpperBound, Stride}`. */
export class DISubrange extends DINode {
  readonly cls = "DISubrange";
  keyInts(): readonly KeyField[] {
    return [];
  }
  static get(ctx: Context, countNode: Metadata | undefined, lb: Metadata | undefined, ub: Metadata | undefined, stride: Metadata | undefined): DISubrange {
    return storeImpl(new DISubrange(ctx, [countNode, lb, ub, stride], false));
  }
  // llvm: llvm/lib/IR/AsmWriter.cpp:2136 writeDISubrange
  write(p: FieldPrinter): string {
    p.printMetadataOrInt("count", this.ops[0], false, false);
    // A lowerBound of constant 0 should not be skipped, since it is different from an unspecified lower bound (= nullptr).
    p.printMetadataOrInt("lowerBound", this.ops[1], false, false);
    p.printMetadataOrInt("upperBound", this.ops[2], false, false);
    p.printMetadataOrInt("stride", this.ops[3], false, false);
    return `!DISubrange(${p.o})`;
  }
}

/** `DIEnumerator`: ops `{Name}`; the value is an APInt (bit pattern and width). */
export class DIEnumerator extends DINode {
  readonly cls = "DIEnumerator";
  constructor(
    ctx: Context,
    readonly value: bigint,
    readonly bits: number,
    readonly isUnsigned: boolean,
    name: MDString | undefined,
  ) {
    super(ctx, [name], false);
  }
  keyInts(): readonly KeyField[] {
    // `DenseMapInfo<APInt>`: equal widths and bits.
    return [this.bits, this.value, this.isUnsigned];
  }
  // llvm: llvm/lib/IR/AsmWriter.cpp:2208 writeDIEnumerator
  write(p: FieldPrinter): string {
    p.printString("name", opsString(this.ops[0]), false);
    p.printAPInt("value", this.value, this.bits, this.isUnsigned, false);
    if (this.isUnsigned) p.printBool("isUnsigned", true);
    return `!DIEnumerator(${p.o})`;
  }
}

/** `DIBasicType`: ops `{File, Scope, Name, SizeInBits, nullptr}`. */
export class DIBasicType extends DINode {
  readonly cls = "DIBasicType";
  constructor(
    ctx: Context,
    readonly tag: number,
    name: MDString | undefined,
    file: Metadata | undefined,
    readonly line: number,
    scope: Metadata | undefined,
    size: Metadata | undefined,
    readonly align: number,
    readonly encoding: number,
    readonly numExtraInhabitants: number,
    readonly dataSizeInBits: number,
    readonly flags: number,
  ) {
    super(ctx, [file, scope, name, size, undefined], false);
  }
  keyInts(): readonly KeyField[] {
    return [this.tag, this.line, this.align, this.encoding, this.numExtraInhabitants, this.dataSizeInBits, this.flags];
  }
  // llvm: llvm/lib/IR/AsmWriter.cpp:2220 writeDIBasicType
  write(p: FieldPrinter): string {
    if (this.tag !== DW_TAG_base_type) p.printTag(this.tag);
    p.printString("name", opsString(this.ops[2]));
    p.printMetadata("scope", this.ops[1]);
    p.printMetadata("file", this.ops[0]);
    p.printInt("line", this.line);
    p.printMetadataOrInt("size", this.ops[3], true);
    p.printInt("align", this.align);
    p.printInt("dataSize", this.dataSizeInBits);
    p.printDwarfEnum("encoding", this.encoding, DW_ATE_NAMES);
    p.printInt("num_extra_inhabitants", this.numExtraInhabitants);
    p.printDIFlags("flags", this.flags);
    return `!DIBasicType(${p.o})`;
  }
}

/** `DIDerivedType`: ops `{File, Scope, Name, SizeInBits, OffsetInBits, BaseType, ExtraData, Annotations}`. */
export class DIDerivedType extends DINode {
  readonly cls = "DIDerivedType";
  constructor(
    ctx: Context,
    readonly tag: number,
    name: MDString | undefined,
    file: Metadata | undefined,
    readonly line: number,
    scope: Metadata | undefined,
    baseType: Metadata | undefined,
    size: Metadata | undefined,
    readonly align: number,
    offset: Metadata | undefined,
    readonly dwarfAddressSpace: number | undefined,
    readonly flags: number,
    extraData: Metadata | undefined,
    annotations: Metadata | undefined,
  ) {
    super(ctx, [file, scope, name, size, offset, baseType, extraData, annotations], false);
  }
  keyInts(): readonly KeyField[] {
    // `PtrAuthData` is always none here (no creator rustc calls makes `DW_TAG_LLVM_ptrauth_type`).
    return [this.tag, this.line, this.align, this.dwarfAddressSpace, this.flags];
  }
  /** `MDNodeSubsetEqualImpl<DIDerivedType>::isODRMember` (LLVMContextImpl.h:738). */
  override odrKey(): string | undefined {
    const name = this.ops[2];
    const scope = this.ops[1];
    if (this.tag !== DW_TAG_member || name === undefined) return undefined;
    if (!(scope instanceof DICompositeType) || scope.ops[9] === undefined) return undefined;
    return `DIDerivedType.odr|${this.tag}|${opId(name)}|${opId(scope)}`;
  }
  // llvm: llvm/lib/IR/AsmWriter.cpp:2284 writeDIDerivedType
  write(p: FieldPrinter): string {
    p.printTag(this.tag);
    p.printString("name", opsString(this.ops[2]));
    p.printMetadata("scope", this.ops[1]);
    p.printMetadata("file", this.ops[0]);
    p.printInt("line", this.line);
    p.printMetadata("baseType", this.ops[5], false);
    p.printMetadataOrInt("size", this.ops[3], true);
    p.printInt("align", this.align);
    p.printMetadataOrInt("offset", this.ops[4], true);
    p.printDIFlags("flags", this.flags);
    p.printMetadata("extraData", this.ops[6]);
    if (this.dwarfAddressSpace !== undefined) p.printInt("dwarfAddressSpace", this.dwarfAddressSpace, false);
    p.printMetadata("annotations", this.ops[7]);
    return `!DIDerivedType(${p.o})`;
  }
}

/** `DICompositeType`: ops `{File, Scope, Name, SizeInBits, OffsetInBits, BaseType, Elements, VTableHolder, TemplateParams,
 * Identifier, Discriminator, DataLocation, Associated, Allocated, Rank, Annotations, Specification, BitStride}`. */
export class DICompositeType extends DINode {
  readonly cls = "DICompositeType";
  constructor(
    ctx: Context,
    readonly tag: number,
    readonly line: number,
    readonly runtimeLang: number,
    readonly align: number,
    readonly numExtraInhabitants: number,
    readonly enumKind: number | undefined,
    readonly flags: number,
    ops: (Metadata | undefined)[],
  ) {
    super(ctx, ops, false);
  }
  keyInts(): readonly KeyField[] {
    // `EnumKind` is not part of the key (LLVMContextImpl.h, `MDNodeKeyImpl<DICompositeType>::isKeyOf`).
    return [this.tag, this.line, this.runtimeLang, this.align, this.numExtraInhabitants, this.flags];
  }
  // llvm: llvm/lib/IR/AsmWriter.cpp:2337 writeDICompositeType
  write(p: FieldPrinter): string {
    const o = this.ops;
    p.printTag(this.tag);
    p.printString("name", opsString(o[2]));
    p.printMetadata("scope", o[1]);
    p.printMetadata("file", o[0]);
    p.printInt("line", this.line);
    p.printMetadata("baseType", o[5]);
    p.printMetadataOrInt("size", o[3], true);
    p.printInt("align", this.align);
    p.printMetadataOrInt("offset", o[4], true);
    p.printInt("num_extra_inhabitants", this.numExtraInhabitants);
    p.printDIFlags("flags", this.flags);
    p.printMetadata("elements", o[6]);
    p.printDwarfEnum("runtimeLang", this.runtimeLang, DW_LANG_NAMES);
    p.printMetadata("vtableHolder", o[7]);
    p.printMetadata("templateParams", o[8]);
    p.printString("identifier", opsString(o[9]));
    p.printMetadata("discriminator", o[10]);
    p.printMetadata("dataLocation", o[11]);
    p.printMetadata("associated", o[12]);
    p.printMetadata("allocated", o[13]);
    // `getRankConst`: a `ConstantAsMetadata` rank prints as its value.
    const rank = o[14];
    if (rank instanceof ValueAsMetadata && rank.value instanceof ConstantInt) p.printInt("rank", rank.value.sextValue, false);
    else p.printMetadata("rank", rank, true);
    p.printMetadata("annotations", o[15]);
    if (o[16] !== undefined) p.printMetadata("specification", o[16]);
    if (this.enumKind !== undefined) return unported("llir: printing a DICompositeType's enumKind (dwarf::EnumKindString)");
    p.printMetadata("bitStride", o[17]);
    return `!DICompositeType(${p.o})`;
  }
}

/** `DISubroutineType`: ops `{nullptr x 5, TypeArray}`. */
export class DISubroutineType extends DINode {
  readonly cls = "DISubroutineType";
  constructor(
    ctx: Context,
    readonly flags: number,
    readonly cc: number,
    typeArray: Metadata | undefined,
  ) {
    super(ctx, [undefined, undefined, undefined, undefined, undefined, typeArray], false);
  }
  keyInts(): readonly KeyField[] {
    return [this.flags, this.cc];
  }
  // llvm: llvm/lib/IR/AsmWriter.cpp:2379 writeDISubroutineType
  write(p: FieldPrinter): string {
    p.printDIFlags("flags", this.flags);
    p.printDwarfEnum("cc", this.cc, DW_CC_NAMES);
    p.printMetadata("types", this.ops[5], false);
    return `!DISubroutineType(${p.o})`;
  }
}

/** `DIFile`: ops `{Filename, Directory, Checksum value, Source}`; the checksum kind is a field. */
export class DIFile extends DINode {
  readonly cls = "DIFile";
  constructor(
    ctx: Context,
    filename: MDString | undefined,
    directory: MDString | undefined,
    readonly checksumKind: number | undefined,
    checksum: MDString | undefined,
    source: MDString | undefined,
  ) {
    super(ctx, [filename, directory, checksum, source], false);
  }
  keyInts(): readonly KeyField[] {
    return [this.checksumKind];
  }
  // llvm: llvm/lib/IR/AsmWriter.cpp:2390 writeDIFile
  write(p: FieldPrinter): string {
    p.printString("filename", opsString(this.ops[0]), false);
    p.printString("directory", opsString(this.ops[1]), false);
    // Print all values for checksum together, or not at all.
    if (this.checksumKind !== undefined) p.printChecksum(this.checksumKind, opsString(this.ops[2]));
    if (this.ops[3] !== undefined) p.printString("source", opsString(this.ops[3]), false);
    return `!DIFile(${p.o})`;
  }
}

/** `DICompileUnit` (always distinct): ops `{File, Producer, Flags, SplitDebugFilename, EnumTypes, RetainedTypes,
 * GlobalVariables, ImportedEntities, Macros, SysRoot, SDK}`. The language is a plain (unversioned) `DW_LANG_*` code. */
export class DICompileUnit extends DINode {
  readonly cls = "DICompileUnit";
  constructor(
    ctx: Context,
    readonly sourceLanguage: number,
    readonly isOptimized: boolean,
    readonly runtimeVersion: number,
    readonly emissionKind: number,
    readonly dwoId: bigint,
    readonly splitDebugInlining: boolean,
    readonly debugInfoForProfiling: boolean,
    readonly nameTableKind: number,
    readonly rangesBaseAddress: boolean,
    ops: (Metadata | undefined)[],
  ) {
    super(ctx, ops, true);
  }
  keyInts(): readonly KeyField[] {
    return unported("llir: DICompileUnit is never uniqued");
  }
  // llvm: llvm/lib/IR/AsmWriter.cpp:2406 writeDICompileUnit
  write(p: FieldPrinter): string {
    const o = this.ops;
    // `Lang.hasVersionedName()` is false: RustWrapper passes `unsigned Lang`, an unversioned DISourceLanguageName.
    p.printDwarfEnum("language", this.sourceLanguage, DW_LANG_NAMES, false);
    p.printMetadata("file", o[0], false);
    p.printString("producer", opsString(o[1]));
    p.printBool("isOptimized", this.isOptimized);
    p.printString("flags", opsString(o[2]));
    p.printInt("runtimeVersion", this.runtimeVersion, false);
    p.printString("splitDebugFilename", opsString(o[3]));
    p.printEmissionKind("emissionKind", this.emissionKind);
    p.printMetadata("enums", o[4]);
    p.printMetadata("retainedTypes", o[5]);
    p.printMetadata("globals", o[6]);
    p.printMetadata("imports", o[7]);
    p.printMetadata("macros", o[8]);
    p.printInt("dwoId", this.dwoId);
    p.printBool("splitDebugInlining", this.splitDebugInlining, true);
    p.printBool("debugInfoForProfiling", this.debugInfoForProfiling, false);
    p.printNameTableKind("nameTableKind", this.nameTableKind);
    p.printBool("rangesBaseAddress", this.rangesBaseAddress, false);
    p.printString("sysroot", opsString(o[9]));
    p.printString("sdk", opsString(o[10]));
    // `printDwarfEnum("dialect", Lang.getDialect(), ...)`: an unversioned name has dialect 0, which is skipped.
    return `!DICompileUnit(${p.o})`;
  }
}

/** `DISubprogram`: ops `{File, Scope, Name, LinkageName, Type, Unit, Declaration, RetainedNodes, ContainingType,
 * TemplateParams, ThrownTypes, Annotations, TargetFuncName}` (LLVM drops trailing null operands from ContainingType on, which
 * no accessor or printed field can tell apart). */
export class DISubprogram extends DINode {
  readonly cls = "DISubprogram";
  constructor(
    ctx: Context,
    distinct: boolean,
    readonly line: number,
    readonly scopeLine: number,
    readonly virtualIndex: number,
    readonly thisAdjustment: number,
    readonly flags: number,
    readonly spFlags: number,
    readonly usesKeyInstructions: boolean,
    ops: (Metadata | undefined)[],
  ) {
    super(ctx, ops, distinct);
  }
  keyInts(): readonly KeyField[] {
    return [this.line, this.scopeLine, this.virtualIndex, this.thisAdjustment, this.flags, this.spFlags, this.usesKeyInstructions];
  }
  isDefinition(): boolean {
    return (this.spFlags & SPFlagDefinition) !== 0;
  }
  /** `MDNodeSubsetEqualImpl<DISubprogram>::isDeclarationOfODRMember` (LLVMContextImpl.h:1008). */
  override odrKey(): string | undefined {
    const scope = this.ops[1];
    const linkageName = this.ops[3];
    if (this.isDefinition() || scope === undefined || linkageName === undefined) return undefined;
    if (!(scope instanceof DICompositeType) || scope.ops[9] === undefined) return undefined;
    return `DISubprogram.odr|${opId(scope)}|${opId(linkageName)}|${opId(this.ops[9])}`;
  }
  // llvm: llvm/lib/IR/AsmWriter.cpp:2453 writeDISubprogram
  write(p: FieldPrinter): string {
    const o = this.ops;
    p.printString("name", opsString(o[2]));
    p.printString("linkageName", opsString(o[3]));
    p.printMetadata("scope", o[1], false);
    p.printMetadata("file", o[0]);
    p.printInt("line", this.line);
    p.printMetadata("type", o[4]);
    p.printInt("scopeLine", this.scopeLine);
    p.printMetadata("containingType", o[8]);
    // `getVirtuality()`: the SPFlagVirtuality bits (DW_VIRTUALITY_none is 0).
    if ((this.spFlags & SPFlagVirtuality) !== 0 || this.virtualIndex !== 0) p.printInt("virtualIndex", this.virtualIndex, false);
    p.printInt("thisAdjustment", this.thisAdjustment);
    p.printDIFlags("flags", this.flags);
    p.printDISPFlags("spFlags", this.spFlags);
    p.printMetadata("unit", o[5]);
    p.printMetadata("templateParams", o[9]);
    p.printMetadata("declaration", o[6]);
    p.printMetadata("retainedNodes", o[7]);
    p.printMetadata("thrownTypes", o[10]);
    p.printMetadata("annotations", o[11]);
    p.printString("targetFuncName", opsString(o[12]));
    p.printBool("keyInstructions", this.usesKeyInstructions, false);
    return `!DISubprogram(${p.o})`;
  }
}

/** `DILexicalBlock`: ops `{File, Scope}`. */
export class DILexicalBlock extends DINode {
  readonly cls = "DILexicalBlock";
  constructor(
    ctx: Context,
    distinct: boolean,
    scope: Metadata,
    file: Metadata | undefined,
    readonly line: number,
    readonly column: number,
  ) {
    super(ctx, [file, scope], distinct);
  }
  get rawScope(): Metadata {
    return this.ops[1]!;
  }
  keyInts(): readonly KeyField[] {
    return [this.line, this.column];
  }
  // llvm: llvm/lib/IR/AsmWriter.cpp:2482 writeDILexicalBlock
  write(p: FieldPrinter): string {
    p.printMetadata("scope", this.ops[1], false);
    p.printMetadata("file", this.ops[0]);
    p.printInt("line", this.line);
    p.printInt("column", this.column);
    return `!DILexicalBlock(${p.o})`;
  }
}

/** `DILexicalBlockFile`: ops `{File, Scope}`. */
export class DILexicalBlockFile extends DINode {
  readonly cls = "DILexicalBlockFile";
  constructor(
    ctx: Context,
    scope: Metadata,
    file: Metadata | undefined,
    readonly discriminator: number,
  ) {
    super(ctx, [file, scope], false);
  }
  get rawScope(): Metadata {
    return this.ops[1]!;
  }
  keyInts(): readonly KeyField[] {
    return [this.discriminator];
  }
  /** `DILexicalBlockFile::getImpl` (DebugInfoMetadata.cpp:1513). */
  static get(ctx: Context, scope: Metadata, file: Metadata | undefined, discriminator: number): DILexicalBlockFile {
    return storeImpl(new DILexicalBlockFile(ctx, scope, file, discriminator));
  }
  // llvm: llvm/lib/IR/AsmWriter.cpp:2493 writeDILexicalBlockFile
  write(p: FieldPrinter): string {
    p.printMetadata("scope", this.ops[1], false);
    p.printMetadata("file", this.ops[0]);
    p.printInt("discriminator", this.discriminator, false);
    return `!DILexicalBlockFile(${p.o})`;
  }
}

/** `DINamespace`: ops `{nullptr (the DIScope file), Scope, Name}`. */
export class DINamespace extends DINode {
  readonly cls = "DINamespace";
  constructor(
    ctx: Context,
    scope: Metadata | undefined,
    name: MDString | undefined,
    readonly exportSymbols: boolean,
  ) {
    super(ctx, [undefined, scope, name], false);
  }
  keyInts(): readonly KeyField[] {
    return [this.exportSymbols];
  }
  // llvm: llvm/lib/IR/AsmWriter.cpp:2505 writeDINamespace
  write(p: FieldPrinter): string {
    p.printString("name", opsString(this.ops[2]));
    p.printMetadata("scope", this.ops[1], false);
    p.printBool("exportSymbols", this.exportSymbols, false);
    return `!DINamespace(${p.o})`;
  }
}

/** `DITemplateTypeParameter`: ops `{Name, Type}`. */
export class DITemplateTypeParameter extends DINode {
  readonly cls = "DITemplateTypeParameter";
  constructor(
    ctx: Context,
    name: MDString | undefined,
    type: Metadata | undefined,
    readonly isDefault: boolean,
  ) {
    super(ctx, [name, type], false);
  }
  keyInts(): readonly KeyField[] {
    return [this.isDefault];
  }
  // llvm: llvm/lib/IR/AsmWriter.cpp:2563 writeDITemplateTypeParameter
  write(p: FieldPrinter): string {
    p.printString("name", opsString(this.ops[0]));
    p.printMetadata("type", this.ops[1], false);
    p.printBool("defaulted", this.isDefault, false);
    return `!DITemplateTypeParameter(${p.o})`;
  }
}

/** `DIGlobalVariable` (distinct from DIBuilder): ops `{Scope, Name, File, Type, Name, LinkageName, StaticDataMemberDeclaration,
 * TemplateParams, Annotations}`. */
export class DIGlobalVariable extends DINode {
  readonly cls = "DIGlobalVariable";
  constructor(
    ctx: Context,
    distinct: boolean,
    readonly line: number,
    readonly isLocalToUnit: boolean,
    readonly isDefinition: boolean,
    readonly align: number,
    ops: (Metadata | undefined)[],
  ) {
    super(ctx, ops, distinct);
  }
  keyInts(): readonly KeyField[] {
    return [this.line, this.isLocalToUnit, this.isDefinition, this.align];
  }
  // llvm: llvm/lib/IR/AsmWriter.cpp:2588 writeDIGlobalVariable
  write(p: FieldPrinter): string {
    const o = this.ops;
    p.printString("name", opsString(o[1]));
    p.printString("linkageName", opsString(o[5]));
    p.printMetadata("scope", o[0], false);
    p.printMetadata("file", o[2]);
    p.printInt("line", this.line);
    p.printMetadata("type", o[3]);
    p.printBool("isLocal", this.isLocalToUnit);
    p.printBool("isDefinition", this.isDefinition);
    p.printMetadata("declaration", o[6]);
    p.printMetadata("templateParams", o[7]);
    p.printInt("align", this.align);
    p.printMetadata("annotations", o[8]);
    return `!DIGlobalVariable(${p.o})`;
  }
}

/** `DILocalVariable`: ops `{Scope, Name, File, Type, Annotations}`. */
export class DILocalVariable extends DINode {
  readonly cls = "DILocalVariable";
  constructor(
    ctx: Context,
    scope: Metadata,
    name: MDString | undefined,
    file: Metadata | undefined,
    readonly line: number,
    type: Metadata | undefined,
    readonly arg: number,
    readonly flags: number,
    readonly align: number,
    annotations: Metadata | undefined,
  ) {
    super(ctx, [scope, name, file, type, annotations], false);
  }
  get rawScope(): Metadata {
    return this.ops[0]!;
  }
  keyInts(): readonly KeyField[] {
    return [this.line, this.arg, this.flags, this.align];
  }
  // llvm: llvm/lib/IR/AsmWriter.cpp:2607 writeDILocalVariable
  write(p: FieldPrinter): string {
    p.printString("name", opsString(this.ops[1]));
    p.printInt("arg", this.arg);
    p.printMetadata("scope", this.ops[0], false);
    p.printMetadata("file", this.ops[2]);
    p.printInt("line", this.line);
    p.printMetadata("type", this.ops[3]);
    p.printDIFlags("flags", this.flags);
    p.printInt("align", this.align);
    p.printMetadata("annotations", this.ops[4]);
    return `!DILocalVariable(${p.o})`;
  }
}

/** `DIExpression`: no operands; its elements are `uint64_t`s. Printed inline, never numbered. */
export class DIExpression extends DINode {
  readonly cls = "DIExpression";
  constructor(
    ctx: Context,
    readonly elements: readonly bigint[],
  ) {
    super(ctx, [], false);
  }
  keyInts(): readonly KeyField[] {
    return this.elements;
  }
  override printsInline(): boolean {
    return true;
  }
  /** `DIExpression::isValid` (DebugInfoMetadata.cpp:1760). */
  isValid(): boolean {
    const e = this.elements;
    for (let i = 0; i < e.length; i += exprOpSize(e, i)) {
      // Check that there's space for the operand.
      if (i + exprOpSize(e, i) > e.length) return false;
      const op = Number(e[i]);
      if ((op >= OP("reg0") && op <= OP("reg31")) || (op >= OP("breg0") && op <= OP("breg31"))) return true;
      if (op === OP_LLVM_fragment) {
        // A fragment operator must appear at the end.
        return i + exprOpSize(e, i) === e.length;
      } else if (op === OP("stack_value")) {
        // Must be the last one or followed by a DW_OP_LLVM_fragment.
        if (i + exprOpSize(e, i) === e.length) continue;
        const j = i + exprOpSize(e, i);
        if (Number(e[j]) !== OP_LLVM_fragment) return false;
      } else if (op === OP("swap")) {
        // Must be more than one implicit element on the stack.
        if (e.length === 1) return false;
      } else if (op === OP_LLVM_entry_value) {
        let first = 0;
        if (Number(e[0]) === OP_LLVM_arg && e[1] === 0n) first = exprOpSize(e, 0);
        return i === first && e[i + 1] === 1n;
      } else if (!VALID_OPS.has(op)) return false;
    }
    return true;
  }
  // llvm: llvm/lib/IR/AsmWriter.cpp:2639 writeDIExpression
  write(_p: FieldPrinter): string {
    const parts: string[] = [];
    const e = this.elements;
    if (this.isValid()) {
      for (let i = 0; i < e.length; i += exprOpSize(e, i)) {
        const op = Number(e[i]);
        const opStr = operationEncodingString(op);
        if (opStr === "") return unported(`llir: DIExpression opcode ${op} has no name`);
        parts.push(opStr);
        if (op === OP_LLVM_convert) {
          parts.push(String(e[i + 1]));
          parts.push(DW_ATE_NAMES.get(Number(e[i + 2])) ?? "");
        } else for (let a = 1; a < exprOpSize(e, i); a++) parts.push(String(e[i + a]));
      }
    } else for (const x of e) parts.push(String(x));
    return `!DIExpression(${parts.join(", ")})`;
  }
}

const OP_IDS = new Map<string, number>();
/** A `DW_OP_<name>`'s value, from the Dwarf.def table (so no code is typed twice). */
function OP(name: string): number {
  let v = OP_IDS.get(name);
  if (v === undefined) {
    for (const [id, n] of DW_OP_NAMES) if (n === `DW_OP_${name}`) v = id;
    if (v === undefined) throw new Error(`llvm: no DW_OP_${name}`);
    OP_IDS.set(name, v);
  }
  return v;
}
const OP_LLVM_fragment = 0x1000;
const OP_LLVM_convert = 0x1001;
const OP_LLVM_tag_offset = 0x1002;
const OP_LLVM_entry_value = 0x1003;
const OP_LLVM_implicit_pointer = 0x1004;
const OP_LLVM_arg = 0x1005;
const OP_LLVM_extract_bits_sext = 0x1006;
const OP_LLVM_extract_bits_zext = 0x1007;

/** The cases of `isValid`'s switch that `break` (DebugInfoMetadata.cpp:1813-1857). */
const VALID_OPS: ReadonlySet<number> = new Set([
  OP_LLVM_implicit_pointer, OP_LLVM_convert, OP_LLVM_arg, OP_LLVM_tag_offset, OP_LLVM_extract_bits_sext, OP_LLVM_extract_bits_zext,
  ...["constu", "plus_uconst", "plus", "minus", "mul", "div", "mod", "or", "and", "xor", "shl", "shr", "shra", "deref", "deref_size",
    "xderef", "lit0", "not", "dup", "regx", "bregx", "push_object_address", "over", "rot", "consts", "eq", "ne", "gt", "ge", "lt",
    "le", "neg", "abs"].map(OP),
]);

/** `DIExpression::ExprOperand::getSize` (DebugInfoMetadata.cpp:1733). */
function exprOpSize(e: readonly bigint[], i: number): number {
  const op = Number(e[i]);
  if (op >= OP("breg0") && op <= OP("breg31")) return 2;
  if (op === OP_LLVM_convert || op === OP_LLVM_fragment || op === OP_LLVM_extract_bits_sext || op === OP_LLVM_extract_bits_zext || op === OP("bregx")) return 3;
  if (op === OP("constu") || op === OP("consts") || op === OP("deref_size") || op === OP("plus_uconst") || op === OP_LLVM_tag_offset || op === OP_LLVM_entry_value || op === OP_LLVM_arg || op === OP("regx")) return 2;
  return 1;
}

/** `DIGlobalVariableExpression`: ops `{Variable, Expression}`. */
export class DIGlobalVariableExpression extends DINode {
  readonly cls = "DIGlobalVariableExpression";
  keyInts(): readonly KeyField[] {
    return [];
  }
  // llvm: llvm/lib/IR/AsmWriter.cpp:2679 writeDIGlobalVariableExpression
  write(p: FieldPrinter): string {
    p.printMetadata("var", this.ops[0]);
    p.printMetadata("expr", this.ops[1]);
    return `!DIGlobalVariableExpression(${p.o})`;
  }
}

/** `DILocalScope::getSubprogram` (DebugInfoMetadata.cpp:1331): a lexical block's subprogram is its scope's. */
export function localScopeSubprogram(s: Metadata | undefined): DISubprogram | undefined {
  if (s instanceof DILexicalBlock || s instanceof DILexicalBlockFile) return localScopeSubprogram(s.rawScope);
  return s instanceof DISubprogram ? s : undefined;
}

/** `isa<DILocalScope>`: a subprogram or a lexical block (file). */
export function isLocalScope(s: Metadata | undefined): boolean {
  return s instanceof DISubprogram || s instanceof DILexicalBlock || s instanceof DILexicalBlockFile;
}
