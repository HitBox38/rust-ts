# Handoff: instance-vtable (M3, toward gate M3's rustc_dump subset)

Branch `lane/instance-vtable`, base `b0a781c1` (integ-w19 incl. small-gaps-21). No baselines, oracle outputs, suites,
`harness/`, `scripts/` or `UPSTREAM.json` touched. Shared probes not rebuilt. **Root: this lane changed tools/codegen
configs and one generator test (no generator code); see "tools/ changes".**

## Results (`RUST_TS_AGENT=instance-vtable`; MATCH / DIFF / UNPORTED)
| suite | base (b0a781c1) | after | runs |
|---|---|---|---|
| tydump-ui full (1849) | 1593 / 0 / 247 (+1 TIMEOUT, 8 UNSTABLE) | **1604 / 0 / 236** (same TIMEOUT/UNSTABLE) | `iv-base-tydump-ui` / `iv-tydump-ui` |
| ↳ typeck+traits (1744) | 1519 = 87.10% | **1529 = 87.67%** | |
| ↳ rustc_dump (119) | 75 = 63.0% | **86 = 72.3%** | |
| thirdump-ui full (1860) | 1586 / 0 / 265 (+1 TIMEOUT, 8 UNSTABLE) | **1597 / 0 / 254** | `iv-base-thirdump-ui` / `iv-thirdump-ui` |
| ↳ typeck+traits | 1512 = 86.70% | **1522 = 87.27%** | |
| ↳ rustc_dump | 75 = 63.0% | **86 = 72.3%** | |
| tydump-minicore (46) | 45 / 0 / 1 | 45 / 0 / 1 | `iv-base-tyminicore` / `iv-tyminicore` |
| tydump-nocore `--sample 300 --seed m17` | 292 / 0 / 8 | 292 / 0 / 8 | `iv-base-nocore` / `iv-nocore` |
| hir-tree `--sample 300` | 300 / 0 / 0 | 300 / 0 / 0 | `iv-base-hirtree` / `iv-hirtree` |

**No MATCH lost, no new DIFF/CRASH, no UNPORTED stop moved elsewhere.** The 11 gains on each ui suite are exactly the
targets: `attributes/doc_examples/rustc_dump_vtable.rs` (was `COMMON_VTABLE_ENTRIES`), `traits/vtable/{multiple-auto,
multiple-markers, vtable-diamond, vtable-dyn-incompatible, vtable-multi-level, vtable-multiple, vtable-vacant,
empty-supertrait-with-nonempty-supersupertrait#dump}.rs`, `traits/trait-upcasting/multiple-supertraits-modulo-{binder,
normalization}-vtable.rs` (were `vtable_entries provider (not ported)`). Base runs came from a temporary detached worktree
at `b0a781c1` (removed). The rustc_dump subset is now 86/119 as small-gaps-21 predicted; what is left there is M4
(`mir_borrowck` 16, `const_eval_resolve_for_typeck` 12, `const_eval_poly` 5).

## Files
New:
- `src/rustc_middle/ty/instance.ts` (instance.rs **34/34**): `Instance` / `InstanceKind` / `ShimKind` companions, `type_length`
  (+ its visitor), `display_Instance`, `resolve_async_drop_poll`, `needs_fn_once_adapter_shim`.
- `src/rustc_middle/ty/instance.gen.ts`, `src/rustc_middle/ty/vtable.gen.ts` (GENERATED, new set `rustc_middle_ty_instance`).
- `src/rustc_middle/ty/vtable.ts` (vtable.rs **3/3**): `debug_VtblEntry`, `COMMON_VTABLE_ENTRIES(_*)`, `vtable_min_entries`,
  `vtable_allocation_provider` (stops at `Allocation::new`, see unported).
- `src/rustc_ty_utils/instance.ts` (instance.rs **3/3**): `resolve_instance_raw`, `resolve_associated_item`, `provide`.
- `src/rustc_trait_selection/traits/vtable.oracle.test.ts` + `vtable_test/` (2 fixtures, from the tydump probe).
Filled: `src/rustc_trait_selection/traits/vtable.ts` (vtable.rs **10/10**, was a stub).
Edited (wiring / repoints):
- rustc_middle `ty/decls.ts`: `Instance` / `InstanceKind` re-exported from ty/instance.ts (were `Pending`).
- rustc_middle `ty/mod.ts`: hand-written `visit_with_/try_fold_with_/fold_with_` for `TypingEnv` and
  `PseudoCanonicalInput<T>` + descriptor `fold_PseudoCanonicalInput` (decision 2); `vtable_allocation` provider → vtable.ts.
