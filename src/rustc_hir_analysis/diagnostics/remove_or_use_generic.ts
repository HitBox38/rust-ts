// Port of compiler/rustc_hir_analysis/src/diagnostics/remove_or_use_generic.rs (lane variance-outlives: its only caller
// is impl_wf_check.rs, so it is ported with it; see docs/handoff/variance-outlives.md).
//
// PORT notes (file-wide):
// - `ParamUsageVisitor` extends rustc_hir intravisit's `Visitor<ControlFlow<null>>` (`type Result = ControlFlow<()>`,
//   `NestedFilter = All`), as collect/dump.ts's `AnonConstFinder`.
// - `format!("{}", param.name)` is `display_Symbol`; `String::new()` is `""`.
// Init order: top-level code here touches only other crates.
import { ControlFlow, VisitorResult } from "../../rustc_ast_ir/visit.ts";
import { Applicability, type Diag } from "../../rustc_errors/lib.ts";
import { Res } from "../../rustc_hir/def.ts";
import { Node } from "../../rustc_hir/hir.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import type { HirId } from "../../rustc_hir_id/lib.ts";
import { type HirTyCtxt, Visitor, walk_lifetime, walk_path } from "../../rustc_hir/intravisit.ts";
import { TyCtxt_as_HirTyCtxt } from "../../rustc_middle/hir/map.ts";
import { All } from "../../rustc_middle/hir/nested_filter.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { GenericParamDef, Generics } from "../../rustc_middle/ty/generics.ts";
import { type DefId, DefId_eq, LocalDefId } from "../../rustc_span/def_id.ts";
import { Span } from "../../rustc_span/lib.ts";
import { display_Symbol } from "../../rustc_span/symbol.ts";
import { unwrap } from "../../std/panic.ts";

/// Use a Visitor to find usages of the type or lifetime parameter
// rustc-type: compiler/rustc_hir_analysis/src/diagnostics/remove_or_use_generic.rs:14 ParamUsageVisitor
class ParamUsageVisitor extends Visitor<ControlFlow<null>> {
  constructor(
    public tcx: TyCtxt,
    /// The `DefId` of the generic parameter we are looking for.
    public param_def_id: DefId,
    public found: boolean,
  ) {
    super();
  }

  // ---- impl<'tcx> Visitor<'tcx> for ParamUsageVisitor<'tcx> ----

  // type NestedFilter = All;
  override NestedFilter = All;

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/remove_or_use_generic.rs:24 maybe_tcx
  override maybe_tcx(): HirTyCtxt {
    return TyCtxt_as_HirTyCtxt(this.tcx);
  }

  // type Result = ControlFlow<()>;
  override Result = VisitorResult.ControlFlow<null>();

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/remove_or_use_generic.rs:30 visit_path
  override visit_path(path: hir.Path, _id: HirId): ControlFlow<null> {
    const res_def_id = Res.opt_def_id(path.res);
    if (res_def_id !== undefined) {
      if (DefId_eq(res_def_id, this.param_def_id)) {
        this.found = true;
        return ControlFlow.Break(null);
      }
    }
    return walk_path(this, path);
  }

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/remove_or_use_generic.rs:40 visit_lifetime
  override visit_lifetime(lifetime: hir.Lifetime): ControlFlow<null> {
    if (lifetime.kind.$ === "Param") {
      const id = lifetime.kind._0;
      const local_def_id = this.param_def_id.as_local();
      if (local_def_id !== undefined) {
        if (id === local_def_id) {
          this.found = true;
          return ControlFlow.Break(null);
        }
      }
    }
    return walk_lifetime(this, lifetime);
  }
}

