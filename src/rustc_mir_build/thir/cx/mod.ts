// Port of compiler/rustc_mir_build/src/thir/cx/mod.rs (lane thir-cx-print).
//! This module contains the functionality to convert from the wacky tcx data
//! structures into the THIR. The `builder` is generally ignorant of the tcx,
//! etc., and instead goes through the `Cx` for most of its work.
//
// PORT: `impl ThirBuildCx` is split over this file, block.rs and expr.rs; block.ts and expr.ts put their methods on
// the prototype (PORTING §5 "Methods defined in another file") and are loaded by the crate root (lib.ts) after this
// module. `mod block; mod expr;` (mod.rs:225) therefore have no import here.
import { find_attr } from "../../../rustc_attr_ir/lib.ts";
import type { Steal } from "../../../rustc_data_structures/steal.ts";
import type { Body, FnDecl, Pat as HirPat, Ty as HirTy } from "../../../rustc_hir/hir.ts";
import { ImplicitSelfKind } from "../../../rustc_hir/hir.ts";
import type { HirId } from "../../../rustc_hir_id/lib.ts";
import { type ExprId, type Param, type Pat, Thir } from "../../../rustc_middle/thir.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { TypeckResults } from "../../../rustc_middle/ty/decls.ts";
import type { CanonicalUserType } from "../../../rustc_middle/ty/typeck_results.ts";
import { HasAttrs_HirId, type Ty, TypingEnv } from "../../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { type DefId, LocalDefId } from "../../../rustc_span/def_id.ts";
import { ClosureArgs, CoroutineClosureArgs } from "../../../rustc_type_ir/ty_kind/closure.ts";
import { FnSig } from "../../../rustc_type_ir/ty_kind.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import type { ErrorGuaranteed } from "../../../rustc_span/lib.ts";
import { display_Ty } from "../../../rustc_middle/ty/print/pretty.ts";
import * as pattern from "../pattern/mod.ts";
import * as util from "../util.ts";

/// Query implementation for [`TyCtxt::thir_body`].
// rustc: compiler/rustc_mir_build/src/thir/cx/mod.rs:17 thir_body
export function thir_body(tcx: TyCtxt, owner_def: LocalDefId): Result<[Steal<Thir>, ExprId], ErrorGuaranteed> {
  // PORT: `if cfg!(debug_assertions) && matches!(tcx.def_kind(owner_def), DefKind::Const | DefKind::AssocConst)
  // { debug_assert!(tcx.const_of_item(owner_def.to_def_id()).is_none(), ..) }`: rustc ships without debug
  // assertions (PORTING §3), so the whole block is compiled out.

  const body = tcx.hir_body_owned_by(owner_def);
  const cx: ThirBuildCx = ThirBuildCx.new(tcx, owner_def);
  const reported = cx.typeck_results.tainted_by_errors;
  if (reported !== undefined) {
    return Err(reported);
  }

  // Lower the params before the body's expression so errors from params are shown first.
  const owner_id = tcx.local_def_id_to_hir_id(owner_def);
  const fn_decl = tcx.hir_fn_decl_by_hir_id(owner_id);
  if (fn_decl !== undefined) {
    const closure_env_param = cx.closure_env_param(owner_def, owner_id);
    const explicit_params = cx.explicit_params(owner_id, fn_decl, body);
    const params: Param[] = [];
    if (closure_env_param !== undefined) params.push(closure_env_param);
    for (const p of explicit_params) params.push(p);
    cx.thir.params = params;

    // The resume argument may be missing, in that case we need to provide it here.
    // It will always be `()` in this case.
    if (tcx.is_coroutine(LocalDefId.to_def_id(owner_def)) && body.params.length === 0) {
      cx.thir.params.push({
        ty: tcx.types.unit,
        pat: undefined,
        ty_span: undefined,
        self_kind: undefined,
        hir_id: undefined,
      });
    }
  }

  const expr = cx.mirror_expr(body.value);
  // PORT: `alloc_steal_thir` (ty/context.ts) types its `Thir` as pending; it is this crate's `rustc_middle::thir::Thir`.
  return Ok([tcx.alloc_steal_thir(cx.thir as never) as unknown as Steal<Thir>, expr]);
}

/// Context for lowering HIR to THIR for a single function body (or other kind of body).
// rustc-type: compiler/rustc_mir_build/src/thir/cx/mod.rs:61 ThirBuildCx
export class ThirBuildCx {
  constructor(
    public tcx: TyCtxt,
    /// The THIR data that this context is building.
    public thir: Thir,
    public typing_env: TypingEnv,
    public typeck_results: TypeckResults,
    /// False to indicate that adjustments should not be applied. Only used for `custom_mir`
    public apply_adjustments: boolean,
    /// The `DefId` of the owner of this body.
    public body_owner: DefId,
  ) {}

