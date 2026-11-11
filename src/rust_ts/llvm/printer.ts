// rust-ts: the IR model's printer (plan-m7 D5, §1b; lane llir-core-a). Prints a module as LLVM assembly that the pinned `opt`
// parses to the module the model holds, so the oracle's normal form (scripts/lib/ir-normal.ts) of both texts can be compared
// byte for byte. It follows `AsmWriter.cpp` (`// llvm:` markers) for what the normal form keeps: order of globals and
// functions, names, linkage and every other flag, attributes, initializers, metadata. It need not reproduce what the parser
// renumbers or canonicalises (review plan-m7 F6 "Size"): attribute group and metadata numbers, the order of type and comdat
// definitions, floating-point spelling (always hex here), and the spelling of calling conventions (`cc N`).
//
// Function bodies are llir-core-b's: `bodyPrinter` is the hook its instructions register.
import { unported } from "../../std/panic.ts";
import {
  Argument,
  ArrayType,
  type Attribute,
  Constant,
  ConstantAggregateZero,
  ConstantArray,
  ConstantDataSequential,
  ConstantExpr,
  ConstantFP,
  ConstantInt,
  ConstantPointerNull,
  ConstantStruct,
  ConstantVector,
  FUNCTION_INDEX,
  Function,
  FunctionType,
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
  type Module,
  PointerType,
  PoisonValue,
  StructType,
  type Type,
  UndefValue,
  type Value,
  ValueAsMetadata,
  VectorType,
} from "./ir.ts";

// ---- names and strings -------------------------------------------------------------------------------------------------

/** `printEscapedString` (llvm/lib/Support/StringExtras.cpp:49): `\` as `\\`, other printable ASCII but `"` as is, any other
 * byte as `\XX` (uppercase hex). Input and output are byte strings. */
export function printEscapedString(s: string): string {
  let o = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x5c) o += "\\\\";
    else if (c >= 0x20 && c <= 0x7e && c !== 0x22) o += s[i];
    else o += `\\${HEX[c >> 4]}${HEX[c & 15]}`;
  }
  return o;
}
const HEX = "0123456789ABCDEF";

const isAlnum = (c: number): boolean => (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);

// llvm: llvm/lib/IR/AsmWriter.cpp:462 printLLVMNameWithoutPrefix
export function printLLVMNameWithoutPrefix(name: string): string {
  // Scan the name to see if it needs quotes first.
  let needsQuotes = name.charCodeAt(0) >= 0x30 && name.charCodeAt(0) <= 0x39;
  if (!needsQuotes) {
    for (let i = 0; i < name.length; i++) {
      const c = name.charCodeAt(i);
      if (!isAlnum(c) && c !== 0x2d /* - */ && c !== 0x2e /* . */ && c !== 0x5f /* _ */) {
        needsQuotes = true;
        break;
      }
    }
  }
  // If we didn't need any quotes, just write out the name in one blast.
  if (!needsQuotes) return name;
  // Okay, we need quotes.  Output the quotes and escape any scary characters as needed.
  return `"${printEscapedString(name)}"`;
}

// llvm: llvm/lib/IR/AsmWriter.cpp:3472 getLinkageName
function getLinkageName(lt: LinkageTypes): string {
  switch (lt) {
    case "ExternalLinkage":
      return "external";
    case "PrivateLinkage":
      return "private";
    case "InternalLinkage":
      return "internal";
    case "LinkOnceAnyLinkage":
      return "linkonce";
    case "LinkOnceODRLinkage":
      return "linkonce_odr";
    case "WeakAnyLinkage":
      return "weak";
    case "WeakODRLinkage":
      return "weak_odr";
    case "CommonLinkage":
      return "common";
    case "AppendingLinkage":
      return "appending";
    case "ExternalWeakLinkage":
      return "extern_weak";
    case "AvailableExternallyLinkage":
      return "available_externally";
  }
}

// llvm: llvm/lib/IR/AsmWriter.cpp:3503 getLinkageNameWithSpace
const getLinkageNameWithSpace = (lt: LinkageTypes): string => (lt === "ExternalLinkage" ? "" : `${getLinkageName(lt)} `);

