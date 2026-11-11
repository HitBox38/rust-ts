// rust-ts: the constant folds the IR builder applies when an instruction's operands are constants (lane llir-core-b): LLVM's
// `ConstantFolder` (llvm/IR/ConstantFolder.h, the folder `IRBuilder<>` uses) and the `ConstantFold.cpp` / `Constants.cpp`
// rules it calls. Each rule carries `// llvm:` and follows the source in order; a case the model cannot compute exactly
// (APFloat arithmetic and conversions, vectors, pointer relations that need the data layout) stops with `unported`.
import { unported } from "../../std/panic.ts";
import {
  ArrayType,
  type CastOpcode,
  Constant,
  ConstantExpr,
  ConstantFP,
  ConstantInt,
  constantFoldCastInstruction,
  ConstantPointerNull,
  Function as IrFunction,
  getAggregateElement,
  getBitCast,
  getConstantArray,
  getConstantFP,
  getConstantFPOfDouble,
  getConstantInt,
  getConstantStruct,
  getFoldedCast,
  getGetElementPtr,
  getIntToPtr,
  getNullValue,
  getPoison,
  getPtrToInt,
  getUndef,
  GlobalValue,
  GlobalVariable,
  IntegerType,
  internExpr,
  PoisonValue,
  StructType,
  type Type,
  UndefValue,
  type Value,
  VectorType,
} from "./ir.ts";

/** `Instruction::BinaryOps`, by LLVM's names (the printed opcode is the name in lower case). */
export type BinaryOps = "Add" | "FAdd" | "Sub" | "FSub" | "Mul" | "FMul" | "UDiv" | "SDiv" | "FDiv" | "URem" | "SRem" | "FRem" | "Shl" | "LShr" | "AShr" | "And" | "Or" | "Xor";

/** `Instruction::isCommutative` of a binary operator (Instruction.cpp). */
export const isCommutative = (op: BinaryOps): boolean => op === "Add" || op === "FAdd" || op === "Mul" || op === "FMul" || op === "And" || op === "Or" || op === "Xor";
/** `Instruction::isAssociative(unsigned Opcode)` (Instruction.h): And, Or, Xor, Add, Mul. */
const isAssociative = (op: BinaryOps): boolean => op === "And" || op === "Or" || op === "Xor" || op === "Add" || op === "Mul";

/** `CmpInst::Predicate` values (InstrTypes.h), which are also the C API's `LLVMRealPredicate` / `LLVMIntPredicate`. */
export const FCMP_FALSE = 0;
export const FCMP_TRUE = 15;
export const ICMP = { EQ: 32, NE: 33, UGT: 34, UGE: 35, ULT: 36, ULE: 37, SGT: 38, SGE: 39, SLT: 40, SLE: 41 } as const;
const FCMP = { OEQ: 1, OGT: 2, OGE: 3, OLT: 4, OLE: 5, ONE: 6, ORD: 7, UNO: 8, UEQ: 9, UGT: 10, UGE: 11, ULT: 12, ULE: 13, UNE: 14 } as const;
export const isIntPredicate = (p: number): boolean => p >= ICMP.EQ && p <= ICMP.SLE;
export const isFPPredicate = (p: number): boolean => p >= FCMP_FALSE && p <= FCMP_TRUE;
/** `ICmpInst::isEquality(Predicate)` (Instructions.h): eq or ne. The fold's undef rule asks this one, not `CmpInst::isEquality`
 * (which also takes the FP oeq/one/ueq/une): `fcmp oeq 0.0, undef` folds to false, not undef (C API differential test). */
const isEquality = (p: number): boolean => p === ICMP.EQ || p === ICMP.NE;
/** `CmpInst::getSwappedPredicate`. */
function getSwappedPredicate(p: number): number {
  const swap: Readonly<Record<number, number>> = {
    [ICMP.SGT]: ICMP.SLT, [ICMP.SLT]: ICMP.SGT, [ICMP.SGE]: ICMP.SLE, [ICMP.SLE]: ICMP.SGE,
    [ICMP.UGT]: ICMP.ULT, [ICMP.ULT]: ICMP.UGT, [ICMP.UGE]: ICMP.ULE, [ICMP.ULE]: ICMP.UGE,
    [FCMP.OGT]: FCMP.OLT, [FCMP.OLT]: FCMP.OGT, [FCMP.OGE]: FCMP.OLE, [FCMP.OLE]: FCMP.OGE,
    [FCMP.UGT]: FCMP.ULT, [FCMP.ULT]: FCMP.UGT, [FCMP.UGE]: FCMP.ULE, [FCMP.ULE]: FCMP.UGE,
  };
  return swap[p] ?? p;
}

