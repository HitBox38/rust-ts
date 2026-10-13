# Handoff: parser-fn-asm (wave 6c parser porter)

Branch `lane/parser-fn-asm`, based on main at b9444b5. No merges.

## Files touched
- `src/rustc_parse/parser/function.ts`: the stub was replaced by the port of all of function.rs.
- `src/rustc_parse/parser/asm.ts`: the stub was replaced by the port of all of asm.rs.
- `src/rustc_parse/parser/cfg_select.ts`: the stub was replaced by the port of all of cfg_select.rs (51 lines, 1 fn).
- New tests:
  - `src/rustc_parse/parser/function.test.ts`, which also covers cfg_select, with fixture `function_oracle.json` (82 cases).
  - `src/rustc_parse/parser/asm.test.ts`, with fixture `asm_oracle.json` (32 cases).
- I did not touch `decls.ts` or any other lane's file. No declaration changes were needed: every signature in decls.ts fit as written.

## Evidence
- **Typecheck:** `bunx tsc --noEmit -p .` is clean.
- **Unit tests:** `RUST_TS_REQUIRE_PROBES=1 bun test src tools` gives 1155 pass, 0 fail, 0 todo and 1 skip. The skip is the pre-existing `read_binary_file_handles_lying_stat` (`test.skipIf(process.platform !== "linux")`), because this host is macOS. It is not in this lane.
- **Coverage check:** `bun scripts/coverage.ts --check` reports `markers ok (3102; vendor 2278)`.
- **Coverage, file by file (`--missing`):**

  | file | fns ported |
  |---|---|
  | function.rs | 11/11 |
  | asm.rs | 11/11 (includes the `HasAttrs`/`HasTokens` impl fns of `AsmAttrVec`) |
  | cfg_select.rs | 1/1 |

- **Difftest sample:** `RUST_TS_AGENT=parser-fn-asm bun scripts/difftest.ts --suite tokens --sample 200` gives 200/200 MATCH (run `20261013-003807-parser-fn-asm-xtpq`).

## Tests: how the expectations were obtained
- **The oracle** is a rustc-dev probe against `nightly-2026-10-11`. Its source is in the fixtures' `_probe` field, the cases are in `_cases`, and `_how` gives the build and run commands. The scratch copy is in `$RUST_TS_DATA/tmp/parser-fn-asm/probe/`, where `mkfixture.py` regenerates both fixtures.
- **Each case** parses `t.rs` in its own edition and runs ops against the real parser:
  - `item`: `parse_item`. For a fn it also prints `header`, `ident`, `paramN`, `output`, `sig_span` and `body`.
  - `ty`: `parse_ty`. For a fn pointer it also prints `fnptr.safety` and `fnptr.ext`.
  - `asm:<macro>`: `parse_asm_args`, with `sp` set to the first token's span. Every `AsmArg` is printed field by field, because `AsmArg` has no Debug.
  - `cfgsel`: `parse_cfg_select_branch_rhs`.
  - `vis`, `tok`, `bump`.
  - `gated:<feature>`: the `GatedSpans` recorded for that feature.
  - `lints`: the buffered early lints.
- **What must match:** the events and the `-Zui-testing` stderr, byte for byte.
- **What the cases cover:**
  - Front matter:
    - every valid order: `const`/`async`/`unsafe`/`safe`/`gen`/`async gen`/`extern`/`extern "C"`, with `pub`, in editions 2015 to 2024
    - `async fn` in 2015 (E0670)
    - every misplaced or duplicated pair: `unsafe const`, `unsafe async`, `async const`, `extern "C" unsafe`, `const const`, `async async`, `unsafe unsafe`, `safe unsafe`, `unsafe safe`, `gen async`, `async pub`, `pub async pub`, `const async pub unsafe`
  - fn pointers: `const`, `async`, `unsafe const`, `unsafe async`, and variadic.
  - Self params: `self`, `&self`, `&mut self`, `&'a self`, `&'a mut self`, `self: Box<Self>`, `mut self`, `mut self: T`, `&pin mut self`, `&'a pin const self`, `*self`/`*mut self`/`*const self`, `&mut self: Self`, self that is not first, `self::X`, and `#[a] self`.
  - Patterns in params.
  - Anonymous trait params: valid in 2015, an error in 2018.
  - Missing param types, both free and in 2015.
  - Recovery: dummy params and deduplicated names.
  - Variadics: in foreign fns, named, unnamed (the `VARARGS_WITHOUT_PATTERN` lint), and in fn pointers.
  - Return types: `-> !`, the misplaced `where ... -> T`, and `FnOnce -> ()`.
  - Bodies: `= expr;`, a missing body, a missing body in a trait, and `;`.
  - Errors: missing params, and `fn Foo for Bar`.
  - asm: an empty argument list, a template, a trailing comma, every operand kind (`in`, `out`, `lateout`, `inout`, `inout =>`, `inlateout => _`, `out _`, `const`, `sym` (path and qpath), and `label`), named operands, every option plus a trailing comma, repeated `options`, and `clobber_abi` with multiple ABIs.
    - Multiple templates: `concat!` and raw strings.
    - `global_asm!`: supported and unsupported options and operands.
    - `naked_asm!`: `inout` and `label`.
    - Errors: `in(reg) _`, `inout(reg) _`, `sym 1 + 2`, a missing comma after a template or after an operand, a template after an operand, a bad operand for `asm!` and for `global_asm!`, a bad register, a raw-ident register, `clobber_abi()`, `clobber_abi(C)`, `clobber_abi(1)`, a bad option for `asm!` and for `global_asm!`, a missing comma inside `options`, and attributes on arguments.
  - `cfg_select`: braced, braced followed by a comma, an expression, a block-like expression, a missing comma, and the end of input.
