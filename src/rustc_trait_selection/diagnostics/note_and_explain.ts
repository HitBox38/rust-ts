// Port of compiler/rustc_trait_selection/src/diagnostics/note_and_explain.rs (lane errrep-infer-b).
//
// The types are generated (note_and_explain.gen.ts, set `rustc_trait_selection_error_reporting`; `DescriptionCtx` and
// `RegionExplanation` are classes). The hand-written fns are below with the names the contract gives them (decls.ts
// comment-only section, `diagnostics/note_and_explain.rs:<line>`): the associated fns `DescriptionCtx.new` /
// `RegionExplanation.new` (statics assigned below), the `IntoDiagArg` impls of `PrefixKind` / `SuffixKind` and the
// `Subdiagnostic` impl of `RegionExplanation` (imported by ../diagnostics.gen.ts).
// Init order: top-level code here may touch only this file's .gen.ts and other crates; find_anon_type.ts is read lazily.
export * from "./note_and_explain.gen.ts";
import { str_into_diag_arg, String_into_diag_arg } from "../../rustc_error_messages/diagnostic_impls.ts";
import { type DiagArgValue, IntoDiagArg } from "../../rustc_error_messages/lib.ts";
import { DiagMessage_arg } from "../../rustc_errors/formatting.ts";
import { type Diag, msg, type Subdiagnostic } from "../../rustc_errors/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Region } from "../../rustc_middle/ty/decls.ts";
import type { Generics } from "../../rustc_middle/ty/generics.ts";
import { EarlyParamRegion, LateParamRegionKind } from "../../rustc_middle/ty/region.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import type { PathBuf, Span } from "../../rustc_span/lib.ts";
import { kw, Symbol } from "../../rustc_span/symbol.ts";
import { debug_Region } from "../../rustc_type_ir/sty/mod.ts";
import { display_Region } from "../../rustc_type_ir/ir_print.ts";
import { PLAIN } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { bug } from "../../rustc_span/macros.ts";
import { DescriptionCtx, PrefixKind, RegionExplanation, SuffixKind } from "./note_and_explain.gen.ts";

