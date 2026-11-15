// rust-ts: basic blocks, instructions, operand bundles and the IR builder of the model (plan-m7 D5; lane llir-core-b), with the
// printer of function bodies. Not ported rustc code: each rule copied from LLVM carries `// llvm:` (IRBuilder.h, Instructions.cpp,
// BasicBlock.cpp, AsmWriter.cpp, IRBuilder.cpp, Intrinsics.cpp at the pin); build.ts exposes them as ffi.rs's functions.
//
// One `Inst` class stands for LLVM's instruction classes: `opcode` is the printed opcode (`Instruction::getOpcodeName`) and the
// fields of the other classes are optional members. Operands follow LLVM's layout where printing or RAUW reads them:
//   binary ops, cmp: [lhs, rhs]   casts, load, va_arg, extractvalue, fneg: [v]   store: [val, ptr]   alloca: [array size]
//   gep: [ptr, idx...]   br: [dest] or [cond, then, else]   switch: [cond, default, (value, dest)...]   ret: [] or [v]
//   phi: [values...] (blocks in `phiBlocks`)   select: [c, t, f]   landingpad: [clauses...]   resume: [v]
//   call: [args..., bundle inputs..., callee]   invoke: [args..., bundle inputs..., normal, unwind, callee]
//   insertvalue: [agg, v]   extractelement: [v, idx]   insertelement: [v, elt, idx]   shufflevector: [v1, v2] (`mask`)
//   atomicrmw: [ptr, v]   cmpxchg: [ptr, cmp, new]   cleanuppad/catchpad: [parent, args...]   catchswitch: [parent, handlers...]
//   (unwind in `unwindDest`)   cleanupret: [pad] or [pad, unwind]   catchret: [pad, dest]
//
// Alignment: an `align` left undefined is the data layout's default, which the model does not compute for alloca, load and store.
// The printer leaves it out, and the parser supplies the same default (LLParser.cpp's parseAlloc/parseLoad/parseStore use the
// preferred and ABI alignments that IRBuilder's `CreateAlloca`/`CreateLoad`/`CreateStore` use), so the normal form is the same
// (plan-m7 §1b, default alignments). `CreateAtomicCmpXchg`/`CreateAtomicRMW` do compute theirs, the operand's store size (lane
// llir-folder, review cg-builder N1), as the oracle's text shows `, align N` on every atomic.
import { unported } from "../../std/panic.ts";
import { type BinaryOps, getAllOnesValue, getPredicateName, foldBinOp, foldCast, foldCmp, foldExtractElement, foldExtractValue, foldInsertElement, foldShuffleVector, foldGEP, foldInsertValue, foldSelect, foldUnOp, isFPPredicate } from "./fold.ts";
import {
  addAttributesAtIndex,
  type Attribute,
  BasicBlockBase,
  type CastOpcode,
  Constant,
  ConstantAggregateZero,
  ConstantDataSequential,
  ConstantInt,
  type Context,
  Function,
  FunctionType,
  getAggregateElement,
  getConstantInt,
  getNullValue as getNullValueOf,
  getPointerCast,
  getPoison,
  Instruction,
  IntegerType,
  type MDNode,
  type Module,
  ArrayType,
  PointerType,
  StructType,
  type Type,
  UndefValue,
  type Value,
  VectorType,
} from "./ir.ts";
import { type Printer, printCallingConv, printLLVMNameWithoutPrefix, printEscapedString, setBodyPrinter, typeFinderHooks } from "./printer.ts";

// ---- basic blocks ------------------------------------------------------------------------------------------------------

export class BasicBlock extends BasicBlockBase {
  parentFn: Function | undefined;
  readonly insts: Inst[] = [];
  /** `getTrailingDbgRecords()` (llir-di): debug records inserted at `end()` of a block with no instruction after them yet. */
  trailingDbgRecords: DbgRecordHook[] | undefined;
  get parent(): Function | undefined {
    return this.parentFn;
  }

  // llvm: llvm/lib/IR/BasicBlock.cpp:144 BasicBlock::BasicBlock
  /** `BasicBlock::Create(Context, Name, Parent, InsertBefore)`. */
  constructor(context: Context, name: string, newParent: Function | undefined, insertBefore?: BasicBlock) {
    super(context.getLabelType());
    if (newParent !== undefined) this.insertInto(newParent, insertBefore);
    else if (insertBefore !== undefined) throw new Error("llvm: Cannot insert block before another block with no function!");
    this.setName(name);
  }

  // llvm: llvm/lib/IR/BasicBlock.cpp:158 BasicBlock::insertInto
  insertInto(newParent: Function, insertBefore: BasicBlock | undefined): void {
    this.parentFn = newParent;
    const blocks = newParent.blocks;
    if (insertBefore !== undefined) blocks.splice(blocks.indexOf(insertBefore), 0, this);
    else blocks.push(this);
    // `SymbolTableListTraits::addNodeToList`: a named block joins the function's symbol table.
    if (this.hasName() && newParent.symTab !== undefined) newParent.symTab.reinsertValue(this);
  }

  isEntryBlock(): boolean {
    return this.parentFn !== undefined && this.parentFn.blocks[0] === this;
  }

  // llvm: llvm/lib/IR/BasicBlock.cpp:301 BasicBlock::getFirstNonPHIIt
  getFirstNonPHIIt(): number {
    const i = this.insts.findIndex((I) => I.opcode !== "phi");
    return i < 0 ? this.insts.length : i;
  }

  // llvm: llvm/lib/IR/BasicBlock.cpp:357 BasicBlock::getFirstInsertionPt
  /** The index of the first insertion point (`insts.length` is `end()`). */
  getFirstInsertionPt(): number {
    let insertPt = this.getFirstNonPHIIt();
    if (insertPt === this.insts.length) return insertPt;
    if (this.insts[insertPt]!.isEHPad()) ++insertPt;
    return insertPt;
  }

  // llvm: llvm/lib/IR/BasicBlock.cpp:370 BasicBlock::getFirstNonPHIOrDbgOrAlloca
  getFirstNonPHIOrDbgOrAlloca(): number {
    let insertPt = this.getFirstNonPHIIt();
    if (insertPt === this.insts.length) return insertPt;
    if (this.insts[insertPt]!.isEHPad()) ++insertPt;
    if (this.isEntryBlock()) {
      // Skip static allocas (debug intrinsics and pseudo probes are not in the model).
      while (insertPt !== this.insts.length && this.insts[insertPt]!.opcode === "alloca") {
        if (!this.insts[insertPt]!.isStaticAlloca()) break;
        ++insertPt;
      }
    }
    return insertPt;
  }
}

// ---- debug records (llir-di) ---------------------------------------------------------------------------------------------

/** A `DbgRecord` (di_builder.ts's `DbgVariableRecord`), as the body printer sees it: `printDbgRecord`'s text. */
export interface DbgRecordHook {
  printRecord(p: Printer): string;
}

/** `BasicBlock::getMarker(It)`'s records: an instruction's, or the block's trailing ones at `end()` (index `insts.length`). */
function markerAt(bb: BasicBlock, at: number): DbgRecordHook[] | undefined {
  return at === bb.insts.length ? bb.trailingDbgRecords : bb.insts[at]!.dbgRecords;
}

// llvm: llvm/lib/IR/BasicBlock.cpp:995 BasicBlock::insertDbgRecordBefore
/** `insertDbgRecordBefore(DR, Where)`: `createMarker(Where)`, then `insertDbgRecord(DR, InsertAtHead)`. `at` is the index of
 * `Where` (`insts.length` is `end()`, the trailing marker). */
