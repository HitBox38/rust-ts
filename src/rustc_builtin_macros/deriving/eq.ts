// Port of compiler/rustc_builtin_macros/src/deriving/eq.rs
import type { ExtCtxt } from "../../rustc_expand/base.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { type Symbol, sym } from "../../rustc_span/symbol.ts";
import { ast, BlockOrExpr, combine_substructure, MethodDef, type Substructure, TraitDef } from "./generic/mod.ts";
import { assert_ty_bounds, path_std } from "./mod.ts";

// rustc: compiler/rustc_builtin_macros/src/deriving/eq.rs:10 expand_deriving_eq
export function expand_deriving_eq(cx: ExtCtxt, span_: Span, item: ast.Item, push: (item: ast.Item) => void, is_const: boolean): void {
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

// rustc: compiler/rustc_builtin_macros/src/deriving/eq.rs:50 cs_total_eq_assert
function cs_total_eq_assert(cx: ExtCtxt, trait_span: Span, substr: Substructure): BlockOrExpr {
  const stmts: ast.Stmt[] = [];
  const seen_type_names = new Set<Symbol>();
  const process_variant = (variant: ast.VariantData): void => {
    for (const field of ast.VariantData.fields(variant)) {
      // This basic redundancy checking only prevents duplication of
      // assertions like `AssertParamIsEq<Foo>` where the type is a
      // simple name. That's enough to get a lot of cases, though.
      // PORT: `!seen_type_names.insert(name)` -> `has`, with the insert done on the other branch.
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
      cx.dcx().span_bug(trait_span, "unexpected substructure in `derive(Eq)`");
  }
  return BlockOrExpr.new_stmts(stmts);
}
