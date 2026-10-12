// Port of compiler/rustc_ast/src/tokenstream.rs
//! # Token Streams
//!
//! `TokenStream`s represent syntactic objects before they are converted into ASTs.
//! A `TokenStream` is, roughly speaking, a sequence of [`TokenTree`]s,
//! which are themselves a single [`Token`] or a `Delimited` subsequence of tokens.
//
// Types and derived Debug impls are generated into tokenstream.gen.ts (tools/codegen/types.ts).
//
// PORT: conventions of this module.
// - Method placement as in token.ts: enum methods on companion consts, statics of generated classes
//   assigned onto the class (re-exported with the extended type), `&self` methods on the prototype
//   (declared through `declare module "./tokenstream.gen.ts"`).
// - `Arc<Vec<TokenTree>>` is a plain array (PORTING §5). Arrays reachable from a `TokenStream` /
//   `AttrTokenStream` are shared and must never be mutated in place. `Arc::make_mut` is the
//   `make_mut` helper below: it gives the wrapper a fresh copy of the array (upstream copies only
//   when the `Arc` is shared; refcounts are not tracked here).
// - `TokenStream::clone()` (an `Arc` clone) is `new TokenStream(ts._0)`: a new wrapper sharing the
//   array, so that `make_mut` on one wrapper never affects another.
// - `TokenTree`s and `Token`s are shared by reference and treated as immutable values.
// - Nothing from token.ts/ast.ts is used at module top level: the modules form an import cycle.
// - `TokenStreamIter` (wraps `std::slice::Iter<TokenTree>`) is skipped by the generator and is
//   defined here as a class.
import { type Attribute } from "./ast.ts";
import {
  debug_Delimiter,
  type Delimiter,
  Delimiter_eq,
  Delimiter as DelimiterC,
  type Token,
  Token as TokenC,
  TokenKind,
  TokenKind_eq,
} from "./token.ts";
import * as gen from "./tokenstream.gen.ts";
import {
  type AttrTokenTree,
  type AttrsTarget,
  debug_AttrTokenTree,
  type FlatToken,
  type LazyAttrTokenStreamInner as LazyAttrTokenStreamInnerT,
  type NodeReplacement,
  type ParserRange,
  Spacing,
  type TokenTree as TokenTreeT,
} from "./tokenstream.gen.ts";
import { BytePos, DUMMY_SP, Span, debug_Span } from "../rustc_span/lib.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import { type Debug, PLAIN } from "../std/fmt.ts";
import { assert, panic, unported, unwrap } from "../std/panic.ts";
import { extend, partition_point, splice } from "../std/slice.ts";

export * from "./tokenstream.gen.ts";

// Ensure all fields of `TokenTree` are `DynSend` and `DynSync`.
// rustc: compiler/rustc_ast/src/tokenstream.rs:39 _dummy
// PORT: a compile-time trait-bound check; nothing to do at run time.
function _dummy(): void {}

/// Part of a `TokenStream`.
export type TokenTree = TokenTreeT;
export const TokenTree = {
  /// Checks if this `TokenTree` is equal to the other, regardless of span/spacing information.
  // rustc: compiler/rustc_ast/src/tokenstream.rs:51 eq_unspanned
  eq_unspanned(self: TokenTree, other: TokenTree): boolean {
    if (self.$ === "Token" && other.$ === "Token") {
      const token = self._0;
      const token2 = other._0;
      return TokenKind_eq(token.kind, token2.kind);
    }
    if (self.$ === "Delimited" && other.$ === "Delimited") {
      const delim = self._2;
      const tts = self._3;
      const delim2 = other._2;
      const tts2 = other._3;
      if (!Delimiter_eq(delim, delim2)) return false;
      // tts.iter().eq_by(tts2.iter(), |a, b| a.eq_unspanned(b))
      if (tts._0.length !== tts2._0.length) return false;
      for (let i = 0; i < tts._0.length; i++) {
        if (!TokenTree.eq_unspanned(tts._0[i]!, tts2._0[i]!)) return false;
      }
      return true;
    }
    return false;
  },

  /// Retrieves the `TokenTree`'s span.
  // rustc: compiler/rustc_ast/src/tokenstream.rs:62 span
  span(self: TokenTree): Span {
    switch (self.$) {
      case "Token":
        return self._0.span;
      case "Delimited":
        return self._0.entire();
    }
  },

  /// Create a `TokenTree::Token` with alone spacing.
  // rustc: compiler/rustc_ast/src/tokenstream.rs:70 token_alone
  token_alone(kind: TokenKind, span: Span): TokenTree {
    return { $: "Token", _0: TokenC.new(kind, span), _1: Spacing.Alone };
  },

  /// Create a `TokenTree::Token` with joint spacing.
  // rustc: compiler/rustc_ast/src/tokenstream.rs:75 token_joint
  token_joint(kind: TokenKind, span: Span): TokenTree {
    return { $: "Token", _0: TokenC.new(kind, span), _1: Spacing.Joint };
  },

  /// Create a `TokenTree::Token` with joint-hidden spacing.
  // rustc: compiler/rustc_ast/src/tokenstream.rs:80 token_joint_hidden
  token_joint_hidden(kind: TokenKind, span: Span): TokenTree {
    return { $: "Token", _0: TokenC.new(kind, span), _1: Spacing.JointHidden };
  },

  // rustc: compiler/rustc_ast/src/tokenstream.rs:84 uninterpolate
  // PORT: `Cow<'_, TokenTree>` -> `TokenTree`; `Cow::Borrowed(self)` is `self` itself.
  uninterpolate(self: TokenTree): TokenTree {
    switch (self.$) {
      case "Token": {
        const token = self._0;
        const spacing = self._1;
        const t = token.uninterpolate();
        if (t !== token) {
          // Cow::Owned(token)
          return { $: "Token", _0: t, _1: spacing };
        }
        // Cow::Borrowed(_)
        return self;
      }
      default:
        return self;
    }
  },
};

