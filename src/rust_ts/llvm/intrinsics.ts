// rust-ts: the IR model's intrinsic lookup and declaration (lane cg-intrinsic-a; plan-m7 §2c "intrinsic name mangling"): the
// ffi.rs functions `LLVMLookupIntrinsicID`, `LLVMIntrinsicIsOverloaded`, `LLVMGetIntrinsicDeclaration` and the wrapper
// `LLVMRustIsTargetIntrinsic`. Not ported rustc code; it follows LLVM's Intrinsics.cpp (markers) over two tables.
//
// - **The generic name table** (`GENERIC_INTRINSICS`) is LLVM's `IntrinsicNameTable` for the target-independent intrinsics, in
//   its order (sorted), with each one's `isOverloaded` bit: IDs 1..534 of the pinned LLVM, read out of the oracle toolchain's own
//   libLLVM.dylib (`LLVMIntrinsicGetName` / `LLVMIntrinsicIsOverloaded` for every ID, up to the first name out of sort order,
//   where the first target table starts). The table is data from the oracle, as the Unicode tables are; intrinsics.oracle.test.ts
//   re-reads it from libLLVM.dylib and fails on any difference. An intrinsic's ID is its index in the table plus one, LLVM's own
//   enum value (`IntrinsicNameOffsetTable[1 + Offset]`, generic `Offset` 0).
// - **Target tables are not in the model.** A name whose first component is one of `TARGET_PREFIXES` (the targets of the pinned
//   LLVM's `TargetInfos`, from the same read) is looked up in its target's table, which the model does not have: it stops
//   (`unported`). Looking it up in the generic table instead would answer "not an intrinsic" where LLVM finds one.
// - **Signatures** (`SIGNATURES`) are written from Intrinsics.td at the pin (`llvm/include/llvm/IR/Intrinsics.td`, cited per
//   entry) for the intrinsics rustc_codegen_llvm's scalar half names: intrinsic.rs:1-2046 and builder.rs's `call_intrinsic`
//   uses that are not vector-only. `LLVMGetIntrinsicDeclaration` of any other intrinsic stops. intrinsics.oracle.test.ts checks
//   every signature against libLLVM.dylib's declaration (name and function type) for concrete overload types.
// - PORT: `Intrinsic::getAttributes` is not applied to a new declaration (llir-core-a PORT decision 5, ir.ts `Function`): the
//   parser replaces an intrinsic declaration's attributes, so the normal form cannot see them (plan-m7 §1b).
// - `LLVMRustUpgradeIntrinsicFunction` (AutoUpgrade.cpp) stays a stub in ffi.ts.
import { unported } from "../../std/panic.ts";
import { Function, FunctionType, IntegerType, type Module, PointerType, StructType, type Type, type Value, VectorType, ArrayType, bstrOfBytes, bstrOfString } from "./ir.ts";
import { Bool, type PtrLenStr } from "./support.ts";