export function insertDbgRecordBefore(bb: BasicBlock, dr: DbgRecordHook, at: number, insertAtHead: boolean): void {
  let m: DbgRecordHook[];
  if (at === bb.insts.length) m = bb.trailingDbgRecords ??= [];
  else m = bb.insts[at]!.dbgRecords ??= [];
  if (insertAtHead) m.unshift(dr);
  else m.push(dr);
}

// ---- operand bundles ---------------------------------------------------------------------------------------------------

/** `OperandBundleDef`: a tag and its inputs (`LLVMCreateOperandBundle`). */
export class OperandBundleDef {
  constructor(
    readonly tag: string,
    readonly inputs: readonly Value[],
  ) {}
}

// ---- instructions ------------------------------------------------------------------------------------------------------

/** `AtomicOrdering`, by ffi.rs's names (the C API's, which `mapFromLLVMOrdering` maps one to one). */
export type Ordering = "NotAtomic" | "Unordered" | "Monotonic" | "Acquire" | "Release" | "AcquireRelease" | "SequentiallyConsistent";
/** `toIRString(AtomicOrdering)` (llvm/Support/AtomicOrdering.h). */
const ORDERING_IR: Readonly<Record<Ordering, string>> = {
  NotAtomic: "not_atomic", Unordered: "unordered", Monotonic: "monotonic", Acquire: "acquire", Release: "release",
  AcquireRelease: "acq_rel", SequentiallyConsistent: "seq_cst",
};

export type TailKind = "None" | "Tail" | "MustTail" | "NoTail";

/** `FastMathFlags` bits (FMF.h): reassoc, nnan, ninf, nsz, arcp, contract, afn. */
export const FMF = { AllowReassoc: 1, NoNaNs: 2, NoInfs: 4, NoSignedZeros: 8, AllowReciprocal: 16, AllowContract: 32, ApproxFunc: 64 } as const;
const FMF_ALL = 127;

const CAST_OPCODES: Readonly<Record<string, CastOpcode>> = {
  trunc: "Trunc", zext: "ZExt", sext: "SExt", fptoui: "FPToUI", fptosi: "FPToSI", uitofp: "UIToFP", sitofp: "SIToFP",
  fptrunc: "FPTrunc", fpext: "FPExt", ptrtoint: "PtrToInt", inttoptr: "IntToPtr", bitcast: "BitCast", addrspacecast: "AddrSpaceCast",
};
const castName = (op: CastOpcode): string => Object.keys(CAST_OPCODES).find((k) => CAST_OPCODES[k] === op)!;

export class Inst extends Instruction {
  parent: BasicBlock | undefined;
  /** `getAllMetadata` other than `!dbg`: [kind, node], replaced by kind. */
  readonly metadata: [number, MDNode][] = [];
  /** `DbgLoc` (llir-di): the `!dbg` attachment, a `DILocation`, kept apart from the other kinds as LLVM keeps it. */
  debugLoc: MDNode | undefined;
  /** `DebugMarker->StoredDbgRecords` (llir-di): the debug records printed before this instruction, in order. */
  dbgRecords: DbgRecordHook[] | undefined;
  // OverflowingBinaryOperator / TruncInst, PossiblyExactOperator, PossiblyDisjointInst, PossiblyNonNegInst, ICmpInst samesign.
  nuw = false;
  nsw = false;
  exact = false;
  disjoint = false;
  nneg = false;
  /** `FastMathFlags` bits (FPMathOperator). */
  fmf = 0;
  /** GEP: `GEPNoWrapFlags` raw bits (InBounds 1, NUSW 2, NUW 4). */
  gepFlags = 0;
  srcElementType: Type | undefined;
  /** alloca. */
  allocatedType: Type | undefined;
  addrSpace = 0;
  /** alloca, load, store, atomicrmw, cmpxchg; undefined is the data layout's default (see the header). */
  align: number | undefined;
  isVolatile = false;
  ordering: Ordering = "NotAtomic";
  failureOrdering: Ordering = "NotAtomic";
  /** `SyncScope::SingleThread` (else `System`). */
  singleThread = false;
  weak = false;
  predicate = 0;
  /** `AtomicRMWInst::getOperationName`. */
  rmwOp = "";
  /** extractvalue / insertvalue. */
  indices: number[] = [];
  readonly phiBlocks: BasicBlock[] = [];
  cleanup = false;
  /** shufflevector (`PoisonMaskElem` is -1). */
  mask: number[] = [];
  // call / invoke
  fnType: FunctionType | undefined;
  numArgs = 0;
  callingConv = 0;
  tailKind: TailKind = "None";
  /** Call-site `AttributeList`: index -> attribute key -> attribute (as `Function.attributes`). */
  readonly attributes = new Map<number, Map<string, Attribute>>();
  bundles: { tag: string; count: number }[] = [];
  /** catchswitch. */
  unwindDest: BasicBlock | undefined;

  constructor(
    readonly opcode: string,
    type: Type,
    operands: readonly Value[],
  ) {
    super(type, operands);
  }
  parentFunction(): Function | undefined {
    return this.parent?.parentFn;
  }
  /** `PHINode::addIncoming`'s value, `SwitchInst::addCase`'s pair, `LandingPadInst::addClause`, `CatchSwitchInst::addHandler`. */
  addOperand(v: Value): void {
    this.pushOperand(v);
  }
  isTerminator(): boolean {
    return ["ret", "br", "switch", "indirectbr", "invoke", "resume", "unreachable", "cleanupret", "catchret", "catchswitch", "callbr"].includes(this.opcode);
  }
  /** `Instruction::isEHPad`. */
  isEHPad(): boolean {
    return this.opcode === "landingpad" || this.opcode === "cleanuppad" || this.opcode === "catchpad" || this.opcode === "catchswitch";
  }
  isCallBase(): boolean {
    return this.opcode === "call" || this.opcode === "invoke" || this.opcode === "callbr";
  }
  get callee(): Value {
    return this.operands[this.operands.length - 1]!;
  }

  // llvm: llvm/lib/IR/Instructions.cpp:1317 AllocaInst::isArrayAllocation
  isArrayAllocation(): boolean {
    const n = this.operands[0];
    if (n instanceof ConstantInt) return n.value !== 1n;
    return true;
  }

  // llvm: llvm/lib/IR/Instructions.cpp:1326 AllocaInst::isStaticAlloca
  isStaticAlloca(): boolean {
    // Must be constant size.
    if (!(this.operands[0] instanceof ConstantInt)) return false;
    // Must be in the entry block.
    return this.parent !== undefined && this.parent.isEntryBlock();
    // PORT: `isUsedWithInAlloca()` is never set by the model (no `inalloca` allocas).
  }

  /** `stripPointerCastsAndOffsets<PSK_ZeroIndices>` (Value.cpp:641) through this instruction. */
  stripPointerCastStep(): Value | undefined {
    if (this.opcode === "getelementptr") {
      // `hasAllZeroIndices`.
      if (!this.operands.slice(1).every((i) => i instanceof Constant && i.isNullValue())) return undefined;
      return this.operands[0];
    }
    if (this.opcode === "bitcast") {
      const nv = this.operands[0]!;
      return nv.type.isPointerTy() ? nv : undefined;
    }
    if (this.opcode === "addrspacecast") return this.operands[0];
    // PORT: a call's `getReturnedArgOperand` needs a `returned` attribute, which no creator of the model makes.
    return undefined;
  }

  // llvm: llvm/lib/IR/Metadata.cpp:1751 Instruction::setMetadata
  setMetadata(kindID: number, node: MDNode | undefined): void {
    if (node === undefined && this.metadata.length === 0 && this.debugLoc === undefined) return;
    // Handle 'dbg' as a special case since it is not stored in the hash table.
    if (kindID === 0) {
      this.debugLoc = node;
      return;
    }
    // `Value::setMetadata`: erase the kind, then add the node.
    const i = this.metadata.findIndex(([k]) => k === kindID);
    if (node === undefined) {
      if (i >= 0) this.metadata.splice(i, 1);
      return;
    }
    if (i >= 0) this.metadata[i] = [kindID, node];
    else this.metadata.push([kindID, node]);
  }
  getMetadata(kindID: number): MDNode | undefined {
    if (kindID === 0) return this.debugLoc;
    return this.metadata.find(([k]) => k === kindID)?.[1];
  }

