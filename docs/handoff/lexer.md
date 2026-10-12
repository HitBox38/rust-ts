# Handoff: lexer (wave 6 porter): rustc_parse lexer/mod.rs, lexer/diagnostics.rs, lexer/tokentrees.rs

Branch `lane/lexer`. Merged `main` at 6c380fb (session-parse, pp) with no conflicts. The `ParseSess` shim was
replaced by the real `src/rustc_session/parse.ts`, and the pprust shims by `src/rustc_ast_pretty/pprust/mod.ts`.

## Files touched
- New:
  - `src/rustc_parse/lexer/mod.ts`
  - `src/rustc_parse/lexer/diagnostics.ts`
  - `src/rustc_parse/lexer/tokentrees.ts`
  - `src/rustc_parse/lexer/lexer.test.ts`
  - `src/rustc_parse/lexer/lexer_oracle.json`, the oracle fixture
- New `src/rustc_parse/lib.ts`, a minimal crate root. It has only:
  - `import "./lexer/mod.ts"; import "./lexer/tokentrees.ts";`, the extension-module side-effect imports
  - `export * as lexer from "./lexer/mod.ts"`

  The parser lane owns the rest of lib.rs. lexer-aux does not need lib.ts, because mod.ts imports its modules.

## Evidence
- **Coverage** (`bun scripts/coverage.ts --missing`):

  | file | fns ported |
  |---|---|
  | mod.rs | 26/26 |
  | diagnostics.rs | 4/4 |
  | tokentrees.rs | 7/7 |

- `--check`: `markers ok (2368; vendor 2048)`.
- `bunx tsc --noEmit -p .` is clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 576 pass, 4 skip, 0 fail.
- `RUST_TS_AGENT=lexer bun scripts/difftest.ts --suite lex --sample 200`: 200/200 MATCH (run `20261012-215824-lexer-nnp4`).
- Entry points: `lexer/mod.ts`, `lexer/diagnostics.ts`, `lexer/tokentrees.ts` and `lib.ts` each load as the entry module.
- The upstream lexer files have no `#[cfg(test)]` tests. The string-reader tests in `parser/tests.rs` belong to the
  parser lane.
- **`lexer.test.ts`**: 57 tests.
  - **43 probe cases.** Each one checks two things against the oracle, byte for byte:
    - stdout: `OK {TokenStream:?}`, `ERR n` or `FATAL`, plus the buffered lint count, gated spans per feature and the
      raw-identifier count
    - stderr: the `-Zui-testing` human rendering of every diagnostic, in this order: those emitted during lexing,
      then the returned `Vec<Diag>`, then the stashed ones

    The oracle is a rustc_private probe linked against the pinned nightly's rustc-dev. It calls
    `rustc_parse::source_str_to_stream`, which is StripTokens::Shebang. Its source is in the fixture's `_probe`
    field and `_how` says how it was run; the scratch copy is `$RUST_TS_DATA/tmp/lexer/probe/`.

    The cases cover:
    - gluing and spacing
    - every literal kind
    - doc and plain comments
    - raw idents and lifetimes, forced keywords, editions 2015/2018/2021/2024
    - c-string splitting, guarded strings, unknown prefixes
    - shebang
    - delimiter trees
    - EOF unclosed-delimiter errors: the limit of 5, suspicious indentation, empty block, matching-brace labels
    - every unterminated-literal and block-comment error, including the nested-comment labels
    - E0748 with note and suggestion, too many hashes
    - int and float errors, `_` suffix, CR in doc comments
    - a stashed `'1a`
    - `r#crate`
    - text-direction lints
  - **13 driver cases.** Each compares the full stderr of
    `rustc +nightly -Zui-testing -Zparse-crate-root-only --edition 2024 t.rs`. The driver path is
    ShebangAndFrontmatter, then `unwrap_or_emit_fatal`, then stashed diagnostics, then `print_error_count`. The cases
    are:
    - all 8 frontmatter diagnostics (unclosed, length mismatch, infostring, whitespace before open and before close,
      extra characters, bare CR, ok)
    - unterminated string, EOF, no digits, a lifetime starting with a number, shebang
  - **Negative control:** after appending a character to each expectation, all 35 non-pending probe cases fail. The
    comparisons are real.
- **PENDING cases.** 8 cases reach a shim that is still unported. The test asserts each one throws exactly that
  `Unported`, or matches the oracle once the dependency lands. Root drops a case from `PENDING` in `lexer.test.ts` when
  it starts matching.
  - Pending lexer-aux: `ws`, `unknown_tok`, `bad_escape`, `non_ascii_ident`, `invalid_ident`
  - Pending pprust `State`: `close_unexpected`, `missing_open`, `mismatched`

