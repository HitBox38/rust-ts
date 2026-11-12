// rust-ts: the in-memory LLVM IR model (plan-m7 D5; lane llir-core-a). Not ported rustc code: new TS behind the contract of
// ffi.ts. Every rule copied from LLVM carries `// llvm: <path>:<line> <name>` (the LLVM sources of harness/llvm-manifest.json at
// the llvm-project commit the pin names); a rule that could not be sourced stops with `unported("llir: ...")`.
//
// What lives here: contexts, modules, types, constants, global variables, functions and arguments, aliases, comdats,
// metadata, attributes, and value names with LLVM's symbol-table rules. Instructions and basic blocks are llir-core-b's:
// `Function.blocks` holds them, and the `Instruction` hook below is the one place this file needs to know about them.
//
// Model conventions (docs/handoff/llir-core-a.md has the full list):
// - Names are **byte strings**: JS strings whose code units are bytes 0-255 (`bstr`), as LLVM's `StringRef`s. The facade
//   (core.ts) converts at the boundary: a JS `string` argument is its UTF-8 bytes, and a name handed back is decoded as UTF-8.
// - Types and constants are uniqued per context, as in LLVM, so `===` is LLVM's pointer equality.
// - Integer constant values are `bigint`, held as the unsigned bit pattern of the type's width (APInt's representation).
// - Floating-point constants hold their bit pattern (`bigint`), as `APFloat::bitcastToAPInt`; their arithmetic is apfloat.ts's
//   `APFloat` (lane llir-apfloat).
import { unported } from "../../std/panic.ts";
import { APFloat, type FltSemantics, opInvalidOp } from "./apfloat.ts";
import type { Linkage as FfiLinkage } from "./ffi_types.ts";

let NEXT_ID = 1;
const nextId = (): number => NEXT_ID++;

// ---- byte strings ------------------------------------------------------------------------------------------------------

/** UTF-8 bytes of a JS string, as a byte string. */
export function bstrOfString(s: string): string {
  return bstrOfBytes(new TextEncoder().encode(s));
}
export function bstrOfBytes(b: Uint8Array): string {
  let o = "";
  for (let i = 0; i < b.length; i += 8192) o += String.fromCharCode(...b.subarray(i, i + 8192));
  return o;
}
export function bytesOfBstr(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}
/** A byte string decoded as UTF-8 (what a Rust caller does with the bytes LLVM hands back). */
export function stringOfBstr(s: string): string {
  return new TextDecoder().decode(bytesOfBstr(s));
}

// ---- types -------------------------------------------------------------------------------------------------------------

/** LLVM's `Type::TypeID`s that the model has, named as ffi.rs's `TypeKind` (the C API's `LLVMTypeKind`). */
export type TypeID =
  | "Void"
  | "Half"
  | "BFloat"
  | "Float"
  | "Double"
  | "X86_FP80"
  | "FP128"
  | "PPC_FP128"
  | "Label"
  | "Metadata"
  | "Token"
  | "X86_AMX"
  | "Integer"
  | "Function"
  | "Pointer"
  | "Struct"
  | "Array"
  | "Vector"
  | "ScalableVector";

export class Type {
  readonly id = nextId();
  constructor(
    readonly context: Context,
    readonly typeID: TypeID,
  ) {}
  isIntegerTy(bits?: number): this is IntegerType {
    return this instanceof IntegerType && (bits === undefined || this.bits === bits);
  }
  isPointerTy(): this is PointerType {
    return this instanceof PointerType;
  }
  isFloatingPointTy(): boolean {
    return ["Half", "BFloat", "Float", "Double", "X86_FP80", "FP128", "PPC_FP128"].includes(this.typeID);
  }
  isVectorTy(): this is VectorType {
    return this instanceof VectorType;
  }
  isFunctionTy(): this is FunctionType {
    return this instanceof FunctionType;
  }
  isAggregateType(): boolean {
    return this instanceof StructType || this instanceof ArrayType;
  }
  /** `getScalarType`: the element type of a vector, else the type. */
  getScalarType(): Type {
    return this instanceof VectorType ? this.elementType : this;
  }
  // llvm: llvm/lib/IR/Type.cpp:106 Type::getFltSemantics
  getFltSemantics(): FltSemantics {
    switch (this.typeID) {
      case "Half":
        return "IEEEhalf";
      case "BFloat":
        return "BFloat";
      case "Float":
        return "IEEEsingle";
      case "Double":
        return "IEEEdouble";
      case "X86_FP80":
        return "x87DoubleExtended";
      case "FP128":
        return "IEEEquad";
      case "PPC_FP128":
        return "PPCDoubleDouble";
      default:
        throw new Error("llvm: Invalid floating type");
    }
  }
  /** `getPrimitiveSizeInBits` of the floating-point types (the only ones the model asks). */
  fpBits(): number {
    switch (this.typeID) {
      case "Half":
      case "BFloat":
        return 16;
      case "Float":
        return 32;
      case "Double":
        return 64;
      case "X86_FP80":
        return 80;
      case "FP128":
      case "PPC_FP128":
        return 128;
      default:
        throw new Error(`llir: ${this.typeID} is not a floating-point type`);
    }
  }
}

export class IntegerType extends Type {
  constructor(
    context: Context,
    readonly bits: number,
  ) {
    super(context, "Integer");
  }
  /** The unsigned bit mask of this width. */
  get mask(): bigint {
    return (1n << BigInt(this.bits)) - 1n;
  }
}

export class PointerType extends Type {
  constructor(
    context: Context,
    readonly addressSpace: number,
  ) {
    super(context, "Pointer");
  }
}

export class ArrayType extends Type {
  constructor(
    context: Context,
    readonly elementType: Type,
    /** `uint64_t` (review N7: `[(); usize::MAX]`). */
    readonly numElements: bigint,
  ) {
    super(context, "Array");
  }
}

export class VectorType extends Type {
  constructor(
    context: Context,
    readonly elementType: Type,
    readonly numElements: number,
    readonly scalable: boolean,
  ) {
    super(context, scalable ? "ScalableVector" : "Vector");
  }
}

export class FunctionType extends Type {
  constructor(
    context: Context,
    readonly returnType: Type,
    readonly params: readonly Type[],
    readonly isVarArg: boolean,
  ) {
    super(context, "Function");
  }
}

/** Literal (`{ i8, i32 }`, uniqued by content) and identified (`%T`, by identity) struct types. */
export class StructType extends Type {
  /** Undefined while an identified struct is opaque (no body). */
  body: readonly Type[] | undefined;
  /** `bstr`; empty for literal structs and for identified structs created without a name. */
  name = "";
  constructor(
    context: Context,
    readonly literal: boolean,
    public packed: boolean,
    body: readonly Type[] | undefined,
  ) {
    super(context, "Struct");
    this.body = body;
  }
  isOpaque(): boolean {
    return this.body === undefined;
  }

  // llvm: llvm/lib/IR/Type.cpp:632 StructType::setName
  setName(name: string): void {
    if (name === this.name) return;
    const table = this.context.namedStructTypes;
    // If this struct already had a name, remove its symbol table entry.
    if (this.name !== "") table.delete(this.name);
    // If this is just removing the name, we're done.
    if (name === "") {
      this.name = "";
      return;
    }
    // While we have a name collision, try a random rename.
    let unique = name;
    if (table.has(unique)) {
      do unique = `${name}.${this.context.namedStructTypesUniqueID++}`;
      while (table.has(unique));
    }
    table.set(unique, this);
    this.name = unique;
  }

  // llvm: llvm/lib/IR/Type.cpp:598 StructType::setBody
  setBody(elements: readonly Type[], packed: boolean): void {
    // PORT: setBody's `isValidElementType` checks are asserts (off in the oracle's build); the model trusts its caller too.
    this.packed = packed;
    this.body = [...elements];
  }
}

// ---- values ------------------------------------------------------------------------------------------------------------

export class Value {
  readonly id = nextId();
  /** `bstr`, empty when unnamed. */
  name = "";
  /** Users of this value, for `replaceAllUsesWith`. A user appears once however many of its operands are this value. */
  readonly users = new Set<User>();
  constructor(public type: Type) {}
  get context(): Context {
    return this.type.context;
  }
  hasName(): boolean {
    return this.name !== "";
  }

  // llvm: llvm/lib/IR/Value.cpp:394 Value::setName
  setName(newName: string): void {
    this.setNameImpl(newName);
    // PORT: `Function::updateAfterNameChange` recomputes the intrinsic ID from the new name; the model reads it from the name.
  }

  // llvm: llvm/lib/IR/Value.cpp:328 Value::setNameImpl
  setNameImpl(newName: string): void {
    const needNewName = !this.context.discardValueNames || this instanceof GlobalValue;
    // Fast-path: LLVMContext can be set to strip out non-GlobalValue names and there is no need to delete the old name.
    if (!needNewName && !this.hasName()) return;
    // Fast path for common IRBuilder case of setName("") when there is no name.
    if (newName === "" && !this.hasName()) return;
    const nameRef = needNewName ? newName : "";
    // Name isn't changing?
    if (this.name === nameRef) return;
    // Get the symbol table to update for this object.
    const st = getSymTab(this);
    if (st === false) return; // Cannot set a name on this value (e.g. constant).
    if (st === undefined) {
      // No symbol table to update?  Just do the change.
      this.name = nameRef;
      return;
    }
    let newValueName: string | undefined;
    if (nameRef !== "") newValueName = st.createValueName(nameRef, this);
    if (this.hasName()) {
      // Remove old name.
      st.removeValueName(this.name);
      this.name = "";
      if (nameRef === "") return;
    }
    this.name = newValueName!;
  }

  // llvm: llvm/lib/IR/Value.cpp:553 Value::replaceAllUsesWith
  replaceAllUsesWith(newV: Value): void {
    // PORT: `doRAUW` with `ReplaceMetadataUses::Yes`: metadata uses (ValueAsMetadata) are replaced too.
    this.doRAUW(newV);
  }

  // llvm: llvm/lib/IR/Value.cpp:518 Value::doRAUW
  doRAUW(newV: Value): void {
    if (newV === this) throw new Error("llvm: this->replaceAllUsesWith(this) is NOT valid!");
    const vam = this.context.valueAsMetadata.get(this);
    if (vam !== undefined) vam.handleRAUW(newV);
    for (const u of [...this.users]) {
      // Must handle Constants specially, we cannot call replaceUsesOfWith on a constant because they are uniqued.
      if (u instanceof Constant && !(u instanceof GlobalValue)) u.handleOperandChange(this, newV);
      else u.replaceUsesOfWith(this, newV);
    }
    // PORT: `BasicBlock` users (phi incoming blocks) are llir-core-b's; a block's RAUW goes through its own class.
  }