  /** Removes the instruction from its block and drops its operands (`eraseFromParent`). */
  eraseFromParent(): void {
    const bb = this.parent;
    if (bb !== undefined) {
      this.handleMarkerRemoval(bb);
      bb.insts.splice(bb.insts.indexOf(this), 1);
      const st = bb.parentFn?.symTab;
      if (this.hasName() && st !== undefined) st.removeValueName(this.name);
    }
    this.parent = undefined;
    this.dropAllReferences();
  }

  // llvm: llvm/lib/IR/Instruction.cpp:105 Instruction::handleMarkerRemoval
  /** `handleMarkerRemoval` / `DbgMarker::removeMarker` (DebugProgramInstruction.cpp:646), llir-di: an erased instruction's debug
   * records go to the head of the next instruction's, or become the block's trailing records. */
  handleMarkerRemoval(bb: BasicBlock): void {
    const recs = this.dbgRecords;
    this.dbgRecords = undefined;
    if (recs === undefined || recs.length === 0) return;
    const next = bb.insts.indexOf(this) + 1;
    const nextMarker = markerAt(bb, next);
    if (nextMarker !== undefined) nextMarker.unshift(...recs);
    else if (next === bb.insts.length) bb.trailingDbgRecords = recs;
    else bb.insts[next]!.dbgRecords = recs;
  }
}

// llvm: llvm/lib/IR/Instructions.cpp:2608 ExtractValueInst::getIndexedType
export function getIndexedType(agg: Type, idxs: readonly number[]): Type | undefined {
  for (const index of idxs) {
    // We can't use CompositeType::indexValid(Index) here.
    if (agg instanceof ArrayType) {
      if (BigInt(index) >= agg.numElements) return undefined;
      agg = agg.elementType;
    } else if (agg instanceof StructType) {
      if (index >= (agg.body?.length ?? 0)) return undefined;
      agg = agg.body![index]!;
    } else {
      // Not a valid type to index into.
      return undefined;
    }
  }
  return agg;
}

// llvm: llvm/lib/IR/Instructions.cpp:1902 ShuffleVectorInst::getShuffleMask
export function getShuffleMask(mask: Constant): number[] {
  const vt = mask.type as VectorType;
  if (mask instanceof ConstantAggregateZero || mask instanceof UndefValue) return new Array<number>(vt.numElements).fill(mask instanceof UndefValue ? -1 : 0);
  if (vt.scalable) throw new Error("llvm: Scalable vector shuffle mask must be undef or zeroinitializer");
  if (mask instanceof ConstantDataSequential) return mask.elements.map((e) => Number((e as ConstantInt).sextValue));
  const out: number[] = [];
  for (let i = 0; i !== vt.numElements; ++i) {
    const c = getAggregateElement(mask, i)!;
    out.push(c instanceof UndefValue ? -1 : Number((c as ConstantInt).sextValue));
  }
  return out;
}

// ---- the IR builder ----------------------------------------------------------------------------------------------------

// llvm: llvm/lib/IR/Instruction.cpp:150 Instruction::insertBefore
/** The debug-record half of `Instruction::insertBefore(BB, InsertPos)` (llir-di), after `I` is placed at index `at`: without the
 * head bit, the records at the position (the next instruction's, or the block's trailing ones) move onto `I`
 * (`adoptDbgRecords`, Instruction.cpp); a terminator then takes any trailing records left (`flushTerminatorDbgRecords`). */
function insertedDbgRecords(bb: BasicBlock, I: Inst, at: number, headBit: boolean): void {
  if (!headBit) {
    const srcAt = at + 1;
    const src = markerAt(bb, srcAt);
    if (src !== undefined && src.length !== 0) {
      // `adoptDbgRecords(BB, It, false)`: `I` is new, so it takes the records as they are.
      I.dbgRecords = src;
      if (srcAt === bb.insts.length) bb.trailingDbgRecords = undefined;
      else bb.insts[srcAt]!.dbgRecords = undefined;
    }
  }
  if (I.isTerminator()) flushTerminatorDbgRecords(bb);
}

// llvm: llvm/lib/IR/BasicBlock.cpp:659 BasicBlock::flushTerminatorDbgRecords
function flushTerminatorDbgRecords(bb: BasicBlock): void {
  // If there's no terminator, there's nothing to do.
  const term = bb.insts[bb.insts.length - 1];
  if (term === undefined || !term.isTerminator()) return;
  // Are there any dangling DbgRecords?
  const trailing = bb.trailingDbgRecords;
  if (trailing === undefined) return;
  // Transfer DbgRecords from the trailing position onto the terminator.
  (term.dbgRecords ??= []).push(...trailing);
  bb.trailingDbgRecords = undefined;
}

/** `IRBuilder<>` (ConstantFolder, IRBuilderDefaultInserter): an insertion block and point (`insertBefore`; undefined is
 * `BB->end()`). No debug location and no default FP math tag or fast-math flags (rustc sets none on a builder). */
export class IRBuilder {
  block: BasicBlock | undefined;
  insertBefore: Inst | undefined;
  /** The insertion iterator's head bit (llir-di): set, a new instruction goes before the debug records at the point. */
  headBit = false;
  /** `StoredDL` (llir-di): the `DILocation` given to each instruction the builder inserts, or undefined. */
  storedDL: MDNode | undefined;
  constructor(readonly context: Context) {}

  // llvm: llvm/include/llvm/IR/IRBuilder.h:197 SetInsertPoint
  /** `SetInsertPoint(BB, IP)`, IP as an index into the block (`insts.length` is `end()`) with its head bit. A point that is an
   * instruction takes that instruction's debug location (`SetCurrentDebugLocation(IP->getStableDebugLoc())`). */
  setInsertPoint(bb: BasicBlock, ip: number, headBit = false): void {
    this.block = bb;
    this.insertBefore = bb.insts[ip];
    this.headBit = ip === bb.insts.length ? false : headBit;
    if (ip !== bb.insts.length) this.storedDL = bb.insts[ip]!.debugLoc;
  }

  // llvm: llvm/include/llvm/IR/IRBuilder.h:146 Insert
  /** `Insert(I, Name)`: `IRBuilderDefaultInserter::InsertHelper` places it at the insertion point and names it. */
  insert<T extends Value>(v: T, name: string): T {
    if (!(v instanceof Inst)) return v; // No-op overload to handle constants.
    if (this.block !== undefined) {
      // `Instruction::insertInto(BB, InsertPt)`.
      v.parent = this.block;
      const at = this.insertBefore === undefined ? this.block.insts.length : this.block.insts.indexOf(this.insertBefore);
      this.block.insts.splice(at, 0, v);
      insertedDbgRecords(this.block, v, at, this.headBit);
    }
    v.setName(name);
    // `SetInstDebugLocation(I)`: `I->setDebugLoc(StoredDL.orElse(I->getDebugLoc()))` (llir-di).
    if (this.storedDL !== undefined) v.debugLoc = this.storedDL;
    return v;
  }

  // ---- terminators ----

