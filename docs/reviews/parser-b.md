# Wave 6b/6c review: parser-expr, parser-item, parser-diag, parser-tests, driver-session, unicode-width-str (independent reviewer, lane review-parser-b)

Reviewed at main `5659298` against upstream at the pin `6f5da406b56c`, oracle `rustc 1.101.0-nightly (6f5da406b 2026-10-10)`
(aarch64-apple-darwin). Handoffs: `docs/handoff/{parser-expr,parser-item,parser-diag,parser-tests,driver-session,unicode-width-str}.md`.

Method:
- `coverage.ts --check`: markers ok (3642; vendor 2323). `--missing`: expr.rs 143/143, expr/diagnostics.rs 12/12,
  item.rs 81/81, diagnostics.rs 88/88, tests.rs 75/75.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools` (quiet host): 1999 pass, 1 skip (pre-existing), 0 fail, 0 todo.
- Marker-order scan (upstream line must not decrease per upstream path within a TS file): no descent in expr.ts,
  expr/diagnostics.ts, item.ts, diagnostics.ts, tests.test.ts. Driver descents: batch 5 finding 12.
- Line-by-line comparison by five sub-reviewers (one per batch; tests and unicode-width shared one). I re-ran every
  high/med repro myself (scratch `$RUST_TS_DATA/tmp/review-parser-b/`, deleted after the review per lane rules;
  every repro below is self-contained).
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
     `-Zunpretty=ast-tree` still match. Items hit the same limit: `python3 -c "n=5000; print('mod a {'*n + '}'*n)"`
     with `-Zparse-crate-root-only` exits 0 in rustc and 101 in rust-ts (4,500 still matches); 1,500 nested `if` is fine.
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

## Batch 2: parser-item (item.rs): **ACCEPT** (low follow-up; deep nesting is batch 1 finding 1)

Checked line by line, all 81 fns, matching upstream: `parse_crate_mod`/`parse_item_mod`/`parse_mod` (inject_use_span,
the `let`/`let mut` help), `parse_item_`/`parse_item_common` (the metavar path still panics "an actual item" on
`Some(None)`), `parse_item_kind` (branch order identical, the `def_` `mem::replace` closure, the case-insensitive
recursion), `recover_import_as_use` (cancel + restore), `parse_item_macro` (edit-distance suggestion), `parse_item_impl`
(all span computations, gating and error order), impl restrictions, delegation (`reuse`) fns, `parse_item_list`
(`A || B && C && D` precedence kept), `check_trait_front_matter` (the expected-token side effects of `check_keyword`
are preserved by the short-circuit order), use-tree fns + `emit_error_attr_in_use_tree`, extern crate (dashes),
foreign mods, static/const items (non-short-circuit `|` checks, where-clause merge), enum/struct/union bodies,
`field_def_extras` and default field values, decl macros / `macro_rules!`, `recover_nested_adt_item`,
`check_impl_frontmatter`, `try_recover_const_missing_semi`. The 8 PORT decisions do not change behaviour.
item.test.ts `PENDING` is empty.

- **Out-of-line `mod foo;`.** Under `-Zunpretty=ast-tree` and `=normal` rustc does **not** load module files: module
  loading happens during expansion, after the pretty-print point. Missing `foo.rs`, a `foo.rs` with syntax errors,
  `foo/mod.rs`, `#[path = "..."]`, nested `mod a { mod b; }` and `mod foo;` inside a fn body all print the same AST
  with no diagnostics in both rustc and rust-ts (rc 0/0, identical output). `-Zunpretty=expanded` is an honest 70
  (expansion unported). So file loading is untested until M2; the expand lane must port `parse_external_mod`.
- **Oracle:** ~590 crafted inputs (sub-reviewer, `tmp/review-parser-b/item/c1..c11`), editions 2015/2021 (parts on all
  four), c1-c8 again with `-Zunpretty=normal`: zero divergences. They cover `macro_rules!` in every delimiter form with
  and without `;`, `= {}`, missing `!`, misspellings; macros 2.0; impl headers (`impl<T> for X`, `impl !T for`,
  `impl const`, missing self type, `default impl`, `impl impl Tr for`, `impl ?Sized for`); `impl(crate|self|in path|foo)`
  restrictions; `auto`/`const`/`unsafe` trait combos; trait aliases; extern blocks (`unsafe extern`,
  `extern "C" unsafe {}`, `safe` items, `static mut`, `const` in extern, fn bodies); extern crate (rename, `self`,
  dashes); use trees (nested, glob, `self`, `::{}`, `{}`, `a::;`, single colon, attributes in the tree, `import`/
  `using`/`require` recovery); default field values (named, tuple, enum variants, garbage exprs); `const _`; missing
  types; generic consts + where clauses in both positions; 25 fn-qualifier-order variants; `pub(in path)`/`pub(foo)`;
  misplaced `default`; enums with discriminants / missing commas; struct-body recovery; attributes with no item;
  inner-attribute placement; `reuse`; wrong-case keywords; VCS conflict markers in item lists.

