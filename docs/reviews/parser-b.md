# Wave 6b/6c review: parser-expr, parser-item, parser-diag, parser-tests, driver-session, unicode-width-str (independent reviewer, lane review-parser-b)

Reviewed at main `5659298` against upstream at the pin `6f5da406b56c`, oracle `rustc 1.101.0-nightly (6f5da406b 2026-10-10)`
(aarch64-apple-darwin). Handoffs: `docs/handoff/{parser-expr,parser-item,parser-diag,parser-tests,driver-session,unicode-width-str}.md`.

STATUS: work in progress (batches 1 and 2 pending).

Method:
- `coverage.ts --check`: markers ok (3642; vendor 2323). `--missing`: expr.rs 143/143, expr/diagnostics.rs 12/12,
  item.rs 81/81, diagnostics.rs 88/88, tests.rs 75/75.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools` (quiet host): 1999 pass, 1 skip (pre-existing), 0 fail, 0 todo.
- Marker-order scan (upstream line must not decrease per upstream path within a TS file): no descent in expr.ts,
  expr/diagnostics.ts, item.ts, diagnostics.ts, tests.test.ts. Driver descents: see batch 5.
- Line-by-line comparison by five sub-reviewers (one per batch; tests and unicode-width shared one). I re-ran every
  high/med repro myself (scratch `$RUST_TS_DATA/tmp/review-parser-b/`).
- **Fuzzing beyond tests/ui** (my own, `tmp/review-parser-b/{fuzz.ts,soup.ts}`): oracle vs `bun src/rust_ts/main.ts`,
  comparing stdout, stderr and exit code byte for byte, random edition 2015/2018/2021/2024:
  - 4,000 mutated tests/ui files (1-5 token deletions/insertions/replacements/duplications from 18 directories:
    parser, let-chains, closures, macros, structs, suggestions, async-await, keyword, range, float, pattern, ...),
    `-Zunpretty=ast-tree`: **4,000/4,000 match**.
  - 500 mutated files with `-Zunpretty=normal`; 150 each with `--error-format=short`, `--color=always`,
    `--diagnostic-width=30`, `-Zui-testing`: **all match**. `--error-format=json`: 150/150 honest UNPORTED (exit 70).
  - 2,000 random token soups (1-8 tokens from ~110 keywords/punctuation/literals) inside 15 contexts (fn body, item
    level, return type, struct/enum/trait/impl/extern body, match arms, `if` cond, `let` pattern, params, field access,
    closure params, `use`): **2,000/2,000 match**.
  - Deep nesting (`(((...)))` 200 and 1,000 deep, 32 MB AST dump): match.

Severity:
- **high**: an observable divergence from the oracle on a reachable path (confirmed by repro).
- **med**: latent wrong logic, a missing panic/unported guard, a weakened test, or a process gap.
- **low**: style or convention.

## Batch 1: parser-expr (expr.rs, expr/diagnostics.rs): **ACCEPT** (one runtime follow-up for root)

Checked line by line (every fn in both files), all matching upstream:
- `CondChecker` (hand-written MutVisitor): `forbid_let_reason` per node kind, `missing_let`/`comparison` handling, the
  `Some(ForbiddenLetReason::...)` save/restore around nested exprs, and its call sites in `parse_expr_cond` /
  `parse_expr_while` / match guards; let-chain gating per edition (`let chains are only allowed in Rust 2024 or later`
  vs. the feature path).
- `break_up_float` / `parse_expr_tuple_field_access_float` / `mk_expr_tuple_field_access` (spans of the split idents,
  `x.0.1`, `x.1e1`, `x.1.`, suffixed fields), the metavariable paths (read only: unreachable under `-Zunpretty`).
- Closures (`move`/`async`/`static`/binder/coroutine/`-> T` requiring a block), struct-literal restrictions,
  `parse_expr_dot_or_call_with` recovery (`.await` in 2015, `.match`, `x.f!()`, `x.0()`), the `ExprPrecedence` assoc-op
  loop (chained comparisons, `as T <`, `as T <<`, `a = b = c`, `..`/`..=`/`...`), match-arm recovery, labeled blocks,
  `try`/`gen`/`async` blocks per edition, `become`, `yeet`, `builtin #`, `&raw`.