// llvm: llvm/lib/IR/Instructions.cpp:3703 CmpInst::getPredicateName
export function getPredicateName(p: number): string {
  const names: Readonly<Record<number, string>> = {
    0: "false", 1: "oeq", 2: "ogt", 3: "oge", 4: "olt", 5: "ole", 6: "one", 7: "ord", 8: "uno", 9: "ueq", 10: "ugt", 11: "uge",
    12: "ult", 13: "ule", 14: "une", 15: "true", 32: "eq", 33: "ne", 34: "ugt", 35: "uge", 36: "ult", 37: "ule", 38: "sgt",
    39: "sge", 40: "slt", 41: "sle",
  };
  return names[p] ?? "unknown";
}

// llvm: llvm/lib/IR/Instructions.cpp:4004 CmpInst::isUnordered
const isUnordered = (p: number): boolean => p === FCMP.UEQ || p === FCMP.UNE || p === FCMP.UGT || p === FCMP.ULT || p === FCMP.UGE || p === FCMP.ULE || p === FCMP.UNO;

// llvm: llvm/lib/IR/Instructions.cpp:4013 CmpInst::isTrueWhenEqual
const isTrueWhenEqual = (p: number): boolean =>
  p === ICMP.EQ || p === ICMP.UGE || p === ICMP.ULE || p === ICMP.SGE || p === ICMP.SLE || p === FCMP_TRUE || p === FCMP.UEQ || p === FCMP.UGE || p === FCMP.ULE;

/** The `i1` result type of a comparison of `t` (a vector of `i1` for a vector). */
function cmpResultType(t: Type): Type {
  if (t instanceof VectorType) return unported("llir: a comparison of vectors (a vector of i1 result)");
  return t.context.getIntType(1);
}

// ---- constants the folds build ----------------------------------------------------------------------------------------

// llvm: llvm/lib/IR/Constants.cpp:427 Constant::getAllOnesValue
export function getAllOnesValue(ty: Type): Constant {
  if (ty instanceof IntegerType) return getConstantInt(ty, ty.mask);
  // `APFloat::getAllOnesValue`: every bit of the format set.
  if (ty.isFloatingPointTy()) return getConstantFP(ty, (1n << BigInt(ty.fpBits())) - 1n);
  return unported("llir: Constant::getAllOnesValue of a vector (ConstantVector::getSplat)");
}

/** The sign bit of an IEEE format (`APFloat::getZero(Sem, Negative = true)`, `changeSign`); ppc_fp128 is a pair of doubles. */
function signBit(ty: Type): bigint {
  if (ty.typeID === "PPC_FP128") return unported("llir: the sign of a ppc_fp128 constant (APFloat's double-double)");
  return 1n << BigInt(ty.fpBits() - 1);
}

/** `ConstantInt::get(Ty, 1)` (an integer type; a vector would be a splat). */
function intOne(ty: Type): Constant {
  if (!(ty instanceof IntegerType)) return unported("llir: ConstantInt::get of a vector type (a splat)");
  return getConstantInt(ty, 1n);
}

// llvm: llvm/lib/IR/Constants.cpp:2850 ConstantExpr::getBinOpIdentity
export function getBinOpIdentity(opcode: BinaryOps, ty: Type, allowRHSConstant: boolean, nsz = false): Constant | undefined {
  // Commutative opcodes: it does not matter if AllowRHSConstant is set.
  if (isCommutative(opcode)) {
    switch (opcode) {
      case "Add": // X + 0 = X
      case "Or": // X | 0 = X
      case "Xor": // X ^ 0 = X
        return getNullValue(ty);
      case "Mul": // X * 1 = X
        return intOne(ty);
      case "And": // X & -1 = X
        return getAllOnesValue(ty);
      case "FAdd": // X + -0.0 = X
        // `ConstantFP::getZero(Ty, /*Negative=*/!NSZ)`.
        return getConstantFP(ty, nsz ? 0n : signBit(ty));
      case "FMul": // X * 1.0 = X
        return getConstantFPOfDouble(ty, 1.0);
      default:
        throw new Error("llvm: Every commutative binop has an identity constant");
    }
  }
  // Non-commutative opcodes: AllowRHSConstant must be set.
  if (!allowRHSConstant) return undefined;
  switch (opcode) {
    case "Sub": // X - 0 = X
    case "Shl": // X << 0 = X
    case "LShr": // X >>u 0 = X
    case "AShr": // X >> 0 = X
    case "FSub": // X - 0.0 = X
      return getNullValue(ty);
    case "SDiv": // X / 1 = X
    case "UDiv": // X /u 1 = X
      return intOne(ty);
    case "FDiv": // X / 1.0 = X
      return getConstantFPOfDouble(ty, 1.0);
    default:
      return undefined;
  }
}