### Findings
1. **low**: item.ts:2770 `encountered_colon ||= ...` short-circuits where item.rs:2224 uses `|=`. The RHS
   (`is_ident`, `look_ahead`) has no side effects, so it is unobservable; the lane gave the analogous `|` cases a
   PORT note (decision 4) but not this one. **Fix:** `encountered_colon = (rhs) || encountered_colon`, or a PORT note.

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

## Batch 5: driver-session (getopts, config/session subset, rustc_interface, rustc_driver_impl): **ACCEPT-WITH-FIXES**

Checked and matching (about 250 CLI comparisons, stdout + stderr + exit code; sub-reviewer `tmp/review-parser-b/driver/`):
- **getopts 0.2.24** line by line (`parse`, `usage_items`, `long_to_short`, `find_opt`, `format_option`,
  `each_split_within`, `Fail` Display, `Matches`); edge cases through rustc: trailing `-Z`/`-C`/`-o`/`--crate-name`/
  `-L`/`-W`/`--cap-lints`/`--edition`/`--extern`/`--print` with no value, `--`, `---foo`, `--=x`, `-ZZ`, `-vv`,
  `-gO`, non-ASCII options, `--version=foo`. `bun test src/vendor/getopts src/rustc_driver_impl`: 108 pass, 0 todo.
- **`-Z`/`-C`**: `-Zunpretty` forms (repeated: last wins; no value; empty; bogus), `-Zui-testing=yes|no|...`,
  `-Zparse-crate-root-only`, `-Ztreat-err-as-bug` (101, prefix ok), `-Zdeduplicate-diagnostics=no`, `-Zteach`,
  `-Zmacro-backtrace`, ~50 more value/validation errors in `build_session_options`.
- **Lints / names / formats**: `-W/-A/-D/-F/--force-warn` incl. unknown names, `-Dwarnings`, `--cap-lints`, `-Wall`;
  `--crate-name` valid/`a-b`/empty/`é` and vs `#![crate_name]`; `--error-format=short|human|human-unicode|
  human-annotate-rs|bogus`, `--json=*`, `--color=always|never|auto|x`, `CLICOLOR_FORCE`/`NO_COLOR`/`TERM=dumb`.
- **Exit codes and dcx drops**: 0/1 everywhere tested, 101 on ICE, 70 only after a correct output prefix (~20 cases).
  `run_compiler` (interface.ts:233-284) follows interface.rs:500-536 in order: `catch_unwind` → `finish_diagnostics`
  → `abort_if_errors` (drop on unwind) → `flush_delayed` → `resume_unwind` (drop) / `drop_compiler_dcx`; I re-read
  both. Warning/error totals (`1 warning emitted`, `aborting due to 2 previous errors; 2 warnings emitted`) and stashed
  parser diagnostics flushed at finish match; buffered lints are dropped silently in both.
- **`--version`/`-vV`**: `-V`, `-vV`, `-V -v`, `-v -V`, `--version --verbose`, `RUSTC_OVERRIDE_VERSION_STRING`, with
  `--target`/`--sysroot`; `-v` alone. Help ordering (`-Zhelp`/`-Chelp`/`--help` combinations).
- **Inputs**: `@argfile` (plain, no final newline, CRLF, blank line, nested `@` literal, non-UTF-8 → `UTF-8 error`,
  empty, `@shell:` without `-Zshell-argfiles`), `-o`, `-o -`, `--out-dir`, `--emit=...=-`, editions incl. `future`,
  `RUSTC_BOOTSTRAP`, `--extern` forms, empty / BOM-only / shebang files, `RUST_MIN_STACK` errors.
- **Session stand-ins**: values match upstream defaults; target-derived fields are deferred (`defer_field`/Proxy),
  not guessed.

