# Handoff: fix-w23b (fixer for docs/reviews/w23b.md)

Branch `lane/fix-w23b`. Commits: `a907618` (ast-token), plus the errors-core commit that adds this file.

## Findings

### ast-token
- **F1 (high)**: fixed in `a907618`. `src/rustc_ast/tokenstream.ts` `desugared_tts`: the `count` update is now `(count + 1) & 0xff`, the final mask is gone, and the PORT note now reads "`u8` arithmetic wraps; rustc ships without overflow checks". The new test is in `src/rustc_ast/tokenstream.test.ts`. Expected values come from an oracle `stringify!` probe (scratch program, pinned nightly) on doc texts with 0/1/3/253..256/300 `#`s:
  - 0 → 0, `"d"` → 1, `"##d##"` → 3, `"` → 1, `"#` → 2, `"###` → 4
  - `"`+253 → 254, then 254/255/256/300 → 255
  - `"`+300 followed by `"##` → 255
- **F2 (med)**: fixed in `a907618`. `LitKind_eq` `Err` arm is now `return b.$ === "Err"`, with a PORT note: ErrorGuaranteed is a ZST.
  - The grep turned up no other `_eq` helper that compares `ErrorGuaranteed` (none hand-written, and codegen emits no `_eq`). No generator change was needed.
  - Root: the "ZST, always equal" list the review mentions does not exist anywhere. Please add to PORTING §Traits: "`#[derive(PartialEq)]` fields of ZST types (`ErrorGuaranteed`, `()`) compare equal".
  - Test: `token.test.ts` "LitKind_eq: Err(_) == Err(_)".
- **F3 (med)**: fixed in `a907618`. Each test file states in its header how its expectations were obtained:
  - `src/rustc_ast/util/literal.test.ts`:
    - 22 literals: token `Lit` from `-Zunpretty=ast-tree`, `LitKind` `{:#?}` from `-Zunpretty=hir-tree` (`hir::Lit.node`), `LitKind` Display from `-Zunpretty=hir` (`print_literal` = `to_string()`). All compared byte-for-byte.
    - The `0x1f32` case.
    - 5 `LitError` cases, mapped from the oracle's `report_lit_error` diagnostics: InvalidIntSuffix, InvalidFloatSuffix, IntTooLarge(2), IntTooLarge(10), InvalidSuffix.
    - `0b102` and `NonDecimalFloat` are lexer errors at the pin (from_token_lit never sees them), so they are not oracle-reachable and are omitted.
  - `src/rustc_ast/token.test.ts`:
    - `glue`: 25 gluing pairs and 7 non-gluing adjacent pairs, from the lexer's token kinds (`-Zunpretty=ast-tree` on unexpanded `m!(...)`).
    - `break_two_token_op`: all 28 arms, plus `None` cases and the `n` assert. The pieces are the oracle's lexing of each piece's text.
    - The `glue` arms whose joint token is multi-char (`<`+`<=`, `>`+`>=`, `.`+`..`) cannot be reached from the lexer and are not covered.
  - `src/rustc_ast/tokenstream.test.ts`: `TokenCursor` over the oracle's ast-tree token tree for `m!(a, (b [c]){d}.);`. It checks the kinds, the spacing (including `DelimSpacing` open/close), `depth()` and `Eof`.
  - No harness oracle probe for literal cooking was added (a harness batch would be needed).
