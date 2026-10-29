// Port of compiler/rustc_const_eval/src/interpret/eval_context.rs (lane interp-contract, plan-m4 D8): the `InterpCx`
// contract. Its types are generated into eval_context.gen.ts (set rustc_const_eval_interpret); `InterpCx` and
// `PlacePrinter` are hand classes here.
//
// Representation (the contract of every interpret / const_eval fill lane; docs/handoff/interp-contract.md):
// - `InterpCx<'tcx, M: Machine<'tcx>>` is the class `InterpCx<M extends Machine = Machine>` with all fields in
//   declaration order. `impl InterpCx` is split over every interpret file (PORTING §5 "Methods defined in another file"):
//   each file declares its methods in `declare module "<..>/eval_context.ts" { interface InterpCx<M> { .. } }` and
//   assigns `InterpCx.prototype.<name>`; eval_context.rs's own methods (and its trait impls) are in the class body.
//   `CompileTimeInterpCx` (`InterpCx<CompileTimeMachine>`, const_eval/machine.ts) and `InterpCx<DummyMachine>` methods
//   (const_eval/*, intern.rs) are prototype methods of `InterpCx` too, with `this: CompileTimeInterpCx`.
// - The machine (interpret/machine.ts header): `M::f(self, ..)` is `this.machine.f(this, ..)`; associated types are erased
//   to the CTFE machines' (`M::Provenance` = `CtfeProvenance`, so `MPlaceTy<'tcx, M::Provenance>` is `MPlaceTy`, ...).
// - `Prov` of the value types is erased (D8; set `erase_params`): `Immediate`, `ImmTy`, `Operand`, `OpTy`, `MemPlace`,
//   `MPlaceTy`, `Place`, `PlaceTy`, `MemPlaceMeta`, `LocalState`, `LocalValue`, `FnArg`, `Frame` are over `CtfeProvenance`.
//   They are immutable values once built (`Copy`/`Clone` types are shared, never mutated in place; `clone_X` where
//   upstream clones and then mutates). `LocalState.value` and `Frame.loc` are the mutable fields.
// - Methods whose name clashes with a field get `_` (precedent `tcx_()`): `ImmTy` / `OpTy` / `MPlaceTy` / `PlaceTy`'s
//   `Projectable::layout()` is `layout_()`, `MPlaceTy::mplace()` is `mplace_()`, `PlaceTy::place()` is `place_()`,
//   `OpTy::op()` is `op_()`. `impl Deref for ImmTy` is `.deref()` (or the field `imm`).
// - Traits over the value types (`Projectable`, `Writeable`) are interfaces implemented by the classes' prototypes; a
//   generic `P: Projectable` is `P extends Projectable`. Enum methods are companion fns (`Immediate.to_scalar(imm)`).
// - `InterpResult<'tcx, T>` is mir/interpret's `Result<T, InterpErrorInfo>` (`InterpResult` = unit, `undefined`); `?` is
//   `if (r.$ === "Err") return r;`, `throw_*!(X)` is `return Err(InterpErrorInfo_from_InterpErrorKind({ .. }))` (the
//   `throw_ub!(..)` text stays as a comment). `layout_of` returns `Result<TyAndLayout, InterpErrorKind>` as upstream;
//   its `?` in an `InterpResult` fn converts with `InterpErrorInfo_from_InterpErrorKind`.
// - `u64` / `i64` / `u128` values are bigints, `Size` / `usize` are numbers (recorded decisions); `Either<L, R>` is
//   mir/mod.ts's `{ $: "Left" | "Right"; _0 }`.
// - `enter_trace_span!(..)` / `trace!` / `debug!` (tracing) are comments; `cfg!(debug_assertions)` blocks are skipped
//   (rustc ships without debug assertions).
// - Generic `T: TypeFoldable` fns take the fold descriptor (`d_T`), generic floats their `FloatType` dictionary.
//
// Init order (TDZ-free; checked by the contract test): this module value-imports only `.gen.ts` modules and other
// crates (never an interpret / const_eval hand module); the extension modules import it and assign to
// `InterpCx.prototype` at load; interpret/mod.ts imports them after this module. Reads of the hand modules from here
// happen at call time only. `crate::assert_typing_mode` (lib.ts) is read lazily.
import { type Align, type HasDataLayout, Size, type TargetDataLayout } from "../../rustc_abi/lib.ts";
import { FieldsShape } from "../../rustc_abi/lib.ts";
import { type Layout, TyAndLayout } from "../../rustc_abi/layout/ty.ts";
import type { Limit } from "../../rustc_structures/limit.ts";
import {
  ErrorHandled,
  GlobalId,
  InterpErrorInfo_from_ErrorHandled,
  type InterpErrorKind,
  InterpErrorInfo_from_InterpErrorKind,
  type InterpResult,
  interp_ok,
  PointerArithmetic_provided,
  ReportedErrorInfo,
  Scalar,
} from "../../rustc_middle/mir/interpret/mod.ts";
import type { MemPlaceMeta as gen_MemPlaceMeta } from "./place.gen.ts";
import { BasicBlock, type Body, Const as mir_Const, type ConstAlloc, type Either, type Promoted, type Location, type UnwindAction } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxtAt } from "../../rustc_middle/query/calls.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { FnAbi } from "../../rustc_middle/ty/decls.ts";
import { Instance, InstanceKind } from "../../rustc_middle/ty/instance.ts";
import {
  type FnAbiError,
  type FnAbiOf,
  FnAbiOf_provided,
  type FnAbiRequest,
  type LayoutError,
  type LayoutOf,
  LayoutOf_provided,
  type MaybeResult,
  MaybeResult_Result,
} from "../../rustc_middle/ty/layout.ts";
import type { List } from "../../rustc_middle/ty/list.ts";
import type { GenericArgsRef } from "../../rustc_middle/ty/generic_args.ts";
import type { Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import type { PolyFnSig } from "../../rustc_middle/ty/sty.ts";
import { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import { type Span } from "../../rustc_span/lib.ts";
import { span_bug } from "../../rustc_span/macros.ts";
import type { Float, FloatType } from "../../vendor/rustc_apfloat/lib.ts";
import { type Debug, debug_int, PLAIN } from "../../std/fmt.ts";
import { assert, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { Machine } from "./machine.ts";
import type { Memory } from "./memory.ts";
import type { MPlaceTy, Place, PlaceTy } from "./place.gen.ts";
import type { OpTy } from "./operand.gen.ts";
import type { Frame, FrameInfo } from "./stack.gen.ts";
import type { Projectable } from "./projection.ts";
import { debug_Const, debug_Local } from "../../rustc_middle/mir/mod.ts";
import { type AllocId, debug_Pointer_Option, debug_CtfeProvenance, Provenance_CtfeProvenance } from "../../rustc_middle/mir/interpret/mod.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";

export * from "./eval_context.gen.ts";

/** Lazy `crate::assert_typing_mode` (lib.ts; the crate root imports this module). */
function crate(): typeof import("../lib.ts") {
  return (crate_cache ??= require("../lib.ts") as typeof import("../lib.ts"));
}
// PORT: cached (`require` per call was ~30% of CTFE time); `var` is hoisted, as cycles may call this early.
var crate_cache: typeof import("../lib.ts") | undefined;
/** Lazy `crate::util` (util/mod.ts, lane ctfe-util). */
function util(): typeof import("../util/mod.ts") {
  return (util_cache ??= require("../util/mod.ts") as typeof import("../util/mod.ts"));
}
// PORT: cached (`require` per call was ~30% of CTFE time); `var` is hoisted, as cycles may call this early.
var util_cache: typeof import("../util/mod.ts") | undefined;
/** Lazy interpret hand modules read at call time (init order, header). */
function memory(): typeof import("./memory.ts") {
  return (memory_cache ??= require("./memory.ts") as typeof import("./memory.ts"));
}
// PORT: cached (`require` per call was ~30% of CTFE time); `var` is hoisted, as cycles may call this early.
var memory_cache: typeof import("./memory.ts") | undefined;
function stack(): typeof import("./stack.ts") {
  return (stack_cache ??= require("./stack.ts") as typeof import("./stack.ts"));
}
// PORT: cached (`require` per call was ~30% of CTFE time); `var` is hoisted, as cycles may call this early.
var stack_cache: typeof import("./stack.ts") | undefined;
function place(): typeof import("./place.ts") {
  return (place_cache ??= require("./place.ts") as typeof import("./place.ts"));
}
// PORT: cached (`require` per call was ~30% of CTFE time); `var` is hoisted, as cycles may call this early.
var place_cache: typeof import("./place.ts") | undefined;

// rustc-type: compiler/rustc_const_eval/src/interpret/eval_context.rs:30 InterpCx
// PORT: the impls of `HasDataLayout` / `HasTyCtxt` / `HasTypingEnv` / `LayoutOfHelpers` / `FnAbiOfHelpers` (and the blanket
// `LayoutOf` / `FnAbiOf`) are methods of the class (PORTING §8); the trait methods `tcx()` / `typing_env()` are `tcx_()` /
// `typing_env_()` (rustc_middle ty/layout.ts header), the fields keep their names.
export class InterpCx<M extends Machine = Machine>
  implements
    LayoutOf<Result<TyAndLayout<Ty>, InterpErrorKind>, InterpErrorKind>,
    FnAbiOf<Result<TyAndLayout<Ty>, InterpErrorKind>, InterpErrorKind, Result<FnAbi<Ty>, InterpErrorKind>, InterpErrorKind>
{
  constructor(
    /// Stores the `Machine` instance.
    ///
    /// Note: the stack is provided by the machine.
    public machine: M,

    /// The results of the type checker, from rustc.
    /// The span in this is the "root" of the evaluation, i.e., the const
    /// we are evaluating (if this is CTFE).
    public tcx: TyCtxtAt,

    /// The current context in case we're evaluating in a
    /// polymorphic context. This always uses `ty::TypingMode::PostAnalysis`.
    public typing_env: TypingEnv,

    /// The query cache is slow so we have our own cache in front of it.
    public layout_cache: Map<Ty, Layout>,

    /// The virtual memory system.
    public memory: Memory,

    /// The recursion limit (cached from `tcx.recursion_limit(())`)
    public recursion_limit: Limit,
  ) {}

  // ---- impl<'tcx, M: Machine<'tcx>> HasDataLayout for InterpCx<'tcx, M> ----
  // #[inline]
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:57 data_layout
  data_layout(): TargetDataLayout {
    return this.tcx.data_layout();
  }

  // ---- impl<'tcx, M> layout::HasTyCtxt<'tcx> for InterpCx<'tcx, M> ----
  // #[inline]
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:67 tcx
  tcx_(): TyCtxt {
    return this.tcx.deref();
  }

  // ---- impl<'tcx, M> layout::HasTypingEnv<'tcx> for InterpCx<'tcx, M> ----
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:76 typing_env
  typing_env_(): TypingEnv {
    return this.typing_env;
  }

  // ---- impl<'tcx, M: Machine<'tcx>> LayoutOfHelpers<'tcx> for InterpCx<'tcx, M> ----
  // type LayoutOfResult = Result<TyAndLayout<'tcx>, InterpErrorKind<'tcx>>;
  get LayoutOfResult(): MaybeResult<TyAndLayout<Ty>, Result<TyAndLayout<Ty>, InterpErrorKind>, InterpErrorKind> {
    return MaybeResult_Result;
  }

  // #[inline]
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:85 layout_tcx_at_span
  layout_tcx_at_span(): Span {
    // Using the cheap root span for performance.
    return this.tcx.span;
  }

  // #[inline]
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:91 handle_layout_err
  handle_layout_err(err: LayoutError, _: Span, __: Ty): InterpErrorKind {
    // FIXME(#149283): This is really hacky and is only used to hide type
    // system bugs. We use it as a temporary fix for #149081.
    //
    // While it's expected that we sometimes get ambiguity errors when
    // entering another generic environment while the current environment
    // itself is still generic, we should never fail to entirely prove
    // something.
    switch (err.$) {
      case "NormalizationFailure": {
        const ty = err._0;
        if (TypeVisitableExt.has_non_region_param(ty, fold_Ty)) {
          err = { $: "TooGeneric", _0: ty };
        }
        break;
      }

      case "Unknown":
      case "SizeOverflow":
      case "InvalidSimd":
      case "TooGeneric":
      case "ReferencesError":
        break;
    }
    // err_inval!(Layout(err))
    return { $: "InvalidProgram", _0: { $: "Layout", _0: err } };
  }

  // ---- impl<'tcx, M: Machine<'tcx>> FnAbiOfHelpers<'tcx> for InterpCx<'tcx, M> ----
  // type FnAbiOfResult = Result<&'tcx FnAbi<'tcx, Ty<'tcx>>, InterpErrorKind<'tcx>>;
  get FnAbiOfResult(): MaybeResult<FnAbi<Ty>, Result<FnAbi<Ty>, InterpErrorKind>, InterpErrorKind> {
    return MaybeResult_Result;
  }

  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:124 handle_fn_abi_err
  handle_fn_abi_err(err: FnAbiError, _span: Span, _fn_abi_request: FnAbiRequest): InterpErrorKind {
    switch (err.$) {
      case "Layout":
        // err_inval!(Layout(err))
        return { $: "InvalidProgram", _0: { $: "Layout", _0: err._0 } };
    }
  }

  // ---- impl<'tcx, C: LayoutOfHelpers<'tcx>> LayoutOf<'tcx> for C {} (the inherent `layout_of` below shadows it) ----
  // (provided) ty/layout.rs:773 spanned_layout_of -> LayoutOf_provided.spanned_layout_of
  spanned_layout_of(ty: Ty, span: Span): Result<TyAndLayout<Ty>, InterpErrorKind> {
    return LayoutOf_provided.spanned_layout_of(this, ty, span);
  }

  // ---- impl<'tcx, C: FnAbiOfHelpers<'tcx>> FnAbiOf<'tcx> for C {} (the inherent fns below shadow two of them) ----
  // (provided) ty/layout.rs:1520 fn_abi_of_instance -> FnAbiOf_provided.fn_abi_of_instance
  fn_abi_of_instance(instance: Instance, extra_args: List<Ty>): Result<FnAbi<Ty>, InterpErrorKind> {
    return FnAbiOf_provided.fn_abi_of_instance(this, instance, extra_args);
  }

  // ---- impl<'tcx, M: Machine<'tcx>> InterpCx<'tcx, M> ----

  /// This inherent method takes priority over the trait method with the same name in LayoutOf,
  /// and allows wrapping the actual [LayoutOf::layout_of] with a tracing span.
  /// See [LayoutOf::layout_of] for the original documentation.
  // #[inline]
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:141 layout_of
  layout_of(ty: Ty): Result<TyAndLayout<Ty>, InterpErrorKind> {
    const occupied = this.layout_cache.get(ty);
    if (occupied !== undefined) {
      return Ok(new TyAndLayout(ty, occupied));
    } else {
      // let _trace = enter_trace_span!(M, layouting::layout_of, ty = ?ty.kind());
      const r = LayoutOf_provided.layout_of(this, ty);
      if (r.$ === "Err") return r;
      const layout = r._0;
      this.layout_cache.set(ty, layout.layout);
      return Ok(layout);
    }
  }

  /// This inherent method takes priority over the trait method with the same name in FnAbiOf,
  /// and allows wrapping the actual [FnAbiOf::fn_abi_of_fn_ptr] with a tracing span.
  /// See [FnAbiOf::fn_abi_of_fn_ptr] for the original documentation.
  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:159 fn_abi_of_fn_ptr
  fn_abi_of_fn_ptr(sig: PolyFnSig, extra_args: List<Ty>): Result<FnAbi<Ty>, InterpErrorKind> {
    // let _trace = enter_trace_span!(M, layouting::fn_abi_of_fn_ptr, ?sig, ?extra_args);
    return FnAbiOf_provided.fn_abi_of_fn_ptr(this, sig, extra_args);
  }

  /// This inherent method takes priority over the trait method with the same name in FnAbiOf,
  /// and allows wrapping the actual [FnAbiOf::fn_abi_of_instance_no_deduced_attrs] with a tracing span.
  /// See [FnAbiOf::fn_abi_of_instance_no_deduced_attrs] for the original documentation.
  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:172 fn_abi_of_instance_no_deduced_attrs
  fn_abi_of_instance_no_deduced_attrs(instance: Instance, extra_args: List<Ty>): Result<FnAbi<Ty>, InterpErrorKind> {
    // let _trace = enter_trace_span!(M, layouting::fn_abi_of_instance, ?instance, ?extra_args);
    return FnAbiOf_provided.fn_abi_of_instance_no_deduced_attrs(this, instance, extra_args);
  }

  // ---- impl<'tcx, M: Machine<'tcx>> InterpCx<'tcx, M> ----

  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:243 new
  static new<M extends Machine>(tcx: TyCtxt, root_span: Span, typing_env: TypingEnv, machine: M): InterpCx<M> {
    crate().assert_typing_mode(typing_env.typing_mode());

    return new InterpCx<M>(
      machine,
      tcx.at(root_span),
      typing_env,
      /* RefCell::new( */ new Map() /* ) */,
      memory().Memory.new(),
      tcx.recursion_limit(),
    );
  }

  /// Returns the span of the currently executed statement/terminator.
  /// This is the span typically used for error reporting.
  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:264 cur_span
  cur_span(): Span {
    // This deliberately does *not* honor `requires_caller_location` since it is used for much
    // more than just panics.
    const stack_ = this.stack();
    const f = stack_[stack_.length - 1];
    return f === undefined ? this.tcx.span : f.current_span();
  }

  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:270 stack
  stack(): readonly Frame[] {
    return this.machine.stack_(this);
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:275 stack_mut
  stack_mut(): Frame[] {
    return this.machine.stack_mut(this);
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:280 frame_idx
  frame_idx(): number {
    const stack_ = this.stack();
    assert(!(stack_.length === 0), "assertion failed: !stack.is_empty()");
    return stack_.length - 1;
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:287 frame
  frame(): Frame {
    const stack_ = this.stack();
    return unwrap(stack_[stack_.length - 1], "a call frame should exist");
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:292 frame_mut
  frame_mut(): Frame {
    const stack_ = this.stack_mut();
    return unwrap(stack_[stack_.length - 1], "a call frame should exist");
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:297 body
  body(): Body {
    return this.frame().body;
  }

  // #[inline]
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:302 type_is_freeze
  type_is_freeze(ty: Ty): boolean {
    return ty.is_freeze(this.tcx.deref(), this.typing_env);
  }

  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:306 load_mir
  load_mir(instance: InstanceKind, promoted: Promoted | undefined): InterpResult<Body> {
    // trace!("load mir(instance={:?}, promoted={:?})", instance, promoted);
    let body: Body;
    if (promoted !== undefined) {
      const def = InstanceKind.def_id(instance);
      body = unwrap(this.tcx.promoted_mir(def)[promoted]);
    } else {
      body = this.machine.load_mir(this, instance);
    }
    // do not continue if typeck errors occurred (can only occur in local crate)
    const err = body.tainted_by_errors;
    if (err !== undefined) {
      // throw_inval!(AlreadyReported(ReportedErrorInfo::non_const_eval_error(err)))
      return Err(
        InterpErrorInfo_from_InterpErrorKind({
          $: "InvalidProgram",
          _0: { $: "AlreadyReported", _0: ReportedErrorInfo.non_const_eval_error(err) },
        }),
      );
    }
    return interp_ok(body);
  }

  /// Call this on things you got out of the MIR (so it is as generic as the current
  /// stack frame), to bring it into the proper environment for this interpreter.
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:327 instantiate_from_current_frame_and_normalize_erasing_regions
  instantiate_from_current_frame_and_normalize_erasing_regions<T>(value: T, d_T: TypeFoldable<T>): Result<T, ErrorHandled> {
    return this.instantiate_from_frame_and_normalize_erasing_regions(this.frame(), value, d_T);
  }

  /// Call this on things you got out of the MIR (so it is as generic as the provided
  /// stack frame), to bring it into the proper environment for this interpreter.
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:338 instantiate_from_frame_and_normalize_erasing_regions
  instantiate_from_frame_and_normalize_erasing_regions<T>(frame: Frame, value: T, d_T: TypeFoldable<T>): Result<T, ErrorHandled> {
    // let _trace = enter_trace_span!(M, "instantiate_from_frame_and_normalize_erasing_regions", %frame.instance);
    const r = Instance.try_instantiate_mir_and_normalize_erasing_regions(
      frame.instance,
      this.tcx.deref(),
      this.typing_env,
      EarlyBinder.bind(this.tcx.tcx, value, d_T),
      d_T,
    );
    if (r.$ === "Err") return Err<ErrorHandled>({ $: "TooGeneric", _0: this.cur_span() });
    return r;
  }

  /// The `args` are assumed to already be in our interpreter "universe".
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:359 resolve
  resolve(def: DefId, args: GenericArgsRef): InterpResult<Instance> {
    // let _trace = enter_trace_span!(M, resolve::try_resolve, def = ?def);
    // trace!("resolve: {:?}, {:#?}", def, args);
    // trace!("typing_env: {:#?}", self.typing_env);
    // trace!("args: {:#?}", args);
    const r = Instance.try_resolve(this.tcx.deref(), this.typing_env, def, args);
    if (r.$ === "Ok") {
      const instance = r._0;
      if (instance !== undefined) return interp_ok(instance);
      // throw_inval!(TooGeneric)
      return Err(InterpErrorInfo_from_InterpErrorKind({ $: "InvalidProgram", _0: { $: "TooGeneric" } }));
    }
    // FIXME(eddyb) this could be a bit more specific than `AlreadyReported`.
    const error_guaranteed = r._0;
    // throw_inval!(AlreadyReported(ReportedErrorInfo::non_const_eval_error(error_guaranteed)))
    return Err(
      InterpErrorInfo_from_InterpErrorKind({
        $: "InvalidProgram",
        _0: { $: "AlreadyReported", _0: ReportedErrorInfo.non_const_eval_error(error_guaranteed) },
      }),
    );
  }

  /// Walks up the callstack from the intrinsic's callsite, searching for the first callsite in a
  /// frame which is not `#[track_caller]`. This matches the `caller_location` intrinsic,
  /// and is primarily intended for the panic machinery.
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:382 find_closest_untracked_caller_location
  find_closest_untracked_caller_location(): Span {
    const stack_ = this.stack();
    for (let i = stack_.length - 1; i >= 0; i--) {
      const frame = stack_[i]!;
      // debug!("find_closest_untracked_caller_location: checking frame {:?}", frame.instance);

      // Assert that the frame we look at is actually executing code currently
      // (`loc` is `Right` when we are unwinding and the frame does not require cleanup).
      // `frame.loc.left().unwrap()`
      const loc = unwrap(frame.loc.$ === "Left" ? frame.loc._0 : undefined);

      // This could be a non-`Call` terminator (such as `Drop`), or not a terminator at all
      // (such as `box`). Use the normal span by default.
      const source_info = { ...frame.body.source_info(loc) };

      // If this is a `Call` terminator, use the `fn_span` instead.
      const block = unwrap(frame.body.basic_blocks.deref()[loc.block]);
      if (loc.statement_index === block.statements.length) {
        // debug!("find_closest_untracked_caller_location: got terminator {:?} ({:?})", block.terminator(), block.terminator().kind);
        const kind = block.terminator_().kind;
        if (kind.$ === "Call") {
          source_info.span = kind.fn_span;
        }
      }

      // PORT: `Option<Result<Span, ()>>`: `Err(())` is `null`.
      let caller_location: null | undefined;
      if (InstanceKind.requires_caller_location(frame.instance.def, this.tcx.deref())) {
        // We use `Err(())` as indication that we should continue up the call stack since
        // this is a `#[track_caller]` function.
        caller_location = null;
      } else {
        caller_location = undefined;
      }
      const r = frame.body.caller_location_span<Span | null>(source_info, caller_location, this.tcx.deref(), (sp: Span) => sp);
      if (r !== null) {
        const span = r;
        return span;
      }
    }

    return span_bug(this.cur_span(), "no non-`#[track_caller]` frame found");
  }

  /// Returns the actual dynamic size and alignment of the place at the given type.
  /// Only the "meta" (metadata) part of the place matters.
  /// This can fail to provide an answer for extern types.
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:427 size_and_align_from_meta
  size_and_align_from_meta(metadata: gen_MemPlaceMeta, layout: TyAndLayout<Ty>): InterpResult<[Size, Align] | undefined> {
    if (layout.is_sized()) {
      return interp_ok<[Size, Align] | undefined>([layout.size, layout.align.abi]);
    }
    const kind = layout.ty.kind();
    switch (kind.$) {
      case "Adt":
      case "Tuple": {
        // First get the size of all statically known fields.
        // Don't use type_of::sizing_type_of because that expects t to be sized,
        // and it also rounds up to alignment, which we want to avoid,
        // as the unsized field's alignment could be smaller.
        assert(!layout.ty.is_simd(), "assertion failed: !layout.ty.is_simd()");
        assert(FieldsShape.count(layout.fields) > 0, "assertion failed: layout.fields.count() > 0");
        // trace!("DST layout: {:?}", layout);

        const unsized_offset_unadjusted = FieldsShape.offset(layout.fields, FieldsShape.count(layout.fields) - 1);
        const sized_align = layout.align.abi;

        // Recurse to get the size of the dynamically sized field (must be
        // the last field). Can't have foreign types here, how would we
        // adjust alignment and size for them?
        const field = layout.field(this, FieldsShape.count(layout.fields) - 1);
        const r = this.size_and_align_from_meta(metadata, field);
        if (r.$ === "Err") return r;
        if (r._0 === undefined) {
          // A field with an extern type. We don't know the actual dynamic size
          // or the alignment.
          return interp_ok(undefined);
        }
        const unsized_size = r._0[0];
        let unsized_align = r._0[1];

        // # First compute the dynamic alignment

        // Packed type alignment needs to be capped.
        if (kind.$ === "Adt") {
          const packed = kind._0.repr().pack;
          if (packed !== undefined) {
            // `Ord::min` (the derived `Ord` compares `pow2`; `self` on ties)
            unsized_align = unsized_align.pow2 <= packed.pow2 ? unsized_align : packed;
          }
        }

        // Choose max of two known alignments (combined value must
        // be aligned according to more restrictive of the two).
        // `Ord::max` (`other` on ties)
        const full_align = sized_align.pow2 > unsized_align.pow2 ? sized_align : unsized_align;

        // # Then compute the dynamic size

        const unsized_offset_adjusted = unsized_offset_unadjusted.align_to(unsized_align);
        const full_size = unsized_offset_adjusted.add(unsized_size).align_to(full_align);

        // Just for our sanitiy's sake, assert that this is equal to what codegen would compute.
        const codegen_size = unsized_offset_unadjusted.add(unsized_size).align_to(full_align);
        assert(
          full_size.bytes() === codegen_size.bytes(),
          `assertion \`left == right\` failed\n  left: ${full_size.bytes()}\n right: ${codegen_size.bytes()}`,
        );

        // Check if this brought us over the size limit.
        // PORT: `max_size_of_val()` is `Size::from_bytes(isize::MAX)`, beyond 2^53 on 64-bit targets (a `Size` is a
        // number, recorded decision): the comparison is on the bytes, as `bigint`s, against `target_isize_max` (as
        // operator.ts `compute_size_in_bytes` and memory.ts `insert_allocation`).
        if (BigInt(full_size.bytes()) > PointerArithmetic_provided.target_isize_max(this)) {
          // throw_ub!(InvalidMeta(InvalidMetaKind::TooBig))
          return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "InvalidMeta", _0: "TooBig" } }));
        }
        return interp_ok<[Size, Align] | undefined>([full_size, full_align]);
      }
      case "Dynamic": {
        const expected_trait = kind._0;
        const vtable = Scalar.to_pointer(place().MemPlaceMeta.unwrap_meta(metadata), this);
        // Read size and align from vtable (already checks size).
        const r = this.get_vtable_size_and_align(vtable, expected_trait);
        if (r.$ === "Err") return r;
        return interp_ok<[Size, Align] | undefined>(r._0);
      }

      case "Slice":
      case "Str": {
        const len_r = Scalar.to_target_usize(place().MemPlaceMeta.unwrap_meta(metadata), this);
        if (len_r.$ === "Err") return len_r;
        const len = len_r._0;
        const elem = layout.field(this, 0);

        // Make sure the slice is not too big.
        // we rely on `max_size_of_val` being smaller than `u64::MAX`.
        const size_ = saturating_mul_u64(BigInt(elem.size.bytes()), len);
        // PORT: compared with `target_isize_max` (`max_size_of_val()`'s bytes) as above.
        if (size_ > PointerArithmetic_provided.target_isize_max(this)) {
          // throw_ub!(InvalidMeta(InvalidMetaKind::SliceTooBig))
          return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "InvalidMeta", _0: "SliceTooBig" } }));
        }
        const size = Size.from_bytes(size_);
        return interp_ok<[Size, Align] | undefined>([size, elem.align.abi]);
      }

      case "Foreign":
        return interp_ok(undefined);

      default:
        return span_bug(this.cur_span(), `size_and_align_of::<${layout.ty.toString()}> not supported`);
    }
  }

  // #[inline]
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:515 size_and_align_of_val
  size_and_align_of_val(val: Projectable): InterpResult<[Size, Align] | undefined> {
    return this.size_and_align_from_meta(val.meta(), val.layout_());
  }

  /// Jump to the given block.
  // #[inline]
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:524 go_to_block
  go_to_block(target: BasicBlock): void {
    this.frame_mut().loc = { $: "Left", _0: BasicBlock.start_location(target) };
  }

  /// *Return* to the given `target` basic block.
  /// Do *not* use for unwinding! Use `unwind_to_block` instead.
  ///
  /// If `target` is `None`, that indicates the function cannot return, so we raise UB.
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:532 return_to_block
  return_to_block(target: BasicBlock | undefined): InterpResult {
    if (target !== undefined) {
      this.go_to_block(target);
      return interp_ok(undefined);
    } else {
      // throw_ub!(Unreachable)
      return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "Unreachable" } }));
    }
  }

  /// *Unwind* to the given `target` basic block.
  /// Do *not* use for returning! Use `return_to_block` instead.
  ///
  /// If `target` is `UnwindAction::Continue`, that indicates the function does not need cleanup
  /// during unwinding, and we will just keep propagating that upwards.
  ///
  /// If `target` is `UnwindAction::Unreachable`, that indicates the function does not allow
  /// unwinding, and doing so is UB.
  // #[cold] // usually we have normal returns, not unwinding
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:550 unwind_to_block
  unwind_to_block(target: UnwindAction): InterpResult {
    let loc: Either<Location, Span>;
    switch (target.$) {
      case "Cleanup":
        loc = { $: "Left", _0: BasicBlock.start_location(target._0) };
        break;
      case "Continue":
        loc = { $: "Right", _0: this.frame_mut().body.span };
        break;
      case "Unreachable":
        // throw_ub_format!("unwinding past a stack frame that does not allow unwinding")
        return Err(
          InterpErrorInfo_from_InterpErrorKind({
            $: "UndefinedBehavior",
            _0: { $: "Ub", _0: "unwinding past a stack frame that does not allow unwinding" },
          }),
        );
      case "Terminate": {
        const reason = target._0;
        this.frame_mut().loc = { $: "Right", _0: this.frame_mut().body.span };
        const r = this.machine.unwind_terminate(this, reason);
        if (r.$ === "Err") return r;
        // This might have pushed a new stack frame, or it terminated execution.
        // Either way, `loc` will not be updated.
        return interp_ok(undefined);
      }
    }
    this.frame_mut().loc = loc;
    return interp_ok(undefined);
  }

  /// Call a query that can return `ErrorHandled`. Should be used for statics and other globals.
  /// (`mir::Const`/`ty::Const` have `eval` methods that can be used directly instead.)
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:570 ctfe_query
  ctfe_query<T>(query: (tcx: TyCtxtAt) => Result<T, ErrorHandled>): Result<T, ErrorHandled> {
    // Use a precise span for better cycle errors.
    const r = query(this.tcx.tcx.at(this.cur_span()));
    if (r.$ === "Err") {
      const err = r._0;
      ErrorHandled.emit_note(err, this.tcx.deref());
      return Err(err);
    }
    return r;
  }

  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:581 eval_global
  eval_global(instance: Instance): InterpResult<MPlaceTy> {
    const gid = new GlobalId(instance, undefined);
    let val: ConstAlloc;
    if (this.tcx.tcx.is_static(Instance.def_id(gid.instance))) {
      const alloc_id = this.tcx.tcx.reserve_and_set_static_alloc(Instance.def_id(gid.instance));

      const ty = Instance.ty(instance, this.tcx.tcx, this.typing_env);
      val = { alloc_id, ty };
    } else {
      const r = this.ctfe_query((tcx) => tcx.eval_to_allocation_raw(this.typing_env.as_query_input(gid)));
      if (r.$ === "Err") return Err(InterpErrorInfo_from_ErrorHandled(r._0));
      val = r._0;
    }
    return this.raw_const_to_mplace(val);
  }

  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:597 eval_mir_constant
  eval_mir_constant(val: mir_Const, span: Span, layout: TyAndLayout<Ty> | undefined): InterpResult<OpTy> {
    // let _trace = enter_trace_span!(M, const_eval::eval_mir_constant, ?val);
    const r = mir_Const.eval(val, this.tcx.deref(), this.typing_env, span);
    if (r.$ === "Err") {
      const err = r._0;
      if (this.machine.ALL_CONSTS_ARE_PRECHECKED) {
        switch (err.$) {
          case "TooGeneric":
            break;
          case "Reported": {
            const reported = err._0;
            const span_ = err._1;
            if (reported.is_allowed_in_infallible()) {
              // These errors can just sometimes happen, even when the expression
              // is nominally "infallible", e.g. when running out of memory
              // or when some layout could not be computed.
            } else {
              // Looks like the const is not captured by `required_consts`, that's bad.
              return span_bug(span_, `interpret const eval failure of ${debug_Const(val, PLAIN)} which is not in required_consts`);
            }
            break;
          }
        }
      }
      ErrorHandled.emit_note(err, this.tcx.deref());
      return Err(InterpErrorInfo_from_ErrorHandled(err));
    }
    const const_val = r._0;
    return this.const_val_to_op(const_val, mir_Const.ty(val), layout);
  }

  // #[must_use]
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:627 dump_place
  dump_place(place_: PlaceTy): PlacePrinter<M> {
    return new PlacePrinter<M>(this, place_.place_());
  }

  // #[must_use]
  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:632 generate_stacktrace
  generate_stacktrace(): FrameInfo[] {
    return stack().Frame.generate_stacktrace_from_stack(this.stack(), this.tcx.deref());
  }

  // rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:636 adjust_nan
  adjust_nan<F1, F2 extends Float<F2>>(f: F2, inputs: readonly F1[], F2_: FloatType<F2>): F2 {
    if (f.is_nan()) {
      return this.machine.generate_nan(this, inputs, F2_);
    } else {
      return f;
    }
  }
}