### Findings
1. **high**: session.ts:876 `validate_commandline_args_with_session_available` is an empty stub, so flags rustc rejects
   are accepted silently. Its PORT note admits it. Upstream session.rs:1545.
   - **Repro:** `echo 'fn main() {}' > ok.rs; rustc +nightly -Zunpretty=ast-tree -Cdwarf-version=7 ok.rs` → rc 1,
     `error: requested DWARF version 7 is not supported`; rust-ts → rc 0, no error. Same for `-Zregparm=5` (I re-ran
     both), and per the sub-reviewer `-Cprofile-use=/nonexistent.profdata`, `-Cprofile-sample-use=...`,
     `-Zsanitizer=memory|kcfi`, `-Zsanitizer-cfi-canonical-jump-tables=no`, `-Zvirtual-function-elimination`,
     `-Zreg-struct-return`, `-Zpacked-stack`, `-Zfunction-return=thunk-extern`; `-Zembed-source` and
     `-Zsmall-data-threshold=4` lose a warning.
   - **Fix:** port the checks that read only `opts` (profile paths `exists()`, dwarf_version, regparm > 3); for every
     other check, `unported(...)` when the flag it reads is non-default. The `split_debuginfo()` check also runs with
     default flags: cover it for the stand-in tuples or call `unported`.
2. **high**: the codegen-backend steps are skipped silently for non-default flags: interface.ts:204-227
   (`target_config`, `check_abi_required_features` as comments) and stand_ins.ts `LlvmCodegenBackend.init`. Upstream
   interface.rs:451-489, util.rs:95.
   - **Repro:** `-Zunpretty=ast-tree -Cllvm-args=-bogus ok.rs`: rustc rc 1 (LLVM `Unknown command line argument`, no
     AST); rust-ts rc 0 and prints the AST (re-ran). `-Ctarget-feature=+bogus` (re-ran), `-Ctarget-feature=-neon`,
     `-Ctarget-cpu=bogus`, `-Zretpoline`: rustc warns, rust-ts is silent.
   - **Fix:** `unported(...)` when `cg.target_feature`, `cg.target_cpu`, `cg.llvm_args`, `unstable_opts.llvm_plugins`
     or any other LLVM-init input is non-default.
3. **high**: args.ts:113 decodes argfiles with `new TextDecoder()`, which strips a UTF-8 BOM, and args.ts:118
   `str_lines` strips a final `\r` with no `\n` after it. Rust's `read_to_string` keeps U+FEFF and `str::lines` strips
   `\r` only before `\n`. Upstream args.rs:83, :26.
   - **Repro:** `printf '\xef\xbb\xbf-Zunpretty=ast-tree\nok.rs\n' > bom.txt`, then `@bom.txt`: rustc rc 1
     (`multiple input filenames provided (first two filenames are `\u{feff}-Zunpretty=ast-tree` and `ok.rs`)`);
     rust-ts rc 0 + AST. `printf -- '-Zunpretty=ast-tree\nok.rs\r' > cr.txt`, `@cr.txt`: rustc rc 1 (`couldn't find
     file`), rust-ts rc 0. Both re-ran.
   - **Fix:** `new TextDecoder("utf-8", { ignoreBOM: true })`; a std `str_lines` with Rust's exact semantics.
     (src/rustc_parse/lib.ts:240 has the same BOM-stripping decoder on a path unreachable today.)
4. **high**: non-UTF-8 argv. Bun decodes invalid bytes to U+FFFD, so args.ts:153 `raw_args` carries on with a
   different file name (its PORT note says decoded argv never holds invalid Unicode). Upstream args.rs:119, lib.rs:1468.
   - **Repro:** `cp ok.rs $'\xef\xbf\xbd.rs'; rustc +nightly -Zunpretty=ast-tree $'\xff.rs'`: rustc rc 101 (panic in
     `std::env::args`; rc 1 `argument 2 is not valid Unicode` with `RUST_BACKTRACE` set); rust-ts rc 0 + AST of the
     U+FFFD file (re-ran).
   - **Fix:** JS cannot recover the bytes: `unported("non-UTF-8 argv")` when an argument contains U+FFFD; fix the note.
5. **med (process; root cause of 1-2)**: handoff decision 4 ("steps not run" because they report nothing with
   default flags) should be rejected as written: every skipped step must call `unported` when any input it reads is
   non-default.
6. **med**: config.ts:1436 `CFG_COMPILER_HOST_TRIPLE` is derived from `process.platform/arch` (a guess: x64 Bun under
   Rosetta, musl, windows-gnu all differ), and an unlisted host is an ICE (101) via `unwrap`, not `unported`.
   **Fix:** read the host from the pinned oracle (record `rustc -vV` host in UPSTREAM.json or `.env.local`).
7. **med (queue)**: `--cfg`/`--check-cfg` are still unported (`-Zunpretty=ast-tree --cfg foo ok.rs`: rc 0/70, re-ran),
   but their blocker, the parser, has landed. compiletest passes `--cfg <revision>` for every revisioned test, so the
   harness-w7 `parse-ui` suite needs it. `parse_cfg` only needs `new_parser_from_source_str` + `parse_meta_item`.
