// Port of compiler/rustc_builtin_macros/src/deriving/partial_eq.rs
import type { ExtCtxt } from "../../rustc_expand/base.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { Ident, kw, sym } from "../../rustc_span/symbol.ts";
import { unwrap } from "../../std/panic.ts";
import { ast, BlockOrExpr, combine_substructure, type FieldInfo, MethodDef, type Substructure, TraitDef } from "./generic/mod.ts";
import { call_discriminant_value, path_std } from "./mod.ts";

/// Expands a `#[derive(PartialEq)]` attribute into an implementation for the
/// target item.
// rustc: compiler/rustc_builtin_macros/src/deriving/partial_eq.rs:11 expand_deriving_partial_eq
export function expand_deriving_partial_eq(
  cx: ExtCtxt,
  span: Span,
  item: ast.Item,
  push: (item: ast.Item) => void,
  is_const: boolean,
): void {
  const structural_trait_def = new TraitDef(
    span,
    path_std(cx, span, [sym.marker, sym.StructuralPartialEq]),
    true, // crucial!
    false,
    // The `StructuralPartialEq` impl must have the *same* bounds as the `PartialEq` impl,
    // or it will apply in situations where it should not, such as in the bug
    // <https://github.com/rust-lang/rust/issues/147714>.
    [path_std(cx, span, [sym.cmp, sym.PartialEq])],
    // We really don't support unions, but that's already checked by the impl generated below;
    // a second check here would lead to redundant error messages.
    true,
    [],
    false,
    ast.Safety.Default,
    true,
  );
  structural_trait_def.expand(cx, item, push);

  // No need to generate `ne`, the default suffices, and not generating it is
  // faster.
  const methods = [
    new MethodDef(
      sym.eq,
      cx.empty_generics(span),
      true,
      [[cx.ty_self_ref(span), sym.other]],
      true,
      cx.ty_path(cx.path_ident(span, Ident.new(sym.bool, span))),
      [cx.attr_word(sym.inline, span)],
      "Unify",
      combine_substructure(get_substructure_equality_expr),
    ),
  ];

  const trait_def = new TraitDef(
    span,
    path_std(cx, span, [sym.cmp, sym.PartialEq]),
    false,
    true,
    [],
    false,
    methods,
    is_const,
    ast.Safety.Default,
    true,
  );
  trait_def.expand(cx, item, push);
}

/// Generates the equality expression for a struct or enum variant when deriving
/// `PartialEq`.
///
/// This function generates an expression that checks if all fields of a struct
/// or enum variant are equal.
/// - Scalar fields are compared first for efficiency, followed by compound
///   fields.
/// - If there are no fields, returns `true` (fieldless types are always equal).
///
/// Whether a field is considered "scalar" is determined by comparing the symbol
/// of its type to a set of known scalar type symbols (e.g., `i32`, `u8`, etc).
/// This check is based on the type's symbol.
///
/// ### Example 1
/// ```
/// #[derive(PartialEq)]
/// struct i32;
///
/// // Here, `field_2` is of type `i32`, but since it's a user-defined type (not
/// // the primitive), it will not be treated as scalar. The function will still
/// // check equality of `field_2` first because the symbol matches `i32`.
/// #[derive(PartialEq)]
/// struct Struct {
///     field_1: &'static str,
///     field_2: i32,
/// }
/// ```
///
/// ### Example 2
/// ```
/// mod ty {
///     pub type i32 = i32;
/// }
///
/// // Here, `field_2` is of type `ty::i32`, which is a type alias for `i32`.
/// // However, the function will not reorder the fields because the symbol for
/// // `ty::i32` does not match the symbol for the primitive `i32`
/// // ("ty::i32" != "i32").
/// #[derive(PartialEq)]
/// struct Struct {
///     field_1: &'static str,
///     field_2: ty::i32,
/// }
/// ```
///
/// For enums, the discriminant is compared first, then the rest of the fields.
///
/// # Panics
///
/// If called on static or all-fieldless enums/structs, which should not occur
/// during derive expansion.
// rustc: compiler/rustc_builtin_macros/src/deriving/partial_eq.rs:117 get_substructure_equality_expr
function get_substructure_equality_expr(cx: ExtCtxt, span: Span, substructure: Substructure): BlockOrExpr {
  let expr: ast.Expr;
  const fields_ = substructure.fields;
  switch (fields_.$) {
    case "EnumMatching":
    case "Struct": {
      const fields = fields_._1;
      const combine = (acc: ast.Expr | undefined, field: FieldInfo): ast.Expr | undefined => {
        const rhs_ = unwrap(field.other_selflike_expr, "not exactly 2 arguments in `derive(PartialEq)`");

        const rhs = cx.expr_binary(field.span, "Eq", wrap_block_expr(cx, peel_refs(field.self_expr)), wrap_block_expr(cx, peel_refs(rhs_)));
        if (acc !== undefined) {
          // Combine the previous comparison with the current field
          // using logical AND.
          return cx.expr_binary(field.span, "And", acc, rhs);
        } else {
          // Start the chain with the first field's comparison.
          return rhs;
        }
      };

      // First compare scalar fields, then compound fields, combining all
      // with logical AND.
      const r = [...fields.filter((field) => field.maybe_scalar), ...fields.filter((field) => !field.maybe_scalar)].reduce(combine, undefined);
      // If there are no fields, treat as always equal.
      expr = r !== undefined ? r : cx.expr_bool(span, true);
      break;
    }
    case "EnumDiscr": {
      const match_expr = fields_._0;
      const self_expr = call_discriminant_value(cx, span, kw.SelfLower);
      const other_selflike_expr = call_discriminant_value(cx, span, sym.other);
      const lhs = cx.expr_binary(span, "Eq", self_expr, other_selflike_expr);
      if (match_expr === undefined) {
        return BlockOrExpr.new_expr(lhs);
      }
      // Compare the discriminant first (cheaper), then the rest of the
      // fields.
      expr = cx.expr_binary(span, "And", lhs, match_expr);
      break;
    }
    default:
      return cx.dcx().span_bug(span, "unexpected substructure in `derive(PartialEq)`");
  }
  return BlockOrExpr.new_expr(expr);
}

/// Removes all leading immutable references from an expression.
///
/// This is used to strip away any number of leading `&` from an expression
/// (e.g., `&&&T` becomes `T`). Only removes immutable references; mutable
/// references are preserved.
// rustc: compiler/rustc_builtin_macros/src/deriving/partial_eq.rs:175 peel_refs
function peel_refs(expr: ast.Expr): ast.Expr {
  while (expr.kind.$ === "AddrOf" && expr.kind._0 === "Ref" && expr.kind._1 === "Not") {
    expr = expr.kind._2;
  }
  return ast.clone_Expr(expr);
}

/// Wraps a block expression in parentheses to ensure valid AST in macro
/// expansion output.
///
/// If the given expression is a block, it is wrapped in parentheses; otherwise,
/// it is returned unchanged.
// rustc: compiler/rustc_builtin_macros/src/deriving/partial_eq.rs:187 wrap_block_expr
function wrap_block_expr(cx: ExtCtxt, expr: ast.Expr): ast.Expr {
  if (expr.kind.$ === "Block") {
    return cx.expr_paren(expr.span, expr);
  }
  return expr;
}
