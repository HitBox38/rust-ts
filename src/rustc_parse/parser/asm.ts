// Port of compiler/rustc_parse/src/parser/asm.rs
// Types (`AsmArg`, `AsmArgKind`, `AsmOption`, `AsmAttrVec`) are generated into asm.gen.ts.
import { ast, AsmMacro, clone_Path, clone_QSelf, token } from "../../rustc_ast/lib.ts";
import type { HasAttrs, HasTokens } from "../../rustc_ast/ast_traits.ts";
import type { AttrVec, Attribute } from "../../rustc_ast/lib.ts";
import type { LazyAttrTokenStream } from "../../rustc_ast/tokenstream.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { Span } from "../../rustc_span/lib.ts";
import { kw, Symbol } from "../../rustc_span/symbol.ts";
import type { PResult } from "../../rustc_errors/lib.ts";
import { unwrap } from "../../std/panic.ts";
import { Err, Ok } from "../../std/result.ts";
import * as diagnostics from "../diagnostics.ts";
import type { AsmArg, AsmArgKind, AsmOption } from "./asm.gen.ts";
import * as gen from "./asm.gen.ts";
import { ForceCollect, Parser, Trailing } from "./mod.ts";
import { exp, type ExpKeywordPair } from "./token_type.ts";

export * from "./asm.gen.ts";

const { TokenKind: TK } = token;

// (`AsmArg`, `AsmArgKind`, `AsmOption` and `AsmAttrVec` are generated.)

// PORT: statics of the generated `AsmAttrVec` class.
export const AsmAttrVec = gen.AsmAttrVec as typeof gen.AsmAttrVec & {
  parse: (p: Parser) => PResult<gen.AsmAttrVec>;
};
export type AsmAttrVec = gen.AsmAttrVec;

// rustc: compiler/rustc_parse/src/parser/asm.rs:36 parse
AsmAttrVec.parse = function (p: Parser): PResult<gen.AsmAttrVec> {
  const r = p.parse_outer_attributes();
  if (r.$ === "Err") return r;
  const attrs = r._0;

  return p.collect_tokens<gen.AsmAttrVec>(
    undefined,
    attrs,
    ForceCollect.No,
    (_, attrs) => Ok([new gen.AsmAttrVec(attrs), Trailing.No, "No"]),
    HasTokens_AsmAttrVec,
    HasAttrs_AsmAttrVec,
  );
};

// PORT: `impl ast::HasAttrs for AsmAttrVec` as an impl table (ast_traits convention).
export const HasAttrs_AsmAttrVec: HasAttrs<gen.AsmAttrVec> = {
  // Follows `ast::Expr`.
  SUPPORTS_CUSTOM_INNER_ATTRS: false,

  // rustc: compiler/rustc_parse/src/parser/asm.rs:48 attrs
  attrs(self: gen.AsmAttrVec): readonly Attribute[] {
    return self._0;
  },

  // rustc: compiler/rustc_parse/src/parser/asm.rs:52 visit_attrs
  visit_attrs(self: gen.AsmAttrVec, f: (attrs: AttrVec) => void): void {
    f(self._0);
  },
};

// PORT: `impl ast::HasTokens for AsmAttrVec` as an impl table (ast_traits convention).
export const HasTokens_AsmAttrVec: HasTokens<gen.AsmAttrVec> = {
  // rustc: compiler/rustc_parse/src/parser/asm.rs:58 tokens
  tokens(_self: gen.AsmAttrVec): LazyAttrTokenStream | undefined {
    return undefined;
  },

  // rustc: compiler/rustc_parse/src/parser/asm.rs:62 tokens_mut
  tokens_mut(_self: gen.AsmAttrVec): MutRef<LazyAttrTokenStream | undefined> | undefined {
    return undefined;
  },
};

/// Used for better error messages when operand types are used that are not
/// supported by the current macro (e.g. `in` or `out` for `global_asm!`)
///
/// returns
///
/// - `Ok(true)` if the current token matches the keyword, and was expected
/// - `Ok(false)` if the current token does not match the keyword
/// - `Err(_)` if the current token matches the keyword, but was not expected
// rustc: compiler/rustc_parse/src/parser/asm.rs:75 eat_operand_keyword
function eat_operand_keyword(p: Parser, exp_: ExpKeywordPair, asm_macro: AsmMacro): PResult<boolean> {
  if (asm_macro === AsmMacro.Asm) {
    return Ok(p.eat_keyword(exp_));
  } else {
    const span = p.token.span;
    if (p.eat_keyword_noexpect(exp_.kw)) {
      // in gets printed as `r#in` otherwise
      const symbol = exp_.kw === kw.In ? "in" : Symbol.as_str(exp_.kw);
      return Err(
        p.dcx().create_err(
          diagnostics.AsmUnsupportedOperand_diagnostic({
            span,
            symbol,
            macro_name: AsmMacro.macro_name(asm_macro),
          }),
        ),
      );
    } else {
      return Ok(false);
    }
  }
}

