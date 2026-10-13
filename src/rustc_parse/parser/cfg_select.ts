// Port of compiler/rustc_parse/src/parser/cfg_select.rs
// Types (`CfgSelectBranchAttrSpans`) are generated into cfg_select.gen.ts.
import { HasAttrs, HasTokens, debug_Expr, type Expr, token } from "../../rustc_ast/lib.ts";
import { TokenStream } from "../../rustc_ast/tokenstream.ts";
import { expr_is_complete } from "../../rustc_ast/util/classify.ts";
import type { PResult } from "../../rustc_errors/lib.ts";
import { unreachable } from "../../std/panic.ts";
import { Ok } from "../../std/result.ts";
import { AttrWrapper } from "./attr_wrapper.ts";
import { ForceCollect, Parser, Restrictions, Trailing } from "./mod.ts";
import { exp } from "./token_type.ts";

export * from "./cfg_select.gen.ts";

const { TokenKind: TK } = token;

/// Parses the right-hand side of a `cfg_select!` branch,
/// which can be either a braced block or an expression.
// rustc: compiler/rustc_parse/src/parser/cfg_select.rs:19 parse_cfg_select_branch_rhs
Parser.prototype.parse_cfg_select_branch_rhs = function (this: Parser): PResult<TokenStream> {
  if (this.token.eq(TK.OpenBrace)) {
    // Strip the outer '{' and '}'.
    const tt = this.parse_token_tree();
    switch (tt.$) {
      case "Token":
        return unreachable("internal error: entered unreachable code: because the current token is a '{'");
      case "Delimited": {
        const tts = tt._3;
        // Optionally end with a comma.
        void this.eat(exp.Comma);
        return Ok(tts);
      }
    }
  }
  const attrs = AttrWrapper.empty(); // FIXME expressions with attributes can be supported here
  const r = this.collect_tokens<Expr>(
    undefined,
    AttrWrapper.empty(),
    ForceCollect.Yes,
    (p, _empty_attrs) => {
      const r = p.parse_expr_res_after_attrs(Restrictions.STMT_EXPR, attrs);
      if (r.$ === "Err") return r;
      const [expr] = r._0;
      return Ok([expr, Trailing.No, "No"]);
    },
    HasTokens.Expr,
    HasAttrs.Expr,
  );
  if (r.$ === "Err") return r;
  const expr = r._0;
  if (!expr_is_complete(expr) && !this.token.eq(TK.CloseBrace) && !this.token.eq(TK.Eof)) {
    const r2 = this.expect(exp.Comma);
    if (r2.$ === "Err") return r2;
  } else {
    void this.eat(exp.Comma);
  }
  // PORT: `Expr: HasTokens + HasAttrs + Debug`: the ast_traits impls and the derived Debug.
  return Ok(TokenStream.from_ast(expr, { tokens: HasTokens.Expr.tokens, attrs: HasAttrs.Expr.attrs, debug: debug_Expr }));
};
