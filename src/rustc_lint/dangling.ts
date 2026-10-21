// Port of compiler/rustc_lint/src/dangling.rs. The lint statics and the `impl_lint_pass!` expansion are generated
// (dangling.lints.gen.ts).
// PORT: `cx.typeck_results()` is `cx.typeck_results_()`, and `LateContext::qpath_res` / `typing_env` return `unknown`
// until context.rs's `LateContext` is ported: their results are cast here.
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import type { Res } from "../rustc_hir/def.ts";
import { type FnKind, Visitor, walk_expr } from "../rustc_hir/intravisit.ts";
import type * as hir from "../rustc_hir/lib.ts";
import { HirId_eq } from "../rustc_hir_id/lib.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { ClosureArgs } from "../rustc_type_ir/ty_kind/closure.ts";
import { HasAttrs_DefId, type Ty, type TypingEnv } from "../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { sym } from "../rustc_span/symbol.ts";
import { EarlyBinder, type Binder } from "../rustc_type_ir/binder.ts";
import { type FnSig, PolyFnSig } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import type { LateContext } from "./context.ts";
import { DanglingPointers_impl_lint_pass, DANGLING_POINTERS_FROM_LOCALS, DANGLING_POINTERS_FROM_TEMPORARIES } from "./dangling.lints.gen.ts";
import { DanglingPointersFromLocals_diagnostic, DanglingPointersFromTemporaries_diagnostic } from "./diagnostics.gen.ts";
import type { LateLintPass } from "./passes.ts";
import { peel_casts } from "./utils.ts";

export * from "./dangling.lints.gen.ts";

// #[derive(Clone, Copy, Default)]
// pub(crate) struct DanglingPointers;
export class DanglingPointers implements LintPass, LateLintPass {
  name(): string {
    return DanglingPointers_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return DanglingPointers_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return DanglingPointers_impl_lint_pass.lint_vec();
  }

  // This skips over const blocks, but they cannot use or return a dangling pointer anyways.
  // impl<'tcx> LateLintPass<'tcx> for DanglingPointers
  // rustc: compiler/rustc_lint/src/dangling.rs:92 check_fn
  check_fn(cx: LateContext, fn_kind: FnKind, fn_decl: hir.FnDecl, body: hir.Body, _: Span, def_id: LocalDefId): void {
    new DanglingPointerSearcher(cx, false).visit_body(body);

    if (fn_decl.output.$ === "Return" && fn_decl.output._0.kind.$ === "Ptr") {
      const ret_ty = fn_decl.output._0;
      // get the return type of the function or closure
      const k = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(cx.tcx.type_of(def_id) as EarlyBinder<Ty>)).kind();
      let ty_: Binder<FnSig>;
      if (k.$ === "FnDef") {
        ty_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(cx.tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>));
      } else if (k.$ === "Closure") {
        ty_ = ClosureArgs.sig(k._1.as_closure());
      } else {
        return;
      }
      const ty_out = PolyFnSig.output(ty_);

      // this type is only used for layout computation and pretty-printing, neither of them rely on regions
      const ty = cx.tcx.instantiate_bound_regions_with_erased(ty_out, fold_Ty);

      // verify that we have a pointer type
      const tk = ty.kind();
      let inner_ty: Ty;
      if (tk.$ === "RawPtr") {
        inner_ty = tk._0;
      } else {
        return;
      }

      const l = cx.tcx.layout_of((cx.typing_env() as TypingEnv).as_query_input(inner_ty));
      if (l.$ === "Ok" && !l._0.is_1zst()) {
        const dcx: DanglingPointerLocalContext = {
          body: def_id,
          fn_ret: ty,
          fn_ret_span: ret_ty.span,
          fn_ret_inner: inner_ty,
          fn_kind: fn_kind.$ === "ItemFn" ? "function" : fn_kind.$ === "Method" ? "method" : "closure",
        };

        // look for `return`s
        new DanglingPointerReturnSearcher(cx, dcx).visit_body(body);

        // analyze implicit return expression
        if (body.value.kind.$ === "Block" && body.value.kind._1 === undefined) {
          const block = body.value.kind._0;
          const innermost_block = block.innermost_block();
          const expr = innermost_block.expr;
          if (expr !== undefined) {
            lint_addr_of_local(cx, dcx, expr);
          }
        }
      }
    }
  }
}

