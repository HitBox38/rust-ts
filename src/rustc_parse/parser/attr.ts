// Port of compiler/rustc_parse/src/parser/attr.rs
// Types (`InnerAttrPolicy`, `InnerAttrForbiddenReason`, `OuterAttributeType`) are generated into
// attr.gen.ts.
import { ast, attr, token, tokenstream } from "../../rustc_ast/lib.ts";
import type { AttrVec, Attribute, MetaItem, MetaItemInner, MetaItemKind, MetaItemLit } from "../../rustc_ast/lib.ts";
import type { WithTokens } from "../../rustc_ast/tokenstream.ts";
import { str_into_diag_arg } from "../../rustc_error_messages/diagnostic_impls.ts";
import { IntoDiagArg } from "../../rustc_error_messages/lib.ts";
import { type Diag, E0753, msg, type PResult, SuggestionStyle } from "../../rustc_errors/lib.ts";
import { Applicability } from "../../rustc_lint_defs/lib.ts";
import { BytePos, Span } from "../../rustc_span/lib.ts";
import { assert, unwrap } from "../../std/panic.ts";
import { Err, Ok } from "../../std/result.ts";
import * as diagnostics from "../diagnostics.ts";
import * as gen from "./attr.gen.ts";
import { type InnerAttrPolicy, type OuterAttributeType, InnerAttrPolicy as InnerAttrPolicyC } from "./attr.gen.ts";
import { AttrWrapper } from "./attr_wrapper.ts";
import { AllowConstBlockItems, ForceCollect, Parser, Trailing, token_descr } from "./mod.ts";
import { PathStyle } from "./path.ts";
import { exp } from "./token_type.ts";
import { HasAttrs, HasTokens } from "../../rustc_ast/ast_traits.ts";

export * from "./attr.gen.ts";

// Public for rustfmt usage
// (`InnerAttrPolicy`, `InnerAttrForbiddenReason` and `OuterAttributeType` are generated.)

/// Parses attributes that appear before an item.
// rustc: compiler/rustc_parse/src/parser/attr.rs:40 parse_outer_attributes
Parser.prototype.parse_outer_attributes = function (this: Parser): PResult<AttrWrapper> {
  const outer_attrs: AttrVec = [];
  let just_parsed_doc_comment = false;
  const start_pos = this.num_bump_calls;
  for (;;) {
    let attr_: Attribute | undefined;
    const k = this.token.kind;
    if (this.check(exp.Pound)) {
      const last = outer_attrs[outer_attrs.length - 1];
      const prev_outer_attr_sp = last === undefined ? undefined : last.span;

      let inner_error_reason: gen.InnerAttrForbiddenReason | undefined;
      if (just_parsed_doc_comment) {
        inner_error_reason = { $: "AfterOuterDocComment", prev_doc_comment_span: unwrap(prev_outer_attr_sp) };
      } else {
        inner_error_reason =
          prev_outer_attr_sp === undefined ? undefined : { $: "AfterOuterAttribute", prev_outer_attr_sp };
      }
      const inner_parse_policy: InnerAttrPolicy = { $: "Forbidden", _0: inner_error_reason };
      just_parsed_doc_comment = false;
      const r = this.parse_attribute(inner_parse_policy);
      if (r.$ === "Err") return r;
      attr_ = r._0;
    } else if (k.$ === "DocComment") {
      const comment_kind = k._0;
      const attr_style = k._1;
      const data = k._2;
      if (attr_style !== ast.AttrStyle.Outer) {
        const span = this.token.span;
        const err = this.dcx().struct_span_err(span, msg("expected outer doc comment"));
        err.code(E0753);
        const replacement_span = this.annotate_following_item_if_applicable(
          err,
          span,
          comment_kind === token.CommentKind.Line ? gen.OuterAttributeType.DocComment : gen.OuterAttributeType.DocBlockComment,
          true,
        );
        if (replacement_span !== undefined) {
          err.note(
            msg("inner doc comments like this (starting with `//!` or `/*!`) can only appear before items"),
          );
          err.span_suggestion_verbose(
            replacement_span,
            msg("you might have meant to write a regular comment"),
            "",
            Applicability.MachineApplicable,
          );
        }
        err.emit();
      }
      this.bump();
      just_parsed_doc_comment = true;
      // Always make an outer attribute - this allows us to recover from a misplaced
      // inner attribute.
      attr_ = attr.mk_doc_comment(
        this.psess.attr_id_generator,
        comment_kind,
        ast.AttrStyle.Outer,
        data,
        this.prev_token.span,
      );
    } else {
      attr_ = undefined;
    }

    if (attr_ !== undefined) {
      if (attr_.style === ast.AttrStyle.Outer) {
        outer_attrs.push(attr_);
      }
    } else {
      break;
    }
  }
  return Ok(AttrWrapper.new(outer_attrs, start_pos));
};

