// Port of compiler/rustc_expand/src/mbe/macro_parser.rs
//! This is an NFA-based parser, which calls out to the main Rust parser for named non-terminals
//! (which it commits to fully when it hits one in a grammar). There's a set of current NFA threads
//! and a set of next ones. Instead of NTs, we have a special case for Kleene star. The big-O, in
//! pathological cases, is worse than traditional use of NFA or Earley parsing, but it's an easier
//! fit for Macro-by-Example-style rules.
//!
//! (In order to prevent the pathological case, we'd need to lazily construct the resulting
//! `NamedMatch`es at the very end. It'd be a pain, and require more memory to keep around old
//! matcher positions, but it would also save overhead)
//!
//! We don't say this parser uses the Earley algorithm, because it's unnecessarily inaccurate.
//! The macro parser restricts itself to the features of finite state automata. Earley parsers
//! can be described as an extension of NFAs with completion rules, prediction rules, and recursion.
//!
//! Quick intro to how the parser works:
//!
//! A "matcher position" (a.k.a. "position" or "mp") is a dot in the middle of a matcher, usually
//! written as a `·`. For example `· a $( a )* a b` is one, as is `a $( · a )* a b`.
//!
//! The parser walks through the input a token at a time, maintaining a list
//! of threads consistent with the current position in the input string: `cur_mps`.
//!
//! As it processes them, it fills up `eof_mps` with threads that would be valid if
//! the macro invocation is now over, `bb_mps` with threads that are waiting on
//! a Rust non-terminal like `$e:expr`, and `next_mps` with threads that are waiting
//! on a particular token. Most of the logic concerns moving the · through the
//! repetitions indicated by Kleene stars. The rules for moving the · without
//! consuming any input are called epsilon transitions. It only advances or calls
//! out to the real Rust parser when no `cur_mps` threads remain.
//!
//! Example:
//!
//! ```text, ignore
//! Start parsing a a a a b against [· a $( a )* a b].
//!
//! Remaining input: a a a a b
//! next: [· a $( a )* a b]
//!
//! - - - Advance over an a. - - -
//!
//! Remaining input: a a a b
//! cur: [a · $( a )* a b]
//! Descend/Skip (first position).
//! next: [a $( · a )* a b]  [a $( a )* · a b].
//!
//! - - - Advance over an a. - - -
//!
//! Remaining input: a a b
//! cur: [a $( a · )* a b]  [a $( a )* a · b]
//! Follow epsilon transition: Finish/Repeat (first position)
//! next: [a $( a )* · a b]  [a $( · a )* a b]  [a $( a )* a · b]
//!
//! - - - Advance over an a. - - - (this looks exactly like the last step)
//!
//! Remaining input: a b
//! cur: [a $( a · )* a b]  [a $( a )* a · b]
//! Follow epsilon transition: Finish/Repeat (first position)
//! next: [a $( a )* · a b]  [a $( · a )* a b]  [a $( a )* a · b]
//!
//! - - - Advance over an a. - - - (this looks exactly like the last step)
//!
//! Remaining input: b
//! cur: [a $( a · )* a b]  [a $( a )* a · b]
//! Follow epsilon transition: Finish/Repeat (first position)
//! next: [a $( a )* · a b]  [a $( · a )* a b]  [a $( a )* a · b]
//!
//! - - - Advance over a b. - - -
//!
//! Remaining input: ''
//! eof: [a $( a )* a b ·]
//! ```
//
// PORT (shared contract with mbe-b, see docs/handoff/mbe-a.md):
// - `Cow<'_, Parser<'_>>` is `CowParser` (below): `get()` is the `Deref`, `to_mut()` clones a borrowed
//   parser on first use (`clone_Parser`), exactly like `Cow::to_mut`.
// - `Rc<Vec<NamedMatch>>` is a plain array treated as immutable once shared; `Rc::make_mut` in
//   `push_match` copies the outer array and the `MatchedSeq` arrays on the path it changes (the
//   unchanged parts stay shared). Rust only skips that copy when nothing else holds the `Rc`, so the
//   values every matcher position observes are the same.
// - `NamedMatches` (`FxHashMap<MacroRulesNormalizedIdent, NamedMatch>`) is `MacroRulesIdentMap`
//   (below), keyed like `Ident`'s `Hash`/`Eq` (name + `SyntaxContext`). Its iteration order is
//   insertion order, NOT hashbrown's: callers that iterate must keep that in mind.
// - The `Tracker<'matcher>` trait lives in macro_rules.rs (lane mbe-b). `Tracker` below is the part of
//   it the matcher calls; macro_rules.ts' full trait is structurally assignable to it.

