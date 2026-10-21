// Port of compiler/rustc_middle/src/mir/interpret/error.rs (lane mir-contract, plan-m4 D3 / D8). The file's types are
// generated into error.gen.ts (set rustc_middle_mir); `InterpResult` and `MachineStopType` are hand-written below. Every
// fn is a stub for lane mir-interp-b (docs/handoff/mir-contract.md "How to fill a stub").
// PORT (D8): `InterpResult<'tcx, T> { res: Result<T, InterpErrorInfo>, guard: Guard }` is src/std/result.ts's
// `Result<T, InterpErrorInfo>` (the `Guard` only catches dropped-unchecked results in debug builds); its methods and the
// `Try` / `FromResidual` / `From` / `FromIterator` impls are companion fns (`InterpResult.map(r, f)`; `?` is
// `if (r.$ === "Err") return r;`, `throw_ub!(..)` is `return Err(InterpErrorInfo_from_InterpErrorKind(..))`). The
// `err_*!` / `throw_*!` macros (error.rs:833..917) are not fns: lanes expand them inline.
import "../mod.ts";
import type { PathBuf, DiagArgValue } from "../../../rustc_error_messages/lib.ts";
import type { Backtrace } from "../../../rustc_errors/lib.ts";
import type { ControlFlow } from "../../../rustc_ast_ir/visit.ts";
import type { ErrorGuaranteed, Span } from "../../../rustc_span/lib.ts";
import type { Debug, Fmt } from "../../../std/fmt.ts";
import type { MutRef } from "../../../std/mut_ref.ts";
import { unported } from "../../../std/panic.ts";
import type { Result } from "../../../std/result.ts";
import type { TyCtxt } from "../../ty/context.ts";
import type { LayoutError } from "../../ty/layout.ts";
import * as gen from "./error.gen.ts";
import {
  type CheckInAllocMsg,
  type Guard,
  InterpErrorBacktrace,
  InterpErrorInfo,
  type InterpErrorKind as gen_InterpErrorKind,
  type InvalidMetaKind,
  type InvalidProgramInfo,
  ReportedErrorInfo,
  type ResourceExhaustionInfo,
  type UndefinedBehaviorInfo,
  type UnsupportedOpInfo,
} from "./error.gen.ts";
export * from "./error.gen.ts";

/** ty/layout.ts (an extension module), read lazily: `Debug` of `LayoutError` for the generated `InvalidProgramInfo` Debug. */
function ty_layout(): typeof import("../../ty/layout.ts") {
  return (ty_layout__m ??= require("../../ty/layout.ts") as typeof import("../../ty/layout.ts"));
}
var ty_layout__m: typeof import("../../ty/layout.ts") | undefined;
export const debug_LayoutError_lazy: Debug<LayoutError> = (v, f) => ty_layout().debug_LayoutError(v, f);

// ---- companions ----
export interface ErrorHandled_methods {
  // error.rs:39
  with_span(self: ErrorHandled, span: Span): ErrorHandled;
  // error.rs:46
  emit_note(self: ErrorHandled, tcx: TyCtxt): void;
}
export type ErrorHandled = gen.ErrorHandled;
export const ErrorHandled = {} as ErrorHandled_methods;
export interface ValTreeCreationError_methods {
  // error.rs:132
  with_span(self: ValTreeCreationError, span: Span): ValTreeCreationError;
}
export type ValTreeCreationError = gen.ValTreeCreationError;
export const ValTreeCreationError = gen.ValTreeCreationError as typeof gen.ValTreeCreationError & ValTreeCreationError_methods;
export interface InterpErrorKind_methods {
  // error.rs:821
  formatted_string(self: InterpErrorKind): boolean;
}
export type InterpErrorKind = gen_InterpErrorKind;
export const InterpErrorKind = {} as InterpErrorKind_methods;

