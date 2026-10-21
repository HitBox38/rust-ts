// Port of compiler/rustc_trait_selection/src/diagnostics.rs (lane errrep-infer-b; contract of lane errctxt-contract).
//
// The types and every `#[derive(Diagnostic)]` / `#[derive(Subdiagnostic)]` / `#[derive(LintDiagnostic)]` impl
// (`<T>_into_diag` + `<T>_diagnostic`, `<T>_add_to_diag` + `<T>_subdiagnostic`) are generated into diagnostics.gen.ts by
// tools/codegen/types.ts (set `rustc_trait_selection_error_reporting`). This module holds the hand-written impls of the file
// (decls.ts, comment-only section, `diagnostics.rs:<line>`) under the names the generated file imports (precedent:
// rustc_hir_typeck diagnostics.ts).
// - `impl SourceKindSubdiag { fn new_fully_qualified, fn new_closure_return }` and `impl ActualImplExplNotes { fn
//   new_expected }` are the companions `SourceKindSubdiag` / `ActualImplExplNotes` (PORTING §8).
// - The free fn `impl_trait_overcapture_suggestion` has the signature of decls.ts `Fns_diagnostics`.
// - `hir_Ty` is rustc_hir's `Ty` under the name the generated file imports (tools/codegen/error_reporting.typemap.json).
// Init order: top-level code here may touch only the crate decls.ts, this file's .gen.ts and other crates.
export * from "./diagnostics.gen.ts";
export type { Ty as hir_Ty } from "../rustc_hir/lib.ts";
import { bool_into_diag_arg, number_into_diag_arg, Symbol_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import { type DiagArgValue, IntoDiagArg, MultiSpan } from "../rustc_error_messages/lib.ts";
import { DiagMessage_arg } from "../rustc_errors/formatting.ts";
import { type Applicability, Diag, type DiagCtxtHandle, type DiagMessage, type Diagnostic, E0751, type Level, msg, type Subdiagnostic } from "../rustc_errors/lib.ts";
import * as hir from "../rustc_hir/lib.ts";
import { type HirId, HirId_eq } from "../rustc_hir_id/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Generics } from "../rustc_middle/ty/generics.ts";
import { GenericParamDefKind } from "../rustc_middle/ty/generics.ts";
import { display_Ty, display_TraitRefPrintOnlyTraitPath, TraitRef_print_only_trait_path, type TraitRefPrintOnlyTraitPath } from "../rustc_middle/ty/print/pretty.ts";
import type { DefIdSet, LocalDefId } from "../rustc_span/def_id.ts";
import { type BytePos, type PathBuf, Span } from "../rustc_span/lib.ts";
import { display_Ident, kw, sym, Symbol } from "../rustc_span/symbol.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { is_whitespace } from "../std/char.ts";

import type * as gen from "./diagnostics.gen.ts";
import type {
  ActualImplExpectedKind,
  ActualImplExpectedLifetimeKind,
  AddLifetimeParamsSuggestion,
  AddPreciseCapturingAndParams,
  AddPreciseCapturingForOvercapture,
  AdjustSignatureBorrow,
  ConsiderBorrowingParamHelp,
  IntroducesStaticBecauseUnmetLifetimeReq,
  LifetimeMismatchLabels,
  NegativePositiveConflict,
  RegionOriginNote,
  SuggestTuplePatternMany,
  TyOrSig,
} from "./diagnostics.gen.ts";
import type { ObligationCauseAsDiagArg } from "./error_reporting/infer/mod.gen.ts";
import { type Highlighted, Highlighted_into_diag_arg } from "./error_reporting/infer/nice_region_error/placeholder_error.ts";
import { unported, unwrap } from "../std/panic.ts";

/** `impl Diagnostic<'_> for NegativePositiveConflict<'_>` */
// rustc: compiler/rustc_trait_selection/src/diagnostics.rs:41 into_diag
export function NegativePositiveConflict_into_diag(self: NegativePositiveConflict, dcx: DiagCtxtHandle, level: Level): Diag {
  const diag = Diag.new(
    dcx,
    level,
    msg(
      "found both positive and negative implementation of trait `{$trait_desc}`{$self_desc ->\n                [none] {\"\"}\n                *[default] {\" \"}for type `{$self_desc}`\n            }:",
    ),
  );
  diag.arg("trait_desc", IntoDiagArg.String(display_TraitRefPrintOnlyTraitPath(TraitRef_print_only_trait_path(self.trait_desc))));
  diag.arg("self_desc", IntoDiagArg.String(self.self_ty === undefined ? "none" : display_Ty(self.self_ty)));
  diag.span(self.impl_span);
  diag.code(E0751);
  switch (self.negative_impl_span.$) {
    case "Ok": {
      const span = self.negative_impl_span._0;
      diag.span_label(span, msg("negative implementation here"));
      break;
    }
    case "Err": {
      const cname = self.negative_impl_span._0;
      diag.note(msg("negative implementation in crate `{$negative_impl_cname}`"));
      diag.arg("negative_impl_cname", IntoDiagArg.String(Symbol.as_str(cname)));
      break;
    }
  }
  switch (self.positive_impl_span.$) {
    case "Ok": {
      const span = self.positive_impl_span._0;
      diag.span_label(span, msg("positive implementation here"));
      break;
    }
    case "Err": {
      const cname = self.positive_impl_span._0;
      diag.note(msg("positive implementation in crate `{$positive_impl_cname}`"));
      diag.arg("positive_impl_cname", IntoDiagArg.String(Symbol.as_str(cname)));
      break;
    }
  }
  return diag;
}
/** `NegativePositiveConflict` as a `Diagnostic` trait object. */
export function NegativePositiveConflict_diagnostic(self: NegativePositiveConflict): Diagnostic {
  return { into_diag: (dcx, level) => NegativePositiveConflict_into_diag(self, dcx, level) };
}

/** `impl Subdiagnostic for AdjustSignatureBorrow` */
// rustc: compiler/rustc_trait_selection/src/diagnostics.rs:92 add_to_diag
export function AdjustSignatureBorrow_add_to_diag(self: AdjustSignatureBorrow, diag: Diag): void {
  switch (self.$) {
    case "Borrow": {
      const to_borrow = self.to_borrow;
      diag.arg("borrow_len", IntoDiagArg.of(to_borrow.length, number_into_diag_arg));
      diag.multipart_suggestion(
        msg(
          "consider adjusting the signature so it borrows its {$borrow_len ->\n                            [one] argument\n                            *[other] arguments\n                        }",
        ),
        to_borrow,
        "MaybeIncorrect",
      );
      break;
    }
    case "RemoveBorrow": {
      const remove_borrow = self.remove_borrow;
      diag.arg("remove_borrow_len", IntoDiagArg.of(remove_borrow.length, number_into_diag_arg));
      diag.multipart_suggestion(
        msg(
          "consider adjusting the signature so it does not borrow its {$remove_borrow_len ->\n                            [one] argument\n                            *[other] arguments\n                        }",
        ),
        remove_borrow,
        "MaybeIncorrect",
      );
      break;
    }
  }
}
/** `AdjustSignatureBorrow` as a `Subdiagnostic` trait object. */
export function AdjustSignatureBorrow_subdiagnostic(self: AdjustSignatureBorrow): Subdiagnostic {
  return { add_to_diag: (diag) => AdjustSignatureBorrow_add_to_diag(self, diag) };
}

export type SourceKindSubdiag = gen.SourceKindSubdiag;
/** `impl<'a> SourceKindSubdiag<'a>` (PORTING §8: on the companion). */
export const SourceKindSubdiag = {
  // rustc: compiler/rustc_trait_selection/src/diagnostics.rs:345 new_fully_qualified
  new_fully_qualified(span: Span, def_path: string, adjustment: string, successor: [string, BytePos]): SourceKindSubdiag {
    return {
      $: "FullyQualified",
      span_lo: Span.shrink_to_lo(span),
      span_hi: Span.with_hi(Span.shrink_to_hi(span), successor[1]),
      def_path,
      adjustment,
      successor_pos: successor[0],
    };
  },

  // rustc: compiler/rustc_trait_selection/src/diagnostics.rs:360 new_closure_return
  new_closure_return(ty_info: string, data: hir.FnRetTy, should_wrap_expr: Span | undefined): SourceKindSubdiag {
    let arrow: string;
    switch (data.$) {
      case "DefaultReturn":
        arrow = " -> ";
        break;
      default:
        arrow = "";
    }
    let start_span: Span, start_span_code: string, end_span: Span | undefined;
    if (should_wrap_expr !== undefined) {
      const end_span_ = should_wrap_expr;
      [start_span, start_span_code, end_span] = [hir.FnRetTy.span(data), `${arrow}${ty_info} {`, end_span_];
    } else {
      [start_span, start_span_code, end_span] = [hir.FnRetTy.span(data), `${arrow}${ty_info}`, undefined];
    }
    return { $: "ClosureReturn", start_span, start_span_code, end_span };
  },
};

/** `impl IntoDiagArg for ObligationCauseAsDiagArg<'_>` (error_reporting/infer/mod.rs:2692, lane errrep-infer-a), read
 * lazily from error_reporting/infer/mod.ts (same-crate module; init order). */
function ObligationCauseAsDiagArg_into_diag_arg(self: ObligationCauseAsDiagArg, path: MutRef<PathBuf | undefined>): DiagArgValue {
  return (require("./error_reporting/infer/mod.ts") as typeof import("./error_reporting/infer/mod.ts")).ObligationCauseAsDiagArg_into_diag_arg(self, path);
}

/** `impl Subdiagnostic for RegionOriginNote<'_>` */
// rustc: compiler/rustc_trait_selection/src/diagnostics.rs:440 add_to_diag
export function RegionOriginNote_add_to_diag(self: RegionOriginNote, diag: Diag): void {
  const label_or_note = (diag: Diag, span: Span, msg: DiagMessage): void => {
    const sub_count = diag.deref().children.filter((d) => d.span.is_dummy()).length;
    const expanded_sub_count = diag.deref().children.filter((d) => !d.span.is_dummy()).length;
    const span_is_primary = diag.deref().span.primary_spans_().every((sp) => sp === span);
    if (span_is_primary && sub_count === 0 && expanded_sub_count === 0) {
      diag.span_label(span, msg);
    } else if (span_is_primary && expanded_sub_count === 0) {
      diag.note(msg);
    } else {
      diag.span_note(span, msg);
    }
  };
  switch (self.$) {
    case "Plain": {
      const { span, msg } = self;
      label_or_note(diag, span, msg);
      break;
    }
    case "WithName": {
      const { span, msg, name, continues } = self;
      label_or_note(
        diag,
        span,
        DiagMessage_arg(msg, "name", IntoDiagArg.String(name)).arg("continues", IntoDiagArg.of(continues, bool_into_diag_arg)).format(),
      );
      break;
    }
    case "WithRequirement": {
      if (self.expected_found !== undefined) {
        const { span, requirement } = self;
        const [expected, found] = self.expected_found;
        const msg_ = DiagMessage_arg(
          msg(
            "...so that the {$requirement ->\n                        [method_compat] method type is compatible with trait\n                        [type_compat] associated type is compatible with trait\n                        [const_compat] const is compatible with trait\n                        [expr_assignable] expression is assignable\n                        [if_else_different] `if` and `else` have incompatible types\n                        [no_else] `if` missing an `else` returns `()`\n                        [fn_main_correct_type] `main` function has the correct type\n                        [fn_lang_correct_type] lang item function has the correct type\n                        [intrinsic_correct_type] intrinsic has the correct type\n                        [method_correct_type] method receiver has the correct type\n                        *[other] types are compatible\n                    }",
          ),
          "requirement",
          IntoDiagArg.of(requirement, ObligationCauseAsDiagArg_into_diag_arg),
        ).format();
        label_or_note(diag, span, msg_);

        diag.note_expected_found("", expected, "", found);
      } else {
        const { span, requirement } = self;
        // FIXME: this really should be handled at some earlier stage. Our
        // handling of region checking when type errors are present is
        // *terrible*.
        const msg_ = DiagMessage_arg(
          msg(
            "...so that {$requirement ->\n                            [method_compat] method type is compatible with trait\n                            [type_compat] associated type is compatible with trait\n                            [const_compat] const is compatible with trait\n                            [expr_assignable] expression is assignable\n                            [if_else_different] `if` and `else` have incompatible types\n                            [no_else] `if` missing an `else` returns `()`\n                            [fn_main_correct_type] `main` function has the correct type\n                            [fn_lang_correct_type] lang item function has the correct type\n                            [intrinsic_correct_type] intrinsic has the correct type\n                            [method_correct_type] method receiver has the correct type\n                            *[other] types are compatible\n                        }",
          ),
          "requirement",
          IntoDiagArg.of(requirement, ObligationCauseAsDiagArg_into_diag_arg),
        ).format();
        label_or_note(diag, span, msg_);
      }
      break;
    }
  }
}
/** `RegionOriginNote` as a `Subdiagnostic` trait object. */
export function RegionOriginNote_subdiagnostic(self: RegionOriginNote): Subdiagnostic {
  return { add_to_diag: (diag) => RegionOriginNote_add_to_diag(self, diag) };
}

/** `impl Subdiagnostic for LifetimeMismatchLabels` */
// rustc: compiler/rustc_trait_selection/src/diagnostics.rs:535 add_to_diag
export function LifetimeMismatchLabels_add_to_diag(self: LifetimeMismatchLabels, diag: Diag): void {
  switch (self.$) {
    case "InRet": {
      const { param_span, ret_span, span, label_var1 } = self;
      diag.span_label(param_span, msg("this parameter and the return type are declared with different lifetimes..."));
      diag.span_label(ret_span, msg('{""}'));
      diag.span_label(
        span,
        msg(
          "...but data{$label_var1_exists ->\n                            [true] {\" \"}from `{$label_var1}`\n                            *[false] {\"\"}\n                        } is returned here",
        ),
      );
      diag.arg("label_var1_exists", IntoDiagArg.of(label_var1 !== undefined, bool_into_diag_arg));
      diag.arg("label_var1", IntoDiagArg.String(label_var1 === undefined ? "" : display_Ident(label_var1)));
      break;
    }
    case "Normal": {
      const { hir_equal, ty_sup, ty_sub, span, sup: label_var1, sub: label_var2 } = self;
      if (hir_equal) {
        diag.span_label(ty_sup, msg("this type is declared with multiple lifetimes..."));
        diag.span_label(ty_sub, msg('{""}'));
        diag.span_label(span, msg("...but data with one lifetime flows into the other here"));
      } else {
        diag.span_label(ty_sup, msg("these two types are declared with different lifetimes..."));
        diag.span_label(ty_sub, msg('{""}'));
        diag.span_label(
          span,
          msg(
            "...but data{$label_var1_exists ->\n                                [true] {\" \"}from `{$label_var1}`\n                                *[false] {\"\"}\n                            } flows{$label_var2_exists ->\n                                [true] {\" \"}into `{$label_var2}`\n                                *[false] {\"\"}\n                            } here",
          ),
        );
        diag.arg("label_var1_exists", IntoDiagArg.of(label_var1 !== undefined, bool_into_diag_arg));
        diag.arg("label_var1", IntoDiagArg.String(label_var1 === undefined ? "" : display_Ident(label_var1)));
        diag.arg("label_var2_exists", IntoDiagArg.of(label_var2 !== undefined, bool_into_diag_arg));
        diag.arg("label_var2", IntoDiagArg.String(label_var2 === undefined ? "" : display_Ident(label_var2)));
      }
      break;
    }
  }
}
/** `LifetimeMismatchLabels` as a `Subdiagnostic` trait object. */
export function LifetimeMismatchLabels_subdiagnostic(self: LifetimeMismatchLabels): Subdiagnostic {
  return { add_to_diag: (diag) => LifetimeMismatchLabels_add_to_diag(self, diag) };
}

/** `impl Subdiagnostic for AddLifetimeParamsSuggestion<'_>` */
// rustc: compiler/rustc_trait_selection/src/diagnostics.rs:608 add_to_diag
export function AddLifetimeParamsSuggestion_add_to_diag(self: AddLifetimeParamsSuggestion, diag: Diag): void {
  const mk_suggestion = (): boolean => {
    const anon_reg = self.tcx.is_suitable_region(self.generic_param_scope, self.sub);
    if (anon_reg === undefined) {
      return false;
    }

    const node = self.tcx.hir_node_by_def_id(anon_reg.scope);
    const is_impl = node.$ === "ImplItem";
    let generics: hir.Generics, parent_generics: hir.Generics | undefined;
    if (
      (node.$ === "Item" && node._0.kind.$ === "Fn") ||
      node.$ === "TraitItem" ||
      node.$ === "ImplItem"
    ) {
      generics = node.$ === "Item" ? (node._0.kind as Extract<hir.ItemKind, { $: "Fn" }>).generics : node._0.generics;
      const parent = self.tcx.parent_hir_node(self.tcx.local_def_id_to_hir_id(anon_reg.scope));
      if (parent.$ === "Item" && parent._0.kind.$ === "Trait") {
        parent_generics = parent._0.kind.generics;
      } else if (parent.$ === "Item" && parent._0.kind.$ === "Impl") {
        parent_generics = parent._0.kind._0.generics;
      } else {
        parent_generics = undefined;
      }
    } else {
      return false;
    }

    const suggestion_param_name_ = generics.params
      .filter((p) => p.kind.$ === "Lifetime")
      .map((p) => hir.ParamName.ident(p.name).name)
      .find((i) => i !== kw.UnderscoreLifetime);
    const introduce_new = suggestion_param_name_ === undefined;

    let default_ = "'a";
    if (parent_generics !== undefined) {
      const used: Set<string> = new Set(
        parent_generics.params
          .filter((p) => p.kind.$ === "Lifetime")
          .map((p) => hir.ParamName.ident(p.name).name)
          .filter((i) => i !== kw.UnderscoreLifetime)
          .map((l) => Symbol.as_str(l)),
      );
      let lt: string | undefined;
      for (let it = "a".charCodeAt(0); it <= "z".charCodeAt(0); it++) {
        const s = `'${String.fromCharCode(it)}`;
        if (!used.has(s)) {
          lt = s;
          break;
        }
      }
      if (lt !== undefined) {
        // We want a lifetime that *isn't* present in the `trait` or `impl` that assoc
        // `fn` belongs to. We could suggest reusing one of their lifetimes, but it is
        // likely to be an over-constraining lifetime requirement, so we always add a
        // lifetime to the `fn`.
        default_ = lt;
      }
    }
    const suggestion_param_name = suggestion_param_name_ !== undefined ? Symbol.as_str(suggestion_param_name_) : default_;

    class ImplicitLifetimeFinder extends hir.intravisit.Visitor {
      constructor(
        public suggestions: [Span, string][],
        public suggestion_param_name: string,
      ) {
        super();
      }

      // impl<'v> Visitor<'v> for ImplicitLifetimeFinder

      // rustc: compiler/rustc_trait_selection/src/diagnostics.rs:675 visit_ty
      override visit_ty(ty: hir.Ty<hir.AmbigArg>): undefined {
        const kind = ty.kind;
        if (kind.$ === "Path" && kind._0.$ === "Resolved") {
          const path = kind._0._1;
          for (const segment of path.segments) {
            if (segment.args !== undefined) {
              const args = segment.args;
              if (args.args.every((arg) => arg.$ === "Lifetime" && arg._0.is_implicit())) {
                this.suggestions.push([
                  Span.shrink_to_hi(segment.ident.span),
                  `<${args.args.map((_) => this.suggestion_param_name).join(", ")}>`,
                ]);
              } else {
                for (const arg of args.args) {
                  if (arg.$ === "Lifetime" && arg._0.is_anonymous()) {
                    const lifetime = arg._0;
                    this.suggestions.push(lifetime.suggestion(this.suggestion_param_name));
                  }
                }
              }
            }
          }
        } else if (kind.$ === "Ref" && kind._0.is_anonymous()) {
          const lifetime = kind._0;
          this.suggestions.push(lifetime.suggestion(this.suggestion_param_name));
        }
        hir.intravisit.walk_ty(this, ty);
        return undefined;
      }
    }
    const visitor = new ImplicitLifetimeFinder([], suggestion_param_name);
    const fn_decl = hir.Node.fn_decl(node);
    if (fn_decl !== undefined && fn_decl.output.$ === "Return") {
      const ty = fn_decl.output._0;
      visitor.visit_ty_unambig(ty);
    }
    if (visitor.suggestions.length === 0) {
      // Do not suggest constraining the `&self` param, but rather the return type.
      // If that is wrong (because it is not sufficient), a follow up error will tell the
      // user to fix it. This way we lower the chances of *over* constraining, but still
      // get the cake of "correctly" constrained in two steps.
      visitor.visit_ty_unambig(self.ty_sup);
    }
    visitor.visit_ty_unambig(self.ty_sub);
    if (visitor.suggestions.length === 0) {
      return false;
    }
    if (introduce_new) {
      const span = generics.span_for_lifetime_suggestion();
      const new_param_suggestion: [Span, string] =
        span !== undefined ? [span, `${suggestion_param_name}, `] : [generics.span, `<${suggestion_param_name}>`];

      visitor.suggestions.push(new_param_suggestion);
    }
    diag.multipart_suggestion(
      msg(
        "consider {$is_reuse ->\n                        [true] reusing\n                        *[false] introducing\n                    } a named lifetime parameter{$is_impl ->\n                        [true] {\" \"}and update trait if needed\n                        *[false] {\"\"}\n                    }",
      ),
      visitor.suggestions,
      "MaybeIncorrect",
    );
    diag.arg("is_impl", IntoDiagArg.of(is_impl, bool_into_diag_arg));
    diag.arg("is_reuse", IntoDiagArg.of(!introduce_new, bool_into_diag_arg));

    return true;
  };
  if (mk_suggestion() && self.add_note) {
    diag.note(msg("each elided lifetime in input position becomes a distinct lifetime"));
  }
}
/** `AddLifetimeParamsSuggestion` as a `Subdiagnostic` trait object. */
export function AddLifetimeParamsSuggestion_subdiagnostic(self: AddLifetimeParamsSuggestion): Subdiagnostic {
  return { add_to_diag: (diag) => AddLifetimeParamsSuggestion_add_to_diag(self, diag) };
}

/** `impl Subdiagnostic for IntroducesStaticBecauseUnmetLifetimeReq` */
// rustc: compiler/rustc_trait_selection/src/diagnostics.rs:792 add_to_diag
export function IntroducesStaticBecauseUnmetLifetimeReq_add_to_diag(self: IntroducesStaticBecauseUnmetLifetimeReq, diag: Diag): void {
  self.unmet_requirements.push_span_label(self.binding_span, msg("introduces a `'static` lifetime requirement"));
  diag.span_note(self.unmet_requirements, msg("because this has an unmet lifetime requirement"));
}
/** `IntroducesStaticBecauseUnmetLifetimeReq` as a `Subdiagnostic` trait object. */
export function IntroducesStaticBecauseUnmetLifetimeReq_subdiagnostic(self: IntroducesStaticBecauseUnmetLifetimeReq): Subdiagnostic {
  return { add_to_diag: (diag) => IntroducesStaticBecauseUnmetLifetimeReq_add_to_diag(self, diag) };
}

/** `impl IntoDiagArg for TyOrSig<'_>` */
// rustc: compiler/rustc_trait_selection/src/diagnostics.rs:905 into_diag_arg
export function TyOrSig_into_diag_arg(self: TyOrSig, path: MutRef<PathBuf | undefined>): DiagArgValue {
  switch (self.$) {
    case "Ty": {
      const ty = self._0;
      return Highlighted_into_diag_arg(ty, path);
    }
    case "ClosureSig": {
      const sig = self._0;
      return Highlighted_into_diag_arg(sig, path);
    }
  }
}

export type ActualImplExplNotes = gen.ActualImplExplNotes;
/** `impl<'tcx> ActualImplExplNotes<'tcx>` (PORTING §8: on the companion). */
export const ActualImplExplNotes = {
  // rustc: compiler/rustc_trait_selection/src/diagnostics.rs:1088 new_expected
  new_expected(
    kind: ActualImplExpectedKind,
    lt_kind: ActualImplExpectedLifetimeKind,
    ty_or_sig: TyOrSig,
    trait_path: Highlighted<TraitRefPrintOnlyTraitPath>,
    lifetime_1: number,
    lifetime_2: number,
    satisfy_span: Span | undefined,
    item_span: Span | undefined,
    outer_span: Span | undefined,
    item_name: string,
  ): ActualImplExplNotes {
    const label = `required by this bound in \`${item_name}\``;
    let span: MultiSpan;
    if (satisfy_span !== undefined && item_span !== undefined) {
      const span_ = MultiSpan.from_Span(satisfy_span);
      span_.push_span_label(satisfy_span, label);
      span_.push_span_context(item_span);
      span = span_;
    } else if (satisfy_span === undefined && item_span !== undefined) {
      const span_ = MultiSpan.from_Span(item_span);
      const item_label = `required due to a bound in \`${item_name}\``;
      span_.push_span_label(item_span, item_label);
      span = span_;
    } else if (satisfy_span !== undefined && item_span === undefined) {
      const span_ = MultiSpan.from_Span(satisfy_span);
      span_.push_span_label(satisfy_span, label);
      span = span_;
    } else {
      span = MultiSpan.from_Vec([]);
    }
    if (outer_span !== undefined) {
      const outer = outer_span;
      span.push_span_context(outer);
    }
    switch (kind) {
      case "Signature":
        switch (lt_kind) {
          case "Two":
            return { $: "ExpectedSignatureTwo", span, ty_or_sig, trait_path, lifetime_1, lifetime_2 };
          case "Any":
            return { $: "ExpectedSignatureAny", span, ty_or_sig, trait_path, lifetime_1 };
          case "Some":
            return { $: "ExpectedSignatureSome", span, ty_or_sig, trait_path, lifetime_1 };
          case "Nothing":
            return { $: "ExpectedSignatureNothing", span, ty_or_sig, trait_path };
        }
        break;
      case "Passive":
        switch (lt_kind) {
          case "Two":
            return { $: "ExpectedPassiveTwo", span, ty_or_sig, trait_path, lifetime_1, lifetime_2 };
          case "Any":
            return { $: "ExpectedPassiveAny", span, ty_or_sig, trait_path, lifetime_1 };
          case "Some":
            return { $: "ExpectedPassiveSome", span, ty_or_sig, trait_path, lifetime_1 };
          case "Nothing":
            return { $: "ExpectedPassiveNothing", span, ty_or_sig, trait_path };
        }
        break;
      case "Other":
        switch (lt_kind) {
          case "Two":
            return { $: "ExpectedOtherTwo", span, ty_or_sig, trait_path, lifetime_1, lifetime_2 };
          case "Any":
            return { $: "ExpectedOtherAny", span, ty_or_sig, trait_path, lifetime_1 };
          case "Some":
            return { $: "ExpectedOtherSome", span, ty_or_sig, trait_path, lifetime_1 };
          case "Nothing":
            return { $: "ExpectedOtherNothing", span, ty_or_sig, trait_path };
        }
        break;
    }
  },
};

/** `impl Subdiagnostic for ConsiderBorrowingParamHelp` */
// rustc: compiler/rustc_trait_selection/src/diagnostics.rs:1183 add_to_diag
export function ConsiderBorrowingParamHelp_add_to_diag(self: ConsiderBorrowingParamHelp, diag: Diag): void {
  const type_param_span: MultiSpan = MultiSpan.from_Vec([...self.spans]);
  for (const span of self.spans) {
    // Seems like we can't call f() here as Into<DiagMessage> is required
    type_param_span.push_span_label(span, msg("consider borrowing this type parameter in the trait"));
  }
  const msg_ = msg("the lifetime requirements from the `impl` do not correspond to the requirements in the `trait`");
  diag.span_help(type_param_span, msg_);
}
/** `ConsiderBorrowingParamHelp` as a `Subdiagnostic` trait object. */
export function ConsiderBorrowingParamHelp_subdiagnostic(self: ConsiderBorrowingParamHelp): Subdiagnostic {
  return { add_to_diag: (diag) => ConsiderBorrowingParamHelp_add_to_diag(self, diag) };
}

/** `impl Subdiagnostic for SuggestTuplePatternMany` */
// rustc: compiler/rustc_trait_selection/src/diagnostics.rs:1664 add_to_diag
export function SuggestTuplePatternMany_add_to_diag(self: SuggestTuplePatternMany, diag: Diag): void {
  diag.arg("path", IntoDiagArg.String(self.path));
  const message = msg("try wrapping the pattern in a variant of `{$path}`");
  diag.multipart_suggestions(
    message,
    self.compatible_variants.map((variant): [Span, string][] => [
      [Span.shrink_to_lo(self.cause_span), `${variant}(`],
      [Span.shrink_to_hi(self.cause_span), ")"],
    ]),
    "MaybeIncorrect",
  );
}
/** `SuggestTuplePatternMany` as a `Subdiagnostic` trait object. */
export function SuggestTuplePatternMany_subdiagnostic(self: SuggestTuplePatternMany): Subdiagnostic {
  return { add_to_diag: (diag) => SuggestTuplePatternMany_add_to_diag(self, diag) };
}

/** `impl Subdiagnostic for AddPreciseCapturingAndParams` */
// rustc: compiler/rustc_trait_selection/src/diagnostics.rs:1910 add_to_diag
export function AddPreciseCapturingAndParams_add_to_diag(self: AddPreciseCapturingAndParams, diag: Diag): void {
  diag.arg("new_lifetime", IntoDiagArg.of(self.new_lifetime, Symbol_into_diag_arg));
  diag.multipart_suggestion(
    msg(
      "add a `use<...>` bound to explicitly capture `{$new_lifetime}` after turning all argument-position `impl Trait` into type parameters, noting that this possibly affects the API of this crate",
    ),
    self.suggs,
    "MaybeIncorrect",
  );
  diag.span_note(
    self.apit_spans,
    msg("you could use a `use<...>` bound to explicitly capture `{$new_lifetime}`, but argument-position `impl Trait`s are not nameable"),
  );
}
/** `AddPreciseCapturingAndParams` as a `Subdiagnostic` trait object. */
export function AddPreciseCapturingAndParams_subdiagnostic(self: AddPreciseCapturingAndParams): Subdiagnostic {
  return { add_to_diag: (diag) => AddPreciseCapturingAndParams_add_to_diag(self, diag) };
}

/// Given a set of captured `DefId` for an RPIT (opaque_def_id) and a given
/// function (fn_def_id), try to suggest adding `+ use<...>` to capture just
/// the specified parameters. If one of those parameters is an APIT, then try
/// to suggest turning it into a regular type parameter.
// rustc: compiler/rustc_trait_selection/src/diagnostics.rs:1928 impl_trait_overcapture_suggestion
export function impl_trait_overcapture_suggestion(
  tcx: TyCtxt,
  opaque_def_id: LocalDefId,
  fn_def_id: LocalDefId,
  captured_args: DefIdSet,
): AddPreciseCapturingForOvercapture | undefined {
  const rpit_span = tcx.def_span(opaque_def_id);

  // Every suggestion below is anchored on the opaque's span, so bail if that span is not one
  // the user can edit. AST lowering marks it with the `impl Trait` desugaring, hence the
  // question is about the span it desugared from: for an opaque created inside a macro
  // expansion that span is the expansion site, which for an attribute macro is the attribute
  // itself, where `+ use<..>` does not even parse.
  const callsite = Span.parent_callsite(rpit_span);
  if (callsite !== undefined && !Span.can_be_used_for_suggestions(callsite)) {
    return undefined;
  }

  const generics = tcx.generics_of(fn_def_id) as Generics;

  // PORT: `FxIndexSet<Symbol>` → insertion-ordered `Set`.
  const captured_lifetimes: Set<Symbol> = new Set();
  const captured_non_lifetimes: Set<Symbol> = new Set();
  const synthetics: [Span, Symbol][] = [];

  for (const arg of captured_args) {
    if (tcx.def_kind(arg).$ === "LifetimeParam") {
      captured_lifetimes.add(tcx.item_name(arg));
    } else {
      const idx = unwrap(generics.param_def_id_to_index_(tcx, arg), "expected arg in scope");
      const param = generics.param_at(idx, tcx);
      if (GenericParamDefKind.is_synthetic(param.kind)) {
        synthetics.push([tcx.def_span(arg), param.name]);
      } else {
        captured_non_lifetimes.add(tcx.item_name(arg));
      }
    }
  }

  /** `IndexSet::insert`: `true` when the value was not present. */
  const insert = (set: Set<Symbol>, s: Symbol): boolean => {
    if (set.has(s)) return false;
    set.add(s);
    return true;
  };
  const next_fresh_param = (): Symbol => {
    for (const c of ["T", "U", "V", "W", "X", "Y", "A", "B", "C"]) {
      const s = sym.character(c.charCodeAt(0));
      if (insert(captured_non_lifetimes, s)) return s;
    }
    for (let i = 0; ; i++) {
      const s = Symbol.intern(`T${i}`);
      if (insert(captured_non_lifetimes, s)) return s;
    }
  };

  const suggs: [Span, string][] = [];
  const apit_spans: Span[] = [];

  if (synthetics.length !== 0) {
    let new_params = "";
    for (const [i, [span, name]] of synthetics.entries()) {
      apit_spans.push(span);

      const fresh_param = next_fresh_param();

      // Suggest renaming.
      suggs.push([span, Symbol.as_str(fresh_param)]);

      // Super jank. Turn `impl Trait` into `T: Trait`.
      //
      // This currently involves stripping the `impl` from the name of
      // the parameter, since APITs are always named after how they are
      // rendered in the AST. This sucks! But to recreate the bound list
      // from the APIT itself would be miserable, so we're stuck with
      // this for now!
      if (i > 0) {
        new_params += ", ";
      }
      let name_as_bounds = Symbol.as_str(name);
      while (name_as_bounds.startsWith("impl")) name_as_bounds = name_as_bounds.slice("impl".length); // `trim_start_matches("impl")`
      name_as_bounds = str_trim_start_ws(name_as_bounds);
      new_params += Symbol.as_str(fresh_param);
      new_params += ": ";
      new_params += name_as_bounds;
    }

    const generics = tcx.hir_get_generics(fn_def_id);
    if (generics === undefined) {
      // This shouldn't happen, but don't ICE.
      return undefined;
    }

    // Add generics or concatenate to the end of the list.
    const params_span = generics.span_for_param_suggestion();
    suggs.push(params_span !== undefined ? [params_span, `, ${new_params}`] : [generics.span, `<${new_params}>`]);
  }

  const concatenated_bounds = [...captured_lifetimes, ...captured_non_lifetimes].map((sym) => Symbol.as_str(sym)).join(", ");

  const opaque_hir_id = tcx.local_def_id_to_hir_id(opaque_def_id);
  // FIXME: This is a bit too conservative, since it ignores parens already written in AST.
  let lparen: string, rparen: string;
  let nth: [HirId, hir.Node] | undefined;
  {
    let n = 0;
    for (const item of tcx.hir_parent_iter(opaque_hir_id)) {
      if (n === 1) {
        nth = item;
        break;
      }
      n++;
    }
  }
  const parent = unwrap(nth, "expected ty to have a parent always")[1];
  let paren_sugar: hir.Ty | undefined;
  if (
    parent.$ === "PathSegment" &&
    (paren_sugar = parent._0.args_().paren_sugar_output()) !== undefined &&
    HirId_eq(paren_sugar.hir_id, opaque_hir_id)
  ) {
    [lparen, rparen] = ["(", ")"];
  } else if (parent.$ === "Ty") {
    const ty = parent._0;
    switch (ty.kind.$) {
      case "Ptr":
      case "Ref":
        [lparen, rparen] = ["(", ")"];
        break;
      // FIXME: RPITs are not allowed to be nested in `impl Fn() -> ...`,
      // but we eventually could support that, and that would necessitate
      // making this more sophisticated.
      default:
        [lparen, rparen] = ["", ""];
    }
  } else {
    [lparen, rparen] = ["", ""];
  }

  if (lparen.length !== 0) {
    suggs.push([Span.shrink_to_lo(rpit_span), lparen]);
  }
  suggs.push([Span.shrink_to_hi(rpit_span), ` + use<${concatenated_bounds}>${rparen}`]);

  return { suggs, apit_spans };
}

/** `impl Subdiagnostic for AddPreciseCapturingForOvercapture` */
// rustc: compiler/rustc_trait_selection/src/diagnostics.rs:2060 add_to_diag
export function AddPreciseCapturingForOvercapture_add_to_diag(self: AddPreciseCapturingForOvercapture, diag: Diag): void {
  let applicability: Applicability;
  if (self.apit_spans.length === 0) {
    applicability = "MachineApplicable";
  } else {
    // If there are APIT that are converted to regular parameters,
    // then this may make the API turbofishable in ways that were
    // not intended.
    applicability = "MaybeIncorrect";
  }
  diag.multipart_suggestion(msg("use the precise capturing `use<...>` syntax to make the captures explicit"), self.suggs, applicability);
  if (self.apit_spans.length !== 0) {
    diag.span_note(
      self.apit_spans,
      msg("you could use a `use<...>` bound to explicitly specify captures, but argument-position `impl Trait`s are not nameable"),
    );
  }
}
/** `AddPreciseCapturingForOvercapture` as a `Subdiagnostic` trait object. */
export function AddPreciseCapturingForOvercapture_subdiagnostic(self: AddPreciseCapturingForOvercapture): Subdiagnostic {
  return { add_to_diag: (diag) => AddPreciseCapturingForOvercapture_add_to_diag(self, diag) };
}

/** `str::trim_start` (Unicode `White_Space`). PORT: not JS `trimStart` (it strips U+FEFF and misses U+0085); as
 * error_reporting/infer/region.ts's `trim_start`. */
function str_trim_start_ws(s: string): string {
  let i = 0;
  for (;;) {
    const c = s.codePointAt(i);
    if (c === undefined || !is_whitespace(c)) break;
    i += c > 0xffff ? 2 : 1;
  }
  return s.slice(i);
}