/** `crate::error_reporting::infer::nice_region_error::find_anon_type` (read lazily: init order). */
function find_anon_type_mod(): typeof import("../error_reporting/infer/nice_region_error/find_anon_type.ts") {
  return (find_anon_type_mod__m ??= require("../error_reporting/infer/nice_region_error/find_anon_type.ts") as typeof import("../error_reporting/infer/nice_region_error/find_anon_type.ts"));
}
var find_anon_type_mod__m: typeof import("../error_reporting/infer/nice_region_error/find_anon_type.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)

declare module "./note_and_explain.gen.ts" {
  namespace DescriptionCtx {
    // diagnostics/note_and_explain.rs:16
    function new_(tcx: TyCtxt, generic_param_scope: LocalDefId, region: Region, alt_span: Span | undefined): DescriptionCtx | undefined;
    export { new_ as new };
  }
  namespace RegionExplanation {
    // diagnostics/note_and_explain.rs:148
    function new_(
      tcx: TyCtxt,
      generic_param_scope: LocalDefId,
      region: Region,
      alt_span: Span | undefined,
      prefix: PrefixKind,
      suffix: SuffixKind,
    ): RegionExplanation | undefined;
    export { new_ as new };
  }
}

// rustc: compiler/rustc_trait_selection/src/diagnostics/note_and_explain.rs:16 new
(DescriptionCtx as unknown as { new: typeof DescriptionCtx.new }).new = function (
  tcx: TyCtxt,
  generic_param_scope: LocalDefId,
  region: Region,
  alt_span: Span | undefined,
): DescriptionCtx | undefined {
  let span: Span | undefined, kind: string, arg: string;
  const k = region.kind();
  switch (k.$) {
    case "ReEarlyParam": {
      const br = k._0;
      const scope = tcx.parent((tcx.generics_of(generic_param_scope) as Generics).region_param(br, tcx).def_id).expect_local();
      const generics = tcx.hir_get_generics(scope);
      const param = generics === undefined ? undefined : generics.get_named(br.name);
      let span_: Span;
      if (param !== undefined) {
        span_ = param.span;
      } else {
        span_ = tcx.def_span(scope);
      }
      if (EarlyParamRegion.is_named(br)) {
        [span, kind, arg] = [span_, "as_defined", Symbol.as_str(br.name)];
      } else {
        [span, kind, arg] = [span_, "as_defined_anon", ""];
      }
      break;
    }
    case "ReLateParam": {
      const fr = k._0;
      const anon = LateParamRegionKind.is_named(fr.kind, tcx) ? undefined : find_anon_type_mod().find_anon_type(tcx, generic_param_scope, region);
      if (!LateParamRegionKind.is_named(fr.kind, tcx) && anon !== undefined) {
        const [ty] = anon;
        [span, kind, arg] = [ty.span, "defined_here", ""];
      } else {
        const scope = fr.scope.expect_local();
        switch (fr.kind.$) {
          case "Named": {
            const def_id = fr.kind._0;
            const name = tcx.item_name(def_id);
            const generics = tcx.hir_get_generics(scope);
            const param = generics === undefined ? undefined : generics.get_named(name);
            let span_: Span;
            if (param !== undefined) {
              span_ = param.span;
            } else {
              span_ = tcx.def_span(scope);
            }
            if (name === kw.UnderscoreLifetime) {
              [span, kind, arg] = [span_, "as_defined_anon", ""];
            } else {
              [span, kind, arg] = [span_, "as_defined", Symbol.as_str(name)];
            }
            break;
          }
          case "Anon": {
            const span_ = tcx.def_span(scope);
            [span, kind, arg] = [span_, "defined_here", ""];
            break;
          }
          default:
            [span, kind, arg] = [tcx.def_span(scope), "defined_here_reg", display_Region(region)];
        }
      }
      break;
    }

    case "ReStatic":
      [span, kind, arg] = [alt_span, "restatic", ""];
      break;

    case "RePlaceholder":
    case "ReError":
      return undefined;

    case "ReVar":
    case "ReBound":
    case "ReErased":
      return bug(`unexpected region for DescriptionCtx: ${debug_Region(region, PLAIN)}`);
  }
  return new DescriptionCtx(span, kind, arg);
};

// rustc: compiler/rustc_trait_selection/src/diagnostics/note_and_explain.rs:108 into_diag_arg
export function PrefixKind_into_diag_arg(self: PrefixKind, _: MutRef<PathBuf | undefined>): DiagArgValue {
  let kind: string;
  switch (self) {
    case "Empty":
      kind = "empty";
      break;
    case "RefValidFor":
      kind = "ref_valid_for";
      break;
    case "ContentValidFor":
      kind = "content_valid_for";
      break;
    case "TypeObjValidFor":
      kind = "type_obj_valid_for";
      break;
    case "SourcePointerValidFor":
      kind = "source_pointer_valid_for";
      break;
    case "TypeSatisfy":
      kind = "type_satisfy";
      break;
    case "TypeOutlive":
      kind = "type_outlive";
      break;
    case "LfParamInstantiatedWith":
      kind = "lf_param_instantiated_with";
      break;
    case "LfParamMustOutlive":
      kind = "lf_param_must_outlive";
      break;
    case "LfInstantiatedWith":
      kind = "lf_instantiated_with";
      break;
    case "LfMustOutlive":
      kind = "lf_must_outlive";
      break;
    case "PointerValidFor":
      kind = "pointer_valid_for";
      break;
    case "DataValidFor":
      kind = "data_valid_for";
      break;
  }
  return { $: "Str", _0: kind };
}

// rustc: compiler/rustc_trait_selection/src/diagnostics/note_and_explain.rs:130 into_diag_arg
export function SuffixKind_into_diag_arg(self: SuffixKind, _: MutRef<PathBuf | undefined>): DiagArgValue {
  let kind: string;
  switch (self) {
    case "Empty":
      kind = "empty";
      break;
    case "Continues":
      kind = "continues";
      break;
    case "ReqByBinding":
      kind = "req_by_binding";
      break;
  }
  return { $: "Str", _0: kind };
}

// rustc: compiler/rustc_trait_selection/src/diagnostics/note_and_explain.rs:148 new
(RegionExplanation as unknown as { new: typeof RegionExplanation.new }).new = function (
  tcx: TyCtxt,
  generic_param_scope: LocalDefId,
  region: Region,
  alt_span: Span | undefined,
  prefix: PrefixKind,
  suffix: SuffixKind,
): RegionExplanation | undefined {
  const desc = DescriptionCtx.new(tcx, generic_param_scope, region, alt_span);
  if (desc === undefined) return undefined;
  return new RegionExplanation(desc, prefix, suffix);
};

/** `impl Subdiagnostic for RegionExplanation<'_>` */
// rustc: compiler/rustc_trait_selection/src/diagnostics/note_and_explain.rs:165 add_to_diag
export function RegionExplanation_add_to_diag(self: RegionExplanation, diag: Diag): void {
  const msg_ = DiagMessage_arg(
    msg(
      "{$pref_kind ->\n                *[should_not_happen] [{$pref_kind}]\n                [ref_valid_for] ...the reference is valid for\n                [content_valid_for] ...but the borrowed content is only valid for\n                [type_obj_valid_for] object type is valid for\n                [source_pointer_valid_for] source pointer is only valid for\n                [type_satisfy] type must satisfy\n                [type_outlive] type must outlive\n                [lf_param_instantiated_with] lifetime parameter instantiated with\n                [lf_param_must_outlive] but lifetime parameter must outlive\n                [lf_instantiated_with] lifetime instantiated with\n                [lf_must_outlive] but lifetime must outlive\n                [pointer_valid_for] the pointer is valid for\n                [data_valid_for] but the referenced data is only valid for\n                [empty] {\"\"}\n            }{$pref_kind ->\n                [empty] {\"\"}\n                *[other] {\" \"}\n            }{$desc_kind ->\n                *[should_not_happen] [{$desc_kind}]\n                [restatic] the static lifetime\n                [revar] lifetime {$desc_arg}\n                [as_defined] the lifetime `{$desc_arg}` as defined here\n                [as_defined_anon] the anonymous lifetime as defined here\n                [defined_here] the anonymous lifetime defined here\n                [defined_here_reg] the lifetime `{$desc_arg}` as defined here\n                }{$suff_kind ->\n                *[should_not_happen] [{$suff_kind}]\n                [empty]{\"\"}\n                [continues] ...\n                [req_by_binding] {\" \"}as required by this binding\n            }",
    ),
    "pref_kind",
    IntoDiagArg.of(self.prefix, PrefixKind_into_diag_arg),
  )
    .arg("suff_kind", IntoDiagArg.of(self.suffix, SuffixKind_into_diag_arg))
    .arg("desc_kind", IntoDiagArg.of(self.desc.kind, str_into_diag_arg))
    .arg("desc_arg", IntoDiagArg.of(self.desc.arg, String_into_diag_arg))
    .format();

  // diag.restore_args();
  if (self.desc.span !== undefined) {
    const span = self.desc.span;
    diag.span_note(span, msg_);
  } else {
    diag.note(msg_);
  }
}
/** `RegionExplanation` as a `Subdiagnostic` trait object. */
export function RegionExplanation_subdiagnostic(self: RegionExplanation): Subdiagnostic {
  return { add_to_diag: (diag) => RegionExplanation_add_to_diag(self, diag) };
}