  // rustc: compiler/rustc_mir_build/src/thir/cx/mod.rs:78 new
  static new(tcx: TyCtxt, def: LocalDefId): ThirBuildCx {
    const typeck_results = tcx.typeck(def) as TypeckResults;
    const hir_id = tcx.local_def_id_to_hir_id(def);

    let body_type: Thir["body_type"];
    const owner_kind = tcx.hir_body_owner_kind(def);
    switch (owner_kind.$) {
      case "Fn":
      case "Closure":
        // fetch the fully liberated fn signature (that is, all bound
        // types/lifetimes replaced)
        body_type = { $: "Fn", _0: typeck_results.liberated_fn_sigs().index(hir_id) };
        break;
      case "Const":
      case "Static":
        // Get the revealed type of this const. This is *not* the adjusted
        // type of its body, which may be a subtype of this type. For
        // example:
        //
        // fn foo(_: &()) {}
        // static X: fn(&'static ()) = foo;
        //
        // The adjusted type of the body of X is `for<'a> fn(&'a ())` which
        // is not the same as the type of X. We need the type of the return
        // place to be the type of the constant because NLL typeck will
        // equate them.
        body_type = { $: "Const", _0: typeck_results.node_type(hir_id) };
        break;
      case "GlobalAsm":
        body_type = { $: "GlobalAsm", _0: typeck_results.node_type(hir_id) };
        break;
    }

    return new ThirBuildCx(
      tcx,
      Thir.new(body_type),
      TypingEnv.post_typeck_until_borrowck_for_mir_build(tcx, def),
      typeck_results,
      !(find_attr(HasAttrs_HirId.get_attrs(hir_id, tcx), (k) => (k.$ === "CustomMir" ? true : undefined)) !== undefined),
      LocalDefId.to_def_id(def),
    );
  }

  // rustc: compiler/rustc_mir_build/src/thir/cx/mod.rs:117 pattern_from_hir
  pattern_from_hir(pat: HirPat): Pat {
    return this.pattern_from_hir_with_annotation(pat, undefined);
  }

  // rustc: compiler/rustc_mir_build/src/thir/cx/mod.rs:121 pattern_from_hir_with_annotation
  pattern_from_hir_with_annotation(pat: HirPat, let_stmt_type: HirTy | undefined): Pat {
    return pattern.pat_from_hir(this, this.tcx, this.typing_env, this.typeck_results, pat, let_stmt_type);
  }

  // rustc: compiler/rustc_mir_build/src/thir/cx/mod.rs:136 closure_env_param
  closure_env_param(owner_def: LocalDefId, expr_id: HirId): Param | undefined {
    if (this.tcx.def_kind(owner_def).$ !== "Closure") {
      return undefined;
    }

    const closure_ty = this.typeck_results.node_type(expr_id);
    const kind = closure_ty.kind();
    switch (kind.$) {
      case "Coroutine":
        return { ty: closure_ty, pat: undefined, ty_span: undefined, self_kind: undefined, hir_id: undefined };
      case "Closure": {
        const args = kind._1;
        const closure_env_ty = this.tcx.closure_env_ty(closure_ty, ClosureArgs.kind(args.as_closure()), this.tcx.lifetimes.re_erased);
        return {
          ty: closure_env_ty,
          pat: undefined,
          ty_span: undefined,
          self_kind: undefined,
          hir_id: undefined,
        };
      }
      case "CoroutineClosure": {
        const args = kind._1;
        const closure_env_ty = this.tcx.closure_env_ty(closure_ty, CoroutineClosureArgs.kind(args.as_coroutine_closure()), this.tcx.lifetimes.re_erased);
        return {
          ty: closure_env_ty,
          pat: undefined,
          ty_span: undefined,
          self_kind: undefined,
          hir_id: undefined,
        };
      }
      default:
        return bug(`unexpected closure type: ${display_Ty(closure_ty)}`);
    }
  }

  // PORT: `impl Iterator<Item = Param>` (a lazy `map` over `body.params` that borrows `self`) is a generator.
  // rustc: compiler/rustc_mir_build/src/thir/cx/mod.rs:178 explicit_params
  explicit_params(owner_id: HirId, fn_decl: FnDecl, body: Body): Iterable<Param> {
    const fn_sig = this.typeck_results.liberated_fn_sigs().index(owner_id);

    const self = this;
    return (function* (): Generator<Param> {
      for (let index = 0; index < body.params.length; index++) {
        const param = body.params[index]!;
        const input = fn_decl.inputs[index];
        // Make sure that inferred closure args have no type span
        const ty_span = input === undefined ? undefined : param.pat.span !== input.span ? input.span : undefined;

        const self_kind = index === 0 && ImplicitSelfKind.has_implicit_self(fn_decl.implicit_self()) ? fn_decl.implicit_self() : undefined;

        // C-variadic fns also have a `VaList` input that's not listed in `fn_sig`
        // (as it's created inside the body itself, not passed in from outside).
        let ty: Ty;
        if (fn_decl.c_variadic() && index === fn_decl.inputs.length) {
          const va_list_did = self.tcx.require_lang_item("VaList", param.span);

          ty = Unnormalized.skip_norm_wip(
            EarlyBinder.instantiate(self.tcx.type_of(va_list_did) as EarlyBinder<Ty>, self.tcx, [self.tcx.lifetimes.re_erased], fold_Ty),
          );
        } else {
          ty = FnSig.inputs(fn_sig)[index]!;
        }

        const pat: Pat = self.pattern_from_hir(param.pat);
        yield { pat, ty, ty_span, self_kind, hir_id: param.hir_id };
      }
    })();
  }

  // rustc: compiler/rustc_mir_build/src/thir/cx/mod.rs:217 user_args_applied_to_ty_of_hir_id
  user_args_applied_to_ty_of_hir_id(hir_id: HirId): CanonicalUserType | undefined {
    return util.user_args_applied_to_ty_of_hir_id(this.tcx, this.typeck_results, hir_id);
  }
}

/** PORT: `IndexVec::push` (rustc_index): appends `value` and returns its index (the `IndexVec` is `T[]`, PORTING §5). */
export function push_idx<I extends number, T>(vec: T[], value: T): I {
  const idx = vec.length as I;
  vec.push(value);
  return idx;
}
