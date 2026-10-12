# Handoff: ast-token (rustc_ast token.rs, tokenstream.rs, util/*)

## Files touched (hand modules only; no `.gen.ts`, std, scripts or harness edits)
- `src/rustc_ast/token.ts`, `src/rustc_ast/tokenstream.ts`
- `src/rustc_ast/util/{literal,comments,unicode,classify,parser,case}.ts`
- new tests: `src/rustc_ast/tokenstream/tests.test.ts`, `src/rustc_ast/util/comments/tests.test.ts`

## Coverage (`bun scripts/coverage.ts --missing <file>`)
token 72/72, tokenstream 64/64 (4 `rustc-skip`: Encodable/Decodable/StableHash), tokenstream/tests 1/1,
util/literal 13/13, util/comments 4/4, util/unicode 1/1, util/classify 6/6, util/parser 8/8, util/case 0/0,
util/comments/tests 5/5. `coverage --check`: markers ok (804).

## Checks
- `bunx tsc --noEmit -p .` clean. `bun test src/rustc_ast`: 18 pass, 0 fail (3 files).
- `difftest --suite lex --sample 300`: 300/300 MATCH (run 20261012-155459-ast-token-nrtw).
- Runtime smoke (not committed): literal cooking/Display for int/float/str/byte-str/c-str/char/byte/raw,
  `0b102` -> `IntTooLarge(2)`, doc-comment desugaring (`r###"..."###`), TokenCursor walk, gluing `<` + `=`.

## `unported(...)` left
- `rustc_ast::attr::Attribute::token_trees` (attr/mod.rs) - used by `attrs_and_tokens_to_token_trees`
  only when attributes are present.
- `rustc_ast::ast::YieldKind::expr` (classify `expr_trailing_brace`, `Yield` arm).
- `rustc_ast::ast::BinOpKind::{precedence,fixity,is_comparison}` (util/parser `AssocOp` methods, `Binary` arm).
  All are ast.rs/attr fns; replace the local stub helpers with the real calls once ported.

## PORT decisions
- Method placement: enum methods on companion consts redefined as `{ ...gen.X, methods }` (DocFragmentKind,
  InvisibleOrigin, Delimiter, LitKind, IdentKind, TokenKind, NonterminalKind, TokenTree, LazyAttrTokenStreamInner,
  AssocOp). Statics of generated classes (`Lit`, `Token`, `TokenStream`, `AttrTokenStream`, `LazyAttrTokenStream`,
  `NodeRange`, `WithTokens`, `TokenTreeCursor`, `TokenCursor`, `DelimSpan`, `DelimSpacing`, `MetaItemLit`) are assigned
  onto the generated class, and the hand module re-exports it as `export const X = gen.X as typeof gen.X & {...}` plus
  `export type X = gen.X`. Instance methods go on the prototype, declared via `declare module "./*.gen.ts"`.
  (TS cannot merge a namespace into a class from another file, so class statics cannot use the Span pattern.)
- `Cow<Token>` / `Cow<TokenTree>` -> the value itself; Borrowed returns `this`/`self`, so `r !== self` means Owned.
- `Token` is `Copy`: `TokenCursor.inlined_next_and_bump` returns a fresh `Token` (parser code mutates
  `next.0.span`). Tokens and TokenTrees inside streams are shared and must be treated as immutable.
- `Arc<Vec<_>>` -> arrays; `Arc::make_mut` -> `make_mut()` copies the array (refcounts are not tracked);
  `desugar_inner` copies once, then mutates (unique after the first make_mut, as upstream). `TokenStream::clone()`
  is `new TokenStream(ts._0)`. `EMPTY_TOKEN_STREAM`/`EMPTY_ATTR_TOKEN_STREAM` are shared empty arrays.
- `TokenStreamIter` is a hand class `{ _0: TokenTree[], pos }` with `next/peek/size_hint/clone`.
- `TokenStream::from_ast(node)` takes `(node, { tokens, attrs, debug })` because `HasTokens`/`HasAttrs` are not ported.
- `attrs.partition_point(..)` -> a linear scan (same result for partitioned attrs, which the parser always produces).
- LazyAttrTokenStreamInner Pending: the `once.chain(repeat_with).take(n)` iterator is a generator. The
  `#[cfg(debug_assertions)]` disjointness check is a comment.
- `ast::LitKind` has no companion in ast.ts, so util/literal.ts exports `LitKind` (type + `{ from_token_lit }`) and
  `MetaItemLit` (class with statics). Root may want to fold these into ast.ts / lib.ts.
