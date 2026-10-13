# Handoff: mbe-a (wave 9, M2): macro_rules engine, part A

Branch `lane/mbe-a`. Merged `lane/expand-base` at 947a891, as the brief allows. The merge was clean. I use its generated `src/rustc_expand/diagnostics{,.gen}.ts`.

## Files
- **Ported:**
  - `src/rustc_expand/mbe.ts`
  - `src/rustc_expand/mbe/quoted.ts`
  - `src/rustc_expand/mbe/macro_parser.ts`
  - `src/rustc_expand/mbe/macro_check.ts`
  - `src/rustc_expand/mbe/metavar_expr.ts`
- **Test:** `src/rustc_expand/mbe/mbe_oracle.test.ts`, which has 145 oracle scenarios plus 1 PENDING-hygiene test.
- **Oracle:** `src/rustc_expand/mbe/mbe_oracle/`. It contains:
  - `main.rs` and `macro_rules.rs`, the probe sources
  - `cases.txt`
  - `out.json`
- The upstream files have no `#[cfg(test)]` tests or `tests.rs`, so there were none to port.

## Evidence
- **Coverage (`--missing`):**

  | file | fns ported |
  |---|---|
  | mbe.rs | 6/6 |
  | quoted.rs | 11/11 |
  | macro_parser.rs | 16/16 |
  | macro_check.rs | 13/13 |
  | metavar_expr.rs | 14/14 |

