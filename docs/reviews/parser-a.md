# Waves 6b/6c review A: parser-core, parser-ptg, parser-pat-stmt, parser-fn-asm (independent reviewer, lane review-parser-a)

Reviewed at main `5659298`, against upstream at the pin `6f5da406b56c`. The handoffs are
`docs/handoff/{parser-core,parser-ptg,parser-pat-stmt,parser-fn-asm}.md`. The `parse` suite already matches
21,522/21,526 tests/ui files, so this review concentrates on what that suite does not exercise.

Method:
- `coverage.ts --check`: markers ok (3642). `--missing`: mod.rs 90/90, token_type.rs 10/10, attr.rs 12/12,
  attr_wrapper.rs 9/9, nonterminal.rs 4/4, lib.rs 13/13, path.rs 19/19, ty.rs 50/50, generics.rs 17/17, pat.rs 52/52,
  stmt.rs 27/27, function.rs 11/11, asm.rs 11/11, cfg_select.rs 1/1.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 1999 pass, 1 skip (pre-existing, linux-only
  `read_binary_file_handles_lying_stat`), 0 fail.
- Marker order: scanned with a script (upstream line must not decrease per upstream path; marker directly above code).
  One descent, mod.ts:215 `SeqSep::trailing_allowed` (mod.rs:295) after `Parser::new` (mod.rs:346) in the class body:
  acceptable under PORTING §8.
- Line-by-line comparison of every fn in all fourteen files. Six sub-reviewers each took a slice, and I re-checked
  every finding they raised myself. Scratch: `$RUST_TS_DATA/tmp/review-parser-a/`.
- Oracle: the pinned nightly (`rustc 1.101.0-nightly (6f5da406b 2026-10-10)`).
  - **Crafted inputs** through `-Zunpretty=ast-tree` (stdout, stderr and exit code, byte for byte, vs
    `bun src/rust_ts/main.ts` with the same args). About 1,500 distinct inputs and about 3,800 comparisons across
    editions 2015/2018/2021/2024. Per batch: mod/token_type 536, attr/attr_wrapper/lib about 400 (189 files),
    path/generics 665, ty 1,529, pat 143, stmt/function 516, plus about 60 of mine (token glue, edition keywords,
    deep recovery, attribute targets).
    **All match.**
  - **Mutation fuzzing of recovery paths.** I mutated small tests/ui files with 1 to 4 token edits each (delete,
    duplicate, swap, or insert from a list of 60 tokens) under a random edition. 2,000 files ran; 89% of them make
    rustc report errors. **2,000/2,000 match.**
  - **A rustc-dev review probe** for paths `-Zunpretty=ast-tree` cannot reach (`tmp/review-parser-a/probe/`:
    `probe.rs` and its TS mirror `tsprobe.ts`; `run.sh <cases>` diffs them). It covers:
    - `nonterminal_may_begin_with`: every one of 15 fragment kinds × 96 tokens × 4 editions, 5,760 checks;
    - `parse_nonterminal`: 258 cases, every fragment kind and edition-dependent `pat`/`expr`, plus error inputs;
    - `collect_tokens` with `capture_cfg` on and off (the cfg-eval capture mode), `ForceCollect::Yes`: 96 cases.
      These cover `#[cfg]`/`#[cfg_attr]` on fields, params, generic params, where predicates, statements,
      expressions, arms, struct-expression fields, nested inner attributes, and broken `>>` at capture ends.
    - **Macro expansion (metavar paths): 72 cases.** The token stream is rewritten the way
      `rustc_expand::mbe::transcribe` does: `[$kind tokens]` is parsed with `parse_nonterminal` and replaced by an
      `Invisible(MetaVar(..))` group with the same flags (`can_begin_literal_maybe_minus`, `is_path`,
      `has_meta_form`, ...), or by `NtIdent`/`NtLifetime`. The real `Parser` then parses the result. This reaches
      `eat_metavar_seq*`, the interpolated-qpath macro, `mut $pat`, `$ty::Assoc`, `$path { .. }`, `#[$meta]`,
      `#[a = $expr]`, `$vis`, `$block` bodies, `$item` in every item context, and NT idents and lifetimes.
      45 of these diagnostics fire.
    - **All 6,186 probe cases match.**

Severity:
- **high**: an observable divergence from the oracle on a reachable path.
- **med**: latent wrong logic, a missing panic, a weakened test, an unported reachable path, or a process gap.
- **low**: style or convention.

