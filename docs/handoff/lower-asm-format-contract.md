# Handoff: lower-asm-format-contract (wave 14, M3a)

Branch `lane/lower-asm-format-contract`, from main `935a15a`. No merges are left on the branch. The harness-w13
merge used for the end-to-end runs was done on a scratch branch, which was then deleted.

## Files
- **Ported.** Each file replaces its contract stub. Every fn is in upstream order, with markers, and the
  `unported_methods` lists are gone.
  - `src/rustc_ast_lowering/asm.ts`: `lower_inline_asm`.
  - `src/rustc_ast_lowering/format.ts`: the 5 methods `lower_format_args`, `try_inline_lit`, `int_ty_max`,
    `uint_ty_max` and `inline_literals`, and the 5 free fns `flatten_format_args`, `make_argument`, `make_count`,
    `expand_format_args` and `for_all_argument_indexes`. It also holds `ArgumentType` (see PORT 1).
  - `src/rustc_ast_lowering/contract.ts`: all 9 methods.
- **New tests.** All are under `src/rustc_ast_lowering/`, and no other file was touched.
  - `format.test.ts` + `format_oracle/{run.ts,cases.rs}`
  - `asm.test.ts` + `asm_oracle/{run.ts,x86_64.rs,aarch64.rs}`
  - `contract.lowering.test.ts` + `contract_oracle/{run.ts,cases.rs}`. The name `contract.test.ts` was already
    taken by lane lowering-contract's decls test.

## Coverage
`bun scripts/coverage.ts --missing compiler/rustc_ast_lowering/src/<f>.rs`:

| file | fns |
|---|---|
| asm.rs | 1/1 |
| format.rs | 10/10 |
| contract.rs | 9/9 |

`--check`: markers ok (8664; vendor 3888).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3995 pass, 1 skip (the pre-existing linux-only
  test), 0 fail.
- `RUST_TS_AGENT=lower-asm-format-contract bun scripts/difftest.ts --suite parse --sample 100`: 100/100 MATCH
  (run `20261014-024721-lower-asm-format-contract-0ne6`).
- End-to-end, with `lane/harness-w13` merged on a scratch branch:

  | suite | sample | MATCH | UNPORTED | DIFF | run |
  |---|---|---|---|---|---|
  | hir-tree-nocore | 100 | 11 | 89 | 0 | `20261014-024639-lower-asm-format-contract-uojc` |
  | hir-tree | 50 | 6 | 44 | 0 | `20261014-024704-lower-asm-format-contract-qxdx` |

  - **Stop histogram:** in both suites every UNPORTED case stops at
    `rustc_driver_impl::pretty::print (HirTree: needs a TyCtxt)` (89/89 and 44/44). The driver does not reach AST
    lowering yet. The MATCH cases fail before printing, identically.
  - **Merge conflict:** the harness-w13 merge conflicts with main in `harness/suites.ts`. Both branches append suites
    at the same place, and both sides must be kept. Root will meet this when integrating harness-w13.

## Oracle tests (the evidence for this lane)
AST lowering is not reachable from the driver yet. So each test drives the pieces itself:
1. It runs the ported driver to `after_expansion`, as hir_oracle/run.ts does.
2. It takes the real expanded AST and the real `TyCtxt`, session and resolver.
3. It calls the ported entry point on a **recording `LoweringContext`**. That is
   `Object.create(LoweringContext.prototype)`, with the builder methods of other lanes (`expr_call`,
   `stmt_super_let_pat`, `block_all`, `lower_expr`, ...) replaced by renderers in rustc_hir_pretty syntax. The
   ported methods under test stay the prototype's.
4. It searches each rendering, in order, in the live oracle's `-Zunpretty=hir` of the same file. Whitespace is
   collapsed and literals are canonicalized to hex. It also checks that the call counts agree.

- **format.test.ts** has 3 configs: default, `-Zflatten-format-args=no -Zfmt-debug=none`, and
  `-Zfmt-debug=shallow`. That is 33 `format_args!` per config, and all match. They cover:
  - the template bytecode: literal chunks, multibyte and escaped text, every flag bit, fill, alignment,
    `width$`/`.prec$`/`.*`, explicit positions, `{0} {0:x}` dedup;
  - argmap order (the `fmt::Argument` constructor list);
  - `from_str` vs `from_str_nonconst`, the empty template;
  - literal inlining at every int/uint boundary except isize/usize, plus the non-inlinable cases;
  - flattening (Display, Debug, nested twice, `&format_args!`, shared args), and the non-flattened nested
    lowering.

  It also has unit tests of `for_all_argument_indexes` and `make_count`.

  **Negative controls:** shifting the `debug_hex` Upper bit fails 3/3 configs. Raising the unsuffixed limit to
  2147483648 fails the 2 flattening configs.
- **asm.test.ts** runs `--target x86_64-unknown-linux-gnu` (11 `asm!`) and `aarch64-apple-darwin` (4). It covers:
  - reg and reg-class parsing;
  - `in`/`out`/`lateout`/`inout`/`inlateout` and split operands;
  - `sym` fn vs static, with the real partial resolutions;
  - `const` and `label` operands;
  - options;
  - `clobber_abi` expansion with one or two ABIs, and its dedup against explicit outputs.

  **Negative controls:** always recording used registers fails 1/2 targets, and ignoring `output_used` fails 2/2.
