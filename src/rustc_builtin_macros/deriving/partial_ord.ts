// Port of compiler/rustc_builtin_macros/src/deriving/partial_ord.rs
import type { ExtCtxt } from "../../rustc_expand/base.ts";
import { LocalExpnId } from "../../rustc_span/hygiene.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { Ident, kw, sym } from "../../rustc_span/symbol.ts";
import { unwrap } from "../../std/panic.ts";
import { ast, BlockOrExpr, combine_substructure, type FieldInfo, MethodDef, type Substructure, TraitDef } from "./generic/mod.ts";
import { call_discriminant_value, new_path, path_std } from "./mod.ts";

// rustc: compiler/rustc_builtin_macros/src/deriving/partial_ord.rs:9 expand_deriving_partial_ord
export function expand_deriving_partial_ord(
  cx: ExtCtxt,
  span: Span,
  item: ast.Item,
  push: (item: ast.Item) => void,
  is_const: boolean,
): void {
  const ordering_ty = cx.ty_path(path_std(cx, span, [sym.cmp, sym.Ordering]));
  const ret_ty = cx.ty_path(new_path(cx, span, [sym.option, sym.Option], [ordering_ty]));

  // Order in which to perform matching
  const discr_then_data = discr_data_order(item);

  const container_id = LocalExpnId.expn_data(cx.current_expansion.id).parent.expect_local();
  const has_derive_ord = cx.resolver.has_derive_ord(container_id);
  const default_substructure = combine_substructure((cx, span, substr) => cs_partial_cmp(cx, span, substr, discr_then_data));
  const simple_substructure = combine_substructure((cx, span, _) => cs_partial_cmp_simple(cx, span, cx.expr_ident_sym(span, sym.other)));
  let is_simple: boolean;
  const kind = item.kind;
  if (kind.$ === "Struct" && kind._2.$ === "Unit") {
    // For unit structs/zero-variant enums, the default generated code is better.
    is_simple = false;
  } else if (kind.$ === "Enum" && kind._2.variants.length === 0) {
    // Also for single fieldless variant enum
    is_simple = false;
  } else if (kind.$ === "Enum" && kind._2.variants.length === 1 && kind._2.variants[0]!.data.$ === "Unit") {
    is_simple = false;
  } else if ((kind.$ === "Struct" || kind.$ === "Enum") && has_derive_ord && !kind._1.params.some((param) => param.kind.$ === "Type")) {
    is_simple = true;
  } else {
    is_simple = false;
  }

  const partial_cmp_def = new MethodDef(
    sym.partial_cmp,
    cx.empty_generics(span),
    true,
    [[cx.ty_self_ref(span), sym.other]],
    true,
    ret_ty,
    [cx.attr_word(sym.inline, span)],
    "Unify",
    is_simple ? simple_substructure : default_substructure,
  );

  const trait_def = new TraitDef(
    span,
    path_std(cx, span, [sym.cmp, sym.PartialOrd]),
    false,
    true,
    [],
    false,
    [partial_cmp_def],
    is_const,
    ast.Safety.Default,
    true,
  );
  trait_def.expand_ext(cx, item, push, is_simple);
}

// rustc: compiler/rustc_builtin_macros/src/deriving/partial_ord.rs:79 discr_data_order
export function discr_data_order(item: ast.Item): boolean {
  if (item.kind.$ === "Enum") {
    const def = item.kind._2;
    const dataful: boolean[] = def.variants.map((v) => ast.VariantData.fields(v.data).length !== 0);
    const count = dataful.filter((b) => b).length;
    if (count === 0) {
      // No data, placing the discriminant check first makes codegen simpler
      return true;
    } else if (count >= 1 && count <= 2) {
      return false;
    } else {
      for (let i = 0; i < dataful.length - 1; i++) {
        let r: boolean;
        let idx: number;
        if (dataful[i]! && (idx = dataful.slice(i + 1).findIndex((v) => v)) !== -1) {
          r = idx >= 2;
        } else {
          r = false;
        }
        if (r) return true;
      }
      return false;
    }
  } else {
    return true;
  }
}

// Special case for the type deriving both `PartialOrd` and `Ord`. Builds:
// ```
// Some(::core::cmp::Ord::cmp(self, other))
// ```
// rustc: compiler/rustc_builtin_macros/src/deriving/partial_ord.rs:105 cs_partial_cmp_simple
function cs_partial_cmp_simple(cx: ExtCtxt, span: Span, other_expr: ast.Expr): BlockOrExpr {
  const ord_cmp_path = cx.std_path([sym.cmp, sym.Ord, sym.cmp]);
  const cmp_expr = cx.expr_call_global(span, ord_cmp_path, [cx.expr_self(span), other_expr]);
  return BlockOrExpr.new_expr(cx.expr_some(span, cmp_expr));
}

// rustc: compiler/rustc_builtin_macros/src/deriving/partial_ord.rs:112 cs_partial_cmp
function cs_partial_cmp(cx: ExtCtxt, span: Span, substr: Substructure, discr_then_data: boolean): BlockOrExpr {
  // Builds:
  //
  // match ::core::cmp::PartialOrd::partial_cmp(&self.x, &other.x) {
  //     ::core::option::Option::Some(::core::cmp::Ordering::Equal) =>
  //         ::core::cmp::PartialOrd::partial_cmp(&self.y, &other.y),
  //     cmp => cmp,
  // }
  const expr = cmp_body(cx, span, substr, discr_then_data, OrdlikeDerive.PartialOrd);
  return BlockOrExpr.new_expr(expr);
}