// llvm: llvm/lib/IR/AsmWriter.cpp:3862 printVisibility
const printVisibility = (g: GlobalValue): string => (g.visibility === "Hidden" ? "hidden " : g.visibility === "Protected" ? "protected " : "");

// llvm: llvm/lib/IR/AsmWriter.cpp:3871 printDSOLocation
const printDSOLocation = (g: GlobalValue): string => (g.isDSOLocal && !g.isImplicitDSOLocal() ? "dso_local " : "");

// llvm: llvm/lib/IR/AsmWriter.cpp:3877 printDLLStorageClass
const printDLLStorageClass = (g: GlobalValue): string => (g.dllStorageClass === "DllImport" ? "dllimport " : g.dllStorageClass === "DllExport" ? "dllexport " : "");

// llvm: llvm/lib/IR/AsmWriter.cpp:3886 printThreadLocalModel
function printThreadLocalModel(g: GlobalValue): string {
  switch (g.threadLocalMode) {
    case "NotThreadLocal":
      return "";
    case "GeneralDynamic":
      return "thread_local ";
    case "LocalDynamic":
      return "thread_local(localdynamic) ";
    case "InitialExec":
      return "thread_local(initialexec) ";
    case "LocalExec":
      return "thread_local(localexec) ";
  }
}

// llvm: llvm/lib/IR/AsmWriter.cpp:3906 getUnnamedAddrEncoding
const getUnnamedAddrEncoding = (g: GlobalValue): string => (g.unnamedAddr === "Local" ? "local_unnamed_addr" : g.unnamedAddr === "Global" ? "unnamed_addr" : "");

/** `printAddressSpace` (Prefix, Suffix): non-zero address spaces, or zero when forced. */
const printAddressSpace = (as: number, prefix: string, suffix: string, force = false): string => (as !== 0 || force ? `${prefix}addrspace(${as})${suffix}` : "");

// ---- the printer -------------------------------------------------------------------------------------------------------

/** llir-core-b's hook: prints a definition's blocks (`{` and `}` excluded) with the printer's slot numbering. */
export type BodyPrinter = (f: Function, p: Printer) => string;
let bodyPrinter: BodyPrinter | undefined;
export function setBodyPrinter(b: BodyPrinter): void {
  bodyPrinter = b;
}

/** One printing of a module (or of a lone value): the slot numbers of unnamed globals, struct types, metadata, attributes. */
export class Printer {
  private readonly typeSlots = new Map<StructType, number>();
  private readonly globalSlots = new Map<GlobalValue, number>();
  private readonly mdSlots = new Map<MDNode, number>();
  private readonly mdOrder: MDNode[] = [];
  private readonly attrGroups = new Map<string, number>();
  constructor(readonly module: Module | undefined) {
    if (module === undefined) return;
    // `SlotTracker::processModule`: unnamed globals, then unnamed aliases, then metadata of named metadata, then unnamed
    // functions, each numbered in module order.
    for (const gv of module.globals) {
      if (!gv.hasName()) this.globalSlots.set(gv, this.globalSlots.size);
      for (const [, n] of gv.metadata) this.mdSlot(n);
    }
    for (const a of module.aliases) if (!a.hasName()) this.globalSlots.set(a, this.globalSlots.size);
    for (const nodes of module.namedMetadata.values()) for (const n of nodes) this.mdSlot(n);
    for (const f of module.functions) {
      if (!f.hasName()) this.globalSlots.set(f, this.globalSlots.size);
      for (const [, n] of f.metadata) this.mdSlot(n);
    }
  }

  /** `CreateMetadataSlot`: a node, then the nodes among its operands. */
  mdSlot(n: MDNode): number {
    let s = this.mdSlots.get(n);
    if (s !== undefined) return s;
    s = this.mdOrder.length;
    this.mdSlots.set(n, s);
    this.mdOrder.push(n);
    for (const op of n.ops) if (op instanceof MDNode) this.mdSlot(op);
    return s;
  }