  // llvm: llvm/lib/IR/Value.cpp:713 Value::stripPointerCasts
  stripPointerCasts(): Value {
    // `stripPointerCastsAndOffsets<PSK_ZeroIndices>` (Value.cpp:641).
    if (!this.type.isPointerTy()) return this;
    const visited = new Set<Value>([this]);
    let v: Value = this;
    do {
      if (v instanceof ConstantExpr && v.opcode === "GetElementPtr") {
        if (!v.operands.slice(1).every((i) => (i as Constant).isNullValue())) return v;
        v = v.operands[0]!;
      } else if (v instanceof ConstantExpr && v.opcode === "BitCast") {
        const nv = v.operands[0]!;
        if (!nv.type.isPointerTy()) return v;
        v = nv;
      } else if (v instanceof ConstantExpr && v.opcode === "AddrSpaceCast") {
        v = v.operands[0]!;
      } else if (v instanceof Instruction) {
        // GEP with all-zero indices, bitcast of a pointer, addrspacecast, a call's `returned` argument (inst.ts).
        const next = v.stripPointerCastStep();
        if (next === undefined) return v;
        v = next;
      } else {
        return v;
      }
    } while (!visited.has(v) && visited.add(v));
    return v;
  }
}

// llvm: llvm/lib/IR/Value.cpp:269 getSymTab
/** The symbol table a value's name lives in: `false` if it cannot have a name, `undefined` if it has no table yet. */
function getSymTab(v: Value): ValueSymbolTable | undefined | false {
  if (v instanceof Instruction) return v.parentFunction()?.symTab;
  if (v instanceof BasicBlockBase) return v.parent?.symTab;
  if (v instanceof GlobalValue) return v.parent?.symTab;
  if (v instanceof Argument) return v.parent.symTab;
  return false; // no name is setable for this.
}

/** A value with operands. */
export class User extends Value {
  readonly operands: Value[] = [];
  constructor(type: Type, operands: readonly Value[]) {
    super(type);
    for (const op of operands) this.pushOperand(op);
  }
  protected pushOperand(v: Value): void {
    this.operands.push(v);
    v.users.add(this);
  }
  setOperand(i: number, v: Value): void {
    const old = this.operands[i]!;
    this.operands[i] = v;
    if (!this.operands.includes(old)) old.users.delete(this);
    v.users.add(this);
  }
  /** Drops every operand (a deleted value no longer uses anything). */
  dropAllReferences(): void {
    for (const op of this.operands) op.users.delete(this);
    this.operands.length = 0;
  }
  replaceUsesOfWith(from: Value, to: Value): void {
    for (let i = 0; i < this.operands.length; i++) if (this.operands[i] === from) this.setOperand(i, to);
  }
}

/** llir-core-b's instructions (inst.ts) extend this; `getSymTab` needs to know an instruction's function. */
export abstract class Instruction extends User {
  abstract parentFunction(): Function | undefined;
  /** One step of `stripPointerCastsAndOffsets<PSK_ZeroIndices>` through this instruction: the value it strips to, or
   * undefined where the walk stops. */
  abstract stripPointerCastStep(): Value | undefined;
}

/** llir-core-b's basic blocks extend this. */
export abstract class BasicBlockBase extends Value {
  abstract get parent(): Function | undefined;
}

export class Argument extends Value {
  constructor(
    type: Type,
    readonly parent: Function,
    readonly argNo: number,
  ) {
    super(type);
  }
}

// ---- symbol tables -----------------------------------------------------------------------------------------------------

export class ValueSymbolTable {
  readonly vmap = new Map<string, Value>();
  /** The one counter of collision suffixes, shared by every name in the table and never reset. */
  lastUnique = 0;
  /** -1: no limit (a module's table); a function's table is `NonGlobalValueMaxNameSize`. */
  constructor(readonly maxNameSize: number) {}

  // llvm: llvm/lib/IR/ValueSymbolTable.cpp:42 ValueSymbolTable::makeUniqueName
  makeUniqueName(v: Value, uniqueName: string): string {
    let baseSize = uniqueName.length;
    // A dot is appended to mark it as clone during ABI demangling (not on NVPTX).
    let appendDot = false;
    if (v instanceof GlobalValue) {
      const m = v.parent;
      if (!(m && m.isNVPTX())) appendDot = true;
    }
    for (;;) {
      // Trim any suffix off and append the next number.
      let s = uniqueName.slice(0, baseSize);
      if (appendDot) s += ".";
      s += String(++this.lastUnique);
      // Retry if MaxNameSize has been exceeded.
      if (this.maxNameSize > -1 && s.length > this.maxNameSize) {
        baseSize -= s.length - this.maxNameSize;
        continue;
      }
      // Try insert the vmap entry with this suffix.
      if (!this.vmap.has(s)) {
        this.vmap.set(s, v);
        return s;
      }
    }
  }

  // llvm: llvm/lib/IR/ValueSymbolTable.cpp:82 ValueSymbolTable::reinsertValue
  reinsertValue(v: Value): void {
    // Try inserting the name, assuming it won't conflict.
    if (!this.vmap.has(v.name)) {
      this.vmap.set(v.name, v);
      return;
    }
    // Otherwise, there is a naming conflict.  Rename this value.
    v.name = this.makeUniqueName(v, v.name);
  }

  // llvm: llvm/lib/IR/ValueSymbolTable.cpp:103 ValueSymbolTable::removeValueName
  removeValueName(name: string): void {
    this.vmap.delete(name);
  }

  // llvm: llvm/lib/IR/ValueSymbolTable.cpp:112 ValueSymbolTable::createValueName
  createValueName(name: string, v: Value): string {
    if (this.maxNameSize > -1 && name.length > this.maxNameSize) name = name.slice(0, Math.max(1, this.maxNameSize));
    // In the common case, the name is not already in the symbol table.
    if (!this.vmap.has(name)) {
      this.vmap.set(name, v);
      return name;
    }
    // Otherwise, there is a naming conflict.  Rename this value.
    return this.makeUniqueName(v, name);
  }

  lookup(name: string): Value | undefined {
    return this.vmap.get(name);
  }
}

/** `NonGlobalValueMaxNameSize`'s default (Function.cpp:64, `-non-global-value-max-name-size`, `cl::init(1024)`). */
export const NON_GLOBAL_VALUE_MAX_NAME_SIZE = 1024;

// ---- constants ---------------------------------------------------------------------------------------------------------

export abstract class Constant extends User {
  /** Set by `destroyConstant`. */
  destroyed = false;
  /** `Constant::isNullValue`: the `IsNullValue` flag, set when a zero constant is made (Constant.h:64). The model's vector
   * constants that hold data (ConstantDataSequential, ConstantVector) are never all zero: their getters collapse those to
   * ConstantAggregateZero, as LLVM's do, so only the subclasses that can be zero override this. */
  isNullValue(): boolean {
    return false;
  }

  // llvm: llvm/lib/IR/Constants.cpp:68 Constant::isAllOnesValue
  /** The scalar arms are the ConstantInt / ConstantFP overrides; this is the rest: a constant splat vector of all-ones values
   * (review llir-core-b F2). */
  isAllOnesValue(): boolean {
    // Check for constant splat vectors of 1 values.
    if (this.type.isVectorTy()) {
      const splatVal = getSplatValue(this);
      if (splatVal !== undefined) return splatVal.isAllOnesValue();
    }
    return false;
  }
  /** The key this constant is uniqued under in its context's table, or undefined if it is not uniqued that way. */
  uniqueKey(): string | undefined {
    return undefined;
  }
  /** A copy with operand `from` replaced by `to`, built through the uniquing getters (`handleOperandChangeImpl`). */
  protected rebuiltWith(_from: Value, _to: Value): Constant {
    return unported(`llir: handleOperandChange on a ${this.constructor.name}`);
  }

  // llvm: llvm/lib/IR/Constants.cpp:3524 Constant::handleOperandChange
  handleOperandChange(from: Value, to: Value): void {
    // PORT: LLVM updates the constant in place when the replacement is not already uniqued
    // (`ConstantUniqueMap::replaceOperandsInPlace`), keeping its identity; otherwise it RAUWs it to the existing one and
    // destroys it. The model does the same: `rebuiltWith` computes the replacement's key without interning it.
    const replacement = this.rebuiltWith(from, to);
    if (replacement !== this) {
      this.replaceAllUsesWith(replacement);
      this.destroyConstant();
    }
  }

  /** `Constant::destroyConstant`: drops it from its uniquing table and its operands' users. */
  destroyConstant(): void {
    // LLVM frees it, and its address may be reused (replay.ts rebinds a handle whose object was destroyed; review R6).
    this.destroyed = true;
    const k = this.uniqueKey();
    if (k !== undefined && this.context.constants.get(k) === this) this.context.constants.delete(k);
    this.dropAllReferences();
  }
}

export class ConstantInt extends Constant {
  constructor(
    type: IntegerType,
    /** Unsigned bit pattern, masked to the width. */
    readonly value: bigint,
  ) {
    super(type, []);
  }
  get intType(): IntegerType {
    return this.type as IntegerType;
  }
  override isNullValue(): boolean {
    return this.value === 0n;
  }
  override isAllOnesValue(): boolean {
    return this.value === this.intType.mask;
  }
  /** The value as signed. */
  get sextValue(): bigint {
    const bits = BigInt(this.intType.bits);
    return this.value >> (bits - 1n) ? this.value - (1n << bits) : this.value;
  }
}

/** `ConstantFP`: a floating-point scalar, or (since LLVM made FP splats native) a vector of one value in every lane, whose type
 * is the vector type (`ConstantFP::get(LLVMContext&, ElementCount, const APFloat&)`, Constants.cpp:1189). */
export class ConstantFP extends Constant {
  constructor(
    type: Type,
    /** The bit pattern of the (element) value (`APFloat::bitcastToAPInt`), in the scalar type's semantics. */
    readonly bits: bigint,
  ) {
    super(type, []);
  }
  /** `getValueAPF` / `getValue`: the element's APFloat. */
  getValueAPF(): APFloat {
    return APFloat.fromAPInt(this.type.getScalarType().getFltSemantics(), this.bits);
  }
  override isNullValue(): boolean {
    // The `IsNullValue` bit of a ConstantFP is set when its bit pattern is all zeros (Constants.cpp:1207: "ppc_fp128 determine
    // isZero using high order double only so check the bitwise value"), vector or not.
    return this.bits === 0n;
  }
  override isAllOnesValue(): boolean {
    // `Constant::isAllOnesValue`: "FP which are bitcasted from -1 integers" (the element's bits, for a vector too).
    return this.bits === (1n << BigInt(this.type.getScalarType().fpBits())) - 1n;
  }
}

export class ConstantPointerNull extends Constant {
  override isNullValue(): boolean {
    return true;
  }
}

export class ConstantAggregateZero extends Constant {
  override isNullValue(): boolean {
    return true;
  }
}

export class UndefValue extends Constant {}
/** `ConstantTokenNone`: the `none` token, a funclet pad's parent at the top level. */
export class ConstantTokenNone extends Constant {
  override isNullValue(): boolean {
    return true;
  }
}
export class PoisonValue extends UndefValue {}