- **F4 (low)**: fixed in `a907618`. `src/std/slice.ts` has `extend(vec, items)` (loop push) and `splice(vec, start, len, replacement)` (no argument spread; core's range-check panic texts).
  - Every call-argument spread in `tokenstream.ts` now uses them. The `[...x]` array literals stay, since they are not call spreads.
  - `src/std/slice.test.ts` includes a 1M-element `extend`.
- **F5 (low)**: fixed in `a907618`.
  - `src/std/slice.ts` has `binary_search_by` (core's exact probe sequence, `library/core/src/slice/mod.rs:2982`) and `partition_point` built on it (mod.rs:4873).
  - `source_map.ts` drops its local copy and imports it. `attrs_and_tokens_to_token_trees` uses it, and its PORT note is gone.
  - The oracle test covers unpartitioned and unsorted inputs (scratch program).
- **F6**: already resolved on main. `ExprPrecedence_discriminant` is generated in `util/parser.gen.ts:81`, and `util/parser.ts:172` uses the generated one.
- **F7**: already resolved on main. `src/rustc_ast/lib.ts:28` has `import "./util/literal.ts"`.

### errors-core
- **F1 (med)**: fixed. Drop-bomb registry:
  - `Diag`'s constructor records every `Diag` holding a `DiagInner` in `DiagCtxtInner.live_diags`, a TS-only `Set` kept in creation order and created lazily (declared in lib.ts's module augmentation).
  - Every `self.diag.take()` site goes through the new `Diag.take_inner()`, which also unregisters: `with_dcx`, `upgrade_to_fatal`, `take_diag`, `cancel`, `drop`.
  - `DiagCtxtInner.drop()` first calls `.drop()` on the survivors in creation order, then runs the upstream body.
  - Driver hook: `drop_compiler_dcx(dcx, unwinding)` in `src/rust_ts/driver.ts`. The driver is still a stub, so nothing calls it yet.
  - **Driver lane must call it** at upstream's drop point, `rustc_interface::interface::run_compiler` (interface.rs:507-535), after `catch_unwind(f)`, `finish_diagnostics()`, `abort_if_errors()` (Ok path only) and `flush_delayed()`:
    - normal path: `drop_compiler_dcx(dcx, false)`;
    - when `f` threw a `Panic`/`FatalError`: `drop_compiler_dcx(dcx, true)`, then rethrow.
  - Known approximation: upstream drops a forgotten `Diag` at its scope end. Here it is dropped at the dcx drop, so its ICE output comes later.
  - Also: a `Diag` that upstream drops during an *inner* caught unwind (`catch_fatal_errors`-style) stays registered here and would fire at a normal-path drop. Revisit when those catch sites are ported.
- **F2 (med)**: deferred to the rustc_lint_defs lane, as recorded by root. `LintExpectationId` must become value-comparable (interned handle or canonical key), and `Level_eq` and `fulfilled_expectations` must compare by value.
- **F3 (med)**: already ratified by root (platform-cfg skips decision). Nothing to do.
- **F4 (low)**: fixed. `Backtrace.capture()` returns `Captured` when `RUST_LIB_BACKTRACE`/`RUST_BACKTRACE` enable it. `unported` remains only in `to_string()` for `Captured`.
  - The shim is still in `src/rustc_error_messages/diagnostic_impls.ts`. Moving it to `src/std` is a root follow-up, since `src/std/backtrace.ts` is not in my ownership.
- **F5 (low)**: fixed. `cancel_into_message` calls `this.drop()` before both `?`-style early returns. Test: a `DiagInner` with no messages fires the bomb.
- **F6 (low)**: fixed.
  - `src/std/panic.ts` has `assert_eq(left, right, debug, eq?)` and `assert_matches(left, matches, pattern, debug)`. Their texts follow core `assert_failed_inner` and were verified with a scratch program (`src/std/panic.test.ts`).
  - All 6 `assert_eq!` sites and the `assert_matches!` site in `rustc_errors/{lib,diagnostic}.ts` now use them, with `Level` Debug for the sides.
- **F7 (low)**: fixed.
  - `std::thread::panicking()` is now `panicking()` in `src/std/panic.ts`, backed by a counter, plus `while_unwinding(f)`. The local always-false stub in lib.ts is removed.
  - `Diag.drop` gained the missing `if !panicking()` guard (diagnostic.rs:1285).
  - `DiagCtxtInner.drop`'s `must_produce_diag` check uses the real `panicking()`.
  - The driver hook runs the unwinding path inside `while_unwinding`.
- **F8 (low)**: fixed. The new test "flush_delayed does nothing once an error exists" covers delayed bugs and an error guarantee present together (pushed directly, because emitting an error clears `delayed_bugs`). It asserts nothing is emitted and `delayed_bugs` is untouched. The old test's misleading comment is corrected.
- **F9 (low)**: fixed. Tests in "small helpers":
  - `ErrCode.from_u32(10000)` → `assertion failed: value <= 9999`, and `from_usize` → `... (9999 as usize)`.
  - Default max via `DefIndex`: `0xFFFF_FF00` (texts verified with a scratch program using the same `assert!` tokens).
- **F10 (low)**: fixed in `src/rustc_errors/lib.ts`. The `DiagCtxtHandle` class (impl 498-1152) now follows `impl DiagCtxt` (468-492), and `display_Level` (1623) precedes the `Level` companion. `diagnostic.ts:1304` (Debug `fmt`@390 after the class) is left as is; the review called it justified.
  - **Deferred** (owned by another lane), in `src/rustc_error_messages/lib.ts`: (a) move the `IntoDiagArg` interface (marker `into_diag_arg`@335, now at line 408 after 345) above `DiagArgValue`; (b) the doc comment at line 399 names `IntoDiagArg.number(n)`, which should be `IntoDiagArg.of(n, number_into_diag_arg)`.
- **F11 (low)**: fixed in `src/rustc_errors/dedup_hash.ts`.
  - The dead `encode_messages` is deleted.
  - The process-global `INTERNED` map is gone. `finish()` now takes the first 128 bits of SHA-256 over the token sequence; only equality is observable, and nothing is retained.
  - A PORT note lists the `Encoder`/`SpanEncoder` methods left out.
- **F12 (low)**: fixed in `tools/codegen/error_codes.ts`.
  - The list end is the first line that is only `);`.
  - The generator exits with `ERROR:` unless `git -C <upstream> rev-parse HEAD` equals the UPSTREAM.json pin.
  - The summary line prints the range (`E0001..E0806`). The errors-core handoff's "E0001..E0799" was wrong.
  - Regenerated: `error_codes.gen.ts` is byte-identical.

## Files touched
- `src/rustc_ast/{token,tokenstream}.ts`
- `src/rustc_ast/{token,tokenstream}.test.ts` (new)
- `src/rustc_ast/util/literal.test.ts` (new)
- `src/rustc_span/source_map.ts` (partition_point import only)
- `src/std/slice.ts` and `src/std/slice.test.ts` (new)
- `src/std/panic.ts` (additions) and `src/std/panic.test.ts` (new)
- `src/rustc_errors/{lib,diagnostic,dedup_hash}.ts`
- `src/rustc_errors/tests.test.ts`
- `src/rustc_error_messages/diagnostic_impls.ts`
- `src/rust_ts/driver.ts` (drop hook only)
- `tools/codegen/error_codes.ts`

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src tools`: 312 pass, 0 fail.
- `bun scripts/coverage.ts --check`: markers ok (1950).
- Coverage of touched upstream files:
  - rustc_ast: token.rs 72/72, tokenstream.rs 64/64, util/literal.rs 13/13
  - rustc_errors: lib.rs 98/98, diagnostic.rs 94/94, dedup_hash.rs 1/1
  - rustc_error_messages: diagnostic_impls.rs 18/18
- `difftest --suite lex --sample 300`: 300/300 MATCH. `--suite fluent-parse --sample 100`: 100/100 MATCH.

## unported / PORT
- No new `unported(...)`. The remaining one in my files is `Backtrace.to_string()` for `Captured`.
- New `// PORT:` notes:
  - `desugared_tts` u8 wrap
  - `LitKind_eq` ZST
  - `Diag` registry (`take_inner`) and `DiagCtxtInner.drop` survivors
  - `cancel_into_message` early drops
  - the `DedupHasher.finish` SHA-256 stand-in and the omitted encoder methods
