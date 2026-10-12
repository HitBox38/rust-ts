# Handoff: ast-attr (rustc_ast attr/mod.rs, rustc_ast_ir lib.rs, attr stubs, LitKind fold)

## Files touched
- `src/rustc_ast/attr/mod.ts`: all 114 fns of attr/mod.rs (was a re-export stub).
- `src/rustc_ast_ir/lib.ts`: the 19 remaining fns of rustc_ast_ir/src/lib.rs (`IntTy/UintTy/FloatTy::{name, bit_width,
  normalize, to_unsigned/to_signed}`, `Mutability::{invert, prefix_str, ref_prefix_str, ptr_str, mutably_str, is_mut,
  is_not}`, `Pinnedness::{is_pinned, prefix_str}`) plus the derived-`Ord` helper `Mutability_cmp`.
- `src/rustc_ast/ast.ts`: removed the 4 rustc_ast_ir stubs and `Mutability_min` (now `Mutability.*`, `Pinnedness.prefix_str`,
  `Mutability_cmp`); `FnDecl::splatted` calls `attr.has_name(sym.rustc_splat)`; `AttrArgs::inner_tokens` uses
  `HasTokens.Expr.tokens` / `HasAttrs.Expr.attrs` (ast-core item 6); companion hooks `MetaItemKindExt`,
  `MetaItemInnerExt` (+ a new `MetaItemInner` companion) and `LitKindExt` (see PORT decisions).
- `src/rustc_ast/util/literal.ts`: `LitKind::from_token_lit` is now attached onto the one ast.ts `LitKind` companion
  (ast-core "For root" 5); literal.ts re-exports that same value as `LitKind` for existing importers.
- `src/rustc_ast/tokenstream.ts`: the `Attribute::token_trees` stub is gone (`attr.token_trees()`, 2 call sites).
- `src/rustc_ast/lib.ts`: `import "./attr/mod.ts"` in the extension-module list; `pub use ast_traits::{HasAttrs,
  HasNodeId, HasTokens}` completed (ast-visit "For root" 4, it was a stub comment in lib.ts).
- New tests: `src/rustc_ast/attr/mod.test.ts` (9 tests, 123 expects) with oracle fixtures
  `src/rustc_ast/attr/testdata/{attrs.rs, attrs.ast-tree.txt}`.

## Coverage (`bun scripts/coverage.ts --missing <file>`)
attr/mod.rs 114/114, rustc_ast_ir/src/lib.rs 25/25 (also unchanged: ast.rs 160/160, util/literal.rs 13/13,
tokenstream.rs 64/64). `coverage --check`: markers ok (2084; vendor 1774).

## Checks
- `bunx tsc --noEmit -p .` clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 416 pass, 1 skip (pre-existing, also on main), 0 fail.
- `RUST_TS_AGENT=ast-attr bun scripts/difftest.ts --suite lex --sample 200`: 200/200 MATCH (run 20261012-213128-ast-attr-yljr).
- Fresh-process entry loads OK: rustc_ast/{attr/mod, ast, tokenstream, util/literal, lib, ast_traits, token}, rustc_ast_ir/lib.

## Tests and how the expectations were obtained
Oracle = `rustc 1.101.0-nightly (6f5da406b 2026-10-10)` (`+nightly-2026-10-11`).
- `testdata/attrs.ast-tree.txt` is verbatim `rustc -Zunpretty=ast-tree attrs.rs` (9 attributes: inner `#![allow(..)]`,
  `doc(alias = "foo", hidden)`, `a::b = "v"`, `deprecated(note, since)`, `x(1, true, ::p::q(r), s = 2u8)`, `///`, `/** */`,
  `#[doc = "raw doc"]`, `w(y("z"))`). The test reads each attribute's token stream from the dump, rebuilds the attribute
  with the port (path and span from `MetaItem::from_tokens`, `mk_attr_from_item` / `mk_doc_comment`, ids from
  `AttrIdGenerator`) inside a session whose source map holds attrs.rs, and requires `debug_Attribute(.., PRETTY)` to equal
  the oracle block byte for byte (all 9 match). Nested meta item spans are checked against the oracle token spans
  using upstream's rule (mod.rs:530-537).
