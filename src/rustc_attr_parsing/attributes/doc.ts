// Port of compiler/rustc_attr_parsing/src/attributes/doc.rs
// (Conventions for `use super::prelude::*` / `unstable!`: see inline.ts.)
//
// PORT:
// - `DocParser`'s state is an interface; the inherent `impl DocParser` is `DocParser_inherent`
//   (methods take the state as their first parameter), spread into the parser's table (see
//   repr.ts). The derived `Debug` of `DocParser` is not used by the crate and is not provided.
// - `&mut Option<_>` / `&mut CfgEntry` places are `MutRef` views (`field_mut`).
// - The `macro_rules!` helpers of `parse_single_doc_attr_item` (`no_args!`, ...) are local closures;
//   every use is the tail of its `match` arm, so the macros' `return` is the closure's.
// - `for cfg_name in &cfg_names` iterates an `FxHashSet` (hashbrown order, which depends on the
//   FxHash of the symbols); with more than one name that order is unported (precedent:
//   rust_ts/hash_map.ts `debug_HashMap`).
import type { CfgEntry } from "../../rustc_ast/attr/data_structures.ts";
import type { MetaItemLit } from "../../rustc_ast/lib.ts";
import {
  type CfgHideShow,
  default_DocAttribute,
  type DocAttribute,
  DocCfgHideShow,
  DocCfgHideShowValue,
  type DocInline,
  type HideOrShow,
  clone_DocCfgHideShow,
} from "../../rustc_attr_ir/lib.ts";
import { MultiSpan, msg } from "../../rustc_errors/lib.ts";
import { AttributeStability, BUILTIN_ATTRIBUTE_SET } from "../../rustc_feature/lib.ts";
import { INVALID_DOC_ATTRIBUTES, UNUSED_ATTRIBUTES } from "../../rustc_lint_defs/builtin.ts";
import { LATEST_STABLE_EDITION } from "../../rustc_span/edition.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { Symbol, sym } from "../../rustc_span/symbol.ts";
import { is_whitespace } from "../../std/char.ts";
import { field_mut, type MutRef } from "../../std/mut_ref.ts";
import { unported, unreachable, unwrap } from "../../std/panic.ts";
import { type AcceptContext, ExpectStringLiteral } from "../context.ts";
import {
  AttrCrateLevelOnly_diagnostic,
  DocAliasBadChar_diagnostic,
  DocAliasDuplicated_diagnostic,
  DocAliasEmpty_diagnostic,
  DocAliasMalformed_diagnostic,
  DocAliasStartEnd_diagnostic,
  DocAttrNotCrateLevel_diagnostic,
  DocAttributeNotAttribute_diagnostic,
  DocAutoCfgExpectsHideOrShow_diagnostic,
  DocAutoCfgHideShowExpectsList_diagnostic,
  DocAutoCfgHideShowNoIdentBeforeValues_diagnostic,
  DocAutoCfgHideShowUnexpectedItem_diagnostic,
  DocAutoCfgHideShowUnexpectedItemAfterValues_diagnostic,
  DocAutoCfgHideShowValuesMix_diagnostic,
  DocAutoCfgWrongLiteral_diagnostic,
  DocInlineConflict_diagnostic,
  DocInlineOnlyUse_diagnostic,
  DocKeywordNotKeyword_diagnostic,
  DocTestLiteral_diagnostic,
  DocTestTakesList_diagnostic,
  DocTestUnknown_diagnostic,
  DocUnknownAny_diagnostic,
  DocUnknownInclude_diagnostic,
  DocUnknownPasses_diagnostic,
  DocUnknownPlugins_diagnostic,
  DocUnknownSpotlight_diagnostic,
  ExpectedNameValue_diagnostic,
  ExpectedNoArgs_diagnostic,
  IllFormedAttributeInput,
  IllFormedAttributeInput_diagnostic,
  MalformedDoc_diagnostic,
  UnusedDuplicate_diagnostic,
} from "../diagnostics.ts";
import { ArgParser, type MetaItemListParser, MetaItemOrLitParser, type MetaItemParser, type OwnedPathParser } from "../parser.ts";
import { ALL_TARGETS } from "../target_checking.ts";
import { unstable } from "../stability.ts";
import { template } from "../template.ts";
import { type AttributeParser, AttributeParser_provided } from "./mod.ts";
import { parse_cfg as cfg_parse_cfg } from "./cfg.ts";

