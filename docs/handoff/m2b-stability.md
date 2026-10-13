# Handoff: m2b-stability (M2b): rustc_middle `middle/stability.rs`, macro stability/deprecation reporting

Branch `lane/m2b-stability`, based on main 31568d0. `lane/harness-w12` is merged into it locally (no-ff), only so
that the with-std suite definitions were there for testing. Root merges harness-w12 first, so the merge commit is
redundant after that.

## Files touched
- `src/rustc_middle/middle/stability.ts` (new): hand port of `compiler/rustc_middle/src/middle/stability.rs`. It holds
  every fn in upstream order: `DeprecationEntry::{local, external, same_origin}`, `report_unstable`,
  `deprecation_lint`, `Deprecated`'s manual `impl Diagnostic` (`Deprecated_into_diag`), `deprecated_since_kind`,
  `early_report_macro_deprecation`, `late_report_deprecation`, and the `impl TyCtxt` block
  (`eval_stability`, `eval_stability_allow_unstable`, `eval_default_body_stability`, `check_stability`,
  `check_stability_allow_unstable`, `check_optional_stability`, `check_const_stability`, `lookup_deprecation`).
  The `impl TyCtxt` methods sit on `TyCtxt.prototype` via `declare module "../ty/context.ts"`.
- `src/rustc_middle/middle/stability.gen.ts` (new, GENERATED): the types `UnstableKind`, `DeprecationEntry` (class),
  `DeprecationSuggestion` and its `#[derive(Subdiagnostic)]` (`DeprecationSuggestion_add_to_diag` /
  `_subdiagnostic`), `Deprecated`, `EvalResult`, `AllowUnstable`.
- `tools/codegen/types.sets.json`: new set `rustc_middle_stability` (files: `middle/stability.rs`, `auto_class`). The
  existing `rustc_middle` set is `derive_only`, so the file can't go there. This follows the precedent of
  `rustc_metadata_rmeta`. Regenerate with `bun tools/codegen/types.ts rustc_middle_stability`.
- `tools/codegen/typemap.middle_stability.json` (new): typemap entries for `rustc_attr_ir::Deprecation` and
  `rustc_lint_defs::DeprecatedSinceKind`, which are used from outside their own sets. Root may fold these into
  typemap.json.
- `src/rustc_middle/queries.gen.ts` (GENERATED, regenerated with `bun tools/codegen/queries.ts`): the
  generator now finds the generated `DeprecationEntry`, so `lookup_deprecation_entry`'s value is
  `Option<DeprecationEntry>` (it was `unknown`) and has a Debug. `tools/codegen/queries.test.ts` requires the
  committed file to be up to date. Loading each of `queries.gen.ts`, `ty/context.ts`, `query/calls.ts`,
  `rustc_middle/lib.ts`, `rustc_resolve/lib.ts` and `rustc_interface/lib.ts` on its own works, with no import
  cycle failure.
- `src/rustc_resolve/macros.ts`: call sites only. `check_stability_and_deprecation` now calls the real
  `report_unstable(.., UnstableKind.Regular)` and `early_report_macro_deprecation`. The two local `unported`
  stand-ins and their imports, which were now unused (`Deprecation`, `LintBuffer`, `unported`), are gone. The
  module is imported with named imports because a local `stability` variable shadows a namespace import.

Not touched, for root: `src/rustc_middle/lib.ts` doesn't re-export the module (upstream has
`pub mod middle { pub mod stability }`). It is loaded today through `rustc_resolve/macros.ts`. If root wants the
`TyCtxt` methods always attached, add `export * as stability from "./middle/stability.ts";` next to `resolve`/`privacy`.

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_middle/src/middle/stability.rs`: **17/17 ported**.
- `bun scripts/coverage.ts --check`: markers ok.

## HIR-bound fns (markers kept, stop at `unported`)
- `eval_stability_allow_unstable` (:303): only the `if let Some(id) = id` deprecation branch.
  `unported("rustc_middle::hir::map::TyCtxt::hir_get_parent_item (HIR, M3)")` is reached only when
  `lookup_deprecation_entry(def_id)` is `Some`. The upstream code after it is kept verbatim. Everything with
  `id: None` is fully ported.
- `late_report_deprecation` (:210): ported up to the `lint_level_spec_at_node(..).is_allow()` early return, then
  `unported("rustc_middle::middle::stability::late_report_deprecation: with_no_trimmed_paths!(def_path_str) / def_descr / hir_node / emit_node_span_lint (ty::print, HIR; M3)")`.

There are no other `unported(...)` calls in the file.

## `// PORT:` decisions
- Query values still typed `unknown` in queries.gen.ts (`lookup_stability`, `lookup_const_stability`,
  `lookup_default_body_stability`; their Rust types are `rustc_hir::{Stability, ConstStability, DefaultBodyStability}`,
  re-exports with no typemap entry) are cast to those types at each use, as `rustc_resolve` already does for
  `lookup_stability`. A queries.config.json alias `rustc_hir::` -> `rustc_attr_ir::` for these would remove the casts;
  that is left to the queries generator's owner.