/** `IntrinsicNameTable` (generic part) at the pin: `[name, isOverloaded]`, sorted; an intrinsic's ID is its index + 1 (header). */
// prettier-ignore
export const GENERIC_INTRINSICS: readonly (readonly [string, 0 | 1])[] = [
  ["llvm.abs", 1], ["llvm.acos", 1], ["llvm.addressofreturnaddress", 1], ["llvm.adjust.trampoline", 0],
  ["llvm.alloc.token.id", 1], ["llvm.allow.runtime.check", 0], ["llvm.allow.sanitize.address", 0],
  ["llvm.allow.sanitize.hwaddress", 0], ["llvm.allow.sanitize.memory", 0], ["llvm.allow.sanitize.thread", 0],
  ["llvm.allow.ubsan.check", 0], ["llvm.annotation", 1], ["llvm.arithmetic.fence", 1], ["llvm.asan.check.memaccess", 0],
  ["llvm.asin", 1], ["llvm.assume", 0], ["llvm.atan", 1], ["llvm.atan2", 1], ["llvm.bitreverse", 1], ["llvm.bswap", 1],
  ["llvm.call.preallocated.arg", 0], ["llvm.call.preallocated.setup", 0], ["llvm.call.preallocated.teardown", 0],
  ["llvm.callbr.landingpad", 1], ["llvm.canonicalize", 1], ["llvm.ceil", 1], ["llvm.clear_cache", 1], ["llvm.clmul", 1],
  ["llvm.codeview.annotation", 0], ["llvm.cond.loop", 0], ["llvm.convert.from.arbitrary.fp", 1],
  ["llvm.convert.to.arbitrary.fp", 1], ["llvm.copysign", 1], ["llvm.coro.align", 1], ["llvm.coro.alloc", 0],
  ["llvm.coro.alloca.alloc", 1], ["llvm.coro.alloca.free", 0], ["llvm.coro.alloca.get", 0], ["llvm.coro.async.context.alloc", 0],
  ["llvm.coro.async.context.dealloc", 0], ["llvm.coro.async.resume", 0], ["llvm.coro.async.size.replace", 0],
  ["llvm.coro.await.suspend.bool", 0], ["llvm.coro.await.suspend.handle", 0], ["llvm.coro.await.suspend.void", 0],
  ["llvm.coro.begin", 0], ["llvm.coro.begin.custom.abi", 0], ["llvm.coro.dead", 0], ["llvm.coro.destroy", 0],
  ["llvm.coro.done", 0], ["llvm.coro.end", 0], ["llvm.coro.end.async", 0], ["llvm.coro.end.results", 0], ["llvm.coro.frame", 0],
  ["llvm.coro.free", 0], ["llvm.coro.id", 0], ["llvm.coro.id.async", 0], ["llvm.coro.id.retcon", 0],
  ["llvm.coro.id.retcon.once", 0], ["llvm.coro.is_in_ramp", 0], ["llvm.coro.noop", 0], ["llvm.coro.prepare.async", 0],
  ["llvm.coro.prepare.retcon", 0], ["llvm.coro.promise", 0], ["llvm.coro.resume", 0], ["llvm.coro.save", 0],
  ["llvm.coro.size", 1], ["llvm.coro.subfn.addr", 0], ["llvm.coro.suspend", 0], ["llvm.coro.suspend.async", 1],
  ["llvm.coro.suspend.retcon", 1], ["llvm.cos", 1], ["llvm.cosh", 1], ["llvm.ctlz", 1], ["llvm.ctpop", 1], ["llvm.cttz", 1],
  ["llvm.dbg.assign", 0], ["llvm.dbg.declare", 0], ["llvm.dbg.label", 0], ["llvm.dbg.value", 0], ["llvm.debugtrap", 0],
  ["llvm.donothing", 0], ["llvm.eh.dwarf.cfa", 0], ["llvm.eh.exceptioncode", 0], ["llvm.eh.exceptionpointer", 1],
  ["llvm.eh.recoverfp", 0], ["llvm.eh.return.i32", 0], ["llvm.eh.return.i64", 0], ["llvm.eh.sjlj.callsite", 0],
  ["llvm.eh.sjlj.functioncontext", 0], ["llvm.eh.sjlj.longjmp", 0], ["llvm.eh.sjlj.lsda", 0], ["llvm.eh.sjlj.setjmp", 0],
  ["llvm.eh.sjlj.setup.dispatch", 0], ["llvm.eh.typeid.for", 1], ["llvm.eh.unwind.init", 0], ["llvm.exp", 1], ["llvm.exp10", 1],
  ["llvm.exp2", 1], ["llvm.expect", 1], ["llvm.expect.with.probability", 1], ["llvm.experimental.constrained.acos", 1],
  ["llvm.experimental.constrained.asin", 1], ["llvm.experimental.constrained.atan", 1],
  ["llvm.experimental.constrained.atan2", 1], ["llvm.experimental.constrained.ceil", 1],
  ["llvm.experimental.constrained.cos", 1], ["llvm.experimental.constrained.cosh", 1], ["llvm.experimental.constrained.exp", 1],
  ["llvm.experimental.constrained.exp2", 1], ["llvm.experimental.constrained.fadd", 1],
  ["llvm.experimental.constrained.fcmp", 1], ["llvm.experimental.constrained.fcmps", 1],
  ["llvm.experimental.constrained.fdiv", 1], ["llvm.experimental.constrained.floor", 1],
  ["llvm.experimental.constrained.fma", 1], ["llvm.experimental.constrained.fmul", 1],
  ["llvm.experimental.constrained.fmuladd", 1], ["llvm.experimental.constrained.fpext", 1],
  ["llvm.experimental.constrained.fptosi", 1], ["llvm.experimental.constrained.fptoui", 1],
  ["llvm.experimental.constrained.fptrunc", 1], ["llvm.experimental.constrained.frem", 1],
  ["llvm.experimental.constrained.fsub", 1], ["llvm.experimental.constrained.ldexp", 1],
  ["llvm.experimental.constrained.llrint", 1], ["llvm.experimental.constrained.llround", 1],
  ["llvm.experimental.constrained.log", 1], ["llvm.experimental.constrained.log10", 1],
  ["llvm.experimental.constrained.log2", 1], ["llvm.experimental.constrained.lrint", 1],
  ["llvm.experimental.constrained.lround", 1], ["llvm.experimental.constrained.maximum", 1],
  ["llvm.experimental.constrained.maxnum", 1], ["llvm.experimental.constrained.minimum", 1],
  ["llvm.experimental.constrained.minnum", 1], ["llvm.experimental.constrained.nearbyint", 1],
  ["llvm.experimental.constrained.pow", 1], ["llvm.experimental.constrained.powi", 1], ["llvm.experimental.constrained.rint", 1],
  ["llvm.experimental.constrained.round", 1], ["llvm.experimental.constrained.roundeven", 1],
  ["llvm.experimental.constrained.sin", 1], ["llvm.experimental.constrained.sinh", 1],
  ["llvm.experimental.constrained.sitofp", 1], ["llvm.experimental.constrained.sqrt", 1],
  ["llvm.experimental.constrained.tan", 1], ["llvm.experimental.constrained.tanh", 1],
  ["llvm.experimental.constrained.trunc", 1], ["llvm.experimental.constrained.uitofp", 1],
  ["llvm.experimental.convergence.anchor", 0], ["llvm.experimental.convergence.entry", 0],
  ["llvm.experimental.convergence.loop", 0], ["llvm.experimental.cttz.elts", 1], ["llvm.experimental.deoptimize", 1],
  ["llvm.experimental.gc.get.pointer.base", 1], ["llvm.experimental.gc.get.pointer.offset", 1],
  ["llvm.experimental.gc.relocate", 1], ["llvm.experimental.gc.result", 1], ["llvm.experimental.gc.statepoint", 1],
  ["llvm.experimental.get.vector.length", 1], ["llvm.experimental.guard", 0], ["llvm.experimental.memset.pattern", 1],
  ["llvm.experimental.noalias.scope.decl", 0], ["llvm.experimental.patchpoint", 1], ["llvm.experimental.patchpoint.void", 0],
  ["llvm.experimental.stackmap", 0], ["llvm.experimental.vector.compress", 1],
  ["llvm.experimental.vector.extract.last.active", 1], ["llvm.experimental.vector.histogram.add", 1],
  ["llvm.experimental.vector.histogram.uadd.sat", 1], ["llvm.experimental.vector.histogram.umax", 1],
  ["llvm.experimental.vector.histogram.umin", 1], ["llvm.experimental.vector.match", 1], ["llvm.experimental.vp.reverse", 1],
  ["llvm.experimental.vp.splice", 1], ["llvm.experimental.vp.strided.load", 1], ["llvm.experimental.vp.strided.store", 1],
  ["llvm.experimental.widenable.condition", 0], ["llvm.fabs", 1], ["llvm.fake.use", 0], ["llvm.floor", 1], ["llvm.fma", 1],
  ["llvm.fmuladd", 1], ["llvm.fptosi.sat", 1], ["llvm.fptoui.sat", 1], ["llvm.fptrunc.round", 1], ["llvm.frameaddress", 1],
  ["llvm.frexp", 1], ["llvm.fshl", 1], ["llvm.fshr", 1], ["llvm.gcread", 0], ["llvm.gcroot", 0], ["llvm.gcwrite", 0],
  ["llvm.get.active.lane.mask", 1], ["llvm.get.dynamic.area.offset", 1], ["llvm.get.fpenv", 1], ["llvm.get.fpmode", 1],
  ["llvm.get.rounding", 0], ["llvm.hwasan.check.memaccess", 0], ["llvm.hwasan.check.memaccess.fixedshadow", 0],
  ["llvm.hwasan.check.memaccess.shortgranules", 0], ["llvm.hwasan.check.memaccess.shortgranules.fixedshadow", 0],
  ["llvm.icall.branch.funnel", 0], ["llvm.init.trampoline", 0], ["llvm.instrprof.callsite", 0], ["llvm.instrprof.cover", 0],
  ["llvm.instrprof.increment", 0], ["llvm.instrprof.increment.step", 0], ["llvm.instrprof.mcdc.parameters", 0],
  ["llvm.instrprof.mcdc.tvbitmap.update", 0], ["llvm.instrprof.timestamp", 0], ["llvm.instrprof.value.profile", 0],
  ["llvm.invariant.end", 1], ["llvm.invariant.start", 1], ["llvm.is.constant", 1], ["llvm.is.fpclass", 1],
  ["llvm.launder.invariant.group", 1], ["llvm.ldexp", 1], ["llvm.lifetime.end", 1], ["llvm.lifetime.start", 1],
  ["llvm.llrint", 1], ["llvm.llround", 1], ["llvm.load.relative", 1], ["llvm.localaddress", 0], ["llvm.localescape", 0],
  ["llvm.localrecover", 0], ["llvm.log", 1], ["llvm.log10", 1], ["llvm.log2", 1], ["llvm.loop.decrement", 1],
  ["llvm.loop.decrement.reg", 1], ["llvm.loop.dependence.raw.mask", 1], ["llvm.loop.dependence.war.mask", 1],
  ["llvm.looptrap", 0], ["llvm.lrint", 1], ["llvm.lround", 1], ["llvm.masked.compressstore", 1], ["llvm.masked.expandload", 1],
  ["llvm.masked.gather", 1], ["llvm.masked.load", 1], ["llvm.masked.scatter", 1], ["llvm.masked.sdiv", 1],
  ["llvm.masked.srem", 1], ["llvm.masked.store", 1], ["llvm.masked.udiv", 1], ["llvm.masked.urem", 1],
  ["llvm.matrix.column.major.load", 1], ["llvm.matrix.column.major.store", 1], ["llvm.matrix.multiply", 1],
  ["llvm.matrix.transpose", 1], ["llvm.maximum", 1], ["llvm.maximumnum", 1], ["llvm.maxnum", 1], ["llvm.memcpy", 1],
  ["llvm.memcpy.element.unordered.atomic", 1], ["llvm.memcpy.inline", 1], ["llvm.memmove", 1],
  ["llvm.memmove.element.unordered.atomic", 1], ["llvm.memset", 1], ["llvm.memset.element.unordered.atomic", 1],
  ["llvm.memset.inline", 1], ["llvm.minimum", 1], ["llvm.minimumnum", 1], ["llvm.minnum", 1], ["llvm.modf", 1],
  ["llvm.nearbyint", 1], ["llvm.objc.arc.annotation.bottomup.bbend", 0], ["llvm.objc.arc.annotation.bottomup.bbstart", 0],
  ["llvm.objc.arc.annotation.topdown.bbend", 0], ["llvm.objc.arc.annotation.topdown.bbstart", 0], ["llvm.objc.autorelease", 0],
  ["llvm.objc.autoreleasePoolPop", 0], ["llvm.objc.autoreleasePoolPush", 0], ["llvm.objc.autoreleaseReturnValue", 0],
  ["llvm.objc.claimAutoreleasedReturnValue", 0], ["llvm.objc.clang.arc.noop.use", 0], ["llvm.objc.clang.arc.use", 0],
  ["llvm.objc.copyWeak", 0], ["llvm.objc.destroyWeak", 0], ["llvm.objc.initWeak", 0], ["llvm.objc.loadWeak", 0],
  ["llvm.objc.loadWeakRetained", 0], ["llvm.objc.moveWeak", 0], ["llvm.objc.release", 0], ["llvm.objc.retain", 0],
  ["llvm.objc.retain.autorelease", 0], ["llvm.objc.retainAutorelease", 0], ["llvm.objc.retainAutoreleaseReturnValue", 0],
  ["llvm.objc.retainAutoreleasedReturnValue", 0], ["llvm.objc.retainBlock", 0], ["llvm.objc.retainedObject", 0],
  ["llvm.objc.storeStrong", 0], ["llvm.objc.storeWeak", 0], ["llvm.objc.sync.enter", 0], ["llvm.objc.sync.exit", 0],
  ["llvm.objc.unretainedObject", 0], ["llvm.objc.unretainedPointer", 0], ["llvm.objc.unsafeClaimAutoreleasedReturnValue", 0],
  ["llvm.objectsize", 1], ["llvm.pcmarker", 0], ["llvm.pdep", 1], ["llvm.pext", 1], ["llvm.pow", 1], ["llvm.powi", 1],
  ["llvm.prefetch", 1], ["llvm.preserve.array.access.index", 1], ["llvm.preserve.static.offset", 0],
  ["llvm.preserve.struct.access.index", 1], ["llvm.preserve.union.access.index", 1], ["llvm.protected.field.ptr", 1],
  ["llvm.pseudoprobe", 0], ["llvm.ptr.annotation", 1], ["llvm.ptrauth.auth", 0], ["llvm.ptrauth.auth.with.pc.and.resign", 0],
  ["llvm.ptrauth.blend", 0], ["llvm.ptrauth.resign", 0], ["llvm.ptrauth.resign.load.relative", 0], ["llvm.ptrauth.sign", 0],
  ["llvm.ptrauth.sign.generic", 0], ["llvm.ptrauth.strip", 0], ["llvm.ptrmask", 1], ["llvm.public.type.test", 0],
  ["llvm.read_register", 1], ["llvm.read_volatile_register", 1], ["llvm.readcyclecounter", 0], ["llvm.readsteadycounter", 0],
  ["llvm.reloc.none", 0], ["llvm.reset.fpenv", 0], ["llvm.reset.fpmode", 0], ["llvm.returnaddress", 1], ["llvm.rint", 1],
  ["llvm.round", 1], ["llvm.roundeven", 1], ["llvm.sadd.sat", 1], ["llvm.sadd.with.overflow", 1], ["llvm.scmp", 1],
  ["llvm.sdiv.fix", 1], ["llvm.sdiv.fix.sat", 1], ["llvm.seh.scope.begin", 0], ["llvm.seh.scope.end", 0],
  ["llvm.seh.try.begin", 0], ["llvm.seh.try.end", 0], ["llvm.set.fpenv", 1], ["llvm.set.fpmode", 1],
  ["llvm.set.loop.iterations", 1], ["llvm.set.rounding", 0], ["llvm.sideeffect", 0], ["llvm.sin", 1], ["llvm.sincos", 1],
  ["llvm.sincospi", 1], ["llvm.sinh", 1], ["llvm.smax", 1], ["llvm.smin", 1], ["llvm.smul.fix", 1], ["llvm.smul.fix.sat", 1],
  ["llvm.smul.with.overflow", 1], ["llvm.sponentry", 1], ["llvm.sqrt", 1], ["llvm.ssa.copy", 1], ["llvm.sshl.sat", 1],
  ["llvm.ssub.sat", 1], ["llvm.ssub.with.overflow", 1], ["llvm.stackaddress", 1], ["llvm.stackguard", 0],
  ["llvm.stackprotector", 0], ["llvm.stackrestore", 1], ["llvm.stacksave", 1], ["llvm.start.loop.iterations", 1],
  ["llvm.stepvector", 1], ["llvm.strip.invariant.group", 1], ["llvm.structured.alloca", 1], ["llvm.structured.gep", 1],
  ["llvm.swift.async.context.addr", 0], ["llvm.tan", 1], ["llvm.tanh", 1], ["llvm.test.set.loop.iterations", 1],
  ["llvm.test.start.loop.iterations", 1], ["llvm.thread.pointer", 1], ["llvm.threadlocal.address", 1], ["llvm.trap", 0],
  ["llvm.trunc", 1], ["llvm.type.checked.load", 0], ["llvm.type.checked.load.relative", 0], ["llvm.type.test", 0],
  ["llvm.uadd.sat", 1], ["llvm.uadd.with.overflow", 1], ["llvm.ubsantrap", 0], ["llvm.ucmp", 1], ["llvm.udiv.fix", 1],
  ["llvm.udiv.fix.sat", 1], ["llvm.umax", 1], ["llvm.umin", 1], ["llvm.umul.fix", 1], ["llvm.umul.fix.sat", 1],
  ["llvm.umul.with.overflow", 1], ["llvm.ushl.sat", 1], ["llvm.usub.sat", 1], ["llvm.usub.with.overflow", 1],
  ["llvm.va_copy", 1], ["llvm.va_end", 1], ["llvm.va_start", 1], ["llvm.var.annotation", 1], ["llvm.vector.deinterleave2", 1],
  ["llvm.vector.deinterleave3", 1], ["llvm.vector.deinterleave4", 1], ["llvm.vector.deinterleave5", 1],
  ["llvm.vector.deinterleave6", 1], ["llvm.vector.deinterleave7", 1], ["llvm.vector.deinterleave8", 1],
  ["llvm.vector.extract", 1], ["llvm.vector.insert", 1], ["llvm.vector.interleave2", 1], ["llvm.vector.interleave3", 1],
  ["llvm.vector.interleave4", 1], ["llvm.vector.interleave5", 1], ["llvm.vector.interleave6", 1], ["llvm.vector.interleave7", 1],
  ["llvm.vector.interleave8", 1], ["llvm.vector.partial.reduce.add", 1], ["llvm.vector.partial.reduce.fadd", 1],
  ["llvm.vector.reduce.add", 1], ["llvm.vector.reduce.and", 1], ["llvm.vector.reduce.fadd", 1], ["llvm.vector.reduce.fmax", 1],
  ["llvm.vector.reduce.fmaximum", 1], ["llvm.vector.reduce.fmin", 1], ["llvm.vector.reduce.fminimum", 1],
  ["llvm.vector.reduce.fmul", 1], ["llvm.vector.reduce.mul", 1], ["llvm.vector.reduce.or", 1], ["llvm.vector.reduce.smax", 1],
  ["llvm.vector.reduce.smin", 1], ["llvm.vector.reduce.umax", 1], ["llvm.vector.reduce.umin", 1], ["llvm.vector.reduce.xor", 1],
  ["llvm.vector.reverse", 1], ["llvm.vector.splice.left", 1], ["llvm.vector.splice.right", 1], ["llvm.vp.abs", 1],
  ["llvm.vp.add", 1], ["llvm.vp.and", 1], ["llvm.vp.ashr", 1], ["llvm.vp.bitreverse", 1], ["llvm.vp.bswap", 1],
  ["llvm.vp.ceil", 1], ["llvm.vp.copysign", 1], ["llvm.vp.ctlz", 1], ["llvm.vp.ctpop", 1], ["llvm.vp.cttz", 1],
  ["llvm.vp.cttz.elts", 1], ["llvm.vp.fabs", 1], ["llvm.vp.fadd", 1], ["llvm.vp.fcmp", 1], ["llvm.vp.fdiv", 1],
  ["llvm.vp.floor", 1], ["llvm.vp.fma", 1], ["llvm.vp.fmul", 1], ["llvm.vp.fmuladd", 1], ["llvm.vp.fneg", 1],
  ["llvm.vp.fpext", 1], ["llvm.vp.fptosi", 1], ["llvm.vp.fptoui", 1], ["llvm.vp.fptrunc", 1], ["llvm.vp.frem", 1],
  ["llvm.vp.fshl", 1], ["llvm.vp.fshr", 1], ["llvm.vp.fsub", 1], ["llvm.vp.gather", 1], ["llvm.vp.icmp", 1],
  ["llvm.vp.inttoptr", 1], ["llvm.vp.is.fpclass", 1], ["llvm.vp.llrint", 1], ["llvm.vp.load", 1], ["llvm.vp.load.ff", 1],
  ["llvm.vp.lrint", 1], ["llvm.vp.lshr", 1], ["llvm.vp.maximum", 1], ["llvm.vp.maxnum", 1], ["llvm.vp.merge", 1],
  ["llvm.vp.minimum", 1], ["llvm.vp.minnum", 1], ["llvm.vp.mul", 1], ["llvm.vp.nearbyint", 1], ["llvm.vp.or", 1],
  ["llvm.vp.ptrtoint", 1], ["llvm.vp.reduce.add", 1], ["llvm.vp.reduce.and", 1], ["llvm.vp.reduce.fadd", 1],
  ["llvm.vp.reduce.fmax", 1], ["llvm.vp.reduce.fmaximum", 1], ["llvm.vp.reduce.fmin", 1], ["llvm.vp.reduce.fminimum", 1],
  ["llvm.vp.reduce.fmul", 1], ["llvm.vp.reduce.mul", 1], ["llvm.vp.reduce.or", 1], ["llvm.vp.reduce.smax", 1],
  ["llvm.vp.reduce.smin", 1], ["llvm.vp.reduce.umax", 1], ["llvm.vp.reduce.umin", 1], ["llvm.vp.reduce.xor", 1],
  ["llvm.vp.rint", 1], ["llvm.vp.round", 1], ["llvm.vp.roundeven", 1], ["llvm.vp.roundtozero", 1], ["llvm.vp.sadd.sat", 1],
  ["llvm.vp.scatter", 1], ["llvm.vp.sdiv", 1], ["llvm.vp.select", 1], ["llvm.vp.sext", 1], ["llvm.vp.shl", 1],
  ["llvm.vp.sitofp", 1], ["llvm.vp.smax", 1], ["llvm.vp.smin", 1], ["llvm.vp.sqrt", 1], ["llvm.vp.srem", 1],
  ["llvm.vp.ssub.sat", 1], ["llvm.vp.store", 1], ["llvm.vp.sub", 1], ["llvm.vp.trunc", 1], ["llvm.vp.uadd.sat", 1],
  ["llvm.vp.udiv", 1], ["llvm.vp.uitofp", 1], ["llvm.vp.umax", 1], ["llvm.vp.umin", 1], ["llvm.vp.urem", 1],
  ["llvm.vp.usub.sat", 1], ["llvm.vp.xor", 1], ["llvm.vp.zext", 1], ["llvm.vscale", 1], ["llvm.write_register", 1],
  ["llvm.write_volatile_register", 1], ["llvm.xray.customevent", 0], ["llvm.xray.typedevent", 0],
];

