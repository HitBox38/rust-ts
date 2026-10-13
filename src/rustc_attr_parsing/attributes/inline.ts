// Port of compiler/rustc_attr_parsing/src/attributes/inline.rs
//
// PORT (shared by the attribute-parser modules of lane attr-parse-c):
// - `use super::prelude::*;`: the items are imported from their defining modules (prelude.ts is
//   lane attr-parse-d's). `Policy::{Allow, Error, Warn}` are written as the variant literals
//   (`{ $: "Allow", _0: Target.Fn }`).
// - `unstable!(feat, notes..)` is `unstable(sym.feat, ..notes)` from ../stability.ts.
// - `find_attr!(attrs, Pat)` is `find_attr(attrs, (k) => (k matches Pat ? value : undefined))`.
import { type Attribute, AttributeKind, find_attr, InlineAttr, target as target_mod } from "../../rustc_attr_ir/lib.ts";
import { AttributeStability } from "../../rustc_feature/lib.ts";
import { ILL_FORMED_ATTRIBUTE_INPUT, UNUSED_ATTRIBUTES } from "../../rustc_lint_defs/builtin.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { sym } from "../../rustc_span/symbol.ts";
import { ExpectStringLiteral } from "../context.ts";
import { InlineForceInlineConflict_diagnostic, InlineIgnoredForExported_diagnostic } from "../diagnostics.ts";
import { MetaItemOrLitParser } from "../parser.ts";
import { unstable } from "../stability.ts";
import { template } from "../template.ts";
import { OnDuplicate, type SingleAttributeParser, SingleAttributeParser_provided } from "./mod.ts";

const { Target, MethodKind, AssocCtxt } = target_mod;

export const InlineParser: SingleAttributeParser = SingleAttributeParser_provided({
  PATH: [sym.inline],
  ON_DUPLICATE: OnDuplicate.WarnButFutureError,
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      { $: "Allow", _0: Target.Fn },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.Inherent } },
      { $: "Allow", _0: { $: "Method", _0: { $: "Trait", body: true } } },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.TraitImpl } },
      { $: "Allow", _0: Target.Closure },
      { $: "Allow", _0: { $: "Delegation", mac: false } },
      { $: "Warn", _0: { $: "Method", _0: { $: "Trait", body: false } } },
      { $: "Warn", _0: Target.ForeignFn },
      { $: "Warn", _0: Target.Field },
      { $: "Warn", _0: Target.MacroDef },
      { $: "Warn", _0: Target.Arm },
      { $: "Warn", _0: { $: "AssocConst", _0: { $: "Impl", of_trait: false } } },
      { $: "Warn", _0: { $: "AssocConst", _0: AssocCtxt.Trait } },
      { $: "Warn", _0: { $: "AssocConst", _0: { $: "Impl", of_trait: true } } },
      { $: "Warn", _0: Target.MacroCall },
    ],
  },
  TEMPLATE: template(
    { Word: true, List: ["always", "never"] },
    "https://doc.rust-lang.org/reference/attributes/codegen.html#the-inline-attribute",
  ),
  STABILITY: AttributeStability.Stable,

  // rustc: compiler/rustc_attr_parsing/src/attributes/inline.rs:37 convert
  convert(cx, args) {
    switch (args.$) {
      case "NoArgs":
        return { $: "Inline", _0: InlineAttr.Hint, _1: cx.attr_span };
      case "List": {
        const list = args._0;
        const l = cx.expect_single(list);
        if (l === undefined) return undefined;

        const i = MetaItemOrLitParser.meta_item_no_args(l);
        switch (i === undefined ? undefined : i.path().word_sym()) {
          case sym.always: {
            return { $: "Inline", _0: InlineAttr.Always, _1: cx.attr_span };
          }
          case sym.never: {
            return { $: "Inline", _0: InlineAttr.Never, _1: cx.attr_span };
          }
          default: {
            cx.adcx().expected_specific_argument(MetaItemOrLitParser.span(l), [sym.always, sym.never]);
            return undefined;
          }
        }
      }
      case "NameValue": {
        cx.adcx().warn_ill_formed_attribute_input(ILL_FORMED_ATTRIBUTE_INPUT);
        return undefined;
      }
    }
  },

  // rustc: compiler/rustc_attr_parsing/src/attributes/inline.rs:63 finalize_check
  finalize_check(cx, attr_span) {
    const exported = cx.parsed_attrs.some((attr: Attribute) => {
      if (attr.$ !== "Parsed") return false;
      const kind = attr._0;
      return AttributeKind.is_extern_indicator(kind);
    });
    const target = cx.shared.target;
    if (
      (target.$ === "Fn" ||
        target.$ === "Closure" ||
        (target.$ === "Method" &&
          ((target._0.$ === "Trait" && target._0.body === true) || target._0.$ === "TraitImpl" || target._0.$ === "Inherent"))) &&
      find_attr(cx.parsed_attrs, (k) => (k.$ === "Inline" && k._0.$ === "Never" ? true : undefined)) === undefined &&
      exported
    ) {
      cx.shared.emit_lint(UNUSED_ATTRIBUTES, InlineIgnoredForExported_diagnostic({}), attr_span);
    }
  },
});

export const RustcForceInlineParser: SingleAttributeParser = SingleAttributeParser_provided({
  PATH: [sym.rustc_force_inline],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      { $: "Allow", _0: Target.Fn },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.Inherent } },
    ],
  },
  STABILITY: unstable(sym.rustc_attrs, "the `rustc_force_inline` attribute forces a free function to be inlined"),
  TEMPLATE: template({ Word: true, List: ["reason"], NameValueStr: ["reason"] }),

  // rustc: compiler/rustc_attr_parsing/src/attributes/inline.rs:97 convert
  convert(cx, args) {
    let reason;
    switch (args.$) {
      case "NoArgs":
        reason = undefined;
        break;
      case "List": {
        const list = args._0;
        const l = cx.expect_single(list);
        if (l === undefined) return undefined;

        const reason_ = cx.expect_string_literal(l, ExpectStringLiteral.MetaItemOrLitParser);
        if (reason_ === undefined) return undefined;

        reason = reason_;
        break;
      }
      case "NameValue": {
        const v = args._0;
        reason = cx.expect_string_literal(v, ExpectStringLiteral.NameValueParser);
        break;
      }
    }

    return {
      $: "Inline",
      _0: { $: "Force", attr_span: cx.attr_span, reason },
      _1: cx.attr_span,
    };
  },

  // rustc: compiler/rustc_attr_parsing/src/attributes/inline.rs:116 finalize_check
  finalize_check(cx, attr_span) {
    const inline_span: Span | undefined = find_attr(cx.parsed_attrs, (k) =>
      k.$ === "Inline" && !(k._0.$ === "Force") ? k._1 : undefined,
    );
    if (inline_span === undefined) {
      return;
    }

    cx.shared.emit_err(
      InlineForceInlineConflict_diagnostic({
        inline_span: inline_span,
        force_inline_span: attr_span,
      }),
    );
  },
});
