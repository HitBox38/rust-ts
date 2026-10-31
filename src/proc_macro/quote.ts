// Port of library/proc_macro/src/quote.rs.
//
//! # Quasiquoter
//! This file contains the implementation internals of the quasiquoter provided by `quote!`.

//! This quasiquoter uses macros 2.0 hygiene to reliably access
//! items from `proc_macro`, to build a `proc_macro::TokenStream`.
//
// PORT: library crate, `// std:` markers (decision 2026-10-13).
// - `minimal_quote!` / `minimal_quote_ts!` / `minimal_quote_tt!` are `macro_rules!`: here `minimal_quote` is a
//   tagged template whose text is the macro input verbatim, read with the macros' own token rules
//   (`MqTok` below) and expanded arm by arm in the same order. `(@ expr)` is `(@ ${() => expr})`: a thunk, so each
//   unquoted expression runs at its place in the expansion, between the tokens around it, as in the macro
//   expansion (RPCs such as `span_save_span` and `literal_from_str` keep their order).
// - `ToTokens::to_tokens(&minimal_quote_ts!($t), &mut ts)` dispatches statically in Rust; here on the value's
//   representation (`to_tokens_dyn`): only `TokenStream`, `TokenTree` and `Ident` (`&Ident` = the `&T` impl)
//   reach it.
// - The `ext` traits, `HasIterator` / `ThereIsNoIteratorInRepetition` and `RepInterp` are what *the code
//   `quote!` generates* uses at the proc macro's run time; rustc never calls them. They are ported as function
//   tables for coverage and for a TS proc macro that would.

import { panic } from "../std/panic.ts";
import { unwrap_result } from "../std/result.ts";
import {
  debug_LexError,
  type Delimiter,
  Group,
  Ident,
  Literal,
  Punct,
  Span,
  TokenStream,
  TokenTree,
  type IntoIter,
} from "./lib.ts";
import {
  type ToTokens,
  ToTokens_for_Ident,
  ToTokens_for_TokenStream,
  ToTokens_for_TokenTree,
  ToTokens_provided,
} from "./to_tokens.ts";

// std-type: library/proc_macro/src/quote.rs:12 HasIterator
export class HasIterator {
  static readonly INSTANCE: HasIterator = new HasIterator(); // True
  private readonly __has_iterator = true;
}
// std-type: library/proc_macro/src/quote.rs:14 ThereIsNoIteratorInRepetition
export class ThereIsNoIteratorInRepetition {
  static readonly INSTANCE: ThereIsNoIteratorInRepetition = new ThereIsNoIteratorInRepetition(); // False
  private readonly __no_iterator = true;
}

/** `impl BitOr<ThereIsNoIteratorInRepetition> for ThereIsNoIteratorInRepetition` */
export const BitOr_ThereIsNoIteratorInRepetition_for_ThereIsNoIteratorInRepetition = {
  // std: library/proc_macro/src/quote.rs:18 bitor
  bitor(_self: ThereIsNoIteratorInRepetition, _rhs: ThereIsNoIteratorInRepetition): ThereIsNoIteratorInRepetition {
    return ThereIsNoIteratorInRepetition.INSTANCE;
  },
};

/** `impl BitOr<ThereIsNoIteratorInRepetition> for HasIterator` */
export const BitOr_ThereIsNoIteratorInRepetition_for_HasIterator = {
  // std: library/proc_macro/src/quote.rs:25 bitor
  bitor(_self: HasIterator, _rhs: ThereIsNoIteratorInRepetition): HasIterator {
    return HasIterator.INSTANCE;
  },
};

/** `impl BitOr<HasIterator> for ThereIsNoIteratorInRepetition` */
export const BitOr_HasIterator_for_ThereIsNoIteratorInRepetition = {
  // std: library/proc_macro/src/quote.rs:32 bitor
  bitor(_self: ThereIsNoIteratorInRepetition, _rhs: HasIterator): HasIterator {
    return HasIterator.INSTANCE;
  },
};

/** `impl BitOr<HasIterator> for HasIterator` */
export const BitOr_HasIterator_for_HasIterator = {
  // std: library/proc_macro/src/quote.rs:39 bitor
  bitor(_self: HasIterator, _rhs: HasIterator): HasIterator {
    return HasIterator.INSTANCE;
  },
};

/** PORT: `Iterator` as the proc_macro ext traits need it (`next` only). */
export interface Iter<T> {
  next(): T | undefined;
}