/// Matches `attribute = # ! [ meta_item ]`.
/// `inner_parse_policy` prescribes how to handle inner attributes.
// Public for rustfmt usage.
// rustc: compiler/rustc_parse/src/parser/attr.rs:116 parse_attribute
Parser.prototype.parse_attribute = function (this: Parser, inner_parse_policy: InnerAttrPolicy): PResult<Attribute> {
  const lo = this.token.span;
  // Attributes can't have attributes of their own [Editor's note: not with that attitude]
  // PORT: `collect_tokens_no_attrs::<ast::Attribute>`: the `HasTokens`/`HasAttrs` impls of `Attribute`.
  return this.collect_tokens_no_attrs(
    (this_) => {
      const pound_hi = Span.hi(this_.token.span);
      assert(this_.eat(exp.Pound), "parse_attribute called in non-attribute position");

      const not_lo = Span.lo(this_.token.span);
      const style = this_.eat(exp.Bang) ? ast.AttrStyle.Inner : ast.AttrStyle.Outer;

      const bracket_res = this_.expect(exp.OpenBracket);
      // If `#!` is not followed by `[`
      if (bracket_res.$ === "Err" && style === ast.AttrStyle.Inner && pound_hi === not_lo) {
        const err = bracket_res._0;
        err.note(
          "the token sequence `#!` here looks like the start of " + "a shebang interpreter directive but it is not",
        );
        err.help(
          "if you meant this to be a shebang interpreter directive, " + "move it to the very start of the file",
        );
      }
      if (bracket_res.$ === "Err") return bracket_res;

      const r = this_.parse_attr_item(ForceCollect.No);
      if (r.$ === "Err") return r;
      const attr_item = r._0;
      // `attr_item` will never have tokens: within `parse_attr_item`, `collect_tokens`
      // attaches tokens only if:
      // - `ForceCollect::Yes` is passed (not true), or
      // - attributes on the parsed node require tokens (not true, because attr items can't
      //   have attributes of their own, hence the empty `HasAttrs` impl for `AttrItem`).
      assert(attr_item.tokens === undefined, "assertion failed: attr_item.tokens.is_none()");

      const r2 = this_.expect(exp.CloseBracket);
      if (r2.$ === "Err") return r2;
      const attr_sp = Span.to(lo, this_.prev_token.span);

      // Emit error if inner attribute is encountered and forbidden.
      if (style === ast.AttrStyle.Inner) {
        this_.error_on_forbidden_inner_attr(attr_sp, inner_parse_policy, attr_item.node.is_valid_for_outer_style());
      }

      return Ok(attr.mk_attr_from_item(this.psess.attr_id_generator, attr_item.node, undefined, style, attr_sp));
    },
    HasTokens.Attribute,
    HasAttrs.Attribute,
  );
};