declare module "./tokenstream.gen.ts" {
  interface WithTokens<T> {
    map<U>(f: (node: T) => U): WithTokens<U>;
  }
  interface LazyAttrTokenStream {
    to_attr_token_stream(): AttrTokenStream;
  }
  interface AttrTokenStream {
    to_token_trees(): TokenTree[];
  }
  interface TokenStream {
    is_empty(): boolean;
    len(): number;
    get(index: number): TokenTree | undefined;
    iter(): TokenStreamIter;
    push_tree_with_gluing(tt: TokenTree): void;
    push_stream_with_gluing(stream: TokenStream): void;
    desugar_doc_comments(): void;
    add_comma(): [TokenStream, Span] | undefined;
  }
  interface TokenTreeCursor {
    curr(): TokenTree | undefined;
    next(): TokenTree | undefined;
    look_ahead(n: number): TokenTree | undefined;
    bump(): void;
    bump_to_end(): void;
  }
  interface TokenCursor {
    next_and_bump(): [Token, Spacing];
    look_ahead(n: number): TokenTree | undefined;
    look_ahead_past_close_delim(): TokenTree | undefined;
    clone_enclosing_delim(): TokenTree;
    bump_to_end(): void;
    depth(): number;
    parent_delim_and_span(): [Delimiter, DelimSpan] | undefined;
    inlined_next_and_bump(): [Token, Spacing];
  }
  interface DelimSpan {
    entire(): Span;
  }
}

// PORT: statics of the generated `WithTokens` class.
export const WithTokens = gen.WithTokens as typeof gen.WithTokens & {
  "new": <T>(node: T) => WithTokens<T>;
};
export type WithTokens<T> = gen.WithTokens<T>;

// rustc: compiler/rustc_ast/src/tokenstream.rs:102 new
WithTokens.new = function <T>(node: T): WithTokens<T> {
  return new gen.WithTokens(node, undefined);
};

// rustc: compiler/rustc_ast/src/tokenstream.rs:106 map
gen.WithTokens.prototype.map = function <T, U>(this: WithTokens<T>, f: (node: T) => U): WithTokens<U> {
  return new gen.WithTokens(f(this.node), this.tokens);
};

/// A lazy version of [`AttrTokenStream`], which defers creation of an actual
/// `AttrTokenStream` until it is needed.
// PORT: statics of the generated `LazyAttrTokenStream` class.
export const LazyAttrTokenStream = gen.LazyAttrTokenStream as typeof gen.LazyAttrTokenStream & {
  new_direct: (stream: AttrTokenStream) => LazyAttrTokenStream;
  new_pending: (
    start_token: [Token, Spacing],
    cursor_snapshot: TokenCursor,
    num_calls: number,
    break_last_token: number,
    node_replacements: NodeReplacement[],
  ) => LazyAttrTokenStream;
};
export type LazyAttrTokenStream = gen.LazyAttrTokenStream;

// rustc: compiler/rustc_ast/src/tokenstream.rs:117 new_direct
LazyAttrTokenStream.new_direct = function (stream: AttrTokenStream): LazyAttrTokenStream {
  return new gen.LazyAttrTokenStream({ $: "Direct", _0: stream });
};

// rustc: compiler/rustc_ast/src/tokenstream.rs:121 new_pending
LazyAttrTokenStream.new_pending = function (
  start_token: [Token, Spacing],
  cursor_snapshot: TokenCursor,
  num_calls: number,
  break_last_token: number,
  node_replacements: NodeReplacement[],
): LazyAttrTokenStream {
  return new gen.LazyAttrTokenStream({
    $: "Pending",
    start_token,
    cursor_snapshot,
    num_calls,
    break_last_token,
    node_replacements,
  });
};

// rustc: compiler/rustc_ast/src/tokenstream.rs:137 to_attr_token_stream
gen.LazyAttrTokenStream.prototype.to_attr_token_stream = function (this: LazyAttrTokenStream): AttrTokenStream {
  return LazyAttrTokenStreamInner.to_attr_token_stream(this._0);
};

// rustc: compiler/rustc_ast/src/tokenstream.rs:143 fmt
// PORT: `write!(f, ..)` formats its arguments with a fresh `Formatter` (no `{:#?}` flag), hence `PLAIN`.
export const debug_LazyAttrTokenStream: Debug<LazyAttrTokenStream> = (v, _f) =>
  `LazyAttrTokenStream(${gen.debug_AttrTokenStream(v.to_attr_token_stream(), PLAIN)})`;

// rustc-skip: compiler/rustc_ast/src/tokenstream.rs:149 encode Encodable (metadata, out of scope until M5)
// rustc-skip: compiler/rustc_ast/src/tokenstream.rs:155 decode Decodable (metadata, out of scope until M5)
// rustc-skip: compiler/rustc_ast/src/tokenstream.rs:161 stable_hash StableHash (incremental, out of scope until M5)

// PORT: statics of the generated `NodeRange` class.
export const NodeRange = gen.NodeRange as typeof gen.NodeRange & {
  "new": (parser_range: ParserRange, start_pos: number) => NodeRange;
};
export type NodeRange = gen.NodeRange;

// Converts a range within a parser's tokens to a range within a
// node's tokens beginning at `start_pos`.
//
// For example, imagine a parser with 50 tokens in its token stream, a
// function that spans `ParserRange(20..40)` and an inner attribute within
// that function that spans `ParserRange(30..35)`. We would find the inner
// attribute's range within the function's tokens by subtracting 20, which
// is the position of the function's start token. This gives
// `NodeRange(10..15)`.
// rustc: compiler/rustc_ast/src/tokenstream.rs:210 new
NodeRange.new = function ({ _0: parser_range }: ParserRange, start_pos: number): NodeRange {
  assert(!(parser_range.start >= parser_range.end), "assertion failed: !parser_range.is_empty()");
  assert(parser_range.start >= start_pos, "assertion failed: parser_range.start >= start_pos");
  return new gen.NodeRange({ start: parser_range.start - start_pos, end: parser_range.end - start_pos });
};