// llvm: llvm/lib/IR/Constants.cpp:2921 ConstantExpr::getBinOpAbsorber
export function getBinOpAbsorber(opcode: BinaryOps, ty: Type, allowLHSConstant: boolean): Constant | undefined {
  switch (opcode) {
    case "Or": // -1 | X = -1
      return getAllOnesValue(ty);
    case "And": // 0 & X = 0
    case "Mul": // 0 * X = 0
      return getNullValue(ty);
    default:
      break;
  }
  // AllowLHSConstant must be set.
  if (!allowLHSConstant) return undefined;
  switch (opcode) {
    case "Shl": // 0 << X = 0
    case "LShr": // 0 >>l X = 0
    case "AShr": // 0 >>a X = 0
    case "SDiv": // 0 /s X = 0
    case "UDiv": // 0 /u X = 0
    case "URem": // 0 %u X = 0
    case "SRem": // 0 %s X = 0
      return getNullValue(ty);
    default:
      return undefined;
  }
}

// llvm: llvm/lib/IR/Constants.cpp:2545 ConstantExpr::isDesirableBinOp
export const isDesirableBinOp = (opcode: BinaryOps): boolean => opcode === "Add" || opcode === "Sub" || opcode === "Xor";

// llvm: llvm/lib/IR/Constants.cpp:2599 ConstantExpr::isDesirableCastOp
export const isDesirableCastOp = (opcode: CastOpcode): boolean =>
  opcode === "Trunc" || opcode === "PtrToInt" || opcode === "IntToPtr" || opcode === "BitCast" || opcode === "AddrSpaceCast";

// llvm: llvm/lib/IR/Constants.cpp:2503 ConstantExpr::get
export function constantExprGet(opcode: BinaryOps, c1: Constant, c2: Constant, flags = 0): Constant {
  // Only Add, Sub and Xor are supported as constant expressions (`isSupportedBinOp`).
  const fc = constantFoldBinaryInstruction(opcode, c1, c2);
  if (fc !== undefined) return fc;
  if (opcode !== "Add" && opcode !== "Sub" && opcode !== "Xor") throw new Error(`llvm: Binop ${opcode} not supported as constant expression`);
  return internExpr(c1.type, opcode, [c1, c2], flags, undefined);
}

/** `ConstantExpr::getXor`, `getNot` (Constants.cpp:2797). */
const getXor = (c1: Constant, c2: Constant): Constant => constantExprGet("Xor", c1, c2);
const getNot = (c: Constant): Constant => getXor(c, getAllOnesValue(c.type));

// llvm: llvm/lib/IR/Constants.cpp:2369 ConstantExpr::getCast
export function getCast(opc: CastOpcode, c: Constant, ty: Type): Constant {
  switch (opc) {
    case "Trunc":
      return getFoldedCast("Trunc", c, ty);
    case "PtrToInt":
      return getPtrToInt(c, ty);
    case "IntToPtr":
      return getIntToPtr(c, ty);
    case "BitCast":
      return getBitCast(c, ty);
    case "AddrSpaceCast":
      return getFoldedCast("AddrSpaceCast", c, ty);
    default:
      throw new Error(`llvm: Invalid cast opcode ${opc}`);
  }
}

// ---- ConstantFold.cpp --------------------------------------------------------------------------------------------------

/** A ConstantFP's value as a JS number, for the formats whose arithmetic JS does exactly (double, and float exactly held). */
function fpValue(c: ConstantFP): number {
  const dv = new DataView(new ArrayBuffer(8));
  if (c.type.typeID === "Double") {
    dv.setBigUint64(0, c.bits);
    return dv.getFloat64(0);
  }
  if (c.type.typeID === "Float") {
    dv.setUint32(0, Number(c.bits));
    return dv.getFloat32(0);
  }
  return unported(`llir: comparing ${c.type.typeID} constants (APFloat::compare)`);
}

// llvm: llvm/lib/IR/ConstantFold.cpp:295 ConstantFoldSelectInstruction
export function constantFoldSelectInstruction(cond: Constant, v1: Constant, v2: Constant): Constant | undefined {
  // Check for i1 and vector true/false conditions.
  if (cond.isNullValue()) return v2;
  if (cond.isAllOnesValue()) return v1;
  // If the condition is a vector constant, fold the result elementwise.
  if (cond.type instanceof VectorType && !(cond instanceof UndefValue)) return unported("llir: ConstantFoldSelectInstruction of a vector condition");
  if (cond instanceof PoisonValue) return getPoison(v1.type);
  if (cond instanceof UndefValue) {
    if (v1 instanceof UndefValue) return v1;
    return v2;
  }
  if (v1 === v2) return v1;
  if (v1 instanceof PoisonValue) return v2;
  if (v2 instanceof PoisonValue) return v1;
  // If the true or false value is undef, we can fold to the other value as long as the other value isn't poison.
  const notPoison = (c: Constant): boolean => {
    if (c instanceof PoisonValue) return false;
    if (c instanceof ConstantExpr) return false;
    if (c instanceof ConstantInt || c instanceof GlobalVariable || c instanceof ConstantFP || c instanceof ConstantPointerNull || c instanceof IrFunction) return true;
    if (c.type.isVectorTy()) return unported("llir: ConstantFoldSelectInstruction NotPoison of a vector (containsPoisonElement)");
    return false;
  };
  if (v1 instanceof UndefValue && notPoison(v2)) return v2;
  if (v2 instanceof UndefValue && notPoison(v1)) return v1;
  return undefined;
}