// rustc: compiler/rustc_parse/src/parser/attr.rs:181 annotate_following_item_if_applicable
Parser.prototype.annotate_following_item_if_applicable = function (
  this: Parser,
  err: Diag,
  span: Span,
  attr_type: OuterAttributeType,
  suggest_to_outer: boolean,
): Span | undefined {
  const snapshot = this.create_snapshot_for_diagnostic();
  const lo = BytePos.add(Span.lo(span), BytePos(attr_type === gen.OuterAttributeType.Attribute ? 1 : 2));
  const hi = BytePos.add(lo, BytePos(1));
  const replacement_span = Span.with_hi(Span.with_lo(span, lo), hi);
  if (attr_type === gen.OuterAttributeType.DocBlockComment || attr_type === gen.OuterAttributeType.DocComment) {
    snapshot.parser.bump();
  }
  for (;;) {
    // skip any other attributes, we want the item
    if (snapshot.parser.token.eq(token.TokenKind.Pound)) {
      const r = snapshot.parser.parse_attribute(InnerAttrPolicyC.Permitted);
      if (r.$ === "Err") {
        const err_ = r._0;
        err_.cancel();
        return replacement_span;
      }
    } else {
      break;
    }
  }
  const r = snapshot.parser.parse_item_common(
    AttrWrapper.empty(),
    true,
    false,
    { req_name: (_, __) => true, context: "Free", req_body: true },
    ForceCollect.No,
    AllowConstBlockItems.Yes,
  );
  if (r.$ === "Ok" && r._0 !== undefined) {
    const item = r._0;
    err.arg("item", IntoDiagArg.of(ast.ItemKind.descr(item.kind), str_into_diag_arg));
    err.span_label(
      item.span,
      attr_type === gen.OuterAttributeType.Attribute
        ? msg("the inner attribute doesn't annotate this {$item}")
        : msg("the inner doc comment doesn't annotate this {$item}"),
    );
    if (suggest_to_outer) {
      err.span_suggestion_verbose(
        replacement_span,
        attr_type === gen.OuterAttributeType.Attribute
          ? msg("to annotate the {$item}, change the attribute from inner to outer style")
          : msg("to annotate the {$item}, change the doc comment from inner to outer style"),
        attr_type === gen.OuterAttributeType.Attribute
          ? ""
          : attr_type === gen.OuterAttributeType.DocBlockComment
            ? "*"
            : "/",
        Applicability.MachineApplicable,
      );
    }
    return undefined;
  } else if (r.$ === "Err") {
    const item_err = r._0;
    item_err.cancel();
  }
  return replacement_span;
};

// rustc: compiler/rustc_parse/src/parser/attr.rs:256 error_on_forbidden_inner_attr
Parser.prototype.error_on_forbidden_inner_attr = function (
  this: Parser,
  attr_sp: Span,
  policy: InnerAttrPolicy,
  suggest_to_outer: boolean,
): void {
  if (policy.$ === "Forbidden") {
    const reason = policy._0;
    let diag: Diag;
    if (reason !== undefined && reason.$ === "AfterOuterDocComment") {
      const prev_doc_comment_span = reason.prev_doc_comment_span;
      diag = this.dcx()
        .struct_span_err(attr_sp, msg("an inner attribute is not permitted following an outer doc comment"))
        .with_span_label(attr_sp, msg("not permitted following an outer doc comment"))
        .with_span_label(prev_doc_comment_span, msg("previous doc comment"));
    } else if (reason !== undefined && reason.$ === "AfterOuterAttribute") {
      const prev_outer_attr_sp = reason.prev_outer_attr_sp;
      diag = this.dcx()
        .struct_span_err(attr_sp, msg("an inner attribute is not permitted following an outer attribute"))
        .with_span_label(attr_sp, msg("not permitted following an outer attribute"))
        .with_span_label(prev_outer_attr_sp, msg("previous outer attribute"));
    } else {
      // Some(InnerAttrForbiddenReason::InCodeBlock) | None
      diag = this.dcx().struct_span_err(attr_sp, msg("an inner attribute is not permitted in this context"));
    }

    diag.note(
      msg(
        "inner attributes, like `#![no_std]`, annotate the item enclosing them, and are usually found at the beginning of source files",
      ),
    );
    if (
      this.annotate_following_item_if_applicable(diag, attr_sp, gen.OuterAttributeType.Attribute, suggest_to_outer) !==
      undefined
    ) {
      diag.note(msg("outer attributes, like `#[test]`, annotate the item following them"));
    }
    diag.emit();
  }
};

