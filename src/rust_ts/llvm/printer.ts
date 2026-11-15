// rust-ts: the IR model's printer (plan-m7 D5, §1b; lane llir-core-a). Prints a module as LLVM assembly that the pinned `opt`
// parses to the module the model holds, so the oracle's normal form (scripts/lib/ir-normal.ts) of both texts can be compared
// byte for byte. It follows `AsmWriter.cpp` (`// llvm:` markers) for what the normal form keeps: order of globals and
// functions, names, linkage and every other flag, attributes, initializers, metadata. It need not reproduce what the parser
// renumbers or canonicalises (review plan-m7 F6 "Size"): attribute group and metadata numbers, and the order of type and comdat
// definitions. Calling conventions are spelt by name and attributes in LLVM's sorted order (lane llir-folder). Floating-point constants are spelt as AsmWriter spells them
// (`writeAPFloatInternal`: decimal when it round-trips, else hex; lane llir-apfloat).
//
// Function bodies are llir-core-b's: `bodyPrinter` is the hook its instructions register.
import { unported } from "../../std/panic.ts";
import { APFloat, semanticsSizeInBits } from "./apfloat.ts";
import {
  Argument,
  ArrayType,
  type Attribute,
  Constant,
  type Context,
  ConstantAggregateZero,
  ConstantArray,
  ConstantDataSequential,
  ConstantExpr,
  ConstantFP,
  ConstantInt,
  ConstantPointerNull,
  ConstantStruct,
  ConstantTokenNone,
  ConstantVector,
  FUNCTION_INDEX,
  Function,
  FunctionType,
  getSplatValue,
  GlobalAlias,
  GlobalObject,
  GlobalValue,
  GlobalVariable,
  IntegerType,
  type LinkageTypes,
  MDNode,
  MDString,
  type Metadata,
  InlineAsm,
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

/** `CallingConv::ID` values with a name of their own in `printCallingConv` (CallingConv.h at the pin; lane llir-folder).
 *  folder.oracle.test.ts compares the model's spelling with libLLVM's for every value from 0 to 1023. */
// prettier-ignore
const CALLING_CONV_NAMES: ReadonlyMap<number, string> = new Map<number, string>([
  [8, "fastcc"], [9, "coldcc"], [13, "anyregcc"], [14, "preserve_mostcc"], [15, "preserve_allcc"], [21, "preserve_nonecc"],
  [17, "cxx_fast_tlscc"], [10, "ghccc"], [18, "tailcc"], [107, "graalcc"], [19, "cfguard_checkcc"], [64, "x86_stdcallcc"],
  [65, "x86_fastcallcc"], [70, "x86_thiscallcc"], [92, "x86_regcallcc"], [80, "x86_vectorcallcc"], [77, "intel_ocl_bicc"],
  [66, "arm_apcscc"], [67, "arm_aapcscc"], [68, "arm_aapcs_vfpcc"], [97, "aarch64_vector_pcs"], [98, "aarch64_sve_vector_pcs"],
  [102, "aarch64_sme_preservemost_from_x0"], [111, "aarch64_sme_preservemost_from_x1"], [103, "aarch64_sme_preservemost_from_x2"],
  // `avr_intrcc ` and `avr_signalcc ` carry a trailing space in AsmWriter, so the printed line has two.
  [69, "msp430_intrcc"], [84, "avr_intrcc "], [85, "avr_signalcc "], [71, "ptx_kernel"], [72, "ptx_device"], [78, "x86_64_sysvcc"],
  [79, "win64cc"], [75, "spir_func"], [76, "spir_kernel"], [16, "swiftcc"], [20, "swifttailcc"], [83, "x86_intrcc"], [81, "hhvmcc"],
  [82, "hhvm_ccc"], [87, "amdgpu_vs"], [95, "amdgpu_ls"], [93, "amdgpu_hs"], [96, "amdgpu_es"], [88, "amdgpu_gs"], [89, "amdgpu_ps"],
  [90, "amdgpu_cs"], [104, "amdgpu_cs_chain"], [105, "amdgpu_cs_chain_preserve"], [91, "amdgpu_kernel"], [100, "amdgpu_gfx"],
  [124, "amdgpu_gfx_whole_wave"], [106, "m68k_rtdcc"], [110, "riscv_vector_cc"],
  // `CC_VLS_CASE(ABI_VLEN)`: RISCV_VLSCall_32 (112) to RISCV_VLSCall_65536 (123).
  ...[32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536].map((vlen, i): [number, string] => [112 + i, `riscv_vls_cc(${vlen})`]),
  [125, "cheriot_compartmentcallcc"], [126, "cheriot_compartmentcalleecc"], [127, "cheriot_librarycallcc"],
]);

// llvm: llvm/lib/IR/AsmWriter.cpp:349 printCallingConv
/** A calling convention as AsmWriter spells it: its name, or `cc<N>` (no space) for one without a name. */
export function printCallingConv(cc: number): string {
  return CALLING_CONV_NAMES.get(cc) ?? `cc${cc}`;
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
/** llir-core-b's slot numbering of a function's unnamed locals (`SlotTracker::incorporateFunction`). */
let functionSlots: ((f: Function) => (v: Value) => string) | undefined;
export function setBodyPrinter(b: BodyPrinter, slots: (f: Function) => (v: Value) => string): void {
  bodyPrinter = b;
  functionSlots = slots;
}

/** One printing of a module (or of a lone value): the slot numbers of unnamed globals, struct types, metadata, attributes. */
// llvm: llvm/lib/IR/AsmWriter.cpp:1540 WriteFullHexAPInt
/** `0x` and the value's hex digits, zero-padded to the width's digit count (`toStringUnsigned` writes upper case). */
function writeFullHexAPInt(val: bigint, bitWidth: number): string {
  const bits = val.toString(16).toUpperCase();
  const numDigits = Math.max(Math.floor((bitWidth + 3) / 4), 1);
  return `0x${"0".repeat(Math.max(numDigits - bits.length, 0))}${bits}`;
}

// llvm: llvm/lib/IR/AsmWriter.cpp:1550 writeAPFloatInternal
export function writeAPFloatInternal(apf: APFloat): string {
  let forceBitwiseOutput = false;
  if (apf.semantics === "PPCDoubleDouble") {
    // ppc_fp128 types are double-double. The special cases set the second (high) double to +0.0, so if the high word is
    // nonzero, force the use of bitwise output.
    const hiWord = apf.bitcastToAPInt() >> 64n;
    forceBitwiseOutput = hiWord !== 0n;
  }
  if (!forceBitwiseOutput) {
    // Check for special values in APFloat.
    if (apf.isInfinity()) return `${apf.isNegative() ? "-" : "+"}inf`;
    if (apf.isNaN()) {
      let o = apf.isNegative() ? "-" : "+";
      const payload = apf.getNaNPayload();
      // The quiet bit of a NaN is the highest bit of the payload, so the preferred QNaN value happens to be the sign mask
      // value.
      const signMask = 1n << BigInt(payload.width - 1);
      if (payload.value === signMask) {
        o += "qnan";
      } else {
        if (apf.isSignaling()) o += "s";
        // Clear out the signaling/quiet bit of the payload for output, then trim the string to exclude leading 0's.
        const cleared = payload.value & (signMask - 1n);
        o += `nan(${writeFullHexAPInt(cleared, cleared === 0n ? 0 : cleared.toString(2).length)})`;
      }
      return o;
    }
  }
  // Try for a decimal string output. If the value is convertible back to the same APFloat value, then we know that it is
  // safe to use it. Otherwise, fall back onto the hexadecimal format.
  const strVal = apf.toString(6, 0, false);
  if (APFloat.fromString(apf.semantics, strVal).equals(apf)) return strVal;
  // Fallback to the hexadecimal format representing the bit string exactly.
  return `f${writeFullHexAPInt(apf.bitcastToAPInt(), semanticsSizeInBits(apf.semantics))}`;
}

export class Printer {
  private readonly typeSlots = new Map<StructType, number>();
  private readonly globalSlots = new Map<GlobalValue, number>();
  private readonly mdSlots = new Map<MDNode, number>();
  private readonly mdOrder: MDNode[] = [];
  private readonly attrGroups = new Map<string, number>();
  constructor(readonly module: Module | undefined) {
    if (module === undefined) return;
    // `SlotTracker::processModule`: unnamed globals, then unnamed aliases, then metadata of named metadata, then unnamed
    // functions, each numbered in module order. A function's own metadata is numbered when the function is printed
    // (`incorporateFunction` → `processFunctionMetadata`, AsmWriter.cpp:1143 and :4164): its attachments, then its body's, as
    // `function()` prints them (llir-di).
    for (const gv of module.globals) {
      if (!gv.hasName()) this.globalSlots.set(gv, this.globalSlots.size);
      for (const [, n] of gv.metadata) this.mdSlot(n);
    }
    for (const a of module.aliases) if (!a.hasName()) this.globalSlots.set(a, this.globalSlots.size);
    for (const nodes of module.namedMetadata.values()) for (const n of nodes) this.mdSlot(n);
    for (const f of module.functions) {
      if (!f.hasName()) this.globalSlots.set(f, this.globalSlots.size);
    }
  }

  /** `CreateMetadataSlot`: a node, then the nodes among its operands. */
  mdSlot(n: MDNode): number {
    // Don't make slots for DIExpressions. We just print them inline everywhere (llir-di).
    if (n.printsInline()) return -1;
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
    if (v instanceof InlineAsm) {
      // lane llir-folder.
      let o = "asm ";
      if (v.hasSideEffects) o += "sideeffect ";
      if (v.isAlignStack) o += "alignstack ";
      // We don't emit the AD_ATT dialect as it's the assumed default.
      if (v.dialect === "AD_Intel") o += "inteldialect ";
      if (v.canThrow) o += "unwind ";
      return `${ty}${o}"${printEscapedString(v.asmString)}", "${printEscapedString(v.constraints)}"`;
    }
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
      const ty = c.type;
      let o = "";
      if (ty.isVectorTy()) {
        if (c.getValueAPF().bitcastToAPInt() === 0n) return "zeroinitializer";
        o += `splat (${this.type(ty.getScalarType())} `;
      }
      o += writeAPFloatInternal(c.getValueAPF());
      if (ty.isVectorTy()) o += ")";
      return o;
    }
    if (c instanceof ConstantAggregateZero) return "zeroinitializer";
    if (c instanceof ConstantArray) return `[${c.operands.map((o) => this.operand(o, true)).join(", ")}]`;
    if ((c instanceof ConstantDataSequential || c instanceof ConstantVector) && c.type instanceof VectorType) {
      // The shorthand for a splat vector, `splat (<ty> <val>)` (AsmWriter.cpp writeConstantInternal, "Use the same shorthand
      // for splat vector"): when the splat value is a ConstantInt or ConstantFP.
      const splat = getSplatValue(c);
      if (splat instanceof ConstantInt || splat instanceof ConstantFP) return `splat (${this.operand(splat, true)})`;
    }
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
    if (c instanceof ConstantTokenNone) return "none";
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
    // `writeAsOperandInternal`: a DIExpression is written inline (llir-di).
    if (md instanceof MDNode) return md.printsInline() ? md.writeSpecialized((m) => this.metadataOperand(m))! : `!${this.mdSlot(md)}`;
    if (md instanceof ValueAsMetadata) return this.operand(md.value, true);
    return unported(`llir: printing ${md.constructor.name}`);
  }

  // llvm: llvm/lib/IR/AsmWriter.cpp:1870 writeMDTuple
  mdTuple(n: MDNode): string {
    // `writeMDNodeBodyInternal`: a specialized node's `write<CLASS>` (llir-di's di_nodes.ts), else `writeMDTuple`.
    const body = n.writeSpecialized((m) => this.metadataOperand(m)) ?? `!{${n.ops.map((o) => this.metadataOperand(o)).join(", ")}}`;
    return `${n.distinct ? "distinct " : ""}${body}`;
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
    return this.attachments(g.metadata, sep, g.context);
  }

  // llvm: llvm/lib/IR/AsmWriter.cpp:4986 AssemblyWriter::printMetadataAttachments
  /** A value's attachments, `getAllMetadata`'s order: sorted by kind ID, stably (Metadata.cpp `Value::getAllMetadata`). */
  attachments(list: readonly (readonly [number, MDNode])[], sep: string, ctx: Context): string {
    if (list.length === 0) return "";
    const kinds = this.kindNames(ctx);
    return [...list].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${sep}!${this.mdName(kinds[k] ?? unported(`llir: metadata kind #${k} has no name`))} !${this.mdSlot(n)}`).join("");
  }
  private kindNamesCache: string[] | undefined;
  private kindNames(ctx: Context): string[] {
    if (this.kindNamesCache === undefined) {
      this.kindNamesCache = [];
      for (const [name, id] of ctx.mdKinds) this.kindNamesCache[id] = name;
    }
    return this.kindNamesCache;
  }

  // ---- attributes ----

  /** `AttributeSet::getAsString(InAttrGrp = false)`. */
  attributeSet(set: Map<string, Attribute> | undefined): string {
    return set === undefined ? "" : [...set.values()].map((a) => a.print(false)).join(" ");
  }
  /** `getAttributeGroupSlot`: the `#N` of a function or call-site attribute set. */
  attributeGroup(set: Map<string, Attribute>): number {
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
    // `Machine.incorporateFunction(F)` before the header: `processFunctionMetadata` numbers the function's attachments
    // (`getAllMetadata`'s order, by kind) before its body's (llir-di); unnamed arguments print as their slots.
    for (const [, n] of [...f.metadata].sort((a, b) => a[0] - b[0])) this.mdSlot(n);
    const prev = this.localOperand;
    if (!decl && functionSlots !== undefined) this.localOperand = functionSlots(f);
    try {
      return this.functionText(f, decl);
    } finally {
      this.localOperand = prev;
    }
  }
  private functionText(f: Function, decl: boolean): string {
    let o = decl ? `declare${this.mdAttachments(f, " ")} ` : "define ";
    o += getLinkageNameWithSpace(f.linkage) + printDSOLocation(f) + printVisibility(f) + printDLLStorageClass(f);
    // Print the calling convention.
    if (f.callingConv !== 0) o += `${printCallingConv(f.callingConv)} `;
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
    // `TypeFinder::incorporateAttributes` (TypeFinder.cpp:205): the types of type attributes (`byval(%T)`, `sret(%T)`,
    // `elementtype(%T)`), set by set in `AttributeList` order: function, return, then each parameter (review R2).
    const visitAttrs = (list: Map<number, Map<string, Attribute>>): void => {
      const order = [...list.keys()].sort((a, b) => attrListPos(a) - attrListPos(b));
      for (const i of order) for (const a of list.get(i)!.values()) if (a.type !== undefined) visitType(a.type);
    };
    for (const f of m.functions) {
      visitType(f.valueType);
      visitAttrs(f.attributes);
      // The arguments' types are the function type's; the body (inst.ts) adds what its instructions use.
      typeFinderHooks.body?.(f, visitType, visitValue, visitAttrs);
    }
    return out;
  }
}

/** `AttributeList`'s array position of an attribute index (`attrIdxToArrayIdx`): function 0, return 1, parameter i at i + 2. */
const attrListPos = (index: number): number => (index === FUNCTION_INDEX ? 0 : index + 1);

/** The type finder's hook for function bodies (inst.ts registers it). */
export const typeFinderHooks: {
  body?: (f: Function, visitType: (t: Type) => void, visitValue: (v: Value) => void, visitAttrs: (list: Map<number, Map<string, Attribute>>) => void) => void;
} = {};

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