/// Test if it is valid for a MIR assignment to assign `src`-typed place to `dest`-typed value.
// rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:183 mir_assign_valid_types
export function mir_assign_valid_types(tcx: TyCtxt, typing_env: TypingEnv, src: TyAndLayout<Ty>, dest: TyAndLayout<Ty>): boolean {
  // We *could* check `Invariant` here since all subtyping must be explicit post-borrowck.
  // However, this check is also used by the interpreter to figure out if a transmute can be
  // turned into a regular assignment (which has a more efficient codepath), so we want the check
  // to consider as many assignments as possible to be valid. Therefore we are happy to accept
  // one-way subtyping.
  if (util().relate_types(tcx, typing_env, "Covariant", src.ty, dest.ty)) {
    // Make sure the layout is equal, too -- just to be safe. Miri really needs layout equality.
    // For performance reason we skip this check when the types are equal. Equal types *can*
    // have different layouts when enum downcast is involved (as enum variants carry the type of
    // the enum), but those should never occur in assignments.
    if (/* cfg!(debug_assertions) || */ src.ty !== dest.ty) {
      // PORT: `Layout` is interned (`==` is identity).
      assert(
        src.layout === dest.layout,
        `assertion \`left == right\` failed: ${src.ty.toString()} is a subtype of ${dest.ty.toString()} but they have different layout`,
      );
    }
    return true;
  } else {
    return false;
  }
}