**No high findings in any batch.** No `unported(...)` path in these files is replaced by a guessed value.

## Batch 1: parser-core (mod.rs, token_type.rs, attr.rs, attr_wrapper.rs, nonterminal.rs, lib.rs, decls.ts, stubs.ts): **ACCEPT** (med follow-ups for lib.rs error paths)

Checked line by line, all matching upstream:
- **mod.rs**, all 90 fns. The `Parser.new` defaults (all 20 fields, in struct order) match. So do:
  - `bump`/`break_and_eat`/`look_ahead`, including the dist==1 fast path and the skipped invisible delimiters;
  - `expect_any_with_type` and `parse_seq_to_before_tokens`, including the closure-brace and missing-separator recoveries;
  - `parse_visibility` and the restriction recoveries, `parse_safety`, `parse_coroutine_kind`;
  - `parse_delim_args`/`parse_attr_args`, `KwBadCase` keyword-case recovery, and `debug_lookahead`.
  - `clone_Parser` deep-copies the expected set, token cursor, capture state and closure spans. It shares
    `token`/`prev_token`, which is safe because no parser code edits a `Token` in place.
- **token_type.rs.** I checked by script that the 113 `TokenType` discriminants follow the enum order, and checked
  all 111 `is_keyword`/`to_string` arms. `TokenTypeSet` as four u32 words is correct at bits 31/32/63/64/95/96
  (`w & -w` with `clz32`), and iterates lowest bit first like `u128::trailing_zeros`. Upstream quirks are kept on
  purpose: the first-arm `exp!(Pin)`, and `SymBikeshed`/`SymPin` missing from `from_u32`.
- **attr.rs, attr_wrapper.rs, nonterminal.rs.** Captured tokens are printed by the ast-tree Debug
  (`LazyAttrTokenStream(AttrTokenStream([..]))`), so the parse suite already checks the `needs_tokens` fast path
  and the inner-attribute ranges. The cfg-eval capture mode, `parse_nonterminal`, `nonterminal_may_begin_with` and
  every metavar path were checked with the review probe above: all match.
  - The sub-reviewer also ran 189 crafted files: attributes in every position, `#![x]` before every item kind,
    shebang/frontmatter/BOM/CRLF, and all 199 `BUILTIN_ATTRIBUTES` for the `needs_tokens` decision. All match.
  - An upstream ICE is mirrored faithfully. With `capture_cfg`,
    `trait Tr<X>{} #[derive(Debug)] struct S<#[cfg(false)] T: Tr<u8>>(u8);` hits the same assert
    ("Should not have unglued last token with cfg attr", attr_wrapper.rs:369) in both.
- **decls.ts.** A script compared all 560 declarations with the upstream `fn` at each cited line: no name mismatches,
  and parameter order and count match apart from the documented trailing impl tables. All 560 have a
  `Parser.prototype.<name> =` assignment, and every assignment is declared. No file still uses a local
  `declare module` augmentation (`PORT(decls)`).

### Findings
1. **med (unported, reachable)**: lib.ts:96-104 `io_error_kind` and lib.ts:201-203 `from_utf8_error`. Every OS-level
   load error of the main file, and invalid UTF-8, reach `unported(...)`. The driver exits 70 where rustc prints a
   diagnostic. This is allowed (it is listed in the parser-core handoff), but it is the main-file path of every
   compile. Repro, confirmed: in a directory containing only `mian.rs`, run `-Zunpretty=ast-tree main.rs`.
   - oracle: `error: couldn't find file \`main.rs\`` with `help: you might have meant to open \`mian.rs\``;
   - port: `rust-ts: unported: std::io::Error::kind (decode_error_kind, os error ENOENT)`.

   Directories (EISDIR), `chmod 000` (EACCES) and a file with `\xff\xfe` in a string literal behave the same way.
   **Fix (std lane):** port `std::sys::decode_error_kind` (errno → `ErrorKind`) into `src/std`, and `core::str::from_utf8`'s
   `Utf8Error` (`valid_up_to`/`error_len`, maximal-subpart rule).
