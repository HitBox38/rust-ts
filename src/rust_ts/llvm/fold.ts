// rust-ts: the constant folds the IR builder applies when an instruction's operands are constants (lane llir-core-b): LLVM's
// `ConstantFolder` (llvm/IR/ConstantFolder.h, the folder `IRBuilder<>` uses) and the `ConstantFold.cpp` / `Constants.cpp`
// rules it calls. Each rule carries `// llvm:` and follows the source in order; a case the model cannot compute exactly
// (per-element vector folds, pointer relations that need the data layout, ppc_fp128 arithmetic) stops with `unported`.
// Floating-point values are apfloat.ts's `APFloat` (lane llir-apfloat).
import { unported } from "../../std/panic.ts";
import { APFloat, type CmpResult, neg } from "./apfloat.ts";
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
  getAllOnesValue,
  getBitCast,
  getConstantArray,
  getConstantFPOfDouble,
  getConstantFPOfType,
  getConstantInt,
  getConstantStruct,
  getConstantVector,
  getFoldedCast,
  getGetElementPtr,
  getIntToPtr,
  getNullValue,
  getPoison,
  getPtrToInt,
  getSplat,
  getSplatValue,
  getUndef,
  GlobalValue,
  FUNCTION_INDEX,
  Function,
  GlobalAlias,
  GlobalVariable,
  IntegerType,
  type LinkageTypes,
  MDString,
  type Module,
  PointerType,
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
// llvm: llvm/lib/IR/Instructions.cpp:3766 CmpInst::getSwappedPredicate
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

/** `Constant::getAllOnesValue` lives in ir.ts (FoldBitCast needs it); re-exported for inst.ts. */
export { getAllOnesValue };

// llvm: llvm/lib/IR/Constants.cpp:1167 ConstantFP::getZero
/** `ConstantFP::getZero(Ty, Negative)`: a splat for a vector type. */
function getZeroFP(ty: Type, negative: boolean): Constant {
  return getConstantFPOfType(ty, APFloat.getZero(ty.getScalarType().getFltSemantics(), negative));
}

