# Handoff: bm-rest (wave 9, M2: remaining builtin macros)

Branch `lane/bm-rest` (from main 961d31b). No merges.

## Files
- **Ported** (`src/rustc_builtin_macros/`), every fn in upstream order with markers. The bm-a stubs are replaced,
  and lib.ts's export names are kept:
  - `test.ts`
  - `test_harness.ts` (new)
  - `proc_macro_harness.ts` (new)
  - `asm.ts`
  - `global_allocator.ts`
  - `eii.ts`
  - `contracts.ts`
- **`lib.ts`:** `pub mod proc_macro_harness; pub mod test_harness;` are now `export * as ...`. The stale "stubs" comment
  is removed.
- **`src/rustc_interface/passes.ts`** (the two call sites the brief allows):
  - `configure_and_expand` now calls `test_harness.inject(..)` and `proc_macro_harness.inject(..)`.
  - The two driver-m2 shims (`rustc_builtin_macros_test_harness_inject` and `rustc_builtin_macros_proc_macro_harness_inject`)
    are deleted.
- **Tests:**
  - `rest.test.ts`
  - `rest_oracle/{probe.rs,cases.txt,run.ts,out.stdout,out.stderr}`

## Coverage (`bun scripts/coverage.ts --missing compiler/rustc_builtin_macros/src/<f>.rs`)

| file | fns |
|---|---|
| test.rs | 13/13 |
| test_harness.rs | 12/12 |
| proc_macro_harness.rs | 7/7 |
| asm.rs | 6/6 |
| global_allocator.rs | 9/9 |
| eii.rs | 13/13 |
| contracts.rs | 4/4 |

`bun scripts/coverage.ts --check`: markers ok (6029; vendor 2403).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3222 pass, 1 skip (the pre-existing linux-only one), 0 fail.
- `RUST_TS_AGENT=bm-rest bun scripts/difftest.ts --suite parse --sample 200`: 200/200 MATCH (run `20261013-103659-bm-rest-64s9`).
- `--suite expanded-nocore --sample 200`: 2 MATCH, 198 UNPORTED, 0 DIFF (run `20261013-103709-bm-rest-r4sp`).
  - All 198 still stop at `rustc_resolve::Resolver::arenas (pending res-lib)`.
  - That stop is before expansion, so nothing in this lane is reached through the driver yet.

## Oracle test: `rest.test.ts`, 205 cases, all byte-identical (stdout 53k lines, stderr 1.1k lines)
- **Probe.** `rest_oracle/probe.rs` is a rustc-dev probe on the real builtins. Its header has the regeneration commands.
  - It has the same design as bm-a's and bm-derive-a's probes, with one difference: every case gets its own
    `run_compiler`. This means fresh hygiene and AttrIds, and per-case session options (`--test`, `-C panic`,
    `-Z panic-abort-tests`, `--target`).
  - **Case kinds:**
    - `attr` / `attr_stmt` / `attr_expr`: the registered `LegacyAttr` on Item / Stmt(Item) / Expr.
    - `attr_ts`: the contracts' `AttrProcMacro`, on the attribute's inner tokens and the item's `to_tokens()`.
    - `bang`: `asm!` / `global_asm!` / `naked_asm!`. It prints `make_expr()` / `make_items()`.
    - `test_harness`: the real `test_harness::inject` on a parsed crate.
    - `proc_macro_harness`: the real `proc_macro_harness::inject` on a parsed crate.
  - **What it prints:**
    - `{:#?}` of every result, or of the crate.
    - The mock resolver's calls: `expansion_for_ast_pass`, which does a real `LocalExpnId::fresh(ExpnData::allow_unstable(..))`;
      `declare_proc_macro`; `visit_ast_fragment_with_placeholders`; `resolve_imports`.
    - Every buffered early lint, which is also emitted.
    - The diagnostics.
