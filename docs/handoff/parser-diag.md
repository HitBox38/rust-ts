# Handoff: parser-diag (wave 6c parser porter): rustc_parse `parser/diagnostics.rs`

Branch `lane/parser-diag`. main merged three times (last at bcd0773, parser-ptg); one conflict in
`parser_core.test.ts`'s PENDING list, resolved (see below).

## Pin facts that differ from the brief
- `recover_from_prefix_increment` / the `a++`/`++a` recovery are not in diagnostics.rs at the pin: they are
  `recover_from_postfix_inc_op` / `report_inc_dec_op` in `parser/expr/diagnostics.rs` (expr lane). They are
  covered here only as driver cases (`post_increment`, `pre_increment`, pending).
- diagnostics.rs has 88 fns at the pin (coverage count), not ~106. `struct_span_err`, `span_bug` etc. are
  `DiagCtxtHandle` methods (rustc_errors), not part of this file; `Parser::dcx` is.

## Files
- `src/rustc_parse/parser/diagnostics.ts`: the whole file (stub replaced). The `unported_methods` list is gone.
- `src/rustc_parse/parser/diagnostics.test.ts` (new) + fixtures `diagnostics_oracle.json` (probe) and
  `diagnostics_driver.json` (driver).
- PENDING lists updated (allowed by root): `parser_core.test.ts`, `asm.test.ts`, `function.test.ts`
  (`NARROW_PENDING`), `pat.test.ts`, `stmt.test.ts`, `path.test.ts`, `ty.test.ts`, `generics.test.ts`.
  Every entry that now matches the oracle was removed; every entry that now stops later was renamed to the new
  `Unported` (mostly `expr::Parser::is_builtin` / `parse_expr`, `item::Parser::{is_path_start_item,
  parse_item_common}`). Removed because they now match byte for byte: parser-core 8 `expect*`/`attr_shebang_like`
  cases, asm `asm_empty`, 8 parser-fn narrow cases, 8 pat, 1 stmt, 4 path, 2 ty, 13 generics cases.
  `parser_core`'s `expect_one_of` is now pending on `expr::Parser::parse_expr` (its `prev_token` is the initial
  dummy `?`, so expected-`;` tries `maybe_recover_from_ternary_operator`, as upstream).
- No edits to decls.ts, scripts, harness, tools.

## Evidence
- `bun scripts/coverage.ts --missing compiler/rustc_parse/src/parser/diagnostics.rs`: **88/88**.
- `bun scripts/coverage.ts --check`: `markers ok (3406; vendor 2323)`.
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 1761 pass, 0 fail, 1 skip, 0 todo. The skip is pre-existing and
  platform-only (`rustc_span/source_map/tests.test.ts` `read_binary_file_handles_lying_stat`, linux-only; host is
  macOS). Note: `rustc_session/options.oracle.test.ts` "option values" spawns rustc ~100 times and hit bun's 5 s
  default timeout twice under machine load (passes alone and with `--timeout 60000`); unrelated to this lane.
- `RUST_TS_AGENT=parser-diag bun scripts/difftest.ts --suite tokens --sample 200`: 200/200 MATCH
  (run `20261013-005716-parser-diag-qh9g`).
