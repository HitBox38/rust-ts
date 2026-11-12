// rust-ts: the C API and `LLVMRust*` functions of llir-core-b's half of the model (lane llir-core-b): basic blocks, the
// builder and every instruction form rustc emits, instruction flags and metadata, operand bundles, and the builder wrappers
// of rustc's RustWrapper.cpp. Each is the LLVM-C function (`// llvm:`, llvm/lib/IR/Core.cpp) or rustc's C++ wrapper
// (`// rustc:`) of the same name, over inst.ts; ffi_gen.ts binds every function exported here into ffi.ts.
import { unported } from "../../std/panic.ts";
import { LLVMRustCreateAlignmentAttr } from "./core.ts";
import type { AtomicOrdering, AtomicRmwBinOp, GEPNoWrapFlags, TailCallKind } from "./ffi_types.ts";
import type { BinaryOps } from "./fold.ts";
import { BasicBlock, FMF, IRBuilder, Inst, OperandBundleDef, setAlignAttrCreator } from "./inst.ts";
import {
  Attribute,
  Constant,
  ConstantInt,
  type Context,
  Function,
  FunctionType,
  getConstantVector,
  getNullValue,
  Instruction,
  MDNode,
  type Metadata,
  MetadataAsValue,
  type Type,
  User,
  type Value,
  ValueAsMetadata,
} from "./ir.ts";
import { Bool, type MetadataKindId, type PtrLenStr } from "./support.ts";

setAlignAttrCreator((c, bytes) => LLVMRustCreateAlignmentAttr(c, BigInt(bytes)));

// ---- argument conversions ----------------------------------------------------------------------------------------------

/** A `const char *Name` that becomes a `Twine`: null reads `Str[0]` (llvm/ADT/Twine.h:257), a crash in the oracle. */
function twine(s: string | undefined, fn: string): string {
  if (s === undefined) throw new Error(`llvm: ${fn}: Twine(const char*) of a null pointer`);
  // The name's UTF-8 bytes, as a byte string (ir.ts names are byte strings).
  return Buffer.from(s, "utf8").toString("latin1");
}
const asInst = (v: Value, what: string): Inst => {
  if (!(v instanceof Inst)) throw new Error(`llvm: unwrap<${what}> of a value that is not an instruction`);
  return v;
};
const asFunction = (v: Value): Function => {
  if (!(v instanceof Function)) throw new Error("llvm: unwrap<Function> of a value that is not a function");
  return v;
};

// ---- basic blocks ------------------------------------------------------------------------------------------------------

// llvm: llvm/lib/IR/Core.cpp:2892 LLVMGetBasicBlockParent
export function LLVMGetBasicBlockParent(BB: BasicBlock): Value {
  return BB.parentFn!;
}

// llvm: llvm/lib/IR/Core.cpp:2914 LLVMGetFirstBasicBlock
export function LLVMGetFirstBasicBlock(Fn: Value): BasicBlock {
  // ffi.rs declares the result non-null; LLVM returns null for a declaration, which rustc never asks.
  const b = asFunction(Fn).blocks[0];
  if (b === undefined) throw new Error("llvm: LLVMGetFirstBasicBlock of a declaration (null, which ffi.rs's &BasicBlock cannot hold)");
  return b as BasicBlock;
}

// llvm: llvm/lib/IR/Core.cpp:2964 LLVMAppendBasicBlockInContext
export function LLVMAppendBasicBlockInContext(C: Context, Fn: Value, Name: string | undefined): BasicBlock {
  // `BasicBlock::Create(*unwrap(C), Name, unwrap<Function>(FnRef))`.
  return new BasicBlock(C, twine(Name, "LLVMAppendBasicBlockInContext"), asFunction(Fn));
}

// ---- instructions ------------------------------------------------------------------------------------------------------

// `LLVMIsAInstruction`: Core.cpp:1183's `LLVM_FOR_EACH_VALUE_SUBCLASS(LLVM_DEFINE_VALUE_CAST)` (a macro, no definition line to mark).
export function LLVMIsAInstruction(Val: Value): Value | undefined {
  return Val instanceof Instruction ? Val : undefined;
}

// llvm: llvm/lib/IR/Core.cpp:1249 LLVMGetOperand
export function LLVMGetOperand(Val: Value, Index: number): Value | undefined {
  if (Val instanceof MetadataAsValue) {
    if (Val.md instanceof ValueAsMetadata) {
      // Function-local metadata can only have one operand.
      return Val.md.value;
    }
    return unported("llir: LLVMGetOperand of a metadata node (getMDNodeOperandImpl)");
  }
  if (!(Val instanceof User)) throw new Error("llvm: cast<User> of a value that is not a user");
  return Val.operands[Index];
}

// llvm: llvm/lib/IR/Core.cpp:3169 LLVMSetInstructionCallConv
export function LLVMSetInstructionCallConv(Instr: Value, CC: number): void {
  const c = asInst(Instr, "CallBase");
  if (!c.isCallBase()) throw new Error("llvm: unwrap<CallBase> of an instruction that is not a call");
  c.callingConv = CC;
}

// llvm: llvm/lib/IR/Core.cpp:3250 LLVMSetTailCall
export function LLVMSetTailCall(CallInst: Value, IsTailCall: Bool): void {
  // `CallInst::setTailCall(bool)`: Tail, or None.
  const c = asInst(CallInst, "CallInst");
  if (c.opcode !== "call") throw new Error("llvm: unwrap<CallInst> of an instruction that is not a call");
  c.tailKind = IsTailCall.is_true() ? "Tail" : "None";
}