// llvm: llvm/lib/IR/ConstantFold.cpp:538 ConstantFoldExtractValueInstruction
export function constantFoldExtractValueInstruction(agg: Constant, idxs: readonly number[]): Constant | undefined {
  // Base case: no indices, so return the entire value.
  if (idxs.length === 0) return agg;
  const c = getAggregateElement(agg, idxs[0]!);
  if (c !== undefined) return constantFoldExtractValueInstruction(c, idxs.slice(1));
  return undefined;
}

// llvm: llvm/lib/IR/ConstantFold.cpp:550 ConstantFoldInsertValueInstruction
export function constantFoldInsertValueInstruction(agg: Constant, val: Constant, idxs: readonly number[]): Constant | undefined {
  // Base case: no indices, so replace the entire value.
  if (idxs.length === 0) return val;
  let numElts: number;
  if (agg.type instanceof StructType) numElts = agg.type.body?.length ?? 0;
  else {
    const n = (agg.type as ArrayType).numElements;
    if (n > 4096n) return unported("llir: ConstantFoldInsertValueInstruction of a large array");
    numElts = Number(n);
  }
  const result: Constant[] = [];
  for (let i = 0; i !== numElts; ++i) {
    let c = getAggregateElement(agg, i);
    if (c === undefined) return undefined;
    if (idxs[0] === i) {
      c = constantFoldInsertValueInstruction(c, val, idxs.slice(1));
      if (c === undefined) return undefined;
    }
    result.push(c);
  }
  if (agg.type instanceof StructType) return getConstantStruct(agg.type, result)!;
  return getConstantArray(agg.type as ArrayType, result)!;
}

// llvm: llvm/lib/IR/ConstantFold.cpp:579 ConstantFoldUnaryInstruction
export function constantFoldUnaryInstruction(opcode: "FNeg", c: Constant): Constant | undefined {
  // Handle scalar UndefValue and scalable vector UndefValue. Fixed-length vectors are always evaluated per element.
  const isScalableVector = c.type instanceof VectorType && c.type.scalable;
  if ((!c.type.isVectorTy() || isScalableVector) && c instanceof UndefValue) return c; // -undef -> undef
  if (c instanceof ConstantFP) {
    // `neg(CV)`: the sign bit flipped.
    if (opcode === "FNeg") return getConstantFP(c.type, c.bits ^ signBit(c.type));
    return undefined;
  }
  if (c.type.isVectorTy()) return unported("llir: ConstantFoldUnaryInstruction of a vector");
  // We don't know how to fold this.
  return undefined;
}