/// Extension traits used by the implementation of `quote!`. These are defined
/// in separate traits, rather than as a single trait due to ambiguity issues.
///
/// These traits expose a `quote_into_iter` method which should allow calling
/// whichever impl happens to be applicable. Calling that method repeatedly on
/// the returned value should be idempotent.
// pub mod ext {
export const ext = {
  /// Extension trait providing the `quote_into_iter` method on iterators.
  // std-type: library/proc_macro/src/quote.rs:62 RepIteratorExt
  // impl<T: Iterator> RepIteratorExt for T {}
  RepIteratorExt_provided: {
    // std: library/proc_macro/src/quote.rs:63 quote_into_iter
    quote_into_iter<I extends Iter<unknown>>(self: I): [I, HasIterator] {
      return [self, HasIterator.INSTANCE];
    },
  },

  /// Extension trait providing the `quote_into_iter` method for
  /// non-iterable types. These types interpolate the same value in each
  /// iteration of the repetition.
  // std-type: library/proc_macro/src/quote.rs:74 RepToTokensExt
  // impl<T: ToTokens + ?Sized> RepToTokensExt for T {}
  RepToTokensExt_provided: {
    /// Pretend to be an iterator for the purposes of `quote_into_iter`.
    /// This allows repeated calls to `quote_into_iter` to continue
    /// correctly returning DoesNotHaveIter.
    // std: library/proc_macro/src/quote.rs:78 next
    next<T>(self: T): T | undefined {
      return self;
    },

    // std: library/proc_macro/src/quote.rs:82 quote_into_iter
    quote_into_iter<T>(self: T): [T, ThereIsNoIteratorInRepetition] {
      return [self, ThereIsNoIteratorInRepetition.INSTANCE];
    },
  },

  /// Extension trait providing the `quote_into_iter` method for types that
  /// can be referenced as an iterator.
  // std-type: library/proc_macro/src/quote.rs:92 RepAsIteratorExt
  // PORT: the trait is the `RepAsIteratorExt<Self, Item>` interface below; `type Iter` is `Iter<Item>`.

  /** `impl<'q, T: RepAsIteratorExt<'q> + ?Sized> RepAsIteratorExt<'q> for &T` */
  RepAsIteratorExt_for_ref<T, Item>(inner: RepAsIteratorExt<T, Item>): RepAsIteratorExt<T, Item> {
    return {
      // std: library/proc_macro/src/quote.rs:101 quote_into_iter
      quote_into_iter(self: T): [Iter<Item>, HasIterator] {
        return inner.quote_into_iter(self);
      },
    };
  },

  /** `impl<'q, T: RepAsIteratorExt<'q> + ?Sized> RepAsIteratorExt<'q> for &mut T` */
  RepAsIteratorExt_for_ref_mut<T, Item>(inner: RepAsIteratorExt<T, Item>): RepAsIteratorExt<T, Item> {
    return {
      // std: library/proc_macro/src/quote.rs:109 quote_into_iter
      quote_into_iter(self: T): [Iter<Item>, HasIterator] {
        return inner.quote_into_iter(self);
      },
    };
  },

  /** `impl<'q, T: 'q> RepAsIteratorExt<'q> for [T]` */
  RepAsIteratorExt_for_slice: {
    // std: library/proc_macro/src/quote.rs:117 quote_into_iter
    quote_into_iter<T>(self: readonly T[]): [Iter<T>, HasIterator] {
      return [slice_iter(self), HasIterator.INSTANCE];
    },
  },

  /** `impl<'q, T: 'q, const N: usize> RepAsIteratorExt<'q> for [T; N]` */
  RepAsIteratorExt_for_array: {
    // std: library/proc_macro/src/quote.rs:125 quote_into_iter
    quote_into_iter<T>(self: readonly T[]): [Iter<T>, HasIterator] {
      return [slice_iter(self), HasIterator.INSTANCE];
    },
  },

  /** `impl<'q, T: 'q> RepAsIteratorExt<'q> for Vec<T>` */
  RepAsIteratorExt_for_Vec: {
    // std: library/proc_macro/src/quote.rs:133 quote_into_iter
    quote_into_iter<T>(self: readonly T[]): [Iter<T>, HasIterator] {
      return [slice_iter(self), HasIterator.INSTANCE];
    },
  },

  /** `impl<'q, T: 'q> RepAsIteratorExt<'q> for BTreeSet<T>` */
  RepAsIteratorExt_for_BTreeSet: {
    // std: library/proc_macro/src/quote.rs:141 quote_into_iter
    // PORT: a `BTreeSet<T>` is held as the array of its elements in ascending order (its iteration order).
    quote_into_iter<T>(self: readonly T[]): [Iter<T>, HasIterator] {
      return [slice_iter(self), HasIterator.INSTANCE];
    },
  },

  /** `impl<'q, T: RepAsIteratorExt<'q>> RepAsIteratorExt<'q> for RepInterp<T>` */
  RepAsIteratorExt_for_RepInterp<T, Item>(inner: RepAsIteratorExt<T, Item>): RepAsIteratorExt<RepInterp<T>, Item> {
    return {
      // std: library/proc_macro/src/quote.rs:149 quote_into_iter
      quote_into_iter(self: RepInterp<T>): [Iter<Item>, HasIterator] {
        return inner.quote_into_iter(self._0);
      },
    };
  },
};
// }

