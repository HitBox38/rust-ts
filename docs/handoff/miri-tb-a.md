# Handoff: lane `miri-tb-a` (M6 wave 38, Tree Borrows part a)

`borrow_tracker/tree_borrows/{mod, perms, tree_visitor, unimap, wildcard, foreign_access_skipping, exhaustive}.rs`
(2,581 upstream lines), filled into the miri-contract skeleton, with upstream's unit tests as bun tests. Branch `t3/port-miri-tree-borrows-support`.

## Files touched

All under `src/miri/borrow_tracker/tree_borrows/`:

- Ported (stub replaced): `mod.ts`, `perms.ts`, `tree_visitor.ts`, `unimap.ts`, `wildcard.ts`, `foreign_access_skipping.ts`,
  `exhaustive.ts`.
- New tests: `unimap.test.ts`, `foreign_access_skipping.test.ts`, `perms.test.ts` (upstream's tests, then lane checks);
  `exhaustive.test.ts`, `tree_visitor.test.ts`, `wildcard.test.ts`, `mod.test.ts` (lane checks: upstream has no tests in these).
- `docs/handoff/miri-tb-a.md` (this file).

No `.gen.ts`, no tb-b file, nothing under `tools/`, `harness/` or `scripts/` was edited.

## Coverage (`bun scripts/coverage.ts --missing`)

| file | fns |
|---|---|
| `tree_borrows/mod.rs` | 13/13 ported |
| `tree_borrows/perms.rs` | 47/47 ported |
| `tree_borrows/tree_visitor.rs` | 8/8 ported |
| `tree_borrows/unimap.rs` | 29/29 ported |
| `tree_borrows/wildcard.rs` | 8/8 ported |
| `tree_borrows/foreign_access_skipping.rs` | 8/8 ported |
| `tree_borrows/exhaustive.rs` | 11/11 ported |

That is 124/124, the lane's share in the miri-contract table.

## Verification

- `bunx tsc --noEmit -p .`: 0 errors.
- `bun scripts/coverage.ts --check --offline`: `markers ok (24519; vendor 5050; library 584)`.
- `bun tools/codegen/types.ts miri`: regenerates with no diff.
- `bun test src/miri/borrow_tracker/tree_borrows`: 61 pass, 0 fail.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/miri`: 304 pass, 1 fail, under a machine load average of about 110 from other lanes. The
  failure is `Stdout write: a tail >= the buffer capacity ..` (`src/miri/shims/files_stdout.test.ts`, not this lane's), which hit the
  5 s limit at 5,103 ms. Rerun alone, it passes.

### Scope proof (plan-m6 A5: Tree Borrows off changes nothing)

- `--suite miri-hello`: MATCH=1, DIFF=0 (run `20261103-225644-miri-tb-a-xel7`).
- `--suite run-pass-miri --sample 200`, agent `miri-tb-a` (run `20261103-225711-miri-tb-a-c7gf`): MATCH=192, DIFF=0, UNPORTED=3,
  TIMEOUT=5, CRASH=0. **This is not a clean 200.** Of the 8 non-matches:
  - **3 UNPORTED, unprotected, unrelated:** two `issue-64655-extern-rust-must-allow-unwind.rs` revisions (`#fat3`, `#thin2`) stop at
    `each_linked_rlib` (LTO, M7); `process/sigpipe-should-be-ignored.rs` stops at `pipe2` (sockets, D2).
  - **5 TIMEOUT, all protected, and these need root's gate to clear them:** `async-drop/async-drop-initial.rs`,
    `coroutine/smoke.rs#nomiropt`, `for-loop-while/foreach-external-iterators-nested.rs`,
    `rfc-2011-nicer-assert-messages/feature-gate-generic_assert.rs`, `test-attrs/test-filter-multiple.rs`.

Evidence that the 5 timeouts come from machine load (load average 90-200, suite timeout 60 s) and not from this lane:

- Run one by one with `--filter`, side by side with a clean worktree of the base commit `c9d3c553`, **all 5 time out on both trees**,
  at the same wall times (151-162 s including the retry).
- `foreach-external-iterators-nested.rs` run once with no timeout on both trees: **exit 0 and byte-identical stdout + stderr to the
  oracle on both** (same sha256 prefix `08e4683e729209b9`). This branch: 443 s wall, 57.5 s CPU; base: 434 s wall, 55.5 s CPU.

Only that one case was seen to match. The other 4 are shown to behave the same as base, not shown to match. Also, about 55 s of CPU
under this load is close to the 60 s limit, so root may see these cases flake if the gate runs on a loaded machine.

Tree Borrows on: `bun src/miri/bin/miri.ts harness/corpus/miri/hello.rs .. -Zmiri-tree-borrows` stops with exit 70 at
`miri::borrow_tracker::tree_borrows::tree::Tree::new (.. lane miri-tb-b)`, i.e. it gets through this lane's `Tree::new_allocation` to
tb-b's first placeholder. That is all it shows until tb-b lands.

### What each test file checks

- **Upstream's tests, same property statements:** `extend_to_length`, `consistency_small`, `consistency_large`, `test_order`,
  `all_transitions_idempotent`, `foreign_read_is_noop_after_foreign_write`, `permission_sifa_is_correct`,
  `permissionpriv_partialord_is_reachability`, `strongest_allowed_local_access`.
- **`consistency_large` runs upstream's exact key sequence.** std's `DefaultHasher` has no port (`rustc_target/spec/tuple.ts`
  stops `unported` on it), so the test carries a small SipHash-1-3. A separate test pins it to values from the pinned nightly
  (`nightly-2026-10-11`, a throwaway program running the same loop): results for i = 0, 1, 2, 999, the xor of all 1000, and the
  operation count 315.
- **`perms.test.ts` lane checks:** the whole state machine as a table written from upstream's match arms (protected and not),
  the `can_be_replaced_by_child` and SIFA tables, Display / `short_name`, `summary`, `is_relevant` including its panics.
- **`tree_visitor.test.ts`:** the visitation-order graphic in upstream's doc comment, on a tree of that shape, plus skipping and
  early `Err` in both phases. Note the graphic's left-to-right is not `children` order: the child listed *last* is visited
  first. That is what upstream's code does; the test also runs the reverse order.
- **`wildcard.test.ts`:** `access_relatedness`, every `update_exposure` level change, `expose_tag`, the protector release, and
  upstream's own `verify_wildcard_consistency` after each step.
- **`mod.test.ts`:** the `NewPermission::new` table; `tb_reborrow`'s branches with an interpreter double and a recording `Tree`
  (no `AllocId`, allocation without data, per-range state and access with base offset, no shared `LocationState` between
  elements, `WriteToReadOnly`, data-race notification); `Tree`'s forwarding methods.

`wildcard.test.ts` and `mod.test.ts` need four tb-b members. While those are still placeholders the tests install their upstream
bodies and restore them afterwards (weak_memory.test.ts precedent); once tb-b lands they run against tb-b's.

## Not checked against the oracle (for root, after merging tb-b)

Nothing in this lane has been compared with the oracle under `-Zmiri-tree-borrows`, because every Tree Borrows run stops at
tb-b's `Tree::new`. After merging, these need the end-to-end comparison; the unit tests above do not settle them:

1. Any run with `-Zmiri-tree-borrows`: the retag paths against a real interpreter and a real `Tree`.
2. `-Zmiri-tree-borrows-no-precise-interior-mut` and `-Zmiri-tree-borrows-implicit-writes`, including `#[rustc_no_writable]` read
   through `find_attr` on real attributes (the test mocks the attribute list).
3. `-Zmiri-track-pointer-tag=<n>`: the `CreatedPointerTag` text in `log_creation`. It needs `display_Ty`, i.e. a real `TyCtxt`, so
   no unit test reaches it.
4. `tb_expose_tag` from a program that casts pointers to integers, `print_tree` and `tb_give_pointer_debug_name` (Miri's
   `miri_print_borrow_state` / `miri_pointer_name` extern fns), including the two `eprintln!` texts.
5. tb-b's `tree/tests.rs` running over this lane's `Exhaustive_*` tables.

The panic texts of `assert!`, `unreachable!` and `.expect` were written from the upstream source and Rust's formats, not observed
from the oracle, since a healthy oracle run does not reach them. `.expect("UniMap ran out of useable keys")`'s `TryFromIntError(())`
suffix is the same kind of reading and is unreachable in practice (a JS `Map` cannot hold 2^32 entries).

## `unported(...)` left

None in this lane's files. `Tree::new` and the rest of tree.rs / diagnostics.rs are tb-b's placeholders.

## For lane miri-tb-b / root (integration)

**What this lane reads from tb-b's files without editing them** (all `PORT(contract): pending miri-tb-b`):

- `LocationState.new_accessed` / `.new_non_accessed` / `.permission_()` and `Tree.new_child` are declared with
  `Pending<"Permission">` in tree.ts. Arguments cross as `as never`, results as `as unknown as Permission`; both still compile when
  tb-b corrects the declarations to `Permission`, and can then be removed.
- `AccessRelatedness::is_foreign` (tree.rs:1231) is not declared, so its one-arm `matches!` is inlined as `rel === "ForeignAccess"`
  in `perform_access` and `from_acc_and_rel`. Swap for tb-b's companion fn if wanted; behaviour is the same.
- `LocationState_eq` is a private helper in mod.ts (the `derive(PartialEq)` of tree.rs:36), needed by `DedupRangeMap::iter_mut`. If
  tb-b exports one, delete the helper.
- No `declare module` was needed for anything tb-b has not declared.

**API tb-b calls, where the skeleton left it open or this lane changed it:**

| upstream | TS |
|---|---|
| `sifa.record_new(x)` | `IdempotentForeignAccess.record_new(field_mut(state, "idempotent_foreign_access"), x)`: a `MutRef` (PORTING §8) |
| `sifa.ensure_no_stronger_than(x)` | same `MutRef`; returns the bool |
| `sifa.can_skip_foreign_access(x)`, `is_local`, `is_foreign` | `IdempotentForeignAccess.<fn>(self, ..)`; `from_foreign`, `from_acc_and_rel` likewise |
| `level.allows(kind)` | `WildcardAccessLevel.allows(level, kind)` |
| `rel.to_relatedness()` | `WildcardAccessRelatedness.to_relatedness(rel)` |
| `UniKeyMap::default()`, `UniValMap::default()`, `ExposedCache::default()` | `.default()` statics |
| `idx == other` | `UniIndex_eq` (a `UniIndex` is a plain object: never `===`) |
| `UniValMap` `PartialEq`, `identical`, `equivalent` | `UniValMap_eq(a, b, eq_V)`; methods take `eq_V` (signature changed from the skeleton) |
| `ExposedCache` `PartialEq` (for `LocationTree`'s) | `ExposedCache_eq`, also `ExposedCacheNode_eq` |
| `Permission` / `PermissionPriv` / `PermTransition` `PartialEq` | `Permission_eq`, `PermissionPriv_eq`, `PermTransition_eq` (two `ReservedFrz` are two objects: never `===`) |
| `{}` of a permission | `display_Permission`, `display_PermissionPriv`, `display_PermTransition` |
| `trans.summary()`, `is_relevant(err)`, `endpoint()`, `perm.short_name()` | methods (added to the declarations) |
| `Result<(), Err>` in `f_propagate` | `Result<null, Err>`, as the skeleton declared |
| `<(A, B)>::exhaustive()` etc. | `Exhaustive_tuple2(A, B, clone_A).exhaustive()`, `Exhaustive_array2..5(T, clone_T)`; `copy` for primitives |
| `impl Exhaustive for Permission / AccessKind / AccessRelatedness` | `Exhaustive_Permission`, `Exhaustive_AccessKind`, `Exhaustive_AccessRelatedness` from perms.ts (not in the test file, because tree/tests.rs needs them) |
| `precondition!(c)` | `if (!c) continue;`: `continue` cannot live in a function |

`TreeVisitorStack`'s methods now have a `this` type carrying the closure bounds; only tree_visitor.ts calls them.

## `// PORT:` decisions in code

1. **unimap.ts:** `V: PartialEq` as `eq_V` (dedup_range_map precedent). `UniIndex` copies share the object, since nothing assigns
   `idx`. `UniEntry` gains `data` and `index` beside the generated `inner`, because `inner: &mut Option<V>` has no TS form: the entry
   writes through to the slot. Generated `UniEntry` is unchanged.
2. **foreign_access_skipping.ts:** `impl` on the companion; `&mut self` as `MutRef`; ordering through `_discriminant`.
3. **exhaustive.ts:** trait as interface plus `Exhaustive_<Type>` tables; `T: Clone` as `clone_T`; lazy generators with `clone`s
   where upstream's are, so a test can mutate what it gets (tree/tests.rs does: `for mut state in ..`).
4. **perms.ts:** `impl PermissionPriv` on the companion. `PermissionPriv` / `Permission` values are shared rather than cloned where
   nothing can assign a field of one: a transition builds a new value and `LocationState.permission` is replaced. mod.ts still clones
   at the points the brief names, where a `Permission` is stored in new state. `#[cfg(test)]` items tree/tests.rs needs stay exported
   here. The `Display` impls take no formatter, since each is `write!(f, "{}", ..)` and no options reach it.
5. **tree_visitor.ts:** the `where` bounds as the methods' `this` type.
6. **wildcard.ts:** the `u16` counters wrap at 2^16 (`u16_add` / `u16_sub`). This assumes the oracle Miri has overflow checks off, as a
   release component build does; I did not test the oracle at the overflow, and reaching it needs 65,536 exposed nodes in one tree.
   `.cloned().unwrap_or_default()` reads a frozen `DEFAULT_NODE`, since nothing writes to those copies. `impl Tree` via `port_methods`.
7. **mod.ts:** `impl Tree` via `port_methods`. `frame_mut()`, `size_and_align_of_val` and `ImmTy::from_immediate` cross CTFE-typed
   signatures with casts, as stacked_borrows/mod.ts does. `*loc = state` is `elem.data = clone_LocationState(state)`.
   `err_ub` and `eprintln` are small private helpers, as in intrinsics.ts and borrow_tracker/mod.ts. `trace!` lines are verbatim comments.

## cfg

`verify_wildcard_consistency` is behind `expensive-consistency-checks`, which is off in the oracle (miri-sb handoff). It is ported
because the tests use it; tb-b's call sites should be comments.
