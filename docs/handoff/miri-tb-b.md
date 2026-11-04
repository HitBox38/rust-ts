# Handoff: lane `miri-tb-b` (M6 wave 38, Tree Borrows part b)

Tree Borrows' `tree_borrows/{tree,diagnostics}.rs` and `tree/tests.rs` (2,905 upstream lines), filled into the miri-contract
skeleton. Branch `t3/port-tree-borrows-tree-diagnostics`. Lane miri-tb-a ran in parallel and had committed nothing when this
lane finished, so what needs its code is listed under "For root".

## Files touched

- `src/miri/borrow_tracker/tree_borrows/tree.ts`: ported (stub replaced).
- `src/miri/borrow_tracker/tree_borrows/diagnostics.ts`: ported (stub replaced).
- `src/miri/borrow_tracker/tree_borrows/diagnostics.test.ts` (new, runs now).
- `src/miri/borrow_tracker/tree_borrows/tree/tests.test.ts.pending-tb-a` (new, the port of `tree/tests.rs`; not run by `bun test`).
- `src/miri/borrow_tracker/tree_borrows/tree_scenarios.test.ts.pending-tb-a` (new; not run by `bun test`).
- `src/miri/borrow_tracker/tree_borrows/oracle/` (new): 11 Rust programs, each with the oracle's `.stderr` and `.exit`, and a
  README with the regeneration command.
- `docs/handoff/miri-tb-b.md` (this file).

No `.gen.ts`, no other lane's file, nothing under `tools/`, `harness/` or `scripts/` was edited.

## Coverage

| file | fns |
|---|---|
| `tree_borrows/tree.rs` | 29/29 |
| `tree_borrows/diagnostics.rs` | 29/29 |
| `tree_borrows/tree/tests.rs` | 0/39 on this branch, 39/39 once renamed (see "For root"): its markers are in the `.pending-tb-a` file, which coverage does not read |

`bun scripts/coverage.ts --check --offline`: `markers ok`.

## Verification on this branch

- `bunx tsc --noEmit -p .`: 0 errors.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/miri`: 252 pass, 0 fail, 0 skip (includes `contract.test.ts`: every module loads as a
  fresh entry point, no stub collisions).
- Sample difftests (agent `miri-tb-b`), nothing outside Miri changed:
  - `--suite mir --sample 100`: MATCH=100, DIFF=0 (run `20261103-234708-miri-tb-b-mcmd`).
  - `--suite run-pass-miri --sample 50`: MATCH=49, UNPORTED=1 (run `20261103-234823-miri-tb-b-4jkn`). The one is
    `tests/ui/sanitizer/kcfi-c-variadic.rs`, stopping at `rustc_codegen_llvm::llvm_util::target_config (-Z sanitizer)`, unrelated to this lane.
- `diagnostics.test.ts` needs no tb-a code and checks:
  - `DisplayRepr::print` against `oracle/print_state.stderr`, byte for byte. A child process prints every tree parsed back from
    the oracle's output; the port recomputes all widths, padding, borders and connectors.
  - `no_valid_exposed_references_error` against `oracle/wildcard_no_exposed.stderr`.
  - `AccessCause`, `NodeDebugInfo`, `History`, `DisplayFmt` and `DisplayIndent`.

## Verification against tb-a's work in progress (not on this branch)

tb-a's uncommitted working tree was copied, read-only, over a scratch export of this branch's code. **This is evidence, not a
substitute for root's run after merging:** tb-a's files were unfinished and may still change.

- `tsc`: 0 errors with both pending test files renamed in.
- `bun test src/miri/borrow_tracker/tree_borrows`: 96 pass, 0 fail, including the whole `tree/tests.rs` port
  (`test_all_patterns`, `tree_compacting_is_sound`, ...).
- **End to end, the port's `src/miri/bin/miri.ts` against the oracle Miri** (stderr, stdout and exit code identical):
  - the 11 programs in `oracle/`: 11 MATCH;
  - upstream's `tests/{pass,fail}/{tree_borrows,both_borrows}/**/*.rs`: **123 of 123 MATCH**. Of the oracle's runs, 91 end in a UB
    report, 56 show a history, 12 print trees, 6 show a protector release, 13 mention `<wildcard>`, and 2 print a wildcard subtree.
  - The 123 ran before the last edit of `tree.ts` (a `push(...)` spread became a loop in `get_min_exposed_child`). The 11 and the
    unit tests ran after it.
- Mutation checks: 9 mutants of the port, each run against the unit tests.
  - 8 are semantic and all are caught: 3 from the first run, 1 by `diagnostics.test.ts` (which that first run had not included), and 4
    after tests were added for them.
  - Two of them were also run against upstream's programs, which catch them too: the skip of wildcard roots on protector release
    (`wildcard/reborrow.rs`) and the protector ignoring `accessed` (all 4 programs tried).
  - The ninth removes the skip in `get_min_exposed_child`, an optimization, so it is expected to survive.

Limits of that end-to-end run:

- It passes `--edition 2021 -Zmiri-tree-borrows` and the first `//@compile-flags:` line only. Compiletest revisions were not
  applied, so `-Zmiri-tree-borrows-implicit-writes` (the `tree_implicit_writes` revisions) was **not** exercised.