export type LazyAttrTokenStreamInner = LazyAttrTokenStreamInnerT;
export const LazyAttrTokenStreamInner = {
  // rustc: compiler/rustc_ast/src/tokenstream.rs:242 to_attr_token_stream
  to_attr_token_stream(self: LazyAttrTokenStreamInner): AttrTokenStream {
    switch (self.$) {
      case "Direct": {
        const stream = self._0;
        return new gen.AttrTokenStream(stream._0);
      }
      case "Pending": {
        const { start_token, cursor_snapshot: cursor_snapshot0, num_calls, break_last_token, node_replacements } = self;
        // The token produced by the final call to `{,inlined_}next_and_bump` was not
        // actually consumed by the callback. The combination of chaining the
        // initial token and using `take` produces the desired result - we
        // produce an empty `TokenStream` if no calls were made, and omit the
        // final token otherwise.
        const cursor_snapshot = clone_TokenCursor(cursor_snapshot0);
        // iter::once(FlatToken::Token(*start_token))
        //     .chain(iter::repeat_with(|| FlatToken::Token(cursor_snapshot.next_and_bump())))
        //     .take(*num_calls as usize);
        const tokens = function* (): Generator<FlatToken> {
          if (num_calls === 0) return;
          yield { $: "Token", _0: start_token };
          for (let i = 1; i < num_calls; i++) {
            yield { $: "Token", _0: cursor_snapshot.next_and_bump() };
          }
        };

        if (node_replacements.length === 0) {
          return make_attr_token_stream(tokens(), break_last_token);
        } else {
          const tokens_: FlatToken[] = [...tokens()];
          const node_replacements_ = node_replacements.slice();
          node_replacements_.sort((a, b) => a[0]._0.start - b[0]._0.start);

          // #[cfg(debug_assertions)]
          // for [(node_range, tokens), (next_node_range, next_tokens)] in
          //     node_replacements.array_windows()
          // {
          //     assert!(
          //         node_range.0.end <= next_node_range.0.start
          //             || node_range.0.end >= next_node_range.0.end,
          //         "Node ranges should be disjoint or nested: ({:?}, {:?}) ({:?}, {:?})",
          //         node_range,
          //         tokens,
          //         next_node_range,
          //         next_tokens,
          //     );
          // }

          // Process the replace ranges, starting from the highest start
          // position and working our way back. If have tokens like:
          //
          // `#[cfg(FALSE)] struct Foo { #[cfg(FALSE)] field: bool }`
          //
          // Then we will generate replace ranges for both
          // the `#[cfg(FALSE)] field: bool` and the entire
          // `#[cfg(FALSE)] struct Foo { #[cfg(FALSE)] field: bool }`
          //
          // By starting processing from the replace range with the greatest
          // start position, we ensure that any (outer) replace range which
          // encloses another (inner) replace range will fully overwrite the
          // inner range's replacement.
          for (let k = node_replacements_.length - 1; k >= 0; k--) {
            const [node_range, target] = node_replacements_[k]!;
            assert(
              !(node_range._0.start >= node_range._0.end),
              `Cannot replace an empty node range: ${node_range._0.start}..${node_range._0.end}`,
            );

            // Replace the tokens in range with zero or one `FlatToken::AttrsTarget`s,
            // plus enough `FlatToken::Empty`s to fill up the rest of the range. This
            // keeps the total length of `tokens` constant throughout the replacement
            // process, allowing us to do all replacements without adjusting indices.
            const target_len = target !== undefined ? 1 : 0;
            const replacement: FlatToken[] = [];
            if (target !== undefined) replacement.push({ $: "AttrsTarget", _0: target });
            const len = node_range._0.end - node_range._0.start;
            for (let i = 0; i < len - target_len; i++) replacement.push(gen.FlatToken.Empty);
            splice(tokens_, node_range._0.start, len, replacement);
          }
          return make_attr_token_stream(tokens_[globalThis.Symbol.iterator](), break_last_token);
        }
      }
    }
  },
};

/** `#[derive(Clone)]` for `TokenCursor` (the streams are `Arc`s, shared). */
function clone_TokenCursor(c: TokenCursor): TokenCursor {
  return new gen.TokenCursor(
    new gen.TokenTreeCursor(c.curr.stream, c.curr.next_idx),
    c.stack.map((t) => new gen.TokenTreeCursor(t.stream, t.next_idx)),
  );
}

/// Converts a flattened iterator of tokens (including open and close delimiter tokens) into an
/// `AttrTokenStream`, creating an `AttrTokenTree::Delimited` for each matching pair of open and
/// close delims.
// rustc: compiler/rustc_ast/src/tokenstream.rs:354 make_attr_token_stream
function make_attr_token_stream(iter: Iterator<FlatToken>, break_last_token: number): AttrTokenStream {
  interface FrameData {
    // This is `None` for the first frame, `Some` for all others.
    open_delim_sp: [Delimiter, Span, Spacing] | undefined;
    inner: AttrTokenTree[];
  }
  // The stack always has at least one element. Storing it separately makes for shorter code.
  let stack_top: FrameData = { open_delim_sp: undefined, inner: [] };
  const stack_rest: FrameData[] = [];
  for (let r = iter.next(); !r.done; r = iter.next()) {
    const flat_token = r.value;
    switch (flat_token.$) {
      case "Token": {
        const [token, spacing] = flat_token._0;
        const { kind, span } = token;
        let delim: Delimiter | undefined;
        if ((delim = TokenKind.open_delim(kind)) !== undefined) {
          stack_rest.push(stack_top);
          stack_top = { open_delim_sp: [delim, span, spacing], inner: [] };
        } else if ((delim = TokenKind.close_delim(kind)) !== undefined) {
          // If there's no matching opening delimiter, the token stream is malformed,
          // likely due to a improper delimiter positions in the source code.
          // It's not delimiter mismatch, and lexer can not detect it, so we just ignore it here.
          const frame = stack_rest.pop();
          if (frame === undefined) {
            return AttrTokenStream.new(stack_top.inner);
          }
          const frame_data = stack_top;
          stack_top = frame;
          const [open_delim, open_sp, open_spacing] = unwrap(frame_data.open_delim_sp);
          assert(
            DelimiterC.eq_ignoring_invisible_origin(open_delim, delim),
            `Mismatched open/close delims: open=${debug_Delimiter(open_delim, PLAIN)} close=${debug_Span(span, PLAIN)}`,
          );
          const dspan = DelimSpan.from_pair(open_sp, span);
          const dspacing = DelimSpacing.new(open_spacing, spacing);
          const stream = AttrTokenStream.new(frame_data.inner);
          const delimited: AttrTokenTree = { $: "Delimited", _0: dspan, _1: dspacing, _2: delim, _3: stream };
          stack_top.inner.push(delimited);
        } else {
          stack_top.inner.push({ $: "Token", _0: token, _1: spacing });
        }
        break;
      }
      case "AttrsTarget": {
        const target = flat_token._0;
        stack_top.inner.push({ $: "AttrsTarget", _0: target });
        break;
      }
      case "Empty":
        break;
    }
  }

  if (break_last_token > 0) {
    const last_token = unwrap(stack_top.inner.pop());
    if (last_token.$ === "Token") {
      const spacing = last_token._1;
      const last_token_ = last_token._0;
      const [unglued] = unwrap(TokenKind.break_two_token_op(last_token_.kind, break_last_token));

      // Tokens are always ASCII chars, so we can use byte arithmetic here.
      let first_span = Span.shrink_to_lo(last_token_.span);
      first_span = Span.with_hi(first_span, BytePos(Span.lo(first_span) + break_last_token));

      stack_top.inner.push({ $: "Token", _0: TokenC.new(unglued, first_span), _1: spacing });
    } else {
      panic(`Unexpected last token ${debug_AttrTokenTree(last_token, PLAIN)}`);
    }
  }
  return AttrTokenStream.new(stack_top.inner);
}