/** `ext::RepAsIteratorExt<'q>` (quote.rs:92). */
export interface RepAsIteratorExt<Self, Item> {
  // std: library/proc_macro/src/quote.rs:95 quote_into_iter
  quote_into_iter(self: Self): [Iter<Item>, HasIterator];
}

/** `<[T]>::iter()` */
function slice_iter<T>(s: readonly T[]): Iter<T> {
  let i = 0;
  return { next: () => (i < s.length ? s[i++] : undefined) };
}

// Helper type used within interpolations to allow for repeated binding names.
// Implements the relevant traits, and exports a dummy `next()` method.
// std-type: library/proc_macro/src/quote.rs:159 RepInterp
export class RepInterp<T> {
  constructor(public _0: T) {}

  // This method is intended to look like `Iterator::next`, and is called when
  // a name is bound multiple times, as the previous binding will shadow the
  // original `Iterator` object. This allows us to avoid advancing the
  // iterator multiple times per iteration.
  // std: library/proc_macro/src/quote.rs:166 next
  next(): T | undefined {
    return this._0;
  }
}

/** `impl<T: Iterator> Iterator for RepInterp<T>` */
export const Iterator_for_RepInterp = {
  // std: library/proc_macro/src/quote.rs:174 next
  next<Item>(self: RepInterp<Iter<Item>>): Item | undefined {
    return self._0.next();
  },
};

/** `impl<T: ToTokens> ToTokens for RepInterp<T>` */
export function ToTokens_for_RepInterp<T>(inner: ToTokens<T>): ToTokens<RepInterp<T>> {
  const impl: ToTokens<RepInterp<T>> = {
    // std: library/proc_macro/src/quote.rs:180 to_tokens
    to_tokens(self: RepInterp<T>, tokens: TokenStream): void {
      inner.to_tokens(self._0, tokens);
    },
    to_token_stream: (self) => ToTokens_provided.to_token_stream(impl, self),
    into_token_stream: (self) => ToTokens_provided.into_token_stream(impl, self),
  };
  return impl;
}

// ---------------------------------------------------------------------------------------------------------------
// `minimal_quote!` (quote.rs:185-273)

/** A token of a `minimal_quote!` input, as `macro_rules!` matches it (`tt`s). */
type MqTok =
  | { readonly k: "ident"; readonly s: string }
  | { readonly k: "underscore" }
  | { readonly k: "lit"; readonly s: string }
  | { readonly k: "punct"; readonly ch: number }
  /** `::`, `=>`, `+=`, `!=`: single tokens in Rust, with their own `minimal_quote_ts!` arms. */
  | { readonly k: "op"; readonly s: "::" | "=>" | "+=" | "!=" }
  | { readonly k: "group"; readonly delim: Delimiter; readonly inner: readonly MqTok[] }
  /** `(@ $($t:tt)*)` with its expression. */
  | { readonly k: "at"; readonly i: number };

type MqValue = TokenStream | TokenTree | Ident;

/** PORT: the four two-character operators upstream's `minimal_quote!` inputs use (each has a `minimal_quote_ts!` arm). */
const MQ_OPS = ["::", "=>", "+=", "!="] as const;
/** Two-character Rust operators that would also be single tokens (none may appear: `minimal_quote_tt!` has no arm). */
const RUST_GLUED = ["&&", "||", "==", "<=", ">=", "->", "<-", "..", "<<", ">>", "-=", "*=", "/=", "%=", "^=", "&=", "|="];
const MQ_PUNCT = ",.;!<>&=#|:*";