- `diagnostics.test.ts`: 151 tests, all byte-exact against the pinned nightly:
  - **A. 64 probe cases** (`diagnostics_oracle.json`): lane parser-core's rustc-dev probe extended with per-case
    editions and ops `semi` (`maybe_consume_incorrect_semicolon(None)`), `snap`/`restore` (snapshots). Source,
    cases and build/run commands in the fixture (`_probe`, `_cases`, `_how`); scratch copy
    `$RUST_TS_DATA/tmp/parser-diag/probe/`. Covers: expected-one-of with `TokenType` sets (1, 2, 7, >6 tokens,
    empty set, EOF, multi-line labels), every "expected `;`" branch (add `;` with spans, `,`/`:` → `;`, same line,
    after `)`, with `,` expected, `#` on a new line), raw-string terminators (1 and 2 extra `#`, with/without `;`),
    `=>` → `>=`, `def`/`function` → `fn`, keyword concatenation (`ma tch`, `ab stract`), c-strings in 2015/2018/2021,
    `public` → `pub`, the 4 doc-comment kinds, misspelled keywords (expected-set path incl. the last-10 window,
    case-only, previous-token path), `UseEqInstead`, `async move`/`async use` in 2015, `&raw` without
    `const`/`mut`, `expect_keyword`, keyword/reserved keyword as identifier with the `r#` suggestion (recovered),
    comma before an identifier, numbers starting identifiers, a documentation comment that documents nothing,
    `unexpected_err` (EOF, multi-line), `maybe_consume_incorrect_semicolon`, snapshot + restore.
    1 pending (`expect_one_of_question_prev`, needs `parse_expr`).
  - **B. 21 direct cases**: the TS parser is moved to the token where rustc calls a diagnostics.rs fn inside a
    whole program, AST arguments are rebuilt with the same spans, the fn is called, and the full stderr plus
    `print_error_count` must equal `rustc -Zui-testing -Zparse-crate-root-only` on that program (only programs
    whose entire rustc output is that diagnostic). Covers: VCS markers (plain and diff3, fatal), semicolon
    insertion via `expect_semi`, `:` as `;`, raw-string terminators via `expect_semi`, `try!` (+ `consume_block`
    over nested parens), `expected_expression_found`, `.await()`, `.use()`, ambiguous `+` (impl/dyn), chained
    comparisons (`a < b > c` help, `foo<Bar>()` turbofish suggestion via `consume_fn_args`, `a < b < c` split via
    snapshot/`consume_tts`/restore, `a == b == c`), `u8?`/`Option<u8>?`, `let fn = 1` (keyword as identifier),
    unmatched angle brackets (`check_trailing_angle_brackets` + `eat_to_tokens`). Calls that emit and then enter
    another lane's code must stop at exactly the listed `tail` (`expr::mk_expr`, `expr::mk_expr_err`, `ty::mk_ty`).
  - **C. 65 driver cases** (`diagnostics_driver.json`, generated by `_gen` from `_cases`; scratch
    `$RUST_TS_DATA/tmp/parser-diag/drv/`): `src/rust_ts/main.ts -Zui-testing -Zparse-crate-root-only --edition E
    t.rs` vs rustc (stderr + exit code). All 65 are PENDING on `item::Parser::parse_crate_mod` (they must print a
    prefix of the oracle's stderr and stop there with exit 70). They cover every area of the brief end to end
    (incl. unexpected token after a path, `a++`/`++a`, unmatched/missing angle brackets, `consume_block` via
    struct-literal recovery, ternary, closing generics, `await x`, `&&self`, C-style params, const-arg braces,
    `a:b` patterns, block labels, `let a, b`, `[u8]::len`, E0178, `'a T`, `..<`, `self` not first, const param
    declarations, `#[cfg]` chains). Root: as parser lanes land, update/remove `PENDING_DRIVER` entries.
  - Negative control: appending a character to every fixture stderr fails all 82 non-pending probe/direct cases.

## `unported(...)` left
None in diagnostics.ts. Indirect: the fns call other lanes' methods (`parse_expr`, `parse_ty`, `mk_expr`,
`mk_ty`, `mk_pat`, `parse_generics`, `parse_angle_args`, `parse_pat_no_top_alt`, `parse_block_tail`, `eat_label`,
...), which reach those lanes' stubs until they land.

## PORT decisions (please record)
1. `RecoverQPath` trait → impl tables `RecoverQPath.{Ty, Pat, Expr}` and `RecoverQPath.Box(T_)` (Box erased: the
   table of `T`). The trait default `PATH_STYLE = PathStyle::Expr` is written out in the `Expr` table. Required
   trait fns carry markers on the interface members (diagnostics.rs:67/68), as ast_traits.ts does. The
   `Box<Expr>` table used by `recover_incorrect_await_syntax` is created once at module level.
2. `SnapshotParser` `Deref`/`DerefMut` → `SnapshotParser.deref/deref_mut` on a companion (callers use
   `snapshot.parser`, contract rule 6). `restore_snapshot` is `Object.assign(this, snapshot.parser)`;
   `create_snapshot_for_diagnostic` is `clone_Parser(this)`.
3. `span_to_snippet` returns the `Str` snippet as a JS `string` (decls signature). The two places where upstream
   calls `self.psess.source_map().span_to_snippet` directly use a local helper `sm_span_to_snippet` (same thing).
4. `expected.sort_by_cached_key(|x| x.to_string())` → stable sort by the key with a local `cmp_str` (code-point
   order = UTF-8 byte order), then `dedup()` on the `TokenType` values.
5. `Option<usize> < Option<usize>` in `recover_colon_as_semi` → local `option_lt` (`None < Some`).
6. `Result::unwrap_err` on a `PResult` → local `unwrap_err` panicking with Rust's message and the Debug of the
   `Ok` value (`expected_ident_found_err`: `(ident, kind)`; `handle_lifetime_arg_preceding_type`: `()`).
7. `FxHashSet<Ident>` in `deduplicate_recovered_params_names` → array searched with `Ident.eq` (name + ctxt).
8. Let-chains with fall-through (`attr_on_non_tail_expr`'s cfg chain) → a labeled block; `match` guards that fall
   to `_` (`recover_stmt_` `Comma`) → explicit fallthrough code; the multi-ref-`self` guard of
   `parameter_without_type` → a local predicate evaluated in upstream order.
9. `path.segments[0]` in `maybe_type_in_generic_parameter` panics with Rust's index-out-of-bounds text on an
   empty path. `debug!`/`trace!` calls are kept as comments.
10. `dummy_arg` copies `BindingMode::NONE` with `clone_BindingMode` (PORTING §8 Copy rule).

## Requests for root
- Delete `docs/claims/wave6c-parser-diag.md` on integration.
- `PENDING_DRIVER` in `diagnostics.test.ts` (65 entries, all `parse_crate_mod`) will need updating as the item,
  stmt, expr, pat, ty and path lanes land; the direct-case `tail`s disappear when `mk_expr`/`mk_expr_err`/`mk_ty`
  land (the tests accept either).
