# Handoff: ast-passes (wave 10, M2: rustc_ast_passes)

Branch `lane/ast-passes`, based on main bb96986. Not merged, not pushed.

## Result
All of `compiler/rustc_ast_passes` is ported. passes.ts now calls the real `ast_validation::check_crate` and
`feature_gate::check_crate`.

The driver cannot reach either pass yet: every nocore case stops earlier, at `rustc_lint::late::unerased_lint_store`
(pending lint-early-a). The tests therefore use a scenario runner (below) that runs both passes on the parsed crate
root and compares the diagnostics with real rustc.

## Files
- **New (owned):**
  - `src/rustc_ast_passes/lib.ts` (lib.rs)
  - `ast_validation.ts`: 72/72 fns
  - `feature_gate.ts`: 28/28 fns
  - `diagnostics.ts`: the hand `impl Subdiagnostic for EmptyLabelManySpans`, 1/1
  - `diagnostics.gen.ts`: GENERATED, new codegen set `rustc_ast_passes`. 108 types, 107 diagnostic derives, 0 missing.
  - Tests: `oracle.test.ts`, `oracle/run.ts` (the test runner, not a port), `oracle/cases.txt`, `oracle/ui_cases.txt`
- **New, outside the assignment (please review / assign an owner):**
  - `src/rustc_abi/extern_abi.ts`: extern_abi.rs, 14/16. `hash` and `stable_hash` are not ported and have no marker, because nothing hashes an `ExternAbi` yet. Includes `AbiFromStrErr` (lib.rs:2486) and `debug_CVariadicStatus`.
  - `src/rustc_abi/extern_abi/tests.test.ts`: tests.rs, 4/4
  - `src/rustc_target/spec/abi_map.ts`: abi_map.rs, 5/5
  - These are needed by `check_extern_fn_signature`, the C-variadic checks and the ABI diagnostic args. With `unported` stubs instead, every `extern "C" fn` would stop validation.
- **Changed:**
  - `src/rustc_interface/passes.ts`: the two call sites now go through `rustc_ast_passes.{ast_validation,feature_gate}.check_crate`; the two shim fns are deleted.
  - `tools/codegen/types.sets.json`: added the set `rustc_ast_passes`.
  - `tools/codegen/typemap.hir.json`: `rustc_abi::ExternAbi` is now the real type (was `unknown`).
    - Regenerating every set changes only `src/rustc_crate_store/cstore.gen.ts`: `ForeignModule.abi: ExternAbi` plus its real Debug.
  - `tools/codegen/diag_args.json`: `ExternAbi` maps to `ExternAbi_into_diag_arg` / `display_ExternAbi`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok (6263). `--missing` is 0 for all four rustc_ast_passes files.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3023 pass, 1 skip, 16 fail. None of the failures come from this lane:
  - **14 are already failing at base bb96986.** They are in output.oracle.test.ts and driver.oracle.test.ts, whose PENDING stop texts still name `Resolver::arenas (pending res-lib)`, while the driver now stops at the lint store. The same 14 fail at base; on current main they pass.
  - **2 are in inputs.oracle.test.ts and were flaky:** `getcwd` failed because a parallel run deleted the scratch cwd. The file passes 6/6 when run alone.
- `difftest --suite parse --sample 300`: 300/300 MATCH (run 20261013-125157-ast-passes-vxy1).
- `difftest --suite parse-ui --sample 300`: 300/300 MATCH (run 20261013-125205-ast-passes-ibje).
- `expanded-nocore --sample 100`: 2 MATCH, 98 UNPORTED, all at the lint store, unchanged (run 20261013-125218-ast-passes-vi0o).

## Tests (`src/rustc_ast_passes/oracle.test.ts`, about 10 s, live oracle)
- **How the runner works.** `oracle/run.ts` runs the ported driver up to `after_crate_root_parsing`. There it runs, in the same order as rustc:
  1. `pre_configure_attrs`
  2. `get_crate_name`
  3. `rustc_expand::config::features`
  4. `ast_validation::check_crate`
  5. `feature_gate::check_crate`

  It then returns Stop and prints the buffered early lints on stdout.
- **What it is compared with.** The oracle runs `rustc <file> <args> -Zunpretty=expanded`. Both sides get `-Zcrate-attr=feature(no_core) -Zcrate-attr=no_core`. The test compares stderr and the exit code byte for byte.
- **`cases.txt`: 130 hand scenarios; 125 MATCH, 5 PENDING.** The scenarios cover:
  - visibility qualifiers in trait, impl, enum and extern positions
  - `const fn` in traits, impls and const traits
  - `async fn` in a const trait
  - extern-block items with bodies, qualifiers, generics or bounds, and non-ASCII names
  - `safe`/`unsafe` misuse, including the edition 2024 `unsafe extern`
  - unsafe negative impls and `const async`
  - C-variadic placement, missing extern, missing unsafe, bad ABI and const, including naked ABIs on x86_64 and wasm32-wasip2
  - generic parameter order and trailing defaults
  - nested `impl Trait`, `impl 'a`, duplicate or misplaced `use<>`
  - `self` placement, and patterns in fn pointers, bodiless fns and parenthesized args
  - items without bodies, default/final, auto-trait restrictions, fieldless unions, where clauses after type aliases
  - `[const]`, `const` and negative bound checks
  - `#[track_caller]` with non-Rust ABIs
  - the custom, x86-interrupt and gpu-kernel ABIs (with `--target x86_64-unknown-linux-gnu`), and scalable vectors on x86_64 and aarch64
  - about 40 feature gates, both the post-expansion visitor and `gate_all!`: box patterns, try blocks per edition, yield, let chains in 2021 and 2024, never type, gen blocks, guard patterns, unsafe binders and fields, never patterns, become, yeet, builtin #, postfix match, closure binders, RTN, frontmatter, and others
  - incompatible and dependent features, and the `-Znext-solver` warnings