- **Coverage of the cases:**
  - **`#[test]`:**
    - plain fn; with `@mod` paths, including unicode
    - every ignore and should_panic form
    - root path `src` / `tests` / other (TestType)
    - Result and `()` returns
    - every signature error: unsafe, async, gen, args, type/const params, should_panic plus output
    - lifetime params
    - naked
    - on a struct, mod, macro call (warning level), statement and expression
    - duplicate attribute, attribute args, name-value form
  - **`#[bench]`:** ok, bad signature, non-fn, statement, duplicate.
  - **`#[test_case]`:** fn, const, static, struct, statement, expression (TestCaseNonItem), args, duplicate, and the non-test cfg.
  - **test harness:**
    - non-test and empty crates
    - sorting, including unicode and uppercase
    - nested modules (per-module `expansion_for_ast_pass`)
    - tests inside fns (UNNAMEABLE_TEST_ITEMS lint)
    - `#[rustc_main]` cleaning
    - `reexport_test_harness_main`, `#![test_runner]`
    - panic=abort with and without `-Zpanic-abort-tests`; immediate-abort
    - the TestsNotSupport error
    - markers on fn/const
    - edition 2015
  - **proc-macro harness:**
    - bang, attr and derive (with helper attrs), in order
    - not pub; nested
    - pub items in root
    - two attributes, same and different (the message has its embedded newline)
    - `#[macro_export]`
    - the wrong crate type (AttributeOnlyUsableWithCrateType)
    - a test crate
    - non-fn targets
    - a malformed `proc_macro_derive`
  - **asm** (aarch64 host, plus x86_64 for the BAD_ASM_STYLE lints):
    - every operand form, including the `=> _` split inout, const/sym/label, explicit registers and named args
    - mixed ordering
    - options, including duplicates and those unsupported by global_asm!
    - clobber_abi, including with regclass outputs and on global/naked asm
    - multiple templates, raw strings, `options(raw)`, `{{ }}`
    - `concat!` templates, through eager expansion with the mock resolver
    - the intel/att lints, including the whole-template span for macro templates
    - `#[cfg]` on operands and unsupported attributes
    - templates after operands (AsmExpectedOther), a non-literal template, a byte string
    - every validation error: duplicate names, positional-after, mutually exclusive options, pure, noreturn, may_unwind
    - unused arguments (one and many), invalid indexes (0, 1 and many positional), an unknown name, invalid modifiers
    - template format errors, including inside a macro template
    - parse errors
  - **global_allocator:** static, statement, fn, statement fn, `#[thread_local]`, args, expression.
  - **eii:**
    - decl and default bodies
    - named, `unsafe_eii`
    - `extern "C"` and implicit extern
    - unsafe fn
    - statics: darwin (EiiStaticDefaultApple) versus linux; no default, word, mut
    - non-fn targets, statements, expressions
    - attribute forwarding and its errors: doc comments, deprecated, stable, track_caller, lang, and the unsupported attributes
    - duplicate eii, bad args
    - `eii_declaration`: ok, `"unsafe"`, statement, and every error
    - `eii_shared_macro`: default and other args, `unsafe(..)`, static, statement, struct, bad args, value
  - **contracts:** requires, ensures, where, kept attrs, empty requires/ensures, struct, async, gen, no body, where without body.
- **Negative controls:** these changes each fail the expected cases (31 DIFF in total):
  - `no_run: true` in test.ts
  - the help-string index in asm.ts
  - the `lang` arm in eii.ts
- **PENDING list.** The rustc-dev probe cannot cover these; they need other lanes before the driver reaches them:
  - `rustc --test -Zunpretty=expanded` and `--crate-type proc-macro` through the CLI. The driver stops at
    `Resolver::arenas` (res-lib) before expansion. After res-lib, `configure_and_expand` runs the real harness calls
    that are wired here.
  - The proc-macro harness on a crate whose NodeIds were assigned by expansion. The probe uses parsed, DUMMY-id items,
    and the ids are only passed through to `declare_proc_macro`.
  - `asm!` through the driver: it needs `Session::asm_arch` (below).

## `unported(...)` left
- None in the ported files.
- `asm.rs` reads `ecx.sess.asm_arch`. That is driver-m2's deferred field (`rustc_target::asm::InlineAsmArch::from_arch
  (Session::asm_arch)`, session.ts), so every `asm!`/`global_asm!`/`naked_asm!` with a template stops there on the
  real driver until rustc_target's asm module is ported.
  - The oracle runner sets the field to the value the probe asserts on the oracle session (`@asm_arch`, `PORT(test)` in run.ts).
  - **For root:** queue a lane for `rustc_target::asm` (`InlineAsmArch` plus `from_arch`), or at least `InlineAsmArch::from_arch`.
    asm.ts compares the field against the variant names `"X86"` / `"X86_64"` (the fieldless-enum convention).

## `// PORT:` decisions
1. **`debug!` dropped** (test.rs, test_harness.rs: tracing).
2. **Copy `Ident` fields are replaced, not mutated:**
   - test.rs `ident.span = ident.span.with_ctxt(..)` in `expand_test_case`.
   - test_harness.rs `test.ident.span = ..apply_mark(..)`, because `Test.ident` shares the item's `Ident` object.
   - In both, the field gets a new `Ident`.
3. **`Generics::default()`** is a local `generics_default()` in global_allocator.ts and test_harness.ts, as bm-a did in
   alloc_error_handler.ts.
   - Root: add a shared `Generics_default` (and `WhereClause` default) to rustc_ast, since this is the third copy.
4. **`Path::ends_with`** (std) is a local `path_ends_with` in test.ts, built on `Components.next_back`. `component_eq` is a local
   copy, like source_util.ts's.
   - Root: export both from src/std/path.ts.
5. **`GrowableBitSet<usize>`** (rustc_index, not ported) is a local `Set<number>` wrapper in asm.ts. It iterates in ascending order.
6. **The lazy `arg_spans` iterator** (asm.rs) is an index into `parser.arg_places`.
7. **`InlineAsmArch` (rustc_target::asm) is not ported.** `Session::asm_arch` is read as the variant name (see above).
8. **`&mut Option<StrLit>` out-parameter** (eii `generate_foreign_func`) is a `MutRef`, per PORTING §8.
   `&mut func.eii_impl` / `&mut stat.eii_impl` (`eii_shared_macro`) is the owning node.
9. **`Vec::retain` on `item.attrs`** (EntryPointCleaner) filters in place, keeping the array object.
10. **test_harness `tests.sort_by(name.as_str().cmp(..))`** uses `str_cmp` from rustc_session/options.ts, which is code-point order
    (= UTF-8 byte order). `Array.prototype.sort` is stable, like `sort_by`.
11. **contracts `cursor.find(|tt| { push; is_kw })`** is written as a loop.

## For root
- `docs/claims/bm-rest.md` can be removed on integration.
- **`rest.test.ts` spawns `run.ts` once.** The 205 cases take about 0.3 s on this machine (one `run_compiler` per case).
