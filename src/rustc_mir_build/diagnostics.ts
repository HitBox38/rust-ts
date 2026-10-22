// Port of compiler/rustc_mir_build/src/diagnostics.rs (lane thir-pattern): the types and their `#[derive(Diagnostic)]` /
// `#[derive(Subdiagnostic)]` / `#[derive(LintDiagnostic)]` impls are generated into diagnostics.gen.ts
// (tools/codegen/types.ts, set rustc_mir_build); the manual `impl Diagnostic` / `impl Subdiagnostic` blocks are ported
// here.
import { number_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import { MultiSpan } from "../rustc_error_messages/lib.ts";
import {
  Applicability,
  Diag,
  type DiagCtxtHandle,
  type Diagnostic,
  E0004,
  IntoDiagArg,
  type Level,
  msg,
  type Subdiagnostic,
} from "../rustc_errors/lib.ts";
import { Node } from "../rustc_hir/hir.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { Ty_into_diag_arg } from "../rustc_middle/ty/diagnostics.ts";
import type { TypingEnv } from "../rustc_middle/ty/mod.ts";
import type { LocalModId } from "../rustc_span/def_id.ts";
import { Span } from "../rustc_span/lib.ts";
import type {
  AdtDefinedHere,
  NonExhaustivePatternsTypeNotEmpty,
  UnreachablePattern,
  UnsafeNotInheritedLintNote,
} from "./diagnostics.gen.ts";
import { UnreachablePatternInner_into_diag } from "./diagnostics.gen.ts";

export * from "./diagnostics.gen.ts";

// impl Subdiagnostic for UnsafeNotInheritedLintNote
// rustc: compiler/rustc_mir_build/src/diagnostics.rs:588 add_to_diag
export function UnsafeNotInheritedLintNote_add_to_diag(self: UnsafeNotInheritedLintNote, diag: Diag): void {
  diag.span_note(
    self.signature_span,
    msg("an unsafe function restricts its caller, but its body is safe by default"),
  );
  const body_start = Span.shrink_to_lo(self.body_span);
  const body_end = Span.shrink_to_hi(self.body_span);
  diag.tool_only_multipart_suggestion(
    msg("consider wrapping the function body in an unsafe block"),
    [
      [body_start, "{ unsafe "],
      [body_end, "}"],
    ],
    Applicability.MachineApplicable,
  );
}
/** `UnsafeNotInheritedLintNote` as a `Subdiagnostic` trait object. */
export function UnsafeNotInheritedLintNote_subdiagnostic(self: UnsafeNotInheritedLintNote): Subdiagnostic {
  return { add_to_diag: (diag) => UnsafeNotInheritedLintNote_add_to_diag(self, diag) };
}

// impl<'a> Diagnostic<'a> for NonExhaustivePatternsTypeNotEmpty<'_, '_>
// rustc: compiler/rustc_mir_build/src/diagnostics.rs:629 into_diag
export function NonExhaustivePatternsTypeNotEmpty_into_diag(
  self: NonExhaustivePatternsTypeNotEmpty,
  dcx: DiagCtxtHandle,
  level: Level,
): Diag {
  const cx = self.cx;
  const diag = Diag.new(dcx, level, msg("non-exhaustive patterns: type `{$ty}` is non-empty"));
  diag.span(self.scrut_span);
  diag.code(E0004);
  const peeled_ty = self.ty.peel_refs();
  diag.arg("ty", IntoDiagArg.of(self.ty, Ty_into_diag_arg));
  diag.arg("peeled_ty", IntoDiagArg.of(peeled_ty, Ty_into_diag_arg));

  const peeled_kind = peeled_ty.kind();
  if (peeled_kind.$ === "Adt") {
    const def = peeled_kind._0;
    const node = cx.tcx.hir_get_if_local(def.did());
    const ident = node === undefined ? undefined : Node.ident(node);
    const def_span = ident !== undefined ? ident.span : cx.tcx.def_span(def.did());

    // workaround to make test pass
    const span: MultiSpan = MultiSpan.from_span(def_span);
    span.push_span_label(def_span, "");

    diag.span_note(span, msg("`{$peeled_ty}` defined here"));
  }

  const kind = self.ty.kind();
  const is_non_exhaustive = kind.$ === "Adt" && kind._0.variant_list_has_applicable_non_exhaustive();
  if (is_non_exhaustive) {
    diag.note(msg("the matched value is of type `{$ty}`, which is marked as non-exhaustive"));
  } else {
    diag.note(msg("the matched value is of type `{$ty}`"));
  }

  if (kind.$ === "Ref") {
    const sub_ty = kind._1;
    if (!sub_ty.is_inhabited_from(cx.tcx, cx.module, cx.typing_env)) {
      diag.note(msg("references are always considered inhabited"));
    }
  }

  const sm = cx.tcx.sess.source_map();
  if (self.braces_span !== undefined) {
    const braces_span = self.braces_span;
    // Get the span for the empty match body `{}`.
    let indentation: string;
    let more: string;
    const snippet = sm.indentation_before(self.scrut_span);
    if (snippet !== undefined) {
      [indentation, more] = [`\n${snippet}`, "    "];
    } else {
      [indentation, more] = [" ", ""];
    }
    diag.span_suggestion_verbose(
      braces_span,
      msg(
        "ensure that all possible cases are being handled by adding a match arm with a wildcard pattern as shown",
      ),
      // ignore-tidy-todo
      ` {${indentation}${more}_ => todo!(),${indentation}}`,
      Applicability.HasPlaceholders,
    );
  } else {
    diag.help(
      msg("ensure that all possible cases are being handled by adding a match arm with a wildcard pattern"),
    );
  }

  return diag;
}
/** `NonExhaustivePatternsTypeNotEmpty` as a `Diagnostic` trait object. */
export function NonExhaustivePatternsTypeNotEmpty_diagnostic(self: NonExhaustivePatternsTypeNotEmpty): Diagnostic {
  return { into_diag: (dcx, level) => NonExhaustivePatternsTypeNotEmpty_into_diag(self, dcx, level) };
}

// impl<'a, 'tcx> Diagnostic<'a> for UnreachablePattern<'tcx>
// #[track_caller]
// rustc: compiler/rustc_mir_build/src/diagnostics.rs:735 into_diag
export function UnreachablePattern_into_diag(self: UnreachablePattern, dcx: DiagCtxtHandle, level: Level): Diag {
  const diag = UnreachablePatternInner_into_diag(self.inner, dcx, level);
  if (self.covered_by_many_n_more_count !== undefined) {
    const covered_by_many_n_more_count = self.covered_by_many_n_more_count;
    diag.arg("covered_by_many_n_more_count", IntoDiagArg.of(covered_by_many_n_more_count, number_into_diag_arg));
  }
  return diag;
}
/** `UnreachablePattern` as a `Diagnostic` trait object. */
export function UnreachablePattern_diagnostic(self: UnreachablePattern): Diagnostic {
  return { into_diag: (dcx, level) => UnreachablePattern_into_diag(self, dcx, level) };
}

// impl<'tcx> Subdiagnostic for AdtDefinedHere<'tcx>
// rustc: compiler/rustc_mir_build/src/diagnostics.rs:1263 add_to_diag
export function AdtDefinedHere_add_to_diag(self: AdtDefinedHere, diag: Diag): void {
  diag.arg("ty", IntoDiagArg.of(self.ty, Ty_into_diag_arg));
  const spans = MultiSpan.from_span(self.adt_def_span);

  for (const { span } of self.variants) {
    spans.push_span_label(span, msg("not covered"));
  }

  diag.span_note(spans, msg("`{$ty}` defined here"));
}
/** `AdtDefinedHere` as a `Subdiagnostic` trait object. */
export function AdtDefinedHere_subdiagnostic(self: AdtDefinedHere): Subdiagnostic {
  return { add_to_diag: (diag) => AdtDefinedHere_add_to_diag(self, diag) };
}