/// A shared empty attr token stream, used to avoid an unnecessary `Arc` allocation for every empty
/// token stream.
// PORT: `LazyLock<AttrTokenStream>` -> the shared (never mutated) empty array.
const EMPTY_ATTR_TOKEN_STREAM: readonly AttrTokenTree[] = [];

// PORT: statics of the generated `AttrTokenStream` class.
export const AttrTokenStream = gen.AttrTokenStream as typeof gen.AttrTokenStream & {
  "new": (tts: AttrTokenTree[]) => AttrTokenStream;
};
export type AttrTokenStream = gen.AttrTokenStream;

// rustc: compiler/rustc_ast/src/tokenstream.rs:439 new
AttrTokenStream.new = function (tts: AttrTokenTree[]): AttrTokenStream {
  if (tts.length === 0) {
    return new gen.AttrTokenStream(EMPTY_ATTR_TOKEN_STREAM as AttrTokenTree[]);
  } else {
    return new gen.AttrTokenStream(tts);
  }
};

/// Converts this `AttrTokenStream` to a plain `Vec<TokenTree>`. During
/// conversion, any `AttrTokenTree::AttrsTarget` gets "flattened" back to a
/// `TokenStream`, as described in the comment on
/// `attrs_and_tokens_to_token_trees`.
// rustc: compiler/rustc_ast/src/tokenstream.rs:451 to_token_trees
gen.AttrTokenStream.prototype.to_token_trees = function (this: AttrTokenStream): TokenTree[] {
  const res: TokenTree[] = [];
  for (const tree of this._0) {
    switch (tree.$) {
      case "Token": {
        const inner = tree._0;
        const spacing = tree._1;
        res.push({ $: "Token", _0: inner, _1: spacing });
        break;
      }
      case "Delimited": {
        const span = tree._0;
        const spacing = tree._1;
        const delim = tree._2;
        const stream = tree._3;
        res.push({ $: "Delimited", _0: span, _1: spacing, _2: delim, _3: TokenStream.new(stream.to_token_trees()) });
        break;
      }
      case "AttrsTarget": {
        const target = tree._0;
        attrs_and_tokens_to_token_trees(target.attrs, target.tokens, res);
        break;
      }
    }
  }
  return res;
};

/** `Attribute::token_trees` (attr/mod.rs, not ported yet). */
function attr_token_trees(_attr: Attribute): TokenTree[] {
  return unported("rustc_ast::attr::Attribute::token_trees");
}

// Converts multiple attributes and the tokens for a target AST node into token trees, and appends
// them to `res`.
//
// Example: if the AST node is "fn f() { blah(); }", then:
// - Simple if no attributes are present, e.g. "fn f() { blah(); }"
// - Simple if only outer attribute are present, e.g. "#[outer1] #[outer2] fn f() { blah(); }"
// - Trickier if inner attributes are present, because they must be moved within the AST node's
//   tokens, e.g. "#[outer] fn f() { #![inner] blah() }"
// rustc: compiler/rustc_ast/src/tokenstream.rs:483 attrs_and_tokens_to_token_trees
function attrs_and_tokens_to_token_trees(
  attrs: readonly Attribute[],
  target_tokens: LazyAttrTokenStream,
  res: TokenTree[],
): void {
  const idx = partition_point(attrs, (attr) => attr.style === "Outer");
  const outer_attrs = attrs.slice(0, idx);
  const inner_attrs = attrs.slice(idx);

  // Add outer attribute tokens.
  for (const attr of outer_attrs) {
    extend(res, attr_token_trees(attr));
  }

  // Add target AST node tokens.
  extend(res, target_tokens.to_attr_token_stream().to_token_trees());

  // Insert inner attribute tokens.
  if (inner_attrs.length !== 0) {
    const found = insert_inner_attrs(inner_attrs, res);
    assert(found, `Failed to find trailing delimited group in: ${debug_TokenTrees(res)}`);
  }

  // Inner attributes are only supported on blocks, functions, impls, and
  // modules. All of these have their inner attributes placed at the
  // beginning of the rightmost outermost braced group:
  // e.g. `fn foo() { #![my_attr] }`. (Note: the braces may be within
  // invisible delimiters.)
  //
  // Therefore, we can insert them back into the right location without
  // needing to do any extra position tracking.
  //
  // Note: Outline modules are an exception - they can have attributes like
  // `#![my_attr]` at the start of a file. Support for custom attributes in
  // this position is not properly implemented - we always synthesize fake
  // tokens, so we never reach this code.
  // rustc: compiler/rustc_ast/src/tokenstream.rs:518 insert_inner_attrs
  function insert_inner_attrs(inner_attrs: readonly Attribute[], tts: TokenTree[]): boolean {
    for (let k = tts.length - 1; k >= 0; k--) {
      const tree = tts[k]!;
      if (tree.$ === "Delimited" && tree._2.$ === "Brace") {
        const span = tree._0;
        const spacing = tree._1;
        const stream = tree._3;
        // Found it: the rightmost, outermost braced group.
        const tts_: TokenTree[] = [];
        for (const inner_attr of inner_attrs) {
          extend(tts_, attr_token_trees(inner_attr));
        }
        extend(tts_, stream._0);
        const stream_ = TokenStream.new(tts_);
        tts[k] = { $: "Delimited", _0: span, _1: spacing, _2: DelimiterC.Brace, _3: stream_ };
        return true;
      } else if (tree.$ === "Delimited" && tree._2.$ === "Invisible") {
        const span = tree._0;
        const spacing = tree._1;
        const src = tree._2._0;
        const stream = tree._3;
        // Recurse inside invisible delimiters.
        const vec: TokenTree[] = [...stream._0];
        if (insert_inner_attrs(inner_attrs, vec)) {
          tts[k] = { $: "Delimited", _0: span, _1: spacing, _2: { $: "Invisible", _0: src }, _3: TokenStream.new(vec) };
          return true;
        }
      }
    }
    return false;
  }
}

