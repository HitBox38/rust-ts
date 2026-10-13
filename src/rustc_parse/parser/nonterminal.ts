// Port of compiler/rustc_parse/src/parser/nonterminal.rs (no types of its own).
import { HasAttrs, HasTokens } from "../../rustc_ast/ast_traits.ts";
import type { Block, Pat, Path, Ty, Visibility } from "../../rustc_ast/lib.ts";
import { token, tokenstream } from "../../rustc_ast/lib.ts";
import type { IdentKind, MetaVarKind, NonterminalKind, Token } from "../../rustc_ast/token.ts";
import type { WithTokens } from "../../rustc_ast/tokenstream.ts";
import * as pprust from "../../rustc_ast_pretty/pprust/mod.ts";
import type { PResult } from "../../rustc_errors/lib.ts";
import { type Ident, kw } from "../../rustc_span/symbol.ts";
import { unreachable } from "../../std/panic.ts";
import { Err, Ok } from "../../std/result.ts";
import { UnexpectedNonterminal_diagnostic } from "../diagnostics.ts";
import { AllowConstBlockItems, FollowedByType, ForceCollect, type ParseNtResult, Parser } from "./mod.ts";
import { CommaRecoveryMode, RecoverColon, RecoverComma } from "./pat.ts";
import { PathStyle } from "./path.ts";

/// Checks whether a non-terminal may begin with a particular token.
///
/// Returning `false` is a *stability guarantee* that such a matcher will *never* begin with
/// that token. Be conservative (return true) if not sure. Inlined because it has a single call
/// site.
// PORT: associated fn without `self` (`Parser::nonterminal_may_begin_with`) -> module-level fn.
// rustc: compiler/rustc_parse/src/parser/nonterminal.rs:22 nonterminal_may_begin_with
export function nonterminal_may_begin_with(kind: NonterminalKind, token_: Token): boolean {
  /// Checks whether the non-terminal may contain a single (non-keyword) identifier.
  // rustc: compiler/rustc_parse/src/parser/nonterminal.rs:24 may_be_ident
  function may_be_ident(kind: MetaVarKind): boolean {
    switch (kind.$) {
      case "Stmt":
      case "Pat":
      case "Expr":
      case "Ty":
      case "Meta":
      case "Path":
        return true;
      // `true`, `false`
      case "Literal":
        return true;

      case "Item":
      case "Block":
      case "Vis":
      case "Guard":
        return false;

      case "Ident":
      case "Lifetime":
      case "TT":
        return unreachable();
    }
  }

  switch (kind.$) {
    case "Expr": {
      const ek = kind._0;
      if (ek.$ === "Expr2021") {
        // `expr_2021` and earlier
        return (
          token_.can_begin_expr() &&
          // This exception is here for backwards compatibility.
          !token_.is_keyword(kw.Let) &&
          // This exception is here for backwards compatibility.
          !token_.is_keyword(kw.Const)
        );
      } else {
        // Current edition expressions
        // In Edition 2024, `_` is considered an expression, so we
        // need to allow it here because `token.can_begin_expr()` does
        // not consider `_` to be an expression.
        //
        // Because `can_begin_expr` is used elsewhere, we need to reduce
        // the scope of where the `_` is considered an expression to
        // just macro parsing code.
        return (
          (token_.can_begin_expr() || token_.is_keyword(kw.Underscore)) &&
          // This exception is here for backwards compatibility.
          !token_.is_keyword(kw.Let)
        );
      }
    }
    case "Ty":
      return token_.can_begin_type();
    case "Ident":
      return get_macro_ident(token_) !== undefined;
    case "Literal":
      return token_.can_begin_literal_maybe_minus();
    case "Vis": {
      const k = token_.kind;
      switch (k.$) {
        // The follow-set of :vis + "priv" keyword + interpolated/metavar-expansion.
        case "Comma":
        case "Ident":
        case "NtIdent":
        case "NtLifetime":
          return true;
        case "OpenInvisible":
          if (k._0.$ === "MetaVar") return true;
          return token_.can_begin_type();
        default:
          return token_.can_begin_type();
      }
    }
    case "Block": {
      const k = token_.kind;
      switch (k.$) {
        case "OpenBrace":
          return true;
        case "NtLifetime":
          return true;
        case "OpenInvisible": {
          if (k._0.$ !== "MetaVar") return false;
          const mk = k._0._0;
          switch (mk.$) {
            case "Block":
            case "Stmt":
            case "Expr":
            case "Literal":
              return true;
            case "Item":
            case "Pat":
            case "Ty":
            case "Meta":
            case "Path":
            case "Vis":
            case "Guard":
              return false;
            case "Lifetime":
            case "Ident":
            case "TT":
              return unreachable();
          }
          break;
        }
        default:
          return false;
      }
      return false;
    }
    case "Path":
    case "Meta": {
      const k = token_.kind;
      switch (k.$) {
        case "PathSep":
        case "Ident":
        case "NtIdent":
          return true;
        case "OpenInvisible":
          if (k._0.$ === "MetaVar") return may_be_ident(k._0._0);
          return false;
        default:
          return false;
      }
    }
    case "Pat":
      return token_.can_begin_pattern(kind._0);
    case "Lifetime": {
      const k = token_.kind;
      switch (k.$) {
        case "Lifetime":
        case "NtLifetime":
          return true;
        default:
          return false;
      }
    }
    case "Guard": {
      const k = token_.kind;
      if (k.$ === "OpenInvisible" && k._0.$ === "MetaVar" && k._0._0.$ === "Guard") return true;
      return token_.is_keyword(kw.If);
    }
    case "TT":
    case "Item":
    case "Stmt":
      return token_.kind.$ !== "Eof" && token.TokenKind.close_delim(token_.kind) === undefined;
  }
}