- Function and match-arm order, spans, edition comparisons, `Restrictions`, and every snapshot/restore and
  `.cancel()`/`.emit()`/`.delay_as_bug()` site. No `unported(` remains anywhere under `src/rustc_parse/parser`.
- **Oracle:** ~230 hand-written cases on all four editions, 550 mutated tests/ui files and 300 generated expression files
  (sub-reviewer, `tmp/review-parser-b/expr/`), plus my fuzz runs above: no divergence.
- The 9 PORT decisions in the handoff are behaviour-preserving.

### Findings
1. **high (runtime, not expr.rs logic)**: rust-ts overflows the JS stack on nesting depths rustc handles.
   - **Repro:** `python3 -c "n=3000; print('fn main() { let x = ' + '('*n + '1' + ')'*n + '; }')" > dp.rs`, then
     `rustc +nightly -Zparse-crate-root-only --edition=2021 dp.rs` exits 0; `bun src/rust_ts/main.ts` (same args) exits
     101 with `rust-ts: internal compiler error: RangeError: Maximum call stack size exceeded.`
   - Sub-reviewer's limits (parse-only): parens fail at 3,000-3,500 (rustc fine at 6,000, crashes at 10,000); nested
     closures fail at 4,000 (rustc fine at 4,000); repeated unary `-` fails at 6,000 (rustc fine). 1,000-deep parens with
     `-Zunpretty=ast-tree` still match.
   - Upstream has no stack guard in rustc_parse either; rustc simply runs the compiler on a large thread stack. So this
     is a driver/runtime gap, and it will surface as soon as fmt-perf removes the 3 parse TIMEOUTs (deep-nesting cases).
   - **Fix (root):** run the compiler body with a larger JS stack (e.g. `bun --stack-size`/a Worker with
     `resourceLimits.stackSizeMb`), sized so rust-ts reaches at least rustc's depth; or record a decision that depth
     beyond N is out of scope and make the harness classify `RangeError: Maximum call stack` separately from real ICEs.
2. **low**: expr.ts:76 `Bound<T>` is defined locally; its own PORT note says it belongs in src/std.
3. **low**: expr.ts:2430 `IS_NUMERIC = /^\p{N}$/u` uses the JS engine's Unicode tables, not the pinned `char::is_numeric`.
   Unreachable today (integer literal symbols are ASCII). Move to a std `char_is_numeric` backed by generated tables.
4. **low**: expr/diagnostics.ts:236 `str_trim` duplicates a string helper; move to src/std (next.md follow-up 1).
5. **low**: expr.ts `parse_expr_cond` wraps `cond` in a `MutRef` it never needs. Style only.

6. **low**: expr.ts:4970 `CondChecker::visit_expr`'s final `else {}` stands for an exhaustive Rust arm list; a new
   `ExprKind` variant would fall through silently here where rustc fails to compile. I re-checked the whole visitor
   against expr.rs:4126-4327 (arm order, both guards, the `get_path_from_rhs`/`find_let_some` helpers, save/restore of
   `forbid_let_reason`/`missing_let`/`comparison`): faithful. **Fix:** list the remaining kinds and end with an
   exhaustiveness assertion (`k satisfies never` pattern), as other hand-written visitors do.

## Batch 2: parser-item (item.rs)

PENDING (sub-reviewer still running).

## Batch 3: parser-diag (parser/diagnostics.rs): **ACCEPT** (low follow-ups)

Checked line by line, all 88 fns, matching upstream:
- **Snapshot machinery.** `create_snapshot_for_diagnostic` = `clone_Parser` (mod.ts:183) copies all 20 upstream `Parser`
  fields; the mutable state is deep-copied (TokenCursor `curr` + stack, `TokenTypeSet`, `CaptureState` replacements/
  ranges/seen_attrs, `current_closure`). Tokens are shared but never mutated in place. All snapshot sites in the file
  (attr_on_non_tail_expr, maybe_suggest_struct_literal, check_turbofish_missing_angle_brackets,
  suggest_add_missing_let_for_stmt, attempt_chained_comparison_suggestion x2, check_no_chained_comparison x2,
  consume_fn_args, maybe_recover_from_ternary_operator, handle_lifetime_arg_preceding_type, recover_const_param_decl,
  recover_const_arg (reads `snapshot.parser.token` after `this` advanced), recover_unbraced_const_arg_that_can_begin_ty,
  recover_colon_colon_in_pat_typo (two independent snapshots)) are correct. `restore_snapshot(` call counts per file match
  upstream exactly across rustc_parse (51 call sites).