// rustc: compiler/rustc_attr_parsing/src/attributes/doc.rs:30 check_keyword
function check_keyword(cx: AcceptContext, keyword: Symbol, span: Span): boolean {
  // FIXME: Once rustdoc can handle URL conflicts on case insensitive file systems, we
  // can remove the `SelfTy` case here, remove `sym::SelfTy`, and update the
  // `#[doc(keyword = "SelfTy")` attribute in `library/std/src/keyword_docs.rs`.
  if (Symbol.is_reserved(keyword, () => LATEST_STABLE_EDITION) || Symbol.is_weak(keyword) || keyword === sym.SelfTy) {
    return true;
  }
  cx.shared.emit_err(DocKeywordNotKeyword_diagnostic({ span, keyword }));
  return false;
}

// rustc: compiler/rustc_attr_parsing/src/attributes/doc.rs:44 check_attribute
function check_attribute(cx: AcceptContext, attribute: Symbol, span: Span): boolean {
  // FIXME: This should support attributes with namespace like `diagnostic::do_not_recommend`.
  if (BUILTIN_ATTRIBUTE_SET().has(attribute)) {
    return true;
  }
  cx.shared.emit_err(DocAttributeNotAttribute_diagnostic({ span, attribute }));
  return false;
}

/// Checks that an attribute is *not* used at the crate level. Returns `true` if valid.
// rustc: compiler/rustc_attr_parsing/src/attributes/doc.rs:54 check_attr_not_crate_level
function check_attr_not_crate_level(cx: AcceptContext, span: Span, attr_name: Symbol): boolean {
  if (cx.shared.target.$ === "Crate") {
    cx.shared.emit_err(DocAttrNotCrateLevel_diagnostic({ span, attr_name }));
    return false;
  }
  return true;
}

/// Checks that an attribute is used at the crate level. Returns `true` if valid.
// rustc: compiler/rustc_attr_parsing/src/attributes/doc.rs:67 check_attr_crate_level
function check_attr_crate_level(cx: AcceptContext, span: Span): boolean {
  if (cx.shared.target.$ !== "Crate") {
    cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, AttrCrateLevelOnly_diagnostic({}), span);
    return false;
  }
  return true;
}

// FIXME: To be removed once merged and replace with `cx.expected_name_value(span, _name)`.
// rustc: compiler/rustc_attr_parsing/src/attributes/doc.rs:76 expected_name_value
function expected_name_value(cx: AcceptContext, span: Span, _name: Symbol | undefined): void {
  cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, ExpectedNameValue_diagnostic({}), span);
}

// FIXME: remove this method once merged and use `cx.expected_no_args(span)` instead.
// rustc: compiler/rustc_attr_parsing/src/attributes/doc.rs:81 expected_no_args
function expected_no_args(cx: AcceptContext, span: Span): void {
  cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, ExpectedNoArgs_diagnostic({}), span);
}

// FIXME: remove this method once merged and use `cx.expected_no_args(span)` instead.
// cx.expected_string_literal(span, _actual_literal);
// rustc: compiler/rustc_attr_parsing/src/attributes/doc.rs:87 expected_string_literal
function expected_string_literal(cx: AcceptContext, span: Span, _actual_literal: MetaItemLit | undefined): void {
  cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, MalformedDoc_diagnostic({}), span);
}

// rustc: compiler/rustc_attr_parsing/src/attributes/doc.rs:95 parse_keyword_and_attribute
function parse_keyword_and_attribute(
  cx: AcceptContext,
  path: OwnedPathParser,
  args: ArgParser,
  attr_value: MutRef<[Symbol, Span] | undefined>,
  attr_name: Symbol,
): void {
  const nv = ArgParser.as_name_value(args);
  if (nv === undefined) {
    expected_name_value(cx, ArgParser.span(args) ?? path.span(), path.word_sym());
    return;
  }

  const value = nv.value_as_str();
  if (value === undefined) {
    expected_string_literal(cx, nv.value_span, nv.value_as_lit());
    return;
  }

  const ret = attr_name === sym.keyword ? check_keyword(cx, value, nv.value_span) : check_attribute(cx, value, nv.value_span);
  if (!ret) {
    return;
  }

  const span = path.span();
  if (attr_value.value !== undefined) {
    cx.adcx().duplicate_key(span, unwrap(path.word_sym()));
    return;
  }

  if (!check_attr_not_crate_level(cx, span, attr_name)) {
    return;
  }

  attr_value.value = [value, span];
}

/** `#[derive(Default, Debug)] pub(crate) struct DocParser` */
export interface DocParser {
  attribute: DocAttribute;
  nb_doc_attrs: number;
}