/** `<Vec<TokenTree> as Debug>::fmt` */
function debug_TokenTrees(v: readonly TokenTree[]): string {
  return `[${v.map((t) => gen.debug_TokenTree(t, PLAIN)).join(", ")}]`;
}

/// A shared empty token stream, used to avoid an unnecessary `Arc` allocation for every empty
/// token stream.
// PORT: `LazyLock<TokenStream>` -> the shared (never mutated) empty array.
const EMPTY_TOKEN_STREAM: readonly TokenTree[] = [];

/** `Arc::make_mut(&mut ts.0)` (see the PORT block at the top). */
function make_mut(ts: TokenStream): TokenTree[] {
  ts._0 = ts._0.slice();
  return ts._0;
}

/// `HasTokens` + `HasAttrs` + `Debug` for `TokenStream::from_ast`.
// PORT: the traits are not ported yet (ast_traits.rs); generic code takes the function table.
export interface FromAstNode<N> {
  tokens(node: N): LazyAttrTokenStream | undefined;
  attrs(node: N): readonly Attribute[];
  debug: Debug<N>;
}

// PORT: statics of the generated `TokenStream` class.
export const TokenStream = gen.TokenStream as typeof gen.TokenStream & {
  "new": (tts: TokenTree[]) => TokenStream;
  token_alone: (kind: TokenKind, span: Span) => TokenStream;
  from_ast: <N>(node: N, impls: FromAstNode<N>) => TokenStream;
  try_glue_to_last: (vec: TokenTree[], tt: TokenTree) => boolean;
  "default": () => TokenStream;
  from_iter: (iter: Iterable<TokenTree>) => TokenStream;
};
export type TokenStream = gen.TokenStream;

// rustc: compiler/rustc_ast/src/tokenstream.rs:642 new
TokenStream.new = function (tts: TokenTree[]): TokenStream {
  if (tts.length === 0) {
    return TokenStream.default();
  } else {
    return new gen.TokenStream(tts);
  }
};

// rustc: compiler/rustc_ast/src/tokenstream.rs:646 is_empty
gen.TokenStream.prototype.is_empty = function (this: TokenStream): boolean {
  return this._0.length === 0;
};

// rustc: compiler/rustc_ast/src/tokenstream.rs:650 len
gen.TokenStream.prototype.len = function (this: TokenStream): number {
  return this._0.length;
};

// rustc: compiler/rustc_ast/src/tokenstream.rs:654 get
gen.TokenStream.prototype.get = function (this: TokenStream, index: number): TokenTree | undefined {
  return this._0[index];
};

// rustc: compiler/rustc_ast/src/tokenstream.rs:658 iter
gen.TokenStream.prototype.iter = function (this: TokenStream): TokenStreamIter {
  return TokenStreamIter.new(this);
};

/// Create a token stream containing a single token with alone spacing. The
/// spacing used for the final token in a constructed stream doesn't matter
/// because it's never used. In practice we arbitrarily use
/// `Spacing::Alone`.
// rustc: compiler/rustc_ast/src/tokenstream.rs:666 token_alone
TokenStream.token_alone = function (kind: TokenKind, span: Span): TokenStream {
  return TokenStream.new([TokenTree.token_alone(kind, span)]);
};

// rustc: compiler/rustc_ast/src/tokenstream.rs:670 from_ast
TokenStream.from_ast = function <N>(node: N, impls: FromAstNode<N>): TokenStream {
  const tokens = impls.tokens(node);
  if (tokens === undefined) panic(`missing tokens for node: ${impls.debug(node, PLAIN)}`);
  const tts: TokenTree[] = [];
  attrs_and_tokens_to_token_trees(impls.attrs(node), tokens, tts);
  return TokenStream.new(tts);
};

// If `vec` is not empty, try to glue `tt` onto its last token. The return
// value indicates if gluing took place.
// rustc: compiler/rustc_ast/src/tokenstream.rs:679 try_glue_to_last
TokenStream.try_glue_to_last = function (vec: TokenTree[], tt: TokenTree): boolean {
  const last = vec[vec.length - 1];
  let glued_tok: Token | undefined;
  if (
    last !== undefined &&
    last.$ === "Token" &&
    (last._1 === "Joint" || last._1 === "JointHidden") &&
    tt.$ === "Token" &&
    (glued_tok = last._0.glue(tt._0)) !== undefined
  ) {
    const spacing = tt._1;
    // ...then overwrite the last token tree in `vec` with the glued token.
    vec[vec.length - 1] = { $: "Token", _0: glued_tok, _1: spacing };
    return true;
  } else {
    return false;
  }
};

/// Push `tt` onto the end of the stream, possibly gluing it to the last
/// token. Uses `make_mut` to maximize efficiency.
///
/// This is intended for specific proc macro use. For general `TokenStream`
/// construction within the compiler just build a `Vec<TokenTree>` with
/// normal `Vec` operations and then do `TokenStream::new`.
// rustc: compiler/rustc_ast/src/tokenstream.rs:698 push_tree_with_gluing
gen.TokenStream.prototype.push_tree_with_gluing = function (this: TokenStream, tt: TokenTree): void {
  const vec_mut = make_mut(this);

  if (TokenStream.try_glue_to_last(vec_mut, tt)) {
    // nothing else to do
  } else {
    vec_mut.push(tt);
  }
};

