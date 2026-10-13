//! Meta-syntax validation logic of attributes for post-expansion.
// Port of compiler/rustc_attr_parsing/src/validate_attr.rs
//
// PORT:
// - `BUILTIN_ATTRIBUTE_SET.get(&name)` returns the set's own copy of `name`; for an interned `Symbol`
//   that is `name` itself.
// - `psess.dyn_buffer_lint(.., move |dcx, level| ..)` -> a closure over a copy of `suggestions`.
import * as ast from "../rustc_ast/lib.ts";
import { CRATE_NODE_ID } from "../rustc_ast/node_id.ts";
import { MetaItemLit as MetaItemLitC } from "../rustc_ast/util/literal.ts";
import { AttrPath } from "../rustc_attr_ir/lib.ts";
import { Applicability, type PResult } from "../rustc_errors/lib.ts";
import { BUILTIN_ATTRIBUTE_SET } from "../rustc_feature/lib.ts";
import { ILL_FORMED_ATTRIBUTE_INPUT } from "../rustc_lint_defs/builtin.ts";
import { parse_in } from "../rustc_parse/lib.ts";
import { report_lit_error } from "../rustc_session/diagnostics.ts";
import type { ParseSess } from "../rustc_session/parse.ts";
import type { DelimSpan } from "../rustc_ast/tokenstream.ts";
import type { Delimiter } from "../rustc_ast/token.ts";
import type { Span } from "../rustc_span/lib.ts";
import { display_Symbol, type Symbol, sym } from "../rustc_span/symbol.ts";
import { str_cmp } from "../rustc_session/options.ts";
import { assert } from "../std/panic.ts";
import { Err, Ok } from "../std/result.ts";
import * as errors from "./diagnostics.ts";
import { AttributeParser } from "./interface.ts";
import { type AttributeTemplate, template } from "./template.ts";

// rustc: compiler/rustc_attr_parsing/src/validate_attr.rs:23 check_attr
export function check_attr(psess: ParseSess, attr: ast.Attribute): void {
  // use ast::SyntheticAttr::*;
  switch (attr.kind.$) {
    case "Normal":
      break;
    case "Synthetic": // CfgTrace(_) | CfgAttrTrace(_)
    case "DocComment":
      return;
  }

  const n = attr.name();
  const builtin_attr_info = n !== undefined && BUILTIN_ATTRIBUTE_SET().has(n) ? n : undefined;

  // Check input tokens for built-in and key-value attributes.
  if (builtin_attr_info !== undefined) {
    const name = builtin_attr_info;
    if (AttributeParser.is_parsed_attribute([name])) {
      return;
    }
    const r = parse_meta(psess, attr);
    switch (r.$) {
      // Don't check safety again, we just did that
      case "Ok": {
        const meta = r._0;
        // FIXME The only unparsed builtin attributes that are left are the lint attributes, so we can hardcode the template here
        const lint_attrs = [sym.forbid, sym.allow, sym.warn, sym.deny, sym.expect];
        assert(lint_attrs.includes(name), "assertion failed: lint_attrs.contains(name)");

        const template_ = template(
          { List: ["lint1", "lint1, lint2, ...", 'lint1, lint2, lint3, reason = "..."'] },
          "https://doc.rust-lang.org/reference/attributes/diagnostics.html#lint-check-attributes",
        );
        check_builtin_meta_item(psess, meta, attr.style, name, template_, false);
        break;
      }
      case "Err": {
        const err = r._0;
        err.emit();
        break;
      }
    }
  } else {
    const attr_item = attr.get_normal_item();
    if (attr_item.args.$ === "Eq") {
      // All key-value attributes are restricted to meta-item syntax.
      const r = parse_meta(psess, attr);
      switch (r.$) {
        case "Ok":
          break;
        case "Err": {
          const err = r._0;
          err.emit();
          break;
        }
      }
    }
  }
}

// rustc: compiler/rustc_attr_parsing/src/validate_attr.rs:68 parse_meta
export function parse_meta(psess: ParseSess, attr: ast.Attribute): PResult<ast.MetaItem> {
  const item = attr.get_normal_item();
  let kind: ast.MetaItemKind;
  const args = item.args;
  switch (args.$) {
    case "Empty":
      kind = ast.MetaItemKind.Word;
      break;
    case "Delimited": {
      const { dspan, delim, tokens } = args._0;
      check_meta_bad_delim(psess, dspan, delim);
      // PORT: `tokens.clone()` (an `Arc` clone) shares the trees (tokenstream.ts convention).
      const nmis = parse_in(psess, new ast.tokenstream.TokenStream(tokens._0), "meta list", (p) => p.parse_meta_seq_top());
      if (nmis.$ === "Err") return nmis;
      kind = { $: "List", _0: nmis._0 };
      break;
    }
    case "Eq": {
      const expr = args.expr;
      if (expr.kind.$ === "Lit") {
        const token_lit = expr.kind._0;
        const res = MetaItemLitC.from_token_lit(token_lit, expr.span);

        switch (res.$) {
          case "Ok": {
            const lit = res._0;
            if (token_lit.suffix !== undefined) {
              const err = psess.dcx().struct_span_err(expr.span, "suffixed literals are not allowed in attributes");
              err.help(
                "instead of using a suffixed literal (`1u8`, `1.0f32`, etc.), " +
                  "use an unsuffixed version (`1`, `1.0`, etc.)",
              );
              return Err(err);
            }
            kind = { $: "NameValue", _0: lit };
            break;
          }
          case "Err": {
            const err = res._0;
            const guar = report_lit_error(psess, err, token_lit, expr.span);
            const lit = new ast.MetaItemLit(token_lit.symbol, token_lit.suffix, { $: "Err", _0: guar }, expr.span);
            kind = { $: "NameValue", _0: lit };
            break;
          }
        }
      } else {
        // Example cases:
        // - `#[foo = 1+1]`: results in `ast::ExprKind::Binary`.
        // - `#[foo = include_str!("nonexistent-file.rs")]`:
        //   results in `ast::ExprKind::Err`. In that case we delay
        //   the error because an earlier error will have already
        //   been reported.
        const msg = "attribute value must be a literal";
        const err = psess.dcx().struct_span_err(expr.span, msg);
        if (expr.kind.$ === "Err") {
          err.downgrade_to_delayed_bug();
        }
        return Err(err);
      }
      break;
    }
  }
  return Ok(new ast.MetaItem(ast.clone_Safety(item.unsafety), ast.clone_Path(item.path), kind, attr.span));
}

