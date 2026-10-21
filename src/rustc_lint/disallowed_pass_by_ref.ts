// Port of compiler/rustc_lint/src/disallowed_pass_by_ref.rs. The tool lint static and the `declare_lint_pass!`
// expansion are generated (disallowed_pass_by_ref.lints.gen.ts).
import { find_attr } from "../rustc_attr_ir/lib.ts";
import type * as hir from "../rustc_hir/hir.ts";
import { display_Lifetime } from "../rustc_hir/hir.ts";
import { HasAttrs_DefId, type Ty } from "../rustc_middle/ty/mod.ts";
import { display_Ident } from "../rustc_span/symbol.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { unwrap } from "../std/panic.ts";
import type { LateContext } from "./context.ts";
import { DisallowedPassByRefDiag_diagnostic } from "./diagnostics.ts";
import { DISALLOWED_PASS_BY_REF, DisallowedPassByRef } from "./disallowed_pass_by_ref.lints.gen.ts";
import type { LateLintPass } from "./passes.ts";

export * from "./disallowed_pass_by_ref.lints.gen.ts";

declare module "./disallowed_pass_by_ref.lints.gen.ts" {
  interface DisallowedPassByRef extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for DisallowedPassByRef
// rustc: compiler/rustc_lint/src/disallowed_pass_by_ref.rs:24 check_ty
DisallowedPassByRef.prototype.check_ty = function (this: DisallowedPassByRef, cx: LateContext, ty: hir.Ty<hir.AmbigArg>): void {
  switch (ty.kind.$) {
    case "Ref": {
      if (ty.kind._2 !== "Not") break;
      const inner_ty = ty.kind._1;
      if (cx.tcx.trait_impl_of_assoc(ty.hir_id.owner.to_def_id()) !== undefined) {
        return;
      }
      const t = path_for_rustc_pass_by_value(cx, inner_ty);
      if (t !== undefined) {
        cx.emit_span_lint(DISALLOWED_PASS_BY_REF, ty.span, DisallowedPassByRefDiag_diagnostic({ ty: t, suggestion: ty.span }));
      }
      break;
    }
    default:
      break;
  }
};

// rustc: compiler/rustc_lint/src/disallowed_pass_by_ref.rs:43 path_for_rustc_pass_by_value
function path_for_rustc_pass_by_value(cx: LateContext, ty: hir.Ty): string | undefined {
  if (ty.kind.$ === "Path" && ty.kind._0.$ === "Resolved") {
    const path = ty.kind._0._1;
    const res = path.res;
    if (res.$ === "Def" && find_attr(HasAttrs_DefId.get_attrs(res._1, cx.tcx), (k) => (k.$ === "RustcPassByValue" ? null : undefined)) !== undefined) {
      const def_id = res._1;
      const name = cx.tcx.item_ident(def_id);
      const path_segment = unwrap(path.segments[path.segments.length - 1]);
      return `${display_Ident(name)}${gen_args(cx, path_segment)}`;
    } else if (res.$ === "SelfTyAlias" && !res.is_trait_impl) {
      const did = res.alias_to;
      const k = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(cx.tcx.type_of(did) as EarlyBinder<Ty>)).kind();
      if (k.$ === "Adt") {
        const adt = k._0;
        const args = k._1;
        if (find_attr(HasAttrs_DefId.get_attrs(adt.did(), cx.tcx), (k) => (k.$ === "RustcPassByValue" ? null : undefined)) !== undefined) {
          return cx.tcx.def_path_str_with_args(adt.did(), args);
        }
      }
    }
  }

  return undefined;
}

// rustc: compiler/rustc_lint/src/disallowed_pass_by_ref.rs:67 gen_args
function gen_args(cx: LateContext, segment: hir.PathSegment): string {
  if (segment.args !== undefined) {
    const args = segment.args;
    const params = args.args.map((arg): string => {
      switch (arg.$) {
        case "Lifetime":
          return display_Lifetime(arg._0);
        case "Type": {
          const r = cx.tcx.sess.source_map().span_to_snippet(arg._0.span);
          return r.$ === "Ok" ? r._0.toString() : "_";
        }
        case "Const": {
          const r = cx.tcx.sess.source_map().span_to_snippet(arg._0.span);
          return r.$ === "Ok" ? r._0.toString() : "_";
        }
        case "Infer":
          return "_";
      }
    });

    if (params.length !== 0) {
      return `<${params.join(", ")}>`;
    }
  }

  return "";
}