/** `TargetInfos[1..]` at the pin: the target prefixes with a table of their own, sorted (header). */
export const TARGET_PREFIXES: readonly string[] = [
  "aarch64", "amdgcn", "arm", "avr", "bpf", "dx", "hexagon", "loongarch", "mips", "nvvm", "ppc", "r600", "riscv", "s390", "spv", "ve",
  "wasm", "x86", "xcore",
];

/** `Intrinsic::not_intrinsic`. */
const NOT_INTRINSIC = 0;

// ---- lookup (Intrinsics.cpp) -------------------------------------------------------------------------------------------

/** `strncmp(a + start, b + start, n)` over byte strings, a position past the end reading as the terminating NUL. */
function strncmp(a: string, b: string, start: number, n: number): number {
  for (let i = start; i < start + n; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    if (ca !== cb) return ca - cb;
    if (ca === 0) return 0;
  }
  return 0;
}

// llvm: llvm/lib/IR/Intrinsics.cpp:677 lookupLLVMIntrinsicByName
/** Looks up `name` in the generic table (`table[low..high)`, all of it) by successive binary searches of its dotted components;
 *  the index of an exact match or of a prefix followed by a dot, or -1. */
function lookupLLVMIntrinsicByName(table: readonly (readonly [string, 0 | 1])[], name: string): number {
  // The generic table: `Target` is empty, so only the "llvm" component is skipped.
  let cmpEnd = 4; // Skip the "llvm" component.
  let low = 0;
  let high = table.length;
  let lastLow = low;
  while (cmpEnd < name.length && high - low > 0) {
    const cmpStart = cmpEnd;
    const dot = name.indexOf(".", cmpStart + 1);
    cmpEnd = dot === -1 ? name.length : dot;
    // `std::equal_range(Low, High, Name.data(), Cmp)` with `Cmp` the strncmp of the component.
    const n = cmpEnd - cmpStart;
    lastLow = low;
    let lo = low;
    let hi = high;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (strncmp(table[mid]![0], name, cmpStart, n) < 0) lo = mid + 1;
      else hi = mid;
    }
    let up = lo;
    hi = high;
    while (up < hi) {
      const mid = (up + hi) >>> 1;
      if (strncmp(name, table[mid]![0], cmpStart, n) < 0) hi = mid;
      else up = mid + 1;
    }
    low = lo;
    high = up;
  }
  if (high - low > 0) lastLow = low;

  if (lastLow === table.length) return -1;
  const nameFound = table[lastLow]![0];
  if (name === nameFound || (name.startsWith(nameFound) && name.charCodeAt(nameFound.length) === 0x2e)) return lastLow;
  return -1;
}