/** `impl DocParser` */
const DocParser_inherent = {
  // rustc: compiler/rustc_attr_parsing/src/attributes/doc.rs:141 parse_single_test_doc_attr_item
  parse_single_test_doc_attr_item(self: DocParser, cx: AcceptContext, mip: MetaItemParser): void {
    const path = mip.path();
    const args = mip.args();

    const name = path.word_sym();
    if (name === sym.no_crate_inject) {
      const r = ArgParser.as_no_args(args);
      if (r.$ === "Err") {
        const span = r._0;
        expected_no_args(cx, span);
        return;
      }

      if (self.attribute.no_crate_inject !== undefined) {
        const used_span = self.attribute.no_crate_inject;
        const unused_span = path.span();
        cx.shared.emit_lint(
          INVALID_DOC_ATTRIBUTES,
          UnusedDuplicate_diagnostic({ this: unused_span, other: used_span, warning: true }),
          unused_span,
        );
        return;
      }

      if (!check_attr_crate_level(cx, path.span())) {
        return;
      }

      self.attribute.no_crate_inject = path.span();
    } else if (name === sym.attr) {
      const list = ArgParser.as_list(args);
      if (list === undefined) {
        // FIXME: remove this method once merged and uncomment the line below instead.
        // cx.expected_list(cx.attr_span, args);
        const span = cx.attr_span;
        cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, MalformedDoc_diagnostic({}), span);
        return;
      }

      // FIXME: convert list into a Vec of `AttributeKind` because current code is awful.
      for (const attr of list.mixed()) {
        // Arguments of `attr` are checked via the span, so can be safely ignored
        MetaItemOrLitParser.ignore_args(attr);
        self.attribute.test_attrs.push(MetaItemOrLitParser.span(attr));
      }
    } else if (name !== undefined) {
      cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, DocTestUnknown_diagnostic({ name }), path.span());
    } else {
      cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, DocTestLiteral_diagnostic({}), path.span());
    }
  },

  // rustc: compiler/rustc_attr_parsing/src/attributes/doc.rs:197 add_alias
  add_alias(self: DocParser, cx: AcceptContext, alias: Symbol, span: Span): void {
    const attr_str = '`#[doc(alias = "...")]`';
    if (alias === sym.empty) {
      cx.shared.emit_err(DocAliasEmpty_diagnostic({ span, attr_str }));
      return;
    }

    const alias_str = Symbol.as_str(alias);
    let c: number | undefined = undefined;
    for (const ch of alias_str) {
      const cp = ch.codePointAt(0)!;
      if (cp === 0x22 /* '"' */ || cp === 0x27 /* '\'' */ || (is_whitespace(cp) && cp !== 0x20)) {
        c = cp;
        break;
      }
    }
    if (c !== undefined) {
      cx.shared.emit_err(DocAliasBadChar_diagnostic({ span, attr_str, char_: c }));
      return;
    }
    if (alias_str.startsWith(" ") || alias_str.endsWith(" ")) {
      cx.shared.emit_err(DocAliasStartEnd_diagnostic({ span, attr_str }));
      return;
    }
    if (!check_attr_not_crate_level(cx, span, sym.alias)) {
      return;
    }

    const first_definition = self.attribute.aliases.get(alias);
    if (first_definition !== undefined) {
      cx.shared.emit_lint(UNUSED_ATTRIBUTES, DocAliasDuplicated_diagnostic({ first_definition }), span);
    }

    self.attribute.aliases.set(alias, span);
  },

  // rustc: compiler/rustc_attr_parsing/src/attributes/doc.rs:226 parse_alias
  parse_alias(self: DocParser, cx: AcceptContext, path: OwnedPathParser, args: ArgParser): void {
    switch (args.$) {
      case "NoArgs": {
        cx.shared.emit_err(DocAliasMalformed_diagnostic({ span: ArgParser.span(args) ?? path.span() }));
        break;
      }
      case "List": {
        const list = args._0;
        for (const i of list.mixed()) {
          const alias = cx.expect_string_literal(i, ExpectStringLiteral.MetaItemOrLitParser);
          if (alias === undefined) {
            continue;
          }

          DocParser_inherent.add_alias(self, cx, alias, MetaItemOrLitParser.span(i));
        }
        break;
      }
      case "NameValue": {
        const nv = args._0;
        const alias = cx.expect_string_literal(nv, ExpectStringLiteral.NameValueParser);
        if (alias === undefined) {
          return;
        }
        DocParser_inherent.add_alias(self, cx, alias, nv.value_span);
        break;
      }
    }
  },

  // rustc: compiler/rustc_attr_parsing/src/attributes/doc.rs:254 parse_inline
  parse_inline(self: DocParser, cx: AcceptContext, path: OwnedPathParser, args: ArgParser, inline: DocInline): void {
    const r = ArgParser.as_no_args(args);
    if (r.$ === "Err") {
      const span = r._0;
      expected_no_args(cx, span);
      return;
    }

    const span = path.span();
    if (self.attribute.inline !== undefined) {
      const [previous_inline, previous_span] = self.attribute.inline;
      if (previous_inline !== inline) {
        const spans = MultiSpan.from_spans([previous_span, span]);
        spans.push_span_label(previous_span, msg("this attribute..."));
        spans.push_span_label(span, msg('{"."}..conflicts with this attribute'));
        cx.shared.emit_err(DocInlineConflict_diagnostic({ spans }));
      }
    } else {
      self.attribute.inline = [inline, span];
    }

    switch (cx.shared.target.$) {
      case "Use":
      case "ExternCrate":
        break;
      default: {
        const item_span = cx.shared.target_span;
        cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, DocInlineOnlyUse_diagnostic({ attr_span: span, item_span }), span);
      }
    }
  },

  // rustc: compiler/rustc_attr_parsing/src/attributes/doc.rs:291 parse_cfg
  parse_cfg(self: DocParser, cx: AcceptContext, args: ArgParser): void {
    // This function replaces cases like `cfg(all())` with `true`.
    // rustc: compiler/rustc_attr_parsing/src/attributes/doc.rs:293 simplify_cfg
    function simplify_cfg(cfg_entry: MutRef<CfgEntry>): void {
      const e = cfg_entry.value;
      if (e.$ === "All" && e._0.length === 0) {
        const span = e._1;
        cfg_entry.value = { $: "Bool", _0: true, _1: span };
      } else if (e.$ === "Any" && e._0.length === 0) {
        const span = e._1;
        cfg_entry.value = { $: "Bool", _0: false, _1: span };
      } else if (e.$ === "Not") {
        simplify_cfg(field_mut(e, "_0"));
      } else {
        // _ => {}
      }
    }
    const cfg_entry = cfg_parse_cfg(cx, args);
    if (cfg_entry !== undefined) {
      const cfg_entry_: MutRef<CfgEntry> = { value: cfg_entry };
      simplify_cfg(cfg_entry_);
      self.attribute.cfg.push(cfg_entry_.value);
    }
  },

  // Parses the `doc(auto_cfg(hide/show(..., values())))` attribute.
  // rustc: compiler/rustc_attr_parsing/src/attributes/doc.rs:312 parse_auto_cfg_values
  parse_auto_cfg_values(self: DocParser, cx: AcceptContext, list: MetaItemListParser, values: MutRef<DocCfgHideShow | undefined>): void {
    const cfg_values: MutRef<DocCfgHideShow> = { value: DocCfgHideShow.new() };

    const values_set = new Set<Symbol>();
    for (const item of list.mixed()) {
      if (item.$ === "Lit" && item._0.kind.$ === "Str") {
        // If it's a string literal, all good.
        const symbol = item._0.kind._0;
        const span = item._0.span;
        const v = cfg_values.value;
        switch (v.$) {
          case "Any": {
            const any_span = v._0;
            cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, DocAutoCfgHideShowValuesMix_diagnostic({ value_span: span }), any_span);
            break;
          }
          case "List": {
            const symbols = v._0;
            if (!values_set.has(symbol)) {
              values_set.add(symbol);
              symbols.push(DocCfgHideShowValue.new(symbol, span));
            }
            break;
          }
        }
      } else if (item.$ === "Lit") {
        // If it's any other kind of literal, then it's wrong and we emit a lint.
        const lit = item._0;
        cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, DocAutoCfgHideShowUnexpectedItem_diagnostic({ attr_name: lit.symbol }), lit.span);
      } else {
        // If it's a list, then only `any()` and `none()` are allowed and they must not
        // contain any item.
        const sub_item = item._0;
        const ident = sub_item.ident();
        if (ident === undefined) {
          cx.adcx().expected_identifier(sub_item.path().span());
          continue;
        }
        const sub_args = sub_item.args();
        if ([sym.any, sym.none].includes(ident.name) && sub_args.$ === "List" && sub_args._0.len() === 0) {
          if (ident.name === sym.any) {
            const v = cfg_values.value;
            const value = v.$ === "List" ? v._0[0] : undefined;
            if (value !== undefined) {
              cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, DocAutoCfgHideShowValuesMix_diagnostic({ value_span: value.span }), sub_item.span());
            } else {
              DocCfgHideShow.merge_with(cfg_values, { $: "Any", _0: sub_item.span() });
            }
          } else {
            DocCfgHideShow.push_none(cfg_values.value, sub_item.span());
          }
        } else {
          cx.shared.emit_lint(
            INVALID_DOC_ATTRIBUTES,
            DocAutoCfgHideShowUnexpectedItem_diagnostic({ attr_name: ident.name }),
            sub_item.span(),
          );
        }
      }
    }
    values.value = cfg_values.value;
  },

  // rustc: compiler/rustc_attr_parsing/src/attributes/doc.rs:387 parse_auto_cfg
  parse_auto_cfg(self: DocParser, cx: AcceptContext, path: OwnedPathParser, args: ArgParser): void {
    switch (args.$) {
      case "NoArgs": {
        self.attribute.auto_cfg_change.push([true, path.span()]);
        break;
      }
      case "List": {
        const list = args._0;
        main: for (const meta of list.mixed()) {
          if (meta.$ !== "MetaItemParser") {
            cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, DocAutoCfgExpectsHideOrShow_diagnostic({}), MetaItemOrLitParser.span(meta));
            continue;
          }
          const item = meta._0;
          // Only `hide` and `show` are allowed in `auto_cfg` if it's a list, and both
          // must be a list.
          let kind: HideOrShow;
          let attr_name: Symbol;
          switch (item.path().word_sym()) {
            case sym.hide:
              [kind, attr_name] = ["Hide", sym.hide];
              break;
            case sym.show:
              [kind, attr_name] = ["Show", sym.show];
              break;
            default: {
              cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, DocAutoCfgExpectsHideOrShow_diagnostic({}), item.span());
              continue;
            }
          }
          const item_args = item.args();
          if (item_args.$ !== "List") {
            cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, DocAutoCfgHideShowExpectsList_diagnostic({ attr_name }), item.span());
            continue;
          }
          const list = item_args._0;

          const cfg_hide_show: CfgHideShow = { kind, values: new Map() };

          const cfg_names = new Set<Symbol>();
          const values: MutRef<DocCfgHideShow | undefined> = { value: undefined };
          for (const item_ of list.mixed()) {
            if (item_.$ !== "MetaItemParser") {
              cx.shared.emit_lint(
                INVALID_DOC_ATTRIBUTES,
                DocAutoCfgHideShowUnexpectedItem_diagnostic({ attr_name }),
                MetaItemOrLitParser.span(item_),
              );
              continue main;
            }
            const sub_item = item_._0;
            const sub_args = sub_item.args();
            if (sub_args.$ === "NoArgs" && values.value === undefined) {
              const name = sub_item.path().word_sym();
              if (name === undefined) {
                cx.adcx().expected_identifier(sub_item.path().span());
                continue main;
              }
              cfg_names.add(name);
            } else if (sub_args.$ === "List" && values.value === undefined) {
              // The only accepted list is `values()`.
              if (sub_item.path().word_sym() !== sym.values) {
                cx.adcx().expected_identifier(sub_item.path().span());
                continue main;
              }
              if (cfg_names.size === 0) {
                cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, DocAutoCfgHideShowNoIdentBeforeValues_diagnostic({}), sub_item.span());
                continue main;
              }
              DocParser_inherent.parse_auto_cfg_values(self, cx, sub_args._0, values);
            } else if (sub_args.$ === "NameValue") {
              // No `name = value` is allowed.
              cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, DocAutoCfgHideShowUnexpectedItem_diagnostic({ attr_name }), sub_item.span());
            } else {
              // If `values()` was already used, no item should come after it.
              cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, DocAutoCfgHideShowUnexpectedItemAfterValues_diagnostic({}), sub_item.span());
            }
          }

          const values_ = values.value ?? DocCfgHideShow.new_with_only_key(item.span());
          // #[allow(rustc::potential_query_instability)]
          if (cfg_names.size > 1) {
            unported("std::collections::HashSet iteration order (hashbrown + FxHasher): doc(auto_cfg(hide/show(..)))");
          }
          for (const cfg_name of cfg_names) {
            const o = cfg_hide_show.values.get(cfg_name);
            if (o === undefined) {
              // IndexEntry::Vacant(v)
              cfg_hide_show.values.set(cfg_name, clone_DocCfgHideShow(values_));
            } else {
              // IndexEntry::Occupied(mut o)
              const o_: MutRef<DocCfgHideShow> = { value: o };
              DocCfgHideShow.merge_with(o_, values_);
              cfg_hide_show.values.set(cfg_name, o_.value);
            }
          }
          self.attribute.auto_cfg.push([cfg_hide_show, path.span()]);
        }
        break;
      }
      case "NameValue": {
        const nv = args._0;
        const lit = nv.value_as_lit();
        if (lit.kind.$ !== "Bool") {
          cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, DocAutoCfgWrongLiteral_diagnostic({}), nv.value_span);
          return;
        }
        const bool_value = lit.kind._0;
        const span = lit.span;
        self.attribute.auto_cfg_change.push([bool_value, span]);
        break;
      }
    }
  },

  // rustc: compiler/rustc_attr_parsing/src/attributes/doc.rs:512 parse_single_doc_attr_item
  parse_single_doc_attr_item(self: DocParser, cx: AcceptContext, mip: MetaItemParser): void {
    const path = mip.path();
    const args = mip.args();
    const attribute = self.attribute;

    // macro_rules! no_args
    const no_args = (ident: "hidden" | "html_no_source" | "masked" | "notable_trait"): void => {
      const r = ArgParser.as_no_args(args);
      if (r.$ === "Err") {
        const span = r._0;
        expected_no_args(cx, span);
        return;
      }

      // FIXME: It's errorring when the attribute is passed multiple times on the command
      // line.
      // The right fix for this would be to only check this rule if the attribute is
      // not set on the command line but directly in the code.
      // if self.attribute.$ident.is_some() {
      //     cx.duplicate_key(path.span(), path.word_sym().unwrap());
      //     return;
      // }

      attribute[ident] = path.span();
    };
    // macro_rules! no_args_and_not_crate_level
    const no_args_and_not_crate_level = (ident: "fake_variadic" | "search_unbox", sym_ident: Symbol): void => {
      const r = ArgParser.as_no_args(args);
      if (r.$ === "Err") {
        const span = r._0;
        expected_no_args(cx, span);
        return;
      }
      const span = path.span();
      if (!check_attr_not_crate_level(cx, span, sym_ident)) {
        return;
      }
      attribute[ident] = span;
    };
    // macro_rules! no_args_and_crate_level
    const no_args_and_crate_level = (ident: "html_no_source" | "rust_logo"): void => {
      const r = ArgParser.as_no_args(args);
      if (r.$ === "Err") {
        const span = r._0;
        expected_no_args(cx, span);
        return;
      }
      const span = path.span();
      if (!check_attr_crate_level(cx, span)) {
        return;
      }
      attribute[ident] = span;
    };
    // macro_rules! string_arg_and_crate_level
    const string_arg_and_crate_level = (
      ident: "html_favicon_url" | "html_logo_url" | "html_playground_url" | "html_root_url" | "issue_tracker_base_url",
    ): void => {
      const nv = ArgParser.as_name_value(args);
      if (nv === undefined) {
        expected_name_value(cx, ArgParser.span(args) ?? path.span(), path.word_sym());
        return;
      }

      const s = nv.value_as_str();
      if (s === undefined) {
        expected_string_literal(cx, nv.value_span, nv.value_as_lit());
        return;
      }

      if (!check_attr_crate_level(cx, path.span())) {
        return;
      }

      // FIXME: It's errorring when the attribute is passed multiple times on the command
      // line.
      // The right fix for this would be to only check this rule if the attribute is
      // not set on the command line but directly in the code.
      // if self.attribute.$ident.is_some() {
      //     cx.duplicate_key(path.span(), path.word_sym().unwrap());
      //     return;
      // }

      attribute[ident] = [s, path.span()];
    };
    // macro_rules! gated
    const gated = (feature: Symbol, ...notes: string[]): void => {
      const stability = unstable(feature, ...notes);
      cx.shared.cx.check_attribute_stability(cx.attr_path, path.span(), stability);
    };

    const w = path.word_sym();
    if (w === sym.alias) {
      DocParser_inherent.parse_alias(self, cx, path, args);
    } else if (w === sym.hidden) {
      no_args("hidden");
    } else if (w === sym.html_favicon_url) {
      string_arg_and_crate_level("html_favicon_url");
    } else if (w === sym.html_logo_url) {
      string_arg_and_crate_level("html_logo_url");
    } else if (w === sym.html_no_source) {
      no_args_and_crate_level("html_no_source");
    } else if (w === sym.html_playground_url) {
      string_arg_and_crate_level("html_playground_url");
    } else if (w === sym.html_root_url) {
      string_arg_and_crate_level("html_root_url");
    } else if (w === sym.issue_tracker_base_url) {
      string_arg_and_crate_level("issue_tracker_base_url");
    } else if (w === sym.inline) {
      DocParser_inherent.parse_inline(self, cx, path, args, "Inline");
    } else if (w === sym.no_inline) {
      DocParser_inherent.parse_inline(self, cx, path, args, "NoInline");
    } else if (w === sym.masked) {
      gated(sym.doc_masked);
      no_args("masked");
    } else if (w === sym.cfg) {
      gated(sym.doc_cfg);
      DocParser_inherent.parse_cfg(self, cx, args);
    } else if (w === sym.notable_trait) {
      gated(sym.doc_notable_trait);
      no_args("notable_trait");
    } else if (w === sym.keyword) {
      gated(sym.rustdoc_internals);
      parse_keyword_and_attribute(cx, path, args, field_mut(self.attribute, "keyword"), sym.keyword);
    } else if (w === sym.attribute) {
      gated(sym.rustdoc_internals);
      parse_keyword_and_attribute(cx, path, args, field_mut(self.attribute, "attribute"), sym.attribute);
    } else if (w === sym.fake_variadic) {
      gated(sym.rustdoc_internals);
      no_args_and_not_crate_level("fake_variadic", sym.fake_variadic);
    } else if (w === sym.search_unbox) {
      gated(sym.rustdoc_internals);
      no_args_and_not_crate_level("search_unbox", sym.search_unbox);
    } else if (w === sym.rust_logo) {
      // FIXME: Only feature gated at the crate level (!!)
      if (cx.shared.target.$ === "Crate") {
        gated(sym.rustdoc_internals, "the `#[doc(rust_logo)]` attribute is used for Rust branding");
      }
      no_args_and_crate_level("rust_logo");
    } else if (w === sym.auto_cfg) {
      gated(sym.doc_cfg);
      DocParser_inherent.parse_auto_cfg(self, cx, path, args);
    } else if (w === sym.test) {
      const list = ArgParser.as_list(args);
      if (list === undefined) {
        cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, DocTestTakesList_diagnostic({}), ArgParser.span(args) ?? path.span());
        return;
      }

      for (const i of list.mixed()) {
        switch (i.$) {
          case "MetaItemParser": {
            const mip = i._0;
            DocParser_inherent.parse_single_test_doc_attr_item(self, cx, mip);
            break;
          }
          case "Lit": {
            const lit = i._0;
            // FIXME: remove this method once merged and uncomment the line
            // below instead.
            // cx.unexpected_literal(lit.span);
            cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, MalformedDoc_diagnostic({}), lit.span);
            break;
          }
        }
      }
    } else if (w === sym.spotlight) {
      const span = path.span();
      cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, DocUnknownSpotlight_diagnostic({ sugg_span: span }), span);
    } else if (w === sym.include && ArgParser.as_name_value(args) !== undefined) {
      const nv = ArgParser.as_name_value(args)!;
      let inner: string;
      switch (cx.attr_style) {
        case "Outer":
          inner = "";
          break;
        case "Inner":
          inner = "!";
          break;
      }
      const value = nv.value_as_lit().symbol;
      const span = path.span();
      cx.shared.emit_lint(
        INVALID_DOC_ATTRIBUTES,
        DocUnknownInclude_diagnostic({ inner, value, sugg: [span, "MaybeIncorrect"] }),
        span,
      );
    } else if (w === sym.passes || w === sym.no_default_passes) {
      const name = w;
      const span = path.span();
      cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, DocUnknownPasses_diagnostic({ name, note_span: span }), span);
    } else if (w === sym.plugins) {
      const span = path.span();
      cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, DocUnknownPlugins_diagnostic({ label_span: span }), span);
    } else if (w !== undefined) {
      const name = w;
      cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, DocUnknownAny_diagnostic({ name }), path.span());
    } else {
      const full_name = [...path.segments()].map((s) => Symbol.as_str(s.name)).join("::");
      const name = Symbol.intern(full_name);
      cx.shared.emit_lint(INVALID_DOC_ATTRIBUTES, DocUnknownAny_diagnostic({ name }), path.span());
    }
  },

  // rustc: compiler/rustc_attr_parsing/src/attributes/doc.rs:728 accept_single_doc_attr
  accept_single_doc_attr(self: DocParser, cx: AcceptContext, args: ArgParser): void {
    if (args.$ === "List" && !args._0.is_empty()) {
      const items = args._0;
      for (const i of items.mixed()) {
        switch (i.$) {
          case "MetaItemParser": {
            const mip = i._0;
            if (self.nb_doc_attrs === 0) {
              self.attribute.first_span = cx.attr_span;
            }
            self.nb_doc_attrs += 1;
            DocParser_inherent.parse_single_doc_attr_item(self, cx, mip);
            break;
          }
          case "Lit": {
            const lit = i._0;
            expected_name_value(cx, lit.span, undefined);
            break;
          }
        }
      }
    } else if (args.$ === "NameValue") {
      const nv = args._0;
      if (nv.value_as_str() === undefined) {
        expected_string_literal(cx, nv.value_span, nv.value_as_lit());
      } else {
        unreachable("internal error: entered unreachable code: Should have been handled at the same time as sugar-syntaxed doc comments");
      }
    } else {
      const suggestions = cx.adcx().suggestions();
      const span = cx.inner_span;
      cx.shared.emit_lint(
        INVALID_DOC_ATTRIBUTES,
        IllFormedAttributeInput_diagnostic(IllFormedAttributeInput.new(suggestions, undefined, undefined)),
        span,
      );
    }
  },
};

