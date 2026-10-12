# Handoff: lint-defs (rustc_lint_defs: lib.rs ported, builtin.rs generated; rustc_errors stand-ins replaced)

## Files
- New `src/rustc_lint_defs/lib.ts` (hand port of lib.rs), `lib.gen.ts` (`bun tools/codegen/types.ts rustc_lint_defs`:
  14 types, 12 debug fns, 0 unknown types, 0 missing Debug), `builtin.ts` (hand module: `//!` docs + `export *`),
  `builtin.gen.ts` (`bun tools/codegen/lints.ts`), `oracle.test.ts`, `lib.test.ts`.
- New `tools/codegen/lints.ts` (generator, `--check` mode), `tools/codegen/lints.test.ts`,
  `tools/codegen/typemap.lint_defs.json` (`rustc_hir_id::HirId` → stand-in in src/rustc_lint_defs/lib.ts).
- `tools/codegen/types.sets.json`: new set `rustc_lint_defs` (lib.rs + builtin.rs; `hand: LintExpectationId`; no auto_class).
- `tools/codegen/typemap.errors.json`: `Applicability`, `LintId`, `LintExpectationId` now import from
  `src/rustc_lint_defs/lib.ts`; LintId/LintExpectationId got their Debug (`debug_LintId`, `debug_LintExpectationId`).
- Regenerated (`bun tools/codegen/types.ts rustc_errors`, no hand edits): `src/rustc_errors/lib.gen.ts` and
  `src/rustc_errors/decorate_diag.gen.ts`: imports repointed; `unported_debug` for `lint_id` replaced by the real Debug.
  If the emitter lane also regenerates rustc_errors, re-run the generator after merging both typemaps.

## `src/rustc_errors/lib.ts`: what changed (merge with the emitter lane)
1. The stand-in block after `// ---- Stand-ins for crates that are not ported yet (PORT) ----` (Applicability +
   debug_Applicability, Lint, LintId, LintExpectationId, LintLevel, LintLevel_is_error, RECURSION_DEPTH_EXCEEDING_LIMIT_name;
   old lines 96–141) is replaced by 8 lines: imports of `LintExpectationId`, `Level as LintLevel`, `Lint`, `LintId`
   from `../rustc_lint_defs/lib.ts` and `RECURSION_DEPTH_EXCEEDING_LIMIT` from `../rustc_lint_defs/builtin.ts`;
   `export { Applicability, debug_Applicability, listify, pluralize }` (upstream `pub use`); and
   `export { type Lint, LintId, type LintExpectationId, LintLevel }` (PORT: kept for decorate_diag.ts and the emitter port).
   The ThreadId/TimingRecord/Emitter stand-ins below it are untouched.
2. `emit_unused_externs`: `LintLevel_is_error(lint_level)` → `LintLevel.is_error(lint_level)`. `LintLevel_is_error` no
   longer exists (the emitter lane should use `LintLevel.is_error` / `LintLevel.as_str`).
3. `emit_diagnostic`: `RECURSION_DEPTH_EXCEEDING_LIMIT_name` → `RECURSION_DEPTH_EXCEEDING_LIMIT.name`.
4. `Level_eq` doc comment (ids are interned, `===` is value equality). The `type Debug` import on line 22 is now unused
   in lib.ts; left in place to avoid an import-line conflict.

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_lint_defs/src/lib.rs`: 33/33 (2 `rustc-skip`: `stable_hash` x2).
  The macro_rules-internal fns (`impl_lint_pass!` name/get_lints/lint_vec, lib.rs:785/786/790) are on the
  `impl_lint_pass` helper; the `LintPass` trait decls (776/777) on the interface members.
- `.../builtin.rs`: 1/1 (`hardwired::lint_vec`, marker in builtin.gen.ts). The 153 statics carry `// rustc-lint:`
  markers (not counted by coverage); the `declare_lint_pass!(UnusedDocComment ..)` class has `// rustc-lint-pass:`.
- `bun scripts/coverage.ts --check`: markers ok (1985).

