// Port of compiler/rustc_builtin_macros/src/deriving/hash.rs
import type { ExtCtxt } from "../../rustc_expand/base.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { Ident, kw, sym } from "../../rustc_span/symbol.ts";
import { ast, BlockOrExpr, combine_substructure, MethodDef, type Substructure, TraitDef } from "./generic/mod.ts";
import { call_discriminant_value, path_std } from "./mod.ts";

// rustc: compiler/rustc_builtin_macros/src/deriving/hash.rs:9 expand_deriving_hash
export function expand_deriving_hash(cx: ExtCtxt, span: Span, item: ast.Item, push: (item: ast.Item) => void, is_const: boolean): void {
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

// rustc: compiler/rustc_builtin_macros/src/deriving/hash.rs:59 hash_substructure
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