- The header comment says the HIR-needing `TyCtxt` methods stop at `unported` where upstream first needs them.
- The `msg!` literals of `Deprecated::into_diag` reproduce the Rust literal bytes exactly: the newlines and the
  16/20/24-space indentation of the source lines, with `{\"\"}` written as `{""}`.

## Tests
Scratch is in `$RUST_TS_DATA/tmp/m2b-stability/` (`cmp.sh <file> <edition> <unpretty>` runs the oracle and the
subject with the with-std argv and compares stdout, stderr and the exit code).

The synthetic cases are in `cases/`. All MATCH under `-Zunpretty=expanded` (editions 2015 and 2021) and
`ast-tree,expanded` (2021):
- `unstable_std.rs`: `log_syntax!`, `trace_macros!` (unstable with a reason), `format_args_nl!`, `concat_bytes!`
  (no reason), `std::assert_matches::assert_matches!`
- `unstable_reason.rs`: `autodiff_forward!`, `type_ascribe!` (reason), `cfg_select!`, `pin!`, `offset_of!`, private
  `const_eval_select!`
- `soft.rs`: `#[bench]` and `#[test_case]` (soft-unstable / custom_test_frameworks)
- `depr_local.rs`: `#[deprecated]` macros with no note, with a note, with `since` + note, and `since = "TBD"`
  outside staged_api
- `depr_staged.rs`: staged_api + `deprecated_suggestion` + `#![warn(deprecated_in_future)]`. It covers all three
  `DeprecatedSinceKind` messages (InEffect / InFuture / InVersion), `suggestion =` (the verbose
  "replace the use of the deprecated macro" suggestion) and a local `#[unstable(reason = ..)]` macro.
- `depr_lint_lvl.rs`: `#![deny(deprecated)]` together with an `#[allow(deprecated)]` fn, which exercises the
  buffered lint level
- `depr_std.rs`: `try!` and a `#[derive]` on a deprecated struct (`in_derive_expansion`)

The seven stops from the harness-w12 handoff now MATCH in `expanded`, `unpretty-expanded` and `resdump` (`--filter`
each): feature-gate-{autodiff-use, contracts, custom_test_frameworks, mgca-type-const-syntax, type_alias_impl_trait},
unbraced_const_block_const_arg_gated, lint/lint-qualification.

Directory sweeps on `expanded` (`--filter`), with no DIFF anywhere:

| filter | MATCH/total |
|---|---|
| `feature-gates/` | 293/293 |
| `deprecation/` | 23/23 |
| `macros/` | 501/527 |
| `lint/` | 741/743 |

The UNPORTED cases in those sweeps are `resolve_path` ×17, `BangProcMacro::expand` ×6, `DeclaredIdents` ×3 and
`Location::caller` ×2. None of them is a stability stop.

Samples (`RUST_TS_AGENT=m2b-stability`):

| suite | sample | MATCH | DIFF | UNPORTED | run |
|---|---|---|---|---|---|
| expanded (`--seed hw12-wide`) | 1500 | 1491 (was 1484) | 0 | 9 (was 16) | `20261013-212304-m2b-stability-aiz0` |
| expanded | 300 | 298 | 0 | 2 | `20261013-212701-m2b-stability-rl8j` |
| parse | 200 | 200 | 0 | 0 | `20261013-212750-m2b-stability-ss9b` |

Stop histogram, 1500 wide sample:
- before (harness-w12): `resolve_path` 6, `stability::report_unstable` 6, `early_report_macro_deprecation` 1,
  `DeclaredIdents` 1, `Location::caller` 1, `Path::file_name` 1
- after: `resolve_path` 6, `DeclaredIdents` 1, `Location::caller` 1, `Path::file_name` 1

The 300 sample stops are `resolve_path` 1 and `Location::caller` 1.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: ok.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3889 pass, 1 skip, 0 fail (after the queries.gen.ts regeneration; before it, `queries.test.ts` "committed queries.gen.ts is up to date" failed).