- **Two kinds of test per case.**
  - **Full:** the oracle script, run through the TS API.
  - **NARROW:** the narrowest entry this lane owns, run on the same source. `parse_fn_front_matter` produces the `header` and `fnptr.*` events, `parse_param_general` produces `param0`, and `parse_options` produces `argK.kind`. Each narrow event must equal the oracle event with the same key, and the stderr must match.
- **What runs and matches now:**
  - 14 front-matter and self-param narrow cases, including `gen_blocks`/`pin_ergonomics` gating.
  - 2 `parse_options` narrow cases.
  - The cfg_select braced cases, in full.
- **PENDING.** These must throw exactly the listed `Unported` until the owning lane lands. Then root removes each case that starts to match; the test fails until that is done.
  - function.test.ts PENDING (80 cases): `item::Parser::parse_item`, `ty::Parser::parse_ty`, and for the 4 cfg_select expression cases `expr::Parser::parse_expr_res_after_attrs`.
  - function.test.ts NARROW_PENDING (8 cases: the 2015 async cases, fn-pointer const/async, and self pointers): `diagnostics::Parser::dcx`.
  - asm.test.ts PENDING (all 32 cases): `diagnostics::Parser::dcx`. `parse_asm_args` calls `p.dcx()` first.
  - The full cases stop at the outermost unported entry. When `parse_item`, `parse_ty` or `dcx` land, the next `Unported` shows up, and root should update the PENDING string. The likely next ones are `generics::parse_generics`, `expr::parse_expr`, `diagnostics::expected_one_of_not_found`, `ty::parse_ret_ty` and `pat::parse_fn_param_pat_colon`.
- **Private evidence (not committed).** I ran a scratch preload that installs `Parser.prototype.dcx = function () { return this.psess.dcx() }`, which is upstream's one-line body, and ran scratch copies of the tests with the pending lists emptied.
  - All 8 NARROW_PENDING diagnostic cases matched the oracle exactly, stderr included: `AsyncFnIn2015`, `FnPointerCannotBeConst`/`Async` and `SelfArgumentPointer`.
  - `asm_empty` (`AsmRequiresTemplate`) matched.
  - Every other asm case stops at `expr::parse_expr`, or at `path::parse_path` for `asm_attrs`.

## `unported(...)` left
None in my files: `unported_methods` and every stub body are gone. The indirect ones come from other lanes, as listed under PENDING.

## PORT decisions (please record)
1. **`check_fn_front_matter`'s `const ALL_QUALS`** and its non-`pub` qualifier slice are hoisted to module-level constants `ALL_QUALS` and `QUALS_NO_PUB`. They only read `exp` (token_type.ts, which has no `impl Parser`), so the init-order rule holds.
2. **`i.name.as_str().to_lowercase()`** is a local `to_lowercase`, which is JS `toLowerCase`. It is compared only against ASCII keyword names.
3. **`vs.trim_end()`** is a local `trim_end` that matches `\p{White_Space}+$`, which is the set `char::is_whitespace` uses.
4. **The fn-local `enum WrongKw`** of `parse_fn_front_matter` is a module-level tagged union type.
5. **`parse_fn`'s `&mut sig_hi`** is `MutRef<Span>`, per decls.ts.
6. **`attrs.extend(inner_attrs)`** is `attrs.push(...inner_attrs)`, an in-place edit of the caller's `AttrVec`.
7. **`fn_body_missing_semi_guar.take()`** is a read followed by setting it to `undefined`.
8. **`unwrap_err()`** on `this.unexpected()` is an inline check that panics with core's exact text (``called `Result::unwrap_err()` on an `Ok` value: ()``).
9. **`.expect("Span extracted ...")` and `.unwrap()` on `span_to_snippet`** are `expect_result` and `unwrap_result` with `debug_SpanSnippetError`.
10. **asm.rs:**
    - `impl ast::HasAttrs for AsmAttrVec` and `impl ast::HasTokens for AsmAttrVec` are the exported impl tables `HasAttrs_AsmAttrVec` and `HasTokens_AsmAttrVec`, following the ast_traits convention. `AsmAttrVec.parse` passes them to `collect_tokens`.
    - The `if eat_operand_keyword(..)? {..} else if ..` chain keeps the same evaluation order. Each `?` returns early.
    - The `'blk:` labelled block is a labelled TS block.
    - `parse_options` is **exported for asm.test.ts only**. It is private upstream, and a PORT note marks this.
11. **`debug!(..)` lines** are kept as comments.
12. **cfg_select:** `#[derive(Default)]` on `CfgSelectBranchAttrSpans` is not hand-written, because derives are codegen's job (PORTING §5). Nothing in scope uses it yet. `TokenStream::from_ast(&expr)` takes the Expr impl table `{HasTokens.Expr.tokens, HasAttrs.Expr.attrs, debug_Expr}`, following the precedent in ast.ts.

## Notes for root
- **Brief vs pin.**
  - The brief gives `async unsafe fn` as an invalid order. At the pin it is valid (`const async unsafe extern`), so it is covered as a valid case (`fm_async_unsafe`), and `unsafe async fn` is covered as the invalid one.
  - Contracts are not in function.rs. `parse_contract` belongs to generics.rs (the ptg lane); function.rs only calls it.
- **Many diagnostic paths in mod.ts and function.rs go through `diagnostics::Parser::dcx`.** That is a one-line method in the diagnostics lane. Porting it early would unblock a lot of narrow coverage.
- Delete each PENDING entry as its case starts to match.