/// Parse a non-terminal (e.g. MBE `:pat` or `:ident`). Inlined because there is only one call
/// site.
// rustc: compiler/rustc_parse/src/parser/nonterminal.rs:121 parse_nonterminal
Parser.prototype.parse_nonterminal = function (this: Parser, kind: NonterminalKind): PResult<ParseNtResult> {
  // A `macro_rules!` invocation may pass a captured item/expr to a proc-macro,
  // which requires having captured tokens available. Since we cannot determine
  // in advance whether or not a proc-macro will be (transitively) invoked,
  // we always capture tokens for any nonterminal that needs them.
  switch (kind.$) {
    // Note that TT is treated differently to all the others.
    case "TT":
      return Ok({ $: "Tt", _0: this.parse_token_tree() });
    case "Item": {
      const r = this.parse_item(ForceCollect.Yes, AllowConstBlockItems.Yes);
      if (r.$ === "Err") return r;
      const item = r._0;
      if (item !== undefined) {
        return Ok({ $: "Item", _0: item });
      } else {
        return Err(this.dcx().create_err(UnexpectedNonterminal_diagnostic({ $: "Item", _0: this.token.span })));
      }
    }
    case "Block": {
      // While a block *expression* may have attributes (e.g. `#[my_attr] { ... }`),
      // the ':block' matcher does not support them
      const r = this.collect_tokens_no_attrs(
        (this_) => {
          const b = this_.parse_block();
          if (b.$ === "Err") return b;
          return Ok(tokenstream.WithTokens.new(b._0));
        },
        HasTokens.WithTokens<Block>(),
        HasAttrs.WithTokens(HasAttrs.Block),
      );
      if (r.$ === "Err") return r;
      return Ok({ $: "Block", _0: r._0 });
    }
    case "Stmt": {
      const stmt = this.parse_stmt_nonterminal(ForceCollect.Yes);
      if (stmt !== undefined) {
        return Ok({ $: "Stmt", _0: stmt });
      } else {
        return Err(this.dcx().create_err(UnexpectedNonterminal_diagnostic({ $: "Statement", _0: this.token.span })));
      }
    }
    case "Pat": {
      const pat_kind = kind._0;
      const r = this.collect_tokens_no_attrs(
        (this_): PResult<WithTokens<Pat>> => {
          let p: PResult<Pat>;
          switch (pat_kind.$) {
            case "PatParam":
              p = this_.parse_pat_no_top_alt(undefined, undefined);
              break;
            case "PatWithOr":
              p = this_.parse_pat_no_top_guard(
                undefined,
                RecoverComma.No,
                RecoverColon.No,
                CommaRecoveryMode.EitherTupleOrPipe,
              );
              break;
          }
          if (p.$ === "Err") return p;
          return Ok(tokenstream.WithTokens.new(p._0));
        },
        HasTokens.WithTokens<Pat>(),
        HasAttrs.WithTokens(HasAttrs.Pat),
      );
      if (r.$ === "Err") return r;
      return Ok({ $: "Pat", _0: r._0, _1: pat_kind });
    }
    case "Expr": {
      const expr_kind = kind._0;
      const r = this.parse_expr_force_collect();
      if (r.$ === "Err") return r;
      return Ok({ $: "Expr", _0: r._0, _1: expr_kind });
    }
    case "Literal": {
      // The `:literal` matcher does not support attributes.
      const r = this.collect_tokens_no_attrs((this_) => this_.parse_literal_maybe_minus(), HasTokens.Expr, HasAttrs.Expr);
      if (r.$ === "Err") return r;
      return Ok({ $: "Literal", _0: r._0 });
    }
    case "Ty": {
      const r = this.collect_tokens_no_attrs(
        (this_) => {
          const t = this_.parse_ty_no_question_mark_recover();
          if (t.$ === "Err") return t;
          return Ok(tokenstream.WithTokens.new(t._0));
        },
        HasTokens.WithTokens<Ty>(),
        HasAttrs.WithTokens(HasAttrs.Ty),
      );
      if (r.$ === "Err") return r;
      return Ok({ $: "Ty", _0: r._0 });
    }
    // This could be handled like a token, since it is one.
    case "Ident": {
      const id = get_macro_ident(this.token);
      if (id !== undefined) {
        const [ident, kind_] = id;
        this.bump();
        return Ok({ $: "Ident", _0: ident, _1: kind_ });
      } else {
        return Err(
          this.dcx().create_err(
            UnexpectedNonterminal_diagnostic({ $: "Ident", span: this.token.span, token: pprust.token_to_string(this.token) }),
          ),
        );
      }
    }
    case "Path": {
      const r = this.collect_tokens_no_attrs(
        (this_) => {
          const p = this_.parse_path(PathStyle.Type);
          if (p.$ === "Err") return p;
          return Ok(tokenstream.WithTokens.new<Path>(p._0));
        },
        HasTokens.WithTokens<Path>(),
        HasAttrs.WithTokens(HasAttrs.Path),
      );
      if (r.$ === "Err") return r;
      return Ok({ $: "Path", _0: r._0 });
    }
    case "Meta": {
      const r = this.parse_attr_item(ForceCollect.Yes);
      if (r.$ === "Err") return r;
      return Ok({ $: "Meta", _0: r._0.map((item) => item) });
    }
    case "Vis": {
      const r = this.collect_tokens_no_attrs(
        (this_) => {
          const v = this_.parse_visibility(FollowedByType.Yes);
          if (v.$ === "Err") return v;
          return Ok(tokenstream.WithTokens.new<Visibility>(v._0));
        },
        HasTokens.WithTokens<Visibility>(),
        HasAttrs.WithTokens(HasAttrs.Visibility),
      );
      if (r.$ === "Err") return r;
      return Ok({ $: "Vis", _0: r._0 });
    }
    case "Lifetime": {
      // We want to keep `'keyword` parsing, just like `keyword` is still
      // an ident for nonterminal purposes.
      const lt = this.token.lifetime();
      if (lt !== undefined) {
        const [ident, is_raw] = lt;
        this.bump();
        return Ok({ $: "Lifetime", _0: ident, _1: is_raw });
      } else {
        return Err(
          this.dcx().create_err(
            UnexpectedNonterminal_diagnostic({ $: "Lifetime", span: this.token.span, token: pprust.token_to_string(this.token) }),
          ),
        );
      }
    }
    case "Guard": {
      const r = this.expect_match_arm_guard(ForceCollect.Yes);
      if (r.$ === "Err") return r;
      return Ok({ $: "Guard", _0: r._0 });
    }
  }
};

/// The token is an identifier, but not `_`.
/// We prohibit passing `_` to macros expecting `ident` for now.
// rustc: compiler/rustc_parse/src/parser/nonterminal.rs:223 get_macro_ident
function get_macro_ident(token_: Token): [Ident, IdentKind] | undefined {
  const id = token_.ident();
  return id !== undefined && id[0].name !== kw.Underscore ? id : undefined;
}