  createRetVoid(): Inst {
    return this.insert(new Inst("ret", this.context.getVoidType(), []), "");
  }
  createRet(v: Value): Inst {
    return this.insert(new Inst("ret", this.context.getVoidType(), [v]), "");
  }
  createBr(dest: BasicBlock): Inst {
    return this.insert(new Inst("br", this.context.getVoidType(), [dest]), "");
  }
  createCondBr(cond: Value, t: BasicBlock, f: BasicBlock): Inst {
    // `addBranchMetadata` with no weights or unpredictable node adds nothing.
    return this.insert(new Inst("br", this.context.getVoidType(), [cond, t, f]), "");
  }
  createSwitch(v: Value, dest: BasicBlock): Inst {
    return this.insert(new Inst("switch", this.context.getVoidType(), [v, dest]), "");
  }
  createResume(exn: Value): Inst {
    return this.insert(new Inst("resume", this.context.getVoidType(), [exn]), "");
  }
  createUnreachable(): Inst {
    return this.insert(new Inst("unreachable", this.context.getVoidType(), []), "");
  }

  // ---- binary and unary operators ----

  // llvm: llvm/include/llvm/IR/IRBuilder.h:1422 CreateAdd
  /** `CreateAdd`/`CreateSub`/`CreateMul`/`CreateShl` (`FoldNoWrapBinOp`, `CreateInsertNUWNSWBinOp`), `CreateUDiv`/`SDiv`/
   * `LShr`/`AShr` (`FoldExactBinOp`), the others (`FoldBinOp`), and the FP ones (`FoldBinOpFMF`, `setFPAttrs` with no FP math tag
   * and the builder's empty flags). The C API's `LLVMBuildOr` is `CreateOr` without `IsDisjoint`; `disjoint` is set later by
   * `LLVMSetIsDisjoint` (review llir-core-b N4). */
  createBinOp(op: BinaryOps, lhs: Value, rhs: Value, name: string, f: { nuw?: boolean; nsw?: boolean; exact?: boolean } = {}): Value {
    const flags = op === "Add" || op === "Sub" || op === "Mul" || op === "Shl" ? (f.nuw ? 1 : 0) | (f.nsw ? 2 : 0) : f.exact ? 1 : 0;
    const v = foldBinOp(op, lhs, rhs, flags);
    if (v !== undefined) return v;
    const bo = this.insert(new Inst(op.toLowerCase(), lhs.type, [lhs, rhs]), name);
    if (f.nuw) bo.nuw = true;
    if (f.nsw) bo.nsw = true;
    if (f.exact) bo.exact = true;
    return bo;
  }

  // llvm: llvm/include/llvm/IR/IRBuilder.h:1830 CreateNeg
  createNeg(v: Value, name: string, hasNSW = false): Value {
    return this.createBinOp("Sub", getNullValueOf(v.type), v, name, { nsw: hasNSW });
  }

  // llvm: llvm/include/llvm/IR/IRBuilder.h:1839 CreateFNeg
  createFNeg(v: Value, name: string): Value {
    const r = foldUnOp(v);
    if (r !== undefined) return r;
    return this.insert(new Inst("fneg", v.type, [v]), name);
  }

  // llvm: llvm/include/llvm/IR/IRBuilder.h:1854 CreateNot
  createNot(v: Value, name: string): Value {
    return this.createBinOp("Xor", v, getAllOnesValue(v.type), name);
  }

  // ---- memory ----

  // llvm: llvm/include/llvm/IR/IRBuilder.h:1886 CreateAlloca
  createAlloca(ty: Type, name: string): Inst {
    if (this.block === undefined) throw new Error("llvm: CreateAlloca with no insertion block (BB->getDataLayout())");
    // `DL.getAllocaAddrSpace()` and `DL.getPrefTypeAlign(Ty)`: the alloca address space of the D3 targets is 0 (no `A` in their
    // layouts), and the alignment is left to the parser's same default (header).
    const m = this.block.parentFn?.parent;
    if (m !== undefined && m.dataLayout.split("-").some((s) => s.startsWith("A"))) return unported("llir: data layout with an alloca address space (`A`)");
    // `AllocaInst(Ty, AddrSpace, ArraySize = nullptr, ...)`: `getAISize` makes the array size `i32 1`.
    const a = new Inst("alloca", this.context.getPointerType(0), [getConstantInt(this.context.getIntType(32), 1n)]);
    a.allocatedType = ty;
    return this.insert(a, name);
  }

  // llvm: llvm/include/llvm/IR/IRBuilder.h:1944 CreateAlignedLoad
  createLoad(ty: Type, ptr: Value, name: string): Inst {
    const l = new Inst("load", ty, [ptr]);
    return this.insert(l, name);
  }

  // llvm: llvm/include/llvm/IR/IRBuilder.h:1953 CreateAlignedStore
  createStore(val: Value, ptr: Value): Inst {
    return this.insert(new Inst("store", this.context.getVoidType(), [val, ptr]), "");
  }

  // llvm: llvm/include/llvm/IR/IRBuilder.h:1961 CreateFence
  createFence(ordering: Ordering, singleThread: boolean, name: string): Inst {
    const f = new Inst("fence", this.context.getVoidType(), []);
    f.ordering = ordering;
    f.singleThread = singleThread;
    return this.insert(f, name);
  }

  // llvm: llvm/include/llvm/IR/IRBuilder.h:1981 CreateAtomicRMW
  createAtomicRMW(op: string, ptr: Value, val: Value, ordering: Ordering, singleThread: boolean): Inst {
    // `if (!Align) Align = llvm::Align(DL.getTypeStoreSize(Val->getType()))`, with `DL` the block's (lane llir-folder): the C
    // API passes `MaybeAlign()` (Core.cpp:4530).
    const align = defaultAtomicAlign(this.block, val.type);
    const r = new Inst("atomicrmw", val.type, [ptr, val]);
    r.align = align;
    r.rmwOp = op;
    r.ordering = ordering;
    r.singleThread = singleThread;
    return this.insert(r, "");
  }

  // llvm: llvm/include/llvm/IR/IRBuilder.h:1968 CreateAtomicCmpXchg
  /** The result is `{ <type of New>, i1 }`. */
  createAtomicCmpXchg(ptr: Value, cmp: Value, nv: Value, success: Ordering, failure: Ordering, singleThread: boolean): Inst {
    // `if (!Align) Align = llvm::Align(DL.getTypeStoreSize(New->getType()))` (lane llir-folder; Core.cpp:4552 passes
    // `MaybeAlign()`).
    const align = defaultAtomicAlign(this.block, nv.type);
    const ty = this.context.getLiteralStructType([cmp.type, this.context.getIntType(1)], false);
    const c = new Inst("cmpxchg", ty, [ptr, cmp, nv]);
    c.align = align;
    c.ordering = success;
    c.failureOrdering = failure;
    c.singleThread = singleThread;
    return this.insert(c, "");
  }

  // llvm: llvm/include/llvm/IR/IRBuilder.h:2011 CreateGEP
  createGEP(ty: Type, ptr: Value, idxList: readonly Value[], name: string, nw: number): Value {
    const v = foldGEP(ty, ptr, idxList, nw);
    if (v !== undefined) return v;
    const g = new Inst("getelementptr", getGEPReturnType(ptr, idxList), [ptr, ...idxList]);
    g.srcElementType = ty;
    g.gepFlags = nw;
    return this.insert(g, name);
  }

  // ---- casts ----

  // llvm: llvm/include/llvm/IR/IRBuilder.h:2277 CreateCast
  /** `CreateCast`, and `CreateTrunc`/`CreateZExt` (the same with no flags). */
  createCast(op: CastOpcode, v: Value, destTy: Type, name: string): Value {
    if (v.type === destTy) return v;
    const folded = foldCast(op, v, destTy);
    if (folded !== undefined) return folded;
    // `CastInst::Create`; FP casts get the builder's (empty) fast-math flags.
    return this.insert(new Inst(castName(op), destTy, [v]), name);
  }

