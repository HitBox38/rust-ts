# Handoff: fix-w456 (fixer for reviews w456a + w456b)

Branch `lane/fix-w456`, base `622b706`. Commits are on the branch only (no merge or push).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 856 pass, 1 skip (the pre-existing linux-only one), 0 fail.
- `bun scripts/coverage.ts --check`: markers ok (2714; vendor 2173).
- `RUST_TS_AGENT=fix-w456 bun scripts/difftest.ts --suite <s> --sample 300`: lex 300/300, emit 300/300, fluent-format 300/300 MATCH.
- Coverage: ast.rs 160/160, ast_traits.rs 48/48, mut_visit.rs 18/18, rustc_ast_ir visit.rs 16/16, pprust/state.rs 131/131,
  options.rs 100/100. rustc_data_structures/flat_map_in_place.rs is new in the report: 1 marker (:18), with :10/:26/:79 listed as missing. That file was not assigned.
- No new `unported(...)`.

## w456b
- **E1 (MED) termize fd leak: fixed.** `ioctl_tiocgwinsz` destroys the `WriteStream` in `finally`, but only for fds 0..=2.
  - Measured on Bun 1.4.3: for a stdio fd, Bun opens its own writer fd, and `destroy()` closes it synchronously.
  - For any other fd (the `/dev/tty` fd), Bun borrows the caller's fd and `destroy()` closes it *asynchronously*. That happens after the caller's `closeSync`, so it closes whatever fd reused the number. The naive fix killed an unrelated fd in a repro.
  - So the `/dev/tty` stream is not destroyed: it holds no fd of its own and is not closed on GC. `closeSync` stays the only close (`// PORT:` in unix.ts).
  - Test: `src/vendor/termize/lib.test.ts` runs 300 `dimensions()` calls under a pty via `script`, once on the stdio branch and once on the `/dev/tty` branch. It checks that the `/dev/fd` count is stable and that an fd opened afterwards survives a tick. It skips when no pty is reachable.
  - The test fails on the old code (stdio branch) and on the naive fix (`/dev/tty` branch).
- E2: not assigned (root decision 2026-10-12 22:46).
- **O1 `target_modifier_consistency_check` order: fixed.** The module now sits above `class TargetModifier`, and there are no marker descents in options.ts.
- **S3 CFG_VER_DATE: fixed (test only).** `diagnostics.test.ts` checks it against `UPSTREAM.json` `commitDate`. The same check for `CFG_RELEASE` is in the new `src/rustc_ast/attr/version.test.ts`.
- **D1 stale codegen-diag handoff: fixed.** A "superseded in part" note is at the top.
- **D2 diag-expand cache: fixed.**
  - The build dir is now `$RUST_TS_DATA/tmp/diag-expand/target`.
  - The key now includes `rustc -vV` and a sha256 of the input files plus every rustc_macros source.
  - Re-run: rustc_session 69/69 identical.
  - The old `$RUST_TS_DATA/target/diag-expand` can be deleted.
- **D3 White_Space: fixed.** `split_whitespace` now uses `/\p{White_Space}+/u`.
- D4 (nit, `eat_argument` marker on a closure): not assigned, left.
- **L1 lint-defs oracle commit check: fixed.** A toolchain that is not at the pin counts as "unavailable": the test skips, or fails under REQUIRE_PROBES.
- **L3 / F1 generator fingerprints: fixed.**
  - lints.ts now fingerprints `declare_lint_pass!` and `impl_lint_pass!` too (I checked that the emitted pass class matches both bodies).
  - features.ts fingerprints both `declare_features` bodies in accepted.rs and removed.rs, plus `opt_nonzero_u32!` and `status_to_enum!`.
  - The unstable.rs `declare_features` fingerprint covers the incomplete/internal fallback text.
  - Both generators' `--check` are up to date.
- **X1 lexer fixture lint comparison: deferred.** `src/rustc_parse/lexer/lexer.test.ts` belongs to lane parser-core, which this lane may not edit. Queue it for that lane.
- L2, S1, S2, O2, O3, X2, X3: not assigned.