// llvm: llvm/lib/IR/ConstantFold.cpp:637 ConstantFoldBinaryInstruction
export function constantFoldBinaryInstruction(opcode: BinaryOps, c1: Constant, c2: Constant): Constant | undefined {
  // Simplify BinOps with their identity values first. They are no-ops and we can always return the other value, including
  // undef or poison values.
  const identity = getBinOpIdentity(opcode, c1.type, false);
  if (identity !== undefined) {
    if (c1 === identity) return c2;
    if (c2 === identity) return c1;
  } else {
    const rhsIdentity = getBinOpIdentity(opcode, c1.type, true);
    if (rhsIdentity !== undefined && c2 === rhsIdentity) return c1;
  }
  // Binary operations propagate poison.
  if (c1 instanceof PoisonValue || c2 instanceof PoisonValue) return getPoison(c1.type);
  // Handle scalar UndefValue and scalable vector UndefValue. Fixed-length vectors are always evaluated per element.
  const isScalableVector = c1.type instanceof VectorType && c1.type.scalable;
  if ((!c1.type.isVectorTy() || isScalableVector) && (c1 instanceof UndefValue || c2 instanceof UndefValue)) {
    const bothUndef = c1 instanceof UndefValue && c2 instanceof UndefValue;
    const zeroOrUndef = (c: Constant): boolean => c instanceof UndefValue || c.isNullValue();
    switch (opcode) {
      case "Xor":
        // Handle undef ^ undef -> 0 special case. This is a common idiom (misuse).
        if (bothUndef) return getNullValue(c1.type);
        return getUndef(c1.type);
      case "Add":
      case "Sub":
        return getUndef(c1.type);
      case "And":
        if (bothUndef) return c1; // undef & undef -> undef
        return getNullValue(c1.type); // undef & X -> 0
      case "Mul": {
        // undef * undef -> undef
        if (bothUndef) return c1;
        // X * undef -> undef   if X is odd
        const cv = c1 instanceof ConstantInt ? c1 : c2 instanceof ConstantInt ? c2 : undefined;
        if (cv !== undefined && cv.value & 1n) return getUndef(c1.type);
        // X * undef -> 0       otherwise
        return getNullValue(c1.type);
      }
      case "SDiv":
      case "UDiv":
        // X / undef -> poison, X / 0 -> poison
        if (zeroOrUndef(c2)) return getPoison(c2.type);
        // undef / X -> 0       otherwise
        return getNullValue(c1.type);
      case "URem":
      case "SRem":
        // X % undef -> poison, X % 0 -> poison
        if (zeroOrUndef(c2)) return getPoison(c2.type);
        // undef % X -> 0       otherwise
        return getNullValue(c1.type);
      case "Or": // X | undef -> -1
        if (bothUndef) return c1; // undef | undef -> undef
        return getAllOnesValue(c1.type); // undef | X -> ~0
      case "LShr":
        // X >>l undef -> poison
        if (c2 instanceof UndefValue) return getPoison(c2.type);
        // undef >>l X -> 0
        return getNullValue(c1.type);
      case "AShr":
        // X >>a undef -> poison
        if (c2 instanceof UndefValue) return getPoison(c2.type);
        // undef >>a X -> 0
        return getNullValue(c1.type);
      case "Shl":
        // X << undef -> undef
        if (c2 instanceof UndefValue) return getPoison(c2.type);
        // undef << X -> 0
        return getNullValue(c1.type);
      case "FSub":
        // -0.0 - undef --> undef (consistent with "fneg undef")
        if (c1 instanceof ConstantFP && c1.bits === signBit(c1.type) && c2 instanceof UndefValue) return c2;
        return undefFlop(c1, bothUndef);
      case "FAdd":
      case "FMul":
      case "FDiv":
      case "FRem":
        return undefFlop(c1, bothUndef);
    }
  }

  // Handle simplifications when the RHS is a constant int.
  if (c2 instanceof ConstantInt) {
    if (c2 === getBinOpAbsorber(opcode, c2.type, false)) return c2;
    switch (opcode) {
      case "UDiv":
      case "SDiv":
        if (c2.value === 0n) return getPoison(c2.type); // X / 0 == poison
        break;
      case "URem":
      case "SRem":
        if (c2.value === 1n) return getNullValue(c2.type); // X % 1 == 0
        if (c2.value === 0n) return getPoison(c2.type); // X % 0 == poison
        break;
      case "And":
        // If and'ing the address of a global with a constant, fold it (by the global's pointer alignment).
        if (c1 instanceof ConstantExpr && c1.opcode === "PtrToInt" && c1.operands[0] instanceof GlobalValue) {
          return unported("llir: and of ptrtoint(@global) with a constant (GlobalValue::getPointerAlignment needs the data layout)");
        }
        break;
      default:
        break;
    }
  } else if (c1 instanceof ConstantInt) {
    // If C1 is a ConstantInt and C2 is not, swap the operands.
    if (isCommutative(opcode)) return isDesirableBinOp(opcode) ? constantExprGet(opcode, c2, c1) : constantFoldBinaryInstruction(opcode, c2, c1);
  }

  if (c1 instanceof ConstantInt) {
    if (c2 instanceof ConstantInt) {
      const ty = c1.intType;
      const bits = BigInt(ty.bits);
      const v1 = c1.value;
      const v2 = c2.value;
      const minSigned = 1n << (bits - 1n);
      switch (opcode) {
        case "Add":
          return getConstantInt(ty, v1 + v2);
        case "Sub":
          return getConstantInt(ty, v1 - v2);
        case "Mul":
          return getConstantInt(ty, v1 * v2);
        case "UDiv":
          return getConstantInt(ty, v1 / v2);
        case "SDiv":
          if (v2 === ty.mask && v1 === minSigned) return getPoison(ty); // MIN_INT / -1 -> poison
          // APInt::sdiv rounds toward zero, as bigint division does.
          return getConstantInt(ty, c1.sextValue / c2.sextValue);
        case "URem":
          return getConstantInt(ty, v1 % v2);
        case "SRem":
          if (v2 === ty.mask && v1 === minSigned) return getPoison(ty); // MIN_INT % -1 -> poison
          // APInt::srem takes the dividend's sign, as bigint remainder does.
          return getConstantInt(ty, c1.sextValue % c2.sextValue);
        case "And":
          return getConstantInt(ty, v1 & v2);
        case "Or":
          return getConstantInt(ty, v1 | v2);
        case "Xor":
          return getConstantInt(ty, v1 ^ v2);
        case "Shl":
          if (v2 < bits) return getConstantInt(ty, v1 << v2);
          return getPoison(ty); // too big shift is poison
        case "LShr":
          if (v2 < bits) return getConstantInt(ty, v1 >> v2);
          return getPoison(ty); // too big shift is poison
        case "AShr":
          if (v2 < bits) return getConstantInt(ty, c1.sextValue >> v2);
          return getPoison(ty); // too big shift is poison
        default:
          break;
      }
    }
    if (c1 === getBinOpAbsorber(opcode, c1.type, true)) return c1;
  } else if (c1 instanceof ConstantFP) {
    if (c2 instanceof ConstantFP && (opcode === "FAdd" || opcode === "FSub" || opcode === "FMul" || opcode === "FDiv" || opcode === "FRem")) {
      return unported(`llir: ConstantFoldBinaryInstruction ${opcode} of two floating-point constants (APFloat arithmetic)`);
    }
  }

  if (c1.type instanceof VectorType) return unported("llir: ConstantFoldBinaryInstruction of vectors");

  if (c1 instanceof ConstantExpr) {
    // Given ((a + b) + c), if (b + c) folds to something interesting, return (a + (b + c)).
    if (isAssociative(opcode) && c1.opcode === opcode) {
      const t = constantExprGet(opcode, c1.operands[1] as Constant, c2);
      if (!(t instanceof ConstantExpr) || t.opcode !== opcode) return constantExprGet(opcode, c1.operands[0] as Constant, t);
    }
  } else if (c2 instanceof ConstantExpr) {
    // If C2 is a constant expr and C1 isn't, flop them around and fold the other way if possible.
    if (isCommutative(opcode)) return constantFoldBinaryInstruction(opcode, c2, c1);
  }

  // i1 can be simplified in many cases.
  if (c1.type.isIntegerTy(1)) {
    switch (opcode) {
      case "Add":
      case "Sub":
        return getXor(c1, c2);
      case "Shl":
      case "LShr":
      case "AShr":
        // We can assume that C2 == 0.  If it were one the result would be undefined because the shift value is as large as
        // the bitwidth.
        return c1;
      case "SDiv":
      case "UDiv":
        // We can assume that C2 == 1.  If it were zero the result would be undefined through division by zero.
        return c1;
      case "URem":
      case "SRem":
        // We can assume that C2 == 1.  If it were zero the result would be undefined through division by zero.
        return getConstantInt(c1.type as IntegerType, 0n);
      default:
        break;
    }
  }
  // We don't know how to fold this.
  return undefined;
}