/** `ConstantArray`, `ConstantStruct`, `ConstantVector`: elements are operands. */
export abstract class ConstantAggregate extends Constant {
  override uniqueKey(): string {
    return aggregateKey(this.constructor.name, this.type, this.operands);
  }
  protected override rebuiltWith(from: Value, to: Value): Constant {
    const ops = this.operands.map((o) => (o === from ? to : o)) as Constant[];
    // `replaceUsesOfWithOnConstant`: the aggregate getters may collapse (all zero, all undef) or find an existing constant.
    const k = aggregateKey(this.constructor.name, this.type, ops);
    const existing = this.context.constants.get(k);
    if (existing !== undefined) return existing;
    if (this instanceof ConstantArray) {
      const c = getConstantArray(this.type as ArrayType, ops, false);
      if (c !== undefined) return c;
    }
    if (this instanceof ConstantStruct) {
      const c = getConstantStruct(this.type as StructType, ops, false);
      if (c !== undefined) return c;
    }
    // In place: re-key this constant.
    this.context.constants.delete(this.uniqueKey());
    this.replaceUsesOfWith(from, to);
    this.context.constants.set(this.uniqueKey(), this);
    return this;
  }
}
export class ConstantArray extends ConstantAggregate {}
export class ConstantStruct extends ConstantAggregate {}
export class ConstantVector extends ConstantAggregate {}

/** `ConstantDataArray` / `ConstantDataVector`: a sequence of plain integers or floats, not operands. */
export class ConstantDataSequential extends Constant {
  constructor(
    type: ArrayType | VectorType,
    /** The elements, as `ConstantInt`s or `ConstantFP`s of the element type. */
    readonly elements: readonly (ConstantInt | ConstantFP)[],
  ) {
    super(type, []);
  }
  /** `ConstantDataSequential::isString`: an array of i8. */
  isString(): boolean {
    return this.type instanceof ArrayType && this.type.elementType.isIntegerTy(8);
  }
}

/** Opcode names as ffi.rs's `Opcode` (the C API's `LLVMOpcode`). */
export type ExprOpcode = "GetElementPtr" | "Trunc" | "PtrToInt" | "IntToPtr" | "BitCast" | "AddrSpaceCast" | "Add" | "Sub" | "Mul" | "Xor" | "ExtractElement" | "InsertElement" | "ShuffleVector";

export class ConstantExpr extends Constant {
  constructor(
    type: Type,
    readonly opcode: ExprOpcode,
    operands: readonly Constant[],
    /** GEP: `GEPNoWrapFlags` raw bits (InBounds 1, NUSW 2, NUW 4); binary operators: nuw 1, nsw 2 (`OverflowingBinaryOperator`). */
    readonly flags: number,
    /** GEP: the source element type. */
    readonly srcElementType: Type | undefined,
  ) {
    super(type, operands);
  }
  isCast(): boolean {
    return this.opcode === "Trunc" || this.opcode === "PtrToInt" || this.opcode === "IntToPtr" || this.opcode === "BitCast" || this.opcode === "AddrSpaceCast";
  }
  override uniqueKey(): string {
    return exprKey(this.type, this.opcode, this.operands, this.flags, this.srcElementType);
  }
  protected override rebuiltWith(from: Value, to: Value): Constant {
    const ops = this.operands.map((o) => (o === from ? to : o)) as Constant[];
    // `ConstantExpr::handleOperandChangeImpl` -> `getWithOperands(NewOps, getType(), OnlyIfReduced=true)`: a fold wins.
    let folded: Constant | undefined;
    if (this.isCast()) folded = constantFoldCastInstruction(this.opcode as CastOpcode, ops[0]!, this.type);
    else if (this.opcode === "GetElementPtr") folded = constantFoldGetElementPtr(this.srcElementType!, ops[0]!, ops.slice(1));
    else return unported(`llir: handleOperandChange on a ${this.opcode} constant expression`);
    if (folded !== undefined) return folded;
    const k = exprKey(this.type, this.opcode, ops, this.flags, this.srcElementType);
    const existing = this.context.constants.get(k);
    if (existing !== undefined) return existing;
    this.context.constants.delete(this.uniqueKey());
    this.replaceUsesOfWith(from, to);
    this.context.constants.set(this.uniqueKey(), this);
    return this;
  }
}

const aggregateKey = (kind: string, type: Type, ops: readonly Value[]): string => `${kind}:${type.id}:${ops.map((o) => o.id).join(",")}`;
const exprKey = (type: Type, opcode: string, ops: readonly Value[], flags: number, src: Type | undefined): string =>
  `CE:${opcode}:${type.id}:${flags}:${src?.id ?? ""}:${ops.map((o) => o.id).join(",")}`;

/** A constant expression, uniqued by its key (`ExprConstants.getOrCreate`), for the folders outside this file (fold.ts). */
export function internExpr(type: Type, opcode: ExprOpcode, ops: readonly Constant[], flags: number, src: Type | undefined): ConstantExpr {
  return intern(type.context, exprKey(type, opcode, ops, flags, src), () => new ConstantExpr(type, opcode, ops, flags, src));
}

function intern<T extends Constant>(ctx: Context, key: string, make: () => T): T {
  let c = ctx.constants.get(key);
  if (c === undefined) {
    c = make();
    ctx.constants.set(key, c);
  }
  return c as T;
}

// llvm: llvm/lib/IR/Constants.cpp:988 ConstantInt::get
/** `ConstantInt::get(IntegerType*, uint64_t V, bool IsSigned)` with the oracle's release-build APInt: truncated to the width,
 * and sign-extended past 64 bits when `isSigned`. `v` is the `uint64_t` (0 <= v < 2^64). */
export function getConstantIntU64(ty: IntegerType, v: bigint, isSigned: boolean): ConstantInt {
  // APInt(numBits, val, isSigned): a width above 64 sign-extends a signed value; `clearUnusedBits` truncates.
  let x = v;
  if (isSigned && ty.bits > 64 && v >> 63n) x = v | (((1n << BigInt(ty.bits)) - 1n) ^ ((1n << 64n) - 1n));
  return getConstantInt(ty, x);
}

/** `ConstantInt::get(LLVMContext&, const APInt&)`: the uniqued integer constant of this exact bit pattern. */
export function getConstantInt(ty: IntegerType, value: bigint): ConstantInt {
  const v = value & ty.mask;
  return intern(ty.context, `CI:${ty.id}:${v}`, () => new ConstantInt(ty, v));
}

// llvm: llvm/lib/IR/Type.cpp:125 Type::getFloatingPointTy
export function getFloatingPointTy(ctx: Context, sem: FltSemantics): Type {
  switch (sem) {
    case "IEEEhalf":
      return ctx.getFloatingType("Half");
    case "BFloat":
      return ctx.getFloatingType("BFloat");
    case "IEEEsingle":
      return ctx.getFloatingType("Float");
    case "IEEEdouble":
      return ctx.getFloatingType("Double");
    case "IEEEquad":
      return ctx.getFloatingType("FP128");
    case "PPCDoubleDouble":
      return ctx.getFloatingType("PPC_FP128");
    case "x87DoubleExtended":
      return ctx.getFloatingType("X86_FP80");
  }
}

// llvm: llvm/lib/IR/Constants.cpp:1174 ConstantFP::get
/** `ConstantFP::get(LLVMContext&, const APFloat&)`: the uniqued scalar of the APFloat's semantics. LLVM's `FPConstants` map
 * compares keys with `bitwiseIsEqual`, which is equality of `bitcastToAPInt`, so the key is the value's bits. */
export function getConstantFPOfAPFloat(ctx: Context, v: APFloat): ConstantFP {
  const ty = getFloatingPointTy(ctx, v.semantics);
  const bits = v.bitcastToAPInt();
  return intern(ctx, `CFP:${ty.id}:${bits}`, () => new ConstantFP(ty, bits));
}

// llvm: llvm/lib/IR/Constants.cpp:1188 ConstantFP::get
/** `ConstantFP::get(LLVMContext&, ElementCount, const APFloat&)`: a vector with each lane set to the same APFloat
 * (`FPSplatConstants`, keyed by the element count and the value). */
export function getConstantFPSplat(ctx: Context, n: number, scalable: boolean, v: APFloat): ConstantFP {
  const eltTy = getFloatingPointTy(ctx, v.semantics);
  const vty = ctx.getVectorType(eltTy, n, scalable);
  const bits = v.bitcastToAPInt();
  return intern(ctx, `CFP:${vty.id}:${bits}`, () => new ConstantFP(vty, bits));
}

// llvm: llvm/lib/IR/Constants.cpp:1122 ConstantFP::get
/** `ConstantFP::get(Type*, const APFloat&)`: a splat for a vector type. */
export function getConstantFPOfType(ty: Type, v: APFloat): ConstantFP {
  if (ty instanceof VectorType) return getConstantFPSplat(ty.context, ty.numElements, ty.scalable, v);
  return getConstantFPOfAPFloat(ty.context, v);
}

/** `ConstantFP::get(Ty, APFloat(Ty->getScalarType()->getFltSemantics(), Bits))`: the constant of a bit pattern of the (element)
 * type, read as `APFloat(const fltSemantics&, const APInt&)` does (x86_fp80's non-canonical encodings are canonicalised). */
export function getConstantFP(ty: Type, bits: bigint): ConstantFP {
  return getConstantFPOfType(ty, APFloat.fromAPInt(ty.getScalarType().getFltSemantics(), bits));
}

// llvm: llvm/lib/IR/Constants.cpp:1108 ConstantFP::get
/** `ConstantFP::get(Type*, double V)`: `V` converted to the type's semantics (round to nearest, ties to even). */
export function getConstantFPOfDouble(ty: Type, v: number): Constant {
  const fv = APFloat.fromDouble(v).convert(ty.getScalarType().getFltSemantics(), "rmNearestTiesToEven").value;
  if (ty instanceof VectorType) return getConstantFPSplat(ty.context, ty.numElements, ty.scalable, fv);
  return getConstantFPOfAPFloat(ty.context, fv);
}

export function getConstantPointerNull(ty: Type): ConstantPointerNull {
  return intern(ty.context, `CPN:${ty.id}`, () => new ConstantPointerNull(ty, []));
}
export function getConstantAggregateZero(ty: Type): ConstantAggregateZero {
  return intern(ty.context, `CAZ:${ty.id}`, () => new ConstantAggregateZero(ty, []));
}
export function getUndef(ty: Type): UndefValue {
  return intern(ty.context, `UNDEF:${ty.id}`, () => new UndefValue(ty, []));
}
export function getPoison(ty: Type): PoisonValue {
  return intern(ty.context, `POISON:${ty.id}`, () => new PoisonValue(ty, []));
}

