# Handoff: parser-core (wave 6b porter, first of the parser chain)

Branch `lane/parser-core` (main merged at 0739887, no conflicts).

This lane did three things:
- It wrote the shared `Parser` contract (`parser/decls.ts`).
- It generated the parser types and created a stub module for every parser file.
- It ported `parser/{mod,token_type,attr,attr_wrapper,nonterminal}.rs` and `rustc_parse/src/lib.rs`.

## Pin facts that differ from the brief
- `parse_cfg_attr` is not in `lib.rs` at the pin. It has 13 fns, and all 13 are ported.
- `TokenCursor`, `ParserRange`, `NodeRange` and `LazyAttrTokenStream::new_pending` live in `rustc_ast::tokenstream`, which is already ported.
- `parser/tokenstream/tests.rs` (116 lines, `#[cfg(test)] mod tokenstream { mod tests; }` in mod.rs) is not ported. It belongs to the final lane, together with tests.rs.
- `exp!(Pin)` has two macro arms. The first wins, so `exp!(Pin)` is `{ kw: kw::Pin, token_type: KwMut }`. This is ported as upstream.
- `from_u32_match!` omits `SymBikeshed` and `SymPin`. This is ported verbatim, so `TokenType::from_u32` panics on those two values, as upstream does.

## Files
- **Generated, by `bun tools/codegen/types.ts rustc_parse`.** These are `.gen.ts` modules for mod, token_type, attr, attr_wrapper, diagnostics, expr, expr/diagnostics, pat, path, ty, generics, item, function, asm and cfg_select. nonterminal.rs and stmt.rs have no types.
  - There are 393 types, 23 Debug fns and 38 clone fns.
  - `src/rustc_parse/diagnostics.gen.ts` changed only by gaining `clone_*` fns, because the set now has `derive_clone`.
- **Ported (hand):**
  - `src/rustc_parse/parser/mod.ts`. The `Parser` class, `clone_Parser`, the `SeqSep` statics, `Trailing.from`, `token_descr` and every mod.rs method.
  - `token_type.ts`. The `TokenType` companion, `exp`, `TokenTypeSet` and `TokenTypeSetIter`.
  - `attr.ts`, `attr_wrapper.ts`, `nonterminal.ts`.
  - `src/rustc_parse/lib.ts`. All of lib.rs, plus the module wiring.
- **Contract:** `src/rustc_parse/parser/decls.ts`.
- **Stubs, for the owning lanes:**
  - `parser/{diagnostics,expr,expr/diagnostics,pat,path,ty,generics,stmt,item,function,asm,cfg_select}.ts`.
  - `src/rust_ts/stubs.ts`, which provides `unported_methods`.
- **Tests:**
  - `parser/parser_core.test.ts` and its fixture `parser_core_oracle.json`.
  - `parser/tests.test.ts`.
- **tools:** see "Tools changes" below.

## Evidence
- **Typecheck:** `bunx tsc --noEmit -p .` is clean.
- **Unit tests:** `RUST_TS_REQUIRE_PROBES=1 bun test src tools` gives 0 fail, 1 skip (pre-existing) and 48 todo; 924 tests in total. One earlier run had a single failure that did not reproduce in three later runs. It looked like a timing flake outside `rustc_parse`, so the log was not kept.
- **Coverage check:** `bun scripts/coverage.ts --check` reports `markers ok (2875; vendor 2173)`.
- **Coverage, file by file (`--missing`):**

  | file | fns ported |
  |---|---|
  | parser/mod.rs | 90/90 |
  | token_type.rs | 10/10 |
  | attr.rs | 12/12 |
  | attr_wrapper.rs | 9/9 |
  | nonterminal.rs | 4/4 |
  | lib.rs | 13/13 |
  | tests.rs | 24/75 (helpers + 6 tests) |

- **Difftest sample:** `RUST_TS_AGENT=parser-core bun scripts/difftest.ts --suite lex --sample 200` gives 200/200 MATCH (run `20261013-001232-parser-core-aipr`).
- **Entry points:** every module in `src/rustc_parse/parser/` and `src/rustc_parse/lib.ts` loads as an entry point. With `lib.ts` loaded, all 560 methods declared in decls.ts exist on `Parser.prototype`, checked at runtime.