export const DocParser: AttributeParser<DocParser> & typeof DocParser_inherent = {
  ...DocParser_inherent,
  ...AttributeParser_provided<DocParser>({
    default: () => ({ attribute: default_DocAttribute(), nb_doc_attrs: 0 }),
    ATTRIBUTES: [
      [
        [sym.doc],
        template({
          List: [
            "alias",
            "hidden",
            "html_favicon_url",
            "html_logo_url",
            "html_no_source",
            "html_playground_url",
            "html_root_url",
            "issue_tracker_base_url",
            "inline",
            "no_inline",
            "masked",
            "cfg",
            "notable_trait",
            "auto_cfg",
            "test",
          ],
          NameValueStr: ["doc comment"],
        }),
        AttributeStability.Stable, // Some parts of the attribute are unstable, manually checked in parser
        (this_, cx, args) => {
          DocParser_inherent.accept_single_doc_attr(this_, cx, args);
        },
      ],
    ],
    // FIXME: Currently emitted from 2 different places, generating duplicated warnings.
    ALLOWED_TARGETS: { $: "AllowList", _0: ALL_TARGETS },
    // const ALLOWED_TARGETS: AllowedTargets<'_> = AllowedTargets::AllowListWarnRest(&[
    //     Allow(Target::ExternCrate),
    //     Allow(Target::Use),
    //     Allow(Target::Static),
    //     Allow(Target::Const),
    //     Allow(Target::Fn),
    //     Allow(Target::Mod),
    //     Allow(Target::ForeignMod),
    //     Allow(Target::TyAlias),
    //     Allow(Target::Enum),
    //     Allow(Target::Variant),
    //     Allow(Target::Struct),
    //     Allow(Target::Field),
    //     Allow(Target::Union),
    //     Allow(Target::Trait),
    //     Allow(Target::TraitAlias),
    //     Allow(Target::Impl { of_trait: true }),
    //     Allow(Target::Impl { of_trait: false }),
    //     Allow(Target::AssocConst(AssocCtxt::Impl { of_trait: false })),
    //     Allow(Target::AssocConst(AssocCtxt::Trait)),
    //     Allow(Target::AssocConst(AssocCtxt::Impl { of_trait: true })),
    //     Allow(Target::Method(MethodKind::Inherent)),
    //     Allow(Target::Method(MethodKind::Trait { body: true })),
    //     Allow(Target::Method(MethodKind::Trait { body: false })),
    //     Allow(Target::Method(MethodKind::TraitImpl)),
    //     Allow(Target::AssocTy(AssocCtxt::Impl { of_trait: false })),
    //     Allow(Target::AssocTy(AssocCtxt::Trait)),
    //     Allow(Target::AssocTy(AssocCtxt::Impl { of_trait: true })),
    //     Allow(Target::ForeignFn),
    //     Allow(Target::ForeignStatic),
    //     Allow(Target::ForeignTy),
    //     Allow(Target::MacroDef),
    //     Allow(Target::Crate),
    //     Error(Target::WherePredicate),
    // ]);

    // rustc: compiler/rustc_attr_parsing/src/attributes/doc.rs:834 finalize
    finalize(self, _cx) {
      if (self.nb_doc_attrs !== 0) {
        return { $: "Doc", _0: self.attribute };
      } else {
        return undefined;
      }
    }
  }),
};