const mq_cache = new WeakMap<TemplateStringsArray, readonly MqTok[]>();

/** Reads the token trees of a `minimal_quote!` input (`strings` around the `(@ ${..})` holes). */
function mq_parse(strings: TemplateStringsArray): readonly MqTok[] {
  const cached = mq_cache.get(strings);
  if (cached !== undefined) return cached;
  // Flat token list; `\0<i>` marks hole `i`.
  type Flat = MqTok | { readonly k: "open"; readonly c: string } | { readonly k: "close"; readonly c: string } | { readonly k: "@" } | { readonly k: "hole"; readonly i: number };
  const flat: Flat[] = [];
  for (let n = 0; n < strings.length; n++) {
    const s = strings.raw[n]!;
    let i = 0;
    while (i < s.length) {
      const c = s[i]!;
      if (/\s/.test(c)) {
        i++;
      } else if (/[A-Za-z_]/.test(c)) {
        let j = i + 1;
        while (j < s.length && /[A-Za-z0-9_]/.test(s[j]!)) j++;
        const w = s.slice(i, j);
        flat.push(w === "_" ? { k: "underscore" } : { k: "ident", s: w });
        i = j;
      } else if (/[0-9]/.test(c)) {
        let j = i + 1;
        while (j < s.length && /[A-Za-z0-9_]/.test(s[j]!)) j++;
        flat.push({ k: "lit", s: s.slice(i, j) });
        i = j;
      } else if ("([{".includes(c)) {
        flat.push({ k: "open", c });
        i++;
      } else if (")]}".includes(c)) {
        flat.push({ k: "close", c });
        i++;
      } else if (c === "@") {
        flat.push({ k: "@" });
        i++;
      } else {
        const two = s.slice(i, i + 2);
        const op = MQ_OPS.find((o) => o === two);
        if (op !== undefined) {
          flat.push({ k: "op", s: op });
          i += 2;
        } else if (RUST_GLUED.includes(two)) {
          panic(`minimal_quote!: no arm for \`${two}\``);
        } else if (MQ_PUNCT.includes(c)) {
          flat.push({ k: "punct", ch: c.charCodeAt(0) });
          i++;
        } else {
          panic(`minimal_quote!: no arm for \`${c}\``);
        }
      }
    }
    if (n + 1 < strings.length) flat.push({ k: "hole", i: n });
  }
  // Build the token trees.
  let pos = 0;
  const delim_of: Record<string, Delimiter> = { "(": "Parenthesis", "[": "Bracket", "{": "Brace" };
  const close_of: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  function trees(close: string | undefined): MqTok[] {
    const out: MqTok[] = [];
    while (pos < flat.length) {
      const t = flat[pos++]!;
      if (t.k === "close") {
        if (t.c !== close) panic("minimal_quote!: unbalanced delimiters");
        return out;
      }
      if (t.k === "open") {
        const inner_start = pos;
        // `(@ ${expr})`: the `minimal_quote_ts!` arm `((@ $($t:tt)*))`.
        if (t.c === "(" && flat[inner_start]?.k === "@") {
          const hole = flat[inner_start + 1];
          if (hole?.k !== "hole" || flat[inner_start + 2]?.k !== "close") panic("minimal_quote!: `(@ ..)` must hold one hole");
          pos = inner_start + 3;
          out.push({ k: "at", i: hole.i });
          continue;
        }
        const inner = trees(close_of[t.c]);
        out.push({ k: "group", delim: delim_of[t.c]!, inner });
        continue;
      }
      if (t.k === "@" || t.k === "hole") panic("minimal_quote!: `@` / a hole outside `(@ ..)`");
      out.push(t);
    }
    if (close !== undefined) panic("minimal_quote!: unclosed delimiter");
    return out;
  }
  const toks = trees(undefined);
  mq_cache.set(strings, toks);
  return toks;
}

/// Simpler version of the real `quote!` macro, implemented solely
/// through `macro_rules`, for bootstrapping the real implementation
/// (see the `quote` function), which does not have access to the
/// real `quote!` macro due to the `proc_macro` crate not being
/// able to depend on itself.
///
/// Note: supported tokens are a subset of the real `quote!`, but
/// unquoting is different: instead of `$x`, this uses `(@ expr)`.
function minimal_quote(strings: TemplateStringsArray, ...exprs: (() => MqValue)[]): TokenStream {
  return minimal_quote_toks(mq_parse(strings), exprs);
}

