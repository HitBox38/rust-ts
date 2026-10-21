// Port of compiler/rustc_hir_typeck/src/gather_locals.rs (lane fnctxt-contract).
//
// `DeclOrigin` and `Declaration` are generated (gather_locals.gen.ts); `GatherLocalsVisitor` is a hand class
// (types.sets.json `hand`) extending rustc_hir intravisit's `Visitor`, its methods and associated fns are declared in
// decls.ts (`declare module "./gather_locals.ts"`).
// - `DeclOrigin::try_get_else` is on the companion (PORTING §8).
// - The two `impl From<..> for Declaration` are `Declaration_from_LetStmt` / `Declaration_from_LetExpr` (`x.into()` ->
//   the matching fn).
// - `debug!` is tracing only and stays as a comment.
// Init order: top-level code here touches only ./decls.ts, this file's .gen.ts and other crates.
import * as hir from "../rustc_hir/lib.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { fold_UserType, UserType } from "../rustc_middle/ty/typeck_results.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { DefId as DefIdC, LocalDefId as LocalDefIdC } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import type { FnCtxt } from "./decls.ts";
import * as gen from "./gather_locals.gen.ts";
import type { Declaration, DeclOrigin as DeclOriginT } from "./gather_locals.gen.ts";

export * from "./gather_locals.gen.ts";

/// Provides context for checking patterns in declarations. More specifically this
/// allows us to infer array types if the pattern is irrefutable and allows us to infer
/// the size of the array. See issue #76342.
export type DeclOrigin = DeclOriginT;
export const DeclOrigin = {
  ...gen.DeclOrigin,

  // impl<'a> DeclOrigin<'a> {
  // rustc: compiler/rustc_hir_typeck/src/gather_locals.rs:24 try_get_else
  try_get_else(self_: DeclOriginT): hir.Block | undefined {
    switch (self_.$) {
      case "LocalDecl":
        return self_.els;
      case "LetExpr":
        return undefined;
    }
  },
};

// impl<'a> From<&'a hir::LetStmt<'a>> for Declaration<'a>
// rustc: compiler/rustc_hir_typeck/src/gather_locals.rs:45 from
export function Declaration_from_LetStmt(local: hir.LetStmt): Declaration {
  const { hir_id, super_: _, pat, ty, span, init, els, source: _source } = local;
  return { hir_id, pat, ty, span, init, origin: { $: "LocalDecl", els } };
}

// impl<'a> From<(&'a hir::LetExpr<'a>, HirId)> for Declaration<'a>
// rustc: compiler/rustc_hir_typeck/src/gather_locals.rs:52 from
export function Declaration_from_LetExpr([let_expr, hir_id]: [hir.LetExpr, HirId]): Declaration {
  const { pat, ty, span, init, recovered: _ } = let_expr;
  return { hir_id, pat, ty, span, init, origin: gen.DeclOrigin.LetExpr };
}

// rustc-type: compiler/rustc_hir_typeck/src/gather_locals.rs:66 GatherLocalsVisitor
/// The `GatherLocalsVisitor` is responsible for initializing local variable types
/// in the [`ty::TypeckResults`] for all subpatterns in statements and expressions
/// like `let`, `match`, and params of function bodies. It also adds `Sized` bounds
/// for these types (with exceptions for unsized feature gates like `unsized_fn_params`).
///
/// Failure to visit locals will cause an ICE in writeback when the local's type is
/// resolved. Visiting locals twice will ICE in the `GatherLocalsVisitor`, since it
/// will overwrite the type previously stored in the local.
// PORT: hand class (types.sets.json `hand`): `impl Visitor for GatherLocalsVisitor` overrides intravisit's defaults
// (the four methods in the class body, gather_locals.rs:168..240).
export class GatherLocalsVisitor extends hir.intravisit.Visitor {
  constructor(
    public fcx: FnCtxt,
    // parameters are special cases of patterns, but we want to handle them as
    // *distinct* cases. so track when we are hitting a pattern *within* an fn
    // parameter.
    public outermost_fn_param_pat: [Span, HirId] | undefined,
  ) {
    super();
  }

