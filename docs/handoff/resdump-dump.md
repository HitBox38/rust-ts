# Handoff: lane `resdump-dump` (wave 11, M2a)

Branch `lane/resdump-dump`. The port side of the `resdump-nocore` suite now prints the probe's dump.

## Files touched
- `src/rust_ts/resdump.ts`: the entry point. `after_expansion` now prints `dump(tcx)` with `std_print` and returns `Stop`.
  It calls `ensure_stack()` and handles stack overflow the way `src/rust_ts/main.ts` does (the subject had no stack
  re-exec before). The compiler modules are loaded with dynamic imports *after* `ensure_stack`, so the re-exec
  doesn't load the compiler twice.
- `src/rust_ts/resdump_dump.ts` (new, our own code): `tools/probes/resdump/main.rs`'s `fn dump`, section by section,
  with the same sort keys: (1) DefIndex, (3) symbol string in code-point order then `{:?}`, (4) span (lo, hi, `{:?}`),
  (5) NodeId. It uses stable sorts, like `sort_by_key`. Index-ordered maps are printed in JS `Map` insertion order.
  It lives in its own module so `resdump.ts` can load it lazily (see above).
- `src/rustc_interface/callbacks.ts` (new): partial port of `callbacks.rs`. Ported: `def_id_debug` and
  `setup_callbacks`. `setup_callbacks` swaps only `DEF_ID_DEBUG`. The other hooks' statics don't exist in rust-ts, so
  `track_span_parent`, `track_diagnostic`, `track_feature` and `emit_bug_diagnostic` are left unported. They are
  listed in the module comment (`// PORT:`).
- `src/rustc_interface/interface.ts`: `run_compiler` now calls `setup_callbacks()`, as upstream does at
  interface.rs:395. It replaces the old "not run" PORT note. `// PORT:` the rest of `run_compiler` is wrapped
  in try/finally so the previous `DEF_ID_DEBUG` is restored on return. Without this, in-process test
  compilers (with_resolver.ts, resolver_new/ident/check_unused tests) leaked `def_id_debug` into later test
  files that check the default `DefId { krate, index }` format (9 failures). Real runs can't observe it.
- `src/rustc_interface/lib.ts`: re-exports `setup_callbacks`.
- `src/rustc_middle/ty/context.ts`: ported `TyCtxt::def_path_debug_str` (context.rs:1224). The `Symbol` and
  `StableCrateId` imports are now value imports.
- `src/rustc_middle/middle/resolve.ts`: `debug_LifetimeRes` now prints `Fresh { param, kind }` (before, it called
  `unported`). Added `debug_MissingLifetimeKind` (`// PORT:`): this is the derived Debug of `rustc_hir::MissingLifetimeKind`
  over the string stand-in in `rustc_resolve/late.ts`, which carries the variant name.
- Tests, PENDING removed (all match the oracle now):
  - `src/rustc_resolve/macros_oracle.test.ts`: resdump STOPS cleared.
  - `src/rustc_resolve/imports.test.ts`: PENDING cleared (5 cases).
  - `src/rustc_resolve/late/diagnostics.test.ts`: PENDING cleared (3 cases).
  - `src/rustc_resolve/late/diagnostics_b.test.ts`: PENDING cleared.
  - `src/rustc_resolve/late_a.test.ts` (3 cases) and `src/rustc_resolve/late_b.test.ts` (`PENDING_DRIVER`, 4 cases):
    these are not in the brief's list, but the same resdump runs, which now match. Cleared so that the suite stays green.
- The driver hook (`Callbacks::after_expansion` in `rustc_driver_impl/lib.ts`) was already wired. I didn't change it.

## PORT decisions
- `debug_TraitCandidate` lives in `resdump_dump.ts` as the derived Debug of the `rustc_hir::TraitCandidate` stand-in
  (`rustc_resolve/lib.ts`). When hir.rs is ported (M3), move it there.
- `debug_MissingLifetimeKind` is typed `Debug<unknown>`, because `PerOwnerResolverData`/`LifetimeRes` type the kind
  as `unknown`. It panics on a value that is not a variant name.

## Coverage
- `compiler/rustc_interface/src/callbacks.rs`: 2/6 (missing: track_span_parent, track_diagnostic, track_feature,
  emit_bug_diagnostic; see above).
- `bun scripts/coverage.ts --check`: markers ok.

## Results
- `resdump-nocore --sample 300`: MATCH 276, DIFF 0, UNPORTED 24 (92.0%). Stops:
  - 23 at `rustc_metadata::locator::CrateLocator::new` (`extern crate`, lane locator);
  - 1 at `std::panic::Location::caller (DiagLocation Display)`: `tests/ui/tool-attributes/nested-disallowed.rs`.
    The oracle ICEs on a delayed bug ("delayed at .../crate_level.rs:355:23"). The case is UNPORTED in
    `expanded-nocore` too.
- `expanded-nocore --sample 200`: MATCH 183, DIFF 0, UNPORTED 17 (91.5%).
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3618 pass, 0 fail, 1 skip.

## unported(...) left
- None new. `resolve.ts` lost one: the `LifetimeRes::Fresh` Debug.

## Environment note (for root)
- The tracked `node_modules` symlink (`-> ../../node_modules`) is broken in the main checkout and in every lane
  worktree: neither `.data/node_modules` nor `../node_modules` exists. That's why `bunx tsc` fails with
  "Cannot find type definition file for 'bun'". In this worktree I replaced it locally with
  `bun install --frozen-lockfile`. The symlink deletion is **not** committed (`git status` shows ` D node_modules`).
