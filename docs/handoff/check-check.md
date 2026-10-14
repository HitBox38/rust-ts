# Handoff: check-check (wave 17, M3): rustc_hir_analysis check/check.rs and check/mod.rs

Branch `lane/check-check`, based on main `8ac6eb5`, with no merges. Commits:
- `9919f56`: `check_abi` on its own;
- `b1b529e`: the rest of the port;
- `7aa4136`: the oracle tests and the review fixes;
- one more commit for this handoff.

## Result
- **`check::check_abi` (check.rs:62) is ported.** Its helper `add_abi_diag_help` (:48) and the fn-local
  `UnsupportedCallingConventions` manual `Diagnostic` (`into_diag`, :68) are ported with it. The fn uses
  `AbiMap::from_target(..).canonize_abi(abi, false)` from rustc_target spec/abi_map.ts, which was already ported:
  - `Direct`: nothing;
  - `Invalid`: `span_delayed_bug`;
  - `Deprecated`: the `UNSUPPORTED_CALLING_CONVENTIONS` lint, through `tcx.emit_node_span_lint`.
- **The HIR ty lowering stand-in is repointed.** hir_ty_lowering/mod.ts (`lower_fn_ty`, region of lane -b) no longer has a
  local `check_abi`; it imports `check_abi` from `../check/mod.ts`. This is a call-site edit only.
- **Coverage.** check/check.rs is 40/40 and check/mod.rs is 17/17 (`--missing` reports 0 for both). lib.rs `check_crate`
  (:145) is also ported: the contract assigns it to this lane.
- **`check::provide` (check/mod.rs:112) is installed.** lib.ts `provide` now calls it, in upstream position after
  `collect::provide`. It installs `adt_destructor`, `adt_async_destructor`, `check_coroutine_obligations` and
  `check_potentially_region_dependent_goals`. The other 5 providers are other lanes' fns; their lines are commented in
  mod.ts `provide`, and each lane's merge uncomments them:
  - `region_scope_tree`;
  - `collect_return_position_impl_trait_in_trait_tys`;
  - `compare_impl_item`;
  - `check_type_wf`;
  - `check_well_formed`.

## Files
- **New:**
  - `src/rustc_hir_analysis/check/check.ts`;
  - `src/rustc_hir_analysis/check/mod.ts`;
  - `src/rustc_hir_analysis/check/check.oracle.test.ts`;
  - `src/rustc_hir_analysis/check/check_oracle/run.ts` and `cases/*.rs` (6 cases).
- **Edited (call sites, or tests that pinned the old state):**
  - `src/rustc_hir_analysis/lib.ts`: `import * as check` / `export { check }` at the `pub mod check;` line;
    `check.provide(providers)`; `check_crate` filled.
  - `src/rustc_hir_analysis/hir_ty_lowering/mod.ts`: the `check_abi` stand-in is deleted and imported instead (2 lines).
  - `src/rustc_hir_analysis/hir_ty_lowering/lower_ty.test.ts`: the P2 (`fn()`) pin moves past `check_abi`. Lowering now
    completes, and the case stops when printing `debug_EarlyBinder` -> `debug_Binder` (generated
    "Debug without a TS impl", lane tydump-subject).
  - `src/rustc_hir_analysis/contract.test.ts`: test 10 counts 44 providers instead of 40 (the 4 new ones are asserted).

## Tests
- **check.oracle.test.ts (14 tests, all pass).** It compares stderr and the exit code with the pinned rustc
  (aarch64-apple-darwin host). Each case runs in two modes:
  - mode `abi`: the upstream callers of `check_abi`, in item order. These are `type_of` of type aliases and of fields
    (lowering -> `lower_fn_ty` -> `check_abi`) and `check_item_type`'s `check_abi` for extern blocks;
  - mode `wf`: `check_item_type` for every item, as `check_type_wf` does.

  | case | what | abi | wf (this base) |
  |---|---|---|---|
  | abi_direct | `extern "C"` / `"system"` / `"C-unwind"` / plain `fn` (Direct) | **MATCH** | pending `inferred_outlives_of` |
  | abi_unsupported | `"stdcall"`, `"thiscall"` fn ptrs and an extern block (Invalid: E0570 from ast_lowering, `check_abi` delays a bug) | **MATCH** | pending, same |
  | abi_rust_intrinsic | `extern "rust-intrinsic"` (E0703) | **MATCH** | pending, same |
  | abi_cmse | `"C-cmse-nonsecure-call"` (E0703); `extern "cmse-nonsecure-call" {}` (E0570 + E0658) | **MATCH** | pending, same |
  | abi_cmse_fn_ptr | `"cmse-nonsecure-call"` fn pointer types | pending `erase_and_anonymize_regions` (from cmse.rs `validate_cmse_abi`, after `check_abi`) | pending, same |
  | abi_cdecl | `"cdecl"` / `"cdecl-unwind"` (Deprecated: the lint) | pending `rustc_lint::levels::shallow_lint_levels_on` (lane lint-levels-hir) | pending, same |

  - Every pending case must stop at exactly the listed text. Its output before the stop must be a prefix of the
    oracle's.
  - **Measured in a throwaway merge with `lane/variance-outlives`, not committed.** All 6 `wf` pins move. Mode `wf` then
    equals mode `abi`: abi_direct, abi_unsupported, abi_rust_intrinsic and abi_cmse byte-identical; the other two stop
    as in mode `abi`.
  - **For the merge fixer.** Once variance-outlives is in, drop the `PENDING_WF` entries of the 4 matching cases and set
    abi_cdecl / abi_cmse_fn_ptr to their mode-`abi` texts.