  // llvm: llvm/include/llvm/IR/IRBuilder.h:2290 CreatePointerCast
  createPointerCast(v: Value, destTy: Type, name: string): Value {
    if (v.type === destTy) return v;
    if (v instanceof Constant) return this.insert(getPointerCast(v, destTy), name);
    // `CastInst::CreatePointerCast` (Instructions.cpp:3155): ptrtoint to an integer, else `CreatePointerBitCastOrAddrSpaceCast`.
    if (destTy.getScalarType() instanceof IntegerType) return this.insert(new Inst("ptrtoint", destTy, [v]), name);
    const differentAS = (v.type.getScalarType() as PointerType).addressSpace !== (destTy.getScalarType() as PointerType).addressSpace;
    return this.insert(new Inst(differentAS ? "addrspacecast" : "bitcast", destTy, [v]), name);
  }

  // llvm: llvm/include/llvm/IR/IRBuilder.h:2316 CreateIntCast
  createIntCast(v: Value, destTy: Type, isSigned: boolean, name: string): Value {
    // At this pin `CreateIntCast` picks by scalar width itself (IRBuilder.h:2316-2321), not through `CastInst::getCastOpcode`;
    // equal widths give a same-type `CreateCast`, which returns `V` (review llir-core-b N6).
    const op: CastOpcode = scalarSizeInBits(v.type) > scalarSizeInBits(destTy) ? "Trunc" : isSigned ? "SExt" : "ZExt";
    return this.createCast(op, v, destTy, name);
  }

  // ---- comparisons and the rest ----

  // llvm: llvm/include/llvm/IR/IRBuilder.h:2485 CreateICmp
  createICmp(p: number, lhs: Value, rhs: Value, name: string): Value {
    const v = foldCmp(p, lhs, rhs);
    if (v !== undefined) return v;
    return this.insert(cmpInst("icmp", p, lhs, rhs), name);
  }

  // llvm: llvm/lib/IR/IRBuilder.cpp:1080 IRBuilderBase::CreateFCmpHelper
  createFCmp(p: number, lhs: Value, rhs: Value, name: string): Value {
    const v = foldCmp(p, lhs, rhs);
    if (v !== undefined) return v;
    return this.insert(cmpInst("fcmp", p, lhs, rhs), name);
  }

  // llvm: llvm/include/llvm/IR/IRBuilder.h:2540 CreatePHI
  createPHI(ty: Type, name: string): Inst {
    return this.insert(new Inst("phi", ty, []), name);
  }

  // llvm: llvm/lib/IR/IRBuilder.cpp:1151 IRBuilderBase::CreateSelectFMF
  createSelect(c: Value, t: Value, f: Value, name: string): Value {
    const v = foldSelect(c, t, f);
    if (v !== undefined) return v;
    return this.insert(new Inst("select", t.type, [c, t, f]), name);
  }

  // llvm: llvm/include/llvm/IR/IRBuilder.h:2709 CreateExtractValue
  createExtractValue(agg: Value, idxs: readonly number[], name: string): Value {
    const v = foldExtractValue(agg, idxs);
    if (v !== undefined) return v;
    const ty = getIndexedType(agg.type, idxs);
    if (ty === undefined) throw new Error("llvm: Invalid ExtractValueInst operands!");
    const e = new Inst("extractvalue", ty, [agg]);
    e.indices = [...idxs];
    return this.insert(e, name);
  }

  // llvm: llvm/include/llvm/IR/IRBuilder.h:2716 CreateInsertValue
  createInsertValue(agg: Value, val: Value, idxs: readonly number[], name: string): Value {
    const v = foldInsertValue(agg, val, idxs);
    if (v !== undefined) return v;
    const i = new Inst("insertvalue", agg.type, [agg, val]);
    i.indices = [...idxs];
    return this.insert(i, name);
  }

  // llvm: llvm/include/llvm/IR/IRBuilder.h:2650 CreateExtractElement
  createExtractElement(vec: Value, idx: Value, name: string): Value {
    const v = foldExtractElement(vec, idx);
    if (v !== undefined) return v;
    return this.insert(new Inst("extractelement", (vec.type as VectorType).elementType, [vec, idx]), name);
  }

  // llvm: llvm/include/llvm/IR/IRBuilder.h:2672 CreateInsertElement
  createInsertElement(vec: Value, elt: Value, idx: Value, name: string): Value {
    const v = foldInsertElement(vec, elt, idx);
    if (v !== undefined) return v;
    return this.insert(new Inst("insertelement", vec.type, [vec, elt, idx]), name);
  }

  // llvm: llvm/include/llvm/IR/IRBuilder.h:2684 CreateShuffleVector
  createShuffleVector(v1: Value, v2: Value, maskV: Value, name: string): Value {
    const mask = getShuffleMask(maskV as Constant);
    const v = foldShuffleVector(v1, v2, mask);
    if (v !== undefined) return v;
    const vt = v1.type as VectorType;
    const s = new Inst("shufflevector", this.context.getVectorType(vt.elementType, mask.length, vt.scalable), [v1, v2]);
    s.mask = mask;
    return this.insert(s, name);
  }

  // llvm: llvm/include/llvm/IR/IRBuilder.h:2646 CreateVAArg
  createVAArg(list: Value, ty: Type, name: string): Inst {
    return this.insert(new Inst("va_arg", ty, [list]), name);
  }

  // llvm: llvm/include/llvm/IR/IRBuilder.h:2723 CreateLandingPad
  createLandingPad(ty: Type, name: string): Inst {
    return this.insert(new Inst("landingpad", ty, []), name);
  }

  /** `CreateCleanupPad` / `CreateCatchPad` (`FuncletPadInst`): a token. */
  createFuncletPad(opcode: "cleanuppad" | "catchpad", parentPad: Value, args: readonly Value[], name: string): Inst {
    return this.insert(new Inst(opcode, this.context.getTokenType(), [parentPad, ...args]), name);
  }
  createCatchSwitch(parentPad: Value, unwindBB: BasicBlock | undefined, name: string): Inst {
    const c = new Inst("catchswitch", this.context.getTokenType(), [parentPad]);
    c.unwindDest = unwindBB;
    return this.insert(c, name);
  }
  createCleanupRet(pad: Inst, unwindBB: BasicBlock | undefined): Inst {
    return this.insert(new Inst("cleanupret", this.context.getVoidType(), unwindBB === undefined ? [pad] : [pad, unwindBB]), "");
  }
  createCatchRet(pad: Inst, bb: BasicBlock): Inst {
    return this.insert(new Inst("catchret", this.context.getVoidType(), [pad, bb]), "");
  }

  // llvm: llvm/include/llvm/IR/IRBuilder.h:2572 CreateCall
  /** `CreateCall(FTy, Callee, Args, OpBundles, Name)`: `CallInst::Create`, then the builder's (empty) fast-math flags. */
  createCall(fty: FunctionType, callee: Value, args: readonly Value[], bundles: readonly OperandBundleDef[], name: string): Inst {
    const c = new Inst("call", fty.returnType, [...args, ...bundles.flatMap((b) => b.inputs), callee]);
    setCallBase(c, fty, args.length, bundles);
    return this.insert(c, name);
  }

  // llvm: llvm/include/llvm/IR/IRBuilder.h:1254 CreateInvoke
  createInvoke(fty: FunctionType, callee: Value, normal: BasicBlock, unwind: BasicBlock, args: readonly Value[], bundles: readonly OperandBundleDef[], name: string): Inst {
    const ii = new Inst("invoke", fty.returnType, [...args, ...bundles.flatMap((b) => b.inputs), normal, unwind, callee]);
    setCallBase(ii, fty, args.length, bundles);
    return this.insert(ii, name);
  }

  // ---- intrinsics (IRBuilder.cpp) ----

