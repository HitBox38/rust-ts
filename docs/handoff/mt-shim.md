# Handoff: mt-shim (M4 wave 24): MIR shims

Branch `lane/mt-shim` (base `de448071` on integ-w19, no merges). Commits: the port → this handoff.

## Files touched
- `src/rustc_mir_transform/shim.ts`: **stub replaced** by the whole port of shim.rs: `provide` (sets
  `providers.mir_shims`), `make_shim`, `DerefSource` / `Adjustment` / `CallKind`, `local_decls_for_sig`,
  `build_drop_shim`, `new_body`, `DropShimElaborator` (+ its `Debug` and `DropElaborator` impls), `build_thread_local_shim`,
  `build_clone_shim`, `CloneShimBuilder`, `build_call_shim`, `build_adt_ctor` (merge-w22b's port kept),
  `build_fn_ptr_as_ptr_shim`, `build_fn_ptr_from_ptr_shim`, `build_construct_coroutine_by_move_shim`.
  `build_drop_shim` keeps its signature (lib.ts re-exports it).
- `src/rustc_mir_transform/shim/async_destructor_ctor.ts` (new, `mod async_destructor_ctor;` of shim.rs, imported by
  shim.ts): `build_async_destructor_ctor_shim`, `build_async_drop_shim`, `build_future_drop_poll_shim`,
  `build_adrop_for_coroutine_shim` (+ its fn-local `FixProxyFutureDropVisitor`, a module-level `MutVisitor` class),
  `build_adrop_for_adrop_shim`.
- `src/rustc_mir_transform/coroutine/drop.ts` (the mt-shim reference only): the stand-in `interface DropShimElaborator`
  is removed; `elaborate_coroutine_drops` imports shim.ts's class and builds it with
  `new DropShimElaborator(body, MirPatch.new(body), tcx, typing_env, /* produce_async_drops */ false)` (upstream's FIXME
  comment kept). Header comment updated. drop.ts's other stand-ins (mt-coroutine-a, mt-drops, mt-cleanup) are untouched.
- `src/rustc_mir_transform/pass_manager.test.ts`: stub-module count 54 → 53 (delta −1: shim.ts is no longer a stub).

## Coverage
- shim.rs 38/38, shim/async_destructor_ctor.rs 7/7 (`bun scripts/coverage.ts --missing`).
- rustc_mir_transform 331/1101; TOTAL 20760/25518 (this tree). `bun scripts/coverage.ts --check`: markers ok (21339; vendor 4330).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_mir_transform`: 57 pass, 5 fail, all 5 timeouts at bun's 5 s default under load (liveness /
  mir_coroutine_witnesses oracle tests). Re-run alone with `--timeout 60000`: 7/7 pass. Full unit suite not run (root
  runs it at integration, per the coordinator).
- Sample difftests (`RUST_TS_AGENT=root-f5de`), compared case by case with the base runs in w25-common.txt:
  - The first pass ran at load average 200-400 (other lanes): tydump-ui 61, mirdump-ui 193, borrowck-ui 105 TIMEOUTs
    (no other status change). Re-run with `--jobs 4`; the 2 remaining mirdump-ui timeouts re-run alone: MATCH.
  - tydump-minicore (run `20261027-225428-root-f5de-j829`): 46/46 MATCH (base 45 MATCH + 1 UNPORTED;
    `mini_core_hello_world.rs` UNPORTED → MATCH).
  - mirdump-minicore (`20261027-225626-root-f5de-h2gj`): 45 MATCH, 1 UNPORTED, as base; the UNPORTED case's stop moved
    `ConstValue::try_to_bits_for_ty (M4)` → `rustc_borrowck::diagnostics::bound_region_errors::UniverseInfo::relate`.
  - tydump-ui --sample 300 (`20261028-002523-root-f5de-fy0s`): 262 MATCH, 36 UNPORTED, 2 UNSTABLE (as base); no MATCH
    lost; `enum-discriminant/wrapping_niche.rs` UNPORTED → MATCH.
  - mirdump-ui --sample 300 (`20261028-000238-root-f5de-mz5m`, + the 2 timeouts alone): 273 MATCH, 27 UNPORTED; no
    MATCH lost; 4 UNPORTED → MATCH (`mir/enum/option_with_bigger_niche_break.rs`, `mir/issue-76248.rs`,
    `mir/mir-inlining/ice-issue-77564.rs`, `mir/mir_refs_correct.rs`).
  - borrowck-ui --sample 300 (`20261028-003054-root-f5de-rlsi`): 300 UNPORTED (as base). Stops: 209
    `UniverseInfo::relate`, 74 `OutlivesConstraintSet::push`, 12 `polonius_engine::AllFacts::default`, 5
    `rmeta decoder: Decodable for mir::Body` (base: 287 `replace_regions_in_mir`, 13 `eval_in_interpreter`).
  - No DIFF / CRASH anywhere. The new MATCHes and moved stops come from the integ-w19 merges after the base runs
    were made (CTFE / borrowck lanes), not from this lane: nothing in the samples reaches `mir_shims` (see below), and
    nothing imports coroutine/drop.ts yet.

## Runtime stops (new / moved)
- None of the sampled stops moved because of this lane. No sampled case reaches `mir_shims`: the mirdump stops sit
  before it (`eval_in_interpreter`, `replace_regions_in_mir`, ...), and no `-Zunpretty=mir` case printed a shim.
- **`tcx.mir_shims(..)` still cannot reach the provider**: queries.gen.ts has `key: key_unported("ty::ShimKind<'tcx>")`
  (and `desc: unported(..)`), so any call stops with
  `rustc_middle::query::keys: QueryKey for \`ty::ShimKind<'tcx>\` (cache)`. `KEY_ShimKind` exists in
  rustc_middle/query/keys.ts; **root / a tools batch** must map `ty::ShimKind` in `tools/codegen/queries.config.json`
  (as `InstanceKind` is) and regenerate queries.gen.ts. Not done here (tools/ and generated files are out of scope).
- Once the key is wired, every shim built through `make_shim` (all kinds except `DropGlue` of a coroutine,
  `FutureDropPoll`, `AsyncDropGlue`, `AsyncDropGlueCtor`) stops at
  `rustc_mir_transform::deref_separator::deref_finder (lane mt-cleanup)`; drop glue of a non-array type stops first at
  `rustc_mir_transform::elaborate_drop::elaborate_drop (lane mt-drops)`. After those: the stub passes in the shim pass
  lists (`MentionedItems`, `AddMovesForPackedDrops`, `RemoveNoopLandingPads`, `InstSimplify`, `ForceInline`,
  `AbortUnwindingCalls`, `CriticalCallEdges`, `StateTransform`).

## `unported(...)` left (module-local stand-ins at the end of shim.ts, not markers)
- `rustc_mir_transform::elaborate_drop::elaborate_drop (lane mt-drops)` — `elaborate_drop(elaborator, source_info,
  place, path: null, succ, unwind, bb, dropline)`; also stand-in types `DropFlagMode` (`"Shallow" | "Deep"`),
  `DropStyle` (`"Dead" | "Static" | "Conditional" | "Open"`), `Unwind` (`{ $: "To", _0 } | { $: "InCleanup" }`).
- `rustc_mir_transform::deref_separator::deref_finder (lane mt-cleanup)` — `deref_finder(tcx, body, storage_to_remove)`.
- async_destructor_ctor.ts imports these from shim.ts (`use super::*;`).

## For mt-drops / mt-cleanup / root at merge
- **mt-drops**: replace shim.ts's stand-ins (`DropFlagMode`, `DropStyle`, `Unwind`, `elaborate_drop`) with imports from
  `./elaborate_drop.ts` (keep re-exporting them or repoint async_destructor_ctor.ts's import). `DropShimElaborator`
  implements the trait with these method names: `patch_ref()`, `patch_()`, `body_()`, `tcx_()`, `typing_env_()`,
  `allow_async_drops()`, `drop_style(path, mode)`, `get_drop_flag(path)`, `drop_flags_for(path, mode)`,
  `field_subpath`, `deref_subpath`, `downcast_subpath`, `array_subpath` (`Path = ()` is `null`; `Option<()>`:
  `Some(())` = `null`, `None` = `undefined`; `array_subpath`'s `u64`s are `number`). The `_` suffix is the
  field/method clash rule (mir/mod.ts "names"); if `DropElaborator` ends up with other names, rename them here. Add
  `implements DropElaborator<null>` (or the interface's shape) to the class when the trait lands.
- **mt-cleanup**: replace shim.ts's `deref_finder` stand-in with the port's export.
- **mt-coroutine-a**: coroutine/drop.ts now imports `../shim.ts`; shim.ts imports `./coroutine/mod.ts`
  (`StateTransform`). When mod.ts imports drop.ts the cycle is shim → coroutine/mod → drop → shim; it is safe because
  drop.ts uses `DropShimElaborator` only inside a function.
- Merge conflict hint: drop.ts's header and stand-in block are edited by mt-shim (DropShimElaborator lines) and will be
  by mt-drops / mt-cleanup / mt-coroutine-a (their stand-ins); keep all repoints.

## `// PORT:` decisions
- shim.ts header: stand-ins for elaborate_drop / deref_finder; `DropShimElaborator` as a class with `_`-suffixed trait
  methods; `Path = ()` as `null`; `crate::run_optimization_passes` `require`d lazily from lib.ts (pass modules must not
  import lib.ts; precedent pass_manager.ts); `clone_SourceInfo` for a `SourceInfo` used more than once; `debug!` /
  `#[instrument]` are comments.
- `Body_foldable`: `impl TypeFoldable for Body` as a D4 descriptor (for `EarlyBinder::bind(tcx, body.clone())`);
  exported for async_destructor_ctor.ts.
- `provide`: the `mir_shims` key is `unknown` in queries.gen.ts; the provider casts it to `ShimKind`.
- `build_call_shim`: `FnSig` is `Copy`, so `sig.inputs_and_output = ..` builds a fresh `FnSig` object.
- `assert_fn_ptr`: `assert_matches!(self_ty.kind(), ty::FnPtr(..), "expected fn ptr, found {self_ty}")` with core's
  message (`left` printed with the `Ty`'s `{:?}`).
- async_destructor_ctor.ts header: `use super::*;`; `FixProxyFutureDropVisitor` at module level, `*place = ..` writes
  `place.local` / `place.projection`.
