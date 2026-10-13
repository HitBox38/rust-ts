// TEST FIXTURES (lane bm-derive-a), not ported code: no markers.
//
// `TraitDef`s for `derive(Copy)`, `derive(Hash)` and `derive(Eq)`, transcribed from
// compiler/rustc_builtin_macros/src/deriving/{copy,hash,eq}.rs so derive.test.ts can drive
// deriving/generic/mod.ts before lane bm-derive-b ports the individual derives. Once
// deriving/{copy,hash,eq}.ts are ported, run.ts should use the registered expanders instead and this
// file should be deleted (the expected outputs do not change: they come from the real derives).
import { ast } from "../../rustc_ast/lib.ts";
import type { ExtCtxt } from "../../rustc_expand/base.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { Ident, kw, sym, type Symbol } from "../../rustc_span/symbol.ts";
import {
  BlockOrExpr,
  combine_substructure,
  MethodDef,
  type Substructure,
  TraitDef,
} from "../deriving/generic/mod.ts";
import { assert_ty_bounds, call_discriminant_value, path_std } from "../deriving/mod.ts";

type Push = (item: ast.Item) => void;

// deriving/copy.rs expand_deriving_copy
export function expand_deriving_copy(cx: ExtCtxt, span: Span, item: ast.Item, push: Push, is_const: boolean): void {
  const trait_def = new TraitDef(
    span,
    path_std(cx, span, [sym.marker, sym.Copy]),
    false,
    false,
    [],
    true,
    [],
    is_const,
    ast.Safety.Default,
    true,
  );

  trait_def.expand(cx, item, push);
}

// deriving/hash.rs expand_deriving_hash
export function expand_deriving_hash(cx: ExtCtxt, span: Span, item: ast.Item, push: Push, is_const: boolean): void {
  const path = path_std(cx, span, [sym.hash, sym.Hash]);

  const typaram = Ident.new(sym.__H, span);

  const arg = cx.ty_path(cx.path_ident(span, typaram));

  let param: ast.GenericParam;
  {
    const path = path_std(cx, span, [sym.hash, sym.Hasher]);
    param = cx.typaram(typaram, [cx.trait_bound(path, false)], undefined);
  }

  const generics: ast.Generics = {
    params: [param],
    where_clause: new ast.WhereClause(false, [], span),
    span,
  };

  const hash_trait_def = new TraitDef(
    span,
    path,
    false,
    true,
    [],
    false,
    [
      new MethodDef(
        sym.hash,
        generics,
        true,
        [[cx.ty_ref(span, arg, undefined, "Mut"), sym.state]],
        false,
        cx.ty_unit(span),
        [cx.attr_word(sym.inline, span)],
        "Unify",
        combine_substructure(hash_substructure),
      ),
    ],
    is_const,
    ast.Safety.Default,
    true,
  );

  hash_trait_def.expand(cx, item, push);
}

// deriving/hash.rs hash_substructure
function hash_substructure(cx: ExtCtxt, span: Span, substr: Substructure): BlockOrExpr {
  const call_hash = (span: Span, expr: ast.Expr): ast.Stmt => {
    const strs = cx.std_path([sym.hash, sym.Hash, sym.hash]);
    const hash_path = cx.expr_path(cx.path_global(span, strs));
    const expr_ = cx.expr_call(span, hash_path, [expr, cx.expr_ident_sym(span, sym.state)]);
    return cx.stmt_expr(expr_);
  };

  let stmts: ast.Stmt[];
  let match_expr: ast.Expr | undefined;
  const fields_ = substr.fields;
  switch (fields_.$) {
    case "Struct":
    case "EnumMatching": {
      const fields = fields_._1;
      stmts = fields.map((field) => call_hash(field.span, field.self_expr));
      match_expr = undefined;
      break;
    }
    case "EnumDiscr": {
      stmts = [call_hash(span, cx.expr_addr_of(span, call_discriminant_value(cx, span, kw.SelfLower)))];
      match_expr = fields_._0;
      break;
    }
    default:
      return cx.dcx().span_bug(span, "unexpected substructure in `derive(Hash)`");
  }

  return BlockOrExpr.new_mixed(stmts, match_expr);
}

// deriving/eq.rs expand_deriving_eq
export function expand_deriving_eq(cx: ExtCtxt, span_: Span, item: ast.Item, push: Push, is_const: boolean): void {
  const span = cx.with_def_site_ctxt(span_);

  const trait_def = new TraitDef(
    span,
    path_std(cx, span, [sym.cmp, sym.Eq]),
    false,
    true,
    [],
    true,
    [
      new MethodDef(
        sym.assert_fields_are_eq,
        cx.empty_generics(span),
        true,
        [],
        false,
        cx.ty_unit(span),
        [
          // This method will never be called, so doing codegen etc. for it is unnecessary.
          // We prevent this by adding `#[inline]`, which improves compile-time.
          cx.attr_word(sym.inline, span),
          cx.attr_nested_word(sym.doc, sym.hidden, span),
          cx.attr_nested_word(sym.coverage, sym.off, span),
        ],
        "Unify",
        combine_substructure(cs_total_eq_assert),
      ),
    ],
    is_const,
    ast.Safety.Default,
    true,
  );
  trait_def.expand_ext(cx, item, push, true);
}

// deriving/eq.rs cs_total_eq_assert
function cs_total_eq_assert(cx: ExtCtxt, trait_span: Span, substr: Substructure): BlockOrExpr {
  const stmts: ast.Stmt[] = [];
  const seen_type_names = new Set<Symbol>();
  const process_variant = (variant: ast.VariantData): void => {
    for (const field of ast.VariantData.fields(variant)) {
      // This basic redundancy checking only prevents duplication of
      // assertions like `AssertParamIsEq<Foo>` where the type is a
      // simple name. That's enough to get a lot of cases, though.
      const name = ast.TyKind.is_simple_path(field.ty.kind);
      if (name !== undefined && seen_type_names.has(name)) {
        // Already produced an assertion for this type.
      } else {
        if (name !== undefined) seen_type_names.add(name);
        // let _: AssertParamIsEq<FieldTy>;
        assert_ty_bounds(cx, stmts, ast.clone_Ty(field.ty), field.span, [sym.cmp, sym.AssertParamIsEq]);
      }
    }
  };

  const fields = substr.fields;
  switch (fields.$) {
    case "StaticStruct":
      process_variant(fields._0);
      break;
    case "StaticEnum":
      for (const variant of fields._0.variants) {
        process_variant(variant.data);
      }
      break;
    default:
      cx.dcx().span_bug(trait_span, "unexpected substructure in `derive(Eq)`");
  }
  return BlockOrExpr.new_stmts(stmts);
}