// rustc-type: compiler/rustc_middle/src/mir/interpret/error.rs:942 InterpResult
/** `InterpResult<'tcx, T = ()>` (plan-m4 D8: the std `Result`; see the header). */
export type InterpResult<T = undefined> = Result<T, InterpErrorInfo>;
export interface InterpResult_methods {
  // error.rs:952 impl Try
  from_output<T>(output: T): InterpResult<T>;
  // error.rs:957 impl Try
  branch<T>(self: InterpResult<T>): ControlFlow<InterpResult<never>, T>;
  // error.rs:972 impl FromResidual
  from_residual<T>(residual: InterpResult<never>): InterpResult<T>;
  // error.rs:982 impl FromResidual<Yeet<InterpErrorKind>>
  from_residual_yeet<T>(e: InterpErrorKind): InterpResult<T>;
  // error.rs:993 impl FromResidual<Result<Infallible, E>>
  from_residual_result<T, E>(residual: Result<never, E>, into_E: (e: E) => InterpErrorInfo): InterpResult<T>;
  // error.rs:1002 impl From<Result<T, E>>
  from_result<T, E>(value: Result<T, E>, into_E: (e: E) => InterpErrorInfo): InterpResult<T>;
  // error.rs:1008 impl FromIterator
  from_iter<T, V>(iter: Iterable<InterpResult<T>>, from_iter_V: (items: Iterable<T>) => V): InterpResult<V>;
  // error.rs:1015
  "new"<T>(res: Result<T, InterpErrorInfo>): InterpResult<T>;
  // error.rs:1020
  disarm<T>(self: InterpResult<T>): Result<T, InterpErrorInfo>;
  // error.rs:1027
  discard_err<T>(self: InterpResult<T>): T | undefined;
  // error.rs:1034
  report_err<T>(self: InterpResult<T>): Result<T, InterpErrorInfo>;
  // error.rs:1039
  map<T, U>(self: InterpResult<T>, f: (t: T) => U): InterpResult<U>;
  // error.rs:1044
  map_err_kind<T>(self: InterpResult<T>, f: (kind: InterpErrorKind) => InterpErrorKind): InterpResult<T>;
  // error.rs:1055
  inspect_err_info<T>(self: InterpResult<T>, f: (info: InterpErrorInfo) => void): InterpResult<T>;
  // error.rs:1061
  unwrap<T>(self: InterpResult<T>): T;
  // error.rs:1067
  unwrap_or_else<T>(self: InterpResult<T>, f: (info: InterpErrorInfo) => T): T;
  // error.rs:1073
  expect<T>(self: InterpResult<T>, msg: string): T;
  // error.rs:1078
  and_then<T, U>(self: InterpResult<T>, f: (t: T) => InterpResult<U>): InterpResult<U>;
  // error.rs:1087
  and<T, U>(self: InterpResult<T>, other: InterpResult<U>): InterpResult<[T, U]>;
}
export const InterpResult = {} as InterpResult_methods;

declare module "./error.gen.ts" {
  interface ReportedErrorInfo {
    // error.rs:86
    is_allowed_in_infallible(): boolean;
  }
  namespace ReportedErrorInfo {
    // error.rs:68
    export function const_eval_error(error: ErrorGuaranteed): ReportedErrorInfo;
    // error.rs:75
    export function non_const_eval_error(error: ErrorGuaranteed): ReportedErrorInfo;
    // error.rs:82
    export function allowed_in_infallible(error: ErrorGuaranteed): ReportedErrorInfo;
  }
  interface InterpErrorBacktrace {
    // error.rs:196
    print_backtrace(): void;
  }
  namespace InterpErrorBacktrace {
    // error.rs:173
    function new_(): InterpErrorBacktrace;
    export { new_ as new };
  }
  interface InterpErrorInfo {
    // error.rs:204
    into_parts(): [InterpErrorKind, InterpErrorBacktrace];
    // error.rs:209
    into_kind(): InterpErrorKind;
    // error.rs:218
    kind(): InterpErrorKind;
    // error.rs:228
    to_string(): string;
  }
  namespace InterpErrorInfo {
    // error.rs:213
    export function from_parts(kind: InterpErrorKind, backtrace: InterpErrorBacktrace): InterpErrorInfo;
  }
}