  // ---- types ----

  // llvm: llvm/lib/IR/AsmWriter.cpp:656 TypePrinting::print
  type(t: Type): string {
    switch (t.typeID) {
      case "Void":
        return "void";
      case "Half":
        return "half";
      case "BFloat":
        return "bfloat";
      case "Float":
        return "float";
      case "Double":
        return "double";
      case "X86_FP80":
        return "x86_fp80";
      case "FP128":
        return "fp128";
      case "PPC_FP128":
        return "ppc_fp128";
      case "Label":
        return "label";
      case "Metadata":
        return "metadata";
      case "X86_AMX":
        return "x86_amx";
      case "Token":
        return "token";
      case "Integer":
        return `i${(t as IntegerType).bits}`;
      case "Function": {
        const ft = t as FunctionType;
        const ps = ft.params.map((p) => this.type(p));
        if (ft.isVarArg) ps.push("...");
        return `${this.type(ft.returnType)} (${ps.join(", ")})`;
      }
      case "Struct": {
        const st = t as StructType;
        if (st.literal) return this.structBody(st);
        if (st.name !== "") return `%${printLLVMNameWithoutPrefix(st.name)}`;
        return `%${this.unnamedStructSlot(st)}`;
      }
      case "Pointer":
        return `ptr${printAddressSpace((t as PointerType).addressSpace, " ", "")}`;
      case "Array": {
        const at = t as ArrayType;
        return `[${at.numElements} x ${this.type(at.elementType)}]`;
      }
      case "Vector":
      case "ScalableVector": {
        const vt = t as VectorType;
        return `<${vt.scalable ? "vscale x " : ""}${vt.numElements} x ${this.type(vt.elementType)}>`;
      }
    }
  }

  /** `printStructBody`: `{ T, U }`, `<{ T }>`, `{}`, or `opaque`. */
  structBody(st: StructType): string {
    if (st.body === undefined) return "opaque";
    const inner = st.body.length === 0 ? "{}" : `{ ${st.body.map((e) => this.type(e)).join(", ")} }`;
    return st.packed ? `<${inner}>` : inner;
  }

  private unnamedStructSlot(st: StructType): number {
    let s = this.typeSlots.get(st);
    if (s === undefined) {
      if (this.module === undefined) return unported("llir: printing an unnamed identified struct type outside a module");
      this.typeSlots.set(st, (s = this.typeSlots.size));
    }
    return s;
  }

  // ---- operands and constants ----

  // llvm: llvm/lib/IR/AsmWriter.cpp:2737 writeAsOperandInternal
  operand(v: Value, printType: boolean): string {
    const ty = printType ? `${this.type(v.type)} ` : "";
    if (v instanceof GlobalValue) {
      if (v.hasName()) return `${ty}@${printLLVMNameWithoutPrefix(v.name)}`;
      const s = this.globalSlots.get(v);
      return s === undefined ? `${ty}@<badref>` : `${ty}@${s}`;
    }
    if (v instanceof Constant) return ty + this.constant(v);
    if (v instanceof MetadataAsValue) return ty + this.metadataOperand(v.md);
    if (v instanceof Argument && v.hasName()) return `${ty}%${printLLVMNameWithoutPrefix(v.name)}`;
    if (this.localOperand !== undefined) return ty + this.localOperand(v);
    return unported("llir: printing an unnamed local value (llir-core-b's function slots)");
  }
  /** llir-core-b's hook for locals (`%N`, instructions), set while a body prints. */
  localOperand: ((v: Value) => string) | undefined;

