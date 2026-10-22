# Handoff: mb-scope (M4 wave 22, MIR build fill lane): rustc_mir_build builder/scope.rs

Branch `lane/mb-scope` (from `7d76ddd0`, no merges).

## Files touched
- `src/rustc_mir_build/builder/scope.ts`: all 54 stubs filled, header rewritten (imports grew; the declarations
  block is unchanged).
- `src/rustc_mir_build/builder/scope.test.ts` (new): 8 unit tests on hand-built `Builder` states (an
  `Object.create(Builder.prototype)` with only the fields scope.rs reads besides `tcx`). They cover the `Scopes` stack,
  `DropTree::add_drop` dedup, the ExitScopes tree (StorageDeads sharing a block, the dummy `UnwindResume` becoming a goto),
  `in_scope` + `in_breakable_scope` + `break_scope(Continue)`, `in_if_then_scope` / `break_from_if_then_scope`,
  `pop_scope` with a value drop + `build_drop_trees` (a Drop unwinding to a cleanup `UnwindResume` block),
  `record_operands_moved`, and `clear_match_arm_and_guard_scopes`. Every expected CFG was traced by hand through
  upstream's algorithm.
- `src/rustc_mir_build/builder/contract.test.ts`: re-pinned: markers 50 → 104, stubs 263 → 209, `mb-scope` dropped from the
  per-lane table (0 stubs left). The `construct_fn` stop moved to the next stub on its path,
  `rustc_mir_build::builder::Builder::args_and_body` (lane mb-mod), reached through the ported `in_scope` →
  `in_breakable_scope` → `in_scope`. No assertion was weakened.

## Coverage
`bun scripts/coverage.ts --missing compiler/rustc_mir_build/src/builder/scope.rs`: **60/60 ported**.
`--check`: markers ok (19049; vendor 4196).

## `unported(...)` left
- `rustc_pattern_analysis::rustc::RustcPatCtxt` in `break_const_continuable_scope` (`#[loop_match]` / `#[const_continue]`,
  unstable). rustc_pattern_analysis is not ported (matches/mod.ts and check_match.ts also have `type RustcPatCtxt = unknown`).
  Everything before it (the non-monomorphic-const error, the scope lookup, the state discriminant) runs. The rest of the
  fn after it is ported too, but stays unreachable until the context exists.

## Stubs of other lanes that scope.rs calls
`expr_into_dest` (mb-expr-b; `break_scope` with a value, `break_const_continuable_scope`), `as_constant` (mb-expr-a),
`temp` (mb-mod, misc.rs), `static_pattern_match` (mb-matches-b).

## `// PORT:` decisions
- `T: DropTreeBuilder` is an impl table passed as `T_` (`DropTreeBuilder_ExitScopes` / `_CoroutineDrop` / `_Unwind`).
  This was declared by builder-contract; the bodies are now filled.
- `mir::Place`'s derived `PartialEq` (used by `break_scope`'s return-place check) is a module-local `place_eq`: `local`,
  then the interned `projection` list by identity. mir/ has no `Place` eq helper. A shared one would belong in
  mir/statement.ts (lane mir-body-b).
- `DropData` is `Copy`. `*drop` copies share the object, because nothing mutates a `DropData` or its `source_info` in
  place. `SourceInfo { span: DUMMY_SP, ..x }` is `new SourceInfo(DUMMY_SP, x.scope)`.
- `assign_blocks`'s local `enum Block` is a function-local tagged union.
- `IndexVec::from_elem` is a filled array, `entry_points.sort()` compares the tuples lexicographically, and
  `get_or_insert_with` is `??=`.
- `assert_eq!(.., "local scope is not the topmost scope!")` (`record_operands_moved`) panics inline with core's
  message-carrying text, because `std/panic.ts`'s `assert_eq` has no message argument.
- `#[instrument]` / `debug!` / `debug_assert*` are kept as comments.

## Signatures
No declaration changed. All 54 stub signatures fit.

## Note for later lanes (not changed here)
`CFG::terminate` (cfg.ts) stores the given `SourceInfo` object without cloning, so several terminators built here share
one `SourceInfo` (as in `in_breakable_scope`). If a MIR pass later mutates `terminator.source_info` in place, the sharing
becomes visible (builder-contract decision 7: clone where later mutated).

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: ok.
- `bun test src/rustc_mir_build`: 15 pass, 0 fail (contract 3, scope 8, rest).
- Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (`RUST_TS_AGENT=mb-scope`): **5786 pass, 1 skip, 0 fail**
  (5787 tests, 398 files, 3994 s under load avg ~75). A first attempt was killed mid-run from outside (exit 144, no
  summary; the broad process kills root warned about), so the run was redone detached; the numbers above are from that
  one complete run.

## Samples (`RUST_TS_AGENT=root-ad4b`, compared case by case with root's base runs)
| suite | lane run | M / D / U / C | base run | changed cases |
|---|---|---|---|---|
| tydump-minicore | `20261022-104310-root-ad4b-50dn` | 45 / 0 / 1 / 0 | `20261022-101651-root-ad4b-9r7y` | 0 |
| mirdump-minicore | `20261022-104350-root-ad4b-enfz` | 10 / 0 / 36 / 0 | `20261022-101711-root-ad4b-xljd` | 0 |
| tydump-ui `--sample 300` | `20261022-104442-root-ad4b-71ak` | 263 / 0 / 36 / 0 (+1 unstable) | `20261022-101731-root-ad4b-hqwm` | 0 |
| hir-tree `--sample 200` | `20261022-104909-root-ad4b-t1qv` | 200 / 0 / 0 / 0 | | |

No new DIFF. Every case kept the same status and the same stop. **The mirdump stops did not move.** All 36 UNPORTED cases
stop before MIR building (`check_unsafety provider` (mb-unsafety), `mir_keys provider` (mt-skeleton),
`eval_to_const_value_raw_provider`, ...), so scope.rs is not reached by any suite yet. It is exercised only by the unit
tests and the contract test's `construct_fn` path.
