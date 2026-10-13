# Handoff: attr-parse-d (wave 8, M2)

Branch `lane/attr-parse-d` (from `lane/attr-parse-a`; `lane/attr-parse-b` merged three times, up to fce4e2c, no conflicts).

The lane's attribute parsers in `compiler/rustc_attr_parsing/src/attributes/` are ported: `rustc_internal`,
`rustc_dump`, `diagnostic/*`, `test_attrs`, `traits`, `prototype` and all the small files. Every fn has its
marker, in upstream order. All checks are green. The lane's 17 new oracle cases match rustc byte for byte, but
they stay in `LIST_PENDING` until attr-parse-c lands: building `ATTRIBUTE_PARSERS` still reaches c's stubs.

## Files touched
- **Ported** (`src/rustc_attr_parsing/attributes/`, replacing attr-parse-a's stubs, export names kept):
  `allow_unstable autodiff body cfi_encoding confusables debugger dummy lint_helpers loop_match must_not_suspend
  must_use no_implicit_prelude no_link non_exhaustive path pin_v2 prototype rustc_allocator rustc_dump
  rustc_internal semantics splat test_attrs traits transparency unroll` and
  `diagnostic/{mod,do_not_recommend,on_const,on_move,on_type_error,on_unimplemented,on_unknown,on_unmatched_args,opaque}`.
- **New**: `attributes/prelude.ts` (prelude.rs: re-exports, `Allow`/`Error`/`Warn` constructors).
- **Tests** (attr-parse-a's, extended):
  - `attr_oracle/list_gen.rs`: op argument `M+f1,f2` enables features; op `lints` renders every buffered early
    lint into the captured stderr. Old cases' output is byte-identical (checked).
  - `attr_oracle/list_cases.txt` + regenerated `list_out.json`: 17 new cases (below).
  - `attr_oracle.test.ts`: the runner parses `+features` and `lints`; the stand-in `Session` now carries
    `opts` (`Options_default()`, edition 2024) and `unstable_features` (`from_environment(None)`), which
    `feature_err` reads.

## Coverage (`bun scripts/coverage.ts --missing`)
0 missing in every lane file. rustc_internal 16/16, diagnostic/mod 19/19, test_attrs 6/6, prototype 5/5,
allow_unstable 5/5, rustc_dump 3/3, on_unimplemented 2/2, opaque 2/2, the other parsers 1/1 or 0/0
(no fns: body, loop_match, no_implicit_prelude, no_link, pin_v2, prelude, semantics, splat).
`coverage --check`: markers ok (4594; vendor 2403).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=120000 src tools`: 2283 pass, 1 skip, 0 fail.
- `bun scripts/coverage.ts --check`: markers ok (4618; vendor 2403).
- `RUST_TS_AGENT=attr-parse-d bun scripts/difftest.ts --suite parse --sample 200`: 200/200 MATCH (run
  `20261013-083019-attr-parse-d-uov1`).
- **List oracle.** Every list case reaches `codegen_attrs::ForceTargetFeatureParser::PATH`. That is attr-parse-c's
  first stub that the registry build touches, so `PARSERS_PENDING` names it, and the 17 new cases sit in
  `LIST_PENDING` with that value.
  - Run with a local, uncommitted harness, all 17 new cases match rustc byte for byte: AttributeKind Debug,
    buffered lints, rendered lint text and stderr.
  - The harness (`$RUST_TS_DATA/tmp/attr-parse-d/hack_context.py`) rewrites `context.ts` to skip registry entries
    that are still stubs.
  - attr-parse-a's 11 old cases were not judged that way, because they use attr-parse-c's attributes.
  - **When attr-parse-c lands, delete the lane-d block of `LIST_PENDING`.**

### New list cases
`must_use_forms`, `non_exhaustive_forms`, `on_unimplemented_forms` (format args, positional/indexed/specifier
warnings, unterminated string, duplicates, missing options, `= "x"`, wrong target, `()`, rustc-only options),
`do_not_recommend_forms`, `test_attr_forms` (`#[test]`, ignore, should_panic forms and duplicates),
`rustc_attrs_internal` (+rustc_attrs), `rustc_attrs_ungated` (feature-gate errors), `confusables`,
`allow_internal_unstable_forms`, `allow_internal_unstable_ungated`, `path_forms`, `no_implicit_prelude_forms`,
`unroll_forms` (path `rustc_unroll` at the pin; `#[unroll]` is unknown), `debugger_visualizer_forms`, `misc_small`
(custom_mir, cfi_encoding, must_not_suspend, test_runner, reexport_test_harness_main, marker, pin_v2, no_link, ...),
`rustc_on_unimplemented_forms` (`on(..)` filters, flags, bad clauses), `diagnostic_feature_gated` (on_move,
on_const, on_unknown, on_unmatched_args, on_type_error, opaque, unknown `diagnostic::` attrs).

Not covered, because `parse_limited_all` passes no `target_item` and the `finalize_check` would ICE in rustc
too (`missing AST target item`): `#[non_exhaustive]` on structs, `#[rustc_legacy_const_generics]`.

## Module load order (resolved with attr-parse-b's `install()` pattern)
- Parser modules import helpers (`unstable`, `parse_single_integer`, the diagnostic helpers) from modules that
  attach `impl AttributeParser`/`impl AcceptContext` fns. `context.ts` imports the parsers, so those modules are
  evaluated while `interface.ts`/`context.ts` are still evaluating, and they hit a TDZ `ReferenceError`.
- attr-parse-b moved those attachments into `install()` fns that `lib.ts` calls at its end. This lane does the
  same for `attributes/diagnostic/mod.ts`: `unknown_diagnostic_attr` is attached by `install()`.
- **Out-of-ownership edit:** to make that call, this lane added `install_diagnostic()` to `lib.ts` (attr-parse-a's
  file, already edited by attr-parse-b for the same purpose). Root: please accept or redo it.
- A consequence for every lane: a parser module must not import `target_checking.ts` for a value at its top level.
  That is why `prelude.ts` re-exports `AllowedTargets` type-only and does not re-export `ALL_TARGETS`, and why
  `dummy.ts` writes `{ $: "ManuallyChecked" }` as a literal.

## `unported(...)` left
None in this lane's files.

## PORT decisions (please record)
1. Parser tables are built with attr-parse-b's helpers: `export const X: SingleAttributeParser =
   SingleAttributeParser_provided({ .. })` (likewise `NoArgs…`, `Combine…<Item>`, `AttributeParser_provided<State>`).
   Direct parsers with inherent fns (`OnUnimplementedParser::parse`, `OpaqueParser::parse`) are
   `{ ..., ...AttributeParser_provided<S>({ .. }) }` objects typed `AttributeParser<S> & { parse(..) }`, members in
   upstream order.
2. prelude.ts defines `Allow`/`Error`/`Warn` as `Policy` constructors (not re-exported from target_checking.ts, for
   the load order). `AllowedTargets` is re-exported type-only.
3. `CREATE: AttributeKind::X` for tuple variants is `(span) => ({ $: "X", _0: span })`; unit variants use the frozen
   singletons `AttributeKind.X`.
4. `str::trim().is_empty()` is "every char is `char::is_whitespace`" (JS `trim` differs on U+FEFF/U+0085);
   rustc_internal has a local `str_trim` for the same reason, and a local `path_file_name` (`Path::file_name`).
5. `u32::try_from(u128)` / `try_into()` range checks are written out on the `bigint`; `index.0 as usize` is
   `BigInt.asUintN(64, ..)`.
6. `gate_diagnostic_attr!` is a helper returning `true` where the macro returns; `diagnostic::Mode` is a string union
   with its methods on the companion; `malformed!`/`or_malformed!`/`duplicate!` are local closures with the
   `continue` written at each use.
7. `&mut` places: `MutRef` (`prototype.rs` out-params, `traits.rs` `mem::replace(skip, true)`, `merge_directives`,
   `parse_cgu_fields`).
8. Test harness: list_gen.rs `+features` / `lints` (above), stand-in `Session` with `opts`/`unstable_features`.
9. `attributes/diagnostic/mod.ts` `install()` (see "Module load order").