  // llvm: llvm/lib/IR/AsmWriter.cpp:1604 writeConstantInternal
  constant(c: Constant): string {
    if (c instanceof ConstantInt) {
      if (c.type.isVectorTy()) return unported("llir: printing a vector-typed ConstantInt (splat)");
      if (c.intType.bits === 1) return c.value ? "true" : "false";
      return c.sextValue.toString();
    }
    if (c instanceof ConstantFP) {
      // PORT: always the hex form (`f0x` and the full bit pattern, `WriteFullHexAPInt`), which the parser reads back exactly;
      // the oracle prints a decimal when it round-trips, and the normal form re-prints both the same way.
      const digits = Math.max(Math.ceil(c.type.fpBits() / 4), 1);
      return `f0x${c.bits.toString(16).toUpperCase().padStart(digits, "0")}`;
    }
    if (c instanceof ConstantAggregateZero) return "zeroinitializer";
    if (c instanceof ConstantArray) return `[${c.operands.map((o) => this.operand(o, true)).join(", ")}]`;
    if (c instanceof ConstantDataSequential) {
      if (c.isString()) return `c"${printEscapedString(String.fromCharCode(...c.elements.map((e) => Number((e as ConstantInt).value))))}"`;
      const elems = c.elements.map((e) => this.operand(e, true)).join(", ");
      return c.type instanceof ArrayType ? `[${elems}]` : `<${elems}>`;
    }
    if (c instanceof ConstantStruct) {
      const st = c.type as StructType;
      let o = st.packed ? "<{" : "{";
      if (c.operands.length !== 0) o += ` ${c.operands.map((x) => this.operand(x, true)).join(", ")} `;
      return o + (st.packed ? "}>" : "}");
    }
    if (c instanceof ConstantVector) return `<${c.operands.map((o) => this.operand(o, true)).join(", ")}>`;
    if (c instanceof ConstantPointerNull) {
      if (c.type.isVectorTy()) return unported("llir: printing a vector ConstantPointerNull (splat)");
      return "null";
    }
    if (c instanceof PoisonValue) return "poison";
    if (c instanceof UndefValue) return "undef";
    if (c instanceof ConstantExpr) {
      let o = `${OPCODE_NAME[c.opcode]}${this.optimizationInfo(c)} (`;
      if (c.opcode === "GetElementPtr") o += `${this.type(c.srcElementType!)}, `;
      o += c.operands.map((x) => this.operand(x, true)).join(", ");
      if (c.isCast()) o += ` to ${this.type(c.type)}`;
      return `${o})`;
    }
    return unported(`llir: printing a ${c.constructor.name}`);
  }

  // llvm: llvm/lib/IR/AsmWriter.cpp:1500 writeOptimizationInfo
  private optimizationInfo(c: ConstantExpr): string {
    if (c.opcode === "GetElementPtr") {
      // GEPNoWrapFlags: `inbounds` (InBounds implies NUSW), else `nusw`; then `nuw`.
      let o = "";
      if (c.flags & 1) o += " inbounds";
      else if (c.flags & 2) o += " nusw";
      if (c.flags & 4) o += " nuw";
      return o;
    }
    if (c.opcode === "Add" || c.opcode === "Sub" || c.opcode === "Mul") return `${c.flags & 1 ? " nuw" : ""}${c.flags & 2 ? " nsw" : ""}`;
    return "";
  }

  // ---- metadata ----

  metadataOperand(md: Metadata | undefined): string {
    if (md === undefined) return "null";
    if (md instanceof MDString) return `!"${printEscapedString(md.str)}"`;
    if (md instanceof MDNode) return `!${this.mdSlot(md)}`;
    if (md instanceof ValueAsMetadata) return this.operand(md.value, true);
    return unported(`llir: printing ${md.constructor.name}`);
  }

  // llvm: llvm/lib/IR/AsmWriter.cpp:1870 writeMDTuple
  mdTuple(n: MDNode): string {
    return `${n.distinct ? "distinct " : ""}!{${n.ops.map((o) => this.metadataOperand(o)).join(", ")}}`;
  }

  /** `printMetadataIdentifier`: a metadata name, with `\XX` escapes where it is not `[-a-zA-Z$._][-a-zA-Z$._0-9]*`. */
  private mdName(name: string): string {
    let o = "";
    for (let i = 0; i < name.length; i++) {
      const c = name.charCodeAt(i);
      const ok = isAlnum(c) || c === 0x2d || c === 0x24 || c === 0x2e || c === 0x5f;
      o += ok && !(i === 0 && c >= 0x30 && c <= 0x39) ? name[i] : `\\${HEX[c >> 4]}${HEX[c & 15]}`;
    }
    return o;
  }