2. **med (latent until 1 is fixed)**: lib.ts:205-217. The local `path_file_name`/`path_parent` helpers differ from
   `std::path::Path`:
   - `path_parent("/main.rs")` gives `""`, so the "you might have meant" scan reads `.` instead of `/`;
   - `path_file_name(".")` and `path_file_name("foo/.")` give `"."`, where std normalises `.` components.

   Also, `readdirSync` returns sorted entries (libuv's scandir sorts them), while Rust's `read_dir` gives raw
   readdir order, so ties in `find_best_match_for_name` can resolve differently.
   **Fix:** implement `Path::parent`/`file_name` per std `Components`, and iterate an unsorted directory handle
   (`opendirSync`).
3. **low**: `src/rust_ts/stubs.ts` is dead code. `unported_methods` has no callers left in `src/`, `scripts/` or
   `tools/`, and decls.ts:6-7 still describes it. It cannot hide a missing method, because every declared method is
   assigned. **Fix:** delete stubs.ts and that sentence.
4. **low**: mod.ts `parse_seq_to_before_tokens`, at the `Err(e)` arm (around mod.ts:902-908). `emit(); break;` only
   leaves the JS `switch`; a second `break` after the switch, with a PORT note, then leaves the loop. The behaviour
   is correct but fragile. **Fix:** label the `while` and use `break <label>`.
5. **low**: the `debug!` tracing in `eat_lt`/`expect_gt` was dropped rather than kept as comments, unlike elsewhere.
   `debug_lookahead` returns a `(f) => string` closure; PORT decision 7 records this.
6. **low**: `Parser.new` sits in the class body, ahead of mod.rs:295-329 (see Method). A one-line `// PORT:` on the
   class would make the reason explicit.

## Batch 2: parser-ptg (path.rs, ty.rs, generics.rs): **ACCEPT** (low follow-ups)

Checked line by line, all matching upstream: all 19 + 50 + 17 fns.
- **path.rs:** the leading `<<<<` recovery, including the give-up-and-restore branch (`f::<Vec<u8>()`), the multibyte
  case and the more-than-10-levels bail-out. Also `::(` call/pattern recovery, single- and triple-colon path
  recovery, and `expr_is_valid_const_arg`.
- **ty.rs:** every `parse_ty_common` flag; 2015 bare trait objects (`&Trait + Send`, `dyn` as a type name); `async Fn`
  in 2015/2018; `~const`/`[const]`/`!`/`?` with `for<>`; `use<..>` with `>>`/`>=` glue; the binder transposition;
  fn pointers; `=>`/`:` return-type recovery; C-variadics; raw pointer, `&pin` and array recoveries;
  `Fn<'a>(..)`; `typeof`; unsafe binders; `field_of`.
- **generics.rs:** const params with defaults, where clauses (including before a tuple-struct body), every shape of the
  equality-predicate suggestion, `parse_contract`.
- **PORT decisions:**
  - 2 (`mem::replace` via `Object.assign`) is equivalent. Every `Parser` field is an own property set by the
    constructor, `undefined` ones included, and `clone_Parser` deep-copies the mutable parts.
  - 3 and 6 to 10 are faithful.
  - 1 and 4 are fine; see findings 2 and 3.

### Findings
1. **low**: ty.ts:752 (`parse_ty_c_style_pointer`, ty.rs:642) and ty.ts:1420 (`error_lt_bound_with_modifiers`,
   ty.rs:1215) port `unreachable!("msg")` as `unreachable("msg")`. Rust's message is prefixed with
   `internal error: entered unreachable code: `, and other files include that prefix (mod.ts:492, cfg_select.ts:26).
   Only the ICE text differs. **Fix:** add the prefix.
2. **low**: ty.ts:318 ports `.expect("metavar seq ty")` as `unreachable(..)`; expr.ts:1556 uses `panic(..)` for the
   same macro. **Fix:** `unwrap(ty, "metavar seq ty")`.
3. **low**: `TraitBoundModifiers.NONE` is a shared, unfrozen object, and ast.ts:1211 passes it without cloning while
   path.ts clones it (PORT decision 4). It is harmless today, because nothing writes modifier fields.
   **Fix:** `Object.freeze` it, or clone it at ast.ts:1211 (PORTING §8).

## Batch 3: parser-pat-stmt (pat.rs, stmt.rs, test shims): **ACCEPT** (remove the shim mode)

Checked line by line, all matching upstream: all 52 + 27 fns.
- **pat.rs:**
  - or-patterns with leading/trailing/doubled verts;
  - every range form (`...`, `..=`, `..==`, `...=`, parenthesised, const-block and negative bounds, `&0..=5`);
  - the expression-in-pattern recovery, including the handoff's snippet-shadowing fix;
  - struct-pattern field recovery, binding modes, `box`, `deref!`, `!`, guard patterns, the unclosed `'a`.
- **stmt.rs:**
  - let-else with lazy operators and trailing braces, and the `:`/`=` typo;
  - compound assignment in `let`;
  - statement macros followed by `.x`/`?`/`::`/`as`/an operator;
  - malformed labels, `super let`, `auto`/`var`/`mut let`.
- The metavar paths (`eat_metavar_pat`, `mut $p`, `$pat` bounds, `$stmt`) were checked with the review probe.
- **PORT decisions:** all are faithful.
  - 1: a new `BindingMode` is required, because `BindingMode.NONE` is shared.
  - 3: `move_parser` + `replace_in_place` is sound.
  - 9: `suggest_eq_dot_suffix` keeps the let-chain order: `Dot` check, bump, snapshot, `delayed_bug`,
    `parse_dot_suffix_expr`, cancel, then fall-through to `check_assoc_op`.
- **"For root" item 1 of the handoff is resolved.** `expr/diagnostics.ts:367` now takes `op: AssocOp`, and stmt.ts:1228
  calls it directly; the `PORT(contract)` cast is gone.

### Findings
1. **med (weakened/redundant test)**: `src/rustc_parse/parser/testdata/pat_stmt_harness.ts:133,176-279`, plus the
   `(shimmed)` tests in pat.test.ts and stmt.test.ts. The shims are still installed: each of the 119 cases runs a
   second time with 8 parser methods and `AttemptLocalParseRecovery.yes/no` replaced by partial test-side copies.
   - **Harmless:** restored in `finally`, everything synchronous, and the prototype was verified unmodified after a
     full shimmed run. Uncovered branches throw `ShimMiss` rather than returning a value. One copy,
     `maybe_suggest_struct_literal`, takes 2 parameters where upstream takes 3.
   - **Now pointless:** `PENDING` is empty in both files, so real mode already checks all 119 cases byte for byte.
     Shimmed mode is strictly weaker (115 match, 4 `ShimMiss`), its `SHIMMED` list is stale (72 names), and it
     doubles the test count.

   **Fix:** delete `install_shims`, `ShimMiss`, the `shimmed` parameter, the `SHIMMED` sets and the `(shimmed)`
   tests, plus the empty `PENDING` scaffolding if wanted, and update the header comments.
2. **low**: the parser-pat-stmt handoff's "For root" item 1 is stale (see above); mark it resolved.

## Batch 4: parser-fn-asm (function.rs, asm.rs, cfg_select.rs): **ACCEPT** (low follow-up)

Checked line by line, all matching upstream: all 11 + 11 + 1 fns.
- **function.rs:**
  - every valid and every misordered or duplicated qualifier combination, and visibility after qualifiers;
  - `async`/`gen`/`async gen` per edition, and `const`/`async` on fn-pointer types;
  - `-> Ty` after a where clause;
  - every self-parameter form (`&pin`, `*self`, `mut self: T`), variadics, dedup of recovery param names;
  - `fn_body_missing_semi_guar.take()`.
- **asm.rs** (reachable only through its unit test): the operand order, `eat_operand_keyword`, options,
  `clobber_abi`, `parse_reg` and the `'blk` block. The asm `PENDING` list is now empty, so all 32 probe cases match
  the real `parse_asm_args`.
- **cfg_select.rs:** matches.
- PORT decisions 1 to 12 are faithful. `to_lowercase` and `trim_end` are only applied to ASCII keyword names and
  `char::is_whitespace` text respectively. `parse_options` is exported for the test only, with a PORT note.

### Findings
1. **low**: asm.ts:7 imports `MutRef` through the re-export in `rustc_span/hygiene.ts`; other files import it from
   `std/mut_ref.ts`. **Fix:** import it from std.

## For root
1. Record the verdicts: all four batches **ACCEPT**.
2. Queue for the std lane: `decode_error_kind`, `str::from_utf8`/`Utf8Error`, and `Path::parent`/`file_name` with
   unsorted `read_dir` (batch 1, findings 1 and 2). The missing-file diagnostic is the most user-visible gap left in
   the parser front end.
3. Small cleanup batch (tests and dead code; no output change):
   - remove the pat/stmt shim mode (batch 3, finding 1);
   - delete stubs.ts (batch 1, finding 3);
   - the `unreachable!` prefixes (batch 2, finding 1).
4. Consider adopting the review probe's metavar mode as a committed oracle test until rustc_expand lands. It is the
   only check today on the `eat_metavar_seq*`/interpolated paths. The scratch directory was deleted per the brief;
   the probe's core is in the appendix.

## Appendix: the metavar transform used by the review probe (rustc-dev side)

The probe parsed each case with `source_str_to_stream`, applied `transform` and then ran `Parser::new(psess, ts, None)`
with a `parse_item(ForceCollect::Yes, ..)` loop. It printed `{:#?}` of each item and the `-Zui-testing` stderr. The TS
mirror is the same code against `rustc_parse/lib.ts`.

```rust
fn transform(psess: &ParseSess, ts: &TokenStream, edition: Edition, ev: &mut Vec<String>) -> TokenStream {
    let mut out: Vec<TokenTree> = Vec::new();
    for tt in ts.iter() {
        match tt {
            // `[$kind tokens]` -> what mbe::transcribe emits for a `$x:kind` matched against `tokens`
            TokenTree::Delimited(_, _, Delimiter::Bracket, inner)
                if matches!(inner.get(0), Some(TokenTree::Token(t, _)) if t.kind == TokenKind::Dollar) =>
            {
                let trees: Vec<TokenTree> = inner.iter().cloned().collect();
                let TokenTree::Token(kt, _) = &trees[1] else { panic!() };
                let TokenKind::Ident(ksym, _) = kt.kind else { panic!() };
                let rest = transform(psess, &TokenStream::new(trees[2..].to_vec()), edition, ev);
                let kind = NonterminalKind::from_symbol(ksym, || edition).unwrap();
                let mut p = Parser::new(psess, rest.clone(), None);
                let mk = |span, mv, stream| TokenTree::Delimited(DelimSpan::from_single(span),
                    DelimSpacing::new(Spacing::Alone, Spacing::Alone),
                    Delimiter::Invisible(InvisibleOrigin::MetaVar(mv)), stream);
                match p.parse_nonterminal(kind) {
                    Err(e) => { e.emit(); ev.push("transform-err".into()); out.extend(rest.iter().cloned()); }
                    Ok(r) => out.push(match r {
                        ParseNtResult::Tt(tt) => tt,
                        ParseNtResult::Ident(i, k) => TokenTree::token_alone(token::NtIdent(i, k), i.span),
                        ParseNtResult::Lifetime(i, k) => TokenTree::token_alone(token::NtLifetime(i, k), i.span),
                        ParseNtResult::Item(i) => mk(i.span, MetaVarKind::Item, rest),
                        ParseNtResult::Block(b) => mk(b.node.span, MetaVarKind::Block, rest),
                        ParseNtResult::Stmt(s) => mk(s.span, MetaVarKind::Stmt, rest),
                        ParseNtResult::Pat(pt, k) => mk(pt.node.span, MetaVarKind::Pat(k), rest),
                        ParseNtResult::Expr(e, k) => {
                            let (a, b) = match &e.kind {
                                ExprKind::Lit(_) => (true, true),
                                ExprKind::Unary(UnOp::Neg, x) if matches!(&x.kind, ExprKind::Lit(_)) => (true, false),
                                _ => (false, false),
                            };
                            mk(e.span, MetaVarKind::Expr { kind: k, can_begin_literal_maybe_minus: a,
                                can_begin_string_literal: b }, rest)
                        }
                        ParseNtResult::Literal(l) => mk(l.span, MetaVarKind::Literal, rest),
                        ParseNtResult::Ty(t) => {
                            let is_path = matches!(&t.node.kind, TyKind::Path(None, _));
                            mk(t.node.span, MetaVarKind::Ty { is_path }, rest)
                        }
                        ParseNtResult::Meta(a) => {
                            let h = a.node.meta_kind().is_some();
                            mk(a.node.span, MetaVarKind::Meta { has_meta_form: h }, rest)
                        }
                        ParseNtResult::Path(pa) => mk(pa.node.span, MetaVarKind::Path, rest),
                        ParseNtResult::Vis(v) => mk(v.node.span, MetaVarKind::Vis, rest),
                        ParseNtResult::Guard(_) => panic!("guard"),
                    }),
                }
            }
            TokenTree::Delimited(a, b, c, inner) =>
                out.push(TokenTree::Delimited(*a, *b, *c, transform(psess, inner, edition, ev))),
            t => out.push(t.clone()),
        }
    }
    TokenStream::new(out)
}
```

Example case, which matches in 2015, 2021 and 2024:
`fn f() { match x { [$literal 1] => {} [$literal -1]..=[$literal 2] => {} [$expr 3] => {} [$expr -4] => {} [$expr a + b] => {} } }`.