/** The `[any flop]` arm of the undef cases (the FSub fallthrough). */
function undefFlop(c1: Constant, bothUndef: boolean): Constant {
  // [any flop] undef, undef -> undef
  if (bothUndef) return c1;
  // [any flop] C, undef -> NaN; [any flop] undef, C -> NaN
  return getNaN(c1.type);
}

/** `ConstantFP::getNaN(Ty)`: the default quiet NaN (`APFloat::getNaN`, payload 0) of a double or float. */
function getNaN(ty: Type): Constant {
  if (ty.typeID === "Double") return getConstantFP(ty, 0x7ff8000000000000n);
  if (ty.typeID === "Float") return getConstantFP(ty, 0x7fc00000n);
  return unported(`llir: ConstantFP::getNaN(${ty.typeID})`);
}

// llvm: llvm/lib/IR/Instructions.cpp:3885 ICmpInst::compare
function icmpCompare(l: ConstantInt, r: ConstantInt, pred: number): boolean {
  const [ul, ur, sl, sr] = [l.value, r.value, l.sextValue, r.sextValue];
  switch (pred) {
    case ICMP.EQ:
      return ul === ur;
    case ICMP.NE:
      return ul !== ur;
    case ICMP.UGT:
      return ul > ur;
    case ICMP.UGE:
      return ul >= ur;
    case ICMP.ULT:
      return ul < ur;
    case ICMP.ULE:
      return ul <= ur;
    case ICMP.SGT:
      return sl > sr;
    case ICMP.SGE:
      return sl >= sr;
    case ICMP.SLT:
      return sl < sr;
    case ICMP.SLE:
      return sl <= sr;
    default:
      throw new Error("llvm: Unexpected non-integer predicate.");
  }
}