/// Use the already known layout if given (but sanity check in debug mode),
/// or compute the layout.
// #[cfg_attr(not(debug_assertions), inline(always))]
// rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:217 from_known_layout
export function from_known_layout(
  tcx: TyCtxtAt,
  typing_env: TypingEnv,
  known_layout: TyAndLayout<Ty> | undefined,
  compute: () => InterpResult<TyAndLayout<Ty>>,
): InterpResult<TyAndLayout<Ty>> {
  if (known_layout === undefined) {
    return compute();
  } else {
    // PORT: `if cfg!(debug_assertions) { .. }` (the `mir_assign_valid_types` sanity check) is skipped: rustc ships
    // without debug assertions.
    void tcx;
    void typing_env;
    return interp_ok(known_layout);
  }
}

// #[doc(hidden)]
/// Helper struct for the `dump_place` function.
// rustc-type: compiler/rustc_const_eval/src/interpret/eval_context.rs:647 PlacePrinter
export class PlacePrinter<M extends Machine = Machine> {
  constructor(
    public ecx: InterpCx<M>,
    public place: Place,
  ) {}
}

// impl<'a, 'tcx, M: Machine<'tcx>> std::fmt::Debug for PlacePrinter<'a, 'tcx, M>
// rustc: compiler/rustc_const_eval/src/interpret/eval_context.rs:653 fmt
export const debug_PlacePrinter: Debug<PlacePrinter> = (self, fmt) => {
  const p = self.place;
  switch (p.$) {
    case "Local": {
      const { local, offset } = p;
      // debug_assert_eq!(locals_addr, self.ecx.frame().locals_addr());
      const allocs: (AllocId | undefined)[] = [];
      let out = debug_Local(local, fmt);
      if (offset !== undefined) {
        out += `+0x${offset.bytes().toString(16)}`;
      }
      out += ":";

      out += unwrap(self.ecx.frame().locals[local]).print(allocs, fmt);

      out += `: ${memory().debug_DumpAllocs(self.ecx.dump_allocs(allocs.filter((x): x is AllocId => x !== undefined)), fmt)}`;
      return out;
    }
    case "Ptr": {
      const mplace = p._0;
      const prov = mplace.ptr.provenance;
      const alloc_id = prov === undefined ? undefined : Provenance_CtfeProvenance.get_alloc_id(prov);
      if (alloc_id !== undefined) {
        return `by ref ${debug_Pointer_Option(mplace.ptr, fmt, debug_CtfeProvenance)}: ${memory().debug_DumpAllocs(self.ecx.dump_alloc(alloc_id), fmt)}`;
      } else {
        const ptr = alloc_id;
        return ` integral by ref: ${ptr === undefined ? "None" : debug_int(ptr, fmt)}`;
      }
    }
  }
};

/** `u64::saturating_mul`. */
function saturating_mul_u64(a: bigint, b: bigint): bigint {
  const r = a * b;
  return r > 0xffff_ffff_ffff_ffffn ? 0xffff_ffff_ffff_ffffn : r;
}