// llvm: llvm/lib/IR/Intrinsics.cpp:740 findTargetSubtable
/** The generic table, or a stop for a target's own table (header). */
function findTargetSubtable(name: string): readonly (readonly [string, 0 | 1])[] {
  // Drop "llvm." and take the first dotted component. That will be the target if this is target specific.
  const rest = name.slice(5);
  const dot = rest.indexOf(".");
  const target = dot === -1 ? rest : rest.slice(0, dot);
  if (TARGET_PREFIXES.includes(target)) return unported(`llir: the ${target} intrinsic table (${bstrToDisplay(name)}; target intrinsics are not in the IR model)`);
  return GENERIC_INTRINSICS;
}

// llvm: llvm/lib/IR/Intrinsics.cpp:758 Intrinsic::lookupIntrinsicID
function lookupIntrinsicID(name: string): number {
  // `assert(Name.starts_with("llvm."))` (findTargetSubtable): an assertion, off in the oracle's build; what a release build
  // does with another name is not modelled.
  if (!name.startsWith("llvm.")) return unported(`llir: Intrinsic::lookupIntrinsicID of a name without the llvm. prefix (${bstrToDisplay(name)})`);
  const table = findTargetSubtable(name);
  const idx = lookupLLVMIntrinsicByName(table, name);
  if (idx === -1) return NOT_INTRINSIC;

  // Intrinsic IDs correspond to the location in IntrinsicNameTable (generic `Adjust` is 1).
  const id = idx + 1;

  // If the intrinsic is not overloaded, require an exact match. If it is overloaded, require either exact or prefix match.
  const matchSize = table[idx]![0].length;
  const isExactMatch = name.length === matchSize;
  return isExactMatch || isOverloaded(id) ? id : NOT_INTRINSIC;
}

