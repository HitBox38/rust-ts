# Handoff: parser-pat-stmt (wave 6c parser porter)

Branch `lane/parser-pat-stmt`, based on b9444b5. Not merged; a throwaway merge with main at 0349d96
(parser-fn-asm, parser-tests, unicode-width-str integrated) was clean: tsc clean, `bun test src/rustc_parse`
595 pass / 0 fail.

## Files
- `src/rustc_parse/parser/pat.ts`: all of pat.rs (52/52). Filled the stub; `Expected.to_string_or_fallback`
  and `make_all_value_bindings_mutable` filled in place. The `unported_methods` call is gone.
- `src/rustc_parse/parser/stmt.ts`: all of stmt.rs (27/27). The `unported_methods` call is gone.
- New tests: `src/rustc_parse/parser/pat.test.ts` and `src/rustc_parse/parser/stmt.test.ts`.
- New test data, following the `src/rustc_ast/attr/testdata/` precedent (not ports, no markers):
  - `src/rustc_parse/parser/testdata/pat_stmt_oracle.json`: the fixture (119 cases).
  - `src/rustc_parse/parser/testdata/pat_stmt_harness.ts`: the harness both test files share.
- Not touched: decls.ts and every other lane's files.

## Evidence
- `bunx tsc --noEmit -p .` is clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 1252 pass, 0 fail, 1 skip. The skip is pre-existing:
  `read_binary_file_handles_lying_stat`, which is `skipIf(platform !== "linux")`. There is no todo or `.only`.
- `bun scripts/coverage.ts --check`: `markers ok (3158; vendor 2278)`. `--missing`: pat.rs 52/52, stmt.rs 27/27.
- `RUST_TS_AGENT=parser-pat-stmt bun scripts/difftest.ts --suite tokens --sample 200`: 200/200 MATCH
  (run `20261013-004610-parser-pat-stmt-p9od`).

## Tests: how the expectations were obtained
- **Oracle.** Each case wraps a snippet into `t.rs` and runs
  `rustc +nightly-2026-10-11 -Zunpretty=ast-tree -Zui-testing --edition 2024 t.rs`. The wrappers are:
  - `let`: `fn f() { let <src>; }`
  - `for`: `fn f() { for <src> in x {} }`
  - `closure`: `fn f() { |<src>| (); }`
  - `block`: `fn f() {\n<src>\n}`
  - `stmt`: `fn f() { <src> }`
- **What the fixture keeps.**
  - The subtree for the node under test:
    - the first `pat: Pat {` (Local.pat / ForLoop.pat / Param.pat)
    - the fn's `body: Some(Block {..})`
    - or the body's first `Stmt`
  - The subtree is taken from its opening line to the closing `},` at the same indentation, then dedented.
  - stderr, minus the driver trailer (`error: aborting due to ..`, the `rustc --explain` lines).
  - The rule is written out in the fixture's `_how`. The generator source is in `_gen`; the scratch copy and
    `cases.json` are in `$RUST_TS_DATA/tmp/parser-pat-stmt/`.
- **What the TS side does.** The harness parses the same `t.rs` and bumps the leading tokens. It then calls
  the entry point rustc uses at that position:
  - let: `parse_pat_before_ty(None, RecoverComma::Yes, LetBinding)` (stmt.rs:330)
  - for: `parse_pat_allow_top_guard(None, Yes, Yes, LikelyTuple)` (expr.rs:2766)
  - closure: `parse_pat_no_top_alt(Some(ParameterName), None)` (expr.rs:2428)
  - block: `parse_block()`. A fn body without inner attributes parses the same as function.rs:265's
    `parse_block_common`.
  - stmt: `parse_full_stmt(AttemptLocalParseRecovery::Yes)`
  - The `{:#?}` output and the `-Zui-testing` stderr must equal the oracle byte for byte. Stashed
    diagnostics are flushed at the end, as the driver does.
