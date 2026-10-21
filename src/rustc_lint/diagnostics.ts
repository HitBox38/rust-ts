// Port of compiler/rustc_lint/src/diagnostics.rs: the hand-written `Diagnostic` / `Subdiagnostic` impls. The types
// and every `#[derive(Diagnostic)]` / `#[derive(Subdiagnostic)]` are generated into diagnostics.gen.ts
// (tools/codegen/types.ts, set `rustc_lint`).
//
// PORT: `msg!("..")` → `msg("..")`.
import { DiagMessage_arg } from "../rustc_errors/formatting.ts";
import {
  Diag,
  type DiagCtxtHandle,
  DiagStyledString,
  type Diagnostic,
  type Level,
  type Subdiagnostic,
  type SuggestionStyle,
  msg,
} from "../rustc_errors/lib.ts";
import { number_into_diag_arg, String_into_diag_arg, str_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import { IntoDiagArg } from "../rustc_error_messages/lib.ts";
import type { Applicability } from "../rustc_lint_defs/lib.ts";
import { add_feature_diagnostics } from "../rustc_session/diagnostics.ts";
import { Span } from "../rustc_span/lib.ts";
import { display_Ident, Symbol, sym } from "../rustc_span/symbol.ts";
import { panic } from "../std/panic.ts";
import type * as hir from "../rustc_hir/hir.ts";
import { WherePredicateKind } from "../rustc_hir/hir.ts";
import { Ty_into_diag_arg } from "../rustc_middle/ty/diagnostics.ts";
import { Clause_into_diag_arg } from "../rustc_middle/ty/predicate.ts";
import { display_PolyFnSig } from "../rustc_middle/ty/print/pretty.ts";
import { LifetimeSyntaxCategories } from "./lifetime_syntax.ts";
import { type InitError, ShorthandAssocTyCollector, TypeAliasBounds } from "./builtin.ts";
import type {
  AsyncFnInTraitDiag,
  BuiltinClashingExternSub,
  BuiltinMissingDebugImpl,
  BuiltinTypeAliasBounds,
  BuiltinUngatedAsyncFnTrackCaller,
  BuiltinUnpermittedTypeInit,
  BuiltinUnpermittedTypeInitSub,
  DropGlue,
  DropTraitConstraintsDiag,
  ImproperCTypes,
  MismatchedLifetimeSyntaxes,
  MismatchedLifetimeSyntaxesSuggestion as MismatchedLifetimeSyntaxesSuggestion_,
  NonBindingLetSub,
  NonFmtPanicUnused,
  NonLocalDefinitionsDiag,
  NonSnakeCaseDiagSub,
  OverruledAttributeSub,
  UnusedDef,
} from "./diagnostics.gen.ts";
import { NonLocalDefinitionsCargoUpdateNote_subdiagnostic, UnusedDefSuggestion_subdiagnostic } from "./diagnostics.gen.ts";

export * from "./diagnostics.gen.ts";

/** `impl Subdiagnostic for OverruledAttributeSub` */
// rustc: compiler/rustc_lint/src/diagnostics.rs:45 add_to_diag
export function OverruledAttributeSub_add_to_diag(self: OverruledAttributeSub, diag: Diag): void {
  switch (self.$) {
    case "DefaultSource": {
      const { id } = self;
      diag.note(msg("`forbid` lint level is the default for {$id}"));
      diag.arg("id", IntoDiagArg.of(id, String_into_diag_arg));
      break;
    }
    case "NodeSource": {
      const { span, reason } = self;
      diag.span_label(span, msg("`forbid` level set here"));
      if (reason !== undefined) {
        const rationale = reason;
        diag.note(Symbol.as_str(rationale));
      }
      break;
    }
    case "CommandLineSource": {
      const { id } = self;
      diag.note(msg("`forbid` lint level was set on command line (`-F {$id}`)"));
      diag.arg("id", IntoDiagArg.of(id, (s: Symbol) => ({ $: "Str", _0: Symbol.as_str(s) })));
      break;
    }
  }
}
export function OverruledAttributeSub_subdiagnostic(self: OverruledAttributeSub): Subdiagnostic {
  return { add_to_diag: (diag) => OverruledAttributeSub_add_to_diag(self, diag) };
}

/** `impl<'a> Diagnostic<'a> for BuiltinMissingDebugImpl<'_>` (needed for def_path_str) */
// rustc: compiler/rustc_lint/src/diagnostics.rs:312 into_diag
export function BuiltinMissingDebugImpl_into_diag(self: BuiltinMissingDebugImpl, dcx: DiagCtxtHandle, level: Level): Diag {
  const { tcx, def_id } = self;
  return Diag.new(
    dcx,
    level,
    msg("type does not implement `{$debug}`; consider adding `#[derive(Debug)]` or a manual implementation"),
  ).with_arg("debug", IntoDiagArg.of(tcx.def_path_str(def_id), String_into_diag_arg));
}
export function BuiltinMissingDebugImpl_diagnostic(self: BuiltinMissingDebugImpl): Diagnostic {
  return { into_diag: (dcx, level) => BuiltinMissingDebugImpl_into_diag(self, dcx, level) };
}

/** `impl<'a> Diagnostic<'a> for BuiltinUngatedAsyncFnTrackCaller<'_>` */
// rustc: compiler/rustc_lint/src/diagnostics.rs:372 into_diag
export function BuiltinUngatedAsyncFnTrackCaller_into_diag(self: BuiltinUngatedAsyncFnTrackCaller, dcx: DiagCtxtHandle, level: Level): Diag {
  const diag = Diag.new(dcx, level, "`#[track_caller]` on async functions is a no-op").with_span_label(
    self.label,
    "this function will not propagate the caller location",
  );
  add_feature_diagnostics(diag, self.session, sym.async_fn_track_caller);
  return diag;
}
export function BuiltinUngatedAsyncFnTrackCaller_diagnostic(self: BuiltinUngatedAsyncFnTrackCaller): Diagnostic {
  return { into_diag: (dcx, level) => BuiltinUngatedAsyncFnTrackCaller_into_diag(self, dcx, level) };
}

/** `impl<'a> Diagnostic<'a> for BuiltinTypeAliasBounds<'_>` */
// rustc: compiler/rustc_lint/src/diagnostics.rs:416 into_diag
export function BuiltinTypeAliasBounds_into_diag(self: BuiltinTypeAliasBounds, dcx: DiagCtxtHandle, level: Level): Diag {
  const diag = Diag.new(
    dcx,
    level,
    self.in_where_clause
      ? msg("where clauses on type aliases are not enforced")
      : msg("bounds on generic parameters in type aliases are not enforced"),
  )
    .with_span_label(self.label, msg("will not be checked at usage sites of the type alias"))
    .with_note(
      msg(
        "this is a known limitation of the type checker that may be lifted in a future edition.\n                see issue #112792 <https://github.com/rust-lang/rust/issues/112792> for more information",
      ),
    );
  if (self.enable_feat_help) {
    diag.help(msg("add `#![feature(checked_type_aliases)]` to the crate attributes to enable the desired semantics"));
  }

  // We perform the walk in here instead of in `<TypeAliasBounds as LateLintPass>` to
  // avoid doing throwaway work in case the lint ends up getting suppressed.
  const collector = new ShorthandAssocTyCollector([]);
  // PORT: the generated struct types `preds` / `ty` as `unknown` (`&'hir [hir::WherePredicate]`, `Option<&hir::Ty>`).
  const ty = self.ty as hir.Ty | undefined;
  if (ty !== undefined) {
    collector.visit_ty_unambig(ty);
  }

  const affect_object_lifetime_defaults = (self.preds as readonly hir.WherePredicate[])
    .filter((pred) => WherePredicateKind.in_where_clause(pred.kind) === self.in_where_clause)
    .some((pred) => TypeAliasBounds.affects_object_lifetime_defaults(pred));

  // If there are any shorthand assoc tys, then the bounds can't be removed automatically.
  // The user first needs to fully qualify the assoc tys.
  const applicability: Applicability =
    !(collector.qselves.length === 0) || affect_object_lifetime_defaults ? "MaybeIncorrect" : "MachineApplicable";

  diag.arg("count", IntoDiagArg.of(self.suggestions.length, number_into_diag_arg));
  diag.multipart_suggestion(
    self.in_where_clause
      ? msg("remove this where clause")
      : msg(
          "remove {$count ->\n                        [one] this bound\n                        *[other] these bounds\n                    }",
        ),
    self.suggestions,
    applicability,
  );

  // Suggest fully qualifying paths of the form `T::Assoc` with `T` type param via
  // `<T as /* Trait */>::Assoc` to remove their reliance on any type param bounds.
  //
  // Instead of attempting to figure out the necessary trait ref, just use a
  // placeholder. Since we don't record type-dependent resolutions for non-body
  // items like type aliases, we can't simply deduce the corresp. trait from
  // the HIR path alone without rerunning parts of HIR ty lowering here
  // (namely `probe_single_ty_param_bound_for_assoc_ty`) which is infeasible.
  //
  // (We could employ some simple heuristics but that's likely not worth it).
  for (const qself of collector.qselves) {
    diag.multipart_suggestion(
      msg("fully qualify this associated type"),
      [
        [Span.shrink_to_lo(qself), "<"],
        [Span.shrink_to_hi(qself), " as /* Trait */>"],
      ],
      "HasPlaceholders",
    );
  }
  return diag;
}
export function BuiltinTypeAliasBounds_diagnostic(self: BuiltinTypeAliasBounds): Diagnostic {
  return { into_diag: (dcx, level) => BuiltinTypeAliasBounds_into_diag(self, dcx, level) };
}

/** `impl<'a> Diagnostic<'a> for BuiltinUnpermittedTypeInit<'_>` */
// rustc: compiler/rustc_lint/src/diagnostics.rs:619 into_diag
export function BuiltinUnpermittedTypeInit_into_diag(self: BuiltinUnpermittedTypeInit, dcx: DiagCtxtHandle, level: Level): Diag {
  const diag = Diag.new(dcx, level, self.msg)
    .with_arg("ty", IntoDiagArg.of(self.ty, Ty_into_diag_arg))
    .with_span_label(self.label, msg("this code causes undefined behavior when executed"));
  // PORT: `InhabitedPredicate` is a pending stand-in (rustc_middle ty/inhabitedness, not ported: the call stops there).
  if ((self.ty.inhabited_predicate(self.tcx) as unknown as { $: string }).$ === "True") {
    // Only suggest late `MaybeUninit::assume_init` initialization if the type is inhabited.
    diag.span_label(
      self.label,
      msg("help: use `MaybeUninit<T>` instead, and only call `assume_init` after initialization is done"),
    );
  }
  BuiltinUnpermittedTypeInitSub_add_to_diag(self.sub, diag);
  return diag;
}
export function BuiltinUnpermittedTypeInit_diagnostic(self: BuiltinUnpermittedTypeInit): Diagnostic {
  return { into_diag: (dcx, level) => BuiltinUnpermittedTypeInit_into_diag(self, dcx, level) };
}

/** `impl Subdiagnostic for BuiltinUnpermittedTypeInitSub` */
// rustc: compiler/rustc_lint/src/diagnostics.rs:641 add_to_diag
export function BuiltinUnpermittedTypeInitSub_add_to_diag(self: BuiltinUnpermittedTypeInitSub, diag: Diag): void {
  // PORT: the generated struct types `err` as `unknown` (`builtin::InitError`).
  let err = self.err as InitError;
  for (;;) {
    if (err.span !== undefined) {
      diag.span_note(err.span, err.message);
    } else {
      diag.note(err.message);
    }
    if (err.nested !== undefined) {
      err = err.nested;
    } else {
      break;
    }
  }
}
export function BuiltinUnpermittedTypeInitSub_subdiagnostic(self: BuiltinUnpermittedTypeInitSub): Subdiagnostic {
  return { add_to_diag: (diag) => BuiltinUnpermittedTypeInitSub_add_to_diag(self, diag) };
}

/** `impl Subdiagnostic for BuiltinClashingExternSub<'_>` */
// rustc: compiler/rustc_lint/src/diagnostics.rs:692 add_to_diag
export function BuiltinClashingExternSub_add_to_diag(self: BuiltinClashingExternSub, diag: Diag): void {
  const expected_str = DiagStyledString.new();
  expected_str.push(display_PolyFnSig(self.expected.fn_sig(self.tcx)), false);
  const found_str = DiagStyledString.new();
  found_str.push(display_PolyFnSig(self.found.fn_sig(self.tcx)), true);
  diag.note_expected_found("", expected_str, "", found_str);
}
export function BuiltinClashingExternSub_subdiagnostic(self: BuiltinClashingExternSub): Subdiagnostic {
  return { add_to_diag: (diag) => BuiltinClashingExternSub_add_to_diag(self, diag) };
}

/** `impl Subdiagnostic for NonBindingLetSub` */
// rustc: compiler/rustc_lint/src/diagnostics.rs:1370 add_to_diag
export function NonBindingLetSub_add_to_diag(self: NonBindingLetSub, diag: Diag): void {
  const can_suggest_binding = self.drop_fn_start_end !== undefined || !self.is_assign_desugar;

  if (can_suggest_binding) {
    const prefix = self.is_assign_desugar ? "let " : "";
    diag.span_suggestion_verbose(
      self.suggestion,
      msg("consider binding to an unused variable to avoid immediately dropping the value"),
      `${prefix}_unused`,
      "MachineApplicable",
    );
  } else {
    diag.span_help(self.suggestion, msg("consider binding to an unused variable to avoid immediately dropping the value"));
  }
  if (self.drop_fn_start_end !== undefined) {
    const drop_fn_start_end = self.drop_fn_start_end;
    diag.multipart_suggestion(
      msg("consider immediately dropping the value"),
      [
        [drop_fn_start_end[0], "drop("],
        [drop_fn_start_end[1], ")"],
      ],
      "MachineApplicable",
    );
  } else {
    diag.help(
      msg(
        "consider immediately dropping the value using `drop(..)` after the `let` statement",
      ),
    );
  }
}
export function NonBindingLetSub_subdiagnostic(self: NonBindingLetSub): Subdiagnostic {
  return { add_to_diag: (diag) => NonBindingLetSub_add_to_diag(self, diag) };
}

/** `impl<'a> Diagnostic<'a> for NonFmtPanicUnused` (used because of two suggestions based on one Option<Span>) */
// rustc: compiler/rustc_lint/src/diagnostics.rs:1647 into_diag
export function NonFmtPanicUnused_into_diag(self: NonFmtPanicUnused, dcx: DiagCtxtHandle, level: Level): Diag {
  const diag = Diag.new(
    dcx,
    level,
    msg(
      "panic message contains {$count ->\n                [one] an unused\n                *[other] unused\n            } formatting {$count ->\n                [one] placeholder\n                *[other] placeholders\n            }",
    ),
  )
    .with_arg("count", IntoDiagArg.of(self.count, number_into_diag_arg))
    .with_note(msg("this message is not used as a format string when given without arguments, but will be in Rust 2021"));
  if (self.suggestion !== undefined) {
    const span = self.suggestion;
    diag.span_suggestion_verbose(
      Span.shrink_to_hi(span),
      msg("add the missing {$count ->\n                        [one] argument\n                        *[other] arguments\n                    }"),
      ", ...",
      "HasPlaceholders",
    );
    diag.span_suggestion_verbose(
      Span.shrink_to_lo(span),
      msg('or add a "{"{"}{"}"}" format string to use the message literally'),
      '"{}", ',
      "MachineApplicable",
    );
  }
  return diag;
}
export function NonFmtPanicUnused_diagnostic(self: NonFmtPanicUnused): Diagnostic {
  return { into_diag: (dcx, level) => NonFmtPanicUnused_into_diag(self, dcx, level) };
}

/** `impl Subdiagnostic for NonSnakeCaseDiagSub` */
// rustc: compiler/rustc_lint/src/diagnostics.rs:1747 add_to_diag
export function NonSnakeCaseDiagSub_add_to_diag(self: NonSnakeCaseDiagSub, diag: Diag): void {
  switch (self.$) {
    case "Label": {
      diag.span_label(self.span, msg("should have a snake_case name"));
      break;
    }
    case "Help": {
      diag.arg("sc", IntoDiagArg.of(self.sc, String_into_diag_arg));
      diag.help(msg("convert the identifier to snake case: `{$sc}`"));
      break;
    }
    case "ConvertSuggestion": {
      diag.span_suggestion(self.span, msg("convert the identifier to snake case"), self.suggestion, "MaybeIncorrect");
      break;
    }
    case "RenameOrConvertSuggestion": {
      diag.span_suggestion(
        self.span,
        msg("rename the identifier or convert it to a snake case raw identifier"),
        display_Ident(self.suggestion),
        "MaybeIncorrect",
      );
      break;
    }
    case "SuggestionAndNote": {
      diag.arg("sc", IntoDiagArg.of(self.sc, String_into_diag_arg));
      diag.note(msg("`{$sc}` cannot be used as a raw identifier"));
      diag.span_suggestion(self.span, msg("rename the identifier"), "", "MaybeIncorrect");
      break;
    }
  }
}
export function NonSnakeCaseDiagSub_subdiagnostic(self: NonSnakeCaseDiagSub): Subdiagnostic {
  return { add_to_diag: (diag) => NonSnakeCaseDiagSub_add_to_diag(self, diag) };
}

/** `impl<'a> Diagnostic<'a> for NonLocalDefinitionsDiag` */
// rustc: compiler/rustc_lint/src/diagnostics.rs:1884 into_diag
export function NonLocalDefinitionsDiag_into_diag(self: NonLocalDefinitionsDiag, dcx: DiagCtxtHandle, level: Level): Diag {
  const diag = Diag.new(dcx, level, "");
  switch (self.$) {
    case "Impl": {
      const { depth, body_kind_descr, body_name, cargo_update, const_anon, doctest, macro_to_change } = self;
      diag.primary_message(
        msg("non-local `impl` definition, `impl` blocks should be written at the same level as their item"),
      );
      diag.arg("depth", IntoDiagArg.of(depth, number_into_diag_arg));
      diag.arg("body_kind_descr", IntoDiagArg.of(body_kind_descr, str_into_diag_arg));
      diag.arg("body_name", IntoDiagArg.of(body_name, String_into_diag_arg));

      if (macro_to_change !== undefined) {
        const [macro_to_change_, macro_kind] = macro_to_change;
        diag.arg("macro_to_change", IntoDiagArg.of(macro_to_change_, String_into_diag_arg));
        diag.arg("macro_kind", IntoDiagArg.of(macro_kind, str_into_diag_arg));
        diag.note(msg("the {$macro_kind} `{$macro_to_change}` defines the non-local `impl`, and may need to be changed"));
      }
      if (cargo_update !== undefined) {
        diag.subdiagnostic(NonLocalDefinitionsCargoUpdateNote_subdiagnostic(cargo_update));
      }

      diag.note(
        msg(
          "an `impl` is never scoped, even when it is nested inside an item, as it may impact type checking outside of that item, which can be the case if neither the trait or the self type are at the same nesting level as the `impl`",
        ),
      );

      if (doctest) {
        diag.help(msg('make this doc-test a standalone test with its own `fn main() {"{"} ... {"}"}`'));
      }

      if (const_anon !== undefined) {
        diag.note(
          msg(
            'items in an anonymous const item (`const _: () = {"{"} ... {"}"}`) are treated as in the same scope as the anonymous const\'s declaration for the purpose of this lint',
          ),
        );
        if (const_anon._0 !== undefined) {
          diag.span_suggestion_verbose(const_anon._0, msg("use a const-anon item to suppress this lint"), "_", "MachineApplicable");
        }
      }
      break;
    }
    case "MacroRules": {
      const { depth, body_kind_descr, body_name, doctest, cargo_update } = self;
      diag.primary_message(
        msg("non-local `macro_rules!` definition, `#[macro_export]` macro should be written at top level module"),
      );
      diag.arg("depth", IntoDiagArg.of(depth, number_into_diag_arg));
      diag.arg("body_kind_descr", IntoDiagArg.of(body_kind_descr, str_into_diag_arg));
      diag.arg("body_name", IntoDiagArg.of(body_name, String_into_diag_arg));

      if (doctest) {
        diag.help(msg('remove the `#[macro_export]` or make this doc-test a standalone test with its own `fn main() {"{"} ... {"}"}`'));
      } else {
        diag.help(
          msg(
            "remove the `#[macro_export]` or move this `macro_rules!` outside the of the current {$body_kind_descr} {$depth ->\n                            [one] `{$body_name}`\n                            *[other] `{$body_name}` and up {$depth} bodies\n                        }",
          ),
        );
      }

      diag.note(msg("a `macro_rules!` definition is non-local if it is nested inside an item and has a `#[macro_export]` attribute"));

      if (cargo_update !== undefined) {
        diag.subdiagnostic(NonLocalDefinitionsCargoUpdateNote_subdiagnostic(cargo_update));
      }
      break;
    }
  }
  return diag;
}
export function NonLocalDefinitionsDiag_diagnostic(self: NonLocalDefinitionsDiag): Diagnostic {
  return { into_diag: (dcx, level) => NonLocalDefinitionsDiag_into_diag(self, dcx, level) };
}

/** `impl<'a> Diagnostic<'a> for DropTraitConstraintsDiag<'_>` (needed for def_path_str) */
// rustc: compiler/rustc_lint/src/diagnostics.rs:2054 into_diag
export function DropTraitConstraintsDiag_into_diag(self: DropTraitConstraintsDiag, dcx: DiagCtxtHandle, level: Level): Diag {
  return Diag.new(
    dcx,
    level,
    msg(
      "bounds on `{$clause}` are most likely incorrect, consider instead using `{$needs_drop}` to detect whether a type can be trivially dropped",
    ),
  )
    .with_arg("clause", IntoDiagArg.of(self.clause, Clause_into_diag_arg))
    .with_arg("needs_drop", IntoDiagArg.of(self.tcx.def_path_str(self.def_id), String_into_diag_arg));
}
export function DropTraitConstraintsDiag_diagnostic(self: DropTraitConstraintsDiag): Diagnostic {
  return { into_diag: (dcx, level) => DropTraitConstraintsDiag_into_diag(self, dcx, level) };
}

/** `impl<'a> Diagnostic<'a> for DropGlue<'_>` (needed for def_path_str) */
// rustc: compiler/rustc_lint/src/diagnostics.rs:2068 into_diag
export function DropGlue_into_diag(self: DropGlue, dcx: DiagCtxtHandle, level: Level): Diag {
  return Diag.new(
    dcx,
    level,
    msg(
      "types that do not implement `Drop` can still have drop glue, consider instead using `{$needs_drop}` to detect whether a type is trivially dropped",
    ),
  ).with_arg("needs_drop", IntoDiagArg.of(self.tcx.def_path_str(self.def_id), String_into_diag_arg));
}
export function DropGlue_diagnostic(self: DropGlue): Diagnostic {
  return { into_diag: (dcx, level) => DropGlue_into_diag(self, dcx, level) };
}

/** `impl<'a> Diagnostic<'a> for ImproperCTypes<'_>` */
// rustc: compiler/rustc_lint/src/diagnostics.rs:2539 into_diag
export function ImproperCTypes_into_diag(self: ImproperCTypes, dcx: DiagCtxtHandle, level: Level): Diag {
  const diag = Diag.new(dcx, level, msg("`extern` {$desc} uses type `{$ty}`, which is not FFI-safe"))
    .with_arg("ty", IntoDiagArg.of(self.ty, Ty_into_diag_arg))
    .with_arg("desc", IntoDiagArg.of(self.desc, str_into_diag_arg))
    .with_span_label(self.label, msg("not FFI-safe"));
  const help = self.help;
  if (help !== undefined) {
    diag.help(help);
  }
  diag.note(self.note);
  const note = self.span_note;
  if (note !== undefined) {
    diag.span_note(note, msg("the type is defined here"));
  }
  return diag;
}
export function ImproperCTypes_diagnostic(self: ImproperCTypes): Diagnostic {
  return { into_diag: (dcx, level) => ImproperCTypes_into_diag(self, dcx, level) };
}

/** `impl<'a> Diagnostic<'a> for UnusedDef<'_, '_>` (needed because of def_path_str) */
// rustc: compiler/rustc_lint/src/diagnostics.rs:2737 into_diag
export function UnusedDef_into_diag(self: UnusedDef, dcx: DiagCtxtHandle, level: Level): Diag {
  const diag = Diag.new(dcx, level, msg("unused {$pre}`{$def}`{$post} that must be used"))
    .with_arg("pre", IntoDiagArg.of(self.pre, str_into_diag_arg))
    .with_arg("post", IntoDiagArg.of(self.post, str_into_diag_arg))
    .with_arg("def", IntoDiagArg.of(self.cx.tcx.def_path_str(self.def_id), String_into_diag_arg));
  // check for #[must_use = "..."]
  if (self.note !== undefined) {
    diag.note(Symbol.as_str(self.note));
  }
  if (self.suggestion !== undefined) {
    diag.subdiagnostic(UnusedDefSuggestion_subdiagnostic(self.suggestion));
  }
  return diag;
}
export function UnusedDef_diagnostic(self: UnusedDef): Diagnostic {
  return { into_diag: (dcx, level) => UnusedDef_into_diag(self, dcx, level) };
}

/** `impl<'a> Diagnostic<'a> for AsyncFnInTraitDiag` */
// rustc: compiler/rustc_lint/src/diagnostics.rs:2824 into_diag
export function AsyncFnInTraitDiag_into_diag(self: AsyncFnInTraitDiag, dcx: DiagCtxtHandle, level: Level): Diag {
  const diag = Diag.new(dcx, level, "use of `async fn` in public traits is discouraged as auto trait bounds cannot be specified");
  diag.note(
    "you can suppress this lint if you plan to use the trait only in your own code, or do not care about auto traits like `Send` on the `Future`",
  );
  if (self.sugg !== undefined) {
    diag.multipart_suggestion(
      "you can alternatively desugar to a normal `fn` that returns `impl Future` and add any desired bounds such as `Send`, but these cannot be relaxed without a breaking API change",
      self.sugg,
      "MaybeIncorrect",
    );
  }
  return diag;
}
export function AsyncFnInTraitDiag_diagnostic(self: AsyncFnInTraitDiag): Diagnostic {
  return { into_diag: (dcx, level) => AsyncFnInTraitDiag_into_diag(self, dcx, level) };
}

/** `impl<'a> Diagnostic<'a> for MismatchedLifetimeSyntaxes` */
// rustc: compiler/rustc_lint/src/diagnostics.rs:2970 into_diag
export function MismatchedLifetimeSyntaxes_into_diag(self: MismatchedLifetimeSyntaxes, dcx: DiagCtxtHandle, level: Level): Diag {
  const counts = LifetimeSyntaxCategories.add(LifetimeSyntaxCategories.len(self.inputs), LifetimeSyntaxCategories.len(self.outputs));
  let message;
  if (counts.hidden === 0 && counts.elided === 0 && counts.named === 0) {
    return panic("No lifetime mismatch detected");
  } else if (counts.named === 0) {
    message = msg("hiding a lifetime that's elided elsewhere is confusing");
  } else if (counts.elided === 0) {
    message = msg("hiding a lifetime that's named elsewhere is confusing");
  } else if (counts.hidden === 0) {
    message = msg("eliding a lifetime that's named elsewhere is confusing");
  } else {
    message = msg("hiding or eliding a lifetime that's named elsewhere is confusing");
  }
  const diag = Diag.new(dcx, level, message);

  for (const s of self.inputs.hidden) {
    diag.span_label(s, msg("the lifetime is hidden here"));
  }
  for (const s of self.inputs.elided) {
    diag.span_label(s, msg("the lifetime is elided here"));
  }
  for (const s of self.inputs.named) {
    diag.span_label(s, msg("the lifetime is named here"));
  }

  // PORT: `FxIndexMap<Span, usize>` is an insertion-ordered `Map` (PORTING.md section 5).
  const hidden_output_counts = new Map<Span, number>();
  for (const s of self.outputs.hidden) {
    hidden_output_counts.set(s, (hidden_output_counts.get(s) ?? 0) + 1);
  }
  for (const [span, count] of hidden_output_counts) {
    const label = DiagMessage_arg(
      msg(
        "the same {$count ->\n                    [one] lifetime\n                    *[other] lifetimes\n                } {$count ->\n                    [one] is\n                    *[other] are\n                } hidden here",
      ),
      "count",
      IntoDiagArg.of(count, number_into_diag_arg),
    ).format();
    diag.span_label(span, label);
  }
  for (const s of self.outputs.elided) {
    diag.span_label(s, msg("the same lifetime is elided here"));
  }
  for (const s of self.outputs.named) {
    diag.span_label(s, msg("the same lifetime is named here"));
  }

  diag.help(msg("the same lifetime is referred to in inconsistent ways, making the signature confusing"));

  // `let mut suggestions = self.suggestions.into_iter(); if let Some(s) = suggestions.next() { .. }`
  if (self.suggestions.length > 0) {
    const s = self.suggestions[0]!;
    diag.subdiagnostic(MismatchedLifetimeSyntaxesSuggestion_subdiagnostic(s));

    for (const s of self.suggestions.slice(1)) {
      MismatchedLifetimeSyntaxesSuggestion.make_optional_alternative(s);
      diag.subdiagnostic(MismatchedLifetimeSyntaxesSuggestion_subdiagnostic(s));
    }
  }
  return diag;
}
export function MismatchedLifetimeSyntaxes_diagnostic(self: MismatchedLifetimeSyntaxes): Diagnostic {
  return { into_diag: (dcx, level) => MismatchedLifetimeSyntaxes_into_diag(self, dcx, level) };
}

export type MismatchedLifetimeSyntaxesSuggestion = MismatchedLifetimeSyntaxesSuggestion_;
export const MismatchedLifetimeSyntaxesSuggestion = {
  // rustc: compiler/rustc_lint/src/diagnostics.rs:3068 make_optional_alternative
  make_optional_alternative(self: { optional_alternative: boolean }): void {
    // Implicit { optional_alternative, .. } | Mixed { optional_alternative, .. } | Explicit { optional_alternative, .. }
    self.optional_alternative = true;
  },
};

/** `impl Subdiagnostic for MismatchedLifetimeSyntaxesSuggestion` */
// rustc: compiler/rustc_lint/src/diagnostics.rs:3082 add_to_diag
export function MismatchedLifetimeSyntaxesSuggestion_add_to_diag(self: MismatchedLifetimeSyntaxesSuggestion, diag: Diag): void {
  const style = (optional_alternative: boolean): SuggestionStyle => (optional_alternative ? "CompletelyHidden" : "ShowAlways");

  const applicability = (optional_alternative: boolean): Applicability =>
    // `cargo fix` can't handle more than one fix for the same issue,
    // so hide alternative suggestions from it by marking them as maybe-incorrect
    optional_alternative ? "MaybeIncorrect" : "MachineApplicable";

  switch (self.$) {
    case "Implicit": {
      const { suggestions: suggestions_, optional_alternative } = self;
      const suggestions: [Span, string][] = suggestions_.map((s) => [s, ""]);
      diag.multipart_suggestion_with_style(
        msg("remove the lifetime name from references"),
        suggestions,
        applicability(optional_alternative),
        style(optional_alternative),
      );
      break;
    }

    case "Mixed": {
      const { implicit_suggestions: implicit_suggestions_, explicit_anonymous_suggestions, optional_alternative } = self;
      const message =
        implicit_suggestions_.length === 0
          ? msg("use `'_` for type paths")
          : msg("remove the lifetime name from references and use `'_` for type paths");

      const implicit_suggestions: [Span, string][] = implicit_suggestions_.map((s) => [s, ""]);

      const suggestions: [Span, string][] = [...implicit_suggestions, ...explicit_anonymous_suggestions];

      diag.multipart_suggestion_with_style(message, suggestions, applicability(optional_alternative), style(optional_alternative));
      break;
    }

    case "Explicit": {
      const { lifetime_name, suggestions, optional_alternative } = self;
      const msg_ = DiagMessage_arg(msg("consistently use `{$lifetime_name}`"), "lifetime_name", IntoDiagArg.of(lifetime_name, String_into_diag_arg)).format();
      diag.multipart_suggestion_with_style(msg_, suggestions, applicability(optional_alternative), style(optional_alternative));
      break;
    }
  }
}
export function MismatchedLifetimeSyntaxesSuggestion_subdiagnostic(self: MismatchedLifetimeSyntaxesSuggestion): Subdiagnostic {
  return { add_to_diag: (diag) => MismatchedLifetimeSyntaxesSuggestion_add_to_diag(self, diag) };
}