// llvm: llvm/lib/IR/Core.cpp:3258 LLVMSetTailCallKind
export function LLVMSetTailCallKind(CallInst: Value, kind: TailCallKind): void {
  // `(CallInst::TailCallKind)kind`: TCK_None, TCK_Tail, TCK_MustTail, TCK_NoTail, as ffi.rs's TailCallKind.
  const c = asInst(CallInst, "CallInst");
  if (c.opcode !== "call") throw new Error("llvm: unwrap<CallInst> of an instruction that is not a call");
  c.tailKind = kind;
}

// llvm: llvm/lib/IR/Core.cpp:4243 LLVMSetVolatile
export function LLVMSetVolatile(MemoryAccessInst: Value, volatile: Bool): void {
  const I = asInst(MemoryAccessInst, "AtomicCmpXchgInst");
  if (I.opcode !== "load" && I.opcode !== "store" && I.opcode !== "atomicrmw" && I.opcode !== "cmpxchg") throw new Error("llvm: cast<AtomicCmpXchgInst> of another instruction");
  I.isVolatile = volatile.is_true();
}

// llvm: llvm/lib/IR/Core.cpp:4276 LLVMSetOrdering
export function LLVMSetOrdering(MemoryAccessInst: Value, Ordering: AtomicOrdering): void {
  // `mapFromLLVMOrdering`: the same names.
  const I = asInst(MemoryAccessInst, "StoreInst");
  if (I.opcode !== "load" && I.opcode !== "fence" && I.opcode !== "atomicrmw" && I.opcode !== "store") throw new Error("llvm: cast<StoreInst> of another instruction");
  I.ordering = Ordering;
}

// llvm: llvm/lib/IR/Core.cpp:4258 LLVMSetWeak
export function LLVMSetWeak(CmpXchgInst: Value, IsWeak: Bool): void {
  const I = asInst(CmpXchgInst, "AtomicCmpXchgInst");
  if (I.opcode !== "cmpxchg") throw new Error("llvm: unwrap<AtomicCmpXchgInst> of another instruction");
  I.weak = IsWeak.is_true();
}

// llvm: llvm/lib/IR/Core.cpp:3381 LLVMAddIncoming
export function LLVMAddIncoming(PhiNode: Value, IncomingValues: readonly Value[], IncomingBlocks: readonly BasicBlock[], Count: number): void {
  const phi = asInst(PhiNode, "PHINode");
  // `PHINode::addIncoming`: the value is an operand, the block is kept beside it.
  for (let i = 0; i !== Count; ++i) {
    phi.addOperand(IncomingValues[i]!);
    phi.phiBlocks.push(IncomingBlocks[i]!);
  }
}

// llvm: llvm/lib/IR/Core.cpp:3678 LLVMAddCase
export function LLVMAddCase(Switch: Value, OnVal: Value, Dest: BasicBlock): void {
  // `SwitchInst::addCase` (Instructions.cpp:4157): the value and the successor join the operand list.
  const s = asInst(Switch, "SwitchInst");
  if (!(OnVal instanceof ConstantInt)) throw new Error("llvm: unwrap<ConstantInt> of a non-integer case value");
  s.addOperand(OnVal);
  s.addOperand(Dest);
}

// llvm: llvm/lib/IR/Core.cpp:3695 LLVMAddClause
export function LLVMAddClause(LandingPad: Value, ClauseVal: Value): void {
  const lp = asInst(LandingPad, "LandingPadInst");
  if (!(ClauseVal instanceof Constant)) throw new Error("llvm: unwrap<Constant> of a non-constant clause");
  lp.addOperand(ClauseVal);
}

// llvm: llvm/lib/IR/Core.cpp:3703 LLVMSetCleanup
export function LLVMSetCleanup(LandingPad: Value, Val: Bool): void {
  asInst(LandingPad, "LandingPadInst").cleanup = Val.is_true();
}

// llvm: llvm/lib/IR/Core.cpp:3707 LLVMAddHandler
export function LLVMAddHandler(CatchSwitch: Value, Dest: BasicBlock): void {
  asInst(CatchSwitch, "CatchSwitchInst").addOperand(Dest);
}

// llvm: llvm/lib/IR/Core.cpp:2550 LLVMSetPersonalityFn
export function LLVMSetPersonalityFn(Func: Value, Pers: Value): void {
  if (!(Pers instanceof Constant)) throw new Error("llvm: unwrap<Constant> of a non-constant personality");
  asFunction(Func).personality = Pers;
}

/** `Instruction::setHasNoUnsignedWrap` / `setHasNoSignedWrap` (Instruction.cpp): an OverflowingBinaryOperator or a trunc. */
function wrapFlagTarget(v: Value): Inst {
  const I = asInst(v, "Instruction");
  if (!["add", "sub", "mul", "shl", "trunc"].includes(I.opcode)) throw new Error(`llvm: cast<OverflowingBinaryOperator> of ${I.opcode}`);
  return I;
}

// llvm: llvm/lib/IR/Core.cpp:3942 LLVMSetNUW
export function LLVMSetNUW(ArithInst: Value, HasNUW: Bool): void {
  wrapFlagTarget(ArithInst).nuw = HasNUW.is_true();
}