  private mdAttachments(g: GlobalObject, sep: string): string {
    const kinds = [...g.context.mdKinds.entries()];
    // `getAllMetadata`: sorted by kind ID, stably (Metadata.cpp `Value::getAllMetadata`).
    return [...g.metadata].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${sep}!${this.mdName(kinds.find(([, id]) => id === k)![0])} !${this.mdSlot(n)}`).join("");
  }

  // ---- attributes ----

  /** `AttributeSet::getAsString(InAttrGrp = false)`. */
  attributeSet(set: Map<string, Attribute> | undefined): string {
    return set === undefined ? "" : [...set.values()].map((a) => a.print(false)).join(" ");
  }
  private attributeGroup(set: Map<string, Attribute>): number {
    const text = [...set.values()].map((a) => a.print(true)).join(" ");
    let n = this.attrGroups.get(text);
    if (n === undefined) this.attrGroups.set(text, (n = this.attrGroups.size));
    return n;
  }

  // ---- globals ----

  // llvm: llvm/lib/IR/AsmWriter.cpp:3936 AssemblyWriter::printGlobal
  global(gv: GlobalVariable): string {
    let o = `${this.operand(gv, false)} = `;
    if (gv.initializer === undefined && gv.linkage === "ExternalLinkage") o += "external ";
    o += getLinkageNameWithSpace(gv.linkage) + printDSOLocation(gv) + printVisibility(gv) + printDLLStorageClass(gv) + printThreadLocalModel(gv);
    const ua = getUnnamedAddrEncoding(gv);
    if (ua !== "") o += `${ua} `;
    o += printAddressSpace(gv.addressSpace, "", " ");
    if (gv.isExternallyInitialized) o += "externally_initialized ";
    o += `${gv.isConstantGlobal ? "constant " : "global "}${this.type(gv.valueType)}`;
    if (gv.initializer !== undefined) o += ` ${this.operand(gv.initializer, false)}`;
    if (gv.section !== undefined) o += `, section "${printEscapedString(gv.section)}"`;
    o += this.comdat(gv);
    if (gv.alignment !== undefined) o += `, align ${gv.alignment}`;
    return o + this.mdAttachments(gv, ", ");
  }

  // llvm: llvm/lib/IR/AsmWriter.cpp:3918 maybePrintComdat
  private comdat(g: GlobalObject): string {
    const c = g.comdat;
    if (c === undefined) return "";
    let o = `${g instanceof GlobalVariable ? "," : ""} comdat`;
    if (g.name === c.name) return o;
    o += `($${printLLVMNameWithoutPrefix(c.name)})`;
    return o;
  }

  // llvm: llvm/lib/IR/AsmWriter.cpp:4027 AssemblyWriter::printAlias
  alias(ga: GlobalAlias): string {
    let o = `${this.operand(ga, false)} = ${getLinkageNameWithSpace(ga.linkage)}${printDSOLocation(ga)}${printVisibility(ga)}${printDLLStorageClass(ga)}${printThreadLocalModel(ga)}`;
    const ua = getUnnamedAddrEncoding(ga);
    if (ua !== "") o += `${ua} `;
    o += `alias ${this.type(ga.valueType)}, ${this.operand(ga.aliasee, !(ga.aliasee instanceof ConstantExpr))}`;
    return `${o}\n`;
  }

  // llvm: llvm/lib/IR/AsmWriter.cpp:4139 AssemblyWriter::printFunction
  function(f: Function): string {
    const decl = f.isDeclaration();
    let o = decl ? `declare${this.mdAttachments(f, " ")} ` : "define ";
    o += getLinkageNameWithSpace(f.linkage) + printDSOLocation(f) + printVisibility(f) + printDLLStorageClass(f);
    // PORT: a non-C convention prints as `cc N`, which the parser reads as the named convention `printCallingConv` writes.
    if (f.callingConv !== 0) o += `cc ${f.callingConv} `;
    const ret = f.attributes.get(0);
    if (ret?.size) o += `${this.attributeSet(ret)} `;
    o += `${this.type(f.functionType.returnType)} ${this.operand(f, false)}(`;
    const params = f.functionType.params.map((p, i) => {
      const attrs = f.attributes.get(i + 1);
      let s = this.type(p);
      if (attrs?.size) s += ` ${this.attributeSet(attrs)}`;
      if (!decl) s += ` ${this.operand(f.args[i]!, false)}`;
      return s;
    });
    if (f.functionType.isVarArg) params.push("...");
    o += `${params.join(", ")})`;
    const ua = getUnnamedAddrEncoding(f);
    if (ua !== "") o += ` ${ua}`;
    o += printAddressSpace(f.addressSpace, " ", "", f.parent !== undefined && f.parent.layoutAddressSpace("P") !== 0);
    const fn = f.attributes.get(FUNCTION_INDEX);
    if (fn?.size) o += ` #${this.attributeGroup(fn)}`;
    if (f.section !== undefined) o += ` section "${printEscapedString(f.section)}"`;
    o += this.comdat(f);
    if (f.alignment !== undefined) o += ` align ${f.alignment}`;
    if (f.gc !== undefined) o += ` gc "${f.gc}"`;
    if (f.personality !== undefined) o += ` personality ${this.operand(f.personality, true)}`;
    if (decl) return `${o}\n`;
    if (bodyPrinter === undefined) return unported("llir: printing a function body (llir-core-b registers the body printer)");
    return `${o}${this.mdAttachments(f, " ")} {\n${bodyPrinter(f, this)}}\n`;
  }

