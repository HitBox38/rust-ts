// Port of compiler/rustc_attr_parsing/src/attributes/cfg.rs.
import type { AttrItem, Attribute, NodeId } from "../../rustc_ast/lib.ts";
import { type CfgEntry, clone_CfgEntry } from "../../rustc_ast/attr/data_structures.ts";
import { RustcVersion, RustcVersion_cmp } from "../../rustc_ast/attr/version.ts";
import type { Delimiter } from "../../rustc_ast/token.ts";
import type { DelimSpan, WithTokens } from "../../rustc_ast/tokenstream.ts";
import { AttrPath } from "../../rustc_attr_ir/lib.ts";
import { display_Target, Target } from "../../rustc_attr_ir/target.ts";
import { Applicability, type Diag, type ErrorGuaranteed, type PResult } from "../../rustc_errors/lib.ts";
import { type Features, find_gated_cfg, type GatedCfg } from "../../rustc_feature/lib.ts";
import { UNEXPECTED_CFGS } from "../../rustc_lint_defs/builtin.ts";
import { parse_in, parser as rustc_parse_parser } from "../../rustc_parse/lib.ts";
import type { Session } from "../../rustc_session/lib.ts";
import { feature_err } from "../../rustc_session/diagnostics.ts";
import type { ParseSess } from "../../rustc_session/parse.ts";
import { Span } from "../../rustc_span/lib.ts";
import { display_Ident, display_Symbol, sym, Symbol } from "../../rustc_span/symbol.ts";
import { panic } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { type AcceptContext, ExpectNameValue, ShouldEmit } from "../context.ts";
import {
  AttributeParseError_diagnostic,
  type AttributeParseErrorReason,
  CfgAttrBadDelim_diagnostic,
  ExpectedSingleVersionLiteral_diagnostic,
  ExpectedVersionLiteral_diagnostic,
  UnexpectedCfgName_into_diag,
  UnexpectedCfgValue_into_diag,
  UnknownVersionLiteral_diagnostic,
} from "../diagnostics.ts";
import { AttributeParser } from "../interface.ts";
import { AllowExprMetavar, ArgParser, type MetaItemListParser, MetaItemOrLitParser, type NameValueParser } from "../parser.ts";
import { template } from "../template.ts";
import * as check_cfg from "../check_cfg.ts";
import { AttributeSafety } from "./mod.ts";
import { parse_version } from "./util.ts";

type Parser = rustc_parse_parser.Parser;
const { exp } = { exp: rustc_parse_parser.token_type.exp };

export const CFG_TEMPLATE = template(
  { List: ["predicate"] },
  "https://doc.rust-lang.org/reference/conditional-compilation.html#the-cfg-attribute",
);

const CFG_ATTR_TEMPLATE = template(
  { List: ["predicate, attr1, attr2, ..."] },
  "https://doc.rust-lang.org/reference/conditional-compilation.html#the-cfg_attr-attribute",
);

// rustc: compiler/rustc_attr_parsing/src/attributes/cfg.rs:41 parse_cfg
export function parse_cfg(cx: AcceptContext, args: ArgParser): CfgEntry | undefined {
  const list = cx.expect_list(args, cx.attr_span);
  if (list === undefined) return undefined;

  const single = list.as_single();
  if (single === undefined) {
    const target = cx.shared.target;
    const adcx = cx.adcx();
    if (list.is_empty()) {
      // `#[cfg()]`
      const message = `if the ${display_Target(target)} should be disabled, use \`#[cfg(false)]\``;
      adcx.push_suggestion(message, list.span, "(false)");
    } else {
      // `#[cfg(foo, bar)]`
      const r = cx.shared.cx
        .sess()
        .source_map()
        .span_to_source(list.span, (src, start, end) => Ok(src.slice(start, end).toString()));
      if (r.$ === "Ok") {
        const args = r._0;
        const all = `(all${args})`;
        const any = `(any${args})`;

        const all_msg = `if the ${display_Target(target)} should be enabled when all these predicates are, wrap them in \`all\``;
        const any_msg = `alternately, if the ${display_Target(target)} should be enabled when any of these predicates are, wrap them in \`any\``;

        adcx.push_suggestion(all_msg, list.span, all);
        adcx.push_suggestion(any_msg, list.span, any);
      }
    }

    adcx.expected_single_argument(list.span, list.len());
    return undefined;
  }
  const r = parse_cfg_entry(cx, single);
  return r.$ === "Ok" ? r._0 : undefined;
}