/** `minimal_quote!($($t:tt)*)` */
function minimal_quote_toks(toks: readonly MqTok[], exprs: readonly (() => MqValue)[]): TokenStream {
  // #[allow(unused_mut)] // In case the expansion is empty
  const ts = TokenStream.new();
  for (const t of toks) {
    to_tokens_dyn(minimal_quote_ts(t, exprs), ts);
  }
  return ts;
}

/** `ToTokens::to_tokens(&value, &mut ts)` for the value types `minimal_quote_ts!` produces. */
function to_tokens_dyn(v: MqValue, ts: TokenStream): void {
  if (v instanceof TokenStream) ToTokens_for_TokenStream.to_tokens(v, ts);
  else if (v instanceof Ident) ToTokens_for_Ident.to_tokens(v, ts);
  else ToTokens_for_TokenTree.to_tokens(v, ts);
}

/** `minimal_quote_ts!` (quote.rs:206) */
function minimal_quote_ts(t: MqTok, exprs: readonly (() => MqValue)[]): MqValue {
  if (t.k === "at") return exprs[t.i]!();
  if (t.k === "op") {
    const [a, b]: [number, number] =
      t.s === "::" ? [C_COLON, C_COLON] : t.s === "=>" ? [C_EQ, C_GT] : t.s === "+=" ? [C_PLUS, C_EQ] : [C_BANG, C_EQ];
    const c: [TokenTree, TokenTree] = [
      TokenTree.from_Punct(Punct.new(a, "Joint")),
      TokenTree.from_Punct(Punct.new(b, "Alone")),
    ];
    TokenTree.set_span(c[0], Span.def_site());
    TokenTree.set_span(c[1], Span.def_site());
    return TokenStream.from_iter_TokenTree([c[0], c[1]]);
  }
  return TokenTree.from(minimal_quote_tt(t, exprs));
}

/** `minimal_quote_tt!` (quote.rs:185) */
function minimal_quote_tt(t: MqTok, exprs: readonly (() => MqValue)[]): Group | Punct | Ident | Literal {
  switch (t.k) {
    case "group":
      return Group.new(t.delim, minimal_quote_toks(t.inner, exprs));
    case "punct":
      return Punct.new(t.ch, "Alone");
    case "underscore":
      return Ident.new("_", Span.def_site());
    case "ident":
      return Ident.new(t.s, Span.def_site());
    case "lit":
      return unwrap_result(Literal.from_str(t.s), debug_LexError);
    case "op":
    case "at":
      return panic("minimal_quote_tt!: unreachable");
  }
}

const C_DOLLAR = 0x24;
const C_STAR = 0x2a;
const C_COLON = 0x3a;
const C_EQ = 0x3d;
const C_GT = 0x3e;
const C_PLUS = 0x2b;
const C_BANG = 0x21;

/** PORT: `std::iter::Peekable<IntoIter>` (`next` / `peek`). */
class Peekable {
  private peeked: { v: TokenTree | undefined } | undefined = undefined;
  constructor(private readonly iter: IntoIter) {}

  next(): TokenTree | undefined {
    const p = this.peeked;
    if (p !== undefined) {
      this.peeked = undefined;
      return p.v;
    }
    return this.iter.next();
  }

  peek(): TokenTree | undefined {
    if (this.peeked === undefined) this.peeked = { v: this.iter.next() };
    return this.peeked.v;
  }
}