## Evidence
- `bunx tsc --noEmit -p .`: clean. `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 422 pass, 1 skip (pre-existing), 0 fail.
- `bun tools/codegen/lints.ts --check`: up to date (153 lints, 147 in `hardwired::lint_vec`).
- `RUST_TS_AGENT=lint-defs bun scripts/difftest.ts --suite fluent-format --sample 100`: 100/100 MATCH.
- **Oracle** (`src/rustc_lint_defs/oracle.test.ts`, runs `rustc +nightly --edition {2015,2018,2021,2024} -W help`):
  for each edition all 150 registered builtin.rs lints are in the table with the same name (`name_lower`, `_`→`-`),
  default level (`Lint.default_level(edition)`, so `@edition` is checked: e.g. unsafe_op_in_unsafe_fn allow→warn in
  2024), description, and the same relative order as `sort_lints` (`(Level, name)`), which also checks `Level`'s order.
  Every lint with `future_incompatible` is in exactly the group rustc_lint derives from `FutureIncompatibilityReason::
  edition()` (`rust-20xx-compatibility` or `future-incompatible`). 3 declared lints are absent from the oracle table
  because nothing registers them (PRIVATE_MACRO_USE, UNSAFE_PANIC_HANDLERS: not in `hardwired::lint_vec`;
  UNSUPPORTED_FN_PTR_CALLING_CONVENTIONS: `register_removed`); the test asserts their absence.
- `lib.test.ts`: `FutureIncompatibilityReason::reference` equals rustc's `= note: for more information, see ...` for
  FORBIDDEN_LINT_GROUPS (release issue) and UNSAFE_OP_IN_UNSAFE_FN (edition guide); Level/Lint/LintId/listify/
  pluralize/parse_rust_version unit checks; derive(Debug) of `LintExpectationId` (plain and `{:#?}`).
- Scenario (lib.test.ts, through `DiagCtxt`): two separately built equal `LintExpectationId`s fulfil one
  expectation (`fulfill_expectation` ×2 + a third id + a `Forced { lint_id: Some }` warning → the stolen set has
  3 ids and `has()` finds freshly built equal ids); the dummy diagnostics are suppressed, the forced one is emitted;
  `Level_eq` on Expected/Forced compares ids by value.
- `tools/codegen/lints.test.ts`: committed file == regenerated; a synthetic invocation using every optional macro
  part (doc attr, escaped/continued desc, eval_always, feature_gate, future_incompatible with fcw!, edition, flags)
  expands to the expected literal; the first macro arm, Custom fcw and `declare_lint_pass!`; rejected inputs
  (unknown level, out-of-order parts, `@msrv`, duplicate/non-bool flag, unknown fcw edition, `#[cfg]`) and a changed
  `macro_rules! declare_lint` body are ERRORs.

## Generator (tools/codegen/lints.ts)
Tokenizes with our rustc_lexer port and unescapes with the vendored rustc_literal_escaper. Reads from upstream
lib.rs: the field order of `struct Lint`/`FutureIncompatibleInfo`, both `default_fields_for_macro` bodies (checked to
list exactly the struct fields), `enum Level` variants; from rustc_span edition.rs the `Edition` variants. The bodies of
`macro_rules! declare_lint` and `macro_rules! fcw` are fingerprinted (sha1 of their token texts): an upstream change
stops generation with an ERROR. Every static is written field by field in struct order (explicit macro fields, the
rest from the defaults), frozen; `feature_gate` → `sym.<gate>`; `fcw!` arms expanded per lib.rs:806. builtin.gen.ts
only type-imports lib.ts, so there is no ESM init cycle (lib.ts does `export * as builtin from "./builtin.ts"`).
Top-level items other than `use`, `mod hardwired { fn lint_vec }`, `declare_lint!`, `declare_lint_pass!` are ERRORs.

## unported(...)
- `debug_HirId` (src/rustc_lint_defs/lib.ts): `HirId` Debug prints the DefId def path (needs tcx). So `{:?}` of a
  `Stable(..)` LintExpectationId is unported; `Unstable(..)` works.

## PORT decisions (root: please record)
1. `LintExpectationId` value equality = interning: the type is the `$`-tagged union intersected with a brand; every
   value comes from `LintExpectationId.Unstable(..)`/`.Stable(..)` (also `from_*` for the `From` impls), which return
   one canonical frozen object per value (module-level `Map` keyed `U<attr_id>.<lint_index>` /
   `S<def_id>.<local_id>.<attr_index>.<lint_index>`). `===`, `Set` (`fulfilled_expectations`), `Map` and `Level_eq`
   therefore compare by value; object literals don't type-check.
2. `LintId.of` returns one canonical `LintId` per `Lint` object (WeakMap), so `===`/Map keys follow upstream's pointer
   identity; `LintId.eq` compares `.lint ===`. `LintId.hash(self, state)` feeds the `Lint` object (Ident pattern).
3. `Lint` stays a data interface with methods on the `Lint` companion const: field `default_level` and method
   `default_level` share a name, so a class is impossible. Same companion pattern for Level, FutureIncompatibleInfo,
   FutureIncompatibilityReason, LintId; `Display` impls are `display_ReleaseFcw`/`display_EditionFcw`.
4. `pub use self::Level::*` → `export const { Allow, Expect, Warn, ForceWarn, Deny, Forbid }`.
5. `pluralize!` → overloaded `pluralize(x)` / `pluralize("has"|"is"|"was"|"this", x)`.
6. `impl_lint_pass!`/`declare_lint_pass!` → `impl_lint_pass(ty_name, () => lints)` helpers returning the `LintPass`
   impl + `lint_vec`; builtin.gen.ts writes the `declare_lint_pass!` expansion inline as a class (`name`, `get_lints`,
   `static lint_vec`). `declare_tool_lint!` has no invocation in ported crates and is not generated yet.
7. Stand-ins for unported rustc_hir_id: `HirId { owner: OwnerId { def_id: LocalDefId }, local_id: ItemLocalId }`
   (branded number) in src/rustc_lint_defs/lib.ts; repoint typemap.lint_defs.json when rustc_hir_id lands.
8. `parse_rust_version`: `u16` sums are plain (overflow would be a const-eval error upstream); `&mut &[u8]` → `MutRef<Uint8Array>`.
9. `StableCompare::stable_cmp` uses a local byte-wise `str_cmp` and `Ordering = -1 | 0 | 1` (exported from lib.ts).
10. Generated statics keep `///` docs; non-doc attributes are emitted as `// #[..]` comment lines (e.g. the two
    `#[doc = "..\u{202E}.."]` lines stay escaped) and plain `//` comments in an invocation follow the docs.

## For root / other lanes
- Fold `typemap.lint_defs.json` into typemap.json when convenient.
- rustc_lint lanes: `rustc_lint::builtin`'s many `declare_lint!`/`declare_lint_pass!`/`impl_lint_pass!` can reuse
  lints.ts (generalise SRC_PATH/OUT_PATH; `declare_tool_lint!` would need its arms added and fingerprinted).