## `unported(...)` left
All the shims are in `lexer/mod.ts`, in the block marked `// PORT: pending lexer-aux`. Remove each when lexer-aux lands:
- `unicode_chars.UNICODE_ARRAY` and `unicode_chars.check_for_substitution(lexer, pos, ch, count)`, which go in a local
  `unicode_chars` object. Replace it with `import * as unicode_chars from "./unicode_chars.ts"`.
- `emit_unescape_error(dcx, lit: Str, full_lit_span, err_span, mode, range: {start, end}, error)` and
  `escaped_char(c)`. Import them from `./unescape_error_reporting.ts`.
  - The `range` shape is my assumption. Adjust the two call sites if lexer-aux chose a different one.
- `is_nfc_quick` and `nfc`, for `nfc_normalize`. The shim answers `Yes` for all-ASCII input, which is exact: the
  crate's `quick_check` skips ASCII (unicode-normalization-0.1.25 quick_check.rs:33). Any non-ASCII input is unported.
  Replace with the vendored crate.
- Indirectly, pprust `State` (still a shim, in the pprust-state lane) for `token_to_string` (tokentrees close_delim_err)
  and `token_kind_to_string` (diagnostics make_errors_for_mismatched_closing_delims).
- lexer-aux needs these members of `Lexer`, which are all public: `lexer.dcx()`, `lexer.src` (a `Str`) and
  `lexer.src_index(pos)`.

## PORT decisions
- **`match` with guards.** `InvalidIdent if !UNICODE_ARRAY…` and the later `Unknown | InvalidIdent` arm share one
  `case`. The guard runs first and falls into the general body. Likewise `Literal { CStr|RawCStr } if edition < 2021`
  and `Literal { .. }`. The arms in between match other variants, so the semantics are identical. Both spots have
  comments.
- **Types.** `UnmatchedDelim` (interface + `debug_UnmatchedDelim`), `StripTokens` (string union + companion) and
  `TokenTreeDiagInfo` (class with `default()`) are hand-written. The rustc_parse codegen set covers only diagnostics.rs.
  Root may add the lexer files to it.
- **Text types.** Source-text `&str` values are `Str`. `nfc_normalize` takes a JS `string`, since it is also called on
  a built `String`; callers pass `.toString()`. `report_text_direction_codepoint` takes `Str`; symbol text is wrapped
  with `Str.from(..)`.
- **Literal diagnostics.** `ReservedPrefixLint` and the other lint diagnostics are passed to `buffer_lint` as
  `X_diagnostic(..)`. That is upstream's `impl Into<DecorateDiagCompat>`.
- **Divergence.** `Diag.emit()` on a Fatal diagnostic throws `FatalErrorMarker`, which is upstream's `-> !`. The code
  after it is unreachable, as upstream.
- **Dropped.** `debug!` tracing calls; `static_assert_size!`; and `debug_assert!`, which is kept as a comment.
- **Local str helpers** with Rust semantics, candidates for `src/std/str.ts`: `char_indices`, `str_trim_start_matches`,
  `str_trim_matches`.

## API contract (for the parser lane)
```ts
import { lexer } from "src/rustc_parse/lib.ts"; // always via lib.ts (loads the tokentrees extension)
// source_file_to_stream(psess, source_file, override_span, strip_tokens):
const res = lexer.lex_token_trees(psess, source_file.src!, source_file.start_pos, override_span /* Span|undefined */,
                                  "ShebangAndFrontmatter" /* | "Shebang" | "Nothing" (lexer.StripTokens) */);
// res: Result<TokenStream, Diag[]> (src/std/result.ts). Err = mismatched-closing-delimiter diags first, then the
// unclosed/unexpected one; unwrap_or_emit_fatal emits each and raises FatalError.
```
- `lexer.nfc_normalize(s: string): Symbol` is `pub`. It is used by the parser and by rustc_expand.
- `lexer.Lexer`, `lexer.UnmatchedDelim` and `lexer.debug_UnmatchedDelim` are exported. `make_errors_for_mismatched_closing_delims`
  is in `lexer/diagnostics.ts`. Note: `Parser::new` at the pin no longer takes unmatched delims.
- The lexer emits non-fatal errors (`emit_err`) during lexing and still returns `Ok`. Fatal ones throw
  `FatalErrorMarker`. Lints are buffered in `psess.buffered_lints`. Frontmatter and `k#` gates go to
  `psess.gated_spans`.