8. **med (queue)**: the most common user error paths end in honest `unported` inside `std::io::Error`: a missing
   input file (`nonexist.rs`: rc 1/70, re-ran), a missing argfile, `-o` write errors, a directory or unreadable input.
   src/std/io.ts needs ENOENT/EACCES/EISDIR kinds and the strerror texts.
9. **med (queue)**: `--error-format=json`/`pretty-json` (session.ts:710, :946, `JsonEmitter`) and stdin `-`
   (lib.ts:266) are honest `unported`; compiletest drives ui tests with JSON, so no ui-style comparison can run
   through rust-ts until `JsonEmitter` lands.
10. **med (latent)**: the placeholder sysroot gives `None` for `real_rustc_dev_source_base_dir`; the oracle toolchain
    has rustc-dev, so rustc has `Some(..)`. Not visible at parse. Make `Sysroot::default` the oracle's or `unported`.
11. **low**: broken pipe: `rustc -Zhelp | head -1` exits 141 (rustc uses `-Zon-broken-pipe=kill`); rust-ts exits 1
    (print.ts:18, config.ts:80 `write_fd` turn EPIPE into `FatalError`). **Fix:** exit via SIGPIPE/141 on EPIPE.
12. **low**: marker order: config.ts:3272 `is_nightly_build` (config.rs:3211) after `check_nightly_options` (3215);
    session.ts:652 `as_usize` (session.rs:590) after `sanitizers` (1263).
13. **low (latent)**: the `EarlyDiagCtxt` drops of `main`, `compiler_entrypoint`'s early returns and the two inside
    `run_compiler` are not modelled. Nothing is pending on them today.
14. **low**: non-unwind JS errors (`TypeError`, `RangeError`; see batch 1 finding 1) inside `run_compiler`'s `f` skip
    `finish_diagnostics` and the dcx drop, where rustc's `catch_unwind` would print `aborting due to N previous
    errors` before the ICE. The ICE text (`install_ice_hook`/`report_ice`, `rustc-ice-*.txt`) is not ported and
    has no `unported` call; acceptable because 101 is compared by code, but root should record it.
15. **low**: `RUSTC_LOG=` (set but empty) exits 70, where upstream installs an empty filter (lib.ts:778). Honest.
16. **low**: `-Zcodegen-backend=dummy` is unported (util.ts); `DummyCodegenBackend` is ~10 lines.
17. **low**: the handoff is stale (`pending_parser.ts`, "every sampled case stops at the parser shim", 9 todos, the
    "35 exact matches" list). Root should mark it historical or refresh it.

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

## Summary for root

| Batch | Verdict | Blocking fixes |
|---|---|---|
| parser-expr | ACCEPT | none in expr.rs logic; high 1 (JS stack depth) is a runtime/driver item, see below |
| parser-item | ACCEPT | none (1 low) |
| parser-diag | ACCEPT | none (2 low) |
| parser-tests | ACCEPT | none (5 low) |
| driver-session | ACCEPT-WITH-FIXES | high 1-4 (unported guards for skipped validation/LLVM-init steps, argfile BOM/`\r`, non-UTF-8 argv), med 5 (reject decision 4 as written), med 6 (host tuple) |
| unicode-width-str | ACCEPT | med 1 (test timeouts) before the next gate on a loaded host |

No `unported(...)` path in these six batches is replaced by a guessed value, except the driver stubs named in
batch 5 findings 1, 2 and 6. The parser itself held up to everything thrown at it beyond tests/ui (≈8,000 fuzzed and
≈1,100 hand-written inputs, all editions, five diagnostic-format variants): the only parser-side divergence is the JS
stack depth.

Suggested queue / decision records:
1. **Stack depth** (batch 1 finding 1): run the compiler on a larger JS stack, sized to reach rustc's depth (parens
   >= 6,000, nested `mod` >= 5,000), before or with fmt-perf (whose deep-nesting cases will hit it next); or record a
   depth limit and make the harness report `RangeError: Maximum call stack` as its own class.
2. `--cfg`/`--check-cfg`, io::Error kinds (missing input file) and `JsonEmitter` ahead of the harness-w7 `parse-ui`
   suite (batch 5 findings 7-9).
3. PORTING §8: never use a `SnapshotParser` after `restore_snapshot` (batch 3 finding 1).
4. Record: unicode tables are generated from the crate's tables.rs and validated by the probe (batch 6 finding 3).
5. A `--check` regenerator for the parser oracle fixtures (batch 4 finding 4).