/// Push `stream` onto the end of the stream, possibly gluing the first
/// token tree to the last token. (No other token trees will be glued.)
/// Uses `make_mut` to maximize efficiency.
///
/// This is intended for specific proc macro use. For general `TokenStream`
/// construction within the compiler just build a `Vec<TokenTree>` with
/// normal `Vec` operations and then do `TokenStream::new`.
// rustc: compiler/rustc_ast/src/tokenstream.rs:715 push_stream_with_gluing
gen.TokenStream.prototype.push_stream_with_gluing = function (this: TokenStream, stream: TokenStream): void {
  const vec_mut = make_mut(this);

  const stream_iter = stream._0;

  const first = stream._0[0];
  if (first !== undefined && TokenStream.try_glue_to_last(vec_mut, first)) {
    // Now skip the first token tree from `stream`.
    for (let i = 1; i < stream_iter.length; i++) vec_mut.push(stream_iter[i]!);
  } else {
    // Append all of `stream`.
    for (let i = 0; i < stream_iter.length; i++) vec_mut.push(stream_iter[i]!);
  }
};

/// Desugar doc comments like `/// foo` in the stream into `#[doc =
/// r"foo"]`. Modifies the `TokenStream` via `Arc::make_mut`, but as little
/// as possible.
// rustc: compiler/rustc_ast/src/tokenstream.rs:734 desugar_doc_comments
gen.TokenStream.prototype.desugar_doc_comments = function (this: TokenStream): void {
  const desugared_stream = desugar_inner(new gen.TokenStream(this._0));
  if (desugared_stream !== undefined) {
    this._0 = desugared_stream._0;
  }

  // The return value is `None` if nothing in `stream` changed.
  // rustc: compiler/rustc_ast/src/tokenstream.rs:740 desugar_inner
  function desugar_inner(stream: TokenStream): TokenStream | undefined {
    let i = 0;
    let modified = false;
    let tt: TokenTree | undefined;
    while ((tt = stream._0[i]) !== undefined) {
      if (tt.$ === "Token" && tt._0.kind.$ === "DocComment") {
        const attr_style = tt._0.kind._1;
        const data = tt._0.kind._2;
        const span = tt._0.span;
        const desugared = desugared_tts(attr_style, data, span);
        const desugared_len = desugared.length;
        // PORT: `Arc::make_mut`: the first call copies the shared array, later calls find it unique.
        splice(modified ? stream._0 : make_mut(stream), i, 1, desugared);
        modified = true;
        i += desugared_len;
      } else if (tt.$ === "Token") {
        i += 1;
      } else {
        const sp = tt._0;
        const spacing = tt._1;
        const delim = tt._2;
        const delim_stream = tt._3;
        const desugared_delim_stream = desugar_inner(new gen.TokenStream(delim_stream._0));
        if (desugared_delim_stream !== undefined) {
          const new_tt: TokenTree = { $: "Delimited", _0: sp, _1: spacing, _2: delim, _3: desugared_delim_stream };
          (modified ? stream._0 : make_mut(stream))[i] = new_tt;
          modified = true;
        }
        i += 1;
      }
    }
    if (modified) {
      return stream;
    } else {
      return undefined;
    }
  }

  // rustc: compiler/rustc_ast/src/tokenstream.rs:772 desugared_tts
  function desugared_tts(attr_style: Attribute["style"], data: Symbol, span: Span): TokenTree[] {
    // Searches for the occurrences of `"#*` and returns the minimum number of `#`s
    // required to wrap the text. E.g.
    // - `abc d` is wrapped as `r"abc d"` (num_of_hashes = 0)
    // - `abc "d"` is wrapped as `r#"abc "d""#` (num_of_hashes = 1)
    // - `abc "##d##"` is wrapped as `r###"abc ##"d"##"###` (num_of_hashes = 3)
    let num_of_hashes = 0;
    let count = 0;
    for (const ch of Symbol.as_str(data)) {
      if (ch === '"') {
        count = 1;
      } else if (ch === "#" && count > 0) {
        // PORT: `count`/`num_of_hashes` are `u8` (inferred from `StrRaw(u8)`); `u8`
        // arithmetic wraps because rustc ships without overflow checks.
        count = (count + 1) & 0xff;
      } else {
        count = 0;
      }
      num_of_hashes = Math.max(num_of_hashes, count);
    }

    // `/// foo` becomes `[doc = r"foo"]`.
    const delim_span = DelimSpan.from_single(span);
    const body: TokenTree = {
      $: "Delimited",
      _0: delim_span,
      _1: DelimSpacing.new(Spacing.JointHidden, Spacing.Alone),
      _2: DelimiterC.Bracket,
      _3: TokenStream.from_iter([
        TokenTree.token_alone({ $: "Ident", _0: sym.doc, _1: "Normal" }, span),
        TokenTree.token_alone(TokenKind.Eq, span),
        TokenTree.token_alone(TokenKind.lit({ $: "StrRaw", _0: num_of_hashes }, data, undefined), span),
      ]),
    };

    if (attr_style === "Inner") {
      return [TokenTree.token_joint(TokenKind.Pound, span), TokenTree.token_joint_hidden(TokenKind.Bang, span), body];
    } else {
      return [TokenTree.token_joint_hidden(TokenKind.Pound, span), body];
    }
  }
};

/// Given a `TokenStream` with a `Stream` of only two arguments, return a new `TokenStream`
/// separating the two arguments with a comma for diagnostic suggestions.
// rustc: compiler/rustc_ast/src/tokenstream.rs:821 add_comma
gen.TokenStream.prototype.add_comma = function (this: TokenStream): [TokenStream, Span] | undefined {
  // Used to suggest if a user writes `foo!(a b);`
  let suggestion: [number, TokenTree, Span] | undefined = undefined;
  const v = this._0;
  for (let pos = 0; pos < v.length; pos++) {
    const ts = v[pos]!;
    const next = v[pos + 1];
    if (next !== undefined) {
      let sp: Span;
      if (next.$ === "Token" && next._0.kind.$ === "Comma") {
        continue;
      } else if (
        ts.$ === "Token" &&
        ts._1 === "Alone" &&
        next.$ === "Token" &&
        (ts._0.is_non_reserved_ident() || ts._0.is_lit()) &&
        (next._0.is_non_reserved_ident() || next._0.is_lit())
      ) {
        sp = ts._0.span;
      } else if (ts.$ === "Delimited") {
        sp = ts._0.entire();
      } else {
        continue;
      }
      sp = Span.shrink_to_hi(sp);
      const comma = TokenTree.token_alone(TokenKind.Comma, sp);
      suggestion = [pos, comma, sp];
    }
  }
  if (suggestion !== undefined) {
    const [pos, comma, sp] = suggestion;
    const new_stream: TokenTree[] = [];
    extend(new_stream, v.slice(0, pos + 1));
    new_stream.push(comma);
    extend(new_stream, v.slice(pos + 1));
    return [TokenStream.new(new_stream), sp];
  }
  return undefined;
};

