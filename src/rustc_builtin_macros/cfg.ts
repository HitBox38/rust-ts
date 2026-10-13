// Port of compiler/rustc_builtin_macros/src/cfg.rs
//! The compiler code necessary to support the cfg! extension, which expands to
//! a literal `true` or `false` based on whether the given cfg matches the
//! current compilation environment.

import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import { ast, token } from "../rustc_ast/lib.ts";
import type { CfgEntry } from "../rustc_ast/attr/data_structures.ts";
import { Target } from "../rustc_attr_ir/target.ts";
import { AttrPath } from "../rustc_attr_ir/lib.ts";
import { AllowExprMetavar, MetaItemOrLitParser } from "../rustc_attr_parsing/parser.ts";
import {
  AttributeParser,
  AttributeSafety,
  CFG_TEMPLATE,
  eval_config_entry,
  ParsedDescription,
  parse_cfg_entry,
} from "../rustc_attr_parsing/lib.ts";
import { EvalConfigResult } from "../rustc_attr_parsing/attributes/cfg.ts";
import { DummyResult, type ExtCtxt, MacEager, type MacroExpanderResult } from "../rustc_expand/base.ts";
import { exp } from "../rustc_parse/parser/token_type.ts";
import { Recovery } from "../rustc_parse/parser/mod.gen.ts";
import type { ErrorGuaranteed } from "../rustc_errors/lib.ts";
import type { Span } from "../rustc_span/lib.ts";
import { sym } from "../rustc_span/symbol.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import * as diagnostics from "./diagnostics.ts";

// rustc: compiler/rustc_builtin_macros/src/cfg.rs:21 expand_cfg
export function expand_cfg(cx: ExtCtxt, sp_: Span, tts: TokenStream): MacroExpanderResult {
  const sp = cx.with_def_site_ctxt(sp_);

  const r = parse_cfg(cx, sp, tts);
  let res;
  if (r.$ === "Ok") {
    const cfg = r._0;
    const matches_cfg = EvalConfigResult.as_bool(eval_config_entry(cx.sess, cfg));

    res = MacEager.expr(cx.expr_bool(sp, matches_cfg));
  } else {
    res = DummyResult.any(sp, r._0);
  }
  return { $: "Ready", _0: res };
}

// rustc: compiler/rustc_builtin_macros/src/cfg.rs:38 parse_cfg
function parse_cfg(cx: ExtCtxt, span: Span, tts: TokenStream): Result<CfgEntry, ErrorGuaranteed> {
  const parser = cx.new_parser_from_tts(tts);
  if (parser.token.eq(token.TokenKind.Eof)) {
    return Err(cx.dcx().emit_err(diagnostics.RequiresCfgPattern_diagnostic({ span })));
  }

  const meta_r = MetaItemOrLitParser.parse_single(
    parser,
    { $: "ErrorsAndLints", recovery: Recovery.Allowed },
    AllowExprMetavar.Yes,
  );
  if (meta_r.$ === "Err") return Err(meta_r._0.emit_err());
  const meta = meta_r._0;
  const cfg_r = AttributeParser.parse_single_args(
    cx.sess,
    span,
    span,
    ast.AttrStyle.Inner,
    new AttrPath([sym.cfg], span),
    undefined,
    AttributeSafety.Normal,
    ParsedDescription.Macro,
    span,
    cx.current_expansion.lint_node_id,
    // Doesn't matter what the target actually is here.
    Target.Crate,
    cx.ecfg.features,
    { $: "ErrorsAndLints", recovery: Recovery.Allowed },
    meta,
    parse_cfg_entry,
    CFG_TEMPLATE,
  );
  if (cfg_r.$ === "Err") return cfg_r;
  const cfg = cfg_r._0;

  parser.eat(exp.Comma);

  if (!parser.eat(exp.Eof)) {
    return Err(cx.dcx().emit_err(diagnostics.OneCfgPattern_diagnostic({ span })));
  }

  return Ok(cfg);
}