  // ---- impl<'a, 'tcx> Visitor<'tcx> for GatherLocalsVisitor<'a, 'tcx> ----

  // Add explicitly-declared locals.
  // rustc: compiler/rustc_hir_typeck/src/gather_locals.rs:170 visit_local
  override visit_local(local: hir.LetStmt): undefined {
    this.declare(Declaration_from_LetStmt(local));
    return hir.intravisit.walk_local(this, local);
  }

  // rustc: compiler/rustc_hir_typeck/src/gather_locals.rs:175 visit_expr
  override visit_expr(expr: hir.Expr): undefined {
    if (expr.kind.$ === "Let") {
      const let_expr = expr.kind._0;
      this.declare(Declaration_from_LetExpr([let_expr, expr.hir_id]));
    }
    return hir.intravisit.walk_expr(this, expr);
  }

  // Add pattern bindings.
  // rustc: compiler/rustc_hir_typeck/src/gather_locals.rs:183 visit_pat
  override visit_pat(p: hir.Pat): undefined {
    if (p.kind.$ === "Binding") {
      const ident = p.kind._2;
      const var_ty = this.assign(p.span, p.hir_id, undefined);

      if (this.outermost_fn_param_pat !== undefined) {
        const [ty_span, hir_id] = this.outermost_fn_param_pat;
        if (!this.fcx.tcx.features().unsized_fn_params()) {
          this.fcx.require_type_is_sized(
            var_ty,
            ty_span,
            // ty_span == ident.span iff this is a closure parameter with no type
            // ascription, or if it's an implicit `self` parameter
            {
              $: "SizedArgumentType",
              _0: ty_span === ident.span && this.fcx.tcx.is_closure_like(LocalDefIdC.to_def_id(this.fcx.body_def_id)) ? undefined : hir_id,
            },
          );
        }
      } else {
        this.fcx.require_type_is_sized(var_ty, p.span, { $: "VariableType", _0: p.hir_id });
      }

      // debug!(
      //     "pattern binding {} is assigned to {} with type {:?}",
      //     ident,
      //     self.fcx.ty_to_string(*self.fcx.locals.borrow().get(&p.hir_id).unwrap()),
      //     var_ty
      // );
    }
    const old_outermost_fn_param_pat = this.outermost_fn_param_pat;
    this.outermost_fn_param_pat = undefined;
    if (p.kind.$ === "Guard") {
      const subpat = p.kind._0;
      // We'll visit the guard when checking it. Don't gather its locals twice.
      this.visit_pat(subpat);
    } else {
      hir.intravisit.walk_pat(this, p);
    }
    this.outermost_fn_param_pat = old_outermost_fn_param_pat;
    return undefined;
  }

  // Don't descend into the bodies of nested closures.
  // rustc: compiler/rustc_hir_typeck/src/gather_locals.rs:231 visit_fn
  override visit_fn(_0: hir.intravisit.FnKind, _1: hir.FnDecl, _2: hir.BodyId, _3: Span, _4: LocalDefId): undefined {
    return undefined;
  }
}

// N.B. additional `gather_*` functions should be careful to only walk the pattern
// for new expressions, since visiting sub-expressions or nested bodies may initialize
// locals which are not conceptually owned by the gathered statement or expression.
// impl<'a, 'tcx> GatherLocalsVisitor<'a, 'tcx> {
type GatherLocalsVisitorStatics = {
  gather_from_local: typeof GatherLocalsVisitor.gather_from_local;
  gather_from_let_expr: typeof GatherLocalsVisitor.gather_from_let_expr;
  gather_from_param: typeof GatherLocalsVisitor.gather_from_param;
  gather_from_arm: typeof GatherLocalsVisitor.gather_from_arm;
};

// rustc: compiler/rustc_hir_typeck/src/gather_locals.rs:78 gather_from_local
(GatherLocalsVisitor as unknown as GatherLocalsVisitorStatics).gather_from_local = function (fcx: FnCtxt, local: hir.LetStmt): void {
  const visitor = new GatherLocalsVisitor(fcx, undefined);
  visitor.declare(Declaration_from_LetStmt(local));
  visitor.visit_pat(local.pat);
};