  // llvm: llvm/lib/IR/IRBuilder.cpp:296 IRBuilderBase::CreateMemTransferInst
  createMemTransferInst(id: "memcpy" | "memmove", dst: Value, dstAlign: number, src: Value, srcAlign: number, size: Value, isVolatile: boolean): Inst {
    const ops = [dst, src, size, getConstantInt(this.context.getIntType(1), isVolatile ? 1n : 0n)];
    const mci = this.createIntrinsicWithoutFolding(id, [dst.type, src.type, size.type], ops);
    // `MaybeAlign(0)` is no alignment: `setDestAlignment` / `setSourceAlignment` add `align` to the call's parameters 0 and 1.
    if (dstAlign !== 0) setParamAlign(mci, 0, dstAlign);
    if (srcAlign !== 0) setParamAlign(mci, 1, srcAlign);
    // `setAAMetadata(AAInfo)` of an empty AAMDNodes sets nothing.
    return mci;
  }

  // llvm: llvm/lib/IR/IRBuilder.cpp:251 IRBuilderBase::CreateMemSet
  createMemSet(ptr: Value, val: Value, size: Value, align: number, isVolatile: boolean): Inst {
    const ops = [ptr, val, size, getConstantInt(this.context.getIntType(1), isVolatile ? 1n : 0n)];
    const ci = this.createIntrinsicWithoutFolding("memset", [ptr.type, size.type], ops);
    if (align !== 0) setParamAlign(ci, 0, align);
    return ci;
  }

  // llvm: llvm/lib/IR/IRBuilder.cpp:944 IRBuilderBase::CreateIntrinsicWithoutFolding
  createIntrinsicWithoutFolding(id: "memcpy" | "memmove" | "memset", overloadTypes: readonly Type[], args: readonly Value[]): Inst {
    const m = this.block?.parentFn?.parent;
    if (m === undefined) throw new Error("llvm: an intrinsic call with no module (BB->getModule())");
    const fn = getOrInsertMemIntrinsic(m, id, overloadTypes);
    // `createCallHelper`: `CreateCall(Callee, Ops, OpBundles, Name)`; these intrinsics are not FPMathOperators.
    return this.createCall(fn.functionType, fn, args, [], "");
  }
}

// llvm: llvm/include/llvm/IR/Instructions.h:1135 getGEPReturnType
/** `GetElementPtrInst::getGEPReturnType` (lane llir-folder): the pointer's type, or a vector of it when an index is a vector. */
function getGEPReturnType(Ptr: Value, IdxList: readonly Value[]): Type {
  // Vector GEP
  const Ty = Ptr.type;
  if (Ty.isVectorTy()) return Ty;
  for (const Index of IdxList) if (Index.type instanceof VectorType) return Ty.context.getVectorType(Ty, Index.type.numElements, Index.type.scalable);
  // Scalar GEP
  return Ty;
}

// llvm: llvm/include/llvm/IR/InstrTypes.h:1049 makeCmpResultType
/** `CmpInst::makeCmpResultType` (lane llir-folder): i1, or a vector of i1 of the operand's element count. */
function makeCmpResultType(opnd_type: Type): Type {
  if (opnd_type instanceof VectorType) return opnd_type.context.getVectorType(opnd_type.context.getIntType(1), opnd_type.numElements, opnd_type.scalable);
  return opnd_type.context.getIntType(1);
}

function cmpInst(opcode: "icmp" | "fcmp", p: number, lhs: Value, rhs: Value): Inst {
  if ((opcode === "fcmp") !== isFPPredicate(p)) throw new Error(`llvm: Invalid ${opcode} predicate ${p}`);
  const c = new Inst(opcode, makeCmpResultType(lhs.type), [lhs, rhs]);
  c.predicate = p;
  return c;
}

function setCallBase(c: Inst, fty: FunctionType, numArgs: number, bundles: readonly OperandBundleDef[]): void {
  c.fnType = fty;
  c.numArgs = numArgs;
  c.bundles = bundles.map((b) => ({ tag: b.tag, count: b.inputs.length }));
}

/** `DataLayout::getTypeStoreSize(Ty)` (DataLayout.h: `getTypeSizeInBits` rounded up to whole bytes) for the types an atomic
 *  operand can have in rustc's IR: integers, pointers (the data layout's pointer spec) and the IEEE floating-point types
 *  (lane llir-folder). Other types stop. */
function getTypeStoreSize(m: Module, ty: Type): number {
  let bits: number;
  if (ty instanceof IntegerType) bits = ty.bits;
  else if (ty instanceof PointerType) bits = m.pointerSpecBitWidth(ty.addressSpace);
  else if (ty.typeID === "Half" || ty.typeID === "BFloat" || ty.typeID === "Float" || ty.typeID === "Double" || ty.typeID === "FP128") bits = ty.fpBits();
  else return unported(`llir: DataLayout::getTypeStoreSize of ${ty.typeID} (not modelled)`);
  return Math.ceil(bits / 8);
}

/** The alignment `CreateAtomicRMW` / `CreateAtomicCmpXchg` give an atomic built without one: `llvm::Align(DL.getTypeStoreSize(Ty))`,
 *  `DL` being `BB->getDataLayout()`, the insertion block's module's. `Align`'s constructor asserts a power of two (an assertion,
 *  off in the oracle's build); the model stops on another size rather than print it. */
function defaultAtomicAlign(bb: BasicBlock | undefined, ty: Type): number {
  const m = bb?.parentFn?.parent;
  if (m === undefined) return unported("llir: an atomic built with no insertion block in a module (BB->getDataLayout())");
  const size = getTypeStoreSize(m, ty);
  if (size === 0 || (size & (size - 1)) !== 0) return unported(`llir: llvm::Align(${size}) of an atomic operand (not a power of two)`);
  return size;
}

/** `Type::getScalarSizeInBits` (`getPrimitiveSizeInBits` of the scalar type: 0 for a pointer). */
function scalarSizeInBits(t: Type): number {
  const s = t.getScalarType();
  if (s instanceof IntegerType) return s.bits;
  if (s.isFloatingPointTy()) return s.fpBits();
  return 0;
}

/** `CallBase::addParamAttr(ArgNo, Attribute::getWithAlignment(Align))` (`setDestAlignment`, IntrinsicInst.h). */
function setParamAlign(c: Inst, argNo: number, bytes: number): void {
  addAttributesAtIndex(c.attributes, argNo + 1, [alignAttr(c.context, bytes)]);
}

/** The `align` attribute (LLVMRustCreateAlignmentAttr's, uniqued by the same key; core.ts). */
let alignAttr: (c: Context, bytes: number) => Attribute = () => unported("llir: align attribute creator not registered");
export function setAlignAttrCreator(f: (c: Context, bytes: number) => Attribute): void {
  alignAttr = f;
}

// llvm: llvm/lib/IR/Intrinsics.cpp:802 Intrinsic::getOrInsertDeclaration
/** `Intrinsic::getOrInsertDeclaration(M, id, OverloadTys)` for the memory intrinsics rustc's wrappers create. Their types come from
 * Intrinsics.td (`int_memcpy`, `int_memmove`: `[llvm_anyptr_ty, llvm_anyptr_ty, llvm_anyint_ty, llvm_i1_ty]`; `int_memset`:
 * `[llvm_anyptr_ty, llvm_i8_ty, llvm_anyint_ty, llvm_i1_ty]`; all return void), their names from `getIntrinsicNameImpl`. */