- `expected_one_of_not_found`: expected-token collection, stable sort by string key + dedup, `tokens_to_string`
  separators, the `> 6` "one of N possible tokens" threshold, the `checked_sub(10)` window; `consume_block`,
  `recover_closing_delimiter`, bad qpath / bad type plus, trailing/turbofish angle brackets, chained comparisons,
  `++`/`--` recovery, unbraced/ambiguous const args, `::` in pattern typo, misspelled-keyword suggestions, `.await` and
  `await!` recovery, `expected_ident_found` per edition (`async`/`dyn`/`try`/`gen` as identifiers), VCS conflict markers.
- Every `Applicability`, message literal, `.cancel()`/`.emit()`/`.emit_err()`/`.delay_as_bug()`/`span_delayed_bug`
  site, match-arm order incl. guards, and edition checks.
- **Oracle:** ~320 single-snippet inputs + 22 multi-case files (sub-reviewer, `tmp/review-parser-b/diag/`), editions
  2015-2024, `--error-format=short`, `-Zui-testing`, `--diagnostic-width=20/40/60`, plus inputs emitting errors *inside*
  snapshots (bad qpath, bad type plus, `?` in the colon-colon-typo snapshots, ternary arms, `#[cfg]` chains), and
  `CARGO_CRATE_NAME=foo` (cargo wording of HelpUseLatestEdition): all byte-identical, no 70/101.
- **PORT decisions:** all 10 accepted (RecoverQPath tables; `.parser` deref with Object.assign restore and deep
  `clone_Parser`; local `sm_span_to_snippet`; stable sort for `sort_by_cached_key`; `option_lt`; `unwrap_err` panic
  text; `FxHashSet<Ident>` as array (only membership observable); labeled-block fallthroughs that keep evaluation
  order; `segments[0]` panic text; `clone_BindingMode`).