// rustc: compiler/rustc_hir_typeck/src/gather_locals.rs:84 gather_from_let_expr
(GatherLocalsVisitor as unknown as GatherLocalsVisitorStatics).gather_from_let_expr = function (fcx: FnCtxt, let_expr: hir.LetExpr, expr_hir_id: HirId): void {
  const visitor = new GatherLocalsVisitor(fcx, undefined);
  visitor.declare(Declaration_from_LetExpr([let_expr, expr_hir_id]));
  visitor.visit_pat(let_expr.pat);
};

// rustc: compiler/rustc_hir_typeck/src/gather_locals.rs:94 gather_from_param
(GatherLocalsVisitor as unknown as GatherLocalsVisitorStatics).gather_from_param = function (fcx: FnCtxt, param: hir.Param): void {
  const visitor = new GatherLocalsVisitor(fcx, [param.ty_span, param.hir_id]);
  visitor.visit_pat(param.pat);
};

// rustc: compiler/rustc_hir_typeck/src/gather_locals.rs:102 gather_from_arm
(GatherLocalsVisitor as unknown as GatherLocalsVisitorStatics).gather_from_arm = function (fcx: FnCtxt, local: hir.Arm): void {
  const visitor = new GatherLocalsVisitor(fcx, undefined);
  visitor.visit_pat(local.pat);
};

// rustc: compiler/rustc_hir_typeck/src/gather_locals.rs:107 assign
GatherLocalsVisitor.prototype.assign = function (this: GatherLocalsVisitor, span: Span, nid: HirId, ty_opt: Ty | undefined): Ty {
  // We evaluate expressions twice occasionally in diagnostics for better
  // type information or because it needs type information out-of-order.
  // In order to not ICE and not lead to knock-on ambiguity errors, if we
  // try to re-assign a type to a local, then just take out the previous
  // type and delay a bug.
  const local = this.fcx.locals.get(nid);
  if (local !== undefined) {
    this.fcx.dcx().span_delayed_bug(span, "evaluated expression more than once");
    return local;
  }

  if (ty_opt === undefined) {
    // Infer the variable's type.
    const var_ty = this.fcx.next_ty_var(span);
    this.fcx.locals.set(nid, var_ty);
    return var_ty;
  } else {
    const typ = ty_opt;
    // Take type that the user specified.
    this.fcx.locals.set(nid, typ);
    return typ;
  }
};

/// Allocates a type for a declaration, which may have a type annotation. If it does have
/// a type annotation, then the [`Ty`] stored will be the resolved type. This may be found
/// again during type checking by querying [`FnCtxt::local_ty`] for the same hir_id.
// rustc: compiler/rustc_hir_typeck/src/gather_locals.rs:136 declare
GatherLocalsVisitor.prototype.declare = function (this: GatherLocalsVisitor, decl: Declaration): void {
  let local_ty: Ty | undefined;
  if (decl.ty !== undefined) {
    const ty = decl.ty;
    const o_ty = this.fcx.lower_ty(ty);

    const c_ty = this.fcx.infcx.canonicalize_user_type_annotation(
      UserType.new_with_bounds({ $: "Ty", _0: o_ty.raw }, this.fcx.collect_impl_trait_clauses_from_hir_ty(ty)),
      fold_UserType,
    );
    // debug!("visit_local: ty.hir_id={:?} o_ty={:?} c_ty={:?}", ty.hir_id, o_ty, c_ty);
    this.fcx.typeck_results.user_provided_types_mut().insert(ty.hir_id, c_ty);

    local_ty = o_ty.normalized;
  } else {
    local_ty = undefined;
  }
  this.assign(decl.span, decl.hir_id, local_ty);

  // debug!(
  //     "local variable {:?} is assigned type {}",
  //     decl.pat,
  //     self.fcx.ty_to_string(*self.fcx.locals.borrow().get(&decl.hir_id).unwrap())
  // );
};

void DefIdC;