import "../../rustc_parse/lib.ts";
import { token } from "../../rustc_ast/lib.ts";
import type { NonterminalKind, Token } from "../../rustc_ast/token.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import { clone_Parser, clone_ParseNtResult, debug_ParseNtResult, type ParseNtResult, type Parser, token_descr } from "../../rustc_parse/parser/mod.ts";
import { nonterminal_may_begin_with } from "../../rustc_parse/parser/nonterminal.ts";
import { debug_ErrorGuaranteed, debug_Span, type ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { debug_Ident, display_Ident, type Ident, MacroRulesNormalizedIdent } from "../../rustc_span/symbol.ts";
import { type Debug, debug_int, debug_struct, debug_tuple, debug_vec, type Fmt } from "../../std/fmt.ts";
import { assert, assert_eq, panic, unreachable, unwrap } from "../../std/panic.ts";
import type { KleeneOp, TokenTree } from "../mbe.ts";
import { debug_KleeneOp } from "../mbe.ts";

const { debug_NonterminalKind, debug_Token, display_NonterminalKind, NtExprKind_eq, NtPatKind_eq, Token_eq, TokenKind_eq } = token;

/// A unit within a matcher that a `MatcherPos` can refer to. Similar to (and derived from)
/// `mbe::TokenTree`, but designed specifically for fast and easy traversal during matching.
/// Notable differences to `mbe::TokenTree`:
/// - It is non-recursive, i.e. there is no nesting.
/// - The end pieces of each sequence (the separator, if present, and the Kleene op) are
///   represented explicitly, as is the very end of the matcher.
///
/// This means a matcher can be represented by `&[MatcherLoc]`, and traversal mostly involves
/// simply incrementing the current matcher position index by one.
// rustc-type: compiler/rustc_expand/src/mbe/macro_parser.rs:99 MatcherLoc
export type MatcherLoc =
  | { readonly $: "Token"; token: Token }
  | { readonly $: "Delimited" }
  | {
      readonly $: "Sequence";
      op: KleeneOp;
      num_metavar_decls: number;
      idx_first_after: number;
      next_metavar: number;
      seq_depth: number;
    }
  | { readonly $: "SequenceKleeneOpNoSep"; op: KleeneOp; idx_first: number }
  | { readonly $: "SequenceSep"; separator: Token }
  | { readonly $: "SequenceKleeneOpAfterSep"; idx_first: number }
  | {
      readonly $: "MetaVarDecl";
      span: Span;
      bind: Ident;
      kind: NonterminalKind;
      next_metavar: number;
      seq_depth: number;
    }
  | { readonly $: "Eof" };
export const debug_MatcherLoc: Debug<MatcherLoc> = (v, f) => {
  switch (v.$) {
    case "Token":
      return debug_struct(f, "Token", [["token", debug_Token(v.token, f)]]);
    case "Delimited":
      return "Delimited";
    case "Sequence":
      return debug_struct(f, "Sequence", [
        ["op", debug_KleeneOp(v.op, f)],
        ["num_metavar_decls", debug_int(v.num_metavar_decls, f)],
        ["idx_first_after", debug_int(v.idx_first_after, f)],
        ["next_metavar", debug_int(v.next_metavar, f)],
        ["seq_depth", debug_int(v.seq_depth, f)],
      ]);
    case "SequenceKleeneOpNoSep":
      return debug_struct(f, "SequenceKleeneOpNoSep", [
        ["op", debug_KleeneOp(v.op, f)],
        ["idx_first", debug_int(v.idx_first, f)],
      ]);
    case "SequenceSep":
      return debug_struct(f, "SequenceSep", [["separator", debug_Token(v.separator, f)]]);
    case "SequenceKleeneOpAfterSep":
      return debug_struct(f, "SequenceKleeneOpAfterSep", [["idx_first", debug_int(v.idx_first, f)]]);
    case "MetaVarDecl":
      return debug_struct(f, "MetaVarDecl", [
        ["span", debug_Span(v.span, f)],
        ["bind", debug_Ident(v.bind, f)],
        ["kind", debug_NonterminalKind(v.kind, f)],
        ["next_metavar", debug_int(v.next_metavar, f)],
        ["seq_depth", debug_int(v.seq_depth, f)],
      ]);
    case "Eof":
      return "Eof";
  }
};

/** `#[derive(PartialEq)]` of `NonterminalKind` (no shared helper in token.ts). */
function NonterminalKind_eq(a: NonterminalKind, b: NonterminalKind): boolean {
  if (a.$ === "Pat") return b.$ === "Pat" && NtPatKind_eq(a._0, b._0);
  if (a.$ === "Expr") return b.$ === "Expr" && NtExprKind_eq(a._0, b._0);
  return a.$ === b.$;
}

/** `#[derive(PartialEq)]` (used by mbe/diagnostics.rs: `*matcher != MatcherLoc::Eof`). */
export function MatcherLoc_eq(a: MatcherLoc, b: MatcherLoc): boolean {
  switch (a.$) {
    case "Token":
      return b.$ === "Token" && Token_eq(a.token, b.token);
    case "Delimited":
      return b.$ === "Delimited";
    case "Sequence":
      return (
        b.$ === "Sequence" &&
        a.op === b.op &&
        a.num_metavar_decls === b.num_metavar_decls &&
        a.idx_first_after === b.idx_first_after &&
        a.next_metavar === b.next_metavar &&
        a.seq_depth === b.seq_depth
      );
    case "SequenceKleeneOpNoSep":
      return b.$ === "SequenceKleeneOpNoSep" && a.op === b.op && a.idx_first === b.idx_first;
    case "SequenceSep":
      return b.$ === "SequenceSep" && Token_eq(a.separator, b.separator);
    case "SequenceKleeneOpAfterSep":
      return b.$ === "SequenceKleeneOpAfterSep" && a.idx_first === b.idx_first;
    case "MetaVarDecl":
      return (
        b.$ === "MetaVarDecl" &&
        a.span === b.span &&
        a.bind.eq(b.bind) &&
        NonterminalKind_eq(a.kind, b.kind) &&
        a.next_metavar === b.next_metavar &&
        a.seq_depth === b.seq_depth
      );
    case "Eof":
      return b.$ === "Eof";
  }
}

// impl MatcherLoc (methods on the companion, PORTING §8)
export const MatcherLoc = {
  Delimited: Object.freeze({ $: "Delimited" as const }),
  Eof: Object.freeze({ $: "Eof" as const }),

  // rustc: compiler/rustc_expand/src/mbe/macro_parser.rs:132 span
  span(self: MatcherLoc): Span | undefined {
    switch (self.$) {
      case "Token":
        return self.token.span;
      case "Delimited":
        return undefined;
      case "Sequence":
        return undefined;
      case "SequenceKleeneOpNoSep":
        return undefined;
      case "SequenceSep":
        return undefined;
      case "SequenceKleeneOpAfterSep":
        return undefined;
      case "MetaVarDecl":
        return self.span;
      case "Eof":
        return undefined;
    }
  },
};

// impl Display for MatcherLoc
// rustc: compiler/rustc_expand/src/mbe/macro_parser.rs:147 fmt
export function display_MatcherLoc(self: MatcherLoc): string {
  switch (self.$) {
    case "Token":
      return token_descr(self.token);
    case "SequenceSep":
      return token_descr(self.separator);
    case "MetaVarDecl":
      return `meta-variable \`$${display_Ident(self.bind)}:${display_NonterminalKind(self.kind)}\``;
    case "Eof":
      return "end of macro";

    // These are not printed in the diagnostic
    case "Delimited":
      return "delimiter";
    case "Sequence":
      return "sequence start";
    case "SequenceKleeneOpNoSep":
      return "sequence end";
    case "SequenceKleeneOpAfterSep":
      return "sequence end";
  }
}

// rustc: compiler/rustc_expand/src/mbe/macro_parser.rs:166 compute_locs
export function compute_locs(matcher: readonly TokenTree[]): MatcherLoc[] {
  // rustc: compiler/rustc_expand/src/mbe/macro_parser.rs:167 inner
  function inner(tts: readonly TokenTree[], locs: MatcherLoc[], next_metavar: { value: number }, seq_depth: number): void {
    for (const tt of tts) {
      switch (tt.$) {
        case "Token": {
          locs.push({ $: "Token", token: tt._0 });
          break;
        }
        case "Delimited": {
          const span = tt._0;
          const delimited = tt._2;
          const open_token = token.Token.new(token.Delimiter.as_open_token_kind(delimited.delim), span.open);
          const close_token = token.Token.new(token.Delimiter.as_close_token_kind(delimited.delim), span.close);

          locs.push({ $: "Delimited" });
          locs.push({ $: "Token", token: open_token });
          inner(delimited.tts, locs, next_metavar, seq_depth);
          locs.push({ $: "Token", token: close_token });
          break;
        }
        case "Sequence": {
          const seq = tt._1;
          // We can't determine `idx_first_after` and construct the final
          // `MatcherLoc::Sequence` until after `inner()` is called and the sequence end
          // pieces are processed. So we push a dummy value (`Eof` is cheapest to
          // construct) now, and overwrite it with the proper value below.
          const dummy = MatcherLoc.Eof;
          locs.push(dummy);

          const next_metavar_orig = next_metavar.value;
          const op = seq.kleene.op;
          const idx_first = locs.length;
          const idx_seq = idx_first - 1;
          inner(seq.tts, locs, next_metavar, seq_depth + 1);

          if (seq.separator !== undefined) {
            const separator = seq.separator;
            locs.push({ $: "SequenceSep", separator });
            locs.push({ $: "SequenceKleeneOpAfterSep", idx_first });
          } else {
            locs.push({ $: "SequenceKleeneOpNoSep", op, idx_first });
          }

          // Overwrite the dummy value pushed above with the proper value.
          locs[idx_seq] = {
            $: "Sequence",
            op,
            num_metavar_decls: seq.num_captures,
            idx_first_after: locs.length,
            next_metavar: next_metavar_orig,
            seq_depth,
          };
          break;
        }
        case "MetaVarDecl": {
          const { span, name: bind, kind } = tt;
          locs.push({
            $: "MetaVarDecl",
            span,
            bind,
            kind,
            next_metavar: next_metavar.value,
            seq_depth,
          });
          next_metavar.value += 1;
          break;
        }
        case "MetaVar":
        case "MetaVarExpr":
          unreachable();
      }
    }
  }

  const locs: MatcherLoc[] = [];
  const next_metavar = { value: 0 };
  inner(matcher, locs, next_metavar, /* seq_depth */ 0);

  // A final entry is needed for eof.
  locs.push(MatcherLoc.Eof);

  return locs;
}

/// A single matcher position, representing the state of matching.
// rustc-type: compiler/rustc_expand/src/mbe/macro_parser.rs:244 MatcherPos
class MatcherPos {
  constructor(
    /// The index into `TtParser::locs`, which represents the "dot".
    public idx: number,

    /// The matches made against metavar decls so far. On a successful match, this vector ends up
    /// with one element per metavar decl in the matcher. Each element records token trees matched
    /// against the relevant metavar by the black box parser. An element will be a `MatchedSeq` if
    /// the corresponding metavar decl is within a sequence.
    ///
    /// It is critical to performance that this is an `Rc`, because it gets cloned frequently when
    /// processing sequences. Mostly for sequence-ending possibilities that must be tried but end
    /// up failing.
    // PORT: `Rc<Vec<NamedMatch>>`: a shared array that is never mutated in place (see the header).
    public matches: readonly NamedMatch[],
  ) {}

  // This type is used a lot. Make sure it doesn't unintentionally get bigger.
  // PORT: `static_assert_size!(MatcherPos, 16)` has no TS counterpart.

  /// Adds `m` as a named match for the `metavar_idx`-th metavar. There are only two call sites,
  /// and both are hot enough to be always worth inlining.
  // rustc: compiler/rustc_expand/src/mbe/macro_parser.rs:267 push_match
  push_match(metavar_idx: number, seq_depth: number, m: NamedMatch): void {
    // PORT: `Rc::make_mut(&mut self.matches)`: copy-on-write of the outer array, then of each
    // `MatchedSeq` vector on the path to the one that is appended to.
    const matches = this.matches.slice();
    this.matches = matches;
    switch (seq_depth) {
      case 0: {
        // We are not within a sequence. Just append `m`.
        assert_eq(metavar_idx, matches.length, String);
        matches.push(m);
        break;
      }
      default: {
        // We are within a sequence. Find the final `MatchedSeq` at the appropriate depth
        // and append `m` to its vector.
        let holder: NamedMatch[] = matches;
        let at = metavar_idx;
        let curr = unwrap(holder[at], `index out of bounds: the len is ${holder.length} but the index is ${at}`);
        for (let i = 0; i < seq_depth - 1; i++) {
          switch (curr.$) {
            case "MatchedSeq": {
              const seq = curr._0.slice();
              holder[at] = { $: "MatchedSeq", _0: seq };
              holder = seq;
              at = seq.length - 1;
              curr = unwrap(seq[at]);
              break;
            }
            default:
              unreachable();
          }
        }
        switch (curr.$) {
          case "MatchedSeq": {
            const seq = curr._0.slice();
            seq.push(m);
            holder[at] = { $: "MatchedSeq", _0: seq };
            break;
          }
          default:
            unreachable();
        }
      }
    }
  }
}
const debug_MatcherPos: Debug<MatcherPos> = (v, f) =>
  debug_struct(f, "MatcherPos", [
    ["idx", debug_int(v.idx, f)],
    ["matches", debug_vec(v.matches, f, debug_NamedMatch)],
  ]);
void debug_MatcherPos;

/// Represents the possible results of an attempted parse.
// rustc-type: compiler/rustc_expand/src/mbe/macro_parser.rs:296 ParseResult
export type ParseResult<T> =
  /// Parsed successfully.
  | { readonly $: "Success"; _0: T }
  /// Arm failed to match.
  ///
  /// [`Tracker::failure()`] will be called beforehand.
  | { readonly $: "Failure" }
  /// The input could be parsed in multiple distinct ways.
  ///
  /// [`Tracker::ambiguity()`] will be called beforehand.
  | { readonly $: "Ambiguity" }
  | { readonly $: "ErrorReported"; _0: ErrorGuaranteed };
export function debug_ParseResult<T>(v: ParseResult<T>, f: Fmt, debug_T: Debug<T>): string {
  switch (v.$) {
    case "Success":
      return debug_tuple(f, "Success", [debug_T(v._0, f)]);
    case "Failure":
      return "Failure";
    case "Ambiguity":
      return "Ambiguity";
    case "ErrorReported":
      return debug_tuple(f, "ErrorReported", [debug_ErrorGuaranteed(v._0, f)]);
  }
}
// `pub(crate) use ParseResult::*;`: the unit variants as shared values.
export const Failure: ParseResult<never> = Object.freeze({ $: "Failure" as const });
export const Ambiguity: ParseResult<never> = Object.freeze({ $: "Ambiguity" as const });

/// A `ParseResult` where the `Success` variant contains a mapping of
/// `MacroRulesNormalizedIdent`s to `NamedMatch`es. This represents the mapping
/// of metavars to the token trees they bind to.
export type NamedParseResult = ParseResult<NamedMatches>;

/// PORT: `FxHashMap<MacroRulesNormalizedIdent, V>`. `MacroRulesNormalizedIdent` hashes and compares
/// as its `Ident`: the name plus the span's `SyntaxContext`, which is the JS key. Iteration
/// (`iter`) is insertion order; hashbrown's order is not reproduced.
export class MacroRulesIdentMap<V> {
  private readonly m = new Map<string, [MacroRulesNormalizedIdent, V]>();

  /** `Default::default()` */
  static default<V>(): MacroRulesIdentMap<V> {
    return new MacroRulesIdentMap<V>();
  }

  private static key(k: MacroRulesNormalizedIdent): string {
    return `${k._0.name},${Span.ctxt(k._0.span)}`;
  }

  get(k: MacroRulesNormalizedIdent): V | undefined {
    return this.m.get(MacroRulesIdentMap.key(k))?.[1];
  }

  contains_key(k: MacroRulesNormalizedIdent): boolean {
    return this.m.has(MacroRulesIdentMap.key(k));
  }

  /** `HashMap::insert`: returns the previous value; the stored key stays the first one inserted. */
  insert(k: MacroRulesNormalizedIdent, v: V): V | undefined {
    const key = MacroRulesIdentMap.key(k);
    const old = this.m.get(key);
    this.m.set(key, [old !== undefined ? old[0] : k, v]);
    return old?.[1];
  }

  remove(k: MacroRulesNormalizedIdent): V | undefined {
    const key = MacroRulesIdentMap.key(k);
    const old = this.m.get(key);
    this.m.delete(key);
    return old?.[1];
  }

  len(): number {
    return this.m.size;
  }

  is_empty(): boolean {
    return this.m.size === 0;
  }

  /** Insertion order (see the class note). */
  iter(): IterableIterator<[MacroRulesNormalizedIdent, V]> {
    return this.m.values();
  }
}

/// Contains a mapping of `MacroRulesNormalizedIdent`s to `NamedMatch`es.
/// This represents the mapping of metavars to the token trees they bind to.
export type NamedMatches = MacroRulesIdentMap<NamedMatch>;

/// Count how many metavars declarations are in `matcher`.
// rustc: compiler/rustc_expand/src/mbe/macro_parser.rs:320 count_metavar_decls
export function count_metavar_decls(matcher: readonly TokenTree[]): number {
  let sum = 0;
  for (const tt of matcher) {
    switch (tt.$) {
      case "MetaVarDecl":
        sum += 1;
        break;
      case "Sequence":
        sum += tt._1.num_captures;
        break;
      case "Delimited":
        sum += count_metavar_decls(tt._2.tts);
        break;
      case "Token":
        sum += 0;
        break;
      case "MetaVar":
      case "MetaVarExpr":
        unreachable();
    }
  }
  return sum;
}

/// `NamedMatch` is a pattern-match result for a single metavar. All
/// `MatchedNonterminal`s in the `NamedMatch` have the same non-terminal type
/// (expr, item, etc).
///
/// The in-memory structure of a particular `NamedMatch` represents the match
/// that occurred when a particular subset of a matcher was applied to a
/// particular token tree.
///
/// The width of each `MatchedSeq` in the `NamedMatch`, and the identity of
/// the `MatchedNtNonTts`s, will depend on the token tree it was applied
/// to: each `MatchedSeq` corresponds to a single repetition in the originating
/// token tree. The depth of the `NamedMatch` structure will therefore depend
/// only on the nesting depth of repetitions in the originating token tree it
/// was derived from.
///
/// In layperson's terms: `NamedMatch` will form a tree representing nested matches of a particular
/// meta variable. For example, if we are matching the following macro against the following
/// invocation...
///
/// ```rust
/// macro_rules! foo {
///   ($($($x:ident),+);+) => {}
/// }
///
/// foo!(a, b, c, d; a, b, c, d, e);
/// ```
///
/// Then, the tree will have the following shape:
///
/// ```ignore (private-internal)
/// # use NamedMatch::*;
/// MatchedSeq([
///   MatchedSeq([
///     MatchedNonterminal(a),
///     MatchedNonterminal(b),
///     MatchedNonterminal(c),
///     MatchedNonterminal(d),
///   ]),
///   MatchedSeq([
///     MatchedNonterminal(a),
///     MatchedNonterminal(b),
///     MatchedNonterminal(c),
///     MatchedNonterminal(d),
///     MatchedNonterminal(e),
///   ])
/// ])
/// ```
// rustc-type: compiler/rustc_expand/src/mbe/macro_parser.rs:381 NamedMatch
export type NamedMatch =
  | { readonly $: "MatchedSeq"; _0: NamedMatch[] }
  | { readonly $: "MatchedSingle"; _0: ParseNtResult };
export const debug_NamedMatch: Debug<NamedMatch> = (v, f) => {
  switch (v.$) {
    case "MatchedSeq":
      return debug_tuple(f, "MatchedSeq", [debug_vec(v._0, f, debug_NamedMatch)]);
    case "MatchedSingle":
      return debug_tuple(f, "MatchedSingle", [debug_ParseNtResult(v._0, f)]);
  }
};
/** `#[derive(Clone)]` (PORT: hand-written; rustc_expand has no codegen set yet). */
export function clone_NamedMatch(v: NamedMatch): NamedMatch {
  switch (v.$) {
    case "MatchedSeq":
      return { $: "MatchedSeq", _0: v._0.map(clone_NamedMatch) };
    case "MatchedSingle":
      return { $: "MatchedSingle", _0: clone_ParseNtResult(v._0) };
  }
}

// impl NamedMatch (methods on the companion, PORTING §8)
export const NamedMatch = {
  // rustc: compiler/rustc_expand/src/mbe/macro_parser.rs:387 is_repeatable
  is_repeatable(self: NamedMatch): boolean {
    switch (self.$) {
      case "MatchedSeq":
        return true;
      case "MatchedSingle":
        return false;
    }
  },
};

/// Performs a token equality check, ignoring syntax context (that is, an unhygienic comparison)
// rustc: compiler/rustc_expand/src/mbe/macro_parser.rs:396 token_name_eq
function token_name_eq(t1: Token, t2: Token): boolean {
  const i1 = t1.ident();
  const i2 = t2.ident();
  if (i1 !== undefined && i2 !== undefined) {
    const [ident1, is_raw1] = i1;
    const [ident2, is_raw2] = i2;
    return ident1.name === ident2.name && is_raw1 === is_raw2;
  }
  const l1 = t1.lifetime();
  const l2 = t2.lifetime();
  if (l1 !== undefined && l2 !== undefined) {
    const [ident1, is_raw1] = l1;
    const [ident2, is_raw2] = l2;
    return ident1.name === ident2.name && is_raw1 === is_raw2;
  } else {
    // Note: we SHOULD NOT use `t1.kind == t2.kind` here, and we should instead compare the
    // tokens using the special comparison logic below.
    // It makes sure that variants containing `InvisibleOrigin` will
    // never compare equal to one another.
    //
    // When we had AST-based nonterminals we couldn't compare them, and the
    // old `Nonterminal` type had an `eq` that always returned false,
    // resulting in this restriction:
    // <https://doc.rust-lang.org/nightly/reference/macros-by-example.html#forwarding-a-matched-fragment>
    // This comparison logic emulates that behaviour. We could consider lifting this
    // restriction now but there are still cases involving invisible
    // delimiters that make it harder than it first appears.
    const a = t1.kind;
    const b = t2.kind;
    if (a.$ === "OpenInvisible" || a.$ === "CloseInvisible" || b.$ === "OpenInvisible" || b.$ === "CloseInvisible") {
      return false;
    }
    return TokenKind_eq(a, b);
  }
}

/// PORT: `Cow<'_, Parser<'_>>`: `Borrowed` until the first `to_mut()`, which clones the parser.
export class CowParser {
  private constructor(
    private parser: Parser,
    private owned: boolean,
  ) {}

  /** `Cow::Borrowed(&parser)` */
  static Borrowed(parser: Parser): CowParser {
    return new CowParser(parser, false);
  }

  /** `Cow::Owned(parser)` */
  static Owned(parser: Parser): CowParser {
    return new CowParser(parser, true);
  }

  /** `Deref` */
  get(): Parser {
    return this.parser;
  }

  /** `Cow::to_mut` */
  to_mut(): Parser {
    if (!this.owned) {
      this.parser = clone_Parser(this.parser);
      this.owned = true;
    }
    return this.parser;
  }

  /** `matches!(cow, Cow::Owned(_))` */
  is_owned(): boolean {
    return this.owned;
  }
}

/// PORT: the part of `mbe::macro_rules::Tracker<'matcher>` (lane mbe-b) that the matcher calls.
export interface Tracker {
  /// This is called before trying to match next MatcherLoc on the current token.
  before_match_loc(parser: TtParser, matcher: MatcherLoc): void;
  /// A [`MatcherLoc`] successfully consumed input from the parser.
  matched_one(parser: Parser, loc_index: number): void;
  /// The arm could not be matched successfully.
  failure(parser: Parser): void;
  /// An ambiguity error occurred.
  ambiguity(parser: Parser): void;
}

/** `ControlFlow<B, ()>` */
type ControlFlow<B> = { readonly $: "Break"; _0: B } | { readonly $: "Continue" };
const Continue: ControlFlow<never> = Object.freeze({ $: "Continue" as const });

// Note: the vectors could be created and dropped within `parse_tt`, but to avoid excess
// allocations we have a single vector for each kind that is cleared and reused repeatedly.
// rustc-type: compiler/rustc_expand/src/mbe/macro_parser.rs:426 TtParser
export class TtParser {
  constructor(
    /// The set of current mps to be processed. This should be empty by the end of a successful
    /// execution of `parse_tt_inner`.
    private cur_mps: MatcherPos[],

    /// The set of newly generated mps. These are used to replenish `cur_mps` in the function
    /// `parse_tt`.
    private next_mps: MatcherPos[],

    /// Pre-allocate an empty match array, so it can be cloned cheaply for macros with many rules
    /// that have no metavars.
    private empty_matches: readonly NamedMatch[],

    /// Whether an ambiguity error has occurred.
    private found_ambiguity: boolean,
  ) {}

  // rustc: compiler/rustc_expand/src/mbe/macro_parser.rs:444 new
  static new(): TtParser {
    return new TtParser([], [], [], false);
  }

  // rustc: compiler/rustc_expand/src/mbe/macro_parser.rs:453 has_no_remaining_items_for_step
  has_no_remaining_items_for_step(): boolean {
    return this.cur_mps.length === 0;
  }

  /// Process the matcher positions of `cur_mps` until it is empty. In the process, this will
  /// produce more mps in `next_mps` and `bb_mps`.
  ///
  /// # Returns
  ///
  /// `Some(result)` if everything is finished, `None` otherwise. Note that matches are kept
  /// track of through the mps generated.
  // rustc: compiler/rustc_expand/src/mbe/macro_parser.rs:464 parse_tt_inner
  private parse_tt_inner(parser: CowParser, matcher: readonly MatcherLoc[], track: Tracker): NamedParseResult | undefined {
    for (let mp = this.cur_mps.pop(); mp !== undefined; mp = this.cur_mps.pop()) {
      const result = this.match_one(parser, matcher, mp, track, false);
      if (result !== undefined) {
        return result;
      }
    }

    // FIXME: Error messages here could be improved with links to original rules.

    if (this.next_mps.length === 0) {
      // There are no possible next positions: syntax error.
      track.failure(parser.get());
      return Failure;
    }

    // Dump all possible `next_mps` into `cur_mps` for the next iteration. Then
    // process the next token.
    for (const mp of this.next_mps) this.cur_mps.push(mp);
    this.next_mps.length = 0;
    parser.to_mut().bump();

    return undefined;
  }

  /// Match a single [`MatcherPos`].
  ///
  /// If a meta-variable is encountered and `checking_for_ambiguity` is `false`, `cur_mps` will be
  /// drained to eagerly check for ambiguity, and `parser` will be modified.
  // must be inlined in `parse_tt_inner()`
  // rustc: compiler/rustc_expand/src/mbe/macro_parser.rs:497 match_one
  private match_one(
    parser: CowParser,
    matcher: readonly MatcherLoc[],
    mp: MatcherPos,
    track: Tracker,
    checking_for_ambiguity: boolean,
  ): NamedParseResult | undefined {
    const matcher_loc = matcher[mp.idx]!;
    track.before_match_loc(this, matcher_loc);
    const token_ = parser.get().token;

    switch (matcher_loc.$) {
      case "Token": {
        const t = matcher_loc.token;
        // If it's a doc comment, we just ignore it and move on to the next tt in the
        // matcher. This is a bug, but #95267 showed that existing programs rely on this
        // behaviour, and changing it would require some care and a transition period.
        //
        // If the token matches, we can just advance the parser.
        //
        // Otherwise, this match has failed, there is nothing to do, and hopefully another
        // mp in `cur_mps` will match.
        if (t.kind.$ === "DocComment") {
          mp.idx += 1;
          this.cur_mps.push(mp);
        } else if (token_name_eq(t, token_)) {
          track.matched_one(parser.get(), mp.idx);
          mp.idx += 1;
          this.next_mps.push(mp);
        }
        break;
      }
      case "Delimited": {
        // Entering the delimiter is trivial.
        mp.idx += 1;
        this.cur_mps.push(mp);
        break;
      }
      case "Sequence": {
        const { op, num_metavar_decls, idx_first_after, next_metavar, seq_depth } = matcher_loc;
        // Install an empty vec for each metavar within the sequence.
        for (let metavar_idx = next_metavar; metavar_idx < next_metavar + num_metavar_decls; metavar_idx++) {
          mp.push_match(metavar_idx, seq_depth, { $: "MatchedSeq", _0: [] });
        }

        if (op === "ZeroOrMore" || op === "ZeroOrOne") {
          // Try zero matches of this sequence, by skipping over it.
          this.cur_mps.push(new MatcherPos(idx_first_after, mp.matches));
        }

        // Try one or more matches of this sequence, by entering it.
        mp.idx += 1;
        this.cur_mps.push(mp);
        break;
      }
      case "SequenceKleeneOpNoSep": {
        const { op, idx_first } = matcher_loc;
        // We are past the end of a sequence with no separator. Try ending the sequence. If
        // that's not possible, `ending_mp` will fail quietly when it is processed next time
        // around the loop.
        const ending_mp = new MatcherPos(
          mp.idx + 1, // +1 skips the Kleene op
          mp.matches,
        );
        this.cur_mps.push(ending_mp);

        if (op !== "ZeroOrOne") {
          // Try another repetition.
          mp.idx = idx_first;
          this.cur_mps.push(mp);
        }
        break;
      }
      case "SequenceSep": {
        const separator = matcher_loc.separator;
        // We are past the end of a sequence with a separator but we haven't seen the
        // separator yet. Try ending the sequence. If that's not possible, `ending_mp` will
        // fail quietly when it is processed next time around the loop.
        const ending_mp = new MatcherPos(
          mp.idx + 2, // +2 skips the separator and the Kleene op
          mp.matches,
        );
        this.cur_mps.push(ending_mp);

        if (token_name_eq(token_, separator)) {
          // The separator matches the current token. Advance past it.
          track.matched_one(parser.get(), mp.idx);
          mp.idx += 1;
          this.next_mps.push(mp);
        }
        break;
      }
      case "SequenceKleeneOpAfterSep": {
        const { idx_first } = matcher_loc;
        // We are past the sequence separator. This can't be a `?` Kleene op, because they
        // don't permit separators. Try another repetition.
        mp.idx = idx_first;
        this.cur_mps.push(mp);
        break;
      }
      case "MetaVarDecl": {
        const { kind, next_metavar, seq_depth } = matcher_loc;
        // Built-in nonterminals never start with these tokens, so we can eliminate them
        // from consideration. We use the span of the metavariable declaration to determine
        // any edition-specific matching behavior for non-terminals.
        if (!nonterminal_may_begin_with(kind, token_)) {
          return undefined;
        }

        // EOF tokens would cause unexpected processing in `match_one()`.
        // debug_assert!(parser.token != token::Eof, "{kind:?} should not accept EOF tokens");

        track.matched_one(parser.get(), mp.idx);

        const cf = this.check_for_ambiguity<NamedMatches>(parser, matcher, track, checking_for_ambiguity);
        if (cf.$ === "Break") {
          const result = cf._0;
          return result;
        }

        // We use the span of the metavariable declaration to determine any
        // edition-specific matching behavior for non-terminals.
        const r = parser.to_mut().parse_nonterminal(kind);
        if (r.$ === "Err") return this.nt_parsing_error(matcher_loc, r._0);
        const nt = r._0;
        mp.push_match(next_metavar, seq_depth, { $: "MatchedSingle", _0: nt });

        mp.idx += 1;
        this.cur_mps.push(mp);
        break;
      }
      case "Eof": {
        // We are past the matcher's end, and not in a sequence. Try to end things.
        // debug_assert_eq!(mp.idx, matcher.len() - 1);

        if (!token_.eq(token.TokenKind.Eof)) {
          return undefined;
        }

        track.matched_one(parser.get(), mp.idx);

        const cf = this.check_for_ambiguity<NamedMatches>(parser, matcher, track, checking_for_ambiguity);
        if (cf.$ === "Break") {
          const result = cf._0;
          return result;
        }

        // PORT: `Rc::unwrap_or_clone(mp.matches).into_iter()`: the array is only read.
        const matches = mp.matches[Symbol.iterator]();
        return { $: "Success", _0: this.nameize(matcher, matches) };
      }
    }

    return undefined;
  }

  /// Look for ambiguity before parsing a non-terminal.
  ///
  /// - When `checking_for_ambiguity`: immediately an ambiguity error.
  /// - Otherwise: eagerly consumes [`Self::cur_mps`] to check for ambiguity.
  ///
  /// If [`ControlFlow::Continue`] is returned, ambiguity has not been detected.
  // rustc: compiler/rustc_expand/src/mbe/macro_parser.rs:654 check_for_ambiguity
  private check_for_ambiguity<R>(
    parser: CowParser,
    matcher: readonly MatcherLoc[],
    track: Tracker,
    checking_for_ambiguity: boolean,
  ): ControlFlow<ParseResult<R> | undefined> {
    if (checking_for_ambiguity) {
      // This was called in the context of a _different_ `MatcherLoc` that was about to be
      // matched. Prevent the caller from doing more work, but don't prepare the actual error
      // yet; let the outer `check_for_ambiguity()` do that.
      this.found_ambiguity = true;
      return { $: "Break", _0: undefined };
    }

    assert(!this.found_ambiguity, "assertion failed: !self.found_ambiguity");

    // Consume all pending mps at the current input position.
    for (let mp = this.cur_mps.pop(); mp !== undefined; mp = this.cur_mps.pop()) {
      const result = this.match_one(parser, matcher, mp, track, true);
      // A result cannot be returned when `check_for_ambiguity` is `true`.
      assert(result === undefined, "assertion failed: result.is_none()");
    }

    const found_ambiguity = this.found_ambiguity;
    this.found_ambiguity = false;
    if (found_ambiguity || this.next_mps.length !== 0) {
      track.ambiguity(parser.get());
      return { $: "Break", _0: Ambiguity };
    } else {
      return Continue;
    }
  }

  /// Match the token stream from `parser` against `matcher`.
  // rustc: compiler/rustc_expand/src/mbe/macro_parser.rs:687 parse_tt
  parse_tt(parser: CowParser, matcher: readonly MatcherLoc[], track: Tracker): NamedParseResult {
    // A queue of possible matcher positions. We initialize it with the matcher position in
    // which the "dot" is before the first token of the first token tree in `matcher`.
    // `parse_tt_inner` then processes all of these possible matcher positions and produces
    // possible next positions into `next_mps`. After some post-processing, the contents of
    // `next_mps` replenish `cur_mps` and we start over again.
    this.cur_mps.length = 0;
    this.cur_mps.push(new MatcherPos(0, this.empty_matches));

    for (;;) {
      assert(this.cur_mps.length !== 0, "assertion failed: !self.cur_mps.is_empty()");
      this.next_mps.length = 0;

      // Parse all mps at the current input position, then progress the parser.
      const res = this.parse_tt_inner(parser, matcher, track);

      if (res !== undefined) {
        return res;
      }
    }
  }

  // rustc: compiler/rustc_expand/src/mbe/macro_parser.rs:714 nt_parsing_error
  private nt_parsing_error<R>(loc: MatcherLoc, err: Diag): ParseResult<R> {
    if (loc.$ !== "MetaVarDecl") unreachable();
    const { span, kind } = loc;
    const guar = err
      .with_span_label(span, `while parsing argument for this \`${display_NonterminalKind(kind)}\` macro fragment`)
      .emit_err();
    return { $: "ErrorReported", _0: guar };
  }

  // rustc: compiler/rustc_expand/src/mbe/macro_parser.rs:725 nameize
  private nameize(matcher: readonly MatcherLoc[], res: Iterator<NamedMatch>): NamedMatches {
    // Make that each metavar has _exactly one_ binding. If so, insert the binding into the
    // `NamedParseResult`. Otherwise, it's an error.
    const ret_val: NamedMatches = MacroRulesIdentMap.default();
    for (const loc of matcher) {
      if (loc.$ === "MetaVarDecl") {
        const bind = loc.bind;
        const next = res.next();
        if (next.done === true) panic("called `Option::unwrap()` on a `None` value");
        if (ret_val.insert(MacroRulesNormalizedIdent.new(bind), next.value) !== undefined) {
          // Duplicate binds are checked for when the macro definition is processed,
          // and should have prevented the definition from ever being used.
          panic("duplicate meta-variable binding went undetected at macro definition");
        }
      }
    }
    return ret_val;
  }
}