// llvm: llvm/lib/IR/Core.cpp:3952 LLVMSetNSW
export function LLVMSetNSW(ArithInst: Value, HasNSW: Bool): void {
  wrapFlagTarget(ArithInst).nsw = HasNSW.is_true();
}

// llvm: llvm/lib/IR/Core.cpp:3998 LLVMSetIsDisjoint
export function LLVMSetIsDisjoint(Instr: Value, IsDisjoint: Bool): void {
  const I = asInst(Instr, "PossiblyDisjointInst");
  if (I.opcode !== "or") throw new Error("llvm: cast<PossiblyDisjointInst> of another instruction");
  I.disjoint = IsDisjoint.is_true();
}

// llvm: llvm/lib/IR/Core.cpp:1115 LLVMGetMetadata
export function LLVMGetMetadata(Val: Value, KindID: MetadataKindId): Value | undefined {
  const I = asInst(Val, "Instruction");
  const md = I.getMetadata(KindID);
  return md === undefined ? undefined : I.context.getMetadataAsValue(md);
}

// llvm: llvm/lib/IR/Core.cpp:1137 LLVMSetMetadata
export function LLVMSetMetadata(Val: Value, KindID: MetadataKindId, Node: Value): void {
  // `extractMDNode`: a wrapped node, or a canonicalized constant (ConstantAsMetadata) rebuilt as `MDNode::get({MD})`.
  let n: MDNode | undefined;
  if (Node !== undefined) {
    if (!(Node instanceof MetadataAsValue)) throw new Error("llvm: unwrap<MetadataAsValue> of a value that is not metadata");
    n = Node.md instanceof MDNode ? Node.md : Node.context.getMDNode([Node.md]);
  }
  asInst(Val, "Instruction").setMetadata(KindID, n);
}

// ---- the builder -------------------------------------------------------------------------------------------------------

// llvm: llvm/lib/IR/Core.cpp:3427 LLVMCreateBuilderInContext
export function LLVMCreateBuilderInContext(C: Context): IRBuilder {
  return new IRBuilder(C);
}

// llvm: llvm/lib/IR/Core.cpp:3466 LLVMPositionBuilderAtEnd
export function LLVMPositionBuilderAtEnd(Builder: IRBuilder, Block: BasicBlock): void {
  // `SetInsertPoint(BB)`: the end of the block.
  Builder.setInsertPoint(Block, Block.insts.length);
}

// llvm: llvm/lib/IR/Core.cpp:3471 LLVMGetInsertBlock
export function LLVMGetInsertBlock(Builder: IRBuilder): BasicBlock {
  // ffi.rs declares the result non-null; rustc asks only of a positioned builder.
  if (Builder.block === undefined) throw new Error("llvm: LLVMGetInsertBlock of an unpositioned builder (null)");
  return Builder.block;
}

// llvm: llvm/lib/IR/Core.cpp:3488 LLVMDisposeBuilder
export function LLVMDisposeBuilder(_Builder: IRBuilder): void {
  // Garbage collection deletes the builder.
}

// llvm: llvm/lib/IR/Core.cpp:3494 LLVMGetCurrentDebugLocation2
export function LLVMGetCurrentDebugLocation2(_Builder: IRBuilder): Metadata | undefined {
  // No debug location is ever stored (LLVMSetCurrentDebugLocation2 stops on one), so this is `DebugLoc()`'s null node.
  return undefined;
}