- `bun scripts/coverage.ts --check`: `markers ok (5236; vendor 2403)`.
- `bunx tsc --noEmit -p .` is clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=120000 src tools`: 2422 pass, 1 skip, 0 fail. This was run after the expand-base merge.
- **Entry points:** each of the five modules loads as the entry module.
- **Sample difftest:** see the end of this file. My code is not yet on the driver path, so the result is neutral.

## Oracle scenarios (all 145 match byte for byte; PENDING is empty)
**How the probe works.**
- rustc_expand's mbe internals are crate-private.
- So the probe compiles the *pinned upstream sources* of `mbe.rs`, `mbe/{quoted,macro_parser,macro_check,metavar_expr}.rs` and `diagnostics.rs` verbatim, against the nightly-2026-10-11 rustc-dev crates.
- `mbe/macro_rules.rs` is replaced by a driver. The driver holds verbatim copies of `Tracker`, `WhichMatcher`, `NoopTracker` and `parser_from_cx`.
- The build and run commands are in the header of `main.rs`.

**What a case runs.**
- Each case gets a real `Session` from `run_compiler`, with the case's edition and features.
- Output goes to a `-Zui-testing` `AnnotateSnippetEmitter`.
- The case's source is lexed into top-level trees, and then the ops run on them:
  - `lhs` / `rhs` / `args`: `parse_one_tt` → `{:?}` of the result
  - `check` / `checkd`: `check_meta_variables`
  - `locs`: `compute_locs`, giving Debug and Display of each loc
  - `count`
  - `match` / `matchr`: `TtParser::parse_tt` with a recording tracker. It records every `before_match_loc`, together with `has_no_remaining_items_for_step`, `matched_one`, `failure` and `ambiguity`. It also records the bindings in loc order, the final parser token, and whether the `Cow` was cloned.
  - `mve`: `MetaVarExpr::parse`
  - `lints`: buffered `META_VARIABLE_MISUSE` lints, rendered as warnings
- The TS test ports the driver. Events, the fatal flag and the whole stderr must be identical.

**What the cases cover.**
- `*`, `+` and `?` repetitions, including trailing-separator failure and multi-token, ident, raw and `$` separators.
- Nested repetitions at depths 2 and 3, mixed depths, and empty inner repetitions.
- Delimited matchers, doc comments in the matcher (ignored) and in the input, and lifetime/raw-ident `token_name_eq`.
- **Every fragment specifier:**
  - `ident`, `block`, `stmt`, `expr`, `pat`, `ty`, `lifetime`, `literal`, `path`, `meta`, `tt`, `item`, `vis`, `expr_2021`, `pat_param` and `guard`
  - per edition: `pat` in 2015, 2018 and 2021; `expr` in 2021 and 2024; keyword idents `async`, `dyn`, `try` and `gen` in 2015, 2018 and 2024
  - non-terminal parse errors with "while parsing argument for this … macro fragment", with recovery both Forbidden and Allowed
- **Local ambiguity**, in five shapes, plus failure at end of input and with extra input.
- **Missing, invalid and `$`-prefixed fragment specifiers.**
- `$$`, `${..}` and `$[..]` in both the LHS and the RHS; `$crate`; `$1`; a trailing `$`.
- **Kleene-operator errors.**
- **Every metavariable expression and its errors:** `count`, `ignore`, `index`, `len`, `concat` and `concat_str`, both feature-gated and enabled.
  - depth errors (literal, suffixed, float, above `usize`)
  - the `concat` errors (raw, int, suffix, comma, empty)
  - extra tokens and missing parens
- **`macro_check`:**
  - free variables (with `CRATE_NODE_ID` and with `DUMMY_NODE_ID`)
  - duplicate binders, including in attr-rule `args`
  - still-repeating and wrong-operator lints
  - nested `macro_rules!` and `macro` definitions (OK, free, duplicate lint, `$name` as the macro name, outer repetitions, trailing tokens after the macro)
  - metavariable expression occurrences

**One case left out.** `$($($a:ident)*)*` makes the real matcher loop forever. rustc rejects such a macro earlier, in `check_lhs` (mbe-b), so no case for it was added.

## Contract for mbe-b (and anyone using these types)
- **`mbe::TokenTree`.**
  - It is a `$`-tagged union: `Token{_0}`, `Delimited{_0: DelimSpan, _1: DelimSpacing, _2: Delimited}`, `Sequence{_0, _1: SequenceRepetition}`, `MetaVar{_0: Span, _1: Ident}`, `MetaVarDecl{span, name, kind}` and `MetaVarExpr{_0, _1}`.
  - Its methods are on the `TokenTree` companion: `is_delimited`, `is_token`, `span`, `token` and `meta_vars`.
  - `Delimited` and `SequenceRepetition` are interfaces.
  - `KleeneToken` is an immutable class, built with `KleeneToken.new(op, span)`.
  - `KleeneOp` is a string union.
  - `MetaVarExpr` and its companion (`parse`, `for_each_metavar`) are re-exported from `mbe.ts`.
- **`Cow<'_, Parser<'_>>` is `CowParser`.**
  - `CowParser.Borrowed(p)` and `CowParser.Owned(p)` construct it.
  - `get()` is the `Deref`.
  - `to_mut()` runs `clone_Parser` on first use.
  - `is_owned()` tells whether it has been cloned.
  - Call it as `tt_parser.parse_tt(CowParser.Borrowed(parser), locs, track)`.
- **`NamedMatches = MacroRulesIdentMap<NamedMatch>`.**
  - It provides `get`, `insert` (which returns the old value), `contains_key`, `remove`, `len`, `is_empty` and `iter`.
  - It is keyed like `Ident`'s `Hash`/`Eq`: name plus `SyntaxContext`.
  - **Caveat:** `iter()` is insertion order, not hashbrown order. transcribe.rs `interp.iter()` feeds `find_best_match_for_name` candidate lists, so mbe-b must check whether that order can show.
- **`Tracker`** in macro_parser.ts is the part of the trait the matcher calls: `before_match_loc(TtParser, MatcherLoc)`, `matched_one(Parser, idx)`, `failure(Parser)` and `ambiguity(Parser)`. macro_rules.ts' full trait is structurally assignable to it.
- **`MatcherLoc` values are fresh objects per entry**, so identity works with `indexOf`. `MatcherLoc.Eof` is a shared singleton, used only for the final entry. `MatcherLoc_eq` is the derived `PartialEq` (used by mbe/diagnostics.rs). `display_MatcherLoc` is the `Display` impl, and `MatcherLoc.span(loc)` is the method.
- **Other helpers:**
  - `NamedMatch.is_repeatable(m)`
  - `clone_NamedMatch`
  - `debug_NamedMatch`
  - `debug_ParseResult(v, f, debug_T)`
  - the `Failure` and `Ambiguity` singletons
  - `compute_locs`, `count_metavar_decls`
  - `RulePart`, `parse_one_tt`, `VALID_FRAGMENT_NAMES_MSG`
  - `UNSUPPORTED_CONCAT_ELEM_ERR`, `validate_ident_kind`
  - `check_meta_variables`

## PORT decisions (please record)
1. **`Rc<Vec<NamedMatch>>`** in `MatcherPos` is a plain array that is never mutated in place once shared.
   - `Rc::make_mut` in `push_match` copies the outer array and the `MatchedSeq` arrays on the path being changed.
   - Rust skips that copy only when nothing else can observe the vector, so every matcher position sees the same values.
   - `Rc::unwrap_or_clone` reads the array.
2. **`Cow<Parser>`, `FxHashMap<MacroRulesNormalizedIdent, _>` and `Tracker`** are handled as described in the contract above. `MacroRulesIdentMap` is a local helper class in macro_parser.ts.
3. **macro_check's `Stack<'a, T>`** (a linked list over references) is a `$` union with an `iter()` cursor. `impl Iterator for &Stack` is `StackIter.next`, with its marker. `From<&Stack<KleeneToken>> for SmallVec` is `kleene_ops_from`, with its marker. `SmallVec` is an array. The `&mut Option<ErrorGuaranteed>` parameter `guar` is a `MutRef`.
4. **`match (state, tt)` in `check_nested_occurrences`** is an if-chain in arm order. A failing guard falls through to the next arm, as in Rust.
5. **Derives.**
   - `Debug` is hand-written for every mbe type.
   - `PartialEq` is written only where it is used: `MatcherLoc_eq`, plus a local `NonterminalKind_eq`.
   - `Clone` is written only for `NamedMatch` (`clone_NamedMatch`), because rustc_expand had no types codegen set for mbe.
   - `Encodable` and `Decodable` (metadata) are not ported.
   - The `static_assert_size!` and `debug_assert!` lines are kept as comments.
