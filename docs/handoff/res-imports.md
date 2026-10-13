# Handoff: res-imports (wave 10, M2: rustc_resolve imports.rs + check_unused.rs)

Branch `lane/res-imports` (from main bb96986, no merges). Commits: imports.rs port; check_unused.rs port;
calc_unused_spans oracle test; imports.test.ts; this handoff.

## Files
- `src/rustc_resolve/imports.ts`: all of imports.rs. Stub fully replaced; no `unported_methods` left.
- `src/rustc_resolve/check_unused.ts`: all of check_unused.rs. Stub fully replaced.
- New tests:
  - `src/rustc_resolve/check_unused.test.ts`, with `imports_oracle/unused_spans.{rs,oracle.txt}`.
  - `src/rustc_resolve/imports.test.ts`, with `imports_oracle/{use_forms,glob_conflict,unresolved,reexport,unused}.rs`, their
    `.resdump.stdout` / `.resdump.stderr` / `.expanded.stderr` fixtures, and `exit_codes.json`.
- decls.ts was not touched, and no other lane's files were edited.

## Coverage
| file | ported |
|---|---|
| imports.rs | 39/39 |
| check_unused.rs | 15/15 |

`bun scripts/coverage.ts --check` reports `markers ok (6193; vendor 2403)`.

## Checks
- `bunx tsc --noEmit -p .` is clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools` gives 3033 pass, 1 skip and 14 fail.
  - The 14 failures are already there at the lane base and are not caused by this lane. They are in
    `rustc_session/output.oracle.test.ts` and `rustc_driver_impl/driver.oracle.test.ts`.
  - Those tests still expect the pending stop `Resolver::arenas (pending res-lib)`, but since 4398b7f the driver
    stops at the lint store. Main already fixed this in 9c56091 ("driver pending stop points"), and both files pass on main.
- Sample difftests:
  - `--suite parse --sample 200` gives 200/200 MATCH (run `20261013-124542-res-imports-ewar`).
  - `--suite expanded-nocore --sample 50` gives 50 UNPORTED. Every case stops at `rustc_lint::late::unerased_lint_store`,
    which is unchanged by this lane (run `20261013-124549-res-imports-at56`).
- **Trial merge into main f2cd302.** I did it in a scratch worktree, then removed it; nothing is committed. tsc stays clean.
  - Two of res-ident's PENDING tests in `ident.test.ts` now get past my former stubs. **Root must update them when integrating:**
    1. "resolve_ident_in_scope_set All(TypeNS) falls through to the builtin `u8`" now stops at
       `rustc_resolve::macros::sub_namespace_match` instead of `imports::cycle_detection::enter_cycle_detector`.
    2. "ModuleGlobs without finalize" no longer reaches unported code, so it should leave PENDING.
  - ident.ts uses `enter_cycle_detector` / `ActiveResolutionGuard_drop` / `PendingDecl` / `NameResolution`, and the
    signatures stay compatible.

## Tests
- **check_unused.test.ts (live oracle).**
  - Input: imports_oracle/unused_spans.rs. It produces 14 `unused_imports` warnings covering:
    - braced partial-unused groups;
    - collapsing of adjacent removals;
    - brace removal when one child is left;
    - `self` groups, where braces are kept;
    - nested groups, empty `{}` groups, globs;
    - multi-line groups, trailing commas, renames;
    - an attribute on the `use`, where the whole item is removed.
  - What is compared with the oracle's JSON (`rustc +nightly --error-format=json`): message, primary spans and every
    suggestion part in order.
  - How it runs: the ported parser parses the file. The test numbers the use trees and marks as unused the leaves at
    the oracle's primary spans. From there `calc_unused_spans` and the generated `UnusedImports` diagnostic decide
    everything.
  - The fixture freshness check reruns the oracle.
  - Negative control: flipping `!contains_self` fails the test.
  - Regenerate with `REGEN=1 bun test src/rustc_resolve/check_unused.test.ts`.
- **imports.test.ts, end to end.**
  - There are 5 no_core crates with the resdump-nocore arguments, `--edition=2021`, and `-Zunpretty=expanded` for the
    early-lint stderr. They cover:
    - `use` forms;
    - glob conflicts (E0659, ambiguous/hidden glob re-exports, glob cycles);
    - unresolved imports with suggestions (similar name, grouped errors, `self::*`, non-module glob);
    - `pub use` re-export errors (E0364, E0365, E0603, macro_rules, redundant glob visibility);
    - unused, redundant and unnecessary-qualification lints, including the `#[cfg(test)]` help.
  - Fixtures: the resdump probe's stdout/stderr and rustc's `-Zunpretty=expanded` stderr. The `import_res`, `glob_map`,
    `module_children` and `lint_buffer` sections are in them.
  - A guard test checks that each fixture still contains what it is named for.
  - Regenerate with `REGEN=1 bun test src/rustc_resolve/imports.test.ts`. The fixtures are rechecked whenever the probe
    and toolchain are present.
  - **PENDING: all 5.** The driver stops before resolution (lint-early-a), then needs res-graph, res-ident, res-macros,
    late, diagnostics and CStore. The test asserts that a pending case still exits 70, so a case that starts running
    fails the test until it is taken off PENDING and compared.
