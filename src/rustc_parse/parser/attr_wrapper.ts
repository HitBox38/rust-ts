// Port of compiler/rustc_parse/src/parser/attr_wrapper.rs
// Types (`CollectPos`, `UsePreAttrPos`, `AttrWrapper`) are generated into attr_wrapper.gen.ts.
import { type AttrVec, type Attribute, clone_Attribute } from "../../rustc_ast/lib.ts";
import type { HasAttrs, HasTokens } from "../../rustc_ast/ast_traits.ts";
import { tokenstream } from "../../rustc_ast/lib.ts";
import type { NodeReplacement, ParserReplacement } from "../../rustc_ast/tokenstream.ts";
import { is_builtin_attr_name } from "../../rustc_feature/builtin_attrs.ts";
import type { PResult } from "../../rustc_errors/lib.ts";
import type { ParseSess } from "../../rustc_session/parse.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { sym } from "../../rustc_span/symbol.ts";
import { assert, unreachable, unwrap } from "../../std/panic.ts";
import { Ok } from "../../std/result.ts";
import * as gen from "./attr_wrapper.gen.ts";
import type { CollectPos, UsePreAttrPos } from "./attr_wrapper.gen.ts";
import { Parser } from "./mod.ts";
import { Capturing, ForceCollect, Trailing } from "./mod.gen.ts";

export * from "./attr_wrapper.gen.ts";

// PORT: statics of the generated `AttrWrapper` class (methods: `declare module` below).
export const AttrWrapper = gen.AttrWrapper as typeof gen.AttrWrapper & {
  "new": (attrs: AttrVec, start_pos: number) => AttrWrapper;
  empty: () => AttrWrapper;
};
export type AttrWrapper = gen.AttrWrapper;

declare module "./attr_wrapper.gen.ts" {
  interface AttrWrapper {
    take_for_recovery(psess: ParseSess): AttrVec;
    prepend_to_nt_inner(attrs: AttrVec): void;
    is_empty(): boolean;
  }
}

// rustc: compiler/rustc_parse/src/parser/attr_wrapper.rs:55 new
AttrWrapper.new = function (attrs: AttrVec, start_pos: number): AttrWrapper {
  return new gen.AttrWrapper(attrs, start_pos);
};

// rustc: compiler/rustc_parse/src/parser/attr_wrapper.rs:59 empty
AttrWrapper.empty = function (): AttrWrapper {
  return new gen.AttrWrapper([], undefined);
};

// rustc: compiler/rustc_parse/src/parser/attr_wrapper.rs:63 take_for_recovery
gen.AttrWrapper.prototype.take_for_recovery = function (this: AttrWrapper, psess: ParseSess): AttrVec {
  const a = this.attrs[0];
  psess.dcx().span_delayed_bug(a !== undefined ? a.span : DUMMY_SP, "AttrVec is taken for recovery but no error is produced");

  return this.attrs;
};

/// Prepend `self.attrs` to `attrs`.
// FIXME: require passing an NT to prevent misuse of this method
// rustc: compiler/rustc_parse/src/parser/attr_wrapper.rs:74 prepend_to_nt_inner
gen.AttrWrapper.prototype.prepend_to_nt_inner = function (this: AttrWrapper, attrs: AttrVec): void {
  // PORT: `mem::swap(attrs, &mut self.attrs); attrs.extend(self.attrs)` on the caller's vector,
  // in place: `attrs` becomes `self.attrs` followed by its old contents.
  const old = attrs.splice(0, attrs.length);
  attrs.push(...this.attrs);
  this.attrs = old;
  attrs.push(...this.attrs);
};

// rustc: compiler/rustc_parse/src/parser/attr_wrapper.rs:79 is_empty
gen.AttrWrapper.prototype.is_empty = function (this: AttrWrapper): boolean {
  return this.attrs.length === 0;
};