// llvm: llvm/lib/IR/Intrinsics.cpp:650 Intrinsic::isOverloaded
function isOverloaded(id: number): boolean {
  return entry(id)[1] === 1;
}

// llvm: llvm/lib/IR/Intrinsics.cpp:669 Intrinsic::isTargetIntrinsic
function isTargetIntrinsic(id: number): boolean {
  // `IID > TargetInfos[0].Count`: the generic table's size.
  return id > GENERIC_INTRINSICS.length;
}

/** The generic table's entry of an ID the model handed out. */
function entry(id: number): readonly [string, 0 | 1] {
  const e = GENERIC_INTRINSICS[id - 1];
  if (id < 1 || e === undefined) return unported(`llir: intrinsic ID ${id} (not in the model's generic table)`);
  return e;
}

const bstrToDisplay = (s: string): string => JSON.stringify(s);

// ---- signatures (Intrinsics.td) ----------------------------------------------------------------------------------------

/** An Intrinsics.td type: `llvm_any*_ty` (an overload slot, numbered in order of appearance, return types first), `LLVMMatchType<n>`,
 *  a fixed type, or `LLVMScalarOrSameVectorWidth<n, elt>`. */
type TdType =
  | { readonly k: "any"; readonly cls: "any" | "int" | "float" | "ptr" }
  | { readonly k: "match"; readonly n: number }
  | { readonly k: "int"; readonly bits: number }
  | { readonly k: "ptr" }
  | { readonly k: "metadata" }
  | { readonly k: "sameVecWidth"; readonly n: number; readonly elt: TdType };

