# Handoff: lint-levels-hir (wave 17, M3: HIR side of rustc_lint lint levels)

Branch `lane/lint-levels-hir`, based on 816b5c5. No merges.

## Result
Lint levels on HIR nodes are real: `shallow_lint_levels_on` builds the per-owner `ShallowLintLevelMap` from
`hir_attr_map` (one attribute set: `add_id` directly; several: the `LintLevelQueryMap` HIR visit in source order),
`ShallowLintLevelMap::probe_for_lint_level_spec` walks `hir_parent_id_iter` across owners, and `skippable_lints`
iterates `hir_crate_items().owners()`. So `TyCtxt::lint_level_spec_at_node` / `emit_node_span_lint` /
`emit_node_lint` (already ported in ty/context.rs) now work: every lint emitted after HIR lowering gets its level
from `#[allow]`/`#[warn]`/`#[deny]`/`#[forbid]`/`#[expect]` on enclosing items, fields, variants, statements, ...
expect.rs is ported (`lint_expectations`, `check_expectations`: unfulfilled `#[expect]`, fulfilled ones from both
early (Unstable ids) and HIR (Stable ids) lints). `LateContext::opt_span_lint` now calls `emit_node_span_lint` /
`emit_node_lint`.

Note: the brief's `lints_that_dont_need_to_run` is `skippable_lints` at the pin.

## Files
- `src/rustc_lint/levels.ts`: `shallow_lint_levels_on` (was unported), `skippable_lints` (owners loop), `LintLevelQueryMap.attrs`
  typed `hir::AttributeMap`, `add_id`, the 13 `Visitor` methods + `maybe_tcx` (`NestedFilter = OnlyBodies`); `add_command_line`
  no longer `private` (called from `shallow_lint_levels_on`). Header updated.
- `src/rustc_lint/expect.ts`: rewritten from stubs to the port of expect.rs (3/3, markers).
- `src/rustc_middle/lint.ts`: `probe_for_lint_level_spec` uses `tcx.hir_parent_id_iter` (local unported helper removed).
- `src/rustc_lint/context.ts` (outside the strict list, but it is the `emit_node_span_lint` plumbing named in the brief):
  `LateContext::opt_span_lint` body (2 lines) instead of `unported`.
- New test driver `src/rustc_lint/levels_hir_oracle/run.ts` (not a port; see its header) and
  `src/rustc_lint/levels_hir.oracle.test.ts` (9 oracle cases, full stderr + exit code equality).

## Coverage
`--missing`: levels.rs 54/54, expect.rs 3/3, rustc_middle lint.rs 17/17, context.rs 58/58. `coverage.ts --check`: markers ok (13337; vendor 3888).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4740 pass, 1 skip, 0 fail.
- `difftest --suite hir-tree-nocore --sample 100`: 99 MATCH, 1 UNPORTED (`tests/ui/delegation/self-coercion-static-free.rs`, not protected,
  `EarlyBinder::skip_binder of tcx.fn_sig(..)`: the known delegation fn_sig repoint, unrelated) (run 20261014-173438-lint-levels-hir-jp3i).
- `difftest --suite expanded --sample 100`: 100/100 MATCH (run 20261014-173506-lint-levels-hir-69ct).
- Oracle cases (`levels_hir.oracle.test.ts`, 9/9 byte-identical stderr and exit code vs rustc `--crate-type=lib --emit=metadata`, std):
  unfulfilled `#[expect]` on fn / struct / field / `let`, `reason` note; crate-level `#![expect]`; fulfilled expectation of an early lint
  (`redundant_semicolons`, Unstable id) and of a HIR lint (`invalid_type_param_default` from `generics_of`, Stable id);
  `#[allow(unfulfilled_lint_expectations)]` / `#[deny(..)]` on enclosing modules (cross-owner parent walk, "lint level is defined here");
  `#[expect(unfulfilled_lint_expectations)]` note; trait and impl items; `#![forbid]` + `#[allow]` (E0453, then `analysis` aborts before
  `check_expectations`); `#![deny(warnings)]` + inner `#![warn]`; fields and variants with several attributes (HIR visit path);
  attributes on generic params (upstream's visitor does not `add_id` them when the owner has several attributes; matched);
  `--cap-lints warn`, `--force-warn` over `#[allow]` + `-D warnings`, `-A unfulfilled-lint-expectations` vs `#![warn]`.
- Not reachable yet: `bare_trait_objects` (HIR ty lowering stops at `rustc_trait_selection::traits::util::expand_trait_aliases`), so
  there is no oracle case of a lint on a field type; late lint passes (`late::check_crate`) are still stubs.

## unported(...) left
None in levels.rs / expect.rs / lint.rs. Callers elsewhere still stop before reaching these: `rustc_hir_analysis::check_crate`,
`rustc_lint::late::{late_lint_mod, check_crate}`, `middle/stability.rs late_report_deprecation` (its unported string also names
`emit_node_span_lint`, which now exists; owner of stability.ts may reword it), `rustc_interface` `analysis` (does not call
`check_expectations` yet).

## PORT decisions (root: please record)
1. `LintLevelsBuilder` extends the HIR `intravisit::Visitor` class for every provider; the `impl Visitor for
   LintLevelsBuilder<'_, LintLevelQueryMap>` methods cast `this` to the `LintLevelQueryMap` builder (only
   `shallow_lint_levels_on` visits). The `TopDown` builder never uses them.
2. `check_expectations`' `FxHashSet<(AttrId, u16)>` is a `Set<string>` keyed `"<attr_id>.<lint_index>"`.
3. `StableLintExpectationId.hir_id` is rustc_lint_defs' field-only `HirId` stand-in; expect.ts casts it to `rustc_hir_id::HirId`
   for `hir_attrs` (reads only `owner.def_id`/`local_id`) and `emit_node_span_lint` (the ids come from
   `LintLevelQueryMap::mk_lint_expectation_id`, so they are real `HirId`s).
4. `attrs.map.range(..)` in `shallow_lint_levels_on` is `SortedMap.iter()` (the whole map).

## Root follow-ups
- Wire `tcx.ensure_ok().check_expectations(None)` into `analysis` when that is ported (rustc_interface passes.rs:1263).