interface DanglingPointerLocalContext {
  body: LocalDefId;
  fn_ret: Ty;
  fn_ret_span: Span;
  fn_ret_inner: Ty;
  fn_kind: string;
}

// struct DanglingPointerReturnSearcher<'lcx, 'tcx>
class DanglingPointerReturnSearcher extends Visitor {
  constructor(
    public cx: LateContext,
    public dcx: DanglingPointerLocalContext,
  ) {
    super();
  }

  // impl<'tcx> Visitor<'tcx> for DanglingPointerReturnSearcher<'_, 'tcx>
  // rustc: compiler/rustc_lint/src/dangling.rs:169 visit_expr
  override visit_expr(expr: hir.Expr): undefined {
    if (expr.kind.$ === "Ret" && expr.kind._0 !== undefined) {
      lint_addr_of_local(this.cx, this.dcx, expr.kind._0);
    }
    return walk_expr(this, expr);
  }
}

/// Look for `&<path_to_local_in_same_body>` pattern and emit lint for it
// rustc: compiler/rustc_lint/src/dangling.rs:178 lint_addr_of_local
function lint_addr_of_local(cx: LateContext, dcx: DanglingPointerLocalContext, expr: hir.Expr): void {
  // peel casts as they do not interest us here, we want the inner expression.
  const inner: hir.Expr = peel_casts(cx, expr);

  let inner_of: hir.Expr;
  let peeled: hir.ExprKind;
  let res: Res;
  if (
    inner.kind.$ === "AddrOf" &&
    (peeled = (inner_of = inner.kind._2).peel_blocks().kind).$ === "Path" &&
    (res = cx.qpath_res(peeled._0, inner_of.hir_id) as Res).$ === "Local" &&
    cx.tcx.hir_enclosing_body_owner(res._0) === dcx.body
  ) {
    const from = res._0;
    cx.tcx.emit_node_span_lint(
      DANGLING_POINTERS_FROM_LOCALS,
      expr.hir_id,
      expr.span,
      DanglingPointersFromLocals_diagnostic({
        ret_ty: dcx.fn_ret,
        ret_ty_span: dcx.fn_ret_span,
        fn_kind: dcx.fn_kind,
        local_var: cx.tcx.hir_span(from),
        local_var_name: cx.tcx.hir_ident(from),
        local_var_ty: dcx.fn_ret_inner,
        created_at: !HirId_eq(expr.hir_id, inner.hir_id) ? inner.span : undefined,
      }),
    );
  }
}

/// This produces a dangling pointer:
/// ```ignore (example)
/// let ptr = CString::new("hello").unwrap().as_ptr();
/// foo(ptr)
/// ```
///
/// But this does not:
/// ```ignore (example)
/// foo(CString::new("hello").unwrap().as_ptr())
/// ```
///
/// But this does:
/// ```ignore (example)
/// foo({ let ptr = CString::new("hello").unwrap().as_ptr(); ptr })
/// ```
///
/// So we have to keep track of when we are inside of a function/method call argument.
class DanglingPointerSearcher extends Visitor {
  constructor(
    public cx: LateContext,
    /// Keeps track of whether we are inside of function/method call arguments,
    /// where this lint should not be emitted.
    ///
    /// See [the main doc][`Self`] for examples.
    public inside_call_args: boolean,
  ) {
    super();
  }

  // impl Visitor<'_> for DanglingPointerSearcher<'_, '_>
  // rustc: compiler/rustc_lint/src/dangling.rs:235 visit_expr
  override visit_expr(expr: hir.Expr): undefined {
    if (!this.inside_call_args) {
      lint_expr(this.cx, expr);
    }
    const k = expr.kind;
    if (k.$ === "Call" || k.$ === "MethodCall") {
      const [lhs, args] = k.$ === "Call" ? [k._0, k._1] : [k._1, k._2];
      this.visit_expr(lhs);
      this.with_inside_call_args(true, (this_) => {
        for (const a of args) this_.visit_expr(a);
      });
    } else if (k.$ === "Block") {
      const { stmts, expr: e } = k._0;
      this.with_inside_call_args(false, (this_) => {
        for (const s of stmts) this_.visit_stmt(s);
      });
      if (e !== undefined) this.visit_expr(e);
    } else {
      walk_expr(this, expr);
    }
  }