// llvm: llvm/lib/IR/Constants.cpp:367 Constant::getNullValue
export function getNullValue(ty: Type): Constant {
  switch (ty.typeID) {
    case "Integer":
      return getConstantInt(ty as IntegerType, 0n);
    case "Half":
    case "BFloat":
    case "Float":
    case "Double":
    case "X86_FP80":
    case "FP128":
    case "PPC_FP128":
      return getConstantFPOfAPFloat(ty.context, APFloat.getZero(ty.getFltSemantics()));
    case "Pointer":
      return getConstantPointerNull(ty);
    case "Vector":
    case "ScalableVector": {
      const elt = (ty as VectorType).elementType;
      if (elt.isFloatingPointTy()) return getConstantFPOfType(ty, APFloat.getZero(elt.getFltSemantics()));
      if (elt.isPointerTy()) return unported("llir: getNullValue of a vector of pointers (a splat ConstantPointerNull)");
      return getConstantAggregateZero(ty);
    }
    case "Struct":
    case "Array":
      return getConstantAggregateZero(ty);
    case "Token":
      // `ConstantTokenNone::get(Ty->getContext())` (Constants.cpp:1659): one per context.
      return intern(ty.context, "TOKENNONE", () => new ConstantTokenNone(ty, []));
    default:
      throw new Error(`llvm: Cannot create a null constant of that type! (${ty.typeID})`);
  }
}

/** `ConstantDataSequential::isElementTypeCompatible` (no byte types in the model). */
function isElementTypeCompatible(t: Type): boolean {
  if (t.typeID === "Half" || t.typeID === "BFloat" || t.typeID === "Float" || t.typeID === "Double") return true;
  if (t instanceof IntegerType) return t.bits === 8 || t.bits === 16 || t.bits === 32 || t.bits === 64;
  return false;
}

// llvm: llvm/lib/IR/Constants.cpp:1438 ConstantArray::getImpl
/** `ConstantArray::get`: the collapsed form (zero, undef, poison, data array), or a `ConstantArray`. With `create` false,
 * returns undefined where `getImpl` would (no collapse), so `handleOperandChange` can re-key in place. */
export function getConstantArray(ty: ArrayType, v: readonly Constant[], create = true): Constant | undefined {
  // Empty arrays are canonicalized to ConstantAggregateZero.
  if (v.length === 0) return getConstantAggregateZero(ty);
  const c = v[0]!;
  const only = v.every((x) => x === c);
  if (c instanceof PoisonValue && only) return getPoison(ty);
  if (c instanceof UndefValue && only) return getUndef(ty);
  if (c.isNullValue() && only) return getConstantAggregateZero(ty);
  // Check to see if all of the elements are ConstantFP or ConstantInt and if the element type is compatible.
  if (isElementTypeCompatible(c.type)) {
    // `getSequenceIfElementsMatch`: all ConstantInt (integer element type) or all ConstantFP.
    if (c instanceof ConstantInt && v.every((x) => x instanceof ConstantInt)) return getConstantDataSequential(ty, v as ConstantInt[]);
    if (c instanceof ConstantFP && v.every((x) => x instanceof ConstantFP)) return getConstantDataSequential(ty, v as ConstantFP[]);
  }
  if (!create) return undefined;
  return intern(ty.context, aggregateKey("ConstantArray", ty, v), () => new ConstantArray(ty, v));
}

/** `ConstantDataArray::get` / `ConstantDataVector::get`, which collapse to `ConstantAggregateZero` when all zero. */
export function getConstantDataSequential(ty: ArrayType | VectorType, elems: readonly (ConstantInt | ConstantFP)[]): Constant {
  // `ConstantDataSequential::getImpl`: "If the elements are all zero or there are no elements, return a CAZ".
  if (elems.every((e) => e.isNullValue())) return getConstantAggregateZero(ty);
  return intern(ty.context, `CDS:${ty.id}:${elems.map((e) => e.id).join(",")}`, () => new ConstantDataSequential(ty, elems));
}

// llvm: llvm/lib/IR/Constants.cpp:1549 ConstantVector::getImpl
/** `ConstantVector::get`: an all-zero, all-poison or all-undef vector collapses, an FP splat is a vector-typed ConstantFP, and
 * plain integers or floats of a compatible element type are a data vector. A `ConstantVector` of other elements, and a splat
 * of pointer nulls (a vector-typed ConstantPointerNull), are not made by the model: they stop. */
export function getConstantVector(v: readonly Constant[]): Constant {
  if (v.length === 0) throw new Error("llvm: Vectors can't be empty");
  const t = v[0]!.context.getVectorType(v[0]!.type, v.length, false);
  // If this is an all-undef or all-zero vector, return a ConstantAggregateZero or UndefValue.
  const c = v[0]!;
  let isZero = c.isNullValue();
  let isUndef = c instanceof UndefValue;
  let isPoison = c instanceof PoisonValue;
  let isSplatFP = c instanceof ConstantFP;
  let isSplatPtrNull = c instanceof ConstantPointerNull;
  // (`UseConstantIntForFixedLengthSplat` is off by default; the model has no byte types.)
  if (isZero || isUndef || isSplatFP || isSplatPtrNull) {
    for (let i = 1; i !== v.length; ++i) {
      if (v[i] !== c) {
        isZero = isUndef = isPoison = isSplatFP = isSplatPtrNull = false;
        break;
      }
    }
  }
  if (isSplatPtrNull) return unported("llir: a pointer-null vector splat (a vector-typed ConstantPointerNull)");
  if (isZero) return getConstantAggregateZero(t);
  if (isPoison) return getPoison(t);
  if (isUndef) return getUndef(t);
  if (isSplatFP) return getConstantFPSplat(c.context, v.length, false, (c as ConstantFP).getValueAPF());
  // Check to see if all of the elements are ConstantFP or ConstantInt and if the element type is compatible with
  // ConstantDataVector. If so, use it.
  if (isElementTypeCompatible(c.type)) {
    // `getSequenceIfElementsMatch`: all ConstantInt (integer element type) or all ConstantFP.
    if (c instanceof ConstantInt && v.every((x) => x instanceof ConstantInt)) return getConstantDataSequential(t, v as ConstantInt[]);
    if (c instanceof ConstantFP && v.every((x) => x instanceof ConstantFP)) return getConstantDataSequential(t, v as ConstantFP[]);
  }
  // Otherwise, the element type isn't compatible with ConstantDataVector, or the operand list contains a ConstantExpr or
  // something else strange: `VectorConstants.getOrCreate`.
  return unported("llir: ConstantVector::get of other elements (a ConstantVector)");
}

// llvm: llvm/lib/IR/Constants.cpp:1499 ConstantStruct::get
export function getConstantStruct(ty: StructType, v: readonly Constant[], create = true): Constant | undefined {
  // Create a ConstantAggregateZero value if all elements are zeros.
  let isZero = true;
  let isUndef = false;
  let isPoison = false;
  if (v.length !== 0) {
    isUndef = v[0] instanceof UndefValue;
    isPoison = v[0] instanceof PoisonValue;
    isZero = v[0]!.isNullValue();
    // PoisonValue inherits UndefValue, so its check is not necessary.
    if (isUndef || isZero) {
      for (const c of v) {
        if (!c.isNullValue()) isZero = false;
        if (!(c instanceof PoisonValue)) isPoison = false;
        if (c instanceof PoisonValue || !(c instanceof UndefValue)) isUndef = false;
      }
    }
  }
  if (isZero) return getConstantAggregateZero(ty);
  if (isPoison) return getPoison(ty);
  if (isUndef) return getUndef(ty);
  if (!create) return undefined;
  return intern(ty.context, aggregateKey("ConstantStruct", ty, v), () => new ConstantStruct(ty, v));
}

// llvm: llvm/lib/IR/Constants.cpp:446 Constant::getAggregateElement
export function getAggregateElement(c: Constant, elt: number): Constant | undefined {
  if (c instanceof ConstantAggregate) return elt < c.operands.length ? (c.operands[elt] as Constant) : undefined;
  if (c instanceof ConstantAggregateZero) {
    const n = elementCount(c.type);
    return elt < n ? getNullValue(elementTypeAt(c.type, elt)) : undefined;
  }
  // A vector-typed ConstantFP: `getKnownMinValue` of its element count, scalable or not.
  if (c instanceof ConstantFP) return elt < (c.type as VectorType).numElements ? getConstantFPOfAPFloat(c.context, c.getValueAPF()) : undefined;
  if (c.type instanceof VectorType && c.type.scalable) return undefined;
  if (c instanceof PoisonValue) return elt < elementCount(c.type) ? getPoison(elementTypeAt(c.type, elt)) : undefined;
  if (c instanceof UndefValue) return elt < elementCount(c.type) ? getUndef(elementTypeAt(c.type, elt)) : undefined;
  if (c instanceof ConstantDataSequential) return elt < c.elements.length ? c.elements[elt] : undefined;
  return undefined;
}

/** Elements of an aggregate or vector type (`getNumElements` / `getStructNumElements`). */
function elementCount(t: Type): number {
  if (t instanceof ArrayType) return t.numElements > BigInt(Number.MAX_SAFE_INTEGER) ? unported("llir: an aggregate element count beyond 2^53") : Number(t.numElements);
  if (t instanceof VectorType) return t.numElements;
  if (t instanceof StructType) return t.body?.length ?? 0;
  return 0;
}
function elementTypeAt(t: Type, i: number): Type {
  if (t instanceof ArrayType || t instanceof VectorType) return t.elementType;
  if (t instanceof StructType) return t.body![i]!;
  throw new Error("llir: not an aggregate type");
}

// ---- constant expressions and their folds ------------------------------------------------------------------------------

export type CastOpcode = "Trunc" | "PtrToInt" | "IntToPtr" | "BitCast" | "AddrSpaceCast" | "ZExt" | "SExt" | "FPTrunc" | "FPExt" | "UIToFP" | "SIToFP" | "FPToUI" | "FPToSI";

// llvm: llvm/lib/IR/Constants.cpp:1846 Constant::getSplatValue
/** `getSplatValue(AllowPoison = false)` of a vector constant: the one element, or undefined. */
export function getSplatValue(c: Constant): Constant | undefined {
  if (!(c.type instanceof VectorType)) throw new Error("llvm: Only valid for vectors!");
  if (c instanceof PoisonValue) return getPoison(c.type.elementType);
  if (c instanceof ConstantAggregateZero) return getNullValue(c.type.elementType);
  // (Vector-typed ConstantInt / ConstantPointerNull splats are not made by the model.)
  if (c instanceof ConstantFP) return getConstantFPOfAPFloat(c.context, c.getValueAPF());
  if (c instanceof ConstantDataSequential) return constantDataVectorSplatValue(c);
  if (c instanceof ConstantVector) return constantVectorSplatValue(c);
  // A `shufflevector (insertelement undef, X, 0), undef, zeroinitializer` constant expression is not made by the model.
  return undefined;
}

// llvm: llvm/lib/IR/Constants.cpp:1887 ConstantVector::getSplatValue
function constantVectorSplatValue(c: ConstantVector): Constant | undefined {
  // Check out first element; then make sure all remaining elements point to the same value (strict mode).
  const elt = c.operands[0] as Constant;
  for (let i = 1; i < c.operands.length; i++) if (c.operands[i] !== elt) return undefined;
  return elt;
}

// llvm: llvm/lib/IR/Constants.cpp:3505 ConstantDataVector::getSplatValue
function constantDataVectorSplatValue(c: ConstantDataSequential): Constant | undefined {
  // If they're all the same, return the 0th one as a representative (`isSplatData` compares the raw element bytes; the
  // elements are uniqued constants of one type, so equal bytes are the same object).
  const e0 = c.elements[0]!;
  return c.elements.every((e) => e === e0) ? e0 : undefined;
}