- **PENDING (5 cases).** Our diagnostics must occur in order in the oracle's output, and the buffered lints must be the expected ones:
  - `multiple_self_params` needs the resolver (E0415).
  - `missing_abi_lint`, `unused_visibility_lint`, `where_clause_before_assoc_type_lint` and `patterns_in_fns_without_body_lint` are buffered lints that the early lint pass emits (lint-early-a).
  - Note: the dropped scenario `#[cfg(any())] auto trait` shows that the runner does not expand; the soft-gate warnings appear only after cfg stripping.
- **`ui_cases.txt`: 209 tests/ui files, all MATCH.** These are the non-empty MATCH results of a scan, run with `--crate-type=lib -Zui-testing` and the file's edition:
  - feature-gates 26/284
  - parser 585/924, every 4th taken
  - c-variadic, extern, auto-traits, self, generics, traits/const-traits, impl-trait/precise-capturing, where-clauses and specialization: 37
- **Scan results.** No case of the scan was UNPORTED or ICE. The DIFFs I inspected all come from one of these:
  - name resolution, macros or `std` (no_core)
  - early lints
  - cfg stripping, because the runner does not expand
  - the different position of the post-resolve feature checks

  The scan script is `$RUST_TS_DATA/tmp/ast-passes/scripts/uiscan.ts`, with results in `$RUST_TS_DATA/tmp/ast-passes/uiscan-*`.
- **Negative control.** Disabling the `visibility_not_permitted` check fails the scenario test.

## `unported(...)` left
None in the lane's files. The runtime limits come from other crates: the attribute parsers and the lint store.

## PORT decisions (please record)
1. **Macros as functions.**
   - `gate!`, `gate_alt!`, `gate_multi!`, `gate_all!` and `soft_gate_all_legacy_dont_use!` are local functions.
   - `$feature` is the feature's name as a string key: `visitor.features[name]()` is `features.$feature()`, and `sym[name]` is `sym::$feature`.
   - `walk_list!` is an inline `for` loop.
2. **Enums local to `ast_validation`.**
   - `SelfSemantic`, `AllowDefault` and `AllowFinal` are string unions.
   - `SplatSemantic` and `TraitOrImpl` are tagged unions, with their methods on companion consts.
3. **`AstValidator` / `PostExpansionVisitor`** are `Visitor` subclasses. Inherent and `Visitor` methods sit in one class body; the markers keep upstream lines (PORTING §8).
   - `ImplTraitVisitor` is a class nested inside `check_impl_trait`, as upstream.
   - `with_*(f)` take `(this_) => …` closures.
4. **Collections.**
   - `check_decl_splatting`: `BTreeMap<u16, Vec<Span>>` becomes `[index, spans][]` in ascending order, and `split_off` becomes a filter.
   - `validate_generic_param_order`: the `FxIndexMap` becomes an insertion-ordered `Map`; `sort_by_key((po, i))` becomes a stable sort on (discriminant, index).
5. **String helpers.** `str::is_ascii` is a local `str_is_ascii`, and `Itertools::is_partitioned` is written out inline.
6. **`CFG_RELEASE_CHANNEL`** is the local constant `"nightly"` (as rustc_driver_impl/lib.ts). It only matters on non-nightly builds.
7. **`ExternAbi`.**
   - Unit variants are frozen singletons, and unwind variants are `{ $, unwind }`.
   - The `abi_impls!` table is `ABI_TABLE`.
   - `PartialEq` and `Ord` go through `as_str`, as upstream: `ExternAbi.eq` / `ExternAbi.cmp`.
   - `ExternAbi_into_diag_arg = into_diag_arg_using_display(display_ExternAbi)`.
8. **`AbiMap::canonize_abi`**'s guarded tuple `match` is an if-chain in arm order.

## For root
- **rustc_abi/lib.ts:** add `export * from "./extern_abi.ts"` (upstream `pub use extern_abi::*`), move `AbiFromStrErr` into lib.ts, and drop its `CVariadicStatus` stand-in in favour of extern_abi's.
- **rustc_target spec/mod.ts:** re-export `AbiMap` and `AbiMapping` from `./abi_map.ts` (the `// pub use abi_map::{AbiMap, AbiMapping}; (not ported)` line). Its `is_abi_supported` can then be ported.
- **canon_abi.ts:** `display_CanonAbi` can now use `ExternAbi.as_str`.
- **attr-parse-b (link_attrs.ts:345):** `unported("rustc_abi::ExternAbi::from_str …")` can now call `ExternAbi.from_str`.
- **When lint-early-a lands:**
  - the driver reaches both passes;
  - the 4 lint PENDING cases should match through the real driver;
  - `oracle/run.ts` can then be replaced by plain `src/rust_ts/main.ts` runs.
- **When this merges:** update the 14 stale PENDING stop texts in output/driver oracle tests if main has not already done so.
- `docs/claims/wave10-ast-passes.md` can be removed on integration.