// `.flat_map(|sub_item| parse_cfg_entry(cx, sub_item)).collect()` (a `Result` iterates its `Ok` value)
function parse_cfg_entries(cx: AcceptContext, list: MetaItemListParser): CfgEntry[] {
  const out: CfgEntry[] = [];
  for (const sub_item of list.mixed()) {
    const r = parse_cfg_entry(cx, sub_item);
    if (r.$ === "Ok") out.push(r._0);
  }
  return out;
}

// rustc: compiler/rustc_attr_parsing/src/attributes/cfg.rs:79 parse_cfg_entry
export function parse_cfg_entry(cx: AcceptContext, item: MetaItemOrLitParser): Result<CfgEntry, ErrorGuaranteed> {
  switch (item.$) {
    case "MetaItemParser": {
      const meta = item._0;
      const a = meta.args();
      switch (a.$) {
        case "List": {
          const list = a._0;
          const word = meta.path().word_sym();
          if (word === sym.not) {
            const single = list.as_single();
            if (single === undefined) {
              return Err(cx.adcx().expected_single_argument(list.span, list.len()));
            }
            const r = parse_cfg_entry(cx, single);
            if (r.$ === "Err") return r;
            return Ok({ $: "Not", _0: r._0, _1: list.span });
          } else if (word === sym.any) {
            return Ok({ $: "Any", _0: parse_cfg_entries(cx, list), _1: list.span });
          } else if (word === sym.all) {
            return Ok({ $: "All", _0: parse_cfg_entries(cx, list), _1: list.span });
          } else if (word === sym.target) {
            return parse_cfg_entry_target(cx, list, meta.span());
          } else if (word === sym.version) {
            return parse_cfg_entry_version(cx, list, meta.span());
          } else {
            const possibilities = [sym.any, sym.all, sym.not, sym.target];
            const features = cx.shared.cx.features_option();
            if (features !== undefined && features.cfg_version()) {
              possibilities.push(sym.version);
            }
            return Err(cx.adcx().expected_specific_argument(meta.span(), possibilities));
          }
        }
        case "NoArgs":
        case "NameValue": {
          const name = meta.path().word_sym();
          if (name === undefined || Symbol.is_path_segment_keyword(name)) {
            return Err(cx.adcx().expected_identifier(meta.path().span()));
          }
          return parse_name_value(name, meta.path().span(), ArgParser.as_name_value(a), meta.span(), cx);
        }
      }
    }
    case "Lit": {
      const lit = item._0;
      if (lit.kind.$ === "Bool") {
        return Ok({ $: "Bool", _0: lit.kind._0, _1: lit.span });
      } else {
        return Err(cx.adcx().expected_identifier(lit.span));
      }
    }
  }
}

// rustc: compiler/rustc_attr_parsing/src/attributes/cfg.rs:125 parse_cfg_entry_version
function parse_cfg_entry_version(cx: AcceptContext, list: MetaItemListParser, meta_span: Span): Result<CfgEntry, ErrorGuaranteed> {
  try_gate_cfg(sym.version, meta_span, cx.shared.cx.sess(), cx.shared.cx.features_option());
  const version = list.as_single();
  if (version === undefined) {
    return Err(cx.shared.emit_err(ExpectedSingleVersionLiteral_diagnostic({ span: list.span })));
  }
  const version_lit = MetaItemOrLitParser.as_lit(version);
  if (version_lit === undefined) {
    return Err(cx.shared.emit_err(ExpectedVersionLiteral_diagnostic({ span: MetaItemOrLitParser.span(version) })));
  }
  const version_str = version_lit.value_as_str();
  if (version_str === undefined) {
    return Err(cx.shared.emit_err(ExpectedVersionLiteral_diagnostic({ span: version_lit.span })));
  }

  let min_version = parse_version(version_str);
  if (min_version === undefined) {
    cx.shared.cx.sess().dcx().emit_warn(UnknownVersionLiteral_diagnostic({ span: version_lit.span }));
    min_version = undefined;
  }

  return Ok({ $: "Version", _0: min_version, _1: list.span });
}