### Findings
1. **low (latent)**: diagnostics.ts:292 `restore_snapshot` is `Object.assign(this, snapshot.parser)`, so after a restore
   `this` shares TokenCursor/TokenTypeSet/CaptureState with the snapshot object. Correct because Rust moves the
   snapshot and no caller touches it afterwards (checked all 51 sites). **Fix:** say so in PORTING §8 ("never use a
   `SnapshotParser` after `restore_snapshot`"), so later lanes (expand, `cfg_select`) don't reuse one.
2. **low (tests)**: diagnostics.test.ts:302-482 the direct cases still carry `tail:` values for lanes that have
   landed, and assert `if (got.tail !== undefined) expect(...)`, which accepts either outcome; line 87 has a stale
   comment in the empty `PENDING_PROBE`. **Fix:** drop the `tail` fields and assert `got.tail === undefined`.

## Batch 4: parser-tests (tests.rs): **ACCEPT** (low follow-ups)

- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_parse/parser/tests.test.ts`: 55 pass (54 upstream tests + the list
  check). `PENDING` is empty; no `.skip`/`.todo`/`.only`; no probe-conditional code. The registry check
  (tests.test.ts:317) parses upstream tests.rs at the pin and requires the exact ordered list of 54 `#[test]` names.
- **Faithful, nothing hidden.** An independent token-level diff of upstream tests.rs:244-2221 against the TS emitter
  tests (535 string/raw-string literals after unescaping, every `count:`, every `None`) shows no difference; all six
  `debug_lookahead` expected strings are byte-equal to upstream. `test_harness` asserts exact equality for both the
  ASCII and Unicode themes. `with_expected_parse_error` uses `contains` exactly as upstream does. No test compares
  rust-ts against itself; any `Unported` fails the test.
- **Oracle fixture provenance (other parser tests).** Every embedded `_probe`/`_gen` was rebuilt and re-run against
  the pinned rustc: parser_core 34/34, asm 32/32, function 82/82, ptg 136/136, expr 181/181, diagnostics 64/64,
  item_oracle 55/55, diagnostics_driver 65/65, pat_stmt 119/119, identical. No fixture came from rust-ts.

### Findings
1. **low**: tests.test.ts:2431-2449 `TokenStream_eq`/`TokenTree_eq` are hand-written derive(PartialEq) stand-ins in the
   test. They compare every field, so `string_to_tts_1` is not weakened. **Fix:** move them to rustc_ast (or codegen).
2. **low**: testdata/pat_stmt_harness.ts:165-279 and the "(shimmed)" tests in pat.test.ts/stmt.test.ts keep stale
   test-side copies of diagnostics.rs/ty.rs bodies from before those files landed. **Fix:** delete the shim mode.
3. **low**: parser_core.test.ts:240-270 compares only the first stderr line (catching `Unported`); superseded by the
   full per-case test. Remove.
4. **low (process)**: the oracle fixtures embed their generators, but nothing in `scripts/`/`tools/` re-verifies them
   (e.g. on a pin bump). **Fix:** a `--check` regenerator like `tools/gen-unicode-width.ts --check`.
5. **low**: the upstream debug `println!`s in `test_harness` are dropped (stdout only; documented decision 7).

## Batch 6: unicode-width-str (vendor unicode-width 0.2.2): **ACCEPT** (one med test-timeout fix)

- **Version.** upstream Cargo.lock has unicode-width 0.1.14 and 0.2.2. 0.1.14 is used only by rustfmt, papergrid and
  tabled (out of scope). rustc_span, rustc_parse, getopts 0.2.24 and annotate-snippets all take 0.2.2 with `cjk` on.
  The port targets 0.2.2 + `cjk`: correct. The probe's lock pins the same checksum.
- tables.ts compared line by line with tables.rs:15-944: WidthInfo bit patterns, `lookup_width(_cjk)` arm order,
  `single_char_width(_cjk)` control ranges, every arm of `width_in_str(_cjk)` (Lam-Alef incl. solidus overlay, Hebrew,
  Khmer coeng -1, Buginese, Tifinagh, Lisu, Old Turkic, modifiers, RI pairs, keycap, VS16, tag sequences, Kirat Rai),
  the transparent/ligature/solidus/emoji-presentation selectors. The cjk/non-cjk diff in TS matches upstream's hunk
  for hunk. tables.gen.ts is GENERATED and `tools/gen-unicode-width.ts --check` is clean; an independent re-parse
  of tables.rs finds all 25 static tables identical.
- **Beyond the oracle-checked paths:** an exhaustive probe (crates.io 0.2.2) over 413,065 strings (every string of
  length <= 3 over 56 special chars: controls, NBSP, SHY, ZWSP, ZWJ, VS1-3/15/16/17, U+0338, U+20E3, lam/alef, Hebrew,
  Khmer, Buginese, Tifinagh, Lisu, Old Turkic, Kirat Rai, RIs, modifiers, tags, Hangul L/V/T/LV, CJK, quotes; plus
  every length-4 string over 22 state-machine chars): 0 mismatches in `width` and `width_cjk`.
- **Through rustc:** getopts `--help`, no args, `-o`, `--explain`, `-h`, `--help -v`, `-C help`, `-Z help` match;
  diagnostics whose source lines hold ZWJ emoji, flags, VS16, CJK, combining marks, SHY, Khmer coeng, lam-alef, Hangul
  jamo and keycaps are byte-identical including caret columns.

### Findings
1. **med (gate flakiness)**: src/vendor/unicode_width/tests/tests.test.ts:394 `test_khmer_coeng` and :555
   `test_vs1_vs2_vs3` loop over all 1.1M scalars with per-char `expect` under bun's default 5 s timeout; an oracle
   pattern group needs ~120 s. Under load (load average ~110) all three time out (no mismatch): a gate run on a busy
   host can go red for no real reason. **Fix:** explicit generous timeouts on these tests (or collect mismatches and
   assert once, which needs a recorded decision since it reshapes upstream tests).
2. **low**: tables.ts:475-479 `wrapping_add_signed` became plain `+`. The PORT argument holds for every `&str`; a TS
   string with lone surrogates would be measured as code units 0xD800-0xDFFF (no caller passes one).
3. **low (decision)**: the tables are generated from the crate's own tables.rs (validated by the probe), not "from the
   oracle" as PORTING §6 says. Reasonable; root should record it.