// llvm: llvm/lib/IR/Constants.cpp:427 Constant::getAllOnesValue
export function getAllOnesValue(ty: Type): Constant {
  if (ty instanceof IntegerType) return getConstantInt(ty, ty.mask);
  // `APFloat::getAllOnesValue`: every bit of the format set.
  if (ty.isFloatingPointTy()) return getConstantFPOfAPFloat(ty.context, APFloat.getAllOnesValue(ty.getFltSemantics()));
  if (!(ty instanceof VectorType)) throw new Error(`llvm: cast<VectorType> of ${ty.typeID} (Constant::getAllOnesValue)`);
  return getSplat(ty.numElements, ty.scalable, getAllOnesValue(ty.elementType));
}

// llvm: llvm/lib/IR/Constants.cpp:1602 ConstantVector::getSplat
/** `ConstantVector::getSplat(EC, V)`: a vector-typed ConstantFP, a fixed-length splat of an integer the data vectors take
 * (`ConstantDataVector::getSplat`, Constants.cpp:3304), or `ConstantVector::get` of the copies (which collapses zero, undef
 * and poison). Pointer-null splats (a vector-typed ConstantPointerNull), scalable splats of other values, and the
 * ConstantVectors `get` would make, stop. */
export function getSplat(n: number, scalable: boolean, v: Constant): Constant {
  if (v instanceof ConstantPointerNull) return unported("llir: a pointer-null vector splat (a vector-typed ConstantPointerNull)");
  if (v instanceof ConstantFP) return getConstantFPSplat(v.context, n, scalable, v.getValueAPF());
  if (!scalable) {
    // (`UseConstantIntForFixedLengthSplat` is off by default.) If this splat is compatible with ConstantDataVector, use it.
    if (v instanceof ConstantInt && isElementTypeCompatible(v.type)) return getConstantDataSequential(v.context.getVectorType(v.type, n, false), new Array<ConstantInt>(n).fill(v));
    return getConstantVector(new Array<Constant>(n).fill(v));
  }
  return unported("llir: a scalable vector splat");
}

/** `getScalarSizeInBits` of an integer, FP or vector-of-those type. */
function scalarSizeInBits(t: Type): number {
  const s = t.getScalarType();
  return s instanceof IntegerType ? s.bits : s.isFloatingPointTy() ? s.fpBits() : 0;
}

/** `ConstantInt::get(Type*, const APInt&)`: the integer, splatted for a vector type (Constants.cpp:994). */
function getConstantIntOfType(ty: Type, value: bigint): Constant {
  const c = getConstantInt(ty.getScalarType() as IntegerType, value);
  if (ty instanceof VectorType) return getSplat(ty.numElements, ty.scalable, c);
  return c;
}

// llvm: llvm/lib/IR/ConstantFold.cpp:63 FoldBitCast
function foldBitCast(v: Constant, destTy: Type): Constant | undefined {
  const srcTy = v.type;
  if (srcTy === destTy) return v; // no-op cast
  if (v.isAllOnesValue()) return getAllOnesValue(destTy);
  // Handle ConstantInt -> Constant{Byte, FP} (the model has no byte types)
  if (v instanceof ConstantInt) {
    // Canonicalize scalar-to-vector bitcasts into vector-to-vector bitcasts.
    if (destTy.isVectorTy() && !srcTy.isVectorTy()) return unported("llir: FoldBitCast scalar-to-vector");
    // Make sure dest type is compatible with the folded fp constant. See note below regarding the PPC_FP128 restriction.
    const destScalar = destTy.getScalarType();
    if (destScalar.isFloatingPointTy() && destTy.typeID !== "PPC_FP128" && scalarSizeInBits(destTy) === scalarSizeInBits(srcTy)) {
      return getConstantFPOfType(destTy, APFloat.fromAPInt(destScalar.getFltSemantics(), v.value));
    }
    return undefined;
  }
  // Handle ConstantFP -> Constant{Int, Byte, FP}
  if (v instanceof ConstantFP) {
    // Handle half <-> bfloat
    if (!srcTy.isVectorTy() && destTy.isFloatingPointTy()) {
      const val = v.getValueAPF().bitcastToAPInt();
      return getConstantFPOfAPFloat(destTy.context, APFloat.fromAPInt(destTy.getFltSemantics(), val));
    }
    // Canonicalize scalar-to-vector bitcasts into vector-to-vector bitcasts.
    if (destTy.isVectorTy() && !srcTy.isVectorTy()) return unported("llir: FoldBitCast scalar-to-vector");
    // PPC_FP128 is really the sum of two consecutive doubles, where the first double is always stored first in memory,
    // regardless of the target endianness. The memory layout of i128, however, depends on the target endianness, and so we
    // can't fold this without target endianness information.
    if (srcTy.typeID === "PPC_FP128") return undefined;
    // Make sure dest type is compatible with the folded integer constant.
    if (destTy.getScalarType() instanceof IntegerType && scalarSizeInBits(destTy) === scalarSizeInBits(srcTy)) return getConstantIntOfType(destTy, v.getValueAPF().bitcastToAPInt());
    return undefined;
  }
  return undefined;
}

// llvm: llvm/lib/IR/Instructions.cpp:2882 CastInst::isEliminableCastPair
/** With `DL` null, as `foldConstantCastPair` passes it. Returns the opcode of the one cast that replaces the pair, or
 * undefined (LLVM's 0). The model's `CastOpcode` has no `PtrToAddr`, whose row and column are kept for the table's shape. */
function isEliminableCastPair(firstOp: CastOpcode, secondOp: CastOpcode, srcTy: Type, midTy: Type, dstTy: Type): CastOpcode | undefined {
  // Define the 144 possibilities for these two cast instructions. The rows correspond to firstOp, the columns to secondOp.
  const order = ["Trunc", "ZExt", "SExt", "FPToUI", "FPToSI", "UIToFP", "SIToFP", "FPTrunc", "FPExt", "PtrToInt", "PtrToAddr", "IntToPtr", "BitCast", "AddrSpaceCast"] as const;
  // biome-ignore format: LLVM's table
  const CastResults: readonly (readonly number[])[] = [
    // T        F  F  U  S  F  F  P  P  I  B  A  -+
    // R  Z  S  P  P  I  I  T  P  2  2  N  T  S   |
    // U  E  E  2  2  2  2  R  E  I  A  T  C  C   +- secondOp
    // N  X  X  U  S  F  F  N  X  N  D  2  V  V   |
    // C  T  T  I  I  P  P  C  T  T  R  P  T  T  -+
    [  1, 0, 0,99,99, 0, 0,99,99,99,99, 0, 3, 0], // Trunc         -+
    [  8, 1, 9,99,99, 2,17,99,99,99,99, 2, 3, 0], // ZExt           |
    [  8, 0, 1,99,99, 0, 2,99,99,99,99, 0, 3, 0], // SExt           |
    [  0, 0, 0,99,99, 0, 0,99,99,99,99, 0, 3, 0], // FPToUI         |
    [  0, 0, 0,99,99, 0, 0,99,99,99,99, 0, 3, 0], // FPToSI         |
    [ 99,99,99, 0, 0,99,99, 0, 0,99,99,99, 4, 0], // UIToFP         +- firstOp
    [ 99,99,99, 0, 0,99,99, 0, 0,99,99,99, 4, 0], // SIToFP         |
    [ 99,99,99, 0, 0,99,99, 0, 0,99,99,99, 4, 0], // FPTrunc        |
    [ 99,99,99, 2, 2,99,99, 8, 2,99,99,99, 4, 0], // FPExt          |
    [  1, 0, 0,99,99, 0, 0,99,99,99,99, 7, 3, 0], // PtrToInt       |
    [  0, 0, 0,99,99, 0, 0,99,99,99,99, 0, 3, 0], // PtrToAddr      |
    [ 99,99,99,99,99,99,99,99,99,11,11,99,15, 0], // IntToPtr       |
    [  5, 5, 5, 0, 0, 5, 5, 0, 0,16,16, 5, 1,14], // BitCast        |
    [  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,13,12], // AddrSpaceCast -+
  ];
  // If either of the casts are a bitcast from scalar to vector, disallow the merging. However, any pair of bitcasts are
  // allowed.
  const isFirstBitcast = firstOp === "BitCast";
  const isSecondBitcast = secondOp === "BitCast";
  const areBothBitcasts = isFirstBitcast && isSecondBitcast;
  // Check if any of the casts convert scalars <-> vectors.
  if ((isFirstBitcast && srcTy.isVectorTy() !== midTy.isVectorTy()) || (isSecondBitcast && midTy.isVectorTy() !== dstTy.isVectorTy())) {
    if (!areBothBitcasts) return undefined;
  }
  const isPtrOrPtrVectorTy = (t: Type): boolean => t.getScalarType().isPointerTy();
  const addressSpace = (t: Type): number => (t.getScalarType() as PointerType).addressSpace;
  const elimCase = CastResults[order.indexOf(firstOp)]![order.indexOf(secondOp)]!;
  switch (elimCase) {
    case 0:
      // Categorically disallowed.
      return undefined;
    case 1:
      // Allowed, use first cast's opcode.
      return firstOp;
    case 2:
      // Allowed, use second cast's opcode.
      return secondOp;
    case 3:
      // No-op cast in second op implies firstOp as long as the DestTy is integer and we are not converting between a vector
      // and a non-vector type.
      if (!srcTy.isVectorTy() && dstTy.isIntegerTy()) return firstOp;
      return undefined;
    case 4:
      // No-op cast in second op implies firstOp as long as the DestTy matches MidTy.
      if (dstTy === midTy) return firstOp;
      return undefined;
    case 5:
      // No-op cast in first op implies secondOp as long as the SrcTy is an integer.
      if (srcTy.isIntegerTy()) return secondOp;
      return undefined;
    case 7:
      // (DisableI2pP2iOpt is off.) Cannot simplify if address spaces are different! Then: cannot simplify if the
      // intermediate integer size is smaller than the pointer size, which needs the DL; it is null here.
      return undefined;
    case 8: {
      // ext, trunc -> bitcast,    if the SrcTy and DstTy are the same
      // ext, trunc -> ext,        if sizeof(SrcTy) < sizeof(DstTy)
      // ext, trunc -> trunc,      if sizeof(SrcTy) > sizeof(DstTy)
      const srcSize = scalarSizeInBits(srcTy);
      const dstSize = scalarSizeInBits(dstTy);
      if (srcTy === dstTy) return "BitCast";
      if (srcSize < dstSize) return firstOp;
      if (srcSize > dstSize) return secondOp;
      return undefined;
    }
    case 9:
      // zext, sext -> zext, because sext can't sign extend after zext
      return "ZExt";
    case 11:
      // inttoptr, ptrtoint/ptrtoaddr -> integer cast: needs the DL, which is null here.
      return undefined;
    case 12:
      // addrspacecast, addrspacecast -> bitcast,       if SrcAS == DstAS
      // addrspacecast, addrspacecast -> addrspacecast, if SrcAS != DstAS
      if (addressSpace(srcTy) !== addressSpace(dstTy)) return "AddrSpaceCast";
      return "BitCast";
    case 13:
      // addrspacecast can only fold through a bitcast if the result remains a pointer.
      if (!isPtrOrPtrVectorTy(dstTy)) return undefined;
      // Allowed, use first cast's opcode
      return firstOp;
    case 14:
      // bitcast, addrspacecast -> addrspacecast; addrspacecast can only fold through a bitcast if the source was already a
      // pointer.
      if (!isPtrOrPtrVectorTy(srcTy)) return undefined;
      return "AddrSpaceCast";
    case 15:
      // Allowed, use first cast's opcode
      return firstOp;
    case 16:
      // Allowed, use second cast's opcode
      return secondOp;
    case 17:
      // (sitofp (zext x)) -> (uitofp x)
      return "UIToFP";
    case 99:
      // Cast combination can't happen (error in input). This is for all cases where the MidTy is not the same for the two
      // cast instructions.
      throw new Error("llvm: Invalid Cast Combination");
    default:
      throw new Error("llvm: Error in CastResults table!!!");
  }
}