interface Signature {
  /** Intrinsics.td line of the `def`. */
  readonly td: number;
  readonly ret: readonly TdType[];
  readonly params: readonly TdType[];
}

const anyfloat: TdType = { k: "any", cls: "float" };
const anyint: TdType = { k: "any", cls: "int" };
const anyptr: TdType = { k: "any", cls: "ptr" };
const any_: TdType = { k: "any", cls: "any" };
const m = (n: number): TdType => ({ k: "match", n });
const i1: TdType = { k: "int", bits: 1 };
const i32: TdType = { k: "int", bits: 32 };
const ptr: TdType = { k: "ptr" };
const metadata: TdType = { k: "metadata" };
const unaryFloat = (td: number): Signature => ({ td, ret: [anyfloat], params: [m(0)] });
const binaryFloat = (td: number): Signature => ({ td, ret: [anyfloat], params: [m(0), m(0)] });
const binaryInt = (td: number): Signature => ({ td, ret: [anyint], params: [m(0), m(0)] });
const withOverflow = (td: number): Signature => ({ td, ret: [anyint, { k: "sameVecWidth", n: 0, elt: i1 }], params: [m(0), m(0)] });

/** The signatures the model declares, by intrinsic name (header); each cites its `def` in Intrinsics.td. */
const SIGNATURES: ReadonlyMap<string, Signature> = new Map<string, Signature>([
  ["llvm.va_start", { td: 864, ret: [], params: [anyptr] }],
  ["llvm.returnaddress", { td: 977, ret: [anyptr], params: [i32] }],
  ["llvm.prefetch", { td: 1043, ret: [], params: [anyptr, i32, i32, i32] }],
  ["llvm.assume", { td: 1060, ret: [], params: [i1] }],
  ["llvm.fma", { td: 1208, ret: [anyfloat], params: [m(0), m(0), m(0)] }],
  ["llvm.fmuladd", { td: 1211, ret: [anyfloat], params: [m(0), m(0), m(0)] }],
  ["llvm.sqrt", unaryFloat(1218)],
  ["llvm.powi", { td: 1219, ret: [anyfloat], params: [m(0), anyint] }],
  ["llvm.sin", unaryFloat(1221)],
  ["llvm.cos", unaryFloat(1222)],
  ["llvm.pow", binaryFloat(1223)],
  ["llvm.log", unaryFloat(1225)],
  ["llvm.log10", unaryFloat(1226)],
  ["llvm.log2", unaryFloat(1227)],
  ["llvm.exp", unaryFloat(1228)],
  ["llvm.exp2", unaryFloat(1229)],
  ["llvm.fabs", unaryFloat(1231)],
  ["llvm.copysign", binaryFloat(1232)],
  ["llvm.floor", unaryFloat(1234)],
  ["llvm.ceil", unaryFloat(1235)],
  ["llvm.trunc", unaryFloat(1236)],
  ["llvm.rint", unaryFloat(1237)],
  ["llvm.round", unaryFloat(1240)],
  ["llvm.minimum", binaryFloat(1319)],
  ["llvm.maximum", binaryFloat(1323)],
  ["llvm.minimumnum", binaryFloat(1327)],
  ["llvm.maximumnum", binaryFloat(1331)],
  ["llvm.expect", binaryInt(1599)],
  ["llvm.bswap", { td: 1612, ret: [anyint], params: [m(0)] }],
  ["llvm.ctpop", { td: 1613, ret: [anyint], params: [m(0)] }],
  ["llvm.bitreverse", { td: 1614, ret: [anyint], params: [m(0)] }],
  ["llvm.fshl", { td: 1615, ret: [anyint], params: [m(0), m(0), m(0)] }],
  ["llvm.fshr", { td: 1617, ret: [anyint], params: [m(0), m(0), m(0)] }],
  ["llvm.clmul", binaryInt(1619)],
  ["llvm.ctlz", { td: 1628, ret: [anyint], params: [m(0), i1] }],
  ["llvm.cttz", { td: 1630, ret: [anyint], params: [m(0), i1] }],
  ["llvm.sadd.with.overflow", withOverflow(1739)],
  ["llvm.uadd.with.overflow", withOverflow(1743)],
  ["llvm.ssub.with.overflow", withOverflow(1748)],
  ["llvm.usub.with.overflow", withOverflow(1752)],
  ["llvm.smul.with.overflow", withOverflow(1757)],
  ["llvm.umul.with.overflow", withOverflow(1761)],
  ["llvm.sadd.sat", binaryInt(1768)],
  ["llvm.uadd.sat", binaryInt(1772)],
  ["llvm.ssub.sat", binaryInt(1776)],
  ["llvm.usub.sat", binaryInt(1780)],
  ["llvm.smax", binaryInt(1836)],
  ["llvm.smin", binaryInt(1839)],
  ["llvm.umax", binaryInt(1842)],
  ["llvm.umin", binaryInt(1845)],
  ["llvm.scmp", { td: 1848, ret: [anyint], params: [anyint, m(1)] }],
  ["llvm.ucmp", { td: 1852, ret: [anyint], params: [anyint, m(1)] }],
  ["llvm.lifetime.start", { td: 1859, ret: [], params: [anyptr] }],
  ["llvm.lifetime.end", { td: 1862, ret: [], params: [anyptr] }],
  ["llvm.trap", { td: 2050, ret: [], params: [] }],
  ["llvm.debugtrap", { td: 2054, ret: [], params: [] }],
  ["llvm.fptoui.sat", { td: 2117, ret: [anyint], params: [anyfloat] }],
  ["llvm.fptosi.sat", { td: 2119, ret: [anyint], params: [anyfloat] }],
  ["llvm.is.constant", { td: 2129, ret: [i1], params: [any_] }],
  ["llvm.ptrmask", { td: 2139, ret: [any_], params: [m(0), anyint] }],
  ["llvm.threadlocal.address", { td: 2142, ret: [anyptr], params: [m(0)] }],
  ["llvm.type.checked.load", { td: 2801, ret: [ptr, i1], params: [ptr, i32, metadata] }],
]);

