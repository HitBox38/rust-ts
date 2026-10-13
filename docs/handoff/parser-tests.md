# Handoff: parser-tests (wave 6c)

Branch `lane/parser-tests`. Only `src/rustc_parse/parser/tests.test.ts` was touched; this file was added.

## What was done
All 48 remaining `#[test]` bodies of `compiler/rustc_parse/src/parser/tests.rs` are now ported, in upstream order and with markers. With the 6 tests that parser-core ported, all 54 upstream tests are in the file. The helpers `get_spans_of_pat_idents`, its `PatIdentVisitor::visit_pat`, and the nested `parse_expr_from_source_str` (inside `ttdelim_span`) are ported as well.

**The PENDING convention changed.** The old `PENDING_TESTS`/`PORTED_TESTS` name lists are gone. In their place:
- Every upstream test is registered with `upstream_test(name, body)`.
- `PENDING: Record<test, unported>` lists the tests that wait on another lane. Each one must throw exactly the listed `Unported`. Any other outcome fails, and that includes passing.
- The list check now requires the registered names to **equal** upstream's `#[test]` fns, **in order** (it used to compare sorted lists). It also requires every `PENDING` key to be a registered test.
- When an owning lane lands, a pending test either runs to completion or reaches a different `Unported`. Either way it fails until root updates or deletes its `PENDING` entry.

## Per-test status
| status | tests |
|---|---|
| **pass** (37 emitter tests) | ends_on_col0, ends_on_col2, non_nested, nested, multiline_and_normal_overlap, different_overlap, different_note_1..3, different_note_spanned_1..10, triple_overlap, triple_exact_overlap, minimum_depth, non_overlapping, overlapping_start_and_end, multiple_labels_primary_without_message, multiline_notes, multiple_labels_secondary_without_message, multiple_labels_primary_without_message_2, multiple_labels_secondary_without_message_2, multiple_labels_secondary_without_message_3, multiple_labels_without_message, multiple_labels_without_message_2, multiple_labels_with_message, single_label_with_message, single_label_without_message, long_snippet, long_snippet_multiple_spans |
| **pass** (token trees) | string_to_tts_macro, string_to_tts_1 |
| **pass** (parser-core) | look_ahead, look_ahead_non_outermost_stream, debug_lookahead, eqmodws, pattern_whitespace, non_pattern_whitespace |
| **pending on `rustc_parse::parser::expr::Parser::parse_expr`** | bad_path_expr_1, parse_exprs, ttdelim_span |
| **pending on `rustc_parse::parser::item::Parser::parse_item`** | parse_use, parse_extern_crate, span_of_self_arg_pat_idents_are_correct, attrs_fix_bug, crlf_doc_comments, out_of_line_mod |
| failing with an emitter bug | none |

The pending entries record only the **first** `Unported` each test reaches today. Once expr.rs or item.rs lands, a test may stop at a later unported step instead, for example `pprust` `print_item` in parse_use/parse_extern_crate, or path/pat/ty parsing. Whoever lands the method should update that test's entry to the new exact name, or delete the entry once the test passes.

## Evidence
- **Typecheck.** `bunx tsc --noEmit -p .` is clean.
- **This file.** `bun test src/rustc_parse/parser/tests.test.ts` gives 55 pass, 0 fail: 54 upstream tests plus the list check.
- **Whole repo.** `RUST_TS_REQUIRE_PROBES=1 bun test src tools` gives 1060 pass, 0 fail, 1 skip. The skip is the pre-existing Linux-only `read_binary_file_handles_lying_stat` (`skipIf(platform !== "linux")`), which skips on this macOS host. There are no todos and no `.only`.
- **Markers.** `bun scripts/coverage.ts --check` reports `markers ok (3130; vendor 2278)`.
- **Coverage.** `bun scripts/coverage.ts --missing compiler/rustc_parse/src/parser/tests.rs` reports `75/75 ported`.
- **Data fidelity.** The emitter test bodies were converted mechanically by a scratch script (`$RUST_TS_DATA/tmp/parser-tests/conv.ts`). A second scratch script (`fidelity.ts`) then compared the converted file with upstream token by token: every raw string, string literal, `count:` value and `None`, all in the same order (540 tokens). They are identical. Raw strings became template literals, with only `\`, `` ` `` and `${` escaped.
- **Negative control.** I changed one character in the ASCII expectation of `ends_on_col0`, separately one character in its Unicode expectation, and one span in `string_to_tts_1`. Each change made the matching test fail. I then restored the file.
- **Difftest.** None was run; this lane touches only a unit-test file, so it cannot affect a suite.

## `unported(...)` left
None in this file. The pending tests reach `unported` stubs that belong to the expr and item lanes, as listed above.

## PORT decisions (please record)
1. **The `upstream_test` registry and the `PENDING` map,** as described under "What was done". The list check is now order-sensitive.
2. **`TokenStream_eq` / `TokenTree_eq`** are test-local, hand-written stand-ins for the `#[derive(PartialEq)]` of `TokenStream`, `TokenTree`, `DelimSpan` and `DelimSpacing`, used for `assert_eq!(tts, expected)`. They use `Token_eq`, `Delimiter_eq` and `===` on spans and spacings. **Root:** these are candidates for `rustc_ast/tokenstream.ts` (or codegen); once they exist there, the test should import them.
3. **Slice patterns with guards** in `string_to_tts_macro` are if-chains built from small pattern-piece helpers: `tt_ident_normal`, `tt_is` and `tt_delimited`. `stream.iter().collect()` becomes `collect_tts`, and `attrs.iter().filter_map(doc_str).next()` becomes `first_doc_str`. Arms and panic messages stay in upstream order.
4. **`Result::unwrap()` on a `PResult`** uses `unwrap_result` without an error Debug, because `Diag` has no Debug. The panic text is only the message prefix.
5. **`PatIdentVisitor`** is a local class that extends `visit.Visitor`. `visit::walk_item(&mut v, &item)` becomes `visit.walk_item(v, item, visit.WalkItemKind.ItemKind)`.
6. **`&src[lo.to_usize()..hi.to_usize()]`** slices UTF-8 bytes through `Str`.
7. **`test_harness` still omits** the upstream `println!` debug lines, including `source_map.span_to_snippet(span)`. These only write to stdout. This was already the case in parser-core's port.

## Emitter bugs found
None. All 37 rendering tests match upstream's literal ASCII and Unicode expectations byte for byte.

## For root
- **Record decisions 1 to 7.**
- **When the expr and item lanes merge,** re-run this file and update or delete `PENDING` entries as described under "Per-test status".