// llvm: llvm/lib/IR/Instructions.cpp:3914 FCmpInst::compare
function fcmpCompare(l: ConstantFP, r: ConstantFP, pred: number): boolean {
  // `APFloat::compare`: unordered if either is a NaN; -0 equals +0.
  const a = fpValue(l);
  const b = fpValue(r);
  const R = Number.isNaN(a) || Number.isNaN(b) ? "un" : a < b ? "lt" : a > b ? "gt" : "eq";
  switch (pred) {
    case FCMP_FALSE:
      return false;
    case FCMP_TRUE:
      return true;
    case FCMP.UNO:
      return R === "un";
    case FCMP.ORD:
      return R !== "un";
    case FCMP.UEQ:
      return R === "un" || R === "eq";
    case FCMP.OEQ:
      return R === "eq";
    case FCMP.UNE:
      return R !== "eq";
    case FCMP.ONE:
      return R === "lt" || R === "gt";
    case FCMP.ULT:
      return R === "un" || R === "lt";
    case FCMP.OLT:
      return R === "lt";
    case FCMP.UGT:
      return R === "un" || R === "gt";
    case FCMP.OGT:
      return R === "gt";
    case FCMP.ULE:
      return R !== "gt";
    case FCMP.OLE:
      return R === "lt" || R === "eq";
    case FCMP.UGE:
      return R !== "lt";
    case FCMP.OGE:
      return R === "gt" || R === "eq";
    default:
      throw new Error("llvm: Invalid FCmp Predicate");
  }
}

/** `ICmpInst::BAD_ICMP_PREDICATE`. */
const BAD = -1;

// llvm: llvm/lib/IR/ConstantFold.cpp:1026 evaluateICmpRelation
function evaluateICmpRelation(v1: Constant, v2: Constant): number {
  if (v1 === v2) return ICMP.EQ;
  if (!v1.type.isPointerTy()) return BAD;
  // PORT: the rest relates globals, block addresses and GEPs of globals (`areGlobalsPotentiallyEqual`, which needs
  // `isInterposable`, `Type::isSized`, `NullPointerIsDefined`). The other pointer constants (null, undef, poison) never
  // reach here unequal, so any case left involves those; it stops rather than guess.
  return unported("llir: evaluateICmpRelation of pointer constants (areGlobalsPotentiallyEqual, GEP relations)");
}

// llvm: llvm/lib/IR/ConstantFold.cpp:1135 ConstantFoldCompareInstruction
export function constantFoldCompareInstruction(predicate: number, c1: Constant, c2: Constant): Constant | undefined {
  const resultTy = cmpResultType(c1.type);
  if (predicate === FCMP_FALSE) return getNullValue(resultTy);
  if (predicate === FCMP_TRUE) return getAllOnesValue(resultTy);
  // Handle some degenerate cases first
  if (c1 instanceof PoisonValue || c2 instanceof PoisonValue) return getPoison(resultTy);
  if (c1 instanceof UndefValue || c2 instanceof UndefValue) {
    const isIntegerPredicate = isIntPredicate(predicate);
    // For EQ and NE, we can always pick a value for the undef to make the predicate pass or fail, so we can return undef.
    // Also, if both operands are undef, we can return undef for int comparison.
    if (isEquality(predicate) || (isIntegerPredicate && c1 === c2)) return getUndef(resultTy); // ICmpInst::isEquality
    // Otherwise, for integer compare, pick the same value as the non-undef operand, and fold it to true or false.
    if (isIntegerPredicate) return getConstantInt(resultTy as IntegerType, isTrueWhenEqual(predicate) ? 1n : 0n);
    // Choosing NaN for the undef will always make unordered comparison succeed and ordered comparison fails.
    return getConstantInt(resultTy as IntegerType, isUnordered(predicate) ? 1n : 0n);
  }
  if (c2.isNullValue()) {
    // The caller is expected to commute the operands if the constant expression is C2.
    // C1 >= 0 --> true
    if (predicate === ICMP.UGE) return getAllOnesValue(resultTy);
    // C1 < 0 --> false
    if (predicate === ICMP.ULT) return getNullValue(resultTy);
  }
  // If the comparison is a comparison between two i1's, simplify it.
  if (c1.type.isIntegerTy(1)) {
    switch (predicate) {
      case ICMP.EQ:
        if (c1 instanceof ConstantExpr) return getXor(c1, getNot(c2));
        return getXor(getNot(c1), c2);
      case ICMP.NE:
        return getXor(c1, c2);
      default:
        break;
    }
  }
  if (c1 instanceof ConstantInt && c2 instanceof ConstantInt) {
    return getConstantInt(resultTy as IntegerType, icmpCompare(c1, c2, predicate) ? 1n : 0n);
  } else if (c1 instanceof ConstantFP && c2 instanceof ConstantFP) {
    return getConstantInt(resultTy as IntegerType, fcmpCompare(c1, c2, predicate) ? 1n : 0n);
  }
  if (c1.type.isFloatingPointTy()) {
    if (c1 === c2) {
      // We know that C1 == C2 || isUnordered(C1, C2).
      if (predicate === FCMP.ONE) return getConstantInt(resultTy as IntegerType, 0n);
      else if (predicate === FCMP.UEQ) return getConstantInt(resultTy as IntegerType, 1n);
    }
  } else {
    // Evaluate the relation between the two constants, per the predicate.
    let result = -1; // -1 = unknown, 0 = known false, 1 = known true.
    const rel = evaluateICmpRelation(c1, c2);
    if (rel === ICMP.EQ) result = isTrueWhenEqual(predicate) ? 1 : 0; // We know the constants are equal!
    else if (rel !== BAD) return unported("llir: ConstantFoldCompareInstruction of a known non-equal relation");
    // If we evaluated the result, return it now.
    if (result !== -1) return getConstantInt(resultTy as IntegerType, BigInt(result));
    if ((!(c1 instanceof ConstantExpr) && c2 instanceof ConstantExpr) || (c1.isNullValue() && !c2.isNullValue())) {
      // If C2 is a constant expr and C1 isn't, flip them around and fold the other way if possible. Also, if C1 is null and
      // C2 isn't, flip them around.
      return constantFoldCompareInstruction(getSwappedPredicate(predicate), c2, c1);
    }
  }
  return undefined;
}

