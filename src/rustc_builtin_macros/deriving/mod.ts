// Port of compiler/rustc_builtin_macros/src/deriving/mod.rs
//! The compiler code necessary to implement the `#[derive]` extensions.

import { ast } from "../../rustc_ast/lib.ts";
import type { Annotatable, ExpandResult, ExtCtxt, MultiItemModifier } from "../../rustc_expand/base.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { Ident, kw, sym, type Symbol } from "../../rustc_span/symbol.ts";
import { unreachable } from "../../std/panic.ts";

// PORT: the decl macros `pathvec!($($rest)::+)` (`&[sym::$rest, ..]`) and
// `path_std!($cx, $span, $($x)*)` (`new_path($cx, $span, pathvec!($($x)*), vec![])`) have no fn of their
// own: `path_std!(cx, span, marker::Copy)` is written `path_std(cx, span, [sym.marker, sym.Copy])`.
export function path_std(cx: ExtCtxt, span: Span, path: readonly Symbol[]): ast.Path {
  return new_path(cx, span, path, []);
}

export * as clone from "./clone.ts";
export * as coerce_pointee from "./coerce_pointee.ts";
export * as const_param_ty from "./const_param_ty.ts";
export * as copy from "./copy.ts";
export * as debug from "./debug.ts";
export * as default from "./default.ts";
export * as eq from "./eq.ts";
export * as from from "./from.ts";
export * as hash from "./hash.ts";
export * as ord from "./ord.ts";
export * as partial_eq from "./partial_eq.ts";
export * as partial_ord from "./partial_ord.ts";
export * as reborrow from "./reborrow.ts";

export * as generic from "./generic/mod.ts";

// PORT: `&mut dyn FnMut(Box<ast::Item>)` -> a callback taking the item.
export type BuiltinDeriveFn = (cx: ExtCtxt, span: Span, item: ast.Item, push: (item: ast.Item) => void, is_const: boolean) => void;

export class BuiltinDerive implements MultiItemModifier {
  constructor(public _0: BuiltinDeriveFn) {}

  // rustc: compiler/rustc_builtin_macros/src/deriving/mod.rs:41 expand
  expand(
    ecx: ExtCtxt,
    span_: Span,
    _: ast.MetaItem,
    item: Annotatable,
    is_derive_const: boolean,
  ): ExpandResult<Annotatable[], Annotatable> {
    // FIXME: Built-in derives often forget to give spans contexts,
    // so we are doing it here in a centralized way.
    const span = ecx.with_def_site_ctxt(span_);
    const items: Annotatable[] = [];
    switch (item.$) {
      case "Stmt": {
        const stmt = item._0;
        if (stmt.kind.$ === "Item") {
          const item = stmt.kind._0;
          this._0(
            ecx,
            span,
            item,
            (a) => void items.push({ $: "Stmt", _0: ecx.stmt_item(span, a) }),
            is_derive_const,
          );
        } else {
          unreachable("internal error: entered unreachable code: should have already errored on non-item statement");
        }
        break;
      }
      case "Item": {
        const item_ = item._0;
        this._0(ecx, span, item_, (a) => void items.push({ $: "Item", _0: a }), is_derive_const);
        break;
      }
      default:
        unreachable();
    }
    return { $: "Ready", _0: items };
  }
}

/// Constructs an expression that calls an intrinsic
// rustc: compiler/rustc_builtin_macros/src/deriving/mod.rs:81 call_intrinsic
function call_intrinsic(cx: ExtCtxt, span_: Span, intrinsic: Symbol, args: ast.Expr[]): ast.Expr {
  const span = cx.with_def_site_ctxt(span_);
  const path = cx.std_path([sym.intrinsics, intrinsic]);
  return cx.expr_call_global(span, path, args);
}

/// Constructs an expression that calls the `discriminant_value` intrinsic.
// rustc: compiler/rustc_builtin_macros/src/deriving/mod.rs:93 call_discriminant_value
export function call_discriminant_value(cx: ExtCtxt, span: Span, arg: Symbol): ast.Expr {
  return call_intrinsic(cx, span, sym.discriminant_value, [cx.expr_ident_sym(span, arg)]);
}

/// Constructs an expression that calls the `unreachable` intrinsic.
// rustc: compiler/rustc_builtin_macros/src/deriving/mod.rs:98 call_unreachable
export function call_unreachable(cx: ExtCtxt, span: Span): ast.Expr {
  const call = call_intrinsic(cx, span, sym.unreachable, []);
  return cx.expr_block({
    stmts: [cx.stmt_expr(call)],
    id: ast.DUMMY_NODE_ID,
    rules: { $: "Unsafe", _0: ast.UnsafeSource.CompilerGenerated },
    span,
  });
}

// rustc: compiler/rustc_builtin_macros/src/deriving/mod.rs:108 assert_ty_bounds
export function assert_ty_bounds(cx: ExtCtxt, stmts: ast.Stmt[], ty: ast.Ty, span_: Span, assert_path_: readonly Symbol[]): void {
  // Generate statement `let _: assert_path<ty>;`.
  const span = cx.with_def_site_ctxt(span_);
  const assert_path = cx.path_all(span, true, cx.std_path(assert_path_), [{ $: "Type", _0: ty }]);
  stmts.push(cx.stmt_let_type_only(span, cx.ty_path(assert_path)));
}

// rustc: compiler/rustc_builtin_macros/src/deriving/mod.rs:121 new_path
export function new_path(cx: ExtCtxt, span: Span, path: readonly Symbol[], params_: ast.Ty[]): ast.Path {
  const idents_ = path.map((s) => Ident.new(s, span));
  const params: ast.GenericArg[] = params_.map((p) => ({ $: "Type", _0: p }));

  const idents = [Ident.new(kw.DollarCrate, span), ...idents_];
  return cx.path_all(span, false, idents, params);
}