// llvm: llvm/lib/IR/ConstantFold.cpp:45 foldConstantCastPair
/** Which opcode folds the cast `opc` of the cast constant expression `op` (to `dstTy`) into one cast, if any. */
function foldConstantCastPair(opc: CastOpcode, op: ConstantExpr, dstTy: Type): CastOpcode | undefined {
  // The types and opcodes for the two Cast constant expressions
  const srcTy = op.operands[0]!.type;
  const midTy = op.type;
  const firstOp = op.opcode as CastOpcode;
  const secondOp = opc;
  return isEliminableCastPair(firstOp, secondOp, srcTy, midTy, dstTy);
}

// llvm: llvm/lib/IR/ConstantFold.cpp:156 foldMaybeUndesirableCast
function foldMaybeUndesirableCast(opc: CastOpcode, v: Constant, destTy: Type): Constant | undefined {
  // `ConstantExpr::isDesirableCastOp(opc) ? ConstantExpr::getCast(opc, V, DestTy) : ConstantFoldCastInstruction(opc, V, DestTy)`.
  switch (opc) {
    case "Trunc":
    case "AddrSpaceCast":
      return getFoldedCast(opc, v, destTy);
    case "PtrToInt":
      return getPtrToInt(v, destTy);
    case "IntToPtr":
      return getIntToPtr(v, destTy);
    case "BitCast":
      return getBitCast(v, destTy);
    default:
      return constantFoldCastInstruction(opc, v, destTy);
  }
}

// llvm: llvm/lib/IR/ConstantFold.cpp:163 ConstantFoldCastInstruction
export function constantFoldCastInstruction(opc: CastOpcode, v: Constant, destTy: Type): Constant | undefined {
  if (v instanceof PoisonValue) return getPoison(destTy);
  if (v instanceof UndefValue) {
    // zext(undef) = 0, because the top bits will be zero. sext(undef) = 0, because the top bits will all be the same.
    // [us]itofp(undef) = 0, because the result value is bounded.
    if (opc === "ZExt" || opc === "SExt" || opc === "UIToFP" || opc === "SIToFP") return getNullValue(destTy);
    return getUndef(destTy);
  }
  if (v.isNullValue() && destTy.typeID !== "X86_AMX" && opc !== "AddrSpaceCast") return getNullValue(destTy);
  // If the cast operand is a constant expression, there's a few things we can do to try to simplify it.
  if (v instanceof ConstantExpr && v.isCast()) {
    // Try hard to fold cast of cast because they are often eliminable.
    const newOpc = foldConstantCastPair(opc, v, destTy);
    if (newOpc !== undefined) return foldMaybeUndesirableCast(newOpc, v.operands[0] as Constant, destTy);
  }
  // If the cast operand is a constant vector, perform the cast by operating on each element. In the cast of bitcasts, the
  // element count may be mismatched; don't attempt to handle that here.
  if (destTy instanceof VectorType && v.type instanceof VectorType && destTy.numElements === v.type.numElements && destTy.scalable === v.type.scalable) {
    // Fast path for splatted constants.
    const splat = getSplatValue(v);
    if (splat !== undefined) {
      const res = foldMaybeUndesirableCast(opc, splat, destTy.elementType);
      if (res === undefined) return undefined;
      return getSplat(destTy.numElements, destTy.scalable, res);
    }
    if (destTy.scalable) return undefined;
    return unported("llir: ConstantFoldCastInstruction of a non-splat vector (ConstantExpr::getExtractElement per element)");
  }
  switch (opc) {
    case "FPTrunc":
    case "FPExt":
      if (v instanceof ConstantFP) {
        const val = v.getValueAPF().convert(destTy.getScalarType().getFltSemantics(), "rmNearestTiesToEven").value;
        return getConstantFPOfType(destTy, val);
      }
      return undefined; // Can't fold.
    case "FPToUI":
    case "FPToSI":
      if (v instanceof ConstantFP) {
        const r = v.getValueAPF().convertToInteger(scalarSizeInBits(destTy), opc === "FPToSI", "rmTowardZero");
        // Undefined behavior invoked - the destination type can't represent the input constant.
        if (r.status === opInvalidOp) return getPoison(destTy);
        return getConstantIntOfType(destTy, r.value);
      }
      return undefined; // Can't fold.
    case "UIToFP":
    case "SIToFP":
      if (v instanceof ConstantInt) {
        const apf = APFloat.convertFromAPInt(destTy.getScalarType().getFltSemantics(), v.value, v.intType.bits, opc === "SIToFP", "rmNearestTiesToEven").value;
        return getConstantFPOfType(destTy, apf);
      }
      return undefined;
    case "ZExt":
      if (v instanceof ConstantInt) return getConstantInt(destTy as IntegerType, v.value);
      return undefined;
    case "SExt":
      if (v instanceof ConstantInt) return getConstantInt(destTy as IntegerType, v.sextValue);
      return undefined;
    case "Trunc":
      if (v instanceof ConstantInt) return getConstantInt(destTy as IntegerType, v.value);
      return undefined;
    case "BitCast":
      return foldBitCast(v, destTy);
    case "AddrSpaceCast":
    case "IntToPtr":
    case "PtrToInt":
      return undefined;
  }
}

// llvm: llvm/lib/IR/Constants.cpp:2351 getFoldedCast
export function getFoldedCast(opc: "Trunc" | "PtrToInt" | "IntToPtr" | "BitCast" | "AddrSpaceCast", c: Constant, ty: Type): Constant {
  // Fold a few common cases
  const fc = constantFoldCastInstruction(opc, c, ty);
  if (fc !== undefined) return fc;
  // Look up the constant in the table first to ensure uniqueness.
  return intern(ty.context, exprKey(ty, opc, [c], 0, undefined), () => new ConstantExpr(ty, opc, [c], 0, undefined));
}

// llvm: llvm/lib/IR/Constants.cpp:2456 ConstantExpr::getPtrToInt
export function getPtrToInt(c: Constant, dstTy: Type): Constant {
  if (c.type.isVectorTy()) return unported("llir: ptrtoint of a vector constant");
  return getFoldedCast("PtrToInt", c, dstTy);
}

// llvm: llvm/lib/IR/Constants.cpp:2470 ConstantExpr::getIntToPtr
export function getIntToPtr(c: Constant, dstTy: Type): Constant {
  if (c.type.isVectorTy()) return unported("llir: inttoptr of a vector constant");
  return getFoldedCast("IntToPtr", c, dstTy);
}

// llvm: llvm/lib/IR/Constants.cpp:2484 ConstantExpr::getBitCast
export function getBitCast(c: Constant, dstTy: Type): Constant {
  // It is common to ask for a bitcast of a value to its own type, handle this speedily.
  if (c.type === dstTy) return c;
  return getFoldedCast("BitCast", c, dstTy);
}

// llvm: llvm/lib/IR/Constants.cpp:2402 ConstantExpr::getPointerCast
export function getPointerCast(s: Constant, ty: Type): Constant {
  if (ty.getScalarType() instanceof IntegerType) return getPtrToInt(s, ty);
  const srcAS = (s.type.getScalarType() as PointerType).addressSpace;
  if (ty.getScalarType().isPointerTy() && srcAS !== (ty.getScalarType() as PointerType).addressSpace) return getFoldedCast("AddrSpaceCast", s, ty);
  return getBitCast(s, ty);
}

// llvm: llvm/lib/IR/ConstantFold.cpp:1349 ConstantFoldGetElementPtr
export function constantFoldGetElementPtr(_pointeeTy: Type, c: Constant, idxs: readonly Constant[]): Constant | undefined {
  if (idxs.length === 0) return c;
  if (c.type.isVectorTy() || idxs.some((i) => i.type.isVectorTy())) return unported("llir: constant GEP over vectors");
  // GetElementPtrInst::getGEPReturnType of a scalar pointer: the pointer's type.
  const gepTy = c.type;
  if (c instanceof PoisonValue) return getPoison(gepTy);
  if (c instanceof UndefValue) return getUndef(gepTy);
  // IsNoOp (no inrange in the model): every index null or undef.
  if (idxs.every((i) => i.isNullValue() || i instanceof UndefValue)) return c;
  return undefined;
}

// llvm: llvm/lib/IR/Constants.cpp:2669 ConstantExpr::getGetElementPtr
export function getGetElementPtr(ty: Type, c: Constant, idxs: readonly Constant[], noWrapFlags: number): Constant {
  const fc = constantFoldGetElementPtr(ty, c, idxs);
  if (fc !== undefined) return fc; // Fold a few common cases.
  // Get the result type of the getelementptr! (scalar: the pointer operand's type; vectors stopped in the fold above)
  const reqTy = c.type;
  const ops = [c, ...idxs];
  return intern(ty.context, exprKey(reqTy, "GetElementPtr", ops, noWrapFlags, ty), () => new ConstantExpr(reqTy, "GetElementPtr", ops, noWrapFlags, ty));
}

// ---- globals -----------------------------------------------------------------------------------------------------------

/** `GlobalValue::LinkageTypes`, by their `LLVMLinkage` names (ffi.rs's `Linkage`); the obsolete C values map onto these. */
export type LinkageTypes = Extract<FfiLinkage, "ExternalLinkage" | "AvailableExternallyLinkage" | "LinkOnceAnyLinkage" | "LinkOnceODRLinkage" | "WeakAnyLinkage" | "WeakODRLinkage" | "AppendingLinkage" | "InternalLinkage" | "PrivateLinkage" | "ExternalWeakLinkage" | "CommonLinkage">;
export type VisibilityTypes = "Default" | "Hidden" | "Protected";
export type DLLStorageClassTypes = "Default" | "DllImport" | "DllExport";
export type UnnamedAddrKind = "None" | "Local" | "Global";
export type ThreadLocalModeKind = "NotThreadLocal" | "GeneralDynamic" | "LocalDynamic" | "InitialExec" | "LocalExec";