// ---- the ConstantFolder (ConstantFolder.h), the folder of IRBuilder<> --------------------------------------------------

/** `FoldBinOp` / `FoldExactBinOp` / `FoldNoWrapBinOp` / `FoldBinOpFMF`: a constant when both operands are constants. */
export function foldBinOp(opc: BinaryOps, lhs: Value, rhs: Value, flags = 0): Constant | undefined {
  if (lhs instanceof Constant && rhs instanceof Constant) {
    if (isDesirableBinOp(opc)) return constantExprGet(opc, lhs, rhs, flags);
    return constantFoldBinaryInstruction(opc, lhs, rhs);
  }
  return undefined;
}

/** `FoldUnOpFMF`. */
export const foldUnOp = (v: Value): Constant | undefined => (v instanceof Constant ? constantFoldUnaryInstruction("FNeg", v) : undefined);

/** `FoldCmp`. */
export const foldCmp = (p: number, lhs: Value, rhs: Value): Constant | undefined =>
  lhs instanceof Constant && rhs instanceof Constant ? constantFoldCompareInstruction(p, lhs, rhs) : undefined;

// llvm: llvm/lib/IR/Type.cpp:61 Type::isScalableTy
function isScalableTy(t: Type, visited = new Set<Type>()): boolean {
  if (t instanceof ArrayType) return isScalableTy(t.elementType, visited);
  if (t instanceof StructType) {
    // `StructType::isScalableTy(Visited)`: any element, once per struct.
    if (visited.has(t)) return false;
    visited.add(t);
    return (t.body ?? []).some((e) => isScalableTy(e, visited));
  }
  return t.typeID === "ScalableVector";
}

/** `FoldGEP`: a constant GEP when the pointer and every index are constants (`ConstantExpr::isSupportedGetElementPtr`). */
export function foldGEP(ty: Type, ptr: Value, idxList: readonly Value[], nw: number): Constant | undefined {
  if (isScalableTy(ty)) return undefined;
  if (ptr instanceof Constant) {
    // Every index must be constant.
    if (idxList.some((v) => !(v instanceof Constant))) return undefined;
    return getGetElementPtr(ty, ptr, idxList as Constant[], nw);
  }
  return undefined;
}

/** `FoldSelect`. */
export function foldSelect(c: Value, t: Value, f: Value): Constant | undefined {
  if (c instanceof Constant && t instanceof Constant && f instanceof Constant) return constantFoldSelectInstruction(c, t, f);
  return undefined;
}

/** `FoldExtractValue`. */
export const foldExtractValue = (agg: Value, idxs: readonly number[]): Constant | undefined => (agg instanceof Constant ? constantFoldExtractValueInstruction(agg, idxs) : undefined);

/** `FoldInsertValue`. */
export const foldInsertValue = (agg: Value, val: Value, idxs: readonly number[]): Constant | undefined =>
  agg instanceof Constant && val instanceof Constant ? constantFoldInsertValueInstruction(agg, val, idxs) : undefined;

/** `FoldExtractElement` / `FoldInsertElement` / `FoldShuffleVector`: `ConstantExpr::getExtractElement` etc. fold vectors. */
export function foldVectorOp(ops: readonly Value[], what: string): Constant | undefined {
  if (ops.every((o) => o instanceof Constant)) return unported(`llir: ${what} of constant operands (ConstantFold.cpp's vector folds)`);
  return undefined;
}

/** `FoldCast`. */
export function foldCast(op: CastOpcode, v: Value, destTy: Type): Constant | undefined {
  if (v instanceof Constant) {
    if (isDesirableCastOp(op)) return getCast(op, v, destTy);
    return constantFoldCastInstruction(op, v, destTy);
  }
  return undefined;
}