export function getOrInsertMemIntrinsic(m: Module, id: "memcpy" | "memmove" | "memset", overloadTys: readonly Type[]): Function {
  const ctx = m.context;
  const params = id === "memset" ? [overloadTys[0]!, ctx.getIntType(8), overloadTys[1]!, ctx.getIntType(1)] : [overloadTys[0]!, overloadTys[1]!, overloadTys[2]!, ctx.getIntType(1)];
  const ft = ctx.getFunctionType(ctx.getVoidType(), params, false);
  // `getOrInsertIntrinsicDeclarationImpl` (Intrinsics.cpp:782): `getName(id, OverloadTys, M, FT)`, then
  // `M->getOrInsertFunction(Name, FT)`.
  const name = `llvm.${id}${overloadTys.map((t) => `.${getMangledTypeStr(t)}`).join("")}`;
  const existing = m.getNamedValue(name);
  if (existing !== undefined) {
    if (existing instanceof Function && existing.functionType === ft) return existing;
    return unported(`llir: an existing ${name} of another type (Intrinsics.cpp renames it .invalid)`);
  }
  // PORT: `Function::Create` gives an intrinsic `Intrinsic::getAttributes`, which the parser replaces (plan-m7 §1b, PORT
  // decision 5 of llir-core-a), so the model leaves them out.
  return new Function(ft, "ExternalLinkage", m.layoutAddressSpace("P"), name, m);
}

// llvm: llvm/lib/IR/Intrinsics.cpp:86 getMangledTypeStr
function getMangledTypeStr(ty: Type): string {
  if (ty instanceof PointerType) return `p${ty.addressSpace}`;
  if (ty instanceof IntegerType) return `i${ty.bits}`;
  return unported(`llir: getMangledTypeStr of a ${ty.typeID} type`);
}

// ---- printing function bodies (AsmWriter.cpp) --------------------------------------------------------------------------

/** `SlotTracker::processFunction`: unnamed arguments, blocks and non-void instructions, numbered in order. */
function functionSlots(f: Function): Map<Value, number> {
  const slots = new Map<Value, number>();
  for (const a of f.args) if (!a.hasName()) slots.set(a, slots.size);
  for (const bb of f.blocks as BasicBlock[]) {
    if (!bb.hasName()) slots.set(bb, slots.size);
    for (const I of bb.insts) if (I.type.typeID !== "Void" && !I.hasName()) slots.set(I, slots.size);
  }
  return slots;
}

/** `operator<<(FastMathFlags)`: ` fast`, or each flag set (llvm/lib/IR/Operator.cpp `FastMathFlags::print`). */
function printFMF(f: number): string {
  if (f === FMF_ALL) return " fast";
  const names: [number, string][] = [[FMF.AllowReassoc, "reassoc"], [FMF.NoNaNs, "nnan"], [FMF.NoInfs, "ninf"], [FMF.NoSignedZeros, "nsz"], [FMF.AllowReciprocal, "arcp"], [FMF.AllowContract, "contract"], [FMF.ApproxFunc, "afn"]];
  return names.filter(([b]) => f & b).map(([, n]) => ` ${n}`).join("");
}

// llvm: llvm/lib/IR/AsmWriter.cpp:1500 writeOptimizationInfo
function writeOptimizationInfo(I: Inst): string {
  let o = printFMF(I.fmf);
  const op = I.opcode;
  if (op === "add" || op === "sub" || op === "mul" || op === "shl") o += `${I.nuw ? " nuw" : ""}${I.nsw ? " nsw" : ""}`;
  else if (op === "udiv" || op === "sdiv" || op === "lshr" || op === "ashr") o += I.exact ? " exact" : "";
  else if (op === "or") o += I.disjoint ? " disjoint" : "";
  else if (op === "getelementptr") {
    if (I.gepFlags & 1) o += " inbounds";
    else if (I.gepFlags & 2) o += " nusw";
    if (I.gepFlags & 4) o += " nuw";
  } else if (op === "zext" || op === "uitofp") o += I.nneg ? " nneg" : "";
  else if (op === "trunc") o += `${I.nuw ? " nuw" : ""}${I.nsw ? " nsw" : ""}`;
  return o;
}

// llvm: llvm/lib/IR/AsmWriter.cpp:3031 AssemblyWriter::writeAtomic
function writeAtomic(ordering: Ordering, singleThread: boolean): string {
  if (ordering === "NotAtomic") return "";
  // `writeSyncScope`: nothing for System; the context's name of the scope otherwise ("singlethread").
  return `${singleThread ? ' syncscope("singlethread")' : ""} ${ORDERING_IR[ordering]}`;
}

/** "Print the calling convention being used": a space and `printCallingConv` (printer.ts) of a non-C convention. */
const callingConv = (cc: number): string => (cc !== 0 ? ` ${printCallingConv(cc)}` : "");

