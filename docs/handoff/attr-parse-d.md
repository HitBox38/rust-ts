# Handoff: attr-parse-d (wave 8, M2)

Branch `lane/attr-parse-d` (from `lane/attr-parse-a`; `lane/attr-parse-b` merged twice, no conflicts).

The lane's attribute parsers in `compiler/rustc_attr_parsing/src/attributes/` are ported: `rustc_internal`,
`rustc_dump`, `diagnostic/*`, `test_attrs`, `traits`, `prototype` and all the small files. Every fn has its
marker, in upstream order. **The crate does not load yet**: see "Blockers" (a crate-wide module load-order
problem, plus `check_macro_only` from attr-parse-b).

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
- `bunx tsc --noEmit -p .`: one error, `check_macro_only` is not exported by `macro_attrs.ts` (attr-parse-b,
  not landed yet). Everything else is clean against attr-parse-b's committed `mod.ts`/`util.ts`/`target_checking.ts`.
- `bun test src/rustc_attr_parsing`: **fails to load** (blockers below).
- **Oracle evidence (local, uncommitted harness):** with `check_macro_only` shimmed and `context.ts` loading the
  parser modules lazily and skipping registry entries that are still stubs (`$RUST_TS_DATA/tmp/attr-parse-d/hack_context.py`),
  15 of the 17 new list cases match rustc byte for byte (AttributeKind Debug, buffered lints, rendered lint text,
  stderr). The other 2 (`allow_internal_unstable_*`) reach `macro_attrs::check_macro_only`.
  attr-parse-a's 10 old list cases were not re-judged here: they use other lanes' attributes.

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

**PENDING lists not updated yet:** `LIST_PENDING`/`PENDING` still name `attributes::Combine` (attr-parse-a's).
Once the crate loads, each case reaches either a match or the first stub `ATTRIBUTE_PARSERS()` builds
(attr-parse-c's parsers); set the entries then.

## Blockers (for root)
1. **Module load order (crate-wide).** `interface.ts` imports `context.ts`, which statically imports every
   parser module. The parsers import helpers from modules that attach methods to `AttributeParser`/`AcceptContext`
   when they are evaluated: `stability.ts` (`unstable`, used by nearly every parser table), `attributes/util.ts`
   (`parse_single_integer`, `parse_limit_int`), `attributes/diagnostic/mod.ts`, `target_checking.ts`. Those get
   evaluated while `interface.ts`/`context.ts` are still evaluating, so `AttributeParser.prototype.x = ..` throws
   `ReferenceError: Cannot access 'AttributeParser' before initialization` (or `AcceptContext`). No entry order
   fixes it: two extension modules of the same class are always reached. attr-parse-b's and -c's parsers hit it too.
   **Recommended fix:** `context.ts` loads the parser modules on first use of `ATTRIBUTE_PARSERS()` (already a
   lazy accessor): `import type` the parser modules and `require()` them inside the accessor, with a `// PORT:` note.
   Verified with the local harness above. This edits `context.ts` (attr-parse-a's), so this lane did not do it.
   This lane avoids the part it controls: parser modules use `AllowedTargets` only as a type
   (`{ $: "ManuallyChecked" }` literal in dummy.ts), and prelude.ts does not re-export `ALL_TARGETS`.
2. `attributes/macro_attrs.ts` must export `check_macro_only` (attr-parse-b).

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
