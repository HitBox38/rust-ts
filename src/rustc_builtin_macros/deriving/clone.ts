// Port of compiler/rustc_builtin_macros/src/deriving/clone.rs
import type { ExtCtxt } from "../../rustc_expand/base.ts";
import { LocalExpnId } from "../../rustc_span/hygiene.ts";
import { DUMMY_SP, type Span } from "../../rustc_span/lib.ts";
import { Ident, kw, type Symbol, sym } from "../../rustc_span/symbol.ts";
import { unwrap } from "../../std/panic.ts";
import {
  ast,
  BlockOrExpr,
  type CombineSubstructureFunc,
  combine_substructure,
  type FieldInfo,
  MethodDef,
  type Substructure,
  TraitDef,
} from "./generic/mod.ts";
import { assert_ty_bounds, path_std } from "./mod.ts";

// rustc: compiler/rustc_builtin_macros/src/deriving/clone.rs:10 expand_deriving_clone
export function expand_deriving_clone(cx: ExtCtxt, span: Span, item: ast.Item, push: (item: ast.Item) => void, is_const: boolean): void {
  // The simple form is `fn clone(&self) -> Self { *self }`, possibly with
  // some additional `AssertParamIsClone` assertions.
  //
  // We can use the simple form if either of the following are true.
  // - The type derives Copy and there are no generic parameters. (If we
  //   used the simple form with generics, we'd have to bound the generics
  //   with Clone + Copy, and then there'd be no Clone impl at all if the
  //   user fills in something that is Clone but not Copy. After
  //   specialization we can remove this no-generics limitation.)
  // - The item is a union. (Unions with generic parameters still can derive
  //   Clone because they require Copy for deriving, Clone alone is not
  //   enough. Whether Clone is implemented for fields is irrelevant so we
  //   don't assert it.)
  let bounds: ast.Path[];
  let substructure: CombineSubstructureFunc;
  let is_simple: boolean;
  const kind = item.kind;
  switch (kind.$) {
    case "Struct":
    case "Enum": {
      const params = kind._1.params;
      const container_id = LocalExpnId.expn_data(cx.current_expansion.id).parent.expect_local();
      const has_derive_copy = cx.resolver.has_derive_copy(container_id);
      bounds = [];
      if (has_derive_copy && !params.some((param) => param.kind.$ === "Type")) {
        is_simple = true;
        substructure = combine_substructure((c, s, sub) => cs_clone_simple(c, s, sub, false));
      } else {
        is_simple = false;
        substructure = combine_substructure(cs_clone);
      }
      break;
    }
    case "Union": {
      bounds = [path_std(cx, span, [sym.marker, sym.Copy])];
      is_simple = true;
      substructure = combine_substructure((c, s, sub) => cs_clone_simple(c, s, sub, true));
      break;
    }
    default:
      return cx.dcx().span_bug(span, "`derive(Clone)` on wrong item kind");
  }

  // If the clone method is just copying the value, also mark the type as
  // `TrivialClone` to allow some library optimizations.
  if (is_simple) {
    const trivial_def = new TraitDef(
      span,
      path_std(cx, span, [sym.clone, sym.TrivialClone]),
      false,
      true,
      bounds.map(ast.clone_Path),
      true,
      [],
      is_const,
      { $: "Unsafe", _0: DUMMY_SP },
      // `TrivialClone` is not part of an API guarantee, so it shouldn't
      // appear in rustdoc output.
      false,
    );

    trivial_def.expand(cx, item, push);
  }

  const trait_def = new TraitDef(
    span,
    path_std(cx, span, [sym.clone, sym.Clone]),
    false,
    true,
    bounds,
    true,
    [
      new MethodDef(
        sym.clone,
        cx.empty_generics(span),
        true,
        [],
        false,
        cx.ty_self(span),
        [cx.attr_word(sym.inline, span)],
        "Default",
        substructure,
      ),
    ],
    is_const,
    ast.Safety.Default,
    true,
  );

  trait_def.expand_ext(cx, item, push, is_simple);
}

