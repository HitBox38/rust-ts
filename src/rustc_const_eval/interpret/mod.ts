//! An interpreter for MIR used in CTFE and by miri
// Port of compiler/rustc_const_eval/src/interpret/mod.rs (lane interp-contract, plan-m4 D8). The `mod` lines load the
// files in upstream order after `eval_context.ts` (it defines `InterpCx`, which the others extend at load; header of
// eval_context.ts: init order); the `pub use` lines are re-exports.
import "./eval_context.ts";
// mod call;
import "./call.ts";
// mod cast;
import "./cast.ts";
// mod discriminant;
import "./discriminant.ts";
// mod eval_context;
// mod intern;
import "./intern.ts";
// mod intrinsics;
import "./intrinsics.ts";
import "./intrinsics/atomic.ts";
import "./intrinsics/simd.ts";
// mod machine;
import "./machine.ts";
// mod memory;
import "./memory.ts";
// mod operand;
import "./operand.ts";
// mod operator;
import "./operator.ts";
// mod place;
import "./place.ts";
// mod projection;
import "./projection.ts";
// mod stack;
import "./stack.ts";
// mod step;
import "./step.ts";
// mod traits;
import "./traits.ts";
// mod util;
import "./util.ts";
// mod validity;
import "./validity.ts";
// mod visitor;
import "./visitor.ts";

// #[doc(no_inline)]
// pub use rustc_middle::mir::interpret::*; // have all the `interpret` symbols in one place: here
export * from "../../rustc_middle/mir/interpret/mod.ts";

// pub use self::call::FnArg;
export { FnArg } from "./call.ts";
// pub use self::eval_context::InterpCx;
export { InterpCx } from "./eval_context.ts";
// use self::eval_context::{from_known_layout, mir_assign_valid_types};
export { from_known_layout, mir_assign_valid_types } from "./eval_context.ts";
// pub use self::intern::{HasStaticRootDefId, InternError, InternKind, intern_const_alloc_for_constprop, intern_const_alloc_recursive};
export { type HasStaticRootDefId, InternError, InternKind, intern_const_alloc_for_constprop, intern_const_alloc_recursive } from "./intern.ts";
// pub use self::intrinsics::VarArgCompatible;
export { VarArgCompatible } from "./intrinsics.ts";
// pub use self::machine::{AllocMap, Machine, MayLeak, RetagMode, ReturnAction, compile_time_machine};
export { type AllocMap, type Machine, type MayLeak, RetagMode, ReturnAction, compile_time_machine } from "./machine.ts";
// pub use self::memory::{AllocInfo, AllocKind, AllocRef, AllocRefMut, FnVal, Memory, MemoryKind};
export { AllocInfo, AllocKind, AllocRef, AllocRefMut, FnVal, Memory, MemoryKind } from "./memory.ts";
// use self::operand::Operand;
export type { Operand } from "./operand.ts";
// pub use self::operand::{ImmTy, Immediate, OpTy};
export { ImmTy, Immediate, OpTy } from "./operand.ts";
// pub use self::operator::AtomicRmwOp;
export { AtomicRmwOp } from "./operator.ts";
// pub use self::place::{MPlaceTy, MemPlaceMeta, PlaceTy, Writeable};
export { MPlaceTy, MemPlaceMeta, PlaceTy, type Writeable } from "./place.ts";
// use self::place::{MemPlace, Place};
export { MemPlace, type Place } from "./place.ts";
// pub use self::projection::{OffsetMode, Projectable};
export { OffsetMode, type Projectable } from "./projection.ts";
// pub use self::stack::{Frame, FrameInfo, LocalState, ReturnContinuation};
export { Frame, FrameInfo, LocalState, type ReturnContinuation } from "./stack.ts";
// pub use self::util::EnteredTraceSpan;
export { type EnteredTraceSpan } from "./util.ts";
// pub(crate) use self::util::{create_static_alloc, ensure_monomorphic_enough, type_implements_dyn_trait};
export { create_static_alloc, ensure_monomorphic_enough, type_implements_dyn_trait } from "./util.ts";
// pub use self::validity::{CtfeValidationMode, RangeSet, RefTracking};
export { CtfeValidationMode, type RangeSet, RefTracking } from "./validity.ts";
// pub use self::visitor::ValueVisitor;
export { type ValueVisitor } from "./visitor.ts";