## w456a
### ast-core
- **1 `header_span` eager default: fixed.**
  - The receiver is evaluated before the default, matching `unwrap_or`'s order of span interning.
  - `extern_span` had the reverse order (default before receiver); it is fixed the same way.
- **2 marker order: fixed.** `display_CoroutineKind` and `display_InlineAsmTemplatePiece` are back at their upstream positions. The only remaining descents are the accepted companion-const ones.
- **3 stale `ExprPrecedence` PORT: fixed.** The comment is reworded; the variants stay as string literals.
- **4 header comment: fixed.** ast.ts:40-46 now matches PORTING §8 / decision #29. The `types.sets.json` note is updated too.
- **5 PORT between marker and fn: fixed** at all five places.
- 6 (`display_*` ignoring formatter flags): not assigned.
- **7 test gaps: fixed.**
  - Covered: `Param::to_self`/`from_self`, `UseTree`, `Pat::to_ty` Ref/Slice, `Expr::to_ty` Binary/Repeat, the `FnSig` span fns (8 header combinations), `CfgEntry::lower_spans`, and `optionally_braced_mac_call` returning Some.
  - Every expectation comes from the oracle: `src/rustc_ast/fixtures/ast_core_oracle/probe.rs` → `probe.out` (86 lines, all compared). Command: `rustc +nightly-2026-10-11 --edition 2024 probe.rs -o probe && DYLD_LIBRARY_PATH=$(rustc +nightly-2026-10-11 --print sysroot)/lib ./probe`, with commit-hash = pin.
  - Bare `toThrow()` is replaced with the exact panic texts.
  - No divergences.

### ast-visit
- **M1 (MED) `Result` footgun: fixed.** The `()` impl's `branch` panics on any non-`undefined` value, and `from_branch` panics on a Break (`UNIT_RESULT_MISMATCH`). The regression test is the reviewer's footgun.
- **M2 (MED) `AstNodeWrapper.from_mut`: fixed.**
  - `from_mut(node)` returns a wrapper whose `wrapped` is an accessor. Reading it returns the caller's node object. Storing into it replaces that node in place with `replace_in_place`, which is new in `src/std/mut_ref.ts`.
  - `Object.assign(w, other_wrapper)` writes through as well.
  - Test: a MutVisitor's `visit_method_receiver_expr` replaces the receiver through `from_mut`, and the change reaches the `MethodCall` slot.
  - **Rule for the expand lane:** `*node = x` on a `&mut AstNodeWrapper` from `from_mut` is written `node.wrapped = x.wrapped`, `Object.assign(node, x)` or `replace_in_place(node, x)`. Never rebind a local holding the wrapper, and never keep a separate reference to the old node contents expecting them to survive.
  - On `&mut Node` hooks in general, `*node = new` stays `replace_in_place(node, new)`, per the mut_visit.ts header.
  - Recorded as a decision.
- **L3 `flat_map_in_place` marker: fixed** (marker added). It was not moved into src/rustc_data_structures, because that file was not assigned.
- **L4 two `()` encodings: fixed and recorded.**
  - A fn or hook *returning* `()` returns `undefined`.
  - `()` as a *stored value* is `null`: fields, `Result`/`Option`/`ControlFlow` payloads, and type arguments. This is the codegen mapping, and it keeps `Some(())` distinct from `None`.
  - Accordingly, `VisitorResult.Result()` is `Result<null, E>` (`Ok(null)`), and `ControlFlow`'s default `C` is `null` (`CONTINUE._0 === null`).
- **L5 cleanup: fixed.**
  - The unused `unported` imports are removed.
  - `field_ref`/`field_mut` are now one `field_mut` in `src/std/mut_ref.ts`, which also holds `MutRef`; `rustc_span/hygiene.ts` re-exports it.
  - The private `field_ref` copy in vendor anstream is left alone.
- **L6 tests: fixed.** Added: a `ControlFlow<()>` Break, the `Impl` walk order with and without `of_trait` (immutable and mutable), and the mutable `Spanned` visiting span before node.
- L7 (move `ControlFlow` to src/std/ops.ts): not assigned.

