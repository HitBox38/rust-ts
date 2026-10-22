// Port of compiler/rustc_mir_transform/src/diagnostics.rs (lane mt-built-lints): the types and their
// `#[derive(Diagnostic)]` / `#[derive(Subdiagnostic)]` impls are generated into diagnostics.gen.ts
// (tools/codegen/types.ts, set rustc_mir_transform); the manual `impl Diagnostic` / `impl Subdiagnostic` blocks and
// `AssertLintKind::lint` are ported here.
//
// PORT: `AssertLint<P: fmt::Debug>`'s `Diagnostic` impl takes the `Debug` of `P` as a parameter (`debug_P`), as
// `display_AssertKind` does.
import { str_into_diag_arg, String_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import { Applicability, Diag, type DiagCtxtHandle, type Diagnostic, IntoDiagArg, type Level, msg } from "../rustc_errors/lib.ts";
import type { Lint } from "../rustc_lint_defs/lib.ts";
import { ARITHMETIC_OVERFLOW, UNCONDITIONAL_PANIC } from "../rustc_lint_defs/builtin.ts";
import { display_AssertKind } from "../rustc_middle/mir/terminator.ts";
import { Span } from "../rustc_span/lib.ts";
import { display_Symbol } from "../rustc_span/symbol.ts";
import type { Debug } from "../std/fmt.ts";
import type {
  AssertLint,
  AssertLintKind,
  MustNotSupend,
  UnusedAssignOverwrite,
  UnusedVariableStringInterp,
} from "./diagnostics.gen.ts";
import { MustNotSuspendReason_subdiagnostic } from "./diagnostics.gen.ts";

export * from "./diagnostics.gen.ts";

// impl<'a, P: std::fmt::Debug> Diagnostic<'a> for AssertLint<P>
// rustc: compiler/rustc_mir_transform/src/diagnostics.rs:101 into_diag
export function AssertLint_into_diag<P>(
  self: AssertLint<P>,
  debug_P: Debug<P>,
  dcx: DiagCtxtHandle,
  level: Level,
): Diag {
  let message;
  switch (self.lint_kind) {
    case "ArithmeticOverflow":
      message = msg("this arithmetic operation will overflow");
      break;
    case "UnconditionalPanic":
      message = msg("this operation will panic at runtime");
      break;
  }
  const diag = Diag.new(dcx, level, message);
  diag.span_label(self.span, display_AssertKind(self.assert_kind, debug_P));
  return diag;
}
/** `AssertLint<P>` as a `Diagnostic` trait object. */
export function AssertLint_diagnostic<P>(self: AssertLint<P>, debug_P: Debug<P>): Diagnostic {
  return { into_diag: (dcx, level) => AssertLint_into_diag(self, debug_P, dcx, level) };
}

// impl AssertLintKind
// rustc: compiler/rustc_mir_transform/src/diagnostics.rs:120 lint
export function AssertLintKind_lint(self: AssertLintKind): Lint {
  switch (self) {
    case "ArithmeticOverflow":
      return ARITHMETIC_OVERFLOW;
    case "UnconditionalPanic":
      return UNCONDITIONAL_PANIC;
  }
}

// impl Subdiagnostic for UnusedAssignOverwrite
// rustc: compiler/rustc_mir_transform/src/diagnostics.rs:221 add_to_diag
export function UnusedAssignOverwrite_add_to_diag(self: UnusedAssignOverwrite, diag: Diag): void {
  diag.span_label(self.assigned_span, "this value is reassigned later and never used");
  diag.span_label(
    self.overwrite_span,
    `\`${display_Symbol(self.name)}\` is overwritten here before the previous value is read`,
  );
}
/** `UnusedAssignOverwrite` as a `Subdiagnostic` trait object. */
export function UnusedAssignOverwrite_subdiagnostic(self: UnusedAssignOverwrite) {
  return { add_to_diag: (diag: Diag) => UnusedAssignOverwrite_add_to_diag(self, diag) };
}

// impl Subdiagnostic for UnusedVariableStringInterp
// rustc: compiler/rustc_mir_transform/src/diagnostics.rs:300 add_to_diag
export function UnusedVariableStringInterp_add_to_diag(self: UnusedVariableStringInterp, diag: Diag): void {
  diag.span_label(self.lit, msg("you might have meant to use string interpolation in this string literal"));
  diag.multipart_suggestion(
    msg("string interpolation only works in `format!` invocations"),
    [
      [Span.shrink_to_lo(self.lit), "format!("],
      [Span.shrink_to_hi(self.lit), ")"],
    ],
    Applicability.MachineApplicable,
  );
}
/** `UnusedVariableStringInterp` as a `Subdiagnostic` trait object. */
export function UnusedVariableStringInterp_subdiagnostic(self: UnusedVariableStringInterp) {
  return { add_to_diag: (diag: Diag) => UnusedVariableStringInterp_add_to_diag(self, diag) };
}

// Needed for def_path_str
// impl<'a> Diagnostic<'a> for MustNotSupend<'_, '_>
// rustc: compiler/rustc_mir_transform/src/diagnostics.rs:342 into_diag
export function MustNotSupend_into_diag(self: MustNotSupend, dcx: DiagCtxtHandle, level: Level): Diag {
  const diag = Diag.new(
    dcx,
    level,
    msg("{$pre}`{$def_path}`{$post} held across a suspend point, but should not be"),
  );
  diag.span_label(self.yield_sp, msg("the value is held across this suspend point"));
  if (self.reason !== undefined) {
    const reason = self.reason;
    diag.subdiagnostic(MustNotSuspendReason_subdiagnostic(reason));
  }
  diag.span_help(
    self.src_sp,
    msg(
      "consider using a block (`{\"{ ... }\"}`) to shrink the value's scope, ending before the suspend point",
    ),
  );
  diag.arg("pre", IntoDiagArg.of(self.pre, str_into_diag_arg));
  diag.arg("def_path", IntoDiagArg.of(self.tcx.def_path_str(self.def_id), String_into_diag_arg));
  diag.arg("post", IntoDiagArg.of(self.post, str_into_diag_arg));
  return diag;
}
/** `MustNotSupend` as a `Diagnostic` trait object. */
export function MustNotSupend_diagnostic(self: MustNotSupend): Diagnostic {
  return { into_diag: (dcx, level) => MustNotSupend_into_diag(self, dcx, level) };
}