// impl Default for TokenStream
// rustc: compiler/rustc_ast/src/tokenstream.rs:858 default
TokenStream.default = function (): TokenStream {
  return new gen.TokenStream(EMPTY_TOKEN_STREAM as TokenTree[]);
};

// impl FromIterator<TokenTree> for TokenStream
// rustc: compiler/rustc_ast/src/tokenstream.rs:864 from_iter
TokenStream.from_iter = function (iter: Iterable<TokenTree>): TokenStream {
  return TokenStream.new([...iter]);
};

// rustc-skip: compiler/rustc_ast/src/tokenstream.rs:870 stable_hash StableHash (incremental, out of scope until M5)

// PORT: `TokenStreamIter<'t>(std::slice::Iter<'t, TokenTree>)`: the slice and a position.
export class TokenStreamIter {
  constructor(
    public _0: readonly TokenTree[],
    public pos: number,
  ) {}

  // rustc: compiler/rustc_ast/src/tokenstream.rs:879 new
  static new(stream: TokenStream): TokenStreamIter {
    return new TokenStreamIter(stream._0, 0);
  }

  // Peeking could be done via `Peekable`, but most iterators need peeking,
  // and this is simple and avoids the need to use `peekable` and `Peekable`
  // at all the use sites.
  // rustc: compiler/rustc_ast/src/tokenstream.rs:886 peek
  peek(): TokenTree | undefined {
    return this._0[this.pos];
  }

  // impl Iterator for TokenStreamIter
  // rustc: compiler/rustc_ast/src/tokenstream.rs:894 next
  next(): TokenTree | undefined {
    if (this.pos < this._0.length) return this._0[this.pos++];
    return undefined;
  }

  // rustc: compiler/rustc_ast/src/tokenstream.rs:898 size_hint
  size_hint(): [number, number | undefined] {
    const n = this._0.length - this.pos;
    return [n, n];
  }

  /** `#[derive(Clone)]` */
  clone(): TokenStreamIter {
    return new TokenStreamIter(this._0, this.pos);
  }
}

// PORT: statics of the generated `TokenTreeCursor` class.
export const TokenTreeCursor = gen.TokenTreeCursor as typeof gen.TokenTreeCursor & {
  "new": (stream: TokenStream) => TokenTreeCursor;
};
export type TokenTreeCursor = gen.TokenTreeCursor;

// rustc: compiler/rustc_ast/src/tokenstream.rs:912 new
TokenTreeCursor.new = function (stream: TokenStream): TokenTreeCursor {
  return new gen.TokenTreeCursor(stream, 0);
};

/// Gets the current token tree within this cursor. In a debug build it panics on a cursor that
/// hasn't been bumped; in a release build it will return `None`.
// rustc: compiler/rustc_ast/src/tokenstream.rs:919 curr
gen.TokenTreeCursor.prototype.curr = function (this: TokenTreeCursor): TokenTree | undefined {
  // debug_assert!(self.next_idx > 0);
  return this.stream.get(this.next_idx - 1);
};

/// Gets the next token tree without advancing.
// rustc: compiler/rustc_ast/src/tokenstream.rs:926 next
gen.TokenTreeCursor.prototype.next = function (this: TokenTreeCursor): TokenTree | undefined {
  return this.stream.get(this.next_idx);
};

/// Gets the token tree `n` ahead. `look_ahead(1)` is equivalent to `next()`. `look_ahead(0)`
/// isn't allowed and will panic.
// rustc: compiler/rustc_ast/src/tokenstream.rs:933 look_ahead
gen.TokenTreeCursor.prototype.look_ahead = function (this: TokenTreeCursor, n: number): TokenTree | undefined {
  assert(n !== 0, `assertion \`left != right\` failed\n  left: ${n}\n right: 0`);
  return this.stream.get(this.next_idx + (n - 1));
};

/// Move the cursor to the next token tree.
// rustc: compiler/rustc_ast/src/tokenstream.rs:940 bump
gen.TokenTreeCursor.prototype.bump = function (this: TokenTreeCursor): void {
  this.next_idx += 1;
};

/// For skipping ahead in rare circumstances.
// rustc: compiler/rustc_ast/src/tokenstream.rs:946 bump_to_end
gen.TokenTreeCursor.prototype.bump_to_end = function (this: TokenTreeCursor): void {
  this.next_idx = this.stream.len();
};

/// A `TokenStream` cursor that produces `Token`s. It's a bit odd that
/// we (a) lex tokens into a nice tree structure (`TokenStream`), and then (b)
/// use this type to emit them as a linear sequence. But a linear sequence is
/// what the parser expects, for the most part.
// PORT: statics of the generated `TokenCursor` class.
export const TokenCursor = gen.TokenCursor as typeof gen.TokenCursor & {
  "new": (stream: TokenStream) => TokenCursor;
};
export type TokenCursor = gen.TokenCursor;

// rustc: compiler/rustc_ast/src/tokenstream.rs:972 new
TokenCursor.new = function (stream: TokenStream): TokenCursor {
  return new gen.TokenCursor(TokenTreeCursor.new(stream), []);
};

/// Gets the next token and advances the cursor by one.
// rustc: compiler/rustc_ast/src/tokenstream.rs:977 next_and_bump
gen.TokenCursor.prototype.next_and_bump = function (this: TokenCursor): [Token, Spacing] {
  return this.inlined_next_and_bump();
};

/// An `n` of 1 is the next token tree in the current token stream; won't look outside the
/// current token stream. `look_ahead(0)` isn't allowed and will panic.
// rustc: compiler/rustc_ast/src/tokenstream.rs:984 look_ahead
gen.TokenCursor.prototype.look_ahead = function (this: TokenCursor, n: number): TokenTree | undefined {
  return this.curr.look_ahead(n);
};