6. **Copies of `Copy` AST objects** go through `clone_Token`, `clone_DelimSpan` and `clone_DelimSpacing`, following PORTING §8. This applies in `quoted::parse_tree`, `parse_kleene_op` and `compute_locs`.
7. **`usize` depth** in `metavar_expr::parse_depth` is a JS number. The `usize::try_from` bound is 2^64−1 (a 64-bit target). A value between 2^53 and 2^64 calls `unported(...)` rather than lose precision.
8. **`VALID_FRAGMENT_NAMES_MSG`**: Rust's `\`-newline string continuations are written as a concatenation.
9. **`pub(crate) use NamedMatch::*` / `ParseResult::*`** have no glob counterpart. Write the variants as object literals; `Failure` and `Ambiguity` are exported singletons.

## `unported(...)` left
- `rustc_expand::mbe::metavar_expr::parse_depth (usize > 2^53)`. This is only reached by depth literals between 2^53 and 2^64.

## For root
- **Disk is nearly full.** `/System/Volumes/Data` had 2.4–3.4 GB free during this lane. One full `bun test` run hit ENOSPC in other suites' scratch dirs (rustc_feature and codegen oracles). The rerun passed once space was freed elsewhere.
- **mbe-b** should now drop its own pending shims for my types and for expand-base's diagnostics, and wire `lib.ts` `compile_declarative_macro`.
- Delete `docs/claims/wave9-mbe-a.md` on integration.

## Sample difftest
`RUST_TS_AGENT=mbe-a bun scripts/difftest.ts --suite parse --sample 200`: 199 MATCH, 0 DIFF, 0 UNPORTED, 0 CRASH, 0 TIMEOUT, and 1 ORACLE_TIMEOUT. The subject was ok on that case. Run `20261013-091207-mbe-a-hch5`. This lane's code is not on the driver path yet, so the result is neutral, as expected.