## Tests and how the expectations were obtained
- **`parser_core.test.ts`: 33 oracle cases plus 9 expected-token-set checks.**
  - **Oracle.** A rustc-dev probe against `nightly-2026-10-11`. Its source is in the fixture's `_probe` field, the cases are in `_cases`, and `_how` gives the build and run commands. The scratch copy is in `$RUST_TS_DATA/tmp/parser-core/probe/`.
  - **What the probe does.** It parses each case as `t.rs` (edition 2024, `new_parser_from_source_str`, `StripTokens::Nothing`). It then runs an op script against the real `Parser`: `tok`, `bump`, `look:N`, `check:T`, `eat:T`, `ekw:K`, `expect`, `expect_kw`, `unexpected`, `tt`, `tts`, `ident`, `field_name`, `inner_attrs`, `attr`, `item_attrs` and so on.
  - **What must match.** The Debug of every result, and the `-Zui-testing` stderr, byte for byte.
  - **What the cases cover:**
    - flat and nested cursors, including look-ahead across delimiters, past Eof and after Eof
    - glued tokens, doc comments, literals, raw idents, lifetimes and `k#`
    - an empty file
    - check/eat bookkeeping
    - `parse_token_tree` / `parse_tokens` on flat and delimited input, and from inside a delimiter
    - `parse_ident`, `parse_field_name`, `expect`, and inner doc-comment attributes
  - **Negative control.** Corrupting every expectation fails all 18 non-pending cases.
  - **PENDING.** These cases throw exactly the listed `Unported` until the owning lane lands; then they must match, and root deletes them from `PENDING`:
    - 7 `expect*` cases, through `diagnostics::expected_one_of_not_found`
    - `expect_single` and `attr_shebang_like`, through `unexpected_err`
    - the 4 `attr_*` cases, through `path::parse_path`
    - the 2 `outer_attrs_*` cases, through `item::parse_item`
  - **Expected-token-set checks.** While those cases are pending, these checks verify the part this lane owns. They take the `TokenTypeSet` at the failure point, sort, dedup and join it the way `expected_one_of_not_found` does (test-side copy), add `token_descr`, and compare the result with the oracle's first stderr line ("expected one of `)`, `,`, `.`, or `;`, found `foo`").
- **`tests.test.ts`** (upstream tests.rs). It contains:
  - every helper, with markers
  - the upstream tests `look_ahead`, `look_ahead_non_outermost_stream`, `debug_lookahead` (byte-exact `{:#?}`), `eqmodws`, `pattern_whitespace` and `non_pattern_whitespace`
  - the other 48 tests listed as `test.todo`, in upstream order. The 37 `test_harness` emitter tests need only the emitter, so the final lane can port them right away.

## Contract rules for the follow-on lanes
1. **Where the declarations live.** Every method of every `impl Parser` block is declared once, in `src/rustc_parse/parser/decls.ts`, inside `declare module "./mod.ts" { interface Parser { .. } }`. The methods are grouped by file in upstream order, and each carries `// <file>:<line>`.
   - The signature rules are in that file's header. In short:
     - `PResult<T>`; `()` becomes `undefined`.
     - `Box`/`&` are erased; `&[T]` becomes `readonly T[]`.
     - `MutRef<T>` replaces `&mut` parameters that the callee overwrites as a whole: `check_mistyped_turbofish_with_multiple_type_params(expr)`, `parse_impl_ty`/`parse_dyn_ty(impl_dyn_multi)`, `parse_fn_body(sig_hi)` and `parse_item_kind(def)`.
     - `Option<Option<T>>` becomes `{ $: "Some"; _0 } | undefined`.
     - Closures become `(this_: Parser, ..) => R`.
     - Trait bounds become trailing impl tables: `R_HasTokens: HasTokens<R>, R_HasAttrs: HasAttrs<R>` for `collect_tokens*`, and `T_RecoverQPath: RecoverQPath<T>` for the bad-qpath fns.
   - Do not redeclare methods in your file.
2. **How to fill a stub file.**
   - Each stub file imports `Parser` from `./mod.ts` and re-exports its `.gen.ts`. It also holds the companions and free fns other files use, with `unported(..)` bodies and no markers, and calls `unported_methods(Parser.prototype, "<mod path>::Parser", [..names..])`.
   - To port a method, write `Parser.prototype.<name> = function (this: Parser, ..) { .. }` with its `// rustc:` marker, in upstream order, and delete its name from the `unported_methods` list. When the list is empty, delete the call.
   - Fill the companion and free-fn stubs in place, adding markers. Their signatures are part of the contract: `RecoverQPath` (trait table), `AttemptLocalParseRecovery.yes/no`, `dummy_arg`, `Expected.to_string_or_fallback`, `make_all_value_bindings_mutable`, `PathStyle.has_generic_ambiguity`, `RecoverReturnSign.can_recover`, `mk_token_lit_char`, `mk_meta_item_lit_char`, `could_be_unclosed_char_literal`, `op_can_continue_stmt_expr_unambiguously`, `field_def_extras`, `ReqName`/`clone_ReqName`, `AsmAttrVec.parse`, `parse_asm_args`, and `Bound<T>` (in expr.ts).