// rustc: compiler/rustc_parse/src/parser/asm.rs:98 parse_asm_operand
function parse_asm_operand(p: Parser, asm_macro: AsmMacro): PResult<ast.InlineAsmOperand | undefined> {
  const dcx = p.dcx();

  let op: ast.InlineAsmOperand;
  let e = eat_operand_keyword(p, exp.In, asm_macro);
  if (e.$ === "Err") return e;
  if (e._0) {
    const r = parse_reg(p);
    if (r.$ === "Err") return r;
    const reg = r._0;
    if (p.eat_keyword(exp.Underscore)) {
      const err = dcx.create_err(diagnostics.AsmUnderscoreInput_diagnostic({ span: p.token.span }));
      return Err(err);
    }
    const r2 = p.parse_expr();
    if (r2.$ === "Err") return r2;
    const expr = r2._0;
    op = { $: "In", reg, expr };
  } else if ((e = eat_operand_keyword(p, exp.Out, asm_macro)).$ === "Err") {
    return e;
  } else if (e._0) {
    const r = parse_reg(p);
    if (r.$ === "Err") return r;
    const reg = r._0;
    let expr: ast.Expr | undefined;
    if (p.eat_keyword(exp.Underscore)) {
      expr = undefined;
    } else {
      const r2 = p.parse_expr();
      if (r2.$ === "Err") return r2;
      expr = r2._0;
    }
    op = { $: "Out", reg, expr, late: false };
  } else if ((e = eat_operand_keyword(p, exp.Lateout, asm_macro)).$ === "Err") {
    return e;
  } else if (e._0) {
    const r = parse_reg(p);
    if (r.$ === "Err") return r;
    const reg = r._0;
    let expr: ast.Expr | undefined;
    if (p.eat_keyword(exp.Underscore)) {
      expr = undefined;
    } else {
      const r2 = p.parse_expr();
      if (r2.$ === "Err") return r2;
      expr = r2._0;
    }
    op = { $: "Out", reg, expr, late: true };
  } else if ((e = eat_operand_keyword(p, exp.Inout, asm_macro)).$ === "Err") {
    return e;
  } else if (e._0) {
    const r = parse_reg(p);
    if (r.$ === "Err") return r;
    const reg = r._0;
    if (p.eat_keyword(exp.Underscore)) {
      const err = dcx.create_err(diagnostics.AsmUnderscoreInput_diagnostic({ span: p.token.span }));
      return Err(err);
    }
    const r2 = p.parse_expr();
    if (r2.$ === "Err") return r2;
    const expr = r2._0;
    if (p.eat(exp.FatArrow)) {
      let out_expr: ast.Expr | undefined;
      if (p.eat_keyword(exp.Underscore)) {
        out_expr = undefined;
      } else {
        const r3 = p.parse_expr();
        if (r3.$ === "Err") return r3;
        out_expr = r3._0;
      }
      op = { $: "SplitInOut", reg, in_expr: expr, out_expr, late: false };
    } else {
      op = { $: "InOut", reg, expr, late: false };
    }
  } else if ((e = eat_operand_keyword(p, exp.Inlateout, asm_macro)).$ === "Err") {
    return e;
  } else if (e._0) {
    const r = parse_reg(p);
    if (r.$ === "Err") return r;
    const reg = r._0;
    if (p.eat_keyword(exp.Underscore)) {
      const err = dcx.create_err(diagnostics.AsmUnderscoreInput_diagnostic({ span: p.token.span }));
      return Err(err);
    }
    const r2 = p.parse_expr();
    if (r2.$ === "Err") return r2;
    const expr = r2._0;
    if (p.eat(exp.FatArrow)) {
      let out_expr: ast.Expr | undefined;
      if (p.eat_keyword(exp.Underscore)) {
        out_expr = undefined;
      } else {
        const r3 = p.parse_expr();
        if (r3.$ === "Err") return r3;
        out_expr = r3._0;
      }
      op = { $: "SplitInOut", reg, in_expr: expr, out_expr, late: true };
    } else {
      op = { $: "InOut", reg, expr, late: true };
    }
  } else if ((e = eat_operand_keyword(p, exp.Label, asm_macro)).$ === "Err") {
    return e;
  } else if (e._0) {
    const r = p.parse_block();
    if (r.$ === "Err") return r;
    const block = r._0;
    op = { $: "Label", block };
  } else if (p.eat_keyword(exp.Const)) {
    const r = p.parse_expr_anon_const();
    if (r.$ === "Err") return r;
    const anon_const = r._0;
    op = { $: "Const", anon_const };
  } else if (p.eat_keyword(exp.Sym)) {
    const r = p.parse_expr();
    if (r.$ === "Err") return r;
    const expr = r._0;
    const kind = expr.kind;
    if (kind.$ !== "Path") {
      const err = dcx.create_err(diagnostics.AsmSymNoPath_diagnostic({ span: expr.span }));
      return Err(err);
    }
    const qself = kind._0;
    const path = kind._1;
    const sym_: ast.InlineAsmSym = {
      id: ast.DUMMY_NODE_ID,
      qself: qself === undefined ? undefined : clone_QSelf(qself),
      path: clone_Path(path),
    };
    op = { $: "Sym", sym: sym_ };
  } else {
    return Ok(undefined);
  }
  return Ok(op);
}