// rustc: compiler/rustc_attr_parsing/src/validate_attr.rs:131 check_meta_bad_delim
function check_meta_bad_delim(psess: ParseSess, span: DelimSpan, delim: Delimiter): void {
  if (delim.$ === "Parenthesis") {
    return;
  }
  psess.dcx().emit_err(
    errors.MetaBadDelim_diagnostic({
      span: span.entire(),
      sugg: { open: span.open, close: span.close },
    }),
  );
}

/// Checks that the given meta-item is compatible with this `AttributeTemplate`.
// rustc: compiler/rustc_attr_parsing/src/validate_attr.rs:142 is_attr_template_compatible
function is_attr_template_compatible(template: AttributeTemplate, meta: ast.MetaItemKind): boolean {
  const is_one_allowed_subword = (items: readonly ast.MetaItemInner[]): boolean => {
    if (items.length === 1) {
      const item = items[0]!;
      return ast.MetaItemInner.is_word(item) && template.one_of.some((word) => ast.MetaItemInner.has_name(item, word));
    }
    return false;
  };
  switch (meta.$) {
    case "Word":
      return template.word;
    case "List":
      return template.list !== undefined || is_one_allowed_subword(meta._0);
    case "NameValue":
      if (ast.LitKind.is_str(meta._0.kind)) return template.name_value_str !== undefined;
      return false;
  }
}

// rustc: compiler/rustc_attr_parsing/src/validate_attr.rs:155 check_builtin_meta_item
export function check_builtin_meta_item(
  psess: ParseSess,
  meta: ast.MetaItem,
  style: ast.AttrStyle,
  name: Symbol,
  template: AttributeTemplate,
  deny_unsafety: boolean,
): void {
  if (!is_attr_template_compatible(template, meta.kind)) {
    // attrs with new parsers are locally validated so excluded here
    emit_malformed_attribute(psess, style, meta.span, name, template);
  }

  if (deny_unsafety && meta.unsafety.$ === "Unsafe") {
    const unsafe_span = meta.unsafety._0;
    psess.dcx().emit_err(
      errors.InvalidAttrUnsafe_diagnostic({
        span: unsafe_span,
        name: AttrPath.from_ast(meta.path, (x) => x),
      }),
    );
  }
}

// rustc: compiler/rustc_attr_parsing/src/validate_attr.rs:176 emit_malformed_attribute
export function emit_malformed_attribute(
  psess: ParseSess,
  style: ast.AttrStyle,
  span: Span,
  name: Symbol,
  template: AttributeTemplate,
): void {
  // Some of previously accepted forms were used in practice,
  // report them as warnings for now.
  const should_warn = (name: Symbol): boolean =>
    name === sym.doc || name === sym.link || name === sym.test || name === sym.bench;

  const name_ = display_Symbol(name);
  const error_msg = `malformed \`${name_}\` attribute input`;
  const suggestions: string[] = [];
  const inner = style === "Inner" ? "!" : "";
  if (template.word) {
    suggestions.push(`#${inner}[${name_}]`);
  }
  if (template.list !== undefined) {
    const descr = template.list;
    for (const descr_ of descr) {
      suggestions.push(`#${inner}[${name_}(${descr_})]`);
    }
  }
  for (const word of template.one_of) {
    suggestions.push(`#${inner}[${name_}(${display_Symbol(word)})]`);
  }
  if (template.name_value_str !== undefined) {
    const descr = template.name_value_str;
    for (const descr_ of descr) {
      suggestions.push(`#${inner}[${name_} = "${descr_}"]`);
    }
  }
  // If there are too many suggestions, better remove all of them as it's just noise at this
  // point.
  if (suggestions.length > 3) {
    suggestions.length = 0;
  }
  if (should_warn(name)) {
    const suggestions_ = suggestions.slice();
    psess.dyn_buffer_lint(ILL_FORMED_ATTRIBUTE_INPUT, span, CRATE_NODE_ID, (dcx, level) =>
      errors.IllFormedAttributeInput_into_diag(errors.IllFormedAttributeInput.new(suggestions_, template.docs, undefined), dcx, level),
    );
  } else {
    suggestions.sort(str_cmp);
    const err = psess
      .dcx()
      .struct_span_err(span, error_msg)
      .with_span_suggestions(
        span,
        suggestions.length === 1 ? "must be of the form" : "the following are the possible correct uses",
        suggestions,
        Applicability.HasPlaceholders,
      );
    if (template.docs !== undefined) {
      const link = template.docs;
      err.note(`for more information, visit <${link}>`);
    }
    err.emit();
  }
}