3. **Associated fns without `self`.** These are module-level functions of their file, following the pprust-ei precedent: `nonterminal_may_begin_with` in nonterminal.ts, `mk_token_lit_char` and `mk_meta_item_lit_char` in expr.ts, `make_all_value_bindings_mutable` in pat.ts, and `field_def_extras` in item.ts. `Parser.new` is a static.
4. **A missing or wrong declaration.** decls.ts is root's from now on. Write the needed change in your handoff (signature plus reason); do not edit decls.ts. If a lane cannot type-check without the change, it may add a local `declare module "./mod.ts"` augmentation in its own file, marked `// PORT(decls): pending root`, and list it in its handoff.
5. **Init order.** Breaking these rules gives a TDZ `ReferenceError` at load.
   - `parser/mod.ts` must never import a parser extension module (any file with an `impl Parser` block) at runtime, not even through `export .. from`. It may import `.gen.ts` modules and `token_type.ts`, and may use `import type` from anything. It takes `AttrWrapper` from `attr_wrapper.gen.ts`; its statics are attached later by attr_wrapper.ts.
   - Extension modules may import each other freely. Their **top-level code** may touch only `Parser` (from `./mod.ts`), their own `.gen.ts`, and non-parser modules. For example, `export const X = { ...gen.X, .. }` is fine; reading another extension module's export at top level is not.
   - `rustc_parse/lib.ts` imports `rustc_ast/lib.ts`, then `lexer/mod.ts`, then `lexer/tokentrees.ts`, then `parser/mod.ts`, then every parser extension file. Consumers outside the crate import `rustc_parse/lib.ts` only (PORTING §8).
6. **`Parser` facts.**
   - The fields keep their upstream names, except that `recovery` is `recovery_` (it clashes with the `recovery()` builder).
   - Clone a parser with `clone_Parser(p)`, which upstream is `self.clone()`. `SnapshotParser` is `{ parser: Parser }`; Deref is written out as `snapshot.parser.x()`. For `restore_snapshot`, `*self = snapshot.parser` should be `Object.assign(this, snapshot.parser)`, with a PORT note (diagnostics lane).
   - `exp!(X)` is `exp.X`, from token_type.ts. `self.token == tok` is `this.token.eq(tok)`. Never mutate a `Token` in place; build a new one. Use `clone_Token` where Rust copies a token into a stored structure.
7. **Test helper API.** These are in `parser/tests.test.ts`, under the upstream names: `filename`, `string_to_parser`, `create_test_handler` (returns `[DiagCtxt, SourceMap, VecU8]`), `with_error_checking_parse`, `with_expected_parse_error`, `string_to_stream`, `matches_codepattern`, `test_harness`, `make_span`, `make_pos`, `parse_item_from_source_str`, `sp`, `string_to_expr`, `string_to_item` and `look`. For new oracle cases, extend the probe's op set or `cases.txt`, re-run the probe and regenerate `parser_core_oracle.json`; the fixture's `_how` has the commands.

## `unported(...)` left (own files)
- `lib.ts io_error_kind`: `std::io::Error::kind` (`decode_error_kind`) for OS errors. It is needed by `new_parser_from_file`'s error messages ("couldn't find file", ...).
- `lib.ts from_utf8_error`: `core::str::from_utf8` (`Utf8Error`).

Both belong in `src/std` (root/std lane). They are reached only on the error path of `new_parser_from_file`.

Indirect: `fake_token_stream_for_*` reach `FileName.macro_expansion_source_code`, which is unported in rustc_span (StableHasher). The parser paths reach the stubs listed above.