// Public for rustfmt.
// rustc: compiler/rustc_parse/src/parser/asm.rs:169 parse_asm_args
export function parse_asm_args(p: Parser, sp: Span, asm_macro: AsmMacro): PResult<AsmArg[]> {
  const dcx = p.dcx();

  if (p.token.eq(TK.Eof)) {
    return Err(dcx.create_err(diagnostics.AsmRequiresTemplate_diagnostic({ span: sp })));
  }

  const args: AsmArg[] = [];

  const ra = AsmAttrVec.parse(p);
  if (ra.$ === "Err") return ra;
  const attributes = ra._0;
  const rt = p.parse_expr();
  if (rt.$ === "Err") return rt;
  const first_template = rt._0;
  args.push({
    span: first_template.span,
    kind: { $: "Template", _0: first_template },
    attributes,
  });

  let allow_templates = true;

  while (!p.token.eq(TK.Eof)) {
    if (!p.eat(exp.Comma)) {
      if (allow_templates) {
        // After a template string, we always expect *only* a comma...
        return Err(dcx.create_err(diagnostics.AsmExpectedComma_diagnostic({ span: p.token.span })));
      } else {
        // ...after that delegate to `expect` to also include the other expected tokens.
        const r = p.expect(exp.Comma);
        return Err(unwrap(r.$ === "Err" ? r._0 : undefined));
      }
    }

    // Accept trailing commas.
    if (p.token.eq(TK.Eof)) {
      break;
    }

    const ra = AsmAttrVec.parse(p);
    if (ra.$ === "Err") return ra;
    const attributes = ra._0;
    const span_start = p.token.span;

    // Parse `clobber_abi`.
    if (p.eat_keyword(exp.ClobberAbi)) {
      allow_templates = false;

      const r = parse_clobber_abi(p);
      if (r.$ === "Err") return r;
      args.push({
        kind: { $: "ClobberAbi", _0: r._0 },
        span: Span.to(span_start, p.prev_token.span),
        attributes,
      });

      continue;
    }

    // Parse `options`.
    if (p.eat_keyword(exp.Options)) {
      allow_templates = false;

      const r = parse_options(p, asm_macro);
      if (r.$ === "Err") return r;
      args.push({
        kind: { $: "Options", _0: r._0 },
        span: Span.to(span_start, p.prev_token.span),
        attributes,
      });

      continue;
    }

    // Parse operand names.
    let name: Symbol | undefined;
    if (p.token.is_ident() && p.look_ahead(1, (t) => t.eq(TK.Eq))) {
      const [ident] = unwrap(p.token.ident());
      p.bump();
      const r = p.expect(exp.Eq);
      if (r.$ === "Err") return r;
      allow_templates = false;
      name = ident.name;
    } else {
      name = undefined;
    }

    const ro = parse_asm_operand(p, asm_macro);
    if (ro.$ === "Err") return ro;
    const op = ro._0;
    if (op !== undefined) {
      allow_templates = false;

      args.push({
        span: Span.to(span_start, p.prev_token.span),
        kind: { $: "Operand", _0: name, _1: op },
        attributes,
      });
    } else if (allow_templates) {
      const r = p.parse_expr();
      if (r.$ === "Err") return r;
      const template = r._0;
      // If it can't possibly expand to a string, provide diagnostics here to include other
      // things it could have been.
      const tk = template.kind;
      if (tk.$ === "Lit" && (tk._0.kind.$ === "Str" || tk._0.kind.$ === "StrRaw")) {
        // ok
      } else if (tk.$ === "MacCall") {
        // ok
      } else {
        const err = dcx.create_err(
          diagnostics.AsmExpectedOther_diagnostic({
            span: template.span,
            is_inline_asm: asm_macro === AsmMacro.Asm,
          }),
        );
        return Err(err);
      }

      args.push({
        span: template.span,
        kind: { $: "Template", _0: template } satisfies AsmArgKind,
        attributes,
      });
    } else {
      const r = p.unexpected_any<undefined>();
      if (r.$ === "Err") return r;
    }
  }

  return Ok(args);
}