- `u128::from_str_radix` -> local bigint helper (any ParseIntError maps to `IntTooLarge`, as upstream).
- Rust `str` helpers (`lines`, `trim`, `trim_start`, `eq_ignore_ascii_case`, `char/ascii::escape_default`) are local
  helpers with Rust semantics; candidates for `src/std/str.ts` (root-owned).
- `desugared_tts`: `num_of_hashes` masked to u8.
- `ExprPrecedence_discriminant` added (PartialOrd) in util/parser.ts.
- Derived `PartialEq` helpers: `TokenKind_eq`, `Token_eq`, `Lit_eq`, `LitKind_eq`, `Delimiter_eq`,
  `InvisibleOrigin_eq`, `MetaVarKind_eq`, `NtPatKind_eq`, `NtExprKind_eq` (token.ts).

## For root
- Side-effect import: `MetaItemLit.from_token_lit/from_token/as_token_lit` exist only after `util/literal.ts` is loaded.
  Consider `import "./util/literal.ts"` in `rustc_ast/lib.ts`.
- Generated types: no problems found.
- `bun` Bash tool note: heredocs passed through the Bash tool collapse `\\` to `\`; write scratch files with Write.

## Contract (public TS API for lexer/parser lanes)
| Upstream | TS |
|---|---|
| `Token::new/dummy/from_ast_ident` | `Token.new(kind, span)`, `Token.dummy()`, `Token.from_ast_ident(ident)` (token.ts) |
| `tok.is_ident()`, `tok.glue(&j)`, `tok == kind`, ... | prototype methods: `tok.is_keyword(kw.Fn)`, `tok.glue(j)`, `tok.eq(kind)`, `tok.ident(): [Ident, IdentKind] \| undefined`, `tok.uninterpolate()` |
| `TokenKind::Eq`, `token::Literal(lit)` | `TokenKind.Eq` (frozen singleton), `{ $: "Literal", _0: lit }`; `TokenKind.lit(k, sym, suffix)`, `TokenKind.open_delim(k)`, `TokenKind.break_two_token_op(k, n)` |
| `Lit::new`, `Lit::from_token`, `lit.is_semantic_float()`, `Display` | `Lit.new(..)`, `Lit.from_token(t)`, `lit.is_semantic_float()`, `display_Lit(lit)` |
| `LitKind::descr/article` | `LitKind.descr(k)`, `LitKind.article(k)` (token.ts) |
| `Delimiter::skip/as_open_token_kind` | `Delimiter.skip(d)`, `Delimiter.as_open_token_kind(d)`, `Delimiter_eq(a, b)` |
| `NonterminalKind::from_symbol` / Display | `NonterminalKind.from_symbol(sym, () => edition)`, `display_NonterminalKind`, `display_MetaVarKind` |
| `TokenTree::token_alone/span/eq_unspanned` | `TokenTree.token_alone(kind, sp)`, `TokenTree.span(tt)` (tokenstream.ts) |
| `TokenStream::new/token_alone/default/from_iter` | `TokenStream.new(tts)`, `TokenStream.default()`, `ts.len()`, `ts.get(i)`, `ts.iter()`, `ts.push_tree_with_gluing(tt)`, `ts.desugar_doc_comments()`, `ts.add_comma()` |
| `TokenCursor::new/inlined_next_and_bump/look_ahead` | `TokenCursor.new(ts)`, `cur.inlined_next_and_bump(): [Token, Spacing]`, `cur.look_ahead(n)`, `cur.depth()`, `cur.parent_delim_and_span()` |
| `LazyAttrTokenStream::new_direct/new_pending`, `AttrTokenStream::new` | same names as statics; `lazy.to_attr_token_stream()`, `ats.to_token_trees()` |
| `DelimSpan::from_single/from_pair/entire`, `DelimSpacing::new` | `DelimSpan.from_pair(o, c)`, `dspan.entire()`, `DelimSpacing.new(o, c)` |
| util/literal | `LitKind.from_token_lit(lit): Result<ast.LitKind, LitError>`, `display_LitKind`, `MetaItemLit.from_token_lit/from_token`, `escape_string_symbol`, `escape_char_symbol`, `escape_byte_str_symbol` |
| util/comments | `beautify_doc_string(sym, kind)`, `may_have_doc_links(s)` |
| util/unicode | `contains_text_flow_control_chars(s: string)`, `TEXT_FLOW_CONTROL_CHARS` (code points) |
| util/classify | `expr_is_complete`, `expr_requires_semi_to_be_stmt`, `leading_labeled_expr`, `expr_trailing_brace` |
| util/parser | `AssocOp.from_token(t)`, `AssocOp.precedence/fixity/is_comparison/is_assign_like`, `ExprPrecedence_discriminant`, `needs_par_as_let_scrutinee`, `contains_exterior_struct_lit` |