export const isLocalLinkage = (l: LinkageTypes): boolean => l === "InternalLinkage" || l === "PrivateLinkage";

export abstract class GlobalValue extends Constant {
  parent: Module | undefined;
  linkage: LinkageTypes;
  visibility: VisibilityTypes = "Default";
  dllStorageClass: DLLStorageClassTypes = "Default";
  unnamedAddr: UnnamedAddrKind = "None";
  threadLocalMode: ThreadLocalModeKind = "NotThreadLocal";
  isDSOLocal = false;
  constructor(
    ptrTy: PointerType,
    /** The type of the global's contents (`getValueType`). */
    public valueType: Type,
    operands: readonly Value[],
    linkage: LinkageTypes,
  ) {
    super(ptrTy, operands);
    this.linkage = linkage;
    // GlobalValue's constructor: `if (isImplicitDSOLocal()) setDSOLocal(true)` follows from the linkage.
    if (this.isImplicitDSOLocal()) this.isDSOLocal = true;
  }
  get addressSpace(): number {
    return (this.type as PointerType).addressSpace;
  }
  hasLocalLinkage(): boolean {
    return isLocalLinkage(this.linkage);
  }

  // llvm: llvm/include/llvm/IR/GlobalValue.h:304 isImplicitDSOLocal
  isImplicitDSOLocal(): boolean {
    return this.hasLocalLinkage() || (this.visibility !== "Default" && this.linkage !== "ExternalWeakLinkage");
  }

  // llvm: llvm/include/llvm/IR/GlobalValue.h:547 setLinkage
  setLinkage(lt: LinkageTypes): void {
    if (isLocalLinkage(lt)) {
      this.visibility = "Default";
      this.dllStorageClass = "Default";
    }
    this.linkage = lt;
    if (this.isImplicitDSOLocal()) this.isDSOLocal = true;
  }

  // llvm: llvm/include/llvm/IR/GlobalValue.h:260 setVisibility
  setVisibility(v: VisibilityTypes): void {
    this.visibility = v;
    if (this.isImplicitDSOLocal()) this.isDSOLocal = true;
  }

  /** `GlobalValue::isDeclaration`. */
  abstract isDeclaration(): boolean;

  /** Removes the global from its module (its name leaves the module's symbol table). */
  removeFromParent(): void {
    const m = this.parent;
    if (m === undefined) return;
    if (this.hasName()) m.symTab.removeValueName(this.name);
    const list: GlobalValue[] = this instanceof GlobalVariable ? m.globals : this instanceof Function ? m.functions : m.aliases;
    list.splice(list.indexOf(this), 1);
    this.parent = undefined;
  }
}

export abstract class GlobalObject extends GlobalValue {
  /** `bstr`, or undefined. */
  section: string | undefined;
  /** Bytes; undefined is no alignment (`MaybeAlign()`). */
  alignment: number | undefined;
  comdat: Comdat | undefined;
  /** Attachments in attachment order (`Value::setMetadata`, `addMetadata`). */
  readonly metadata: [kind: number, node: MDNode][] = [];

  // llvm: llvm/lib/IR/Globals.cpp:209 GlobalObject::setAlignment
  setAlignment(bytes: number | undefined): void {
    // `MaybeAlign(Bytes)`: 0 is no alignment.
    this.alignment = bytes === 0 ? undefined : bytes;
  }

  // llvm: llvm/lib/IR/Globals.cpp:348 GlobalObject::setSection
  setSection(s: string): void {
    // An empty section name is no section.
    this.section = s === "" ? undefined : s;
  }

  // llvm: llvm/lib/IR/Metadata.cpp:1613 Value::setMetadata
  setMetadata(kind: number, node: MDNode | undefined): void {
    // `eraseMetadata(KindID)` drops every attachment of the kind; then `addMetadata` appends the new one.
    for (let i = this.metadata.length - 1; i >= 0; i--) if (this.metadata[i]![0] === kind) this.metadata.splice(i, 1);
    if (node !== undefined) this.addMetadata(kind, node);
  }

  // llvm: llvm/lib/IR/Metadata.cpp:1628 Value::addMetadata
  addMetadata(kind: number, node: MDNode): void {
    this.metadata.push([kind, node]);
  }
}

export class GlobalVariable extends GlobalObject {
  isConstantGlobal = false;
  isExternallyInitialized = false;
  constructor(ptrTy: PointerType, valueType: Type, linkage: LinkageTypes) {
    super(ptrTy, valueType, [], linkage);
  }
  get initializer(): Constant | undefined {
    return this.operands[0] as Constant | undefined;
  }

  // llvm: llvm/lib/IR/Globals.cpp:613 GlobalVariable::setInitializer
  setInitializer(init: Constant | undefined): void {
    if (init === undefined) {
      if (this.operands.length) this.dropAllReferences();
      return;
    }
    if (this.operands.length) this.setOperand(0, init);
    else this.pushOperand(init);
  }
  isDeclaration(): boolean {
    // `GlobalValue::isDeclaration` for a GlobalVariable: no initializer.
    return this.operands.length === 0;
  }
}

/** `AttributeList` indices: `ReturnIndex` 0, parameter i at i + 1 (`FirstArgIndex`), `FunctionIndex` ~0U. */
export const FUNCTION_INDEX = 0xffffffff;

export class Function extends GlobalObject {
  callingConv = 0;
  /** `AttributeList`: index -> attribute key -> attribute (AttrBuilder replaces by key). */
  readonly attributes = new Map<number, Map<string, Attribute>>();
  readonly args: Argument[];
  /** Undefined when the context discards value names (Function::Function). */
  readonly symTab: ValueSymbolTable | undefined;
  /** llir-core-b's basic blocks, in order; empty for a declaration. */
  readonly blocks: BasicBlockBase[] = [];
  personality: Constant | undefined;
  gc: string | undefined;

  // llvm: llvm/lib/IR/Function.cpp:481 Function::Function
  constructor(ty: FunctionType, linkage: LinkageTypes, addrSpace: number, name: string, module: Module | undefined) {
    super(ty.context.getPointerType(addrSpace), ty, [], linkage);
    // We only need a symbol table for a function if the context keeps value names.
    this.symTab = ty.context.discardValueNames ? undefined : new ValueSymbolTable(NON_GLOBAL_VALUE_MAX_NAME_SIZE);
    // PORT: LLVM builds the arguments lazily (`BuildLazyArguments`); they are unnamed either way, so the model builds them here.
    this.args = ty.params.map((p, i) => new Argument(p, this, i));
    // GlobalValue's constructor sets the name before the function is in a module (no symbol table yet).
    this.name = name;
    if (module) module.insertFunction(this);
    // PORT: an intrinsic (`llvm.` name) gets `Intrinsic::getAttributes` here. The parser replaces an intrinsic declaration's
    // attributes (plan-m7 §1b), so the normal form cannot see them; the model leaves them out.
  }
  get functionType(): FunctionType {
    return this.valueType as FunctionType;
  }
  isDeclaration(): boolean {
    return this.blocks.length === 0;
  }
  isIntrinsic(): boolean {
    return this.name.startsWith("llvm.");
  }
}

export class GlobalAlias extends GlobalValue {
  constructor(ptrTy: PointerType, valueType: Type, linkage: LinkageTypes, aliasee: Constant) {
    super(ptrTy, valueType, [aliasee], linkage);
  }
  get aliasee(): Constant {
    return this.operands[0] as Constant;
  }
  isDeclaration(): boolean {
    return false;
  }
}

export type ComdatSelectionKind = "Any" | "ExactMatch" | "Largest" | "NoDeduplicate" | "SameSize";
export class Comdat {
  selectionKind: ComdatSelectionKind = "Any";
  constructor(readonly name: string) {}
}

// ---- metadata ----------------------------------------------------------------------------------------------------------

export abstract class Metadata {
  readonly id = nextId();
}
export class MDString extends Metadata {
  constructor(readonly str: string) {
    super();
  }
}
/** `ValueAsMetadata` (`ConstantAsMetadata` for a constant, `LocalAsMetadata` otherwise). */
export class ValueAsMetadata extends Metadata {
  constructor(public value: Value) {
    super();
  }
  /** `ValueAsMetadata::handleRAUW`: the wrapper follows the value (uniqued by value, so it is re-keyed). */
  handleRAUW(to: Value): void {
    const ctx = this.value.context;
    ctx.valueAsMetadata.delete(this.value);
    const existing = ctx.valueAsMetadata.get(to);
    if (existing !== undefined) return unported("llir: ValueAsMetadata::handleRAUW onto a value that already has metadata (MDNode RAUW)");
    this.value = to;
    ctx.valueAsMetadata.set(to, this);
  }
}
export class MDNode extends Metadata {
  constructor(
    readonly ops: (Metadata | undefined)[],
    readonly distinct: boolean,
  ) {
    super();
  }
}
/** `MetadataAsValue`: metadata wrapped as a value of type `metadata`. */
export class MetadataAsValue extends Value {
  constructor(
    type: Type,
    readonly md: Metadata,
  ) {
    super(type);
  }
}

// ---- attributes --------------------------------------------------------------------------------------------------------

/** An attribute (`Attribute`): `key` is the enum kind name (`NoAlias`) or the string attribute's key; `print(inGroup)` is
 * `Attribute::getAsString(inGroup)` (they differ only for `align`); `type` is a type attribute's type. */
export class Attribute {
  constructor(
    readonly key: string,
    readonly print: (inGroup: boolean) => string,
    readonly isString: boolean,
    readonly type?: Type,
  ) {}
  /** What an `AttrBuilder` replaces by: enum kinds and string keys are separate spaces (review N8). */
  get slot(): string {
    return this.isString ? `str:${this.key}` : `kind:${this.key}`;
  }
}

// ---- modules and contexts ----------------------------------------------------------------------------------------------

/** `Module::ModFlagBehavior` (Module.h; ffi.rs's `ModuleFlagMergeBehavior` mirrors its values). */
export const MOD_FLAG_BEHAVIOR = { Error: 1, Warning: 2, Require: 3, Override: 4, Append: 5, AppendUnique: 6, Max: 7, Min: 8 } as const;

export class Module {
  readonly globals: GlobalVariable[] = [];
  readonly functions: Function[] = [];
  readonly aliases: GlobalAlias[] = [];
  readonly symTab = new ValueSymbolTable(-1);
  readonly comdats = new Map<string, Comdat>();
  /** Named metadata in creation order (`NamedMDList`). */
  readonly namedMetadata = new Map<string, MDNode[]>();
  dataLayout = "";
  targetTriple = "";
  /** `bstr`; `Module::Module` sets the source file name to the module id. */
  sourceFileName: string;
  inlineAsm = "";
  constructor(
    readonly context: Context,
    readonly moduleID: string,
  ) {
    this.sourceFileName = moduleID;
  }
  isNVPTX(): boolean {
    // `Triple::isNVPTX`: the arch is nvptx or nvptx64; the arch is the triple's first component.
    const arch = this.targetTriple.split("-")[0];
    return arch === "nvptx" || arch === "nvptx64";
  }
  /** `SymbolTableListTraits::addNodeToList` for a global variable: it joins the module's symbol table. */
  insertGlobalVariable(gv: GlobalVariable): void {
    gv.parent = this;
    this.globals.push(gv);
    if (gv.hasName()) this.symTab.reinsertValue(gv);
  }
  insertFunction(f: Function): void {
    f.parent = this;
    this.functions.push(f);
    if (f.hasName()) this.symTab.reinsertValue(f);
  }
  insertAlias(a: GlobalAlias): void {
    a.parent = this;
    this.aliases.push(a);
    if (a.hasName()) this.symTab.reinsertValue(a);
  }