- **imports.test.ts, unit checks.** Expectations follow the upstream code cited in each case.
  - `import_path_to_string` / `import_kind_to_string`.
  - The cycle detector and its guard's drop order.
  - `index_set_swap_remove`.
  - `determined_decl` / `best_decl` / `PendingDecl::decl`.
  - `remove_same_import` / `select_glob_decl`: re-fetch, keeping the old ambiguity, different res, ambiguous newcomer,
    identical.

## `unported(...)` left
None in imports.ts or check_unused.ts. Calls still reach other lanes' stubs:
- `check_reserved_macro_name`, `expn_def_scope`, `get_macro_by_def_id` (res-macros / res-graph);
- `plant_decl_into_local_module`, `get_nearest_non_block_module` (res-graph);
- `dcx`, `def_path_str`, `report_error`, `make_path_suggestion`, `check_for_module_export_macro`, `lookup_import_candidates`,
  `lint_if_path_starts_with_module`, `throw_unresolved_import_error` (res-diag);
- `cstore().had_extern_crate_load_failure()` in `finalize_imports` (wave 11);
- `tcx.is_compiler_builtins` and friends for extern crates.

## PORT decisions (please record)
1. **Cycle detector key.** `cycle_detection`'s `*const ()` key is the `LocalModule` object, compared by identity, and
   the `BindingKey` uses `BindingKey_eq`. imports.gen.ts maps the raw pointer to `null`, so imports.ts exports a local
   `ActiveResolutionGuard { key: [LocalModule, BindingKey] }`.
   - Root follow-up: give `*const ()` a typemap entry, or `skip` the generated `ActiveResolutionGuard`.
   - `Drop` becomes an explicit `ActiveResolutionGuard_drop`.
2. **The glob-importers borrow.** `CmRefCell` erases `RefCell` borrow tracking, but upstream observes the failure of
   `glob_importers.try_borrow_mut` in `update_local_resolution`: a glob cycle re-entering the same module stops there.
   A module-level `GLOB_IMPORTERS_BORROWED` set tracks those borrows, held in try/finally while planting into the
   importers. No other code holds that borrow long enough to matter.
3. **`swap_remove`.** `FxIndexSet::swap_remove` (`single_imports`, `maybe_unused_trait_imports`) is the new exported
   helper `index_set_swap_remove` in imports.ts. It does what rustc_errors' `index_map_swap_remove` does.
   Candidate for a shared std/rust_ts helper.
4. **Copies of keys.** `let mut key = *key` / `let mut ident = key.ident` are `clone_BindingKey` / `clone_IdentKey`
   before `update_unchecked` (keys stored in KeyedMaps are never mutated).
5. **`usize::MAX`** in `resolve_imports` is `Number.MAX_SAFE_INTEGER`.
6. **Sequential loop.** `par_for_each_slice` is a sequential loop. `extract_if` is a partition that preserves order and
   counts every element.
7. **Equality helpers** local to imports.ts: `ModuleOrUniformRoot_eq` (derived `PartialEq`), `opt_vis_eq`, `ambiguity_eq`.
   Res uses `Res_eq`, and `== Res::Err` is `.$ === "Err"`.
8. **The `Session` downcast.** `sess.downcast_ref::<Session>().expect(..)` in `check_unused` is `instanceof Session`,
   else `panic("expected a `Session`")`.
9. **Snippet sort.** `span_snippets.sort()` uses a local code-point `str_cmp`, so the order is byte-wise as in Rust.
   `redundant_spans.sort(); dedup()` sorts stably by `(OrdSpan, bool)`, then drops consecutive duplicates.
10. **Nested fns.** `is_redundant_import` / `is_unused_import` are nested function declarations inside `check_unused`,
    as upstream, each with its own marker.
11. **Field access.** Field access to the lint buffer is the `lint_buffer_` field (upstream `self.lint_buffer.`), and
    `self.tcx` is `tcx_`.

## Hash-map iteration
Nothing in these two files iterates a hash map:
- the resolution tables are `FxIndexMap`;
- `unused_imports` and `check_redundant_imports` are index maps and sets;
- everything else is a `Vec`.

The `FxHashSet`/`UnordSet`/`FxHashMap` values are only queried, and `externally_implementable_items(..).values().all(..)`
does not depend on order. hashbrown-order is therefore not needed here.

## For root
- Update the two PENDING entries in ident.test.ts at integration (see Checks).
- Record the PORT decisions above. Consider moving `index_set_swap_remove` to a shared module.
- Delete `docs/claims/wave10-res-imports.md` on integration.