/// Parses an inner part of an attribute (the path and following tokens).
/// The tokens must be either a delimited token stream, or empty token stream,
/// or the "legacy" key-value form.
///
/// ```text
/// PATH `(` TOKEN_STREAM `)`
/// PATH `[` TOKEN_STREAM `]`
/// PATH `{` TOKEN_STREAM `}`
/// PATH
/// PATH `=` UNSUFFIXED_LIT
/// ```
///
/// The delimiters or `=` are still put into the resulting token stream.
// rustc: compiler/rustc_parse/src/parser/attr.rs:323 parse_attr_item
Parser.prototype.parse_attr_item = function (this: Parser, force_collect: ForceCollect): PResult<WithTokens<ast.AttrItem>> {
  const item = this.eat_metavar_seq_with_matcher(
    (mv_kind) => mv_kind.$ === "Meta",
    (this_) => this_.parse_attr_item(force_collect),
  );
  if (item !== undefined) {
    return Ok(item);
  }

  // Attr items don't have attributes.
  // PORT: `R = WithTokens<AttrItem>`: `impl<T: HasAttrs> HasTokens/HasAttrs for WithTokens<T>`.
  return this.collect_tokens(
    undefined,
    AttrWrapper.empty(),
    force_collect,
    (this_, _empty_attrs) => {
      const lo = this_.token.span;
      const is_unsafe = this_.eat_keyword(exp.Unsafe);
      let unsafety: ast.Safety;
      if (is_unsafe) {
        const unsafe_span = this_.prev_token.span;
        const r = this_.expect(exp.OpenParen);
        if (r.$ === "Err") return r;
        unsafety = { $: "Unsafe", _0: unsafe_span };
      } else {
        unsafety = ast.Safety.Default;
      }

      const r = this_.parse_path(PathStyle.Mod);
      if (r.$ === "Err") return r;
      const path = r._0;
      const r2 = this_.parse_attr_args();
      if (r2.$ === "Err") return r2;
      const args = r2._0;
      if (is_unsafe) {
        const r3 = this_.expect(exp.CloseParen);
        if (r3.$ === "Err") return r3;
      }
      const span = Span.to(lo, this_.prev_token.span);
      return Ok([
        tokenstream.WithTokens.new(new ast.AttrItem(unsafety, path, args, span)),
        Trailing.No,
        "No",
      ]);
    },
    HasTokens.WithTokens<ast.AttrItem>(),
    HasAttrs.WithTokens(HasAttrs.AttrItem),
  );
};