export type OrdlikeDerive = "PartialOrd" | "Ord";
export const OrdlikeDerive = { PartialOrd: "PartialOrd", Ord: "Ord" } as const;

// rustc: compiler/rustc_builtin_macros/src/deriving/partial_ord.rs:135 cmp_body
export function cmp_body(cx: ExtCtxt, span: Span, substructure: Substructure, discr_then_data: boolean, derive: OrdlikeDerive): ast.Expr {
  const is_partial_ord = derive === OrdlikeDerive.PartialOrd;
  const method_path = is_partial_ord ? cx.std_path([sym.cmp, sym.PartialOrd, sym.partial_cmp]) : cx.std_path([sym.cmp, sym.Ord, sym.cmp]);
  const equal_path = cx.path_global(span, cx.std_path([sym.cmp, sym.Ordering, sym.Equal]));

  // The combination of two field expressions. E.g. for `Ord::cmp` this
  // is something like `<field1 comparison> && <field2 comparison>`.
  const combine = (span: Span, expr1: ast.Expr, expr2: ast.Expr): ast.Expr => {
    // For `PartialOrd` (`Ord` works the same but without the `Some` wrapping),
    // when the item is an enum, this expands to
    // ```
    // match (expr2) {
    //     Some(Ordering::Equal) => expr1,
    //     cmp => cmp
    // }
    // ```
    // where `expr2` is `partial_cmp(self_discr, other_discr)`, and `expr1` is a `match`
    // against the enum variants. This means that we begin by comparing the enum discriminants,
    // before either inspecting their contents (if they match), or returning
    // the `cmp::Ordering` of comparing the enum discriminants.
    // ```
    // match partial_cmp(self_discr, other_discr) {
    //     Some(Ordering::Equal) => match (self, other)  {
    //         (Self::A(self_0), Self::A(other_0)) => partial_cmp(self_0, other_0),
    //         (Self::B(self_0), Self::B(other_0)) => partial_cmp(self_0, other_0),
    //         _ => Some(Ordering::Equal)
    //     }
    //     cmp => cmp
    // }
    // ```
    // If we have any certain enum layouts, flipping this results in better codegen
    // ```
    // match (self, other) {
    //     (Self::A(self_0), Self::A(other_0)) => partial_cmp(self_0, other_0),
    //     _ => partial_cmp(self_discr, other_discr)
    // }
    // ```
    // Reference: https://github.com/rust-lang/rust/pull/103659#issuecomment-1328126354

    let last: ast.Arm | undefined;
    if (
      !discr_then_data &&
      expr1.kind.$ === "Match" &&
      (last = expr1.kind._1[expr1.kind._1.length - 1]) !== undefined &&
      last.pat.kind.$ === "Wild"
    ) {
      last.body = expr2;
      return expr1;
    } else {
      const eq_pat = cx.pat_path(span, ast.clone_Path(equal_path));
      const eq_arm = cx.arm(span, is_partial_ord ? cx.pat_some(span, eq_pat) : eq_pat, expr1);
      const cmp_ident = Ident.new(sym.cmp, span);
      const neq_arm = cx.arm(span, cx.pat_ident(span, cmp_ident), cx.expr_ident(span, cmp_ident));
      return cx.expr_match(span, expr2, [eq_arm, neq_arm]);
    }
  };

  const fields = substructure.fields;
  switch (fields.$) {
    case "EnumMatching":
    case "Struct": {
      const all_fields = fields._1;
      const op = (old: ast.Expr | undefined, field: FieldInfo): ast.Expr | undefined => {
        // The basic case: a field expression for one or more selflike args. E.g.
        // for `Ord::cmp` this is something like `Ord::cmp(&self.x, &other.x)`.
        const other_expr = unwrap(field.other_selflike_expr, "not exactly 2 arguments in `derive`");
        const args = [field.self_expr, other_expr];
        const new_ = cx.expr_call_global(field.span, [...method_path], args);
        if (old !== undefined) {
          return combine(field.span, old, new_);
        } else {
          return new_;
        }
      };

      const r = all_fields.reduceRight(op, undefined);
      if (r !== undefined) return r;
      // The fallback case for a struct or enum variant with no fields.
      let expr = cx.expr_path(equal_path);
      if (is_partial_ord) {
        expr = cx.expr_some(span, expr);
      }
      return expr;
    }
    case "EnumDiscr": {
      const match_expr = fields._0;
      const self_expr = cx.expr_addr_of(span, call_discriminant_value(cx, span, kw.SelfLower));
      const other_expr = cx.expr_addr_of(span, call_discriminant_value(cx, span, sym.other));
      const args = [self_expr, other_expr];
      const discr_check_expr = cx.expr_call_global(span, method_path, args);
      if (match_expr !== undefined) {
        return combine(span, match_expr, discr_check_expr);
      } else {
        return discr_check_expr;
      }
    }
    default:
      return cx.dcx().span_bug(span, "unexpected substructure in `derive`");
  }
}