/** The names `SIGNATURES` covers, and each one's overload slots by class, in order (for tests). */
export const MODELLED_SIGNATURES: readonly string[] = [...SIGNATURES.keys()];
export function overloadClasses(name: string): ("any" | "int" | "float" | "ptr")[] {
  const sig = SIGNATURES.get(name);
  if (sig === undefined) throw new Error(`no modelled signature for ${name}`);
  return [...sig.ret, ...sig.params].flatMap((t) => (t.k === "any" ? [t.cls] : []));
}

/** The IIT descriptors of a signature, as `getIntrinsicInfoTableEntries` decodes them: an `any` type becomes an `Overloaded`
 *  descriptor numbered by its position among the `any` types. */
type Desc = { readonly k: "overloaded" | "match"; readonly idx: number } | { readonly k: "fixed"; readonly ty: TdType } | { readonly k: "sameVecWidth"; readonly idx: number; readonly elt: TdType };

function descriptors(sig: Signature): Desc[] {
  let next = 0;
  const one = (t: TdType): Desc => {
    switch (t.k) {
      case "any":
        return { k: "overloaded", idx: next++ };
      case "match":
        return { k: "match", idx: t.n };
      case "sameVecWidth":
        return { k: "sameVecWidth", idx: t.n, elt: t.elt };
      default:
        return { k: "fixed", ty: t };
    }
  };
  return [...sig.ret.map(one), ...sig.params.map(one)];
}

// llvm: llvm/lib/IR/Intrinsics.cpp:538 DecodeFixedType
function decodeFixedType(d: Desc, overloadTys: readonly Type[], m: Module): Type {
  const ctx = m.context;
  const overload = (idx: number): Type => {
    const t = overloadTys[idx];
    // `OverloadTys[D.getOverloadIndex()]` past the end: undefined behaviour in LLVM (a caller's error).
    if (t === undefined) throw new Error(`llvm: intrinsic overload type ${idx} missing (${overloadTys.length} given)`);
    return t;
  };
  const fixed = (t: TdType): Type => {
    switch (t.k) {
      case "int":
        return ctx.getIntType(t.bits);
      case "ptr":
        return ctx.getPointerType(0);
      case "metadata":
        return ctx.getMetadataType();
      default:
        throw new Error(`llir: a nested ${t.k} type in an intrinsic signature`);
    }
  };
  switch (d.k) {
    // For any overload type or partially dependent type, substitute it with the corresponding concrete type from OverloadTys.
    case "overloaded":
    case "match":
      return overload(d.idx);
    case "sameVecWidth": {
      const eltTy = fixed(d.elt);
      const ty = overload(d.idx);
      if (ty instanceof VectorType) return ctx.getVectorType(eltTy, ty.numElements, ty.scalable);
      return eltTy;
    }
    case "fixed":
      return fixed(d.ty);
  }
}

// llvm: llvm/lib/IR/Intrinsics.cpp:637 Intrinsic::getType
function getType(m: Module, id: number, overloadTys: readonly Type[]): FunctionType {
  const name = entry(id)[0];
  const sig = SIGNATURES.get(name);
  if (sig === undefined) return unported(`llir: the signature of ${name} (Intrinsics.td) is not in the IR model`);
  const table = descriptors(sig);
  const nRet = sig.ret.length;
  // The return type: void (no results), the type, or `StructType::get(Context, Elts)` of several (IIT_STRUCT).
  const rets = table.slice(0, nRet).map((d) => decodeFixedType(d, overloadTys, m));
  const resultTy = nRet === 0 ? m.context.getVoidType() : nRet === 1 ? rets[0]! : m.context.getLiteralStructType(rets, false);
  const argTys = table.slice(nRet).map((d) => decodeFixedType(d, overloadTys, m));
  // None of the modelled intrinsics is variadic (`llvm_vararg_ty`).
  return m.context.getFunctionType(resultTy, argTys, false);
}