/// Quote a `TokenStream` into a `TokenStream`.
/// This is the actual implementation of the `quote!()` proc macro.
///
/// It is loaded by the compiler in `register_builtin_macros`.
// std: library/proc_macro/src/quote.rs:279 quote
export function quote(stream: TokenStream): TokenStream {
  if (stream.is_empty()) {
    return minimal_quote`crate::TokenStream::new()`;
  }
  const proc_macro_crate = minimal_quote`crate`;
  let after_dollar = false;

  const tokens = TokenStream.new();
  const iter = new Peekable(stream.into_iter());
  for (let tree = iter.next(); tree !== undefined; tree = iter.next()) {
    if (after_dollar) {
      after_dollar = false;
      if (tree.$ === "Group") {
        const tt = tree._0;
        // Handles repetition by expanding `$( CONTENTS ) SEP_OPT *` to `{ REP_EXPANDED }`.
        const contents = tt.stream();

        // The `*` token is also consumed here.
        let sep_opt: Punct | undefined;
        {
          const a = iter.next();
          const b = iter.peek();
          if (
            a?.$ === "Punct" &&
            b?.$ === "Punct" &&
            a._0.spacing() === "Joint" &&
            b._0.as_char() === C_STAR
          ) {
            iter.next();
            sep_opt = a._0;
          } else if (a?.$ === "Punct" && a._0.as_char() === C_STAR) {
            sep_opt = undefined;
          } else {
            panic("`$(...)` must be followed by `*` in `quote!`");
          }
        }

        const rep_expanded = TokenStream.new();

        // Append setup code for a `while`, where recursively quoted `CONTENTS`
        // and `SEP_OPT` are repeatedly processed, to `REP_EXPANDED`.
        const meta_vars = collect_meta_vars(contents.clone());
        ToTokens_for_TokenStream.to_tokens(
          minimal_quote`
            use crate::ext::*;
            (@ ${() =>
              sep_opt !== undefined ? minimal_quote`let mut _i = 0usize;` : minimal_quote`();`})
            let has_iter = crate::ThereIsNoIteratorInRepetition;
          `,
          rep_expanded,
        );
        for (const meta_var of meta_vars) {
          ToTokens_for_TokenStream.to_tokens(
            minimal_quote`
              #[allow(unused_mut)]
              let (mut (@ ${() => meta_var}), i) = (@ ${() => meta_var}).quote_into_iter();
              let has_iter = has_iter | i;
            `,
            rep_expanded,
          );
        }
        ToTokens_for_TokenStream.to_tokens(minimal_quote`let _: crate::HasIterator = has_iter;`, rep_expanded);

        // Append the `while` to `REP_EXPANDED`.
        const while_body = TokenStream.new();
        for (const meta_var of meta_vars) {
          ToTokens_for_TokenStream.to_tokens(
            minimal_quote`
              let (@ ${() => meta_var}) = match (@ ${() => meta_var}).next() {
                  Some(_x) => crate::RepInterp(_x),
                  None => break,
              };
            `,
            while_body,
          );
        }
        ToTokens_for_TokenStream.to_tokens(
          minimal_quote`
            (@ ${() => {
              if (sep_opt !== undefined) {
                const sep = sep_opt;
                return minimal_quote`
                  if _i > 0 {
                      (@ ${() =>
                        minimal_quote`crate::ToTokens::to_tokens(&crate::TokenTree::Punct(crate::Punct::new(
                          (@ ${() => TokenTree.from_Literal(Literal.character(sep.as_char()))}),
                          (@ ${() => minimal_quote`crate::Spacing::Alone`}),
                      )), &mut ts);`})
                  }
                  _i += 1;
                `;
              } else {
                return minimal_quote`();`;
              }
            }})
            (@ ${() => quote(contents.clone())}).to_tokens(&mut ts);
          `,
          while_body,
        );
        rep_expanded.extend_TokenTree([
          TokenTree.from_Ident(Ident.new("while", Span.call_site())),
          TokenTree.from_Ident(Ident.new("true", Span.call_site())),
          TokenTree.from_Group(Group.new("Brace", while_body)),
        ]);

        ToTokens_for_TokenStream.to_tokens(
          minimal_quote`(@ ${() => TokenTree.from_Group(Group.new("Brace", rep_expanded))})`,
          tokens,
        );
        continue;
      } else if (tree.$ === "Ident") {
        const t = tree;
        ToTokens_for_TokenStream.to_tokens(minimal_quote`crate::ToTokens::to_tokens(&(@ ${() => t}), &mut ts);`, tokens);
        continue;
      } else if (tree.$ === "Punct" && tree._0.as_char() === C_DOLLAR) {
        // ok
      } else {
        panic("`$` must be followed by an ident or `$` or a repetition group in `quote!`");
      }
    } else if (tree.$ === "Punct") {
      const tt = tree._0;
      if (tt.as_char() === C_DOLLAR) {
        after_dollar = true;
        continue;
      }
    }

    let r: TokenStream;
    switch (tree.$) {
      case "Punct": {
        const tt = tree._0;
        r = minimal_quote`crate::ToTokens::to_tokens(&crate::TokenTree::Punct(crate::Punct::new(
            (@ ${() => TokenTree.from_Literal(Literal.character(tt.as_char()))}),
            (@ ${() => {
              switch (tt.spacing()) {
                case "Alone":
                  return minimal_quote`crate::Spacing::Alone`;
                case "Joint":
                  return minimal_quote`crate::Spacing::Joint`;
              }
            }}),
        )), &mut ts);`;
        break;
      }
      case "Group": {
        const tt = tree._0;
        r = minimal_quote`crate::ToTokens::to_tokens(&crate::TokenTree::Group(crate::Group::new(
            (@ ${() => {
              switch (tt.delimiter()) {
                case "Parenthesis":
                  return minimal_quote`crate::Delimiter::Parenthesis`;
                case "Brace":
                  return minimal_quote`crate::Delimiter::Brace`;
                case "Bracket":
                  return minimal_quote`crate::Delimiter::Bracket`;
                case "None":
                  return minimal_quote`crate::Delimiter::None`;
              }
            }}),
            (@ ${() => quote(tt.stream())}),
        )), &mut ts);`;
        break;
      }
      case "Ident": {
        const tt = tree._0;
        const literal0 = tt.to_string();
        let literal: string;
        let ctor: TokenStream;
        if (literal0.startsWith("r#")) {
          const stripped = literal0.slice(2);
          [literal, ctor] = [stripped, minimal_quote`crate::Ident::new_raw`];
        } else {
          [literal, ctor] = [literal0, minimal_quote`crate::Ident::new`];
        }
        r = minimal_quote`crate::ToTokens::to_tokens(&crate::TokenTree::Ident((@ ${() => ctor})(
            (@ ${() => TokenTree.from_Literal(Literal.string(literal))}),
            (@ ${() => quote_span(proc_macro_crate.clone(), tt.span())}),
        )), &mut ts);`;
        break;
      }
      case "Literal": {
        const tt = tree._0;
        r = minimal_quote`crate::ToTokens::to_tokens(&crate::TokenTree::Literal({
            let mut iter = (@ ${() => TokenTree.from_Literal(Literal.string(tt.to_string()))})
                .parse::<crate::TokenStream>()
                .unwrap()
                .into_iter();
            if let (Some(crate::TokenTree::Literal(mut lit)), None) =
                (iter.next(), iter.next())
            {
                lit.set_span((@ ${() => quote_span(proc_macro_crate.clone(), tt.span())}));
                lit
            } else {
                unreachable!()
            }
        }), &mut ts);`;
        break;
      }
    }
    ToTokens_for_TokenStream.to_tokens(r, tokens);
  }
  if (after_dollar) {
    panic("unexpected trailing `$` in `quote!`");
  }

  return minimal_quote`
    {
        let mut ts = crate::TokenStream::new();
        (@ ${() => tokens})
        ts
    }
  `;
}