// llvm: llvm/lib/IR/Core.cpp:3498 LLVMSetCurrentDebugLocation2
export function LLVMSetCurrentDebugLocation2(_Builder: IRBuilder, Loc: Metadata | undefined): void {
  // `SetCurrentDebugLocation(DebugLoc())` with a null location stores nothing the model has.
  if (Loc !== undefined) return unported("llir: LLVMSetCurrentDebugLocation2 of a location (DILocation, llir-di)");
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1403 LLVMRustPositionBuilderPastAllocas
export function LLVMRustPositionBuilderPastAllocas(B: IRBuilder, Fn: Value): void {
  // `SetInsertPointPastAllocas(F)` (IRBuilder.h:215): the entry block, past its static allocas.
  const bb = asFunction(Fn).blocks[0] as BasicBlock;
  B.block = bb;
  B.insertBefore = bb.insts[bb.getFirstNonPHIOrDbgOrAlloca()];
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1408 LLVMRustPositionBuilderAtStart
export function LLVMRustPositionBuilderAtStart(B: IRBuilder, BB: BasicBlock): void {
  // `SetInsertPoint(BB, BB->getFirstInsertionPt())`.
  B.setInsertPoint(BB, BB.getFirstInsertionPt());
}

// ---- terminators -------------------------------------------------------------------------------------------------------

// llvm: llvm/lib/IR/Core.cpp:3543 LLVMBuildRetVoid
export function LLVMBuildRetVoid(B: IRBuilder): Value {
  return B.createRetVoid();
}

// llvm: llvm/lib/IR/Core.cpp:3547 LLVMBuildRet
export function LLVMBuildRet(B: IRBuilder, V: Value): Value {
  return B.createRet(V);
}

// llvm: llvm/lib/IR/Core.cpp:3556 LLVMBuildBr
export function LLVMBuildBr(B: IRBuilder, Dest: BasicBlock): Value {
  return B.createBr(Dest);
}

// llvm: llvm/lib/IR/Core.cpp:3560 LLVMBuildCondBr
export function LLVMBuildCondBr(B: IRBuilder, If: Value, Then: BasicBlock, Else: BasicBlock): Value {
  return B.createCondBr(If, Then, Else);
}

// llvm: llvm/lib/IR/Core.cpp:3565 LLVMBuildSwitch
export function LLVMBuildSwitch(B: IRBuilder, V: Value, Else: BasicBlock, _NumCases: number): Value {
  // `NumCases` only reserves operand space.
  return B.createSwitch(V, Else);
}

// llvm: llvm/lib/IR/Core.cpp:3617 LLVMBuildLandingPad
export function LLVMBuildLandingPad(B: IRBuilder, Ty: Type, PersFn: Value | undefined, _NumClauses: number, Name: string | undefined): Value {
  // The personality used to live on the landingpad instruction, but now it lives on the parent function. For compatibility,
  // take the provided personality and put it on the parent function.
  if (PersFn !== undefined) asFunction(B.block!.parentFn!).personality = asFunction(PersFn);
  return B.createLandingPad(Ty, twine(Name, "LLVMBuildLandingPad"));
}

// llvm: llvm/lib/IR/Core.cpp:3647 LLVMBuildResume
export function LLVMBuildResume(B: IRBuilder, Exn: Value): Value {
  return B.createResume(Exn);
}

// llvm: llvm/lib/IR/Core.cpp:3674 LLVMBuildUnreachable
export function LLVMBuildUnreachable(B: IRBuilder): Value {
  return B.createUnreachable();
}

// llvm: llvm/lib/IR/Core.cpp:3636 LLVMBuildCleanupPad
export function LLVMBuildCleanupPad(B: IRBuilder, ParentPad: Value | undefined, Args: readonly Value[], NumArgs: number, Name: string | undefined): Value | undefined {
  // A null parent pad is the `none` token.
  const parent = ParentPad ?? getNullValue(B.context.getTokenType());
  return B.createFuncletPad("cleanuppad", parent, Args.slice(0, NumArgs), twine(Name, "LLVMBuildCleanupPad"));
}

// llvm: llvm/lib/IR/Core.cpp:3668 LLVMBuildCleanupRet
export function LLVMBuildCleanupRet(B: IRBuilder, CleanupPad: Value, BB: BasicBlock | undefined): Value | undefined {
  return B.createCleanupRet(asInst(CleanupPad, "CleanupPadInst"), BB);
}

// llvm: llvm/lib/IR/Core.cpp:3629 LLVMBuildCatchPad
export function LLVMBuildCatchPad(B: IRBuilder, ParentPad: Value, Args: readonly Value[], NumArgs: number, Name: string | undefined): Value | undefined {
  return B.createFuncletPad("catchpad", ParentPad, Args.slice(0, NumArgs), twine(Name, "LLVMBuildCatchPad"));
}

// llvm: llvm/lib/IR/Core.cpp:3662 LLVMBuildCatchRet
export function LLVMBuildCatchRet(B: IRBuilder, CatchPad: Value, BB: BasicBlock): Value | undefined {
  return B.createCatchRet(asInst(CatchPad, "CatchPadInst"), BB);
}

// llvm: llvm/lib/IR/Core.cpp:3651 LLVMBuildCatchSwitch
export function LLVMBuildCatchSwitch(Builder: IRBuilder, ParentPad: Value | undefined, UnwindBB: BasicBlock | undefined, _NumHandlers: number, Name: string | undefined): Value | undefined {
  const parent = ParentPad ?? getNullValue(Builder.context.getTokenType());
  return Builder.createCatchSwitch(parent, UnwindBB, twine(Name, "LLVMBuildCatchSwitch"));
}

// ---- arithmetic --------------------------------------------------------------------------------------------------------

const bin = (op: BinaryOps, fn: string, f?: { nuw?: boolean; nsw?: boolean; exact?: boolean }) => (B: IRBuilder, LHS: Value, RHS: Value, Name: string | undefined): Value =>
  B.createBinOp(op, LHS, RHS, twine(Name, fn), f);

// llvm: llvm/lib/IR/Core.cpp:3775 LLVMBuildAdd
export const LLVMBuildAdd = bin("Add", "LLVMBuildAdd");
// llvm: llvm/lib/IR/Core.cpp:3780 LLVMBuildNSWAdd
export const LLVMBuildNSWAdd = bin("Add", "LLVMBuildNSWAdd", { nsw: true });
// llvm: llvm/lib/IR/Core.cpp:3785 LLVMBuildNUWAdd
export const LLVMBuildNUWAdd = bin("Add", "LLVMBuildNUWAdd", { nuw: true });
// llvm: llvm/lib/IR/Core.cpp:3790 LLVMBuildFAdd
export const LLVMBuildFAdd = bin("FAdd", "LLVMBuildFAdd");
// llvm: llvm/lib/IR/Core.cpp:3795 LLVMBuildSub
export const LLVMBuildSub = bin("Sub", "LLVMBuildSub");
// llvm: llvm/lib/IR/Core.cpp:3800 LLVMBuildNSWSub
export const LLVMBuildNSWSub = bin("Sub", "LLVMBuildNSWSub", { nsw: true });
// llvm: llvm/lib/IR/Core.cpp:3805 LLVMBuildNUWSub
export const LLVMBuildNUWSub = bin("Sub", "LLVMBuildNUWSub", { nuw: true });
// llvm: llvm/lib/IR/Core.cpp:3810 LLVMBuildFSub
export const LLVMBuildFSub = bin("FSub", "LLVMBuildFSub");
// llvm: llvm/lib/IR/Core.cpp:3815 LLVMBuildMul
export const LLVMBuildMul = bin("Mul", "LLVMBuildMul");
// llvm: llvm/lib/IR/Core.cpp:3820 LLVMBuildNSWMul
export const LLVMBuildNSWMul = bin("Mul", "LLVMBuildNSWMul", { nsw: true });
// llvm: llvm/lib/IR/Core.cpp:3825 LLVMBuildNUWMul
export const LLVMBuildNUWMul = bin("Mul", "LLVMBuildNUWMul", { nuw: true });
// llvm: llvm/lib/IR/Core.cpp:3830 LLVMBuildFMul
export const LLVMBuildFMul = bin("FMul", "LLVMBuildFMul");
// llvm: llvm/lib/IR/Core.cpp:3835 LLVMBuildUDiv
export const LLVMBuildUDiv = bin("UDiv", "LLVMBuildUDiv");
// llvm: llvm/lib/IR/Core.cpp:3840 LLVMBuildExactUDiv
export const LLVMBuildExactUDiv = bin("UDiv", "LLVMBuildExactUDiv", { exact: true });
// llvm: llvm/lib/IR/Core.cpp:3845 LLVMBuildSDiv
export const LLVMBuildSDiv = bin("SDiv", "LLVMBuildSDiv");
// llvm: llvm/lib/IR/Core.cpp:3850 LLVMBuildExactSDiv
export const LLVMBuildExactSDiv = bin("SDiv", "LLVMBuildExactSDiv", { exact: true });
// llvm: llvm/lib/IR/Core.cpp:3855 LLVMBuildFDiv
export const LLVMBuildFDiv = bin("FDiv", "LLVMBuildFDiv");
// llvm: llvm/lib/IR/Core.cpp:3860 LLVMBuildURem
export const LLVMBuildURem = bin("URem", "LLVMBuildURem");
// llvm: llvm/lib/IR/Core.cpp:3865 LLVMBuildSRem
export const LLVMBuildSRem = bin("SRem", "LLVMBuildSRem");
// llvm: llvm/lib/IR/Core.cpp:3870 LLVMBuildFRem
export const LLVMBuildFRem = bin("FRem", "LLVMBuildFRem");
// llvm: llvm/lib/IR/Core.cpp:3875 LLVMBuildShl
export const LLVMBuildShl = bin("Shl", "LLVMBuildShl");
// llvm: llvm/lib/IR/Core.cpp:3880 LLVMBuildLShr
export const LLVMBuildLShr = bin("LShr", "LLVMBuildLShr");
// llvm: llvm/lib/IR/Core.cpp:3885 LLVMBuildAShr
export const LLVMBuildAShr = bin("AShr", "LLVMBuildAShr");
// llvm: llvm/lib/IR/Core.cpp:3890 LLVMBuildAnd
export const LLVMBuildAnd = bin("And", "LLVMBuildAnd");
// llvm: llvm/lib/IR/Core.cpp:3895 LLVMBuildOr
export const LLVMBuildOr = bin("Or", "LLVMBuildOr");
// llvm: llvm/lib/IR/Core.cpp:3900 LLVMBuildXor
export const LLVMBuildXor = bin("Xor", "LLVMBuildXor");

// llvm: llvm/lib/IR/Core.cpp:3912 LLVMBuildNeg
export function LLVMBuildNeg(B: IRBuilder, V: Value, Name: string | undefined): Value {
  return B.createNeg(V, twine(Name, "LLVMBuildNeg"));
}

// llvm: llvm/lib/IR/Core.cpp:3929 LLVMBuildFNeg
export function LLVMBuildFNeg(B: IRBuilder, V: Value, Name: string | undefined): Value {
  return B.createFNeg(V, twine(Name, "LLVMBuildFNeg"));
}

// llvm: llvm/lib/IR/Core.cpp:3933 LLVMBuildNot
export function LLVMBuildNot(B: IRBuilder, V: Value, Name: string | undefined): Value {
  return B.createNot(V, twine(Name, "LLVMBuildNot"));
}

// ---- memory ------------------------------------------------------------------------------------------------------------

// llvm: llvm/lib/IR/Core.cpp:4048 LLVMBuildAlloca
export function LLVMBuildAlloca(B: IRBuilder, Ty: Type, Name: string | undefined): Value {
  return B.createAlloca(Ty, twine(Name, "LLVMBuildAlloca"));
}

// llvm: llvm/lib/IR/Core.cpp:4062 LLVMBuildLoad2
export function LLVMBuildLoad2(B: IRBuilder, Ty: Type, PointerVal: Value, Name: string | undefined): Value {
  return B.createLoad(Ty, PointerVal, twine(Name, "LLVMBuildLoad2"));
}

// llvm: llvm/lib/IR/Core.cpp:4067 LLVMBuildStore
export function LLVMBuildStore(B: IRBuilder, Val: Value, Ptr: Value): Value {
  return B.createStore(Val, Ptr);
}

// llvm: llvm/lib/IR/Core.cpp:4212 LLVMBuildGEPWithNoWrapFlags
export function LLVMBuildGEPWithNoWrapFlags(B: IRBuilder, Ty: Type, Pointer: Value, Indices: readonly Value[], NumIndices: number, Name: string | undefined, Flags: GEPNoWrapFlags): Value {
  // `mapFromLLVMGEPNoWrapFlags`: LLVMGEPFlagInBounds is `GEPNoWrapFlags::inBounds()` (InBounds | NUSW), the others one bit each.
  const nw = (Flags & 1 ? 3 : 0) | (Flags & 2 ? 2 : 0) | (Flags & 4 ? 4 : 0);
  return B.createGEP(Ty, Pointer, Indices.slice(0, NumIndices), twine(Name, "LLVMBuildGEPWithNoWrapFlags"), nw);
}

/** `mapFromLLVMRMWBinOp` of ffi.rs's `AtomicRmwBinOp` (LLVMAtomicRMWBinOpXchg..UMin), then `getOperationName`. */
const RMW_OP: Readonly<Record<AtomicRmwBinOp, string>> = {
  AtomicXchg: "xchg", AtomicAdd: "add", AtomicSub: "sub", AtomicAnd: "and", AtomicNand: "nand", AtomicOr: "or", AtomicXor: "xor",
  AtomicMax: "max", AtomicMin: "min", AtomicUMax: "umax", AtomicUMin: "umin",
};

// llvm: llvm/lib/IR/Core.cpp:4530 LLVMBuildAtomicRMW
export function LLVMBuildAtomicRMW(B: IRBuilder, Op: AtomicRmwBinOp, LHS: Value, RHS: Value, Order: AtomicOrdering, SingleThreaded: Bool): Value {
  return B.createAtomicRMW(RMW_OP[Op], LHS, RHS, Order, SingleThreaded.is_true());
}

// llvm: llvm/lib/IR/Core.cpp:4552 LLVMBuildAtomicCmpXchg
export function LLVMBuildAtomicCmpXchg(B: IRBuilder, LHS: Value, CMP: Value, RHS: Value, Order: AtomicOrdering, FailureOrder: AtomicOrdering, SingleThreaded: Bool): Value {
  return B.createAtomicCmpXchg(LHS, CMP, RHS, Order, FailureOrder, SingleThreaded.is_true());
}

// llvm: llvm/lib/IR/Core.cpp:4181 LLVMBuildFence
export function LLVMBuildFence(B: IRBuilder, Order: AtomicOrdering, SingleThreaded: Bool, Name: string | undefined): Value {
  return B.createFence(Order, SingleThreaded.is_true(), twine(Name, "LLVMBuildFence"));
}

// ---- casts -------------------------------------------------------------------------------------------------------------

// llvm: llvm/lib/IR/Core.cpp:4299 LLVMBuildTrunc
export function LLVMBuildTrunc(B: IRBuilder, Val: Value, DestTy: Type, Name: string | undefined): Value {
  // `CreateTrunc(V, DestTy, Name)`: CreateCast with no flags.
  return B.createCast("Trunc", Val, DestTy, twine(Name, "LLVMBuildTrunc"));
}

// llvm: llvm/lib/IR/Core.cpp:4304 LLVMBuildZExt
export function LLVMBuildZExt(B: IRBuilder, Val: Value, DestTy: Type, Name: string | undefined): Value {
  return B.createCast("ZExt", Val, DestTy, twine(Name, "LLVMBuildZExt"));
}

// llvm: llvm/lib/IR/Core.cpp:4309 LLVMBuildSExt
export function LLVMBuildSExt(B: IRBuilder, Val: Value, DestTy: Type, Name: string | undefined): Value {
  return B.createCast("SExt", Val, DestTy, twine(Name, "LLVMBuildSExt"));
}

// llvm: llvm/lib/IR/Core.cpp:4314 LLVMBuildFPToUI
export function LLVMBuildFPToUI(B: IRBuilder, Val: Value, DestTy: Type, Name: string | undefined): Value {
  return B.createCast("FPToUI", Val, DestTy, twine(Name, "LLVMBuildFPToUI"));
}

// llvm: llvm/lib/IR/Core.cpp:4319 LLVMBuildFPToSI
export function LLVMBuildFPToSI(B: IRBuilder, Val: Value, DestTy: Type, Name: string | undefined): Value {
  return B.createCast("FPToSI", Val, DestTy, twine(Name, "LLVMBuildFPToSI"));
}

// llvm: llvm/lib/IR/Core.cpp:4324 LLVMBuildUIToFP
export function LLVMBuildUIToFP(B: IRBuilder, Val: Value, DestTy: Type, Name: string | undefined): Value {
  return B.createCast("UIToFP", Val, DestTy, twine(Name, "LLVMBuildUIToFP"));
}

// llvm: llvm/lib/IR/Core.cpp:4329 LLVMBuildSIToFP
export function LLVMBuildSIToFP(B: IRBuilder, Val: Value, DestTy: Type, Name: string | undefined): Value {
  return B.createCast("SIToFP", Val, DestTy, twine(Name, "LLVMBuildSIToFP"));
}

// llvm: llvm/lib/IR/Core.cpp:4334 LLVMBuildFPTrunc
export function LLVMBuildFPTrunc(B: IRBuilder, Val: Value, DestTy: Type, Name: string | undefined): Value {
  return B.createCast("FPTrunc", Val, DestTy, twine(Name, "LLVMBuildFPTrunc"));
}

// llvm: llvm/lib/IR/Core.cpp:4339 LLVMBuildFPExt
export function LLVMBuildFPExt(B: IRBuilder, Val: Value, DestTy: Type, Name: string | undefined): Value {
  return B.createCast("FPExt", Val, DestTy, twine(Name, "LLVMBuildFPExt"));
}

// llvm: llvm/lib/IR/Core.cpp:4344 LLVMBuildPtrToInt
export function LLVMBuildPtrToInt(B: IRBuilder, Val: Value, DestTy: Type, Name: string | undefined): Value {
  return B.createCast("PtrToInt", Val, DestTy, twine(Name, "LLVMBuildPtrToInt"));
}

// llvm: llvm/lib/IR/Core.cpp:4349 LLVMBuildIntToPtr
export function LLVMBuildIntToPtr(B: IRBuilder, Val: Value, DestTy: Type, Name: string | undefined): Value {
  return B.createCast("IntToPtr", Val, DestTy, twine(Name, "LLVMBuildIntToPtr"));
}

// llvm: llvm/lib/IR/Core.cpp:4354 LLVMBuildBitCast
export function LLVMBuildBitCast(B: IRBuilder, Val: Value, DestTy: Type, Name: string | undefined): Value {
  return B.createCast("BitCast", Val, DestTy, twine(Name, "LLVMBuildBitCast"));
}

// llvm: llvm/lib/IR/Core.cpp:4388 LLVMBuildPointerCast
export function LLVMBuildPointerCast(B: IRBuilder, Val: Value, DestTy: Type, Name: string | undefined): Value {
  return B.createPointerCast(Val, DestTy, twine(Name, "LLVMBuildPointerCast"));
}

// llvm: llvm/lib/IR/Core.cpp:4393 LLVMBuildIntCast2
export function LLVMBuildIntCast2(B: IRBuilder, Val: Value, DestTy: Type, IsSigned: Bool, Name: string | undefined): Value {
  return B.createIntCast(Val, DestTy, IsSigned.is_true(), twine(Name, "LLVMBuildIntCast2"));
}

// ---- comparisons and the rest ------------------------------------------------------------------------------------------

// llvm: llvm/lib/IR/Core.cpp:4419 LLVMBuildICmp
export function LLVMBuildICmp(B: IRBuilder, Op: number, LHS: Value, RHS: Value, Name: string | undefined): Value {
  // `static_cast<ICmpInst::Predicate>(Op)`: LLVMIntPredicate's values are ICmpInst's (32-41).
  return B.createICmp(Op, LHS, RHS, twine(Name, "LLVMBuildICmp"));
}

// llvm: llvm/lib/IR/Core.cpp:4426 LLVMBuildFCmp
export function LLVMBuildFCmp(B: IRBuilder, Op: number, LHS: Value, RHS: Value, Name: string | undefined): Value {
  return B.createFCmp(Op, LHS, RHS, twine(Name, "LLVMBuildFCmp"));
}

// llvm: llvm/lib/IR/Core.cpp:4435 LLVMBuildPhi
export function LLVMBuildPhi(B: IRBuilder, Ty: Type, Name: string | undefined): Value {
  return B.createPHI(Ty, twine(Name, "LLVMBuildPhi"));
}

// llvm: llvm/lib/IR/Core.cpp:4462 LLVMBuildSelect
export function LLVMBuildSelect(B: IRBuilder, If: Value, Then: Value, Else: Value, Name: string | undefined): Value {
  return B.createSelect(If, Then, Else, twine(Name, "LLVMBuildSelect"));
}

// llvm: llvm/lib/IR/Core.cpp:4469 LLVMBuildVAArg
export function LLVMBuildVAArg(B: IRBuilder, list: Value, Ty: Type, Name: string | undefined): Value {
  return B.createVAArg(list, Ty, twine(Name, "LLVMBuildVAArg"));
}

// llvm: llvm/lib/IR/Core.cpp:4474 LLVMBuildExtractElement
export function LLVMBuildExtractElement(B: IRBuilder, VecVal: Value, Index: Value, Name: string | undefined): Value {
  return B.createExtractElement(VecVal, Index, twine(Name, "LLVMBuildExtractElement"));
}

// llvm: llvm/lib/IR/Core.cpp:4480 LLVMBuildInsertElement
export function LLVMBuildInsertElement(B: IRBuilder, VecVal: Value, EltVal: Value, Index: Value, Name: string | undefined): Value {
  return B.createInsertElement(VecVal, EltVal, Index, twine(Name, "LLVMBuildInsertElement"));
}

// llvm: llvm/lib/IR/Core.cpp:4487 LLVMBuildShuffleVector
export function LLVMBuildShuffleVector(B: IRBuilder, V1: Value, V2: Value, Mask: Value, Name: string | undefined): Value {
  return B.createShuffleVector(V1, V2, Mask, twine(Name, "LLVMBuildShuffleVector"));
}

// llvm: llvm/lib/IR/Core.cpp:4494 LLVMBuildExtractValue
export function LLVMBuildExtractValue(B: IRBuilder, AggVal: Value, Index: number, Name: string | undefined): Value {
  return B.createExtractValue(AggVal, [Index], twine(Name, "LLVMBuildExtractValue"));
}

// llvm: llvm/lib/IR/Core.cpp:4499 LLVMBuildInsertValue
export function LLVMBuildInsertValue(B: IRBuilder, AggVal: Value, EltVal: Value, Index: number, Name: string | undefined): Value {
  return B.createInsertValue(AggVal, EltVal, [Index], twine(Name, "LLVMBuildInsertValue"));
}

// llvm: llvm/lib/IR/Core.cpp:1774 LLVMConstVector
export function LLVMConstVector(ScalarConstantVals: readonly Value[], Size: number): Value {
  return getConstantVector(ScalarConstantVals.slice(0, Size) as Constant[]);
}

// ---- operand bundles, calls and invokes --------------------------------------------------------------------------------

// llvm: llvm/lib/IR/Core.cpp:2848 LLVMCreateOperandBundle
export function LLVMCreateOperandBundle(Tag: PtrLenStr | undefined, TagLen: number, Args: readonly Value[], NumArgs: number): OperandBundleDef | undefined {
  // `std::string(Tag, TagLen)`.
  const tag = Tag === undefined ? "" : typeof Tag === "string" ? Buffer.from(Tag, "utf8").subarray(0, TagLen).toString("latin1") : Buffer.from(Tag.subarray(0, TagLen)).toString("latin1");
  return new OperandBundleDef(tag, Args.slice(0, NumArgs));
}

// llvm: llvm/lib/IR/Core.cpp:2855 LLVMDisposeOperandBundle
export function LLVMDisposeOperandBundle(_Bundle: OperandBundleDef): void {
  // Garbage collection deletes the bundle.
}

// llvm: llvm/lib/IR/Core.cpp:4448 LLVMBuildCallWithOperandBundles
export function LLVMBuildCallWithOperandBundles(B: IRBuilder, Ty: Type, Fn: Value, Args: readonly Value[], NumArgs: number, Bundles: readonly OperandBundleDef[], NumBundles: number, Name: string | undefined): Value {
  return B.createCall(Ty as FunctionType, Fn, Args.slice(0, NumArgs), Bundles.slice(0, NumBundles), twine(Name, "LLVMBuildCallWithOperandBundles"));
}

// llvm: llvm/lib/IR/Core.cpp:3603 LLVMBuildInvokeWithOperandBundles
export function LLVMBuildInvokeWithOperandBundles(B: IRBuilder, Ty: Type, Fn: Value, Args: readonly Value[], NumArgs: number, Then: BasicBlock, Catch: BasicBlock, Bundles: readonly OperandBundleDef[], NumBundles: number, Name: string | undefined): Value {
  return B.createInvoke(Ty as FunctionType, Fn, Then, Catch, Args.slice(0, NumArgs), Bundles.slice(0, NumBundles), twine(Name, "LLVMBuildInvokeWithOperandBundles"));
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:411 LLVMRustAddCallSiteAttributes
export function LLVMRustAddCallSiteAttributes(Instr: Value, index: number, Attrs: readonly Attribute[], AttrsLen: number): void {
  // `AddAttributes(Call, Index, ...)`: an AttrBuilder over the index's attributes; `addAttribute` replaces one of the same kind.
  const c = asInst(Instr, "CallBase");
  if (!c.isCallBase()) throw new Error("llvm: unwrap<CallBase> of an instruction that is not a call");
  let set = c.attributes.get(index);
  if (set === undefined) c.attributes.set(index, (set = new Map()));
  for (const a of Attrs.slice(0, AttrsLen)) set.set(a.slot, a);
}

// ---- fast-math flags ---------------------------------------------------------------------------------------------------

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:606 LLVMRustSetFastMath
export function LLVMRustSetFastMath(Instr: Value): void {
  if (Instr instanceof Inst) Instr.fmf = 127; // `setFast(true)`: every flag.
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:620 LLVMRustSetAlgebraicMath
export function LLVMRustSetAlgebraicMath(Instr: Value): void {
  if (Instr instanceof Inst) Instr.fmf |= FMF.AllowReassoc | FMF.AllowContract | FMF.AllowReciprocal | FMF.NoSignedZeros;
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:637 LLVMRustSetAllowReassoc
export function LLVMRustSetAllowReassoc(Instr: Value): void {
  if (Instr instanceof Inst) Instr.fmf |= FMF.AllowReassoc;
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:644 LLVMRustSetNoSignedZeros
export function LLVMRustSetNoSignedZeros(Instr: Value): void {
  if (Instr instanceof Inst) Instr.fmf |= FMF.NoSignedZeros;
}

// ---- memory intrinsics -------------------------------------------------------------------------------------------------

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1372 LLVMRustBuildMemCpy
export function LLVMRustBuildMemCpy(B: IRBuilder, Dst: Value, DstAlign: number, Src: Value, SrcAlign: number, Size: Value, IsVolatile: boolean): Value {
  // `CreateMemCpy(Dst, MaybeAlign(DstAlign), Src, MaybeAlign(SrcAlign), Size, IsVolatile)` -> `CreateMemTransferInst(memcpy, ...)`.
  return B.createMemTransferInst("memcpy", Dst, DstAlign, Src, SrcAlign, Size, IsVolatile);
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1383 LLVMRustBuildMemMove
export function LLVMRustBuildMemMove(B: IRBuilder, Dst: Value, DstAlign: number, Src: Value, SrcAlign: number, Size: Value, IsVolatile: boolean): Value {
  return B.createMemTransferInst("memmove", Dst, DstAlign, Src, SrcAlign, Size, IsVolatile);
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1395 LLVMRustBuildMemSet
export function LLVMRustBuildMemSet(B: IRBuilder, Dst: Value, DstAlign: number, Val: Value, Size: Value, IsVolatile: boolean): Value {
  // `CreateMemSet(Dst, Val, Size, MaybeAlign(DstAlign), IsVolatile)`.
  return B.createMemSet(Dst, Val, Size, DstAlign, IsVolatile);
}