  // llvm: llvm/lib/IR/Module.cpp:177 Module::getNamedValue
  getNamedValue(name: string): GlobalValue | undefined {
    return this.symTab.lookup(name) as GlobalValue | undefined;
  }

  // llvm: llvm/lib/IR/Module.cpp:250 Module::getGlobalVariable
  getGlobalVariable(name: string, allowLocal: boolean): GlobalVariable | undefined {
    const r = this.getNamedValue(name);
    if (r instanceof GlobalVariable && (allowLocal || !r.hasLocalLinkage())) return r;
    return undefined;
  }

  /** `Module::getOrInsertNamedMetadata`. */
  getOrInsertNamedMetadata(name: string): MDNode[] {
    let n = this.namedMetadata.get(name);
    if (n === undefined) {
      n = [];
      this.namedMetadata.set(name, n);
    }
    return n;
  }

  // llvm: llvm/lib/IR/Module.cpp:381 Module::addModuleFlag
  addModuleFlag(behavior: number, key: string, val: Metadata): void {
    const ctx = this.context;
    const ops = [ctx.constantAsMetadata(getConstantInt(ctx.getIntType(32), BigInt(behavior))), ctx.getMDString(key), val];
    this.getOrInsertNamedMetadata("llvm.module.flags").push(ctx.getMDNode(ops));
  }

  // llvm: llvm/lib/IR/Module.cpp:637 Module::setPICLevel
  setPICLevel(pl: number): void {
    // The merge result of a non-PIC object and a PIC object can only be reliably used as a non-PIC object, so use the Min
    // merge behavior (8).
    this.addModuleFlag(MOD_FLAG_BEHAVIOR.Min, "PIC Level", this.context.constantAsMetadata(getConstantInt(this.context.getIntType(32), BigInt(pl))));
  }

  // llvm: llvm/lib/IR/Module.cpp:653 Module::setPIELevel
  setPIELevel(pl: number): void {
    this.addModuleFlag(MOD_FLAG_BEHAVIOR.Max, "PIE Level", this.context.constantAsMetadata(getConstantInt(this.context.getIntType(32), BigInt(pl))));
  }

  // llvm: llvm/lib/IR/Module.cpp:667 Module::setCodeModel
  setCodeModel(cl: number): void {
    // Linking object files with different code models is undefined behavior; mixing them is treated as an error.
    this.addModuleFlag(MOD_FLAG_BEHAVIOR.Error, "Code Model", this.context.constantAsMetadata(getConstantInt(this.context.getIntType(32), BigInt(cl))));
  }

  // llvm: llvm/lib/IR/Module.cpp:685 Module::setLargeDataThreshold
  setLargeDataThreshold(threshold: bigint): void {
    // Since the large data threshold goes along with the code model, the merge behavior is the same; the value is an i64.
    this.addModuleFlag(MOD_FLAG_BEHAVIOR.Error, "Large Data Threshold", this.context.constantAsMetadata(getConstantInt(this.context.getIntType(64), threshold)));
  }

  /** The default address spaces of the data layout (`DataLayout::getProgramAddressSpace`, `getDefaultGlobalsAddressSpace`). */
  layoutAddressSpace(component: "P" | "G"): number {
    // PORT: the model does not parse data layouts. Both default to 0, and no layout the D3 targets use names `P` or `G`;
    // a layout that does stops here rather than guess what `DataLayout::parseSpecification` would make of it.
    if (this.dataLayout.split("-").some((s) => s.startsWith(component))) return unported(`llir: data layout with a \`${component}\` component (DataLayout parsing)`);
    return 0;
  }
}

export class Context {
  discardValueNames = false;
  readonly types = new Map<string, Type>();
  readonly namedStructTypes = new Map<string, StructType>();
  namedStructTypesUniqueID = 0;
  /** Every uniqued constant, by key. */
  readonly constants = new Map<string, Constant>();
  readonly mdStrings = new Map<string, MDString>();
  readonly mdNodes = new Map<string, MDNode>();
  readonly valueAsMetadata = new Map<Value, ValueAsMetadata>();
  readonly metadataAsValue = new Map<Metadata, MetadataAsValue>();
  /** `AttrsSet`: attributes are uniqued per context by kind and value (`Attribute::get` profiles and looks them up). */
  readonly attributes = new Map<string, Attribute>();
  getAttribute(key: string, make: () => Attribute): Attribute {
    let a = this.attributes.get(key);
    if (a === undefined) this.attributes.set(key, (a = make()));
    return a;
  }
  /** `MDKindNames`, seeded with the fixed kinds (LLVMContext::LLVMContext). */
  readonly mdKinds = new Map<string, number>(FIXED_MD_KINDS.map((n, i) => [n, i]));

  private simple(id: TypeID): Type {
    const k = `S:${id}`;
    let t = this.types.get(k);
    if (t === undefined) this.types.set(k, (t = new Type(this, id)));
    return t;
  }
  getVoidType(): Type {
    return this.simple("Void");
  }
  getFloatingType(id: "Half" | "BFloat" | "Float" | "Double" | "X86_FP80" | "FP128" | "PPC_FP128"): Type {
    return this.simple(id);
  }
  getLabelType(): Type {
    return this.simple("Label");
  }
  getMetadataType(): Type {
    return this.simple("Metadata");
  }
  getTokenType(): Type {
    return this.simple("Token");
  }

  // llvm: llvm/lib/IR/Type.cpp:348 IntegerType::get
  getIntType(bits: number): IntegerType {
    const k = `I:${bits}`;
    let t = this.types.get(k);
    if (t === undefined) this.types.set(k, (t = new IntegerType(this, bits)));
    return t as IntegerType;
  }

  // llvm: llvm/lib/IR/Type.cpp:911 PointerType::get
  getPointerType(addressSpace: number): PointerType {
    const k = `P:${addressSpace}`;
    let t = this.types.get(k);
    if (t === undefined) this.types.set(k, (t = new PointerType(this, addressSpace)));
    return t as PointerType;
  }

  // llvm: llvm/lib/IR/Type.cpp:817 ArrayType::get
  getArrayType(elem: Type, n: bigint): ArrayType {
    const k = `A:${elem.id}:${n}`;
    let t = this.types.get(k);
    if (t === undefined) this.types.set(k, (t = new ArrayType(this, elem, n)));
    return t as ArrayType;
  }

  // llvm: llvm/lib/IR/Type.cpp:846 VectorType::get
  getVectorType(elem: Type, n: number, scalable: boolean): VectorType {
    const k = `V:${elem.id}:${n}:${scalable}`;
    let t = this.types.get(k);
    if (t === undefined) this.types.set(k, (t = new VectorType(this, elem, n, scalable)));
    return t as VectorType;
  }

  // llvm: llvm/lib/IR/Type.cpp:432 FunctionType::get
  getFunctionType(ret: Type, params: readonly Type[], isVarArg: boolean): FunctionType {
    const k = `F:${ret.id}(${params.map((p) => p.id).join(",")})${isVarArg}`;
    let t = this.types.get(k);
    if (t === undefined) this.types.set(k, (t = new FunctionType(this, ret, [...params], isVarArg)));
    return t as FunctionType;
  }

  // llvm: llvm/lib/IR/Type.cpp:477 StructType::get
  getLiteralStructType(elems: readonly Type[], packed: boolean): StructType {
    const k = `LS:${packed}:${elems.map((e) => e.id).join(",")}`;
    let t = this.types.get(k);
    if (t === undefined) this.types.set(k, (t = new StructType(this, true, packed, [...elems])));
    return t as StructType;
  }

  // llvm: llvm/lib/IR/Type.cpp:683 StructType::create
  createNamedStruct(name: string): StructType {
    const st = new StructType(this, false, false, undefined);
    if (name !== "") st.setName(name);
    return st;
  }

  getMDString(s: string): MDString {
    let m = this.mdStrings.get(s);
    if (m === undefined) this.mdStrings.set(s, (m = new MDString(s)));
    return m;
  }

  /** `MDNode::get` (MDTuple, uniqued by operands). */
  getMDNode(ops: readonly (Metadata | undefined)[]): MDNode {
    const k = ops.map((o) => o?.id ?? 0).join(",");
    let m = this.mdNodes.get(k);
    if (m === undefined) this.mdNodes.set(k, (m = new MDNode([...ops], false)));
    return m;
  }

  /** `ValueAsMetadata::get`. */
  constantAsMetadata(v: Value): ValueAsMetadata {
    let m = this.valueAsMetadata.get(v);
    if (m === undefined) this.valueAsMetadata.set(v, (m = new ValueAsMetadata(v)));
    return m;
  }

  /** `MetadataAsValue::get`. */
  getMetadataAsValue(md: Metadata): MetadataAsValue {
    let v = this.metadataAsValue.get(md);
    if (v === undefined) this.metadataAsValue.set(md, (v = new MetadataAsValue(this.getMetadataType(), md)));
    return v;
  }

  // llvm: llvm/lib/IR/LLVMContext.cpp:280 LLVMContext::getMDKindID
  getMDKindID(name: string): number {
    // If this is new, assign it its ID.
    let id = this.mdKinds.get(name);
    if (id === undefined) this.mdKinds.set(name, (id = this.mdKinds.size));
    return id;
  }
}

/** `FixedMetadataKinds.def` at the pin, in ID order (`LLVM_FIXED_MD_KIND(MD_dbg, "dbg", 0)` ...), extracted from that file;
 * the C API differential test checks a custom kind's ID against libLLVM. */
export const FIXED_MD_KINDS: readonly string[] = [
  "dbg", "tbaa", "prof", "fpmath", "range", "tbaa.struct", "invariant.load", "alias.scope", "noalias", "nontemporal",
  "llvm.mem.parallel_loop_access", "nonnull", "dereferenceable", "dereferenceable_or_null", "make.implicit", "unpredictable",
  "invariant.group", "align", "llvm.loop", "type", "section_prefix", "absolute_symbol", "associated", "callees", "irr_loop",
  "llvm.access.group", "callback", "llvm.preserve.access.index", "vcall_visibility", "noundef", "annotation", "nosanitize",
  "func_sanitize", "exclude", "memprof", "callsite", "kcfi_type", "pcsections", "DIAssignID", "coro.outside.frame", "mmra",
  "noalias.addrspace", "callee_type", "nofree", "captures", "alloc_token", "implicit.ref", "nofpclass", "call_target",
  "inline_history", "elf_section_properties", "guid", "mem.cache_hint", "block.uniformity.profile", "callgraph",
];