/// Helper function to support macro repetitions like `$( CONTENTS ) SEP_OPT *` in `quote!`.
/// Recursively collects all `Ident`s (meta-variables) that follow a `$`
/// from the given `CONTENTS` stream, preserving their order of appearance.
// std: library/proc_macro/src/quote.rs:456 collect_meta_vars
function collect_meta_vars(content_stream: TokenStream): Ident[] {
  // std: library/proc_macro/src/quote.rs:457 helper
  function helper(stream: TokenStream, out: Ident[]): void {
    const iter = new Peekable(stream.into_iter());
    for (let tree = iter.next(); tree !== undefined; tree = iter.next()) {
      if (tree.$ === "Punct" && tree._0.as_char() === C_DOLLAR) {
        const id = iter.peek();
        if (id?.$ === "Ident") {
          out.push(id._0.clone());
          iter.next();
        }
      } else if (tree.$ === "Group") {
        helper(tree._0.stream(), out);
      }
    }
  }

  const vars: Ident[] = [];
  helper(content_stream, vars);
  return vars;
}

/// Quote a `Span` into a `TokenStream`.
/// This is needed to implement a custom quoter.
// std: library/proc_macro/src/quote.rs:483 quote_span
export function quote_span(proc_macro_crate: TokenStream, span: Span): TokenStream {
  const id = span.save_span();
  return minimal_quote`(@ ${() => proc_macro_crate} ) ::Span::recover_proc_macro_span((@ ${() => TokenTree.from_Literal(Literal.usize_unsuffixed(id))}))`;
}
