// Port of compiler/rustc_middle/src/mir/interpret/error.rs (lanes mir-contract, mir-interp-b; plan-m4 D3 / D8). The file's
// types are generated into error.gen.ts (set rustc_middle_mir); `InterpResult` and `MachineStopType` are hand-written
// below.
// PORT (D8): `InterpResult<'tcx, T> { res: Result<T, InterpErrorInfo>, guard: Guard }` is src/std/result.ts's
// `Result<T, InterpErrorInfo>` (the `Guard` only catches dropped-unchecked results in debug builds); its methods and the
// `Try` / `FromResidual` / `From` / `FromIterator` impls are companion fns (`InterpResult.map(r, f)`; `?` is
// `if (r.$ === "Err") return r;`, `throw_ub!(..)` is `return Err(InterpErrorInfo_from_InterpErrorKind(..))`). The
// `err_*!` / `throw_*!` macros (error.rs:833..917) are not fns: lanes expand them inline.
// PORT: `write!(f, "{x}")` formats `x` with fresh flags; the `Display` impls here take no `Fmt` and return the text.
// PORT (init order R4): ty/print/pretty.ts, ty/layout.ts, ty/context/tls.ts and rustc_middle diagnostics.gen.ts are read
// lazily.
import "../mod.ts";
import type { PathBuf, DiagArgValue } from "../../../rustc_error_messages/lib.ts";
import type { Backtrace } from "../../../rustc_errors/lib.ts";
import type { ControlFlow } from "../../../rustc_ast_ir/visit.ts";
import { DUMMY_SP, type ErrorGuaranteed, Span } from "../../../rustc_span/lib.ts";
import { display_Symbol } from "../../../rustc_span/symbol.ts";
import { type Debug, type Fmt, PLAIN } from "../../../std/fmt.ts";
import type { MutRef } from "../../../std/mut_ref.ts";
import { panic, panicking, unported } from "../../../std/panic.ts";
import { Err, expect_result, Ok, type Result, unwrap_result } from "../../../std/result.ts";
import { display_AllocRange } from "./allocation.ts";
import { display_AllocId } from "./mod.ts";
import { display_Pointer, display_Pointer_Option, type CtfeProvenance, Pointer } from "./pointer.ts";
import { lower_hex_Scalar } from "./value.ts";
import type { TyCtxt } from "../../ty/context.ts";
import type { LayoutError } from "../../ty/layout.ts";
import * as gen from "./error.gen.ts";
import {
  type CheckInAllocMsg,
  debug_InterpErrorInfo,
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
/** ty/print/pretty.ts, read lazily (module header). */
function pretty(): typeof import("../../ty/print/pretty.ts") {
  return (pretty__m ??= require("../../ty/print/pretty.ts") as typeof import("../../ty/print/pretty.ts"));
}
var pretty__m: typeof import("../../ty/print/pretty.ts") | undefined;
/** ty/context/tls.ts, read lazily (module header). */
function tls(): typeof import("../../ty/context/tls.ts") {
  return (tls__m ??= require("../../ty/context/tls.ts") as typeof import("../../ty/context/tls.ts"));
}
var tls__m: typeof import("../../ty/context/tls.ts") | undefined;
/** rustc_middle diagnostics.gen.ts (`crate::diagnostics`), read lazily (module header). */
function diagnostics(): typeof import("../../diagnostics.gen.ts") {
  return (diagnostics__m ??= require("../../diagnostics.gen.ts") as typeof import("../../diagnostics.gen.ts"));
}
var diagnostics__m: typeof import("../../diagnostics.gen.ts") | undefined;

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
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:33 from
export function ErrorHandled_from_ReportedErrorInfo(error: ReportedErrorInfo): ErrorHandled {
  return { $: "Reported", _0: error, _1: DUMMY_SP };
}

// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:39 with_span
ErrorHandled.with_span = function (self: ErrorHandled, span: Span): ErrorHandled {
  switch (self.$) {
    case "Reported":
      return { $: "Reported", _0: self._0, _1: span };
    case "TooGeneric":
      return { $: "TooGeneric", _0: span };
  }
};

// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:46 emit_note
ErrorHandled.emit_note = function (self: ErrorHandled, tcx: TyCtxt): void {
  switch (self.$) {
    case "Reported": {
      const err = self._0;
      const span = self._1;
      if (!err.allowed_in_infallible && !Span.is_dummy(span)) {
        tcx.dcx().emit_note(diagnostics().ErroneousConstant_diagnostic({ span }));
      }
      break;
    }
    case "TooGeneric":
      break;
  }
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:68 const_eval_error
(ReportedErrorInfo as unknown as { const_eval_error: typeof ReportedErrorInfo.const_eval_error }).const_eval_error = function (error: ErrorGuaranteed): ReportedErrorInfo {
  return new ReportedErrorInfo(error, false);
};

/// Use this when the error that led to this is *not* a const-eval error
/// (e.g., a layout or type checking error).
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:75 non_const_eval_error
(ReportedErrorInfo as unknown as { non_const_eval_error: typeof ReportedErrorInfo.non_const_eval_error }).non_const_eval_error = function (error: ErrorGuaranteed): ReportedErrorInfo {
  return new ReportedErrorInfo(error, true);
};

/// Use this when the error that led to this *is* a const-eval error, but
/// we do allow it to occur in infallible constants (e.g., resource exhaustion).
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:82 allowed_in_infallible
(ReportedErrorInfo as unknown as { allowed_in_infallible: typeof ReportedErrorInfo.allowed_in_infallible }).allowed_in_infallible = function (error: ErrorGuaranteed): ReportedErrorInfo {
  return new ReportedErrorInfo(error, true);
};

// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:86 is_allowed_in_infallible
ReportedErrorInfo.prototype.is_allowed_in_infallible = function (this: ReportedErrorInfo): boolean {
  return this.allowed_in_infallible;
};

// impl From<ReportedErrorInfo> for ErrorGuaranteed
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:93 from
export function ErrorGuaranteed_from_ReportedErrorInfo(val: ReportedErrorInfo): ErrorGuaranteed {
  return val.error;
}

// impl From<ErrorHandled> for ValTreeCreationError
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:115 from
export function ValTreeCreationError_from_ErrorHandled(err: ErrorHandled): ValTreeCreationError {
  return { $: "ErrorHandled", _0: err };
}

// impl From<InterpErrorInfo> for ValTreeCreationError
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:121 from
export function ValTreeCreationError_from_InterpErrorInfo(err: InterpErrorInfo): ValTreeCreationError {
  // An error occurred outside the const-eval query, as part of constructing the valtree. We
  // don't currently preserve the details of this error, since `InterpErrorInfo` cannot be put
  // into a query result and it can only be access of some mutable or external memory.
  const [_kind, backtrace] = err.into_parts();
  backtrace.print_backtrace();
  return ValTreeCreationError.InvalidConst;
}

// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:132 with_span
ValTreeCreationError.with_span = function (self: ValTreeCreationError, span: Span): ValTreeCreationError {
  switch (self.$) {
    case "ErrorHandled":
      return { $: "ErrorHandled", _0: ErrorHandled.with_span(self._0, span) };
    default:
      return self;
  }
};

// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:173 new
(InterpErrorBacktrace as unknown as { new: typeof InterpErrorBacktrace.new }).new = function (): InterpErrorBacktrace {
  const capture_backtrace = tls().with_opt((tcx) => {
    if (tcx !== undefined) {
      return tcx.sess.ctfe_backtrace;
    } else {
      return "Disabled" as const;
    }
  });

  let backtrace: Backtrace | undefined;
  switch (capture_backtrace) {
    case "Disabled":
      backtrace = undefined;
      break;
    case "Capture":
      backtrace = unported("std::backtrace::Backtrace::force_capture (RUSTC_CTFE_BACKTRACE)");
      break;
    case "Immediate": {
      // Print it now.
      const backtrace_: Backtrace = unported("std::backtrace::Backtrace::force_capture (RUSTC_CTFE_BACKTRACE=immediate)");
      print_backtrace(backtrace_);
      backtrace = undefined;
      break;
    }
  }

  return new InterpErrorBacktrace(backtrace);
};

// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:196 print_backtrace
InterpErrorBacktrace.prototype.print_backtrace = function (this: InterpErrorBacktrace): void {
  const backtrace = this.backtrace;
  if (backtrace !== undefined) {
    print_backtrace(backtrace);
  }
};

// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:204 into_parts
InterpErrorInfo.prototype.into_parts = function (this: InterpErrorInfo): [InterpErrorKind, InterpErrorBacktrace] {
  const { kind, backtrace } = this._0;
  return [kind, backtrace];
};

// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:209 into_kind
InterpErrorInfo.prototype.into_kind = function (this: InterpErrorInfo): InterpErrorKind {
  return this._0.kind;
};

// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:213 from_parts
(InterpErrorInfo as unknown as { from_parts: typeof InterpErrorInfo.from_parts }).from_parts = function (kind: InterpErrorKind, backtrace: InterpErrorBacktrace): InterpErrorInfo {
  return new InterpErrorInfo({ kind, backtrace });
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:218 kind
InterpErrorInfo.prototype.kind = function (this: InterpErrorInfo): InterpErrorKind {
  return this._0.kind;
};

/// Turn the given error into a human-readable string. Expects the string to be printed, so if
/// `RUSTC_CTFE_BACKTRACE` is set this will show a backtrace of the rustc internals that
/// triggered the error.
///
/// This is NOT the preferred way to render an error; use `report` from `const_eval` instead.
/// However, this is useful when error messages appear in ICEs.
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:228 to_string
InterpErrorInfo.prototype.to_string = function (this: InterpErrorInfo): string {
  this._0.backtrace.print_backtrace();
  return display_InterpErrorKind(this._0.kind);
};

// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:234 print_backtrace
function print_backtrace(backtrace: Backtrace): void {
  // eprintln!("\n\nAn error occurred in the MIR interpreter:\n{backtrace}");
  void backtrace;
  return unported("Display for std::backtrace::Backtrace (print_backtrace, RUSTC_CTFE_BACKTRACE)");
}

// impl From<ErrorHandled> for InterpErrorInfo
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:239 from
export function InterpErrorInfo_from_ErrorHandled(err: ErrorHandled): InterpErrorInfo {
  let info: InvalidProgramInfo;
  switch (err.$) {
    case "Reported":
      info = { $: "AlreadyReported", _0: err._0 };
      break;
    case "TooGeneric":
      info = { $: "TooGeneric" };
      break;
  }
  return InterpErrorInfo_from_InterpErrorKind({ $: "InvalidProgram", _0: info });
}

// impl From<InterpErrorKind> for InterpErrorInfo
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:249 from
export function InterpErrorInfo_from_InterpErrorKind(kind: InterpErrorKind): InterpErrorInfo {
  return new InterpErrorInfo({
    kind,
    backtrace: InterpErrorBacktrace.new(),
  });
}

// impl fmt::Display for CheckInAllocMsg
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:270 fmt
export function display_CheckInAllocMsg(self: CheckInAllocMsg): string {
  switch (self.$) {
    case "MemoryAccess":
      return "memory access failed";
    case "InboundsPointerArithmetic":
      return "in-bounds pointer arithmetic failed";
    case "Dereferenceable":
      return `${self._0} not dereferenceable`;
  }
}

// impl IntoDiagArg for InvalidMetaKind
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:298 into_diag_arg
export function InvalidMetaKind_into_diag_arg(self: InvalidMetaKind, _1: MutRef<PathBuf | undefined>): DiagArgValue {
  let s: string;
  switch (self) {
    case "SliceTooBig":
      s = "slice_too_big";
      break;
    case "TooBig":
      s = "too_big";
      break;
  }
  return { $: "Str", _0: s };
}

/** `format!("{:#x}", v)` */
function lower_hex_alt(v: number | bigint): string {
  return `0x${v.toString(16)}`;
}

// impl fmt::Display for UndefinedBehaviorInfo
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:437 fmt
export function display_UndefinedBehaviorInfo(self: UndefinedBehaviorInfo): string {
  // rustc: compiler/rustc_middle/src/mir/interpret/error.rs:440 fmt_in_alloc_attempt
  function fmt_in_alloc_attempt(msg: CheckInAllocMsg, inbounds_size: number): string {
    const inbounds_size_fmt = inbounds_size === 1 ? "1 byte" : `${inbounds_size} bytes`;
    let out = `${display_CheckInAllocMsg(msg)}: `;
    switch (msg.$) {
      case "MemoryAccess":
        out += `attempting to access ${inbounds_size_fmt}`;
        break;
      case "InboundsPointerArithmetic":
        out += `attempting to offset pointer by ${inbounds_size_fmt}`;
        break;
      case "Dereferenceable":
        if (inbounds_size === 0) {
          out += `${msg._0} must point to some allocation`;
        } else {
          out += `${msg._0} must be dereferenceable for ${inbounds_size_fmt}`;
        }
        break;
    }
    return out;
  }

  switch (self.$) {
    case "Ub":
      return self._0;

    case "ValidationError":
      if (self.path === undefined) {
        return `constructing invalid value of type ${pretty().display_Ty(self.orig_ty)}: ${self.msg}`;
      } else {
        return `constructing invalid value of type ${pretty().display_Ty(self.orig_ty)}: at ${self.path}, ${self.msg}`;
      }

    case "Unreachable":
      return "entering unreachable code";
    case "BoundsCheckFailed":
      return `indexing out of bounds: the len is ${self.len} but the index is ${self.index}`;
    case "DivisionByZero":
      return "dividing by zero";
    case "RemainderByZero":
      return "calculating the remainder with a divisor of zero";
    case "DivisionOverflow":
      return "overflow in signed division (dividing MIN by -1)";
    case "RemainderOverflow":
      return "overflow in signed remainder (dividing MIN by -1)";
    case "PointerArithOverflow":
      return "overflowing pointer arithmetic: the total offset in bytes does not fit in an `isize`";
    case "ArithOverflow":
      return `arithmetic overflow in \`${display_Symbol(self.intrinsic)}\``;
    case "ShiftOverflow":
      // `impl Display for Either<L, R>` prints the inner value.
      return `overflowing shift by ${self.shift_amount._0} in \`${display_Symbol(self.intrinsic)}\``;
    case "InvalidMeta":
      switch (self._0) {
        case "SliceTooBig":
          return "invalid metadata in wide pointer: slice is bigger than largest supported object";
        case "TooBig":
          return "invalid metadata in wide pointer: total size is bigger than largest supported object";
      }
      break;
    case "UnterminatedCString":
      return `reading a null-terminated string starting at ${display_Pointer(self._0, PLAIN)} with no null found before end of allocation`;
    case "PointerUseAfterFree":
      return `${display_CheckInAllocMsg(self._1)}: ${display_AllocId(self._0)} has been freed, so this pointer is dangling`;
    case "PointerOutOfBounds": {
      const { alloc_id, alloc_size, ptr_offset, inbounds_size, msg } = self;
      let out = fmt_in_alloc_attempt(msg, inbounds_size);
      out += ", but got ";
      // Write pointer. Offset might be negative so we cannot use the normal `impl Display
      // for Pointer`.
      out += display_AllocId(alloc_id);
      if (ptr_offset > 0) {
        out += `+${lower_hex_alt(ptr_offset)}`;
      } else if (ptr_offset < 0) {
        out += `-${lower_hex_alt(-ptr_offset)}`;
      }
      // Write why it is invalid.
      out += " which ";
      if (ptr_offset < 0) {
        out += "points to before the beginning of the allocation";
      } else if (inbounds_size < 0) {
        // We expected the ptr to have memory to its left, but it does not.
        if (ptr_offset === 0) {
          out += "is at the beginning of the allocation";
        } else {
          out += `is only ${ptr_offset} bytes from the beginning of the allocation`;
        }
      } else {
        const ptr_offset_ = ptr_offset;
        const alloc_size_ = alloc_size.bytes();
        if (ptr_offset_ >= alloc_size_) {
          const size = alloc_size_ === 1 ? "1 byte" : `${alloc_size_} bytes`;
          out += `is at or beyond the end of the allocation of size ${size}`;
        } else {
          const dist_to_end = alloc_size_ - ptr_offset_;
          const dist = dist_to_end === 1 ? "1 byte" : `${dist_to_end} bytes`;
          out += `is only ${dist} from the end of the allocation`;
        }
      }
      return out;
    }
    case "DanglingIntPointer": {
      const { addr, inbounds_size, msg } = self;
      if (addr === 0) {
        return `${fmt_in_alloc_attempt(msg, inbounds_size)}, but got null pointer`;
      }
      const ptr = Pointer.without_provenance<CtfeProvenance>(BigInt(addr));
      return `${fmt_in_alloc_attempt(msg, inbounds_size)}, but got ${display_Pointer_Option(ptr, PLAIN)} which is a dangling pointer (it has no provenance)`;
    }
    case "AlignmentCheckFailed": {
      const [misalign, msg] = [self._0, self._1];
      let acc: string;
      switch (msg) {
        case "AccessedPtr":
          acc = "accessing memory";
          break;
        case "BasedOn":
          acc = "accessing memory based on pointer";
          break;
      }
      return `${acc} with alignment ${misalign.has.bytes()}, but alignment ${misalign.required.bytes()} is required`;
    }
    case "WriteToReadOnly":
      return `writing to ${display_AllocId(self._0)} which is read-only`;
    case "DerefFunctionPointer":
      return `accessing ${display_AllocId(self._0)} which contains a function`;
    case "DerefVTablePointer":
      return `accessing ${display_AllocId(self._0)} which contains a vtable`;
    case "DerefVaListPointer":
      return `accessing ${display_AllocId(self._0)} which contains a variable argument list`;
    case "DerefTypeIdPointer":
      return `accessing ${display_AllocId(self._0)} which contains a \`TypeId\``;
    case "InvalidBool":
      return `interpreting an invalid 8-bit value as a bool: 0x${self._0.toString(16).padStart(2, "0")}`;
    case "InvalidChar":
      return `interpreting an invalid 32-bit value as a char: 0x${self._0.toString(16).padStart(8, "0")}`;
    case "InvalidTag":
      return `enum value has invalid tag: ${lower_hex_Scalar(self._0, PLAIN)}`;
    case "InvalidFunctionPointer":
      return `using ${display_Pointer(self._0, PLAIN)} as function pointer but it does not point to a function`;
    case "InvalidVaListPointer":
      return `using ${display_Pointer(self._0, PLAIN)} as variable argument list pointer but it does not point to a variable argument list`;
    case "InvalidVTablePointer":
      return `using ${display_Pointer_Option(self._0, PLAIN)} as vtable pointer but it does not point to a vtable`;
    case "InvalidVTableTrait":
      return `using vtable for \`${pretty().display_List_PolyExistentialPredicate(self.vtable_dyn_type)}\` but \`${pretty().display_List_PolyExistentialPredicate(self.expected_dyn_type)}\` was expected`;
    case "InvalidStr":
      return `this string is not valid UTF-8: ${self._0.toString()}`;
    case "InvalidUninitBytes":
      if (self._0 === undefined) {
        return "using uninitialized data, but this operation requires initialized memory";
      } else {
        const [alloc, info] = self._0;
        return `reading memory at ${display_AllocId(alloc)}${display_AllocRange(info.access)}, but memory is uninitialized at ${display_AllocRange(info.bad)}, and this operation requires initialized memory`;
      }
    case "DeadLocal":
      return "accessing a dead local variable";
    case "UninhabitedEnumVariantWritten":
      return "writing discriminant of an uninhabited enum variant";
    case "UninhabitedEnumVariantRead":
      return "read discriminant of an uninhabited enum variant";
    case "InvalidNichedEnumVariantWritten":
      return `trying to set discriminant of a ${pretty().display_Ty(self.enum_ty)} to the niched variant, but the value does not match`;
    case "AbiMismatchArgument":
      return `calling a function whose parameter #${self.arg_idx + 1 /* adjust for 1-indexed lists in output */} has type ${pretty().display_Ty(self.callee_ty)} passing argument of type ${pretty().display_Ty(self.caller_ty)}`;
    case "AbiMismatchReturn":
      return `calling a function with return type ${pretty().display_Ty(self.callee_ty)} passing return place of type ${pretty().display_Ty(self.caller_ty)}`;
    case "VaArgOutOfBounds":
      return "more C-variadic arguments read than were passed";
    case "CVariadicMismatch":
      return "calling a function where the caller and callee disagree on whether the function is C-variadic";
    case "CVariadicFixedCountMismatch":
      return `calling a C-variadic function with ${self.caller} fixed arguments, but the function expects ${self.callee}`;
  }
}

// impl fmt::Display for InvalidProgramInfo
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:668 fmt
export function display_InvalidProgramInfo(self: InvalidProgramInfo): string {
  switch (self.$) {
    case "TooGeneric":
      return "encountered overly generic constant";
    case "AlreadyReported":
      return "an error has already been reported elsewhere (this should not usually be printed)";
    case "Layout":
      return ty_layout().display_LayoutError(self._0);
  }
}

// impl fmt::Display for UnsupportedOpInfo
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:711 fmt
export function display_UnsupportedOpInfo(self: UnsupportedOpInfo): string {
  switch (self.$) {
    case "Unsupported":
      return self._0;
    case "ExternTypeField":
      return "`extern type` field does not have a known offset";
    case "UnsizedLocal":
      return "unsized locals are not supported";
    case "ReadPartialPointer":
      return `unable to read parts of a pointer from memory at ${display_Pointer(self._0, PLAIN)}`;
    case "ReadPointerAsInt":
      return "unable to turn pointer into integer";
    case "ThreadLocalStatic": {
      const did = self._0;
      return `cannot access thread local static \`${tls().with_((tcx) => tcx.def_path_str(did))}\``;
    }
    case "ExternStatic": {
      const did = self._0;
      return `cannot access extern static \`${tls().with_((tcx) => tcx.def_path_str(did))}\``;
    }
  }
}

// impl fmt::Display for ResourceExhaustionInfo
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:756 fmt
export function display_ResourceExhaustionInfo(self: ResourceExhaustionInfo): string {
  switch (self) {
    case "StackFrameLimitReached":
      return "reached the configured maximum number of stack frames";
    case "MemoryExhausted":
      return "tried to allocate more memory than available to compiler";
    case "AddressSpaceFull":
      return "there are no more free addresses in the address space";
    case "Interrupted":
      return "compilation was interrupted";
  }
}

// rustc-trait: compiler/rustc_middle/src/mir/interpret/error.rs:774 MachineStopType
/// A trait for machine-specific errors (or other "machine stop" conditions).
/** PORT: `Box<dyn MachineStopType>`: an object with the trait's methods; `Display` / `Debug` are `display()` / `debug(f)`. */
export interface MachineStopType {
  /** `impl fmt::Display` */
  display(): string;
  /** `impl fmt::Debug` */
  debug(f: Fmt): string;
  /// This error occurred during validation, inside a value at the given path.
  with_validation_path(path: string): void;
}
/** PORT: the provided methods of `MachineStopType` (PORTING §8). */
export const MachineStopType_provided = {
  /// This error occurred during validation, inside a value at the given path.
  // rustc: compiler/rustc_middle/src/mir/interpret/error.rs:776 with_validation_path
  with_validation_path(self: MachineStopType, _path: string): void {
    void self;
  },
};

// impl dyn MachineStopType
// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:781 downcast_ref
export function MachineStopType_downcast_ref<T>(self: MachineStopType, is_T: (v: MachineStopType) => v is MachineStopType & T): T | undefined {
  // `let x: &dyn Any = self; x.downcast_ref()`
  return is_T(self) ? self : undefined;
}

// impl fmt::Display for InterpErrorKind
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:805 fmt
export function display_InterpErrorKind(self: InterpErrorKind): string {
  switch (self.$) {
    case "Unsupported":
      return display_UnsupportedOpInfo(self._0);
    case "InvalidProgram":
      return display_InvalidProgramInfo(self._0);
    case "UndefinedBehavior":
      return display_UndefinedBehaviorInfo(self._0);
    case "ResourceExhaustion":
      return display_ResourceExhaustionInfo(self._0);
    case "MachineStop":
      return self._0.display();
  }
}

/// Some errors do string formatting even if the error is never printed.
/// To avoid performance issues, there are places where we want to be sure to never raise these formatting errors,
/// so this method lets us detect them and `bug!` on unexpected errors.
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:821 formatted_string
InterpErrorKind.formatted_string = function (self: InterpErrorKind): boolean {
  return (
    (self.$ === "Unsupported" && self._0.$ === "Unsupported") ||
    (self.$ === "UndefinedBehavior" && self._0.$ === "ValidationError") ||
    (self.$ === "UndefinedBehavior" && self._0.$ === "Ub")
  );
};

// impl Drop for Guard
// PORT: there are no destructors; nothing calls this (`InterpResult` is the plain `Result`, header).
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:926 drop
export function Guard_drop(self: Guard): void {
  void self;
  // We silence the guard if we are already panicking, to avoid double-panics.
  if (!panicking()) {
    panic("an interpreter error got improperly discarded; use `discard_err()` if this is intentional");
  }
}

// impl<'tcx, T> ops::Try for InterpResult<'tcx, T>
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:952 from_output
InterpResult.from_output = function <T>(output: T): InterpResult<T> {
  return InterpResult.new(Ok(output));
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:957 branch
InterpResult.branch = function <T>(self: InterpResult<T>): ControlFlow<InterpResult<never>, T> {
  const r = InterpResult.disarm(self);
  switch (r.$) {
    case "Ok":
      return { $: "Continue", _0: r._0 };
    case "Err":
      return { $: "Break", _0: InterpResult.new<never>(Err(r._0)) };
  }
};

// impl<'tcx, T> ops::FromResidual for InterpResult<'tcx, T>
// #[inline]
// #[track_caller]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:972 from_residual
InterpResult.from_residual = function <T>(residual: InterpResult<never>): InterpResult<T> {
  const r = InterpResult.disarm(residual);
  // `Infallible`: only `Err(e)`
  return InterpResult.new<T>(Err((r as { readonly $: "Err"; readonly _0: InterpErrorInfo })._0));
};

// Allow `yeet`ing `InterpError` in functions returning `InterpResult_`.
// impl<'tcx, T> ops::FromResidual<ops::Yeet<InterpErrorKind<'tcx>>> for InterpResult<'tcx, T>
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:982 from_residual
InterpResult.from_residual_yeet = function <T>(e: InterpErrorKind): InterpResult<T> {
  return InterpResult.new<T>(Err(InterpErrorInfo_from_InterpErrorKind(e)));
};

// Allow `?` on `Result<_, InterpError>` in functions returning `InterpResult_`.
// This is useful e.g. for `option.ok_or_else(|| err_ub!(...))`.
// impl<'tcx, T, E: Into<InterpErrorInfo<'tcx>>> ops::FromResidual<Result<convert::Infallible, E>> for InterpResult<'tcx, T>
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:993 from_residual
InterpResult.from_residual_result = function <T, E>(residual: Result<never, E>, into_E: (e: E) => InterpErrorInfo): InterpResult<T> {
  // `Infallible`: only `Err(e)`
  return InterpResult.new<T>(Err(into_E((residual as { readonly $: "Err"; readonly _0: E })._0)));
};

// impl<'tcx, T, E: Into<InterpErrorInfo<'tcx>>> From<Result<T, E>> for InterpResult<'tcx, T>
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:1002 from
InterpResult.from_result = function <T, E>(value: Result<T, E>, into_E: (e: E) => InterpErrorInfo): InterpResult<T> {
  return InterpResult.new(value.$ === "Ok" ? value : Err(into_E(value._0)));
};

// impl<'tcx, T, V: FromIterator<T>> FromIterator<InterpResult<'tcx, T>> for InterpResult<'tcx, V>
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:1008 from_iter
InterpResult.from_iter = function <T, V>(iter: Iterable<InterpResult<T>>, from_iter_V: (items: Iterable<T>) => V): InterpResult<V> {
  // `iter.into_iter().map(|x| x.disarm()).collect::<Result<V, _>>()`: `V::from_iter` sees the items up to the first
  // `Err` (core's `GenericShunt`), which is then the result.
  let error: InterpErrorInfo | undefined;
  const shunt = function* (): Generator<T> {
    for (const x of iter) {
      const r = InterpResult.disarm(x);
      if (r.$ === "Err") {
        error = r._0;
        return;
      }
      yield r._0;
    }
  };
  const v = from_iter_V(shunt());
  return InterpResult.new(error !== undefined ? Err(error) : Ok(v));
};

// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:1015 new
InterpResult.new = function <T>(res: Result<T, InterpErrorInfo>): InterpResult<T> {
  // `Self { res, guard: Guard }` (header: no guard)
  return res;
};

// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:1020 disarm
InterpResult.disarm = function <T>(self: InterpResult<T>): Result<T, InterpErrorInfo> {
  // `mem::forget(self.guard); self.res` (header: no guard)
  return self;
};

/// Discard the error information in this result. Only use this if ignoring Undefined Behavior is okay!
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:1027 discard_err
InterpResult.discard_err = function <T>(self: InterpResult<T>): T | undefined {
  const r = InterpResult.disarm(self);
  return r.$ === "Ok" ? r._0 : undefined;
};

/// Look at the `Result` wrapped inside of this.
/// Must only be used to report the error!
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:1034 report_err
InterpResult.report_err = function <T>(self: InterpResult<T>): Result<T, InterpErrorInfo> {
  return InterpResult.disarm(self);
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:1039 map
InterpResult.map = function <T, U>(self: InterpResult<T>, f: (t: T) => U): InterpResult<U> {
  const r = InterpResult.disarm(self);
  return InterpResult.new(r.$ === "Ok" ? Ok(f(r._0)) : r);
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:1044 map_err_kind
InterpResult.map_err_kind = function <T>(self: InterpResult<T>, f: (kind: InterpErrorKind) => InterpErrorKind): InterpResult<T> {
  const r = InterpResult.disarm(self);
  if (r.$ === "Err") {
    const e = r._0;
    e._0.kind = f(e._0.kind);
    return InterpResult.new<T>(Err(e));
  }
  return InterpResult.new(r);
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:1055 inspect_err_info
InterpResult.inspect_err_info = function <T>(self: InterpResult<T>, f: (info: InterpErrorInfo) => void): InterpResult<T> {
  const r = InterpResult.disarm(self);
  if (r.$ === "Err") f(r._0);
  return InterpResult.new(r);
};

// #[inline]
// #[track_caller]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:1061 unwrap
InterpResult.unwrap = function <T>(self: InterpResult<T>): T {
  return unwrap_result(InterpResult.disarm(self), debug_InterpErrorInfo);
};

// #[inline]
// #[track_caller]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:1067 unwrap_or_else
InterpResult.unwrap_or_else = function <T>(self: InterpResult<T>, f: (info: InterpErrorInfo) => T): T {
  const r = InterpResult.disarm(self);
  return r.$ === "Ok" ? r._0 : f(r._0);
};

// #[inline]
// #[track_caller]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:1073 expect
InterpResult.expect = function <T>(self: InterpResult<T>, msg: string): T {
  return expect_result(InterpResult.disarm(self), msg, debug_InterpErrorInfo);
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:1078 and_then
InterpResult.and_then = function <T, U>(self: InterpResult<T>, f: (t: T) => InterpResult<U>): InterpResult<U> {
  const r = InterpResult.disarm(self);
  return InterpResult.new(r.$ === "Ok" ? InterpResult.disarm(f(r._0)) : r);
};

/// Returns success if both `self` and `other` succeed, while ensuring we don't
/// accidentally drop an error.
///
/// If both are an error, `self` will be reported.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:1087 and
InterpResult.and = function <T, U>(self: InterpResult<T>, other: InterpResult<U>): InterpResult<[T, U]> {
  const r = InterpResult.disarm(self);
  switch (r.$) {
    case "Ok": {
      const t = r._0;
      if (other.$ === "Err") return other;
      return interp_ok<[T, U]>([t, other._0]);
    }
    case "Err": {
      const e = r._0;
      // Discard the other error.
      InterpResult.disarm(other);
      // Return `self`.
      return InterpResult.new<[T, U]>(Err(e));
    }
  }
};

// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/interpret/error.rs:1101 interp_ok
export function interp_ok<T>(x: T): InterpResult<T> {
  return InterpResult.new(Ok(x));
}