/// Parses attributes that appear after the opening of an item. These should
/// be preceded by an exclamation mark, but we accept and warn about one
/// terminated by a semicolon.
///
/// Matches `inner_attrs*`.
// rustc: compiler/rustc_parse/src/parser/attr.rs:365 parse_inner_attributes
Parser.prototype.parse_inner_attributes = function (this: Parser): PResult<AttrVec> {
  const attrs: AttrVec = [];
  for (;;) {
    const start_pos = this.num_bump_calls;
    // Only try to parse if it is an inner attribute (has `!`).
    let attr_: Attribute | undefined;
    const k = this.token.kind;
    if (this.check(exp.Pound) && this.look_ahead(1, (t) => t.eq(token.TokenKind.Bang))) {
      const r = this.parse_attribute(InnerAttrPolicyC.Permitted);
      if (r.$ === "Err") return r;
      attr_ = r._0;
    } else if (k.$ === "DocComment") {
      const comment_kind = k._0;
      const attr_style = k._1;
      const data = k._2;
      if (attr_style === ast.AttrStyle.Inner) {
        this.bump();
        attr_ = attr.mk_doc_comment(this.psess.attr_id_generator, comment_kind, attr_style, data, this.prev_token.span);
      } else {
        attr_ = undefined;
      }
    } else {
      attr_ = undefined;
    }
    if (attr_ !== undefined) {
      // If we are currently capturing tokens (i.e. we are within a call to
      // `Parser::collect_tokens`) record the token positions of this inner attribute,
      // for possible later processing in a `LazyAttrTokenStream`.
      if (this.capture_state.capturing === "Yes") {
        const end_pos = this.num_bump_calls;
        const parser_range: tokenstream.ParserRange = { _0: { start: start_pos, end: end_pos } };
        this.capture_state.inner_attr_parser_ranges.set(attr_.id, parser_range);
      }
      attrs.push(attr_);
    } else {
      break;
    }
  }
  return Ok(attrs);
};

// Note: must be unsuffixed.
// rustc: compiler/rustc_parse/src/parser/attr.rs:406 parse_unsuffixed_meta_item_lit
Parser.prototype.parse_unsuffixed_meta_item_lit = function (this: Parser): PResult<MetaItemLit> {
  const r = this.parse_meta_item_lit();
  if (r.$ === "Err") return r;
  const lit = r._0;

  if (!ast.LitKind.is_unsuffixed(lit.kind)) {
    this.dcx().emit_err(diagnostics.SuffixedLiteralInAttribute_diagnostic({ span: lit.span }));
  }

  return Ok(lit);
};

/// Matches `COMMASEP(meta_item_inner)`.
// rustc: compiler/rustc_parse/src/parser/attr.rs:418 parse_meta_seq_top
Parser.prototype.parse_meta_seq_top = function (this: Parser): PResult<MetaItemInner[]> {
  // Presumably, the majority of the time there will only be one attr.
  const nmis: MetaItemInner[] = [];
  while (!this.token.eq(token.TokenKind.Eof)) {
    const r = this.parse_meta_item_inner();
    if (r.$ === "Err") return r;
    nmis.push(r._0);
    if (!this.eat(exp.Comma)) {
      break;
    }
  }
  return Ok(nmis);
};

/// Parse a meta item per RFC 1559.
///
/// ```ebnf
/// MetaItem = SimplePath ( '=' UNSUFFIXED_LIT | '(' MetaSeq? ')' )? ;
/// MetaSeq = MetaItemInner (',' MetaItemInner)* ','? ;
/// ```
// rustc: compiler/rustc_parse/src/parser/attr.rs:436 parse_meta_item
Parser.prototype.parse_meta_item = function (this: Parser): PResult<MetaItem> {
  const mvk = this.token.is_metavar_seq();
  if (mvk !== undefined && mvk.$ === "Meta") {
    const has_meta_form = mvk.has_meta_form;
    if (has_meta_form) {
      const attr_item = unwrap(
        this.eat_metavar_seq({ $: "Meta", has_meta_form: true }, (this_) => this_.parse_attr_item(ForceCollect.No)),
      ).node;
      return Ok(unwrap(attr_item.meta(attr_item.span)));
    } else {
      return this.unexpected_any();
    }
  }
  const lo = this.token.span;

  const r = this.parse_path(PathStyle.Mod);
  if (r.$ === "Err") return r;
  const path = r._0;
  const r2 = this.parse_meta_item_kind();
  if (r2.$ === "Err") return r2;
  const kind = r2._0;
  const span = Span.to(lo, this.prev_token.span);

  return Ok(new ast.MetaItem(ast.Safety.Default, path, kind, span));
};