- **What the cases cover.**
  - Patterns:
    - or-patterns (nested, top-level, leading `|`, trailing `|`, `||`)
    - `mut`, `ref`, `ref mut`, `mut ref`, `mut mut`, `mut (a, b)`, `mut _`
    - tuples and parens, `(..)`, slices with `..`, `x @ ..`, and both `@` recoveries
    - `&`, `&mut`, `&&`, `&'a`
    - `box` (both forms), `ref box`, `!`, `let let`, `...` (rest and closure var-args)
    - literals: int, negative, str, char, bool, the unclosed char `'a`
    - ranges: `..=`, `..`, half-open, `..=X`, `..X`, deprecated `1...5` and `...5`, negative bounds, path
      bounds, `..=` with no end, `..==`, and parenthesised bounds
    - struct patterns (`..`, `.., ,`, `.., a`, `box` field), tuple-struct patterns, paths, qpaths, macro
      patterns, an expression in a pattern, a reserved ident, inline tuple type ascription
  - Statements:
    - `let` declarations
    - let-else, plus its `&&`, `}` and `else if` errors, and `let x = 1 else {}`
    - missing `;`, `let mut mut x`, `mut let`, `auto`, `var`, a missing `let`, `let const`, `super let`, `+=`,
      and the `:`/`=` typo
    - attributes, doc comments, trailing attributes and doc comments
    - item statements
    - macro statements: `;`, braces, no braces, `.y`, `{}.y`
    - empty statements, expression and tail statements, assignment-else, missing `;` between
      expressions, malformed loop labels
- **Real mode.** A case must match the oracle, or throw exactly its PENDING `Unported`.
  - Today all 119 cases are PENDING, because every path reaches another lane:
    - `expr::is_builtin`: 52
    - `diagnostics::maybe_recover_unexpected_block_label`: 42
    - `diagnostics::dcx`: 8
    - `ty::parse_pin_and_mut`: 6
    - `diagnostics::maybe_recover_from_bad_qpath`: 5
    - `expr::parse_literal_maybe_minus`: 4
    - `item::*`: 2
  - Root deletes a case from PENDING when it starts to match. The test fails until then.
- **Shimmed mode, so this lane's code is checked now.** The harness temporarily replaces a few other-lane
  fns with test-side copies of their upstream bodies. Each copy covers only the branches the cases take; any
  other branch throws `ShimMiss`. The shimmed fns are:
  - diagnostics.rs: `dcx`, `AttemptLocalParseRecovery::{yes,no}`, `maybe_recover_from_bad_qpath`,
    `maybe_recover_unexpected_block_label`, `maybe_suggest_struct_literal`, `is_vcs_conflict_marker`,
    `expect_semi`, `maybe_recover_unexpected_comma`, `is_lit_bad_ident`
  - expr.rs: `is_builtin`, `mk_expr*`, `parse_literal_maybe_minus`
  - ty.rs: `parse_pin_and_mut`

  Results in shimmed mode:
  - **72 of the 119 cases match byte for byte** (`SHIMMED` lists them):
    - 59 of the 72 pattern cases
    - 13 of the 47 statement cases
  - No case differs from the oracle. The other 47 still reach unported code: parse_path, item, parse_ty or
    parse_expr.
- **Negative control.** Appending a character to every stderr fails all 72 shimmed matches. Doing the same
  to every tree also fails all 72.
- **Fix found while testing.** In `maybe_add_suggestions_then_emit`, the arm-guard block shadows `expr` with
  the parenthesised form, and the `Const` suggestion uses the outer snippet. This is fixed and has a PORT
  note.

## `unported(...)` left
None in pat.ts or stmt.ts. Every remaining Unported is a call into another lane: diagnostics, expr,
expr/diagnostics, ty, path and item.