- rustc_middle `query/keys.ts`: `KEY_PseudoCanonicalInput_DefId_GenericArgsRef`; `queries.gen.ts` regenerated.
- rustc_middle `ty/print/mod.ts` (`print_Instance` / `print_ShimKind` on the real types; views and stand-in removed),
  `ty/print/pretty.ts` (`Instance_def_id` / `Instance_args`), `ty/layout.ts` (`Instance_def_id`, `debug_FnAbiRequest`,
  `codegen_handle_fn_abi_err`'s `OfInstance` span_bug, `mk_dyn_vtable` → `vtable_min_entries`),
  `middle/codegen_fn_attrs.ts` (`InstanceKind::def_id`, views removed).
- rustc_metadata `rmeta/decoder/cstore_impl.ts`: `IntoArgs_InstanceKind`.
- rustc_hir_analysis `collect/dump.ts`: `vtables` prints `{vtable_entries:#?}`; `COMMON_VTABLE_ENTRIES`.
- rustc_trait_selection `error_reporting/traits/call_kind.ts`: `DerefCoercion`'s `Instance::try_resolve` chain ported.
- rustc_trait_selection `traits/mod.ts`: `vtable::provide(providers)` wired. rustc_ty_utils `lib.ts`: `instance::provide`.
- rustc_traits `codegen.ts`: `d_ImplSource_unit` is the generated `ImplSource` fold over `()`'s trivial impls (was unported).

## tools/ changes (root: please review)
- `types.sets.json`: new set `rustc_middle_ty_instance` (ty/instance.rs + ty/vtable.rs, `derive_type_fold`).
- `type_fold.json`: `rustc_middle::ty::instance::ReifyReason` is trivial (`TrivialTypeTraversalAndLiftImpls!`,
  structural_impls.rs:243).
- `queries.config.json`: key `PseudoCanonicalInput<(DefId, GenericArgsRef)>`; aliases `rustc_middle::ty::{Instance,
  InstanceKind, VtblEntry}` → their defining modules (so query values/keys get typed); `display` of `Instance`
  (`display_Instance`; 3 query descs no longer unported).
- `type_fold.test.ts` (golden test of set rustc_ty): `instance.gen.ts` / `vtable.gen.ts` excluded like `mod.gen.ts`
  (they belong to the new set). `bun test tools/codegen`: 50 / 0. `queries.ts --check`: up to date.

## unported(...) left / added
- Added: `rustc_middle::mir::interpret::Allocation::new (ty/vtable.rs vtable_allocation_provider, M4)` (replaces the
  whole-provider placeholder in ty/mod.ts).
- Reached through existing stops (unchanged messages): `optimized_mir` (drop glue of coroutines), the
  `upstream_*_for` queries, `TypeLengthLimit`'s `instance` arg (`unported_into_diag_arg`: set `rustc_middle_diagnostics`
  cannot import ty/diagnostics.ts for init-order reasons, as `Ty`).
- Removed: `COMMON_VTABLE_ENTRIES`, `<VtblEntry as Debug>::fmt`, the vtable.ts stubs (×4), 3 `Instance::def_id`
  stand-ins + `Instance::args`, `InstanceKind::def_id` (×2), `Instance::try_resolve (call_kind DerefCoercion)`,
  `FnAbiRequest Debug`, the `OfInstance` arm of `codegen_handle_fn_abi_err` (the `OfFnPtr` arm still needs `PolyFnSig`
  Display), `vtable_min_entries`, `ImplSource<()>: TypeFoldable`, `key_unported` of `resolve_instance_raw`.
- Not repointed: rustc_hir_analysis `lib.ts` `GlobalId / ty::Instance::new_raw (M4)` (needs `GlobalId` and
  `eval_to_const_value_raw`; `Instance::new_raw` itself now exists); ty/mod.ts `instance_mir` keeps its local
  `InstanceKindView` (M4, MIR).

## PORT decisions to record
1. ty/instance.rs types are generated (set `rustc_middle_ty_instance`); methods live on same-named companion consts
   (`Instance.def_id(i)`, `InstanceKind.def_id(k)`, `ShimKind.*`), as rustc_type_ir's `TraitRef`. `Instance` is `Copy`:
   `resolved.def = x` is `resolved = { ...resolved, def: x }`.
2. `TypingEnv` / `PseudoCanonicalInput<T>` TypeFoldable derives are hand-written in ty/mod.ts in the generator's shape
   (the generator would read `typing_mode`, which is `typing_mode_` in TS).
3. `prepare_vtable_segments` returns `{ $: "Some"; _0: T } | undefined` (its `T` is `Option<usize>` for
   `supertrait_vtable_slot`). The lazy iterators of traits/vtable.rs (`direct_super_traits_iter` kept as `siblings`,
   `own_existential_vtable_entries_iter`) are generators so queries run in upstream order.
4. `TyCtxt::COMMON_VTABLE_ENTRIES` is the module const `COMMON_VTABLE_ENTRIES` of ty/vtable.ts.
5. `vtable_allocation_provider` is ported up to `Allocation::new` and stops there with `unported` (M4).
6. Init order: queries.gen.ts now imports ty/instance.ts and ty/vtable.ts (typed values, `debug_*`), so those two reach
   the `TyCtxt` extension modules (ty/assoc.ts, ty/print/{pretty,mod}.ts, ty/layout.ts) and rustc_session config.ts
   through `require` (static imports gave `Cannot access 'TyCtxt' before initialization` / a `Polonius` TDZ).

## Checks
- `bunx tsc --noEmit -p .` clean; `bun scripts/coverage.ts --check`: markers ok (17284; vendor 3888).
- Coverage: rustc_middle ty/instance.rs 34/34, ty/vtable.rs 3/3, rustc_ty_utils instance.rs 3/3, rustc_trait_selection
  traits/vtable.rs 10/10.
- `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`: **5389 pass / 0 fail** (incl. the new vtable oracle tests:
  vacant entries, `TraitVPtr`, `shim(vtable)` for by-value `self`, `#[track_caller]` reify shim, `dyn` aliases with/without
  principal, std's `dyn Iterator`). `bun test tools/codegen`: 50 / 0.

## Follow-up (not this lane)
- M4-0 MIR skeleton / const-eval lanes (small-gaps-21's plan) can now use `Instance::try_resolve` /
  `resolve_instance_raw`; `GlobalId` + `eval_to_const_value_raw` are next for hir_analysis's const items.