- It compares raw output of the two Miris. It is my own script, not `difftest.ts`, and no suite holds these programs.
- It ran on the root host (`aarch64-apple-darwin`) with `--target x86_64-unknown-linux-gnu`, as the Miri suites do.

## For root, after merging miri-tb-a

1. Rename the pending tests (they have no `.ts` extension so that `bun test`, `tsc` and `contract.test.ts` ignore them until then):
   - `tree_borrows/tree/tests.test.ts.pending-tb-a` → `tree_borrows/tree/tests.test.ts`
   - `tree_borrows/tree_scenarios.test.ts.pending-tb-a` → `tree_borrows/tree_scenarios.test.ts`
2. Run `bunx tsc --noEmit -p .`, `bun test src/miri`, and check `coverage.ts --missing .../tree/tests.rs` says 39/39.
3. Run the end-to-end comparison (the regeneration command in `oracle/README.md`, against `src/miri/bin/miri.ts`). If root wants it
   protected, a suite needs adding (a `harness/` batch; this lane did not touch `harness/`).

What the pending tests import from tb-a by name: `Exhaustive_{bool,never,unit,tuple2,array2}`, `copy` (exhaustive.ts);
`Exhaustive_{AccessKind,AccessRelatedness,Permission}`, `display_Permission` (perms.ts); `Tree.prototype.expose_tag`. These names are
tb-a's as of its working tree; a rename there shows up as a `tsc` error after step 1.

## PORT(contract): pending miri-tb-a

All in one block at the top of each file. Every item below has the same shape in tb-a's working tree today, so nothing should need
changing at integration, but the casts hide a mismatch from `tsc`, so check them if tb-a's signatures moved.

- **tree.ts**
  - `IdempotentForeignAccess.{can_skip_foreign_access, record_new, from_foreign, from_acc_and_rel, ensure_no_stronger_than}`, on the
    companion, with `&mut self` as `MutRef` (reached through a cast, `IFA()`: a const companion cannot be augmented with `declare module`).
  - `WildcardAccessLevel.allows`, `WildcardAccessRelatedness.to_relatedness` (same cast).
  - `UniValMap.equivalent(other, eq_V)`, a `declare module` overload of the stub's declaration. **It must compare with `eq_V`:** identity
    would stop ranges merging, which changes printed trees. A pending test checks this ("LocationTree_eq is structural").
  - Local copies of derived eqs, `PermissionPriv_eq` and `ExposedCacheNode_eq`. tb-a exports its own; either works.
- **diagnostics.ts**
  - `Permission.short_name`, `PermTransition.{summary, is_relevant, endpoint}`, a `declare module` on perms.gen.ts.
  - `display_Permission`, read through the `perms` namespace at call time (`fmt_Permission`): a named import of an export that does
    not exist yet would fail at link time. It stops `unported` until tb-a lands.