  // llvm: llvm/lib/IR/AsmWriter.cpp:3105 AssemblyWriter::printModule
  module_(m: Module): string {
    let o = "";
    if (m.moduleID !== "" && !m.moduleID.includes("\n")) o += `; ModuleID = '${m.moduleID}'\n`;
    if (m.sourceFileName !== "") o += `source_filename = "${printEscapedString(m.sourceFileName)}"\n`;
    if (m.dataLayout !== "") o += `target datalayout = "${m.dataLayout}"\n`;
    if (m.targetTriple !== "") o += `target triple = "${m.targetTriple}"\n`;
    if (m.inlineAsm !== "") return unported("llir: printing module inline asm");
    // Print the bodies first: they number unnamed struct types and attribute groups as they go.
    const globals = m.globals.map((g) => `${this.global(g)}\n`).join("");
    const aliases = m.aliases.map((a) => this.alias(a)).join("");
    const functions = m.functions.map((f) => `\n${this.function(f)}`).join("");
    // Type identities (`printTypeIdentities`): every identified struct the module uses.
    const types = this.usedIdentifiedStructs(m);
    if (types.length) o += "\n";
    for (const st of types) o += `${this.type(st)} = type ${this.structBody(st)}\n`;
    const comdats = [...new Set([...m.globals, ...m.functions].map((g) => g.comdat).filter((c) => c !== undefined))];
    if (comdats.length) o += "\n";
    o += comdats.map((c) => `$${printLLVMNameWithoutPrefix(c.name)} = comdat ${COMDAT_KIND[c.selectionKind]}`).join("\n");
    if (comdats.length) o += "\n";
    if (m.globals.length) o += `\n${globals}`;
    if (m.aliases.length) o += `\n${aliases}`;
    o += functions;
    if (this.attrGroups.size) {
      o += "\n";
      for (const [text, n] of this.attrGroups) o += `attributes #${n} = { ${text} }\n`;
    }
    if (m.namedMetadata.size) o += "\n";
    for (const [name, nodes] of m.namedMetadata) o += `!${this.mdName(name)} = !{${nodes.map((n) => `!${this.mdSlot(n)}`).join(", ")}}\n`;
    if (this.mdOrder.length) {
      o += "\n";
      for (let i = 0; i < this.mdOrder.length; i++) o += `!${i} = ${this.mdTuple(this.mdOrder[i]!)}\n`;
    }
    return o;
  }