// rustc: compiler/rustc_attr_parsing/src/attributes/cfg.rs:149 parse_cfg_entry_target
function parse_cfg_entry_target(cx: AcceptContext, list: MetaItemListParser, meta_span: Span): Result<CfgEntry, ErrorGuaranteed> {
  const features = cx.shared.cx.features_option();
  if (features !== undefined && !features.cfg_target_compact()) {
    feature_err(cx.shared.cx.sess(), sym.cfg_target_compact, meta_span, {
      $: "Inline",
      _0: "compact `cfg(target(..))` is experimental and subject to change",
    }).emit();
  }

  const result: CfgEntry[] = [];
  for (const sub_item of list.mixed()) {
    // First, validate that this is a NameValue item
    const nv = cx.expect_name_value(sub_item, MetaItemOrLitParser.span(sub_item), undefined, ExpectNameValue.MetaItemOrLitParser);
    if (nv === undefined) {
      continue;
    }
    const [name, value] = nv;

    // Then, parse it as a name-value item
    if (name.is_path_segment_keyword()) {
      return Err(cx.adcx().expected_identifier(name.span));
    }
    const name_ = Symbol.intern(`target_${display_Ident(name)}`);
    const cfg = parse_name_value(name_, MetaItemOrLitParser.span(sub_item), value, MetaItemOrLitParser.span(sub_item), cx);
    if (cfg.$ === "Ok") {
      result.push(cfg._0);
    }
  }
  return Ok({ $: "All", _0: result, _1: list.span });
}

// rustc: compiler/rustc_attr_parsing/src/attributes/cfg.rs:185 parse_name_value
export function parse_name_value(
  name: Symbol,
  name_span: Span,
  value: NameValueParser | undefined,
  span: Span,
  cx: AcceptContext,
): Result<CfgEntry, ErrorGuaranteed> {
  try_gate_cfg(name, span, cx.shared.cx.sess(), cx.shared.cx.features_option());

  let value_: [Symbol, Span] | undefined;
  if (value === undefined) {
    value_ = undefined;
  } else {
    const value_str = value.value_as_str();
    if (value_str === undefined) {
      return Err(cx.adcx().expected_string_literal(value.value_span, value.value_as_lit()));
    }
    value_ = [value_str, value.value_span];
  }

  const sess = cx.shared.cx.sess_;
  const expected = sess.check_config.expecteds.get(name);
  if (expected !== undefined && expected.$ === "Some" && !expected._0.has(value_ === undefined ? undefined : value_[0])) {
    cx.shared.emit_lint_with_sess(
      UNEXPECTED_CFGS,
      (dcx, level, sess) => UnexpectedCfgValue_into_diag(check_cfg.unexpected_cfg_value(sess, [name, name_span], value_), dcx, level),
      span,
    );
  } else if (expected === undefined && sess.check_config.exhaustive_names) {
    cx.shared.emit_lint_with_sess(
      UNEXPECTED_CFGS,
      (dcx, level, sess) => UnexpectedCfgName_into_diag(check_cfg.unexpected_cfg_name(sess, [name, name_span], value_), dcx, level),
      span,
    );
  } else {
    /* not unexpected */
  }

  return Ok({ $: "NameValue", name, value: value_ === undefined ? undefined : value_[0], span });
}