Optional tidying once merged: call the companions directly instead of `IFA()` and the two wrappers, and use tb-a's eqs.

In the other direction, tb-a inlines `rel.is_foreign()` and casts `LocationState.permission_()` under its own "pending miri-tb-b" notes.
Both exist now: `AccessRelatedness.is_foreign(rel)` and a `permission_(): Permission` typed return.

## `unported(...)` left

One: `fmt_Permission` (above), until tb-a exports `display_Permission`. A missing `IFA()` method or `short_name` would be a `TypeError`
rather than `unported`, but only tb-a's code can reach those paths.

## Contract changes (signatures others might call)

- `Pending<"Permission">` in the `LocationState` / `Tree` declarations is now `Permission`.
- `DisplayIndent.write(s: MutRef<string>)` (was `string`), `DisplayRepr.print(.., ranges: DedupRange[], ..)`.
- New exports:
  - tree.ts: `AccessRelatedness` companion with `is_foreign`, `LocationState_eq`, `LocationTree_eq`, `display_LocationState`.
  - diagnostics.ts: `AccessCause` companion with `print_as_access`, `display_AccessCause`, `display_NodeDebugInfo`, `DEFAULT_FORMATTER`,
    `fmt_Permission`.
- `impl Tree` in diagnostics.rs is registered with `port_methods` (C10), so `nth_parent`, `give_pointer_debug_name`, `is_allocation_of` and
  `print_tree` exist only after `install_miri_stubs()` (that is, after `src/miri/lib.ts` loads).

## `// PORT:` decisions in code

1. `LocationState` is `Copy` and mutated in place, so every copy that stays live next to its source is a `clone_LocationState`
   (`new_child`'s insert per location, `perform_access_no_fluff`, `DisplayRepr`'s `rperm`). Read-only copies share the object (the skippers,
   `dealloc`'s check). A pending test proves the `new_child` copies are independent.
2. `Permission`, `UniIndex` and `AllocRange` copies share the object. Upstream has no `&mut self` on `Permission` and never assigns `inner`
   or `idx`. Copies stored in histories and events are still cloned (`History::forget` / `extract_relevant`, `create_event`), since they
   outlive the access.
3. `Ord for IdempotentForeignAccess` is its generated `_discriminant`.
4. `transition_range` is generated as `bigint`s (C5) while `DedupRangeMap` ranges are numbers, so `transition_range_of` converts per
   location.
5. `chars().count()` is a code point count (`chars_count`), not `.length`: `oracle/print_state.rs` names a tag `π🦀`.
6. `String::pop` in `DisplayIndent::decrement` drops one UTF-16 unit; every indentation char is in the BMP.
7. `retain_mut` is a compacting loop over the same array. `extend_from_slice` is a loop, not a spread (argument count limit).
8. `DisplayIndent::write`'s `&mut String` is a `MutRef<string>` (PORTING §8).
9. `eprintln!` is a synchronous write to fd 2, as in borrow_tracker/mod.ts.
10. `expensive-consistency-checks` blocks are comments (off in the release Miri, miri-sb's finding).

## For root to know

- **Upstream bug, kept:** `DisplayRepr::from` asserts `v.is_empty()`. With `show_unnamed = false`, an *unnamed* wildcard root with two or more
  named children leaves several entries in `v`, and the oracle ICEs with `assertion failed: v.is_empty()`. I hit it writing a fixture, and the
  port has the same assert and text. No fixture covers it: an ICE's output is not stable.
- **Performance suggestion (a `tools/codegen` change, so yours):** a `fields` typemap entry making `DiagnosticInfo.transition_range` and
  `Event.transition_range` numbers would remove the `BigInt` conversions per location, per access. Behavior is unaffected.
- **Harness note for lanes in worktrees:** on macOS there is no `timeout` command. My first comparison script used it, both sides exited 127
  with the same message, and everything "matched" in a second. The numbers above are from the fixed script, which treats exit 127 as a
  harness error and uses `perl -e 'alarm ..'` for time limits.