## PORT decisions (please record)
1. **The contract design.** All `impl Parser` methods are declared in `parser/decls.ts`, and per-file stubs hold `unported_methods` placeholders (`src/rust_ts/stubs.ts`). The contract rules 1 to 6 above.
2. **The init-order rule** in contract rule 5. `mod.ts` takes generated companions and classes from `.gen.ts`, and does not mirror `pub mod attr/asm/cfg_select` or the `pub use` re-exports of extension modules.
3. **`TokenTypeSet(u128)` is four u32 words (`w0..w3`), not a `bigint`.** This is the hottest parser path. It keeps the same bit layout and iteration order, and every Rust copy is `clone()`.
4. **`exp!` is the frozen table `exp`.** First-arm-wins for `Pin`. `from_u32_match!` is a list scan (`FROM_U32_LIST`).
5. **`Parser` is hand-written** (`hand` in the codegen set), with a constructor taking all fields in order. The `..` default field values are written out in `Parser.new`. `clone_Parser` is hand-written; it deep-copies the token cursor, capture state and expected set, and shares `psess` and tokens.
6. **`IntervalSet<AttrId>` is `Set<AttrId>`.** The parser uses only `new`, `insert` (newly inserted) and `clear`. Its Debug is not wired.
7. **`debug_lookahead` returns the `fmt::from_fn` closure as `(f: Fmt) => string`.** `DebugStruct::finish_non_exhaustive` is a local helper in mod.ts; it belongs in std/fmt.ts.
8. **Local helpers in mod.ts:** `eq_ignore_ascii_case`, and `char_is_uppercase`/`char_is_lowercase`, which use `\p{Uppercase}`/`\p{Lowercase}` and are applied only to ASCII keywords. Both are candidates for std.
9. **`AttrWrapper::prepend_to_nt_inner(attrs: &mut AttrVec)`** edits the caller's array in place, so `attrs` becomes `self.attrs` followed by the old contents.
10. **`span_delayed_bug(.., "no close delim with reparsing {mv_kind:?}")`** is not a `format!`, so the literal text is kept.
11. **lib.rs:**
    - `Path` is a string; `path.display()` is the identity.
    - `read_dir`/`fs::read` use `node:fs`.
    - `String::from_utf8_lossy` is WHATWG `TextDecoder`.
    - `lex_token_trees_for_span`'s lazy `map_while` iterator is collected eagerly into an array.
    - The `const _: ()` Unicode-version check has no runtime counterpart.
12. **`Utf8Error`** is an interface in lib.ts (`valid_up_to()`, `error_len()`).

## Tools changes (for root review; all additive and output-neutral for existing sets)
- **`tools/probes/typedefs/main.rs`.** syn 2.0.117 cannot parse default field values (`field: T = expr`, used by parser/mod.rs, stmt.rs and rustc_session/session.rs). The probe now blanks them out before parsing (same byte length, so spans are unchanged) and reports each field's `default` text. I rebuilt it. Its JSON for the rustc_ast, rustc_lexer, rustc_errors, rustc_span, rustc_session, rustc_lint_defs and rustc_parse diagnostics files is identical to before, except that `rustc_session/src/session.rs` now parses (it used to fail).
- **`tools/codegen/macros.ts`.** The `bitflags!` and newtype bodies may now contain `{`, `}` and `;` inside `///` doc lines, which `Restrictions` needs.
- **`tools/codegen/types.ts`.** A `hand` type alias is only re-exported; its body is no longer emitted twice. Its clone uses `clone_<Alias>` from the hand module. Hand types referenced by generated clones are no longer reported as missing.
- **`tools/codegen/types.sets.json`.** The `rustc_parse` set now covers all parser files. It has an explicit `class` list, `hand` (Parser, TokenTypeSet, TokenTypeSetIter, ReqName), `discriminant` (TokenType) and `derive_clone`. `hand_notes` is documentation only.
- **New `tools/codegen/typemap.parse.json`.** It maps the rustc_ast types used by parser structs (`Item<K>` with `ItemKind`), the token/tokenstream types, and `IntervalSet` to `Set`. It adds a Clone for `Token` (share) and `MetaVarKind`.

## For root
1. **Record the decisions** above (1 to 12), and update docs/next.md for the follow-on parser lanes, pointing them at the contract rules.
2. **Finding, outside this lane.** `rustc_ast/tokenstream.ts` `TokenCursor.clone_enclosing_delim` returns the shared tree, but upstream it `.clone()`s. Given the new PORTING §8 rule on copies of AST objects, it should be `clone_TokenTree(..)`. `parse_token_tree` (and `DelimArgs`) inherit the shared `DelimSpan`.
3. **std candidates:**
   - `io::Error::kind` / `decode_error_kind`
   - `str::from_utf8` → `Utf8Error`
   - `ops::Bound`, currently in the expr.ts stub
   - `DebugStruct::finish_non_exhaustive`
   - `eq_ignore_ascii_case`
   - `char::is_uppercase` / `char::is_lowercase`
4. **Rebuild the shared typedefs probe from main after merging.** `$RUST_TS_DATA/target/probes` now holds this lane's build, which is output-identical for the existing sets.
5. **When later lanes land,** delete from `PENDING` in `parser_core.test.ts` each case that starts to match. The test fails until you do, so nothing passes silently.
6. Delete `docs/claims/wave6b-parser-core.md` on integration.