/// Adds a suggestion to a diagnostic to either remove an unused generic parameter, or use it.
///
/// # Examples
///
/// - `impl<T> Struct { ... }` where `T` is unused -> suggests removing `T` or using it.
/// - `impl<T> Struct { // T used in here }` where `T` is used in the body but not in the self type -> suggests adding `T` to the self type and struct definition.
/// - `impl<T> Struct { ... }` where the struct has a generic parameter with a default -> suggests adding `T` to the self type.
// rustc: compiler/rustc_hir_analysis/src/diagnostics/remove_or_use_generic.rs:60 suggest_to_remove_or_use_generic
export function suggest_to_remove_or_use_generic(tcx: TyCtxt, diag: Diag, impl_def_id: LocalDefId, param: GenericParamDef, is_lifetime: boolean): void {
  const node = tcx.hir_node_by_def_id(impl_def_id);
  const hir_impl = Node.expect_item(node).expect_impl();

  const index = hir_impl.generics.params.findIndex((par) => DefId_eq(LocalDefId.to_def_id(par.def_id), param.def_id));
  if (index === -1) {
    return;
  }

  // Get the ADT definition ID from the self type.
  let adt_def_id: DefId;
  const sk = hir_impl.self_ty.kind;
  if (
    sk.$ === "Path" &&
    sk._0.$ === "Resolved" &&
    sk._0._1.res.$ === "Def" &&
    (sk._0._1.res._0.$ === "Struct" || sk._0._1.res._0.$ === "Enum" || sk._0._1.res._0.$ === "Union")
  ) {
    adt_def_id = sk._0._1.res._1;
  } else {
    return;
  }

  // Count how many generic parameters are defined in the ADT definition.
  const generics = tcx.generics_of(adt_def_id) as Generics;
  const total_params = generics.own_params.filter((p) => {
    if (is_lifetime) {
      return p.kind.$ === "Lifetime";
    } else {
      return p.kind.$ === "Type";
    }
  }).length;

  // Count how many arguments are currently provided in the impl
  let provided_params = 0;
  let last_segment_args: hir.GenericArgs | undefined = undefined;

  if (sk.$ === "Path" && sk._0.$ === "Resolved") {
    const path = sk._0._1;
    const seg = path.segments[path.segments.length - 1];
    if (seg !== undefined && seg.args !== undefined) {
      const args = seg.args;
      last_segment_args = args;
      provided_params = args.args.filter((arg) => {
        switch (arg.$) {
          case "Lifetime":
            return is_lifetime;
          case "Type":
            return !is_lifetime;
          default:
            return false;
        }
      }).length;
    }
  }

  const visitor = new ParamUsageVisitor(tcx, param.def_id, false);
  for (const item_ref of hir_impl.items) {
    void visitor.visit_impl_item_ref(item_ref);
    if (visitor.found) {
      break;
    }
  }
  const is_param_used = visitor.found;

  const suggestions: [Span, string][] = [];

  // Option A: Remove (Only if not used in body)
  if (!is_param_used) {
    suggestions.push([hir_impl.generics.span_for_param_removal(index), ""]);
  }

  // Option B: Suggest adding only if there's an available parameter in the ADT definition
  // or the parameter is already used somewhere, then we suggest adding to the impl self type
  // and the ADT definition.
  if (provided_params < total_params || is_param_used) {
    if (last_segment_args !== undefined) {
      const args = last_segment_args;
      // Self type already has <...>, append to it.
      suggestions.push([Span.shrink_to_hi(unwrap(args.span())), `, ${display_Symbol(param.name)}`]);
    } else if (sk.$ === "Path" && sk._0.$ === "Resolved") {
      const path = sk._0._1;
      // Self type has no <...> yet, add it.
      const seg = unwrap(path.segments[path.segments.length - 1]);
      suggestions.push([Span.shrink_to_hi(seg.ident.span), `<${display_Symbol(param.name)}>`]);
    }
    if (is_param_used) {
      // If the parameter is used in the body, also suggest adding it to the ADT
      // definition if it's not already there.
      const adt_span = tcx.def_span(adt_def_id);
      const generics = tcx.generics_of(adt_def_id) as Generics;
      const last = generics.own_params[generics.own_params.length - 1];
      const last_param_span = last === undefined ? undefined : tcx.def_span(last.def_id);

      if (last_param_span !== undefined) {
        suggestions.push([Span.shrink_to_hi(last_param_span), `, ${display_Symbol(param.name)}`]);
      } else {
        suggestions.push([Span.shrink_to_hi(adt_span), `<${display_Symbol(param.name)}>`]);
      }
    }
  }

  if (suggestions.length === 0) {
    return;
  }

  const parameter_type = is_lifetime ? "lifetime" : "type";
  if (is_param_used) {
    const msg = `use the ${parameter_type} parameter \`${display_Symbol(param.name)}\` in the \`${tcx.def_path_str(adt_def_id)}\` type and use it in the type definition`;
    diag.multipart_suggestion(
      msg,
      [
        [unwrap(suggestions[0], "index out of bounds: the len is 0 but the index is 0")[0], suggestions[0]![1]],
        [unwrap(suggestions[1], `index out of bounds: the len is ${suggestions.length} but the index is 1`)[0], suggestions[1]![1]],
      ],
      Applicability.MaybeIncorrect,
    );
  } else {
    let msg: string;
    if (suggestions.length === 2) {
      msg = `either remove the unused ${parameter_type} parameter \`${display_Symbol(param.name)}\``;
    } else {
      msg = `remove the unused ${parameter_type} parameter \`${display_Symbol(param.name)}\``;
    }
    diag.span_suggestion(suggestions[0]![0], msg, suggestions[0]![1], Applicability.MaybeIncorrect);
    if (suggestions.length === 2) {
      const msg = `or use it`;
      diag.span_suggestion(suggestions[1]![0], msg, suggestions[1]![1], Applicability.MaybeIncorrect);
    }
  }
}