- **contract.lowering.test.ts** runs with `-Zcontract-checks` off and on. It covers requires-only, ensures-only,
  both, and a unit body, plus a unit test of `checked_return`.
  - **Limit 1:** bodies with `return` are left out, because the recorder renders bodies with rustc_ast_pretty.
    `checked_return` is unit-tested instead.
  - **Limit 2:** contract declarations are empty in all cases.

## `unported(...)` left
- **asm.rs error paths.** Building any of the 13 `#[derive(Diagnostic)]` structs stops as
  `rustc_ast_lowering::diagnostics::<Name> (diagnostics.gen.ts pending)`. The call goes through `pending_diag(name,
  fields)`, which keeps the upstream fields in upstream order. The 13 structs are:
  - `InlineAsmUnsupportedTarget`, `AttSyntaxOnlyX86`;
  - `AbiSpecifiedMultipleTimes`, `ClobberAbiNotSupported`, `InvalidAbiClobberAbi`;
  - `InvalidRegister`, `InvalidRegisterClass`;
  - `InvalidAsmTemplateModifierRegClass` (its `sub` is built as `{ $: "SupportModifier" | "DoesNotSupportModifier", .. }`),
    `InvalidAsmTemplateModifierConst`, `InvalidAsmTemplateModifierSym`, `InvalidAsmTemplateModifierLabel`;
  - `RegisterClassOnlyClobber`, `RegisterClassOnlyClobberStable`, `RegisterConflict`.

  `AbiSpecifiedMultipleTimes.equivalent` compares two `span_to_snippet` `Result`s with the derived
  `PartialEq` (including `SpanSnippetError`). It is left to be written with the diagnostic.
- **format.rs `int_ty_max(Isize)` / `uint_ty_max(Usize)`.** These need `tcx.data_layout` (an unported getter in
  rustc_middle ty/context.ts) and `Size::signed_int_max` / `unsigned_int_max` (rustc_abi lib.rs:990/995, not
  ported). They are reached by `format_args!("{}", 1isize)` / `1usize` when flattening is on, which is the default.

## PORT decisions (please record)
1. **`ArgumentType` is hand-written in format.ts.** The derived `Hash`+`Eq` is the key fn `key_argmap`, the type is
   a `$`-tagged union and `Usize` is a frozen singleton. Replace all of these with format.gen.ts once codegen set
   rustc_ast_lowering runs.
2. **`argmap` is a `KeyedMap`, since `FxIndexMap<(usize, ArgumentType), Option<Span>>` keys by value.**
   - `IndexMap::insert_full` is a local helper. It returns the index; an existing key keeps its position and its
     value is replaced.
   - `usize::MAX` is the sentinel `2 ** 64 - 1`. It is only compared and used as a key.
3. **`Cow::to_mut`** is `cow_to_mut`: `clone_FormatArgs` on `Borrowed`, a deep clone. Nested FormatArgs that get
   flattened are therefore mutated only in the clone.
4. **`for_all_argument_indexes`** reads each `Ok(index)` into a `MutRef` and writes back a fresh `Ok(..)`, because
   `Result` objects are immutable.
5. **`try_inline_lit`'s `cond.then_some(Symbol::intern(..))`** interns eagerly whatever `cond` is, as upstream does,
   since interning assigns symbol indices.
6. **`*f == FormatOptions::default()`** is a local `format_options_is_default`. It is the same helper as in
   rustc_builtin_macros and rustc_ast_pretty.
7. **lib.rs enum values passed by asm.rs** follow the PORTING §5 encoding: `"Optional"`, `"No"` and
   `{ $: "Disallowed", _0: "Path" }`, for `ParamMode`, `AllowReturnTypeNotation` and
   `ImplTraitContext::Disallowed(ImplTraitPosition::Path)`. The lib.rs types are still `unknown`.
   **lower-lib-a must use this same encoding**, or change these 3 literals.
8. **asm.rs, other choices:**
   - `rustc_target::asm` is imported as `target_asm`, because the `asm` parameter keeps its name.
   - `FxHashMap<InlineAsmReg, usize>` and `FxHashSet` are a JS `Map` / `Set`; the registers are interned singletons
     and these collections are never iterated.
   - The `clobber_abis` `FxIndexMap` is a `Map`.
   - The experimental-arch `&&` chain is nested, so `outer_expn_data` is read only when upstream reads it.
9. **Copies of `Copy` HIR nodes are identity**, following the hir-visit decision. This covers `*e`, `*d`, `*postcond_checker`,
   `*cond_fn` and `*ret` in contract.rs.

## For root
- **No decls.ts change was needed.** All signatures are as declared.
- **When diagnostics.gen.ts lands**, replace `pending_diag("<Name>", fields)` in asm.ts with
  `diagnostics.<Name>_diagnostic(fields)`. Write `AbiSpecifiedMultipleTimes.equivalent` at the same time.
- **When format.gen.ts lands**, drop the hand-written `ArgumentType`.
- **Check lower-lib-a's encodings** of `ParamMode`, `AllowReturnTypeNotation` and `ImplTraitContext` against
  PORT 7.
- **The oracle tests run the live pinned oracle.** Each test takes about 1 s per config. They skip without the
  toolchain unless `RUST_TS_REQUIRE_PROBES=1`.