  // llvm: llvm/lib/IR/TypeFinder.cpp:34 TypeFinder::run
  /** `TypeFinder::run(M, onlyNamed = false)`'s identified structs: from globals, their initializers, functions, attributes. */
  private usedIdentifiedStructs(m: Module): StructType[] {
    const seen = new Set<Type>();
    const out: StructType[] = [];
    const seenValues = new Set<Value>();
    const visitType = (t: Type): void => {
      if (seen.has(t)) return;
      seen.add(t);
      if (t instanceof StructType) {
        if (!t.literal) out.push(t);
        for (const e of t.body ?? []) visitType(e);
      } else if (t instanceof ArrayType || t instanceof VectorType) visitType(t.elementType);
      else if (t instanceof FunctionType) {
        visitType(t.returnType);
        t.params.forEach(visitType);
      }
    };
    const visitValue = (v: Value): void => {
      if (seenValues.has(v)) return;
      seenValues.add(v);
      visitType(v.type);
      if (v instanceof ConstantExpr && v.srcElementType) visitType(v.srcElementType);
      if (v instanceof Constant && !(v instanceof GlobalValue)) v.operands.forEach(visitValue);
      if (v instanceof ConstantDataSequential) v.elements.forEach(visitValue);
    };
    for (const g of m.globals) {
      visitType(g.valueType);
      if (g.initializer) visitValue(g.initializer);
    }
    for (const a of m.aliases) {
      visitType(a.valueType);
      visitValue(a.aliasee);
    }
    for (const f of m.functions) {
      visitType(f.valueType);
      // `TypeFinder::incorporateAttributes`: the types of type attributes (`byval(%T)`, `sret(%T)`, `elementtype(%T)`).
      for (const set of f.attributes.values()) for (const a of set.values()) if (a.type !== undefined) visitType(a.type);
    }
    // PORT: types used only in function bodies are llir-core-b's to add (its body walk).
    return out;
  }
}

/** `Instruction::getOpcodeName` of the constant expression opcodes. */
const OPCODE_NAME: Readonly<Record<string, string>> = {
  GetElementPtr: "getelementptr", Trunc: "trunc", PtrToInt: "ptrtoint", IntToPtr: "inttoptr", BitCast: "bitcast",
  AddrSpaceCast: "addrspacecast", Add: "add", Sub: "sub", Mul: "mul", Xor: "xor", ExtractElement: "extractelement",
  InsertElement: "insertelement", ShuffleVector: "shufflevector",
};

const COMDAT_KIND: Readonly<Record<string, string>> = { Any: "any", ExactMatch: "exactmatch", Largest: "largest", NoDeduplicate: "nodeduplicate", SameSize: "samesize" };

// ---- entry points ------------------------------------------------------------------------------------------------------

/** The module's text (`Module::print`), as a byte string. */
export function printModule(m: Module): string {
  return new Printer(m).module_(m);
}

/** `Type::print` (no module: an unnamed identified struct stops). */
export function printTypeToString(t: Type): string {
  return new Printer(undefined).type(t);
}

// llvm: llvm/lib/IR/AsmWriter.cpp:5259 Value::print
/** `Value::print`: a global's whole definition, a constant as `<type> <value>`, an argument as an operand with its type. */
export function printValueToString(v: Value): string {
  const p = new Printer(v instanceof GlobalValue ? v.parent : undefined);
  if (v instanceof GlobalVariable) return p.global(v);
  if (v instanceof Function) return p.function(v).replace(/\n$/, "");
  if (v instanceof GlobalAlias) return p.alias(v).replace(/\n$/, "");
  if (v instanceof Constant) return `${p.type(v.type)} ${p.constant(v)}`;
  if (v instanceof Argument) return p.operand(v, true);
  return unported(`llir: printing a ${v.constructor.name} (llir-core-b)`);
}