// rustc: compiler/rustc_builtin_macros/src/deriving/clone.rs:106 cs_clone_simple
function cs_clone_simple(cx: ExtCtxt, trait_span: Span, substr: Substructure, is_union: boolean): BlockOrExpr {
  const stmts: ast.Stmt[] = [];
  const seen_type_names = new Set<Symbol>();
  const process_variant = (variant: ast.VariantData): void => {
    for (const field of ast.VariantData.fields(variant)) {
      // This basic redundancy checking only prevents duplication of
      // assertions like `AssertParamIsClone<Foo>` where the type is a
      // simple name. That's enough to get a lot of cases, though.
      // PORT: `!seen_type_names.insert(name)` -> `has`, with the insert done on the other branch.
      const name = ast.TyKind.is_simple_path(field.ty.kind);
      if (name !== undefined && seen_type_names.has(name)) {
        // Already produced an assertion for this type.
        // Anonymous structs or unions must be eliminated as they cannot be
        // type parameters.
      } else {
        if (name !== undefined) seen_type_names.add(name);
        // let _: AssertParamIsClone<FieldTy>;
        assert_ty_bounds(cx, stmts, ast.clone_Ty(field.ty), field.span, [sym.clone, sym.AssertParamIsClone]);
      }
    }
  };

  if (is_union) {
    // Just a single assertion for unions, that the union impls `Copy`.
    // let _: AssertParamIsCopy<Self>;
    const self_ty = cx.ty_path(cx.path_ident(trait_span, Ident.with_dummy_span(kw.SelfUpper)));
    assert_ty_bounds(cx, stmts, self_ty, trait_span, [sym.clone, sym.AssertParamIsCopy]);
  } else {
    const fields = substr.fields;
    switch (fields.$) {
      case "StaticStruct": {
        process_variant(fields._0);
        break;
      }
      case "StaticEnum": {
        for (const variant of fields._0.variants) {
          process_variant(variant.data);
        }
        break;
      }
      default:
        cx.dcx().span_bug(trait_span, "unexpected substructure in simple `derive(Clone)`");
    }
  }
  return BlockOrExpr.new_mixed(stmts, cx.expr_deref(trait_span, cx.expr_self(trait_span)));
}

// rustc: compiler/rustc_builtin_macros/src/deriving/clone.rs:165 cs_clone
function cs_clone(cx: ExtCtxt, trait_span: Span, substr: Substructure): BlockOrExpr {
  const fn_path = cx.std_path([sym.clone, sym.Clone, sym.clone]);
  const subcall = (field: FieldInfo): ast.Expr => {
    const args = [field.self_expr];
    return cx.expr_call_global(field.span, [...fn_path], args);
  };

  let ctor_path: ast.Path;
  let all_fields: FieldInfo[];
  let vdata: ast.VariantData;
  const fields = substr.fields;
  switch (fields.$) {
    case "Struct": {
      ctor_path = cx.path(trait_span, [substr.type_ident]);
      all_fields = fields._1;
      vdata = fields._0;
      break;
    }
    case "EnumMatching": {
      const variant = fields._0;
      ctor_path = cx.path(trait_span, [substr.type_ident, variant.ident]);
      all_fields = fields._1;
      vdata = variant.data;
      break;
    }
    default:
      return cx.dcx().span_bug(trait_span, "unexpected substructure in `derive(Clone)`");
  }

  let expr: ast.Expr;
  switch (vdata.$) {
    case "Struct": {
      const fields = all_fields.map((field) => cx.field_imm(field.span, unwrap(field.name), subcall(field)));

      expr = cx.expr_struct(trait_span, ctor_path, fields);
      break;
    }
    case "Tuple": {
      const subcalls = all_fields.map(subcall);
      const path = cx.expr_path(ctor_path);
      expr = cx.expr_call(trait_span, path, subcalls);
      break;
    }
    case "Unit":
      expr = cx.expr_path(ctor_path);
      break;
  }
  return BlockOrExpr.new_expr(expr);
}