  // impl DanglingPointerSearcher<'_, '_>
  // rustc: compiler/rustc_lint/src/dangling.rs:254 with_inside_call_args
  with_inside_call_args<R>(inside_call_args: boolean, callback: (this_: DanglingPointerSearcher) => R): R {
    const old = this.inside_call_args;
    this.inside_call_args = inside_call_args;
    const result = callback(this);
    this.inside_call_args = old;
    return result;
  }
}

// rustc: compiler/rustc_lint/src/dangling.rs:266 lint_expr
function lint_expr(cx: LateContext, expr: hir.Expr): void {
  if (expr.kind.$ !== "MethodCall") return;
  const method = expr.kind._0;
  const receiver = expr.kind._1;
  if (!is_temporary_rvalue(receiver)) return;
  const ty = (cx.typeck_results_() as TypeckResults).expr_ty(receiver);
  if (!owns_allocation(cx.tcx, ty)) return;
  const fn_id = (cx.typeck_results_() as TypeckResults).type_dependent_def_id(expr.hir_id);
  if (fn_id !== undefined && find_attr(HasAttrs_DefId.get_attrs(fn_id, cx.tcx), (k) => (k.$ === "RustcAsPtr" ? null : undefined)) !== undefined) {
    cx.tcx.emit_node_span_lint(
      DANGLING_POINTERS_FROM_TEMPORARIES,
      expr.hir_id,
      method.ident.span,
      DanglingPointersFromTemporaries_diagnostic({
        callee: method.ident,
        ty,
        ptr_span: method.ident.span,
        temporary_span: receiver.span,
      }),
    );
  }
}

// rustc: compiler/rustc_lint/src/dangling.rs:288 is_temporary_rvalue
function is_temporary_rvalue(expr: hir.Expr): boolean {
  switch (expr.kind.$) {
    // Const is not temporary.
    case "ConstBlock":
    case "Repeat":
    case "Lit":
      return false;

    // This is literally lvalue.
    case "Path":
      return false;

    // Calls return rvalues.
    case "Call":
    case "MethodCall":
    case "Use":
    case "Binary":
      return true;

    // Inner blocks are rvalues.
    case "If":
    case "Loop":
    case "Match":
    case "Block":
      return true;

    // FIXME: these should probably recurse and typecheck along the way.
    //        Some false negatives are possible for now.
    case "Index":
    case "Field":
    case "Unary":
      return false;

    case "Struct":
      return true;

    // FIXME: this has false negatives, but I do not want to deal with 'static/const promotion just yet.
    case "Array":
      return false;

    // These typecheck to `!`
    case "Break":
    case "Continue":
    case "Ret":
    case "Become":
      return false;

    // These typecheck to `()`
    case "Assign":
    case "AssignOp":
    case "Yield":
      return false;

    // Compiler-magic macros
    case "AddrOf":
    case "OffsetOf":
    case "InlineAsm":
      return false;

    // We are not interested in these
    case "Cast":
    case "Closure":
    case "Tup":
    case "DropTemps":
    case "Let":
      return false;

    case "UnsafeBinderCast":
      return false;

    // Not applicable
    case "Type":
    case "Err":
      return false;
  }
}

// Array, Vec, String, CString, MaybeUninit, Cell, Box<[_]>, Box<str>, Box<CStr>, UnsafeCell,
// SyncUnsafeCell, or any of the above in arbitrary many nested Box'es.
// rustc: compiler/rustc_lint/src/dangling.rs:341 owns_allocation
function owns_allocation(tcx: TyCtxt, ty: Ty): boolean {
  let inner: Ty | undefined;
  let def;
  if (ty.is_array()) {
    return true;
  } else if ((inner = ty.boxed_ty()) !== undefined) {
    const inner_def = inner.ty_adt_def();
    return (
      inner.is_slice() ||
      inner.is_str() ||
      (inner_def !== undefined && tcx.is_lang_item(inner_def.did(), LangItem.CStr)) ||
      owns_allocation(tcx, inner)
    );
  } else if ((def = ty.ty_adt_def()) !== undefined) {
    for (const lang_item of [LangItem.String, LangItem.MaybeUninit, LangItem.UnsafeCell]) {
      if (tcx.is_lang_item(def.did(), lang_item)) {
        return true;
      }
    }
    const name = tcx.get_diagnostic_name(def.did());
    return name !== undefined && (name === sym.cstring_type || name === sym.Vec || name === sym.Cell || name === sym.SyncUnsafeCell);
  } else {
    return false;
  }
}