// rustc: compiler/rustc_parse/src/parser/attr.rs:459 parse_meta_item_kind
Parser.prototype.parse_meta_item_kind = function (this: Parser): PResult<MetaItemKind> {
  if (this.eat(exp.Eq)) {
    const r = this.parse_unsuffixed_meta_item_lit();
    if (r.$ === "Err") return r;
    return Ok({ $: "NameValue", _0: r._0 });
  } else if (this.check(exp.OpenParen)) {
    const r = this.parse_paren_comma_seq((p) => p.parse_meta_item_inner());
    if (r.$ === "Err") return r;
    const [list] = r._0;
    return Ok({ $: "List", _0: list });
  } else {
    return Ok(ast.MetaItemKind.Word);
  }
};

/// Parse an inner meta item per RFC 1559.
///
/// ```ebnf
/// MetaItemInner = UNSUFFIXED_LIT | MetaItem ;
/// ```
// rustc: compiler/rustc_parse/src/parser/attr.rs:475 parse_meta_item_inner
Parser.prototype.parse_meta_item_inner = function (this: Parser): PResult<MetaItemInner> {
  const r = this.parse_unsuffixed_meta_item_lit();
  switch (r.$) {
    case "Ok":
      return Ok({ $: "Lit", _0: r._0 });
    case "Err":
      r._0.cancel(); // we provide a better error below
      break;
  }

  const r2 = this.parse_meta_item();
  switch (r2.$) {
    case "Ok":
      return Ok({ $: "MetaItem", _0: r2._0 });
    case "Err":
      r2._0.cancel(); // we provide a better error below
      break;
  }

  const err: diagnostics.InvalidMetaItem = {
    span: this.token.span,
    descr: token_descr(this.token),
    quote_ident_sugg: undefined,
  };

  // Suggest quoting idents, e.g. in `#[cfg(key = value)]`. We don't use `Token::ident` and
  // don't `uninterpolate` the token to avoid suggesting anything butchered or questionable
  // when macro metavariables are involved.
  if (this.prev_token.eq(token.TokenKind.Eq) && this.token.kind.$ === "Ident") {
    const before = Span.shrink_to_lo(this.token.span);
    while (this.token.kind.$ === "Ident") {
      this.bump();
    }
    err.quote_ident_sugg = {
      before,
      after: Span.shrink_to_hi(this.prev_token.span),
    };
  }

  return Err(this.dcx().create_err(diagnostics.InvalidMetaItem_diagnostic(err)));
};

/// Recover from outer attributes in places where none were expected.
// rustc: compiler/rustc_parse/src/parser/attr.rs:512 recover_from_outer_attributes
Parser.prototype.recover_from_outer_attributes = function (this: Parser, target: string): PResult<undefined> {
  // We check the token ourselves first to prevent `#`
  // from getting added to the set of expected tokens.
  if (!this.may_recover() || !(this.token.kind.$ === "Pound" || this.token.kind.$ === "DocComment")) {
    return Ok(undefined);
  }

  const r = this.parse_outer_attributes();
  if (r.$ === "Err") return r;
  const attrs_ = r._0;
  if (attrs_.is_empty()) {
    return Ok(undefined);
  }

  const attrs = attrs_.take_for_recovery(this.psess);
  const span = Span.to(unwrap(attrs[0]).span, unwrap(attrs[attrs.length - 1]).span);

  const subject = attrs.every((attr_) => attr_.kind.$ === "DocComment") ? "doc comments" : "attributes";

  this.dcx()
    .struct_span_err(span, `${subject} cannot be applied to ${target}`)
    .with_span_label(span, `${subject} are not allowed here`)
    .with_span_suggestion_with_style(
      Span.until(span, this.token.span),
      `remove these ${subject}`,
      "",
      Applicability.MachineApplicable,
      SuggestionStyle.CompletelyHidden,
    )
    .emit();

  return Ok(undefined);
};