- `mk_attr_word` / `mk_attr_nested_word` / `mk_attr_name_value_str`: excerpts of
  `rustc --test -Zunpretty=ast-tree,expanded t.rs` (`#[rustc_main]`, `#[coverage(off)]`, `#[rustc_test_marker = "t"]`,
  built by the test harness via these fns), compared after normalizing `#N` contexts, `NodeId`s and `AttrId`s.
- Inner-style `mk_attr_tokens`: the token frame (`#` Joint, `!` JointHidden, `[..]` {JointHidden, Alone}) matches the
  oracle's lexing of `#![no_std]`.
- Also covered: `name_value_literal(_span)`, `value_str`, `value_as_str`, `meta_item_list`, `singleton_lit_list`,
  `boolean_literal`, `meta_item_or_bool`, `is_doc_comment`, `doc_str(_and_fragment_kind)`, `doc_resolution_scope`,
  `is_doc_hidden`, `deprecation_note`, `path`/`path_matches`/`has_any_name`, `filter_by_name`, `find_by_name`,
  `first_attr_value_str_by_name`, `contains_name`, `list_contains_name`, `MarkedAttrs`, `convert_normal_to_synthetic`,
  rejected `from_tokens` inputs and the delimiter-token panic message.

## `unported(...)` left
None in the touched files. Removed: `rustc_ast::attr::Attribute::has_name` (ast.ts), `Attribute::token_trees`
(tokenstream.ts), `rustc_ast_ir::{Mutability::prefix_str, ref_prefix_str, ptr_str, Pinnedness::prefix_str}` (ast.ts).

## PORT decisions (please record)
- attr/mod.ts is an extension module for ast.rs types: `impl Attribute/AttrItem/MetaItem/MetaItemLit` go on the
  generated prototypes (`declare module "../ast.gen.ts"`); `impl MetaItemKind` / `impl MetaItemInner` are assigned onto
  the ast.ts companions and declared through the empty interfaces `MetaItemKindExt` / `MetaItemInnerExt` that ast.ts
  exports (module augmentation from attr/mod.ts). `MetaItemInner` had no companion; ast.ts now has one. The same
  pattern folds `LitKind`: ast.ts's companion is `LitKind_ as typeof LitKind_ & LitKindExt`, literal.ts augments
  `LitKindExt` and assigns `from_token_lit`. Proposed as the general pattern for enum methods defined in another file.
- `Attribute`'s inherent `id()`, `span()`, `style()` collide with its fields: `id_()`, `span_()`, `style_()`
  (rustc_errors `level_()` convention).
- `AttributeExt`: interface over `T` + table `AttributeExt.Attribute` (ast-visit representation). Provided methods
  (`has_name`, `has_any_name`, `path`, `is_proc_macro_attr`) live in `AttributeExt_provided(impl)`, which completes an
  impl object and dispatches `self.m()` through it; their markers sit there, the required methods' markers sit on the
  interface members. Inherent `Attribute` fns forward to `AttributeExt.Attribute.*` as upstream does.
- Private fns (`MetaItem::from_tokens`, `AttrItem::{value_str, value_span}`, `MetaItemKind::{name_value_from_tokens,
  from_tokens, from_attr_args}`, `MetaItemInner::from_tokens`, `mk_attr_tokens`) are attached/defined like public ones
  (`mk_attr_tokens` is not exported).
- `GrowableBitSet<AttrId>` -> `Set<AttrId>` (generated type); `AtomicU32` -> number (`fetch_add` wraps with `>>> 0`).
- `impl Iterator` (`filter_by_name`) -> a generator; `SmallVec`/`ThinVec` -> arrays; `Option<(A, B)>` -> `[A, B] | undefined`.
- `TokenStream::clone()` -> `new TokenStream(ts._0)` (tokenstream.ts convention); `Cow<TokenTree>` via `TokenTree.uninterpolate`.
- `cmp::min(old_mutbl, mutbl)` -> `Mutability_cmp(mutbl, old_mutbl) < 0 ? mutbl : old_mutbl` (Rust's `min` keeps the
  first argument on ties); `Mutability_cmp` uses the generated `Mutability_discriminant`.
- rustc_ast_ir `bit_width: Option<u64>` -> `number | undefined`; `normalize(target_width: u16)` -> number.
- attr/mod.ts mirrors `pub mod data_structures; pub mod version;` as `export * as data_structures/version`.