/// Returns `true` if `attrs` contains a `cfg` or `cfg_attr` attribute
// rustc: compiler/rustc_parse/src/parser/attr_wrapper.rs:85 has_cfg_or_cfg_attr
function has_cfg_or_cfg_attr(attrs: readonly Attribute[]): boolean {
  // NOTE: Builtin attributes like `cfg` and `cfg_attr` cannot be renamed via imports.
  // Therefore, the absence of a literal `cfg` or `cfg_attr` guarantees that
  // we don't need to do any eager expansion.
  return attrs.some((attr) => {
    const ident = attr.name();
    return ident !== undefined && (ident === sym.cfg || ident === sym.cfg_attr);
  });
}

// rustc: compiler/rustc_parse/src/parser/attr_wrapper.rs:95 collect_pos
Parser.prototype.collect_pos = function (this: Parser): CollectPos {
  return {
    start_token: [this.token, this.token_spacing],
    cursor_snapshot: tokenstream.clone_TokenCursor(this.token_cursor),
    start_pos: this.num_bump_calls,
  };
};

/// Parses code with `f`. If appropriate, it records the tokens (in
/// `LazyAttrTokenStream` form) that were parsed in the result, accessible
/// via the `HasTokens` trait.
///
/// Why is this done? Various macro cases require an AST node's tokens.
/// - Proc macros: all proc macros take a token stream.
///   - Function-style proc macros (`foo!(..)`): these can receive a token
///     stream without any parsing occurring within the parentheses.
///   - Attribute macros (`#[foo]`): at parse time (pre-resolution) we
///     don't know if a non-builtin `#[foo]` is an attribute proc macro, so
///     the parser does a full parse and collects tokens (lazily) in case.
///   - Derive macros (`derive(Foo)`): any input with
///     `#[cfg]`/`#[cfg_attr]` must be stripped before being passed to the
///     derive macro, which requires parsing. Identifying the end of the
///     item also requires parsing.
/// - Decl macros: a matched nonterminal (e.g. `$e:expr`) needs tokens in
///   case it is passed into a proc macro.
///
/// The `Trailing` part of the callback's result indicates if an extra
/// token should be captured, e.g. a comma or semicolon. The
/// `UsePreAttrPos` part of the callback's result indicates if we should
/// use `pre_attr_pos` as the collection start position (only required in a
/// few cases).
///
/// The `attrs` passed in are in `AttrWrapper` form, which is opaque. The
/// `AttrVec` within is passed to `f`. See the comment on `AttrWrapper` for
/// details.
///
/// `pre_attr_pos` is the position before the outer attributes (or the node
/// itself, if no outer attributes are present). It is only needed if `f`
/// can return `UsePreAttrPos::Yes`.
///
/// Note: If your callback consumes an opening delimiter (including the
/// case where `self.token` is an opening delimiter on entry to this
/// function), you must also consume the corresponding closing delimiter.
/// E.g. you can consume `something ([{ }])` or `([{}])`, but not `([{}]`.
/// This restriction isn't a problem in practice, because parsed AST items
/// always have matching delimiters.
///
/// The following example code will be used to explain things in comments
/// below. It has an outer attribute and an inner attribute. Parsing it
/// involves two calls to this method, one of which is indirectly
/// recursive.
/// ```ignore (fake attributes)
/// #[cfg_eval]                         // token pos
/// mod m {                             //   0.. 3
///     #[cfg_attr(cond1, attr1)]       //   3..12
///     fn g() {                        //  12..17
///         #![cfg_attr(cond2, attr2)]  //  17..27
///         let _x = 3;                 //  27..32
///     }                               //  32..33
/// }                                   //  33..34
/// ```
// PORT: `R: HasTokens` (supertrait `HasAttrs`) -> the trailing impl tables `R_HasTokens`, `R_HasAttrs`.
// rustc: compiler/rustc_parse/src/parser/attr_wrapper.rs:156 collect_tokens
Parser.prototype.collect_tokens = function <R>(
  this: Parser,
  pre_attr_pos: CollectPos | undefined,
  attrs: AttrWrapper,
  force_collect: ForceCollect,
  f: (this_: Parser, a1: AttrVec) => PResult<[R, Trailing, UsePreAttrPos]>,
  R_HasTokens: HasTokens<R>,
  R_HasAttrs: HasAttrs<R>,
): PResult<R> {
  const possible_capture_mode = this.capture_cfg;

  // We must collect if anything could observe the collected tokens, i.e.
  // if any of the following conditions hold.
  // - We are force collecting tokens (because force collection requires
  //   tokens by definition).
  const needs_collection =
    force_collect === ForceCollect.Yes ||
    // - Any of our outer attributes require tokens.
    needs_tokens(attrs.attrs) ||
    // - Our target supports custom inner attributes (custom
    //   inner attribute invocation might require token capturing).
    R_HasAttrs.SUPPORTS_CUSTOM_INNER_ATTRS ||
    // - We are in "possible capture mode" (which requires tokens if
    //   the parsed node has `#[cfg]` or `#[cfg_attr]` attributes).
    possible_capture_mode;
  if (!needs_collection) {
    const r = f(this, attrs.attrs);
    if (r.$ === "Err") return r;
    return Ok(r._0[0]);
  }

  let collect_pos = this.collect_pos();
  const has_outer_attrs = attrs.attrs.length !== 0;
  const parser_replacements_start = this.capture_state.parser_replacements.length;

  // We set and restore `Capturing::Yes` on either side of the call to
  // `f`, so we can distinguish the outermost call to `collect_tokens`
  // (e.g. parsing `m` in the example above) from any inner (indirectly
  // recursive) calls (e.g. parsing `g` in the example above). This
  // distinction is used below and in `Parser::parse_inner_attributes`.
  let ret: R;
  let capture_trailing: Trailing;
  let use_pre_attr_pos: UsePreAttrPos;
  {
    const prev_capturing = this.capture_state.capturing;
    this.capture_state.capturing = Capturing.Yes;
    const res = f(this, attrs.attrs);
    this.capture_state.capturing = prev_capturing;
    if (res.$ === "Err") return res;
    [ret, capture_trailing, use_pre_attr_pos] = res._0;
  }

  // - `None`: Our target doesn't support tokens at all (e.g. `NtIdent`).
  // - `Some(None)`: Our target supports tokens and has none.
  // - `Some(Some(_))`: Our target already has tokens set (e.g. we've
  //   parsed something like `#[my_attr] $item`).
  const tm = R_HasTokens.tokens_mut(ret);
  const ret_can_hold_tokens = tm !== undefined && tm.value === undefined;

  // Ignore any attributes we've previously processed. This happens when
  // an inner call to `collect_tokens` returns an AST node and then an
  // outer call ends up with the same AST node without any additional
  // wrapping layer.
  const seen_indices = new Set<number>();
  R_HasAttrs.attrs(ret).forEach((attr, i) => {
    // PORT: `IntervalSet::insert` returns whether the element was newly inserted.
    const seen = this.capture_state.seen_attrs;
    const is_unseen = !seen.has(attr.id);
    seen.add(attr.id);
    if (!is_unseen) {
      seen_indices.add(i);
    }
  });
  const ret_attrs: readonly Attribute[] =
    seen_indices.size === 0
      ? R_HasAttrs.attrs(ret)
      : R_HasAttrs.attrs(ret).filter((_attr, i) => !seen_indices.has(i)).map(clone_Attribute);

  // When we're not in "definite capture mode", then skip collecting and
  // return early if `ret` doesn't support tokens or already has some.
  //
  // Note that this check is independent of `force_collect`. There's no
  // need to collect tokens when we don't support tokens or already have
  // tokens.
  const definite_capture_mode =
    this.capture_cfg && this.capture_state.capturing === Capturing.Yes && has_cfg_or_cfg_attr(ret_attrs);
  if (!definite_capture_mode && !ret_can_hold_tokens) {
    return Ok(ret);
  }

  // This is similar to the `needs_collection` check at the start of this
  // function, but now that we've parsed an AST node we have complete
  // information available. (If we return early here that means the
  // setup, such as cloning the token cursor, was unnecessary. That's
  // hard to avoid.)
  //
  // We must collect if anything could observe the collected tokens, i.e.
  // if any of the following conditions hold.
  // - We are force collecting tokens.
  const needs_collection2 =
    force_collect === ForceCollect.Yes ||
    // - Any of our outer *or* inner attributes require tokens.
    //   (`attr.attrs` was just outer attributes, but `ret.attrs()` is
    //   outer and inner attributes. So this check is more precise than
    //   the earlier `needs_tokens` check, and we don't need to
    //   check `R::SUPPORTS_CUSTOM_INNER_ATTRS`.)
    needs_tokens(ret_attrs) ||
    // - We are in "definite capture mode", which requires that there
    //   are `#[cfg]` or `#[cfg_attr]` attributes. (During normal
    //   non-`capture_cfg` parsing, we don't need any special capturing
    //   for those attributes, because they're builtin.)
    definite_capture_mode;
  if (!needs_collection2) {
    return Ok(ret);
  }

  // Replace the post-attribute collection start position with the
  // pre-attribute position supplied, if `f` indicated it is necessary.
  // (The caller is responsible for providing a non-`None` `pre_attr_pos`
  // if this is a possibility.)
  if (use_pre_attr_pos === "Yes") {
    collect_pos = unwrap(pre_attr_pos);
  }

  const parser_replacements_end = this.capture_state.parser_replacements.length;

  assert(
    !(this.break_last_token > 0 && capture_trailing === Trailing.Yes),
    "Cannot have break_last_token > 0 and have trailing token",
  );
  assert(this.break_last_token <= 2, "cannot break token more than twice");

  const end_pos =
    this.num_bump_calls +
    // PORT: `capture_trailing as u32` (`Trailing::No` = 0, `Trailing::Yes` = 1).
    (capture_trailing === Trailing.Yes ? 1 : 0) +
    // If we "broke" the last token (e.g. breaking a `>>` token once into `>` + `>`, or
    // breaking a `>>=` token twice into `>` + `>` + `=`), then extend the range of
    // captured tokens to include it, because the parser was not actually bumped past it.
    // (Even if we broke twice, it was still just one token originally, hence the `1`.)
    // When the `LazyAttrTokenStream` gets converted into an `AttrTokenStream`, we will
    // rebreak that final token once or twice.
    (this.break_last_token === 0 ? 0 : 1);

  const num_calls = end_pos - collect_pos.start_pos;

  // Take the captured `ParserRange`s for any inner attributes that we parsed in
  // `Parser::parse_inner_attributes`, and pair them in a `ParserReplacement` with `None`,
  // which means the relevant tokens will be removed. (More details below.)
  const inner_attr_parser_replacements: ParserReplacement[] = [];
  for (const attr of ret_attrs) {
    if (attr.style === "Inner") {
      const ranges = this.capture_state.inner_attr_parser_ranges;
      const inner_attr_parser_range = ranges.get(attr.id);
      if (inner_attr_parser_range !== undefined) {
        ranges.delete(attr.id);
        inner_attr_parser_replacements.push([inner_attr_parser_range, undefined]);
      } else {
        this.dcx().span_delayed_bug(attr.span, "Missing token range for attribute");
      }
    }
  }

  // This is hot enough for `deep-vector` that checking the conditions for an empty iterator
  // is measurably faster than actually executing the iterator.
  let node_replacements: NodeReplacement[];
  if (parser_replacements_start === parser_replacements_end && inner_attr_parser_replacements.length === 0) {
    node_replacements = [];
  } else {
    // Grab any replace ranges that occur *inside* the current AST node. Convert them
    // from `ParserRange` form to `NodeRange` form. We will perform the actual
    // replacement only when we convert the `LazyAttrTokenStream` to an
    // `AttrTokenStream`.
    node_replacements = this.capture_state.parser_replacements
      .slice(parser_replacements_start, parser_replacements_end)
      .map((r): ParserReplacement => [r[0], r[1] === undefined ? undefined : tokenstream.clone_AttrsTarget(r[1])])
      .concat(inner_attr_parser_replacements)
      .map(([parser_range, data]): NodeReplacement => [tokenstream.NodeRange.new(parser_range, collect_pos.start_pos), data]);
  }

  // What is the status here when parsing the example code at the top of this method?
  //
  // When parsing `g`:
  // - `start_pos..end_pos` is `12..33` (`fn g { ... }`, excluding the outer attr).
  // - `inner_attr_parser_replacements` has one entry (`ParserRange(17..27)`), to
  //   delete the inner attr's tokens.
  //   - This entry is converted to `NodeRange(5..15)` (relative to the `fn`) and put into
  //     the lazy tokens for `g`, i.e. deleting the inner attr from those tokens (if they get
  //     evaluated).
  //   - Those lazy tokens are also put into an `AttrsTarget` that is appended to `self`'s
  //     replace ranges at the bottom of this function, for processing when parsing `m`.
  // - `parser_replacements_start..parser_replacements_end` is empty.
  //
  // When parsing `m`:
  // - `start_pos..end_pos` is `0..34` (`mod m`, excluding the `#[cfg_eval]` attribute).
  // - `inner_attr_parser_replacements` is empty.
  // - `parser_replacements_start..parser_replacements_end` has one entry.
  //   - One `AttrsTarget` (added below when parsing `g`) to replace all of `g` (`3..33`,
  //     including its outer attribute), with:
  //     - `attrs`: includes the outer and the inner attr.
  //     - `tokens`: lazy tokens for `g` (with its inner attr deleted).

  const tokens = tokenstream.LazyAttrTokenStream.new_pending(
    collect_pos.start_token,
    collect_pos.cursor_snapshot,
    num_calls,
    this.break_last_token,
    node_replacements,
  );
  let tokens_used = false;

  // If in "definite capture mode" we need to register a replace range
  // for the `#[cfg]` and/or `#[cfg_attr]` attrs. This allows us to run
  // eager cfg-expansion on the captured token stream.
  if (definite_capture_mode) {
    assert(this.break_last_token === 0, "Should not have unglued last token with cfg attr");

    // What is the status here when parsing the example code at the top of this method?
    //
    // When parsing `g`, we add one entry:
    // - The pushed entry (`ParserRange(3..33)`) has a new `AttrsTarget` with:
    //   - `attrs`: includes the outer and the inner attr.
    //   - `tokens`: lazy tokens for `g` (with its inner attr deleted).
    //
    // When parsing `m`, we do nothing here.

    // Set things up so that the entire AST node that we just parsed, including attributes,
    // will be replaced with `target` in the lazy token stream. This will allow us to
    // cfg-expand this AST node.
    const start_pos = has_outer_attrs ? unwrap(attrs.start_pos) : collect_pos.start_pos;
    const target: tokenstream.AttrsTarget = {
      attrs: ret_attrs.map(clone_Attribute),
      tokens: tokenstream.clone_LazyAttrTokenStream(tokens),
    };
    tokens_used = true;
    this.capture_state.parser_replacements.push([{ _0: { start: start_pos, end: end_pos } }, target]);
  } else if (this.capture_state.capturing === Capturing.No) {
    // Only clear the ranges once we've finished capturing entirely, i.e. we've finished
    // the outermost call to this method.
    this.capture_state.parser_replacements.length = 0;
    this.capture_state.inner_attr_parser_ranges.clear();
    this.capture_state.seen_attrs.clear();
  }

  // If we support tokens and don't already have them, store the newly captured tokens.
  const target_tokens = R_HasTokens.tokens_mut(ret);
  if (target_tokens !== undefined && target_tokens.value === undefined) {
    tokens_used = true;
    target_tokens.value = tokens;
  }

  assert(tokens_used, "assertion failed: tokens_used"); // check we didn't create `tokens` unnecessarily
  return Ok(ret);
};

// rustc: compiler/rustc_parse/src/parser/attr_wrapper.rs:410 needs_tokens
function needs_tokens(attrs: readonly Attribute[]): boolean {
  // Tokens are needed if...
  return attrs.some((attr) => {
    const kind = attr.kind;
    switch (kind.$) {
      case "Normal": {
        const name = kind._0.item.name();
        // ... a multi-segment attribute is present, e.g. `rustfmt::skip`.
        if (name === undefined) return true;
        // ... `cfg_attr` or a single-segment non-builtin attribute is present, e.g.
        // `derive`, `test`, `global_allocator`.
        return name === sym.cfg_attr || !is_builtin_attr_name(name);
      }
      // Synthetic attributes are created only during expansion, and can't re-enter the parser
      // because they have no token form.
      case "Synthetic":
        return unreachable();
      case "DocComment":
        return false;
    }
  });
}
