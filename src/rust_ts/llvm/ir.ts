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
// - Floating-point constants hold their bit pattern (`bigint`), as `APFloat::bitcastToAPInt`.
import { unported } from "../../std/panic.ts";
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
    readonly numElements: number,
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
      } else if (v instanceof Constant || v instanceof Argument) {
        return v;
      } else {
        return unported("llir: stripPointerCasts through an instruction (GEP, cast, call with `returned`): llir-core-b");
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

/** llir-core-b's instructions extend this; `getSymTab` needs to know an instruction's function. */
export abstract class Instruction extends User {
  abstract parentFunction(): Function | undefined;
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
  /** `Constant::isNullValue`. */
  isNullValue(): boolean {
    return false;
  }
  /** `Constant::isAllOnesValue`. */
  isAllOnesValue(): boolean {
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

export class ConstantFP extends Constant {
  constructor(
    type: Type,
    /** The bit pattern (`APFloat::bitcastToAPInt`). */
    readonly bits: bigint,
  ) {
    super(type, []);
  }
  override isNullValue(): boolean {
    // The `IsNullValue` bit of a ConstantFP is set for +0.0, whose bit pattern is all zeros.
    return this.bits === 0n;
  }
  override isAllOnesValue(): boolean {
    // `Constant::isAllOnesValue`: "FP which are bitcasted from -1 integers".
    return this.bits === (1n << BigInt(this.type.fpBits())) - 1n;
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

/** `ConstantFP::get(LLVMContext&, const APFloat&)`, the APFloat given by its bits. */
export function getConstantFP(ty: Type, bits: bigint): ConstantFP {
  return intern(ty.context, `CFP:${ty.id}:${bits}`, () => new ConstantFP(ty, bits));
}

// llvm: llvm/lib/IR/Constants.cpp:1108 ConstantFP::get
/** `ConstantFP::get(Type*, double V)`: `V` converted to the type's semantics. */
export function getConstantFPOfDouble(ty: Type, v: number): Constant {
  if (ty.isVectorTy()) return unported("llir: ConstantFP::get of a vector type (a splat)");
  const buf = new DataView(new ArrayBuffer(8));
  if (ty.typeID === "Double") {
    buf.setFloat64(0, v);
    return getConstantFP(ty, buf.getBigUint64(0));
  }
  if (ty.typeID === "Float") {
    // APFloat::convert(IEEEsingle, rmNearestTiesToEven) of a double is IEEE round-to-nearest-even, as `Math.fround`;
    // a NaN's payload is truncated by `convert` and by `fround` alike only for quiet NaNs, so a NaN stops here.
    if (Number.isNaN(v)) return unported("llir: ConstantFP::get(float, NaN) (APFloat NaN payload conversion)");
    buf.setFloat32(0, v);
    return getConstantFP(ty, BigInt(buf.getUint32(0)));
  }
  return unported(`llir: ConstantFP::get(${ty.typeID}, double) (APFloat conversion)`);
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
      // APFloat::getZero: +0.0, all bits zero in every semantics.
      return getConstantFP(ty, 0n);
    case "Pointer":
      return getConstantPointerNull(ty);
    case "Vector":
    case "ScalableVector": {
      const elt = (ty as VectorType).elementType;
      if (elt.isFloatingPointTy() || elt.isPointerTy()) return unported("llir: getNullValue of a vector of floats or pointers (a splat ConstantFP/ConstantPointerNull)");
      return getConstantAggregateZero(ty);
    }
    case "Struct":
    case "Array":
      return getConstantAggregateZero(ty);
    case "Token":
      return unported("llir: ConstantTokenNone");
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
  if (c.type instanceof VectorType && c.type.scalable) return undefined;
  if (c instanceof PoisonValue) return elt < elementCount(c.type) ? getPoison(elementTypeAt(c.type, elt)) : undefined;
  if (c instanceof UndefValue) return elt < elementCount(c.type) ? getUndef(elementTypeAt(c.type, elt)) : undefined;
  if (c instanceof ConstantDataSequential) return elt < c.elements.length ? c.elements[elt] : undefined;
  return undefined;
}

/** Elements of an aggregate or vector type (`getNumElements` / `getStructNumElements`). */
function elementCount(t: Type): number {
  if (t instanceof ArrayType || t instanceof VectorType) return t.numElements;
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

// llvm: llvm/lib/IR/ConstantFold.cpp:63 FoldBitCast
function foldBitCast(v: Constant, destTy: Type): Constant | undefined {
  const srcTy = v.type;
  if (srcTy === destTy) return v; // no-op cast
  if (v.isAllOnesValue()) return unported("llir: FoldBitCast of an all-ones value (Constant::getAllOnesValue)");
  // Handle ConstantInt -> Constant{Byte, FP}
  if (v instanceof ConstantInt) {
    if (destTy.isVectorTy() && !srcTy.isVectorTy()) return unported("llir: FoldBitCast scalar-to-vector");
    // Make sure dest type is compatible with the folded fp constant (not PPC_FP128).
    if (destTy.isFloatingPointTy() && destTy.typeID !== "PPC_FP128" && destTy.fpBits() === (srcTy as IntegerType).bits) return getConstantFP(destTy, v.value);
    return undefined;
  }
  if (v instanceof ConstantFP) {
    // Handle half <-> bfloat
    if (!srcTy.isVectorTy() && destTy.isFloatingPointTy()) return getConstantFP(destTy, v.bits);
    if (destTy.isVectorTy() && !srcTy.isVectorTy()) return unported("llir: FoldBitCast scalar-to-vector");
    if (srcTy.typeID === "PPC_FP128") return undefined;
    if (destTy instanceof IntegerType && destTy.bits === srcTy.fpBits()) return getConstantInt(destTy, v.bits);
    return undefined;
  }
  return undefined;
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
  if (v instanceof ConstantExpr && v.isCast()) return unported("llir: ConstantFoldCastInstruction of a cast of a cast (foldConstantCastPair / CastInst::isEliminableCastPair)");
  if (destTy.isVectorTy() && v.type.isVectorTy()) return unported("llir: ConstantFoldCastInstruction of a vector");
  switch (opc) {
    case "FPTrunc":
    case "FPExt":
    case "FPToUI":
    case "FPToSI":
    case "UIToFP":
    case "SIToFP":
      if (v instanceof ConstantFP || v instanceof ConstantInt) return unported(`llir: ConstantFoldCastInstruction ${opc} (APFloat conversion)`);
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

/** An attribute (`Attribute`): `key` is the enum kind name (`NoAlias`) or the string attribute's key; `text` and `groupText`
 * are `Attribute::getAsString(false)` and `getAsString(true)` (they differ only for `align`). Types print lazily. */
export class Attribute {
  constructor(
    readonly key: string,
    readonly print: (inGroup: boolean) => string,
    readonly isString: boolean,
  ) {}
}

// ---- modules and contexts ----------------------------------------------------------------------------------------------

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
  getArrayType(elem: Type, n: number): ArrayType {
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