### codegen-derive
- **M1 (MED) tuple clone sharing: fixed.**
  - `isCopy` now treats a tuple as a value only when it is `()`. Clones rebuild tuples (`[...x]` when every element is a value).
  - Regenerated every set (rustc_lexer, rustc_ast, rustc_errors, rustc_lint_defs, rustc_parse, rustc_session). The only diffs are the three tuple clones (`InlineAsm.template_strs`, `InlineAsm.clobber_abis`, `DelegationSuffixes::List`).
  - The repro is now a test in `derive_clone.test.ts`; it fails on the old generated code.
- **L1/L2 header vs decision: fixed** (see ast-core 4).
- **L3 TDZ: fixed.**
  - The generator header of walkable.gen.ts / mut_walkable.gen.ts now states the load rule.
  - A fresh-process test checks that visit.ts, mut_visit.ts and lib.ts load, and that entering walkable.gen.ts first fails (the documented hazard).
- **L4 fixture: fixed.** `rustc_ast.typedefs.json` is refreshed from the probe (minified). Output regenerated from it equals the committed `.gen.ts` files, except for import paths.
  - Not assigned: `rustc_lexer.typedefs.json` also differs from today's probe output; parse/session are current.
- **L5 `clone_TokenCursor`: fixed.** The hand version is deleted; `tokenstream.ts` uses `gen.clone_TokenCursor`.
- L6 (handoff count): not assigned.
- Root note: `bun tools/codegen/types.ts rustc_lexer` writes an untracked `src/rustc_lexer/lib.gen.ts`, which nothing imports. I deleted it.

### ast-attr
- 1/2 (lib.ts rule, `<Trait>_provided`): already in PORTING §8 (root).
- **3 ext fixture + exact panics: fixed.**
  - New files in `src/rustc_ast/attr/testdata/`: `ext.rs`, `ext.ast-tree.txt`, `ext_oracle.rs` and `ext.oracle.txt`.
  - My regenerated oracle output is byte-identical to the reviewer's. The run needs `--edition 2024` (or 2021): under 2015, `c"x"` is not a C string. The fixture header records this.
  - Two tests: the rebuilt attributes print identically, and all queries match line by line.
  - Both remaining bare `toThrow()` now assert exact panic texts.
- 4 (`norm()` narrowing): not assigned.
- **5 rustc_ast_ir unit tests: fixed.** New `src/rustc_ast_ir/lib.test.ts`; its expectations come from a rustc_private program, which is quoted in the header.

### pp / pprust
- **L1 slice-bounds panics: fixed.**
  - `print_path` / `print_qpath` use the new `slice_to` / `slice_from` in `src/std/slice.ts`.
  - Wrapped usize values are printed as u64, matching Rust's range-index panic text. I checked the texts against the oracle with `-C overflow-checks=off`.
- 2 (`Array.shift` perf), 4 (BoxMarker balance), 7 (comment-placement suite): not assigned or deferred. 3 was ratified by root.
- **L5 escape_debug triplication: fixed.** `escape_char` is exported from `src/std/fmt.ts`. state.ts `str_escape_debug` and the expr.ts template both use it; `char_escape_debug` is deleted.
- **L6 missing PORT notes: fixed.** Added at item.ts `DelegationKind` and expr.ts `Ok(n) | Err(n)` (×3).

## PORT decisions added
- `src/vendor/termize/platform/unix.ts` `ioctl_tiocgwinsz`: fd ownership, as described under E1.
- `src/rustc_ast_ir/visit.ts`: the unit-impl guard, and the `()` encodings by role.
- `src/rustc_ast/ast_traits.ts` `from_mut`: the write-through accessor.
- `tools/codegen/types.ts` `isCopy`: tuples are never identity.
- `src/rustc_ast/ast.ts` `header_span` / `extern_span`: evaluation order.
- `src/rustc_ast_pretty/pprust/state.ts`: wrapped `len - depth`.
- `src/rustc_session/options.ts`: placement of the consistency-check module.

## Left for root
- `docs/claims/wave6b-fix-w456.md` can be removed on integration.
- Delete `$RUST_TS_DATA/target/diag-expand`, which is now unused.
- Queue X1 (lexer fixture lints) for parser-core.