// impl From<ReportedErrorInfo> for ErrorHandled
// stub: compiler/rustc_middle/src/mir/interpret/error.rs:33 from (lane mir-interp-b)
export function ErrorHandled_from_ReportedErrorInfo(error: ReportedErrorInfo): ErrorHandled {
  return unported("rustc_middle::mir::interpret::error::<ErrorHandled as From<ReportedErrorInfo>>::from");
}

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:39 with_span (lane mir-interp-b)
ErrorHandled.with_span = function (self: ErrorHandled, span: Span): ErrorHandled {
  return unported("rustc_middle::mir::interpret::error::ErrorHandled::with_span");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:46 emit_note (lane mir-interp-b)
ErrorHandled.emit_note = function (self: ErrorHandled, tcx: TyCtxt): void {
  return unported("rustc_middle::mir::interpret::error::ErrorHandled::emit_note");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:68 const_eval_error (lane mir-interp-b)
(ReportedErrorInfo as unknown as { const_eval_error: typeof ReportedErrorInfo.const_eval_error }).const_eval_error = function (error: ErrorGuaranteed): ReportedErrorInfo {
  return unported("rustc_middle::mir::interpret::error::ReportedErrorInfo::const_eval_error");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:75 non_const_eval_error (lane mir-interp-b)
(ReportedErrorInfo as unknown as { non_const_eval_error: typeof ReportedErrorInfo.non_const_eval_error }).non_const_eval_error = function (error: ErrorGuaranteed): ReportedErrorInfo {
  return unported("rustc_middle::mir::interpret::error::ReportedErrorInfo::non_const_eval_error");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:82 allowed_in_infallible (lane mir-interp-b)
(ReportedErrorInfo as unknown as { allowed_in_infallible: typeof ReportedErrorInfo.allowed_in_infallible }).allowed_in_infallible = function (error: ErrorGuaranteed): ReportedErrorInfo {
  return unported("rustc_middle::mir::interpret::error::ReportedErrorInfo::allowed_in_infallible");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:86 is_allowed_in_infallible (lane mir-interp-b)
ReportedErrorInfo.prototype.is_allowed_in_infallible = function (this: ReportedErrorInfo): boolean {
  return unported("rustc_middle::mir::interpret::error::ReportedErrorInfo::is_allowed_in_infallible");
};

// impl From<ReportedErrorInfo> for ErrorGuaranteed
// stub: compiler/rustc_middle/src/mir/interpret/error.rs:93 from (lane mir-interp-b)
export function ErrorGuaranteed_from_ReportedErrorInfo(val: ReportedErrorInfo): ErrorGuaranteed {
  return unported("rustc_middle::mir::interpret::error::<ErrorGuaranteed as From<ReportedErrorInfo>>::from");
}

// impl From<ErrorHandled> for ValTreeCreationError
// stub: compiler/rustc_middle/src/mir/interpret/error.rs:115 from (lane mir-interp-b)
export function ValTreeCreationError_from_ErrorHandled(err: ErrorHandled): ValTreeCreationError {
  return unported("rustc_middle::mir::interpret::error::<ValTreeCreationError as From<ErrorHandled>>::from");
}

// impl From<InterpErrorInfo> for ValTreeCreationError
// stub: compiler/rustc_middle/src/mir/interpret/error.rs:121 from (lane mir-interp-b)
export function ValTreeCreationError_from_InterpErrorInfo(err: InterpErrorInfo): ValTreeCreationError {
  return unported("rustc_middle::mir::interpret::error::<ValTreeCreationError as From<InterpErrorInfo>>::from");
}

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:132 with_span (lane mir-interp-b)
ValTreeCreationError.with_span = function (self: ValTreeCreationError, span: Span): ValTreeCreationError {
  return unported("rustc_middle::mir::interpret::error::ValTreeCreationError::with_span");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:173 new (lane mir-interp-b)
(InterpErrorBacktrace as unknown as { new: typeof InterpErrorBacktrace.new }).new = function (): InterpErrorBacktrace {
  return unported("rustc_middle::mir::interpret::error::InterpErrorBacktrace::new");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:196 print_backtrace (lane mir-interp-b)
InterpErrorBacktrace.prototype.print_backtrace = function (this: InterpErrorBacktrace): void {
  return unported("rustc_middle::mir::interpret::error::InterpErrorBacktrace::print_backtrace");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:204 into_parts (lane mir-interp-b)
InterpErrorInfo.prototype.into_parts = function (this: InterpErrorInfo): [InterpErrorKind, InterpErrorBacktrace] {
  return unported("rustc_middle::mir::interpret::error::InterpErrorInfo::into_parts");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:209 into_kind (lane mir-interp-b)
InterpErrorInfo.prototype.into_kind = function (this: InterpErrorInfo): InterpErrorKind {
  return unported("rustc_middle::mir::interpret::error::InterpErrorInfo::into_kind");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:213 from_parts (lane mir-interp-b)
(InterpErrorInfo as unknown as { from_parts: typeof InterpErrorInfo.from_parts }).from_parts = function (kind: InterpErrorKind, backtrace: InterpErrorBacktrace): InterpErrorInfo {
  return unported("rustc_middle::mir::interpret::error::InterpErrorInfo::from_parts");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:218 kind (lane mir-interp-b)
InterpErrorInfo.prototype.kind = function (this: InterpErrorInfo): InterpErrorKind {
  return unported("rustc_middle::mir::interpret::error::InterpErrorInfo::kind");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:228 to_string (lane mir-interp-b)
InterpErrorInfo.prototype.to_string = function (this: InterpErrorInfo): string {
  return unported("rustc_middle::mir::interpret::error::InterpErrorInfo::to_string");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:234 print_backtrace (lane mir-interp-b)
function print_backtrace(backtrace: Backtrace): void {
  return unported("rustc_middle::mir::interpret::error::print_backtrace");
}

// impl From<ErrorHandled> for InterpErrorInfo
// stub: compiler/rustc_middle/src/mir/interpret/error.rs:239 from (lane mir-interp-b)
export function InterpErrorInfo_from_ErrorHandled(err: ErrorHandled): InterpErrorInfo {
  return unported("rustc_middle::mir::interpret::error::<InterpErrorInfo as From<ErrorHandled>>::from");
}

// impl From<InterpErrorKind> for InterpErrorInfo
// stub: compiler/rustc_middle/src/mir/interpret/error.rs:249 from (lane mir-interp-b)
export function InterpErrorInfo_from_InterpErrorKind(kind: InterpErrorKind): InterpErrorInfo {
  return unported("rustc_middle::mir::interpret::error::<InterpErrorInfo as From<InterpErrorKind>>::from");
}

// impl fmt::Display for CheckInAllocMsg
// stub: compiler/rustc_middle/src/mir/interpret/error.rs:270 fmt (lane mir-interp-b)
export function display_CheckInAllocMsg(self: CheckInAllocMsg): string {
  return unported("rustc_middle::mir::interpret::error::<CheckInAllocMsg as Display>::fmt");
}

// impl IntoDiagArg for InvalidMetaKind
// stub: compiler/rustc_middle/src/mir/interpret/error.rs:298 into_diag_arg (lane mir-interp-b)
export function InvalidMetaKind_into_diag_arg(self: InvalidMetaKind, _1: MutRef<PathBuf | undefined>): DiagArgValue {
  return unported("rustc_middle::mir::interpret::error::<InvalidMetaKind as IntoDiagArg>::into_diag_arg");
}

// impl fmt::Display for UndefinedBehaviorInfo
// stub: compiler/rustc_middle/src/mir/interpret/error.rs:437 fmt (lane mir-interp-b)
export function display_UndefinedBehaviorInfo(self: UndefinedBehaviorInfo): string {
  return unported("rustc_middle::mir::interpret::error::<UndefinedBehaviorInfo as Display>::fmt");
}

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:440 fmt_in_alloc_attempt (lane mir-interp-b)
// PORT: nested fn of `<UndefinedBehaviorInfo as Display>::fmt`; a module-level stub until its lane ports it inside the parent.
function fmt_in_alloc_attempt(msg: CheckInAllocMsg, inbounds_size: bigint): string {
  return unported("rustc_middle::mir::interpret::error::fmt_in_alloc_attempt");
}

// impl fmt::Display for InvalidProgramInfo
// stub: compiler/rustc_middle/src/mir/interpret/error.rs:668 fmt (lane mir-interp-b)
export function display_InvalidProgramInfo(self: InvalidProgramInfo): string {
  return unported("rustc_middle::mir::interpret::error::<InvalidProgramInfo as Display>::fmt");
}

// impl fmt::Display for UnsupportedOpInfo
// stub: compiler/rustc_middle/src/mir/interpret/error.rs:711 fmt (lane mir-interp-b)
export function display_UnsupportedOpInfo(self: UnsupportedOpInfo): string {
  return unported("rustc_middle::mir::interpret::error::<UnsupportedOpInfo as Display>::fmt");
}

// impl fmt::Display for ResourceExhaustionInfo
// stub: compiler/rustc_middle/src/mir/interpret/error.rs:756 fmt (lane mir-interp-b)
export function display_ResourceExhaustionInfo(self: ResourceExhaustionInfo): string {
  return unported("rustc_middle::mir::interpret::error::<ResourceExhaustionInfo as Display>::fmt");
}

// rustc-trait: compiler/rustc_middle/src/mir/interpret/error.rs:774 MachineStopType
/// A trait for machine-specific errors (or other "machine stop" conditions).
/** PORT: `Box<dyn MachineStopType>`: an object with the trait's methods; `Display` / `Debug` are `display()` / `debug(f)`. */
export interface MachineStopType {
  /** `impl fmt::Display` */
  display(): string;
  /** `impl fmt::Debug` */
  debug(f: Fmt): string;
  /// Whether this error should be reported with a validation path.
  with_validation_path(path: string): void;
}
/** PORT: the provided methods of `MachineStopType` (PORTING §8). */
export const MachineStopType_provided = {
  // stub: compiler/rustc_middle/src/mir/interpret/error.rs:776 with_validation_path (lane mir-interp-b)
  with_validation_path(self: MachineStopType, _path: string): void {
    return unported("rustc_middle::mir::interpret::error::MachineStopType::with_validation_path");
  },
};

// impl dyn MachineStopType
// stub: compiler/rustc_middle/src/mir/interpret/error.rs:781 downcast_ref (lane mir-interp-b)
export function MachineStopType_downcast_ref<T>(self: MachineStopType, is_T: (v: MachineStopType) => v is MachineStopType & T): T | undefined {
  return unported("rustc_middle::mir::interpret::error::<dyn MachineStopType>::downcast_ref");
}

// impl fmt::Display for InterpErrorKind
// stub: compiler/rustc_middle/src/mir/interpret/error.rs:805 fmt (lane mir-interp-b)
export function display_InterpErrorKind(self: InterpErrorKind): string {
  return unported("rustc_middle::mir::interpret::error::<InterpErrorKind as Display>::fmt");
}

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:821 formatted_string (lane mir-interp-b)
InterpErrorKind.formatted_string = function (self: InterpErrorKind): boolean {
  return unported("rustc_middle::mir::interpret::error::InterpErrorKind::formatted_string");
};

// impl Drop for Guard
// stub: compiler/rustc_middle/src/mir/interpret/error.rs:926 drop (lane mir-interp-b)
export function Guard_drop(self: Guard): void {
  return unported("rustc_middle::mir::interpret::error::<Guard as Drop>::drop");
}

// impl<'tcx, T> ops::Try for InterpResult<'tcx, T>
// stub: compiler/rustc_middle/src/mir/interpret/error.rs:952 from_output (lane mir-interp-b)
InterpResult.from_output = function <T>(output: T): InterpResult<T> {
  return unported("rustc_middle::mir::interpret::error::<InterpResult as Try>::from_output");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:957 branch (lane mir-interp-b)
InterpResult.branch = function <T>(self: InterpResult<T>): ControlFlow<InterpResult<never>, T> {
  return unported("rustc_middle::mir::interpret::error::<InterpResult as Try>::branch");
};

// impl<'tcx, T> ops::FromResidual for InterpResult<'tcx, T>
// stub: compiler/rustc_middle/src/mir/interpret/error.rs:972 from_residual (lane mir-interp-b)
InterpResult.from_residual = function <T>(residual: InterpResult<never>): InterpResult<T> {
  return unported("rustc_middle::mir::interpret::error::<InterpResult as FromResidual>::from_residual");
};

// impl<'tcx, T> ops::FromResidual<ops::Yeet<InterpErrorKind<'tcx>>> for InterpResult<'tcx, T>
// stub: compiler/rustc_middle/src/mir/interpret/error.rs:982 from_residual (lane mir-interp-b)
InterpResult.from_residual_yeet = function <T>(e: InterpErrorKind): InterpResult<T> {
  return unported("rustc_middle::mir::interpret::error::<InterpResult as FromResidual<Yeet<InterpErrorKind>>>::from_residual");
};

// impl<'tcx, T, E: Into<InterpErrorInfo<'tcx>>> ops::FromResidual<Result<convert::Infallible, E>> for InterpResult<'tcx, T>
// stub: compiler/rustc_middle/src/mir/interpret/error.rs:993 from_residual (lane mir-interp-b)
InterpResult.from_residual_result = function <T, E>(residual: Result<never, E>, into_E: (e: E) => InterpErrorInfo): InterpResult<T> {
  return unported("rustc_middle::mir::interpret::error::<InterpResult as FromResidual<Result<Infallible, E>>>::from_residual");
};

// impl<'tcx, T, E: Into<InterpErrorInfo<'tcx>>> From<Result<T, E>> for InterpResult<'tcx, T>
// stub: compiler/rustc_middle/src/mir/interpret/error.rs:1002 from (lane mir-interp-b)
InterpResult.from_result = function <T, E>(value: Result<T, E>, into_E: (e: E) => InterpErrorInfo): InterpResult<T> {
  return unported("rustc_middle::mir::interpret::error::<InterpResult as From<Result<T, E>>>::from");
};

// impl<'tcx, T, V: FromIterator<T>> FromIterator<InterpResult<'tcx, T>> for InterpResult<'tcx, V>
// stub: compiler/rustc_middle/src/mir/interpret/error.rs:1008 from_iter (lane mir-interp-b)
InterpResult.from_iter = function <T, V>(iter: Iterable<InterpResult<T>>, from_iter_V: (items: Iterable<T>) => V): InterpResult<V> {
  return unported("rustc_middle::mir::interpret::error::<InterpResult as FromIterator>::from_iter");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:1015 new (lane mir-interp-b)
InterpResult.new = function <T>(res: Result<T, InterpErrorInfo>): InterpResult<T> {
  return unported("rustc_middle::mir::interpret::error::InterpResult::new");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:1020 disarm (lane mir-interp-b)
InterpResult.disarm = function <T>(self: InterpResult<T>): Result<T, InterpErrorInfo> {
  return unported("rustc_middle::mir::interpret::error::InterpResult::disarm");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:1027 discard_err (lane mir-interp-b)
InterpResult.discard_err = function <T>(self: InterpResult<T>): T | undefined {
  return unported("rustc_middle::mir::interpret::error::InterpResult::discard_err");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:1034 report_err (lane mir-interp-b)
InterpResult.report_err = function <T>(self: InterpResult<T>): Result<T, InterpErrorInfo> {
  return unported("rustc_middle::mir::interpret::error::InterpResult::report_err");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:1039 map (lane mir-interp-b)
InterpResult.map = function <T, U>(self: InterpResult<T>, f: (t: T) => U): InterpResult<U> {
  return unported("rustc_middle::mir::interpret::error::InterpResult::map");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:1044 map_err_kind (lane mir-interp-b)
InterpResult.map_err_kind = function <T>(self: InterpResult<T>, f: (kind: InterpErrorKind) => InterpErrorKind): InterpResult<T> {
  return unported("rustc_middle::mir::interpret::error::InterpResult::map_err_kind");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:1055 inspect_err_info (lane mir-interp-b)
InterpResult.inspect_err_info = function <T>(self: InterpResult<T>, f: (info: InterpErrorInfo) => void): InterpResult<T> {
  return unported("rustc_middle::mir::interpret::error::InterpResult::inspect_err_info");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:1061 unwrap (lane mir-interp-b)
InterpResult.unwrap = function <T>(self: InterpResult<T>): T {
  return unported("rustc_middle::mir::interpret::error::InterpResult::unwrap");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:1067 unwrap_or_else (lane mir-interp-b)
InterpResult.unwrap_or_else = function <T>(self: InterpResult<T>, f: (info: InterpErrorInfo) => T): T {
  return unported("rustc_middle::mir::interpret::error::InterpResult::unwrap_or_else");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:1073 expect (lane mir-interp-b)
InterpResult.expect = function <T>(self: InterpResult<T>, msg: string): T {
  return unported("rustc_middle::mir::interpret::error::InterpResult::expect");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:1078 and_then (lane mir-interp-b)
InterpResult.and_then = function <T, U>(self: InterpResult<T>, f: (t: T) => InterpResult<U>): InterpResult<U> {
  return unported("rustc_middle::mir::interpret::error::InterpResult::and_then");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:1087 and (lane mir-interp-b)
InterpResult.and = function <T, U>(self: InterpResult<T>, other: InterpResult<U>): InterpResult<[T, U]> {
  return unported("rustc_middle::mir::interpret::error::InterpResult::and");
};

// stub: compiler/rustc_middle/src/mir/interpret/error.rs:1101 interp_ok (lane mir-interp-b)
export function interp_ok<T>(x: T): InterpResult<T> {
  return unported("rustc_middle::mir::interpret::error::interp_ok");
}
