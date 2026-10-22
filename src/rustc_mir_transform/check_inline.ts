// Port of compiler/rustc_mir_transform/src/check_inline.rs (lane mt-built-lints).
//
// PORT: `Result<(), &'static str>` is `Result<null, string>`; `.and_then(|_| ..)` is an explicit `Ok` check.
//! Check that a body annotated with `#[rustc_force_inline]` will not fail to inline based on its
//! definition alone (irrespective of any specific caller).
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { BodyOwnerKind } from "../rustc_hir/hir.ts";
import { CodegenFnAttrFlags, type CodegenFnAttrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { HasAttrs_DefId, type Ty } from "../rustc_middle/ty/mod.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { type Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import { ClosureArgs } from "../rustc_type_ir/ty_kind/closure.ts";
import { type FnSig, PolyFnSig } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { InvalidForceInline_diagnostic } from "./diagnostics.ts";
import { MirLint } from "./pass_manager.ts";

// rustc-type: compiler/rustc_mir_transform/src/check_inline.rs:13 CheckForceInline
export class CheckForceInline extends MirLint {
  readonly type_name = "rustc_mir_transform::check_inline::CheckForceInline";

  // impl<'tcx> MirLint<'tcx> for CheckForceInline
  // rustc: compiler/rustc_mir_transform/src/check_inline.rs:16 run_lint
  run_lint(tcx: TyCtxt, body: Body): void {
    const def_id = body.source.def_id();
    if (!BodyOwnerKind.is_fn_or_closure(tcx.hir_body_owner_kind(def_id)) || !def_id.is_local()) {
      return;
    }
    // PORT: the `codegen_fn_attrs` query value is `unknown` in queries.gen.ts.
    const inline = (tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs).inline;
    if (inline.$ !== "Force") {
      return;
    }
    const attr_span = inline.attr_span;

    let result: Result<null, string> = is_inline_valid_on_fn(tcx, def_id);
    if (result.$ === "Ok") result = is_inline_valid_on_body(tcx, body);
    if (result.$ === "Err") {
      const reason = result._0;
      tcx.dcx().emit_err(
        InvalidForceInline_diagnostic({
          attr_span,
          callee_span: tcx.def_span(def_id),
          callee: tcx.def_path_str(def_id),
          reason,
        }),
      );
    }
  }
}

// rustc: compiler/rustc_mir_transform/src/check_inline.rs:38 is_inline_valid_on_fn
export function is_inline_valid_on_fn(tcx: TyCtxt, def_id: DefId): Result<null, string> {
  // PORT: the `codegen_fn_attrs` query value is `unknown` in queries.gen.ts.
  const codegen_attrs = tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs;

  if (find_attr(HasAttrs_DefId.get_attrs(def_id, tcx), (k) => (k.$ === "RustcNoMirInline" ? true : undefined)) !== undefined) {
    return Err("#[rustc_no_mir_inline]");
  }

  // PORT: the `type_of` / `fn_sig` query values are `unknown` in queries.gen.ts.
  const ty = tcx.type_of(def_id) as EarlyBinder<Ty>;
  const kind = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(ty)).kind();
  let c_variadic: boolean;
  switch (kind.$) {
    case "FnDef":
      c_variadic = PolyFnSig.c_variadic(
        Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>)),
      );
      break;
    case "Closure":
      c_variadic = PolyFnSig.c_variadic(ClosureArgs.sig(kind._1.as_closure()));
      break;
    default:
      c_variadic = false;
  }
  if (c_variadic) {
    return Err("C variadic");
  }

  if (CodegenFnAttrFlags.contains(codegen_attrs.flags, CodegenFnAttrFlags.COLD)) {
    return Err("cold");
  }

  // Intrinsics without fallback body cannot be inlined. The logic for which intrinsics *with*
  // body can be inlined is in the inlining pass.
  const intrinsic = tcx.intrinsic(def_id);
  if (intrinsic !== undefined && intrinsic.must_be_overridden) {
    return Err("callee is an intrinsic without fallback body");
  }

  return Ok(null);
}

// rustc: compiler/rustc_mir_transform/src/check_inline.rs:72 is_inline_valid_on_body
export function is_inline_valid_on_body(_: TyCtxt, body: Body): Result<null, string> {
  if (body.basic_blocks.deref().some((bb) => bb.terminator_().kind.$ === "TailCall")) {
    return Err("can't inline functions with tail calls");
  }

  return Ok(null);
}