// rustc: compiler/rustc_attr_parsing/src/attributes/cfg.rs:229 eval_config_entry
export function eval_config_entry(sess: Session, cfg_entry: CfgEntry): EvalConfigResult {
  switch (cfg_entry.$) {
    case "All": {
      const subs = cfg_entry._0;
      for (const sub of subs) {
        const res = eval_config_entry(sess, sub);
        if (!EvalConfigResult.as_bool(res)) {
          return res;
        }
      }
      return EvalConfigResult.True;
    }
    case "Any": {
      const subs = cfg_entry._0;
      for (const sub of subs) {
        const res = eval_config_entry(sess, sub);
        if (EvalConfigResult.as_bool(res)) {
          return res;
        }
      }
      return { $: "False", reason: clone_CfgEntry(cfg_entry) };
    }
    case "Not": {
      const sub = cfg_entry._0;
      if (EvalConfigResult.as_bool(eval_config_entry(sess, sub))) {
        return { $: "False", reason: clone_CfgEntry(cfg_entry) };
      } else {
        return EvalConfigResult.True;
      }
    }
    case "Bool": {
      const b = cfg_entry._0;
      if (b) {
        return EvalConfigResult.True;
      } else {
        return { $: "False", reason: clone_CfgEntry(cfg_entry) };
      }
    }
    case "NameValue": {
      const { name, value } = cfg_entry;
      if (sess.config.contains([name, value])) {
        return EvalConfigResult.True;
      } else {
        return { $: "False", reason: clone_CfgEntry(cfg_entry) };
      }
    }
    case "Version": {
      const min_version = cfg_entry._0;
      if (min_version === undefined) {
        return { $: "False", reason: clone_CfgEntry(cfg_entry) };
      }
      // See https://github.com/rust-lang/rust/issues/64796#issuecomment-640851454 for details
      const min_version_ok = sess.opts.unstable_opts.assume_incomplete_release
        ? RustcVersion_cmp(RustcVersion.current_overridable(), min_version) > 0
        : RustcVersion_cmp(RustcVersion.current_overridable(), min_version) >= 0;
      if (min_version_ok) {
        return EvalConfigResult.True;
      } else {
        return { $: "False", reason: clone_CfgEntry(cfg_entry) };
      }
    }
  }
}

/** `pub enum EvalConfigResult` */
export type EvalConfigResult = { readonly $: "True" } | { readonly $: "False"; reason: CfgEntry };

export const EvalConfigResult = {
  True: Object.freeze({ $: "True" as const }) as EvalConfigResult,

  // rustc: compiler/rustc_attr_parsing/src/attributes/cfg.rs:295 as_bool
  as_bool(self: EvalConfigResult): boolean {
    switch (self.$) {
      case "True":
        return true;
      case "False":
        return false;
    }
  },
};

// rustc: compiler/rustc_attr_parsing/src/attributes/cfg.rs:303 parse_cfg_attr
export function parse_cfg_attr(
  cfg_attr: Attribute,
  sess: Session,
  features: Features | undefined,
  lint_node_id: NodeId,
): [CfgEntry, [WithTokens<AttrItem>, Span][]] | undefined {
  const item = cfg_attr.get_normal_item();
  const args = item.args;
  if (args.$ === "Delimited" && !args._0.tokens.is_empty()) {
    const { dspan, delim, tokens } = args._0;
    check_cfg_attr_bad_delim(sess.psess, dspan, delim);
    const r = parse_in(sess.psess, tokens, "`cfg_attr` input", (p) => parse_cfg_attr_internal(p, sess, features, lint_node_id, cfg_attr));
    if (r.$ === "Ok") {
      return r._0;
    } else {
      const e = r._0;
      const suggestions = CFG_ATTR_TEMPLATE.suggestions("Attribute", item.unsafety, Symbol.as_str(sym.cfg_attr));
      e.with_span_suggestions(item.span, "must be of the form", suggestions, Applicability.HasPlaceholders)
        .with_note(`for more information, visit <${expect_docs(CFG_ATTR_TEMPLATE.docs)}>`)
        .emit();
    }
  } else {
    let span: Span;
    let reason: AttributeParseErrorReason;
    if (item.args.$ === "Delimited") {
      const { dspan } = item.args._0;
      [span, reason] = [dspan.entire(), { $: "ExpectedAtLeastOneArgument" }];
    } else {
      [span, reason] = [item.span, { $: "ExpectedList" }];
    }

    sess.dcx().emit_err(
      AttributeParseError_diagnostic({
        span,
        inner_span: item.span,
        template: CFG_ATTR_TEMPLATE,
        path: AttrPath.from_ast(item.path, (s) => s),
        description: "Attribute",
        reason,
        suggestions: {
          $: "CreatedByTemplate",
          _0: CFG_ATTR_TEMPLATE.suggestions("Attribute", item.unsafety, Symbol.as_str(sym.cfg_attr)),
        },
      }),
    );
  }
  return undefined;
}