// llvm: llvm/lib/IR/AsmWriter.cpp:4437 AssemblyWriter::printInstruction
function printInstruction(I: Inst, p: Printer): string {
  const w = (v: Value, printType: boolean): string => p.operand(v, printType);
  let o = "  ";
  if (I.hasName()) o += `%${printLLVMNameWithoutPrefix(I.name)} = `;
  else if (I.type.typeID !== "Void") o += `${p.localOperand!(I)} = `;
  if (I.opcode === "call") o += I.tailKind === "MustTail" ? "musttail " : I.tailKind === "Tail" ? "tail " : I.tailKind === "NoTail" ? "notail " : "";
  o += I.opcode;
  if ((I.opcode === "load" || I.opcode === "store") && I.ordering !== "NotAtomic") o += " atomic";
  if (I.opcode === "cmpxchg" && I.weak) o += " weak";
  if (I.isVolatile && (I.opcode === "load" || I.opcode === "store" || I.opcode === "cmpxchg" || I.opcode === "atomicrmw")) o += " volatile";
  o += writeOptimizationInfo(I);
  if (I.opcode === "icmp" || I.opcode === "fcmp") o += ` ${getPredicateName(I.predicate)}`;
  if (I.opcode === "atomicrmw") o += ` ${I.rmwOp}`;
  const operand = I.operands[0];
  const ops = I.operands;
  if (I.opcode === "br" && ops.length === 3) {
    o += ` ${w(ops[0]!, true)}, ${w(ops[1]!, true)}, ${w(ops[2]!, true)}`;
  } else if (I.opcode === "switch") {
    o += ` ${w(ops[0]!, true)}, ${w(ops[1]!, true)} [`;
    for (let i = 2; i < ops.length; i += 2) o += `\n    ${w(ops[i]!, true)}, ${w(ops[i + 1]!, true)}`;
    o += "\n  ]";
  } else if (I.opcode === "phi") {
    o += ` ${p.type(I.type)} ${ops.map((v, i) => `[ ${w(v, false)}, ${w(I.phiBlocks[i]!, false)} ]`).join(", ")}`;
  } else if (I.opcode === "extractvalue") {
    o += ` ${w(ops[0]!, true)}, ${I.indices.join(", ")}`;
  } else if (I.opcode === "insertvalue") {
    o += ` ${w(ops[0]!, true)}, ${w(ops[1]!, true)}, ${I.indices.join(", ")}`;
  } else if (I.opcode === "landingpad") {
    o += ` ${p.type(I.type)}`;
    if (I.cleanup || ops.length !== 0) o += "\n";
    if (I.cleanup) o += "          cleanup";
    ops.forEach((c, i) => {
      if (i !== 0 || I.cleanup) o += "\n";
      // `isCatch(i)`: a clause that is not an array (a filter is an array constant).
      o += c.type instanceof ArrayType ? "          filter " : "          catch ";
      o += w(c, true);
    });
  } else if (I.opcode === "catchswitch") {
    o += ` within ${w(ops[0]!, false)} [${ops.slice(1).map((b) => w(b, true)).join(", ")}] unwind ${I.unwindDest === undefined ? "to caller" : w(I.unwindDest, true)}`;
  } else if (I.opcode === "cleanuppad" || I.opcode === "catchpad") {
    o += ` within ${w(ops[0]!, false)} [${ops.slice(1).map((a) => w(a, true)).join(", ")}]`;
  } else if (I.opcode === "ret" && operand === undefined) {
    o += " void";
  } else if (I.opcode === "catchret") {
    o += ` from ${w(ops[0]!, false)} to ${w(ops[1]!, true)}`;
  } else if (I.opcode === "cleanupret") {
    o += ` from ${w(ops[0]!, false)} unwind ${ops.length > 1 ? w(ops[1]!, true) : "to caller"}`;
  } else if (I.opcode === "call" || I.opcode === "invoke") {
    o += printCallBase(I, p);
  } else if (I.opcode === "alloca") {
    o += ` ${p.type(I.allocatedType!)}`;
    if (operand === undefined || I.isArrayAllocation() || !operand.type.isIntegerTy(32)) o += `, ${w(operand!, true)}`;
    if (I.align !== undefined) o += `, align ${I.align}`;
    if (I.addrSpace !== 0) o += `, addrspace(${I.addrSpace})`;
  } else if (I.opcode in CAST_OPCODES) {
    if (operand !== undefined) o += ` ${w(operand, true)}`;
    o += ` to ${p.type(I.type)}`;
  } else if (I.opcode === "va_arg") {
    if (operand !== undefined) o += ` ${w(operand, true)}`;
    o += `, ${p.type(I.type)}`;
  } else if (operand !== undefined) {
    // Print the normal way.
    if (I.opcode === "getelementptr") o += ` ${p.type(I.srcElementType!)},`;
    else if (I.opcode === "load") o += ` ${p.type(I.type)},`;
    let printAllTypes = false;
    const theType = operand.type;
    if (["select", "store", "shufflevector", "ret", "cmpxchg", "atomicrmw"].includes(I.opcode)) printAllTypes = true;
    else printAllTypes = ops.slice(1).some((x) => x.type !== theType);
    if (!printAllTypes) o += ` ${p.type(theType)}`;
    o += ` ${ops.map((x) => w(x, printAllTypes)).join(", ")}`;
  }
  if (I.opcode === "load" || I.opcode === "store") {
    o += writeAtomic(I.ordering, I.singleThread);
    if (I.align !== undefined) o += `, align ${I.align}`;
  } else if (I.opcode === "cmpxchg") {
    o += `${I.singleThread ? ' syncscope("singlethread")' : ""} ${ORDERING_IR[I.ordering]} ${ORDERING_IR[I.failureOrdering]}`;
    if (I.align !== undefined) o += `, align ${I.align}`;
  } else if (I.opcode === "atomicrmw") {
    o += writeAtomic(I.ordering, I.singleThread);
    if (I.align !== undefined) o += `, align ${I.align}`;
  } else if (I.opcode === "fence") {
    o += writeAtomic(I.ordering, I.singleThread);
  } else if (I.opcode === "shufflevector") {
    // `printShuffleMask` (AsmWriter.cpp:523).
    const vt = I.type as VectorType;
    o += `, <${vt.scalable ? "vscale x " : ""}${I.mask.length} x i32> `;
    if (I.mask.every((e) => e === 0)) o += "zeroinitializer";
    else if (I.mask.every((e) => e === -1)) o += "poison";
    else o += `<${I.mask.map((e) => `i32 ${e === -1 ? "poison" : e}`).join(", ")}>`;
  }
  // `getAllMetadata` (the `!dbg` location first, then the others sorted by kind), then `printMetadataAttachments(InstMD, ", ")`.
  o += p.attachments(I.debugLoc === undefined ? I.metadata : [[0, I.debugLoc], ...I.metadata], ", ", I.context);
  return o;
}

/** The call and invoke arms of `printInstruction`. */
function printCallBase(I: Inst, p: Printer): string {
  const fty = I.fnType!;
  const callee = I.callee;
  let o = callingConv(I.callingConv);
  const ret = I.attributes.get(0);
  if (ret?.size) o += ` ${p.attributeSet(ret)}`;
  // `maybePrintCallAddrSpace`: the callee's address space, forced when the program address space is not 0.
  const m = I.parent?.parentFn?.parent;
  const callAS = (callee.type as PointerType).addressSpace;
  if (callAS !== 0 || m === undefined || m.layoutAddressSpace("P") !== 0) o += ` addrspace(${callAS})`;
  o += ` ${p.type(fty.isVarArg ? fty : fty.returnType)} ${p.operand(callee, false)}(`;
  const args: string[] = [];
  for (let i = 0; i < I.numArgs; i++) {
    // `writeParamOperand`: type, attributes, operand.
    const a = I.operands[i]!;
    const attrs = I.attributes.get(i + 1);
    args.push(`${p.type(a.type)}${attrs?.size ? ` ${p.attributeSet(attrs)}` : ""} ${p.operand(a, false)}`);
  }
  if (I.opcode === "call" && I.tailKind === "MustTail" && I.parent?.parentFn?.functionType.isVarArg) args.push("...");
  o += `${args.join(", ")})`;
  const fn = I.attributes.get(0xffffffff);
  if (fn?.size) o += ` #${p.attributeGroup(fn)}`;
  // `writeOperandBundles`.
  if (I.bundles.length) {
    let at = I.numArgs;
    o += ` [ ${I.bundles
      .map((b) => {
        const inputs = I.operands.slice(at, at + b.count);
        at += b.count;
        return `"${printEscapedString(b.tag)}"(${inputs.map((v) => p.operand(v, true)).join(", ")})`;
      })
      .join(", ")} ]`;
  }
  if (I.opcode === "invoke") {
    const n = I.operands.length;
    o += `\n          to ${p.operand(I.operands[n - 3]!, true)} unwind ${p.operand(I.operands[n - 2]!, true)}`;
  }
  return o;
}

// llvm: llvm/lib/IR/AsmWriter.cpp:4320 AssemblyWriter::printBasicBlock
function printBasicBlock(bb: BasicBlock, p: Printer, first: boolean): string {
  let o = "";
  if (bb.hasName()) o += `${first ? "" : "\n"}${printLLVMNameWithoutPrefix(bb.name)}:`;
  else if (!bb.isEntryBlock()) o += `\n${p.localOperand!(bb).slice(1)}:`;
  // PORT: the `; preds = ...` comment is left out; the normal form drops it (plan-m7 §1b).
  if (o !== "") o += "\n";
  for (const I of bb.insts) {
    // `printDbgRecordLine` for each record on the instruction (llir-di).
    if (I.dbgRecords !== undefined) for (const dr of I.dbgRecords) o += `    ${dr.printRecord(p)}\n`;
    o += `${printInstruction(I, p)}\n`;
  }
  return o;
}

/** The body printer printer.ts calls for a definition, with the function's slot numbering already set (`localOperand`). */
setBodyPrinter(
  (f, p) => (f.blocks as BasicBlock[]).map((bb, i) => printBasicBlock(bb, p, i === 0)).join(""),
  (f) => {
    const slots = functionSlots(f);
    return (v) => {
      if (v.hasName()) return `%${printLLVMNameWithoutPrefix(v.name)}`;
      const s = slots.get(v);
      return s === undefined ? "<badref>" : `%${s}`;
    };
  },
);

/** The type finder's walk of function bodies (`TypeFinder::run`, TypeFinder.cpp:34): each instruction's type, its
 * non-instruction operands, a GEP's source element type, an alloca's type and a call's attribute types. */
typeFinderHooks.body = (f, visitType, visitValue, visitAttrs) => {
  for (const bb of f.blocks as BasicBlock[]) {
    for (const I of bb.insts) {
      visitType(I.type);
      for (const o of I.operands) if (!(o instanceof Instruction)) visitValue(o);
      if (I.srcElementType !== undefined) visitType(I.srcElementType);
      if (I.allocatedType !== undefined) visitType(I.allocatedType);
      if (I.isCallBase()) visitAttrs(I.attributes);
    }
  }
};