// llvm: llvm/lib/IR/Intrinsics.cpp:86 getMangledTypeStr
function getMangledTypeStr(ty: Type, hasUnnamedType: { value: boolean }): string {
  let result = "";
  if (ty instanceof PointerType) {
    result += `p${ty.addressSpace}`;
  } else if (ty instanceof ArrayType) {
    result += `a${ty.numElements}${getMangledTypeStr(ty.elementType, hasUnnamedType)}`;
  } else if (ty instanceof StructType) {
    if (!ty.literal) {
      result += "s_";
      if (ty.name !== "") result += ty.name;
      else hasUnnamedType.value = true;
    } else {
      result += "sl_";
      for (const elem of ty.body ?? []) result += getMangledTypeStr(elem, hasUnnamedType);
    }
    // Ensure nested structs are distinguishable.
    result += "s";
  } else if (ty instanceof FunctionType) {
    result += `f_${getMangledTypeStr(ty.returnType, hasUnnamedType)}`;
    for (const p of ty.params) result += getMangledTypeStr(p, hasUnnamedType);
    if (ty.isVarArg) result += "vararg";
    // Ensure nested function types are distinguishable.
    result += "f";
  } else if (ty instanceof VectorType) {
    if (ty.scalable) result += "nx";
    result += `v${ty.numElements}${getMangledTypeStr(ty.elementType, hasUnnamedType)}`;
  } else if (ty instanceof IntegerType) {
    result += `i${ty.bits}`;
  } else {
    switch (ty.typeID) {
      case "Void":
        result += "isVoid";
        break;
      case "Metadata":
        result += "Metadata";
        break;
      case "Half":
        result += "f16";
        break;
      case "BFloat":
        result += "bf16";
        break;
      case "Float":
        result += "f32";
        break;
      case "Double":
        result += "f64";
        break;
      case "X86_FP80":
        result += "f80";
        break;
      case "FP128":
        result += "f128";
        break;
      case "PPC_FP128":
        result += "ppcf128";
        break;
      case "X86_AMX":
        result += "x86amx";
        break;
      default:
        // `llvm_unreachable("Unhandled type")`; target extension types are not in the model.
        return unported(`llir: getMangledTypeStr of a ${ty.typeID} type`);
    }
  }
  return result;
}

// llvm: llvm/lib/IR/Intrinsics.cpp:175 getIntrinsicNameImpl
function getIntrinsicNameImpl(id: number, overloadTys: readonly Type[]): string {
  const hasUnnamedType = { value: false };
  let result = entry(id)[0];
  for (const ty of overloadTys) result += `.${getMangledTypeStr(ty, hasUnnamedType)}`;
  // `M->getUniqueIntrinsicName(Result, Id, FT)` for an unnamed struct overload type: not in the model.
  if (hasUnnamedType.value) return unported(`llir: Module::getUniqueIntrinsicName (${result}, an unnamed type in an overloaded intrinsic)`);
  return result;
}

// llvm: llvm/lib/IR/Intrinsics.cpp:783 getOrInsertIntrinsicDeclarationImpl
function getOrInsertIntrinsicDeclarationImpl(m: Module, id: number, overloadTys: readonly Type[], ft: FunctionType): Function {
  // `Intrinsic::getName(id)` (the base name) or `Intrinsic::getName(id, OverloadTys, M, FT)`.
  const name = getIntrinsicNameImpl(id, overloadTys);
  const f = getOrInsertFunction(m, name, ft);
  if (f.functionType === ft) return f;

  // It's possible that a declaration for this intrinsic already exists with an incorrect signature, if the signature has
  // changed, but this particular declaration has not been auto-upgraded yet. In that case, rename the invalid declaration and
  // insert a new one with the correct signature. The invalid declaration will get upgraded later.
  f.setName(`${f.name}.invalid`);
  return getOrInsertFunction(m, name, ft);
}

/** `cast<Function>(M->getOrInsertFunction(Name, FT).getCallee())` (Module.cpp:211): the named value if there is one, else a
 *  new external declaration in the program address space. */
function getOrInsertFunction(m: Module, name: string, ft: FunctionType): Function {
  const existing = m.getNamedValue(name);
  if (existing === undefined) return new Function(ft, "ExternalLinkage", m.layoutAddressSpace("P"), name, m);
  // `cast<Function>` of a global variable: an assertion in LLVM, undefined behaviour in the oracle's release build.
  if (!(existing instanceof Function)) throw new Error(`llvm: cast<Function> of the global variable ${bstrToDisplay(name)}`);
  return existing;
}

// llvm: llvm/lib/IR/Intrinsics.cpp:802 Intrinsic::getOrInsertDeclaration
function getOrInsertDeclaration(m: Module, id: number, overloadTys: readonly Type[]): Function {
  // There can never be multiple globals with the same name of different types, because intrinsics must be a specific type.
  const ft = getType(m, id, overloadTys);
  return getOrInsertIntrinsicDeclarationImpl(m, id, overloadTys, ft);
}

// ---- the C API (Core.cpp) and rustc's wrapper ----------------------------------------------------------------------------

// llvm: llvm/lib/IR/Core.cpp:2611 LLVMLookupIntrinsicID
export function LLVMLookupIntrinsicID(Name: PtrLenStr | undefined, NameLen: number): number {
  // `{Name, NameLen}`: a StringRef of the first `NameLen` bytes.
  let name: string;
  if (Name === undefined) name = "";
  else if (typeof Name === "string") name = bstrOfString(Name).slice(0, NameLen);
  else name = bstrOfBytes(Name.subarray(0, NameLen));
  return lookupIntrinsicID(name);
}

// llvm: llvm/lib/IR/Core.cpp:2615 LLVMIntrinsicIsOverloaded
export function LLVMIntrinsicIsOverloaded(ID: number): Bool {
  // `llvm_map_to_intrinsic_id(ID)`: an assertion that the ID is in range.
  return Bool.from_bool(isOverloaded(ID));
}

// llvm: llvm/lib/IR/Core.cpp:2566 LLVMGetIntrinsicDeclaration
export function LLVMGetIntrinsicDeclaration(Mod: Module, ID: number, ParamTypes: readonly Type[], ParamCount: number): Value {
  const overloadTys = ParamTypes.slice(0, ParamCount);
  return getOrInsertDeclaration(Mod, ID, overloadTys);
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1730 LLVMRustIsTargetIntrinsic
export function LLVMRustIsTargetIntrinsic(ID: number): boolean {
  return isTargetIntrinsic(ID);
}