// PORT: private upstream; exported for asm.test.ts only.
// rustc: compiler/rustc_parse/src/parser/asm.rs:289 parse_options
export function parse_options(p: Parser, asm_macro: AsmMacro): PResult<AsmOption[]> {
  const r = p.expect(exp.OpenParen);
  if (r.$ === "Err") return r;

  const asm_options: AsmOption[] = [];

  while (!p.eat(exp.CloseParen)) {
    const OPTIONS: [ExpKeywordPair, ast.InlineAsmOptions][] = [
      [exp.Pure, ast.InlineAsmOptions.PURE],
      [exp.Nomem, ast.InlineAsmOptions.NOMEM],
      [exp.Readonly, ast.InlineAsmOptions.READONLY],
      [exp.PreservesFlags, ast.InlineAsmOptions.PRESERVES_FLAGS],
      [exp.Noreturn, ast.InlineAsmOptions.NORETURN],
      [exp.Nostack, ast.InlineAsmOptions.NOSTACK],
      [exp.MayUnwind, ast.InlineAsmOptions.MAY_UNWIND],
      [exp.AttSyntax, ast.InlineAsmOptions.ATT_SYNTAX],
      [exp.Raw, ast.InlineAsmOptions.RAW],
    ];

    blk: {
      for (const [exp_, options] of OPTIONS) {
        // Gives a more accurate list of expected next tokens.
        let kw_matched: boolean;
        if (AsmMacro.is_supported_option(asm_macro, options)) {
          kw_matched = p.eat_keyword(exp_);
        } else {
          kw_matched = p.eat_keyword_noexpect(exp_.kw);
        }

        if (kw_matched) {
          const span = p.prev_token.span;
          const span_with_comma = p.token.eq(TK.Comma) ? Span.to(span, p.token.span) : span;

          asm_options.push({ symbol: exp_.kw, span, options, span_with_comma });
          break blk;
        }
      }

      return p.unexpected_any();
    }

    // Allow trailing commas.
    if (p.eat(exp.CloseParen)) {
      break;
    }
    const r2 = p.expect(exp.Comma);
    if (r2.$ === "Err") return r2;
  }

  return Ok(asm_options);
}

// rustc: compiler/rustc_parse/src/parser/asm.rs:339 parse_clobber_abi
function parse_clobber_abi(p: Parser): PResult<[Symbol, Span][]> {
  const r = p.expect(exp.OpenParen);
  if (r.$ === "Err") return r;

  if (p.eat(exp.CloseParen)) {
    return Err(p.dcx().create_err(diagnostics.NonABI_diagnostic({ span: p.token.span })));
  }

  const new_abis: [Symbol, Span][] = [];
  while (!p.eat(exp.CloseParen)) {
    const rl = p.parse_str_lit();
    if (rl.$ === "Ok") {
      const str_lit = rl._0;
      new_abis.push([str_lit.symbol_unescaped, str_lit.span]);
    } else {
      const opt_lit = rl._0;
      const span = opt_lit === undefined ? p.token.span : opt_lit.span;
      return Err(p.dcx().create_err(diagnostics.AsmExpectedStringLiteral_diagnostic({ span })));
    }

    // Allow trailing commas
    if (p.eat(exp.CloseParen)) {
      break;
    }
    const r2 = p.expect(exp.Comma);
    if (r2.$ === "Err") return r2;
  }

  return Ok(new_abis);
}

// rustc: compiler/rustc_parse/src/parser/asm.rs:368 parse_reg
function parse_reg(p: Parser): PResult<ast.InlineAsmRegOrRegClass> {
  const r = p.expect(exp.OpenParen);
  if (r.$ === "Err") return r;
  let result: ast.InlineAsmRegOrRegClass;
  const kind = p.token.uninterpolate().kind;
  if (kind.$ === "Ident" && kind._1 === "Normal") {
    const name = kind._0;
    result = { $: "RegClass", _0: name };
  } else if (kind.$ === "Literal" && kind._0.kind.$ === "Str") {
    const symbol = kind._0.symbol;
    result = { $: "Reg", _0: symbol };
  } else {
    return Err(
      p.dcx().create_err(
        diagnostics.ExpectedRegisterClassOrExplicitRegister_diagnostic({
          span: p.token.span,
        }),
      ),
    );
  }
  p.bump();
  const r2 = p.expect(exp.CloseParen);
  if (r2.$ === "Err") return r2;
  return Ok(result);
}