## PORT decisions (please record)
1. **Writing a new `BindingMode` instead of mutating it.** `*br = byref; *m = Mutability::Mut` in
   `parse_pat_ident_mut`, and `*m = Mut` in `AddMut`, store a new `BindingMode`. They do not mutate the old
   one, because `PatKind::Ident` may hold the shared `BindingMode.NONE` instance.
2. **Other in-place writes.** These are writes into fresh enum objects, upstream's `&mut` place writes:
   - `*sub = Some(lhs)`: `k._2 = lhs`
   - `*syn = DotDotEq`: a new `re.node`
   - `*expr = ..` in `parse_full_stmt` and `try_recover_let_missing_semi`: `kind._0 = ..`, with
     `field_mut(kind, "_0")` as the `MutRef<Expr>` for `check_mistyped_turbofish_with_multiple_type_params`
3. **Moving parser state.**
   - `mem::replace(self, snapshot)` in `parse_local` is `move_parser(this)`, a shallow move into a fresh
     `Parser`, followed by `replace_in_place(this, snapshot)`.
   - `*self = snapshot` is `replace_in_place(this, snapshot)` (std/mut_ref.ts).
4. **`maybe_recover_from_interpolated_ty_qpath!(self, true)`** (mod.rs:165) is expanded inline at the top of
   `parse_pat_with_range_pat`.
5. **Long `if .. else if let` chains.** The one in `parse_pat_with_range_pat` is a labelled block; each arm
   breaks after it assigns. Guarded `match` arms are if-chains in arm order. `'break_recover:` is a labelled
   block.
6. **Fn-local types.** `PatVisitor`, `AddMut` and `IdentFinder` are fn-local classes that extend
   `visit.Visitor` / `mut_visit.MutVisitor`. Their method markers point at the upstream `fn` lines.
7. **`RecoverQPath` impls.** `maybe_recover_from_bad_qpath` gets `RecoverQPath.Pat` for `Pat` and
   `RecoverQPath.Box(RecoverQPath.Expr)` for `Box<Expr>` in `parse_stmt_mac`. Both tables are read at call
   time.
8. **String helpers.**
   - `str::to_uppercase` is `toUpperCase()`.
   - `char::is_uppercase` is `/\p{Uppercase}/u`. This duplicates mod.ts's private helper; it is a std
     candidate.
   - `err.args["expr_precedence"]` on a missing key panics, as `IndexMap` indexing does.
9. **`suggest_eq_dot_suffix`** (stmt.ts) holds the `let mut snapshot = ..; let Ok(_) = snapshot.parse_dot_suffix_expr(..)`
   tail of the `suggest_eq` let-chain. It is a local helper with no upstream fn; the chain order is kept.
10. **Test data layout.** Test data lives in `parser/testdata/`: the fixture, plus a harness module shared by
    pat.test.ts and stmt.test.ts.

## For root
1. **Resolved** (review parser-a, batch 3 finding 2: expr/diagnostics.ts now takes `op: AssocOp`; the cast is gone). **Contract mismatch, not in my files.** `src/rustc_parse/parser/expr/diagnostics.ts` stubs
   `op_can_continue_stmt_expr_unambiguously(_token: Token)`. Upstream (expr/diagnostics.rs:301) takes
   `op: AssocOp`, and stmt.rs:1137 calls it with `op.node`.
   - stmt.ts calls it through a cast to the upstream signature, marked `// PORT(contract)`. The cast compiles
     with either signature.
   - Please fix the stub signature, or have the expr lane fix it.
2. **When other lanes land.** Delete the cases that start to match from `PENDING` in pat.test.ts and
   stmt.test.ts. When a lane covers a branch that a shim misses, a case may also start to match in shimmed
   mode; adding it to `SHIMMED` is optional, but tightens the test.
3. **std candidates:**
   - `char::is_uppercase`, also in mod.ts
   - `str::to_uppercase`
4. **Claim file.** Delete `docs/claims/wave6c-parser-pat-stmt.md` on integration.