/// Returns the first token tree (if there is one) past the close delimiter of the enclosing
/// delimited sequence. Panics if we are not within a delimited sequence.
// rustc: compiler/rustc_ast/src/tokenstream.rs:991 look_ahead_past_close_delim
gen.TokenCursor.prototype.look_ahead_past_close_delim = function (this: TokenCursor): TokenTree | undefined {
  return unwrap(this.stack[this.stack.length - 1]).next();
};

/// Clones the `TokenTree::Delimited` that we are currently within. Panics if we are not within
/// a delimited sequence.
// rustc: compiler/rustc_ast/src/tokenstream.rs:998 clone_enclosing_delim
gen.TokenCursor.prototype.clone_enclosing_delim = function (this: TokenCursor): TokenTree {
  return unwrap(unwrap(this.stack[this.stack.length - 1]).curr());
};

/// For skipping to the end of the current sequence, in rare circumstances.
// rustc: compiler/rustc_ast/src/tokenstream.rs:1004 bump_to_end
gen.TokenCursor.prototype.bump_to_end = function (this: TokenCursor): void {
  this.curr.bump_to_end();
};

/// Note: the outermost stream has depth of 0.
// rustc: compiler/rustc_ast/src/tokenstream.rs:1010 depth
gen.TokenCursor.prototype.depth = function (this: TokenCursor): number {
  return this.stack.length;
};

/// Returns details about the parent delimited sequence, if there is one.
// rustc: compiler/rustc_ast/src/tokenstream.rs:1016 parent_delim_and_span
gen.TokenCursor.prototype.parent_delim_and_span = function (this: TokenCursor): [Delimiter, DelimSpan] | undefined {
  const last = this.stack[this.stack.length - 1];
  let c: TokenTree | undefined;
  if (last !== undefined && (c = last.curr()) !== undefined && c.$ === "Delimited") {
    const span = c._0;
    const delim = c._2;
    return [delim, span];
  } else {
    return undefined;
  }
};

/// This always-inlined version should only be used on hot code paths.
// rustc: compiler/rustc_ast/src/tokenstream.rs:1028 inlined_next_and_bump
gen.TokenCursor.prototype.inlined_next_and_bump = function (this: TokenCursor): [Token, Spacing] {
  for (;;) {
    // FIXME: we currently don't return `Delimiter::Invisible` open/close delims. To fix
    // #67062 we will need to, whereupon the `delim != Delimiter::Invisible` conditions
    // below can be removed.
    const tree = this.curr.next();
    let parent: TokenTreeCursor | undefined;
    if (tree !== undefined) {
      switch (tree.$) {
        case "Token": {
          // PORT: `&TokenTree::Token(token, spacing)` copies the `Copy` token.
          const token = TokenC.new(tree._0.kind, tree._0.span);
          const spacing = tree._1;
          // debug_assert!(!token.kind.is_delim());
          const res: [Token, Spacing] = [token, spacing];
          this.curr.bump();
          return res;
        }
        case "Delimited": {
          const sp = tree._0;
          const spacing = tree._1;
          const delim = tree._2;
          const tts = tree._3;
          const trees = TokenTreeCursor.new(tts);
          this.curr.bump(); // move past the `Delimited`
          this.stack.push(this.curr);
          this.curr = trees;
          if (!DelimiterC.skip(delim)) {
            return [TokenC.new(DelimiterC.as_open_token_kind(delim), sp.open), spacing.open];
          }
          // No open delimiter to return; continue on to the next iteration.
          break;
        }
      }
    } else if ((parent = this.stack.pop()) !== undefined) {
      // We have exhausted this token stream. Move back to its parent token stream.
      const c = parent.curr();
      if (c === undefined || c.$ !== "Delimited") {
        panic("parent should be Delimited");
      }
      const span = c._0;
      const spacing = c._1;
      const delim = c._2;
      this.curr = parent;
      if (!DelimiterC.skip(delim)) {
        return [TokenC.new(DelimiterC.as_close_token_kind(delim), span.close), spacing.close];
      }
      // No close delimiter to return; continue on to the next iteration.
    } else {
      // We have exhausted the outermost token stream. The use of
      // `Spacing::Alone` is arbitrary and immaterial, because the
      // `Eof` token's spacing is never used.
      return [TokenC.new(TokenKind.Eof, DUMMY_SP), Spacing.Alone];
    }
  }
};

// PORT: statics of the generated `DelimSpan` class.
export const DelimSpan = gen.DelimSpan as typeof gen.DelimSpan & {
  from_single: (sp: Span) => DelimSpan;
  from_pair: (open: Span, close: Span) => DelimSpan;
  dummy: () => DelimSpan;
};
export type DelimSpan = gen.DelimSpan;

// rustc: compiler/rustc_ast/src/tokenstream.rs:1079 from_single
DelimSpan.from_single = function (sp: Span): DelimSpan {
  return new gen.DelimSpan(sp, sp);
};

// rustc: compiler/rustc_ast/src/tokenstream.rs:1083 from_pair
DelimSpan.from_pair = function (open: Span, close: Span): DelimSpan {
  return new gen.DelimSpan(open, close);
};

// rustc: compiler/rustc_ast/src/tokenstream.rs:1087 dummy
DelimSpan.dummy = function (): DelimSpan {
  return DelimSpan.from_single(DUMMY_SP);
};

// rustc: compiler/rustc_ast/src/tokenstream.rs:1091 entire
gen.DelimSpan.prototype.entire = function (this: DelimSpan): Span {
  return Span.with_hi(this.open, Span.hi(this.close));
};

// PORT: statics of the generated `DelimSpacing` class.
export const DelimSpacing = gen.DelimSpacing as typeof gen.DelimSpacing & {
  "new": (open: Spacing, close: Spacing) => DelimSpacing;
};
export type DelimSpacing = gen.DelimSpacing;

// rustc: compiler/rustc_ast/src/tokenstream.rs:1103 new
DelimSpacing.new = function (open: Spacing, close: Spacing): DelimSpacing {
  return new gen.DelimSpacing(open, close);
};

// Some types are used a lot. Make sure they don't unintentionally get bigger.
// PORT: `mod size_asserts` (static_assert_size!) has no TS counterpart.