// `CFG_ATTR_TEMPLATE.docs.expect("cfg_attr has docs")`
function expect_docs(docs: string | undefined): string {
  if (docs === undefined) return panic("cfg_attr has docs");
  return docs;
}

// rustc: compiler/rustc_attr_parsing/src/attributes/cfg.rs:365 check_cfg_attr_bad_delim
function check_cfg_attr_bad_delim(psess: ParseSess, span: DelimSpan, delim: Delimiter): void {
  if (delim.$ === "Parenthesis") {
    return;
  }
  psess.dcx().emit_err(
    CfgAttrBadDelim_diagnostic({
      span: span.entire(),
      sugg: { open: span.open, close: span.close },
    }),
  );
}

/// Parses `cfg_attr(pred, attr_item_list)` where `attr_item_list` is comma-delimited.
// rustc: compiler/rustc_attr_parsing/src/attributes/cfg.rs:376 parse_cfg_attr_internal
function parse_cfg_attr_internal(
  parser: Parser,
  sess: Session,
  features: Features | undefined,
  lint_node_id: NodeId,
  attribute: Attribute,
): PResult<[CfgEntry, [WithTokens<AttrItem>, Span][]]> {
  // Parse cfg predicate
  const pred_start = parser.token.span;
  const meta_r = MetaItemOrLitParser.parse_single(parser, { $: "ErrorsAndLints", recovery: "Allowed" }, AllowExprMetavar.Yes);
  if (meta_r.$ === "Err") return meta_r;
  const meta = meta_r._0;
  const pred_span = Span.with_hi(pred_start, Span.hi(parser.token.span));

  const item = attribute.get_normal_item();
  const cfg_predicate_r = AttributeParser.parse_single_args(
    sess,
    attribute.span,
    item.span,
    attribute.style,
    new AttrPath(attribute.path(), attribute.span),
    item.unsafety,
    AttributeSafety.Normal,
    "Attribute",
    pred_span,
    lint_node_id,
    Target.Crate,
    features,
    { $: "ErrorsAndLints", recovery: "Allowed" } satisfies ShouldEmit,
    meta,
    parse_cfg_entry,
    CFG_ATTR_TEMPLATE,
  );
  if (cfg_predicate_r.$ === "Err") {
    const _err: ErrorGuaranteed = cfg_predicate_r._0;
    // We have an `ErrorGuaranteed` so this delayed bug cannot fail, but we need a `Diag` for the `PResult` so we make one anyways
    const diag: Diag = sess.dcx().struct_err("cfg_entry parsing failing with `ShouldEmit::ErrorsAndLints` should emit a error.");
    diag.downgrade_to_delayed_bug();
    return Err(diag);
  }
  const cfg_predicate = cfg_predicate_r._0;

  const r = parser.expect(exp.Comma);
  if (r.$ === "Err") return r;

  // Presumably, the majority of the time there will only be one attr.
  const expanded_attrs: [WithTokens<AttrItem>, Span][] = [];
  while (parser.token.kind.$ !== "Eof") {
    const lo = parser.token.span;
    const item_r = parser.parse_attr_item("Yes");
    if (item_r.$ === "Err") return item_r;
    expanded_attrs.push([item_r._0, Span.to(lo, parser.prev_token.span)]);
    if (!parser.eat(exp.Comma)) {
      break;
    }
  }

  return Ok([cfg_predicate, expanded_attrs]);
}

// rustc: compiler/rustc_attr_parsing/src/attributes/cfg.rs:436 try_gate_cfg
function try_gate_cfg(name: Symbol, span: Span, sess: Session, features: Features | undefined): void {
  const gate = find_gated_cfg(name);
  if (features !== undefined && gate !== undefined) {
    gate_cfg(gate, span, sess, features);
  }
}

// rustc: compiler/rustc_attr_parsing/src/attributes/cfg.rs:443 gate_cfg
function gate_cfg(gated_cfg: GatedCfg, cfg_span: Span, sess: Session, features: Features): void {
  const [cfg, feature, has_feature] = gated_cfg;
  if (!has_feature(features) && !Span.allows_unstable(cfg_span, feature)) {
    const explain = `\`cfg(${display_Symbol(cfg)})\` is experimental and subject to change`;
    feature_err(sess, feature, cfg_span, explain).emit();
  }
}