- **tydump-minicore facts (46 cases).** These were measured the same way: the tydump probe against variance-outlives'
  `variance_outlives_test/run.ts facts`, in a throwaway merge of this branch with `lane/variance-outlives`.

  | | variance-outlives alone | + check-check |
  |---|---|---|
  | `variances_of` lines matching | 148 | **424** |
  | `clauses_of` lines matching | 1104 | 1104 |
  | differing | 0 | 0 |
  | STOP `check::check::check_abi` | 12 | 0 |
  | STOP FATAL (poisoned crate-wide queries) | 300 | 36 |

  - The 36 remaining FATALs come from the other crate-wide blockers: `transitive_bounds_that_define_assoc_item`,
    `Decodable for ty::TraitDef`, and others.
  - 182 facts stop at the generated "Debug without a TS impl" (lane tydump-subject).
  - So `check_abi` no longer blocks `variances_of` for fields of fn-pointer type with a supported ABI.
  - A deprecated ABI (`extern "cdecl"` on non-x86) still stops in the lint emission until lint-levels-hir lands.
- **`bun scripts/difftest.ts --suite hir-tree-nocore --sample 100`** (run 20261014-233359-check-check-qpc2): 99 MATCH,
  0 DIFF, 0 CRASH, 1 UNPORTED.
  - The UNPORTED case is `delegation/generics/free-fn-to-free-fn.rs`. It stops at rustc_ast_lowering's delegation
    stand-in `fn_sig_skip_binders`.
  - The case is not protected, and main (3e4773f) is UNPORTED on it too: the merge-w16a "For root" item.
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: `markers ok`.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4745 pass, 1 skip (the pre-existing linux-only test),
  0 fail (4746 tests, 294 files).

## `unported(..)` left (all in this lane's files)
**Other wave-17 lanes.** These are stand-ins at the end of check.ts and mod.ts ("Stand-ins"), one per upstream item;
each names its lane. The merge repoints each one to the real port.
- check/wfcheck.rs (lanes check-wf-a/-b):
  - `enter_wf_checking_ctxt` (and the `WfCheckingCtxt` members used: `ocx.register_obligations`, `deeply_normalize`,
    `register_wf_obligation`, `register_bound`, `unnormalized_obligations`, `check_test_binder_body`);
  - `check_item`, `check_foreign_item`, `check_trait_item`, `check_gat_where_clauses`, `check_associated_item`;
  - `check_type_defn`, `check_trait`, `check_static_item`, `check_const_item`, `check_where_clauses`,
    `check_variances_for_type_defn`.
- check/compare_impl_item.rs (+ refine.rs), lane check-compare: `check_type_bounds`, `compare_const_directness`,
  `refine::check_refining_return_position_impl_trait_in_trait`.