## For root
1. ast.ts edits beyond single-call stub swaps (needed for the companions and the LitKind fold): the three `*Ext`
   interfaces, `MetaItemKind`/`MetaItemInner` companions, `LitKind_` rename. Please review/accept the pattern.
2. Extension-module loading: `Attribute.prototype.has_name` / `.token_trees` (used by ast.ts `FnDecl::splatted` and
   tokenstream.ts `attrs_and_tokens_to_token_trees`) and `LitKind.from_token_lit` exist only once `rustc_ast/lib.ts`
   (or attr/mod.ts / util/literal.ts) is loaded; otherwise the call is a TypeError, not `Unported`. Drivers and later
   lanes should import `rustc_ast/lib.ts` (pre-existing situation for literal.ts).
3. tokenstream.ts `FromAstNode<N>` still says the traits are unported; it could take `HasTokens<N>` + `HasAttrs<N>`
   impl objects directly (ast-visit "For root" 5). Not changed (API change outside my single-call scope).
4. New test fixture directory `src/rustc_ast/attr/testdata/` (oracle input + verbatim dump, 42 KB), same idea as
   `src/vendor/fluent_bundle/testdata/`. Regenerate with
   `rustc +nightly-2026-10-11 -Zunpretty=ast-tree attrs.rs > attrs.ast-tree.txt` inside that directory.
5. Delete `docs/claims/ast-attr.md` (if present) when integrating.

## Contract (public TS API)
| Upstream | TS |
|---|---|
| `MarkedAttrs::{new, mark, is_marked}`, `AttrIdGenerator::{new, mk_attr_id}` | `MarkedAttrs.new()`, `m.mark(a)`, `m.is_marked(a)`; `AttrIdGenerator.new()`, `g.mk_attr_id()` (attr/mod.ts) |
| `attr.get_normal_item()`, `convert_normal_to_synthetic`, `style()`, `may_have_doc_links`, `meta`, `meta_kind`, `token_trees`, `deprecation_note` | prototype methods; `style()` is `attr.style_()` |
| inherent `Attribute::{id, name, meta_item_list, value_str, value_span, path_matches, is_doc_comment, has_name, has_any_name, span, is_word, path, doc_str, is_proc_macro_attr, doc_str_and_fragment_kind}` | prototype methods; `id_()`, `span_()` |
| `AttributeExt` (trait; e.g. `is_doc_hidden`, `symbol_path`, `path_span`, `doc_resolution_scope`) | `AttributeExt.Attribute.<fn>(attr, ..)`; type `AttributeExt<T>` |
| `AttrItem::{name, meta_item_list, meta, meta_kind}` | prototype methods |
| `MetaItem::{ident, name, has_name, is_word, meta_item_list, name_value_literal, name_value_literal_span, value_str}` | prototype methods |
| `MetaItemKind::list_from_tokens` (and private `from_tokens`, ...) | `MetaItemKind.list_from_tokens(ts)` (ast.ts companion) |
| `MetaItemInner::{span, ident, name, has_name, is_word, meta_item_list, singleton_lit_list, name_value_literal_span, value_str, lit, boolean_literal, meta_item_or_bool, meta_item, is_meta_item}` | `MetaItemInner.<fn>(item, ..)` (ast.ts companion) |
| `MetaItemLit::value_as_str` | `lit.value_as_str()` |
| `mk_doc_comment`, `mk_attr_from_item`, `mk_attr_word`, `mk_attr_nested_word`, `mk_attr_name_value_str`, `filter_by_name`, `find_by_name`, `first_attr_value_str_by_name`, `contains_name`, `list_contains_name` | same names (attr/mod.ts); `filter_by_name` returns a generator |
| `LitKind::from_token_lit` | `LitKind.from_token_lit(lit)` on the ast.ts companion (also re-exported by util/literal.ts) |
| rustc_ast_ir `IntTy/UintTy/FloatTy::{name, bit_width, normalize, to_unsigned, to_signed}`, `Mutability::*`, `Pinnedness::*` | `IntTy.name(t)`, ..., `Mutability.prefix_str(m)`, `Pinnedness.prefix_str(p, m)`, `Mutability_cmp(a, b)` |