// llvm: llvm/lib/IR/Constants.cpp:1149 ConstantFP::getNaN
/** `ConstantFP::getNaN(Ty)`: the default quiet NaN (`APFloat::getNaN`, positive, payload 0); a splat for a vector type. */
function getNaN(ty: Type): Constant {
  return getConstantFPOfType(ty, APFloat.getNaN(ty.getScalarType().getFltSemantics()));
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
        return getZeroFP(ty, /*Negative=*/ !nsz);
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

/** `ConstantExpr::getXor` (Constants.cpp:2817), `getNot` (Constants.cpp:2797). */
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

// llvm: llvm/lib/IR/Value.cpp:993 Value::getPointerAlignment
/** `GV->getPointerAlignment(DL)` of a global (lane llir-folder): a function's from the data layout's `F` spec, a variable's own
 *  alignment. A variable without one would need the data layout's preferred or ABI alignment of its type, which the model does
 *  not compute: it stops. Aliases and ifuncs fall through to `Align(1)`. */
function getPointerAlignment(V: GlobalValue, M: Module): number {
  if (V instanceof Function) {
    const { align, type } = M.functionPtrAlign();
    const FunctionPtrAlign = align ?? 1;
    switch (type) {
      case "Independent":
        return FunctionPtrAlign;
      case "MultipleOfFunctionAlign":
        return Math.max(FunctionPtrAlign, V.alignment ?? 1);
    }
  } else if (V instanceof GlobalVariable) {
    const Alignment = V.alignment;
    if (Alignment === undefined) {
      const ObjectType = V.valueType;
      if (isSized(ObjectType)) {
        // If the object is defined in the current Module, we'll be giving it the preferred alignment. Otherwise, we have to
        // assume that it may only have the minimum ABI alignment.
        // PORT: the model computes only the ABI alignment of integers and arrays of them (`DataLayout::getAlignment`,
        // DataLayout.cpp:871): a definition (`isStrongDefinitionForLinker`, `getPreferredAlign`) or another type stops.
        if (!V.isDeclaration()) return unported("llir: Value::getPointerAlignment of a defined global variable without an alignment (DataLayout::getPreferredAlign)");
        let t = ObjectType;
        while (t instanceof ArrayType) t = t.elementType;
        if (!(t instanceof IntegerType)) return unported(`llir: DataLayout::getABITypeAlign of ${t.typeID} (not modelled)`);
        return M.integerABIAlignment(t.bits);
      }
    }
    // `Alignment.valueOrOne()`: also an unsized object's (review llir-folder N4).
    return Alignment ?? 1;
  }
  return 1;
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
    const cv = c.getValueAPF();
    if (opcode === "FNeg") return getConstantFPOfType(c.type, neg(cv));
  } else if (c.type instanceof VectorType) {
    const vty = c.type;
    // Fast path for splatted constants.
    const splat = getSplatValue(c);
    if (splat !== undefined) {
      const elt = constantFoldUnaryInstruction(opcode, splat);
      if (elt !== undefined) return getSplat(vty.numElements, vty.scalable, elt);
    }
    // Fold each element and create a vector constant from those constants.
    if (!vty.scalable) return unported("llir: ConstantFoldUnaryInstruction of a non-splat vector (ConstantExpr::getExtractElement per element)");
  }
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
        if (isNegZeroFP(c1) && c2 instanceof UndefValue) return c2;
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
        // (lane llir-folder; the model has no `ptrtoaddr`.)
        if (c1 instanceof ConstantExpr && c1.opcode === "PtrToInt" && c1.operands[0] instanceof GlobalValue) {
          const GV = c1.operands[0];
          let GVAlign = 1; // defaults to 1
          const TheModule = GV.parent;
          if (TheModule !== undefined) {
            GVAlign = getPointerAlignment(GV, TheModule);
            // If the function alignment is not specified then assume that it is 4. This is dangerous; on x86, the alignment of
            // the pointer corresponds to the alignment of the function, but might be less than 4 if it isn't explicitly
            // specified. However, a fix for this behaviour was reverted because it increased code size (see
            // https://reviews.llvm.org/D55115) FIXME: This code should be deleted once existing targets have appropriate defaults
            if (GV instanceof Function && TheModule.functionPtrAlign().align === undefined) GVAlign = 4;
          } else if (GV instanceof GlobalVariable) {
            GVAlign = GV.alignment ?? 1;
          }
          if (GVAlign > 1) {
            const DstWidth = (c2.type as IntegerType).bits;
            const SrcWidth = Math.min(DstWidth, Math.log2(GVAlign));
            const BitsNotSet = (1n << BigInt(SrcWidth)) - 1n;
            // If checking bits we know are clear, return zero.
            if ((c2.value & BitsNotSet) === c2.value) return getNullValue(c2.type);
          }
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
    if (c2 instanceof ConstantFP) {
      const c1v = c1.getValueAPF();
      const c2v = c2.getValueAPF();
      switch (opcode) {
        case "FAdd":
          return getConstantFPOfType(c1.type, c1v.add(c2v, "rmNearestTiesToEven").value);
        case "FSub":
          return getConstantFPOfType(c1.type, c1v.subtract(c2v, "rmNearestTiesToEven").value);
        case "FMul":
          return getConstantFPOfType(c1.type, c1v.multiply(c2v, "rmNearestTiesToEven").value);
        case "FDiv":
          return getConstantFPOfType(c1.type, c1v.divide(c2v, "rmNearestTiesToEven").value);
        case "FRem":
          return getConstantFPOfType(c1.type, c1v.mod(c2v).value);
        default:
          break;
      }
    }
  }

  if (c1.type instanceof VectorType) {
    const vty = c1.type;
    // Fast path for splatted constants.
    const c2Splat = getSplatValue(c2);
    if (c2Splat !== undefined) {
      if (isIntDivRem(opcode) && c2Splat.isNullValue()) return getPoison(vty);
      const c1Splat = getSplatValue(c1);
      if (c1Splat !== undefined) {
        const res = isDesirableBinOp(opcode) ? constantExprGet(opcode, c1Splat, c2Splat) : constantFoldBinaryInstruction(opcode, c1Splat, c2Splat);
        if (res === undefined) return undefined;
        return getSplat(vty.numElements, vty.scalable, res);
      }
    }
    // Fold each element and create a vector constant from those constants.
    if (!vty.scalable) return unported("llir: ConstantFoldBinaryInstruction of a non-splat vector (ConstantExpr::getExtractElement per element)");
  }

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

/** `match(C, m_NegZeroFP())`: a -0.0 scalar, or a vector splat of -0.0 (`cstfp_pred_ty<is_neg_zero_fp>`). */
function isNegZeroFP(c: Constant): boolean {
  if (c instanceof ConstantFP) {
    const v = c.getValueAPF();
    return v.isZero() && v.isNegative();
  }
  if (c.type instanceof VectorType) {
    const splat = getSplatValue(c);
    if (splat !== undefined) return isNegZeroFP(splat);
    if (!c.type.scalable) return unported("llir: m_NegZeroFP of a non-splat vector (per-element match)");
  }
  return false;
}

/** `Instruction::isIntDivRem`. */
const isIntDivRem = (op: BinaryOps): boolean => op === "UDiv" || op === "SDiv" || op === "URem" || op === "SRem";

/** The `[any flop]` arm of the undef cases (the FSub fallthrough). */
function undefFlop(c1: Constant, bothUndef: boolean): Constant {
  // [any flop] undef, undef -> undef
  if (bothUndef) return c1;
  // [any flop] C, undef -> NaN; [any flop] undef, C -> NaN
  return getNaN(c1.type);
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
function fcmpCompare(lhs: APFloat, rhs: APFloat, pred: number): boolean {
  const c: CmpResult = lhs.compare(rhs);
  const R = c === "cmpUnordered" ? "un" : c === "cmpLessThan" ? "lt" : c === "cmpGreaterThan" ? "gt" : "eq";
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

// ---- relations of pointer constants (lane llir-folder) ----

// llvm: llvm/include/llvm/IR/Type.h:326 isSized
/** `Type::isSized`, with `isSizedDerivedType` (Type.cpp:265) and `StructType::isSized` (Type.cpp:722), for the types the model
 *  has (no X86_AMX, no target extension types). An opaque struct is unsized. A struct with a scalable vector element is sized
 *  only when its elements are all one scalable vector type (`containsHomogeneousScalableVectorTypes`), which the model does not
 *  decide: it stops (review llir-folder N5). `SCDB_IsSized` only caches the answer, and with opaque pointers no struct contains
 *  itself, so `Visited` is not needed. */
function isSized(t: Type): boolean {
  // If it's a primitive, it is always sized.
  if (t instanceof IntegerType || t.isFloatingPointTy() || t instanceof PointerType) return true;
  // Otherwise we have to try harder to decide.
  if (t instanceof ArrayType || t instanceof VectorType) return isSized(t.elementType);
  if (t instanceof StructType) {
    if (t.body === undefined) return false; // isOpaque()
    if (t.body.some((e) => e instanceof VectorType && e.scalable)) return unported("llir: StructType::isSized of a struct with a scalable vector element (containsHomogeneousScalableVectorTypes)");
    return t.body.every((e) => isSized(e));
  }
  // If it is not something that can have a size (e.g. a function or label), it doesn't have a size.
  return false;
}

// llvm: llvm/lib/IR/Type.cpp:180 Type::isEmptyTy
function isEmptyTy(t: Type): boolean {
  // `unsigned NumElements = ATy->getNumElements()`: the count truncated to 32 bits, so `[k * 2^32 x T]` is empty too (review
  // llir-folder N5).
  if (t instanceof ArrayType) return BigInt.asUintN(32, t.numElements) === 0n || isEmptyTy(t.elementType);
  if (t instanceof StructType) {
    // (`getNumElements` of an opaque struct is 0.)
    for (const e of t.body ?? []) if (!isEmptyTy(e)) return false;
    return true;
  }
  return false;
}

/** `GlobalValue::isInterposableLinkage` (GlobalValue.h:431). */
const isInterposableLinkage = (l: LinkageTypes): boolean => l === "WeakAnyLinkage" || l === "LinkOnceAnyLinkage" || l === "CommonLinkage" || l === "ExternalWeakLinkage";

// llvm: llvm/lib/IR/Globals.cpp:178 GlobalValue::isInterposable
function isInterposable(GV: GlobalValue): boolean {
  // `CheckNoIPA` (default true) and `isNoipaFnDef` (Globals.cpp:401): a function definition with `noipa`, which no rustc
  // creator makes.
  if (GV instanceof Function && !GV.isDeclaration() && GV.attributes.get(FUNCTION_INDEX)?.has("kind:NoIPA")) return true;
  if (isInterposableLinkage(GV.linkage)) return true;
  return !GV.isDSOLocal && GV.parent !== undefined && getSemanticInterposition(GV.parent);
}

// llvm: llvm/lib/IR/Module.cpp:704 Module::getSemanticInterposition
function getSemanticInterposition(M: Module): boolean {
  // `getModuleFlag("SemanticInterposition")`: rustc sets no such flag; one there (from `-Z llvm-module-flag`) stops.
  const flags = M.namedMetadata.get("llvm.module.flags") ?? [];
  if (flags.some((n) => { const k = n.ops[1]; return k instanceof MDString && k.str === "SemanticInterposition"; })) return unported("llir: Module::getSemanticInterposition with a SemanticInterposition flag");
  return false;
}

// llvm: llvm/lib/IR/ConstantFold.cpp:996 areGlobalsPotentiallyEqual
function areGlobalsPotentiallyEqual(GV1: GlobalValue, GV2: GlobalValue): number {
  const isGlobalUnsafeForEquality = (GV: GlobalValue): boolean => {
    if (isInterposable(GV) || GV.unnamedAddr === "Global") return true;
    if (GV instanceof GlobalVariable) {
      const Ty = GV.valueType;
      // A global with opaque type might end up being zero sized.
      if (!isSized(Ty)) return true;
      // A global with an empty type might lie at the address of any other global.
      if (isEmptyTy(Ty)) return true;
    }
    return false;
  };
  // Don't try to decide equality of aliases.
  if (!(GV1 instanceof GlobalAlias) && !(GV2 instanceof GlobalAlias)) if (!isGlobalUnsafeForEquality(GV1) && !isGlobalUnsafeForEquality(GV2)) return ICMP.NE;
  return BAD;
}

/** `GEPOperator::hasAllZeroIndices`. */
const hasAllZeroIndices = (ce: ConstantExpr): boolean => ce.operands.slice(1).every((i) => i instanceof ConstantInt && i.value === 0n);

// llvm: llvm/lib/IR/ConstantFold.cpp:1026 evaluateICmpRelation
/** This function determines if there is anything we can decide about the two constants provided. This doesn't need to handle
 *  simple things like integer comparisons, but should instead handle ConstantExprs and GlobalValues. If we can determine that
 *  the two constants have a particular relation to each other, we should return the corresponding ICmp predicate, otherwise
 *  return ICmpInst::BAD_ICMP_PREDICATE. (The model has no `BlockAddress`, so its arms are left out.) */
function evaluateICmpRelation(V1: Constant, V2: Constant): number {
  if (V1 === V2) return ICMP.EQ;
  // The following folds only apply to pointers.
  if (!V1.type.isPointerTy()) return BAD;
  // To simplify this code we canonicalize the relation so that the first operand is always the most "complex" of the two. We
  // consider simple constants (like ConstantPointerNull) to be the simplest, followed by BlockAddress, GlobalValues, and
  // ConstantExpr's (the most complex).
  const GetComplexity = (V: Constant): number => (V instanceof ConstantExpr ? 3 : V instanceof GlobalValue ? 2 : 0);
  if (GetComplexity(V1) < GetComplexity(V2)) {
    const SwappedRelation = evaluateICmpRelation(V2, V1);
    if (SwappedRelation !== BAD) return getSwappedPredicate(SwappedRelation);
    return BAD;
  }
  if (V1 instanceof GlobalValue) {
    const GV = V1;
    // Now we know that the RHS is a GlobalValue, BlockAddress or simple constant.
    if (V2 instanceof GlobalValue) return areGlobalsPotentiallyEqual(GV, V2);
    if (V2 instanceof ConstantPointerNull) {
      // GlobalVals can never be null unless they have external weak linkage. We don't try to evaluate aliases here. NOTE: We
      // should not be doing this constant folding if null pointer is considered valid for the function. But currently there is
      // no way to query it from the Constant type.
      // `NullPointerIsDefined(nullptr, AS)` (Function.cpp:1141): true exactly for a non-zero address space.
      if (GV.linkage !== "ExternalWeakLinkage" && !(GV instanceof GlobalAlias) && GV.addressSpace === 0) return ICMP.UGT;
    }
  } else if (V1 instanceof ConstantExpr) {
    // Ok, the LHS is known to be a constantexpr. The RHS can be any of a constantexpr, a global, block address, or a simple
    // constant.
    const CE1 = V1;
    const CE1Op0 = CE1.operands[0];
    if (CE1.opcode === "GetElementPtr") {
      // Ok, since this is a getelementptr, we know that the constant has a pointer type. Check the various cases.
      if (V2 instanceof ConstantPointerNull) {
        // If we are comparing a GEP to a null pointer, check to see if the base of the GEP equals the null pointer.
        if (CE1Op0 instanceof GlobalValue) {
          // If its not weak linkage, the GVal must have a non-zero address so the result is greater-than
          if (CE1Op0.linkage !== "ExternalWeakLinkage" && (CE1.flags & 1) !== 0) return ICMP.UGT;
        }
      } else if (V2 instanceof GlobalValue) {
        if (CE1Op0 instanceof GlobalValue) {
          if (CE1Op0 !== V2) {
            if (hasAllZeroIndices(CE1)) return areGlobalsPotentiallyEqual(CE1Op0, V2);
            return BAD;
          }
        }
      } else if (V2 instanceof ConstantExpr && V2.opcode === "GetElementPtr") {
        // By far the most common case to handle is when the base pointers are obviously to the same global.
        const CE2Op0 = V2.operands[0];
        if (CE1Op0 instanceof GlobalValue && CE2Op0 instanceof GlobalValue) {
          // Don't know relative ordering, but check for inequality.
          if (CE1Op0 !== CE2Op0) {
            if (hasAllZeroIndices(CE1) && hasAllZeroIndices(V2)) return areGlobalsPotentiallyEqual(CE1Op0, CE2Op0);
            return BAD;
          }
        }
      }
    }
  }
  return BAD;
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
    return getConstantInt(resultTy as IntegerType, fcmpCompare(c1.getValueAPF(), c2.getValueAPF(), predicate) ? 1n : 0n);
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
    const P = predicate;
    switch (evaluateICmpRelation(c1, c2)) {
      case BAD:
        break; // Couldn't determine anything about these constants.
      case ICMP.EQ: // We know the constants are equal!
        // If we know the constants are equal, we can decide the result of this computation precisely.
        result = isTrueWhenEqual(predicate) ? 1 : 0;
        break;
      // lane llir-folder: the other relations.
      case ICMP.ULT:
        if (P === ICMP.ULT || P === ICMP.NE || P === ICMP.ULE) result = 1;
        else if (P === ICMP.UGT || P === ICMP.EQ || P === ICMP.UGE) result = 0;
        break;
      case ICMP.SLT:
        if (P === ICMP.SLT || P === ICMP.NE || P === ICMP.SLE) result = 1;
        else if (P === ICMP.SGT || P === ICMP.EQ || P === ICMP.SGE) result = 0;
        break;
      case ICMP.UGT:
        if (P === ICMP.UGT || P === ICMP.NE || P === ICMP.UGE) result = 1;
        else if (P === ICMP.ULT || P === ICMP.EQ || P === ICMP.ULE) result = 0;
        break;
      case ICMP.SGT:
        if (P === ICMP.SGT || P === ICMP.NE || P === ICMP.SGE) result = 1;
        else if (P === ICMP.SLT || P === ICMP.EQ || P === ICMP.SLE) result = 0;
        break;
      case ICMP.ULE:
        if (P === ICMP.UGT) result = 0;
        if (P === ICMP.ULT || P === ICMP.ULE) result = 1;
        break;
      case ICMP.SLE:
        if (P === ICMP.SGT) result = 0;
        if (P === ICMP.SLT || P === ICMP.SLE) result = 1;
        break;
      case ICMP.UGE:
        if (P === ICMP.ULT) result = 0;
        if (P === ICMP.UGT || P === ICMP.UGE) result = 1;
        break;
      case ICMP.SGE:
        if (P === ICMP.SLT) result = 0;
        if (P === ICMP.SGT || P === ICMP.SGE) result = 1;
        break;
      case ICMP.NE:
        if (P === ICMP.EQ) result = 0;
        if (P === ICMP.NE) result = 1;
        break;
      default:
        throw new Error("llvm: Unknown relational!");
    }
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
// ---- extractelement / insertelement (lane llir-folder) ----

// llvm: llvm/lib/IR/ConstantFold.cpp:373 ConstantFoldExtractElementInstruction
export function constantFoldExtractElementInstruction(Val: Constant, Idx: Constant): Constant | undefined {
  const ValVTy = Val.type as VectorType;
  // extractelt poison, C -> poison
  // extractelt C, undef -> poison
  if (Val instanceof PoisonValue || Idx instanceof UndefValue) return getPoison(ValVTy.elementType);
  // extractelt undef, C -> undef
  if (Val instanceof UndefValue) return getUndef(ValVTy.elementType);
  if (!(Idx instanceof ConstantInt)) return undefined;
  const CIdx = Idx;
  if (!ValVTy.scalable) {
    // ee({w,x,y,z}, wrong_value) -> poison
    if (CIdx.value >= BigInt(ValVTy.numElements)) return getPoison(ValVTy.elementType);
  }
  // ee (gep (ptr, idx0, ...), idx) -> gep (ee (ptr, idx), ee (idx0, idx), ...); the `InsertElement` arm cannot arise, as the
  // model makes no insertelement constant expressions.
  if (Val instanceof ConstantExpr && Val.opcode === "GetElementPtr") return unported("llir: extractelement of a vector GEP constant expression");
  const C = CIdx.value < BigInt(ValVTy.numElements) ? getAggregateElement(Val, Number(CIdx.value)) : undefined;
  if (C !== undefined) return C;
  // Lane < Splat minimum vector width => extractelt Splat(x), Lane -> x
  if (CIdx.value < BigInt(ValVTy.numElements)) {
    const SplatVal = getSplatValue(Val);
    if (SplatVal !== undefined) return SplatVal;
  }
  return undefined;
}

// llvm: llvm/lib/IR/ConstantFold.cpp:437 ConstantFoldInsertElementInstruction
export function constantFoldInsertElementInstruction(Val: Constant, Elt: Constant, Idx: Constant): Constant | undefined {
  if (Idx instanceof UndefValue) return getPoison(Val.type);
  // Inserting null into all zeros is still all zeros.
  // TODO: This is true for undef and poison splats too.
  if (Val.isNullValue() && Elt.isNullValue()) return Val;
  if (!(Idx instanceof ConstantInt)) return undefined;
  const CIdx = Idx;
  // Do not iterate on scalable vector. The num of elements is unknown at compile-time.
  const ValTy = Val.type as VectorType;
  if (ValTy.scalable) return undefined;
  const NumElts = ValTy.numElements;
  if (CIdx.value >= BigInt(NumElts)) return getPoison(Val.type);
  const Result: Constant[] = [];
  const Ty = Val.context.getIntType(32);
  const IdxVal = CIdx.value;
  for (let i = 0; i !== NumElts; ++i) {
    if (BigInt(i) === IdxVal) {
      Result.push(Elt);
      continue;
    }
    const C = getExtractElement(Val, getConstantInt(Ty, BigInt(i)));
    Result.push(C);
  }
  return getConstantVector(Result);
}

// llvm: llvm/lib/IR/Constants.cpp:2720 ConstantExpr::getExtractElement
function getExtractElement(Val: Constant, Idx: Constant): Constant {
  const FC = constantFoldExtractElementInstruction(Val, Idx);
  if (FC !== undefined) return FC; // Fold a few common cases.
  return unported("llir: an extractelement constant expression (not in the model)");
}

// llvm: llvm/lib/IR/Constants.cpp:2742 ConstantExpr::getInsertElement
function getInsertElement(Val: Constant, Elt: Constant, Idx: Constant): Constant {
  const FC = constantFoldInsertElementInstruction(Val, Elt, Idx);
  if (FC !== undefined) return FC; // Fold a few common cases.
  return unported("llir: an insertelement constant expression (not in the model)");
}

// llvm: llvm/include/llvm/IR/ConstantFolder.h:148 FoldExtractElement
export function foldExtractElement(Vec: Value, Idx: Value): Constant | undefined {
  if (Vec instanceof Constant && Idx instanceof Constant) return getExtractElement(Vec, Idx);
  return undefined;
}

// llvm: llvm/include/llvm/IR/ConstantFolder.h:156 FoldInsertElement
export function foldInsertElement(Vec: Value, NewElt: Value, Idx: Value): Constant | undefined {
  if (Vec instanceof Constant && NewElt instanceof Constant && Idx instanceof Constant) return getInsertElement(Vec, NewElt, Idx);
  return undefined;
}

// llvm: llvm/lib/IR/ConstantFold.cpp:479 ConstantFoldShuffleVectorInstruction
export function constantFoldShuffleVectorInstruction(V1: Constant, V2: Constant, Mask: readonly number[]): Constant | undefined {
  const V1VTy = V1.type as VectorType;
  const MaskNumElts = Mask.length;
  const scalable = V1VTy.scalable;
  const EltTy = V1VTy.elementType;
  // Poison shuffle mask -> poison value.
  if (Mask.every((m) => m === -1)) return getPoison(V1.context.getVectorType(EltTy, MaskNumElts, scalable));
  // If the mask is all zeros this is a splat, no need to go through all elements.
  if (Mask.every((m) => m === 0)) {
    const Ty = V1.context.getIntType(32);
    const Elt = getExtractElement(V1, getConstantInt(Ty, 0n));
    // For scalable vectors, make sure this doesn't fold back into a shufflevector.
    if (!scalable || Elt.isNullValue() || Elt instanceof UndefValue) return getSplat(MaskNumElts, scalable, Elt);
  }
  // Do not iterate on scalable vector. The num of elements is unknown at compile-time.
  if (scalable) return undefined;
  const SrcNumElts = V1VTy.numElements;
  // Loop over the shuffle mask, evaluating each element.
  const Result: Constant[] = [];
  for (let i = 0; i !== MaskNumElts; ++i) {
    const Elt = Mask[i]!;
    if (Elt === -1) {
      Result.push(getUndef(EltTy));
      continue;
    }
    let InElt: Constant;
    // `unsigned(Elt)`: the mask holds no other negative value.
    if (Elt >= SrcNumElts * 2) InElt = getUndef(EltTy);
    else if (Elt >= SrcNumElts) InElt = getExtractElement(V2, getConstantInt(V2.context.getIntType(32), BigInt(Elt - SrcNumElts)));
    else InElt = getExtractElement(V1, getConstantInt(V1.context.getIntType(32), BigInt(Elt)));
    Result.push(InElt);
  }
  return getConstantVector(Result);
}

// llvm: llvm/include/llvm/IR/ConstantFolder.h:166 FoldShuffleVector
export function foldShuffleVector(V1: Value, V2: Value, Mask: readonly number[]): Constant | undefined {
  if (V1 instanceof Constant && V2 instanceof Constant) {
    // `ConstantExpr::getShuffleVector` (Constants.cpp:2765): the fold, else a shufflevector constant expression, which the model
    // does not have.
    const FC = constantFoldShuffleVectorInstruction(V1, V2, Mask);
    if (FC !== undefined) return FC; // Fold a few common cases.
    return unported("llir: a shufflevector constant expression (not in the model)");
  }
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