- check/intrinsic.rs (lane check-region-intrinsic): `check_intrinsic_type`.
- check/always_applicable.rs (lane check-region-intrinsic): `check_drop_impl` (the validator of `adt_destructor`).
- lib.rs `check_crate`: `outlives::dump::inferred_outlives` / `variance::dump::variances` (lane variance-outlives-implwf).
- rustc_trait_selection (lanes trait-sel-*, error reporting wave 19):
  - `ObligationCtxt::new_with_diagnostics`. Every fn that needs an `ObligationCtxt` keeps its marker and its **full
    upstream body**, written against a local `ObligationCtxt_` interface (`register_obligation`, `eq`, `normalize`,
    `evaluate_obligations_error_on_ambiguity`, `assumed_wf_types_and_report_errors`,
    `resolve_regions_and_report_errors`); only the constructor stops. These fns are:
    - check.rs: `check_opaque_meets_bounds`, `check_coroutine_obligations`, `check_potentially_region_dependent_goals`;
    - mod.rs: `check_function_signature`.
  - `TypeErrCtxt` methods (`report_fulfillment_errors`, `note_type_err`, `ty_kind_suggestion`) are a local interface over
    `infcx.err_ctxt()`.
  - `ObligationCauseExt::as_failure_code_diag`;
  - `traits::impl_item_is_final`;
  - `suggestions::ReturnsVisitor` (`get_owner_return_paths`).
  - `allowed_union_or_unsafe_field` calls the real `Obligation::new` and `InferCtxt::predicate_must_hold_modulo_regions`.
    Both are still contract placeholders.

**M4 (layout / MIR).**
- `check_static_inhabited` and `check_transparent` call `tcx.layout_of(..)`, then stop on its value with
  "rustc_middle::ty::layout::{TyAndLayout, LayoutError} (the value of `layout_of`, M4)". The upstream code after the
  stop is kept as a comment.
- `maybe_check_static_with_link_section`: `ConstAllocation`, wasm targets only.
- `check_crate`: `ty::Instance::new_raw` / `GlobalId` (const items).
- `opaque_type_cycle_error`: `CoroutineLayout`.

**Other.**
- diagnostics/precise_captures.rs is in no codegen set (as for collect-rbv). These stop at the emit:
  `LifetimesMustBeFirst`, `DuplicatePreciseCapture`, `LifetimeNotCaptured`, `LifetimeImplicitlyCaptured`,
  `SelfTyNotCaptured`, `ParamNotCaptured`.
- `hir::place::Place::ty` (rustc_middle hir/place.rs, a Pending type).
- `TypeFoldable for ty::ProvisionalHiddenType`: not generated; used by `check_coroutine_obligations` after the
  `ObligationCtxt` stop.
- `CodegenFnAttrs` is a local view of the fields read (`import_linkage`, `link_section`), as context.ts does. The query
  itself is not provided.

## `// PORT:` decisions (for root to record)
1. **Cross-lane stand-ins.** A call into another wave-17 lane's file not in this base goes through a stand-in at the end
   of the calling file. The stand-in carries the upstream path and the lane, and the merge repoints it. Upstream code
   after a trait-selection stop is written out against local minimal interfaces (as rustc_ty_utils did), not commented
   out.
2. **`res.and(expr)`** is the local helper `and(res, expr)`. `expr` is evaluated first, as in Rust (`Result::and` is
   eager).
3. **`MAX_SIMD_LANES`** (rustc_abi lib.rs:265, `1 << 0xF`) is a local const in check.ts: rustc_abi's TS port does not
   export it. **For root:** move it to rustc_abi/lib.ts.
4. **`StaticOfUninhabitedType`** is a fn-local `#[derive(Diagnostic)]` that no codegen set reaches. Its derived
   `into_diag` (one message, one note) is written out by hand. **For root:** if codegen should cover fn-local derives,
   this one should be generated.
5. **`Ancestors` is `Copy` upstream** and `leaf_def(self)` consumes a copy. In TS `Ancestors` is a mutable iterator, so
   `check_impl_items_against_trait` calls `clone_Ancestors(ancestors).leaf_def(..)` once per trait item. This was a real
   bug in the first version, found by the independent review.
6. **By-value mutation.** `check_function_signature`'s `mut cause` is cloned (`clone_ObligationCause`) before
   `cause.span = ..`. `sanity_check_found_hidden_type`'s `mut ty` becomes a new `ProvisionalHiddenType`, because its
   fields are readonly.
7. **`find_attr!(tcx, def_id, Repr { .. } => { .. })`** with a block body runs the block when the attribute is found
   (`check_enum`).

## For root
- The `check_abi` repoint in hir_ty_lowering/mod.ts (lane -b's region) is an edit outside this lane's files. It is the
  call-site edit the brief allows.
- lint-levels-hir unblocks abi_cdecl. The cmse fn-pointer case needs rustc_middle `erase_and_anonymize_regions`.
- `docs/handoff/hirtylowerer-contract.md` listed lib.rs `check_crate` for this lane. It is ported, but nothing calls it
  yet: `rustc_interface::passes::analysis` is still unported.

## Final checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: `markers ok (13393; vendor 3888)`.
- `--missing`: 0 for both check/check.rs (40/40) and check/mod.rs (17/17).
- Full `bun test`: green (above).
