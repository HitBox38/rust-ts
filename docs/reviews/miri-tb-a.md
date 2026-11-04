# Review: lane miri-tb-a (independent reviewer)

Reviewed `t3/port-miri-tree-borrows-support` at `6b9cdf47` against its merge base `c9d3c553`, one commit, against upstream at the
pin. No lane code was edited, and the gate and full suites were not run.

## Verdict: **APPROVE WITH NITS**

I found no logic, ordering, naming, aliasing or panic-text defect. All findings below are low severity, and none blocks the merge.

The strongest evidence goes beyond what the lane could produce. I merged it with tb-b's branch (`7f82fec8`, no conflicts) in a scratch
tree and ran both sides of upstream's own Tree Borrows tests: **148 of 148 cases byte-identical to the oracle** (stdout, stderr, exit).
The lane's "not checked against the oracle" list is mostly settled by this (see "Integration run"), though root should repeat it after
the real merge.

## Findings

Every finding is low severity.

**F1. `src/miri/borrow_tracker/tree_borrows/mod.ts:383,385,395,414,466`, `wildcard.ts:246,319`: remove the 7 `Pending` casts at
integration.** The handoff says they "can then be removed". Treat that as required. They are harmless today: on the merged tree, with all
7 removed, `tsc` reports 0 errors. Left in place, they turn off checking for good.
*Failing scenario:* a later change declares `LocationState.new_accessed(permission: PermissionPriv, ..)`. `perm as never` still compiles
and passes a `Permission`, so `.$` is `undefined` in every transition, and only a runtime divergence reveals it. Also drop the stale
header notes (`mod.ts:5-7`, `wildcard.ts:9-10`) and the test cast (`wildcard.test.ts:33`).

**F2. `tree_visitor.ts:110`: upstream's tests do not pin traversal order, so only the lane's unit test guards it end to end.** The code is
right (item 4). But with `this.stack.reverse()` deleted on the merged tree, all 55 `tests/fail/tree_borrows` cases I reran **still
matched the oracle**.
*Failing scenario:* a later regression in order reports the wrong protected tag, and an upstream-tests-only comparison stays green.
`tree_visitor.test.ts` does catch it (5 tests fail with that mutation, 2 with reversed child pushes), and programs A and B under
"Programs for root" catch it against the oracle.
*Recommendation:* add A and B beside tb-b's `tree_borrows/oracle/` fixtures.

**F3. `exhaustive.ts:6`: the comment is wrong.** It says "only the `.test.ts` files use it", but `perms.ts:13` value-imports it and
`lib.ts:41` loads it, so it ships in the default path. No behaviour impact.
*Failing scenario:* a reader deletes the module or its export as test-only, and every Miri run then fails at link time.

**F4. `unimap.ts:103`: the doc comment does not match the signature.** It says `data[from..to]`, but the helper takes `len` and compares
`[0..len)`. The behaviour is correct.
*Failing scenario:* someone passes a slice start because of the comment.

**F5. `mod.ts:94`, `perms.ts:306`, `foreign_access_skipping.ts:84`: duplicates left after the merge.** tb-b exports the same
`LocationState_eq` (its `tree.ts:94`) and `AccessRelatedness.is_foreign`. The copies are equivalent today.
*Failing scenario:* a later change to one `LocationState_eq` makes `DedupRangeMap` merging in `tb_reborrow` disagree with the merging in
`Tree`. Delete the copies at integration, as the handoff offers.

## The questions in the brief

### 1. Order, logic, names, markers

- A marker script compared all 7 files with upstream's fn lists: every marker's line and name are right, with **0 order inversions**.
  Fns without a marker in the hand files are `#[test]` items and `MapWitness` test helpers, with their markers in the test files.
- `coverage.ts --missing`: 13/13, 47/47, 8/8, 29/29, 8/8, 8/8, 11/11 = 124/124, as the handoff says. `coverage.ts --check --offline`
  passes (`markers ok`).
- I read every function against upstream, including the `mod.rs` retag paths, `NewPermission::new`, and the match-arm order where guards
  make order matter.
- Upstream's `#[derive(PartialOrd)]` on `Permission` has no TS form. That is fine: no upstream code in `tree_borrows/` uses it.

### 2. `Copy` values and `_eq`

- Fresh values are stored wherever a later write could alias: `loc_state` clones the `Permission` (`mod.ts:379`), the outside permission
  is cloned (`:466`), `*loc = state` clones per element (`:400`), `iter_mut` splits with `clone_LocationState`, and `or_insert` gets a
  new object (`wildcard.ts:219`).
- `Permission` and `PermissionPriv` are shared rather than cloned, under a `PORT:` note. That holds: nothing in the lane assigns `.inner`
  or `.conflicted`, and upstream keeps those fields private to `perms.rs`. `UniIndex.idx` is likewise never assigned.
- `DEFAULT_NODE` is frozen and only read.
- A grep for `===` on these objects found none. The only hit, `wildcard.ts:210`, compares string enums. `UniIndex_eq`, `PermissionPriv_eq`
  and `Size_eq` are used where upstream compares by value.

### 3. Permission state machine

- I compared every arm of `child_read`, `foreign_read`, `child_write`, `foreign_write`, `perform_access`, `partial_cmp`,
  `strongest_idempotent_foreign_access`, `can_be_replaced_by_child`, `strongest_allowed_local_access`, `summary` and both `is_relevant`
  matches. All match, including the `assert!(!protected)` paths. `is_relevant`'s final `unreachable` covers exactly upstream's remaining
  combinations.
- One correction to the brief: `exhaustive.rs` contains no properties. They live in `perms.rs` `propagation_optimization_checks`, and
  the five `#[test]`s there have the **same statements, with the same preconditions**. The `FxHashSet` becomes a set of Debug strings, which
  is equivalent because that Debug output is injective.
- tb-b's port of `tree/tests.rs` also passes over this lane's `Exhaustive_*` tables: 96 pass, 0 fail on the merged tree.

### 4. `unimap` and `tree_visitor`

- Index reuse matches: `deassigned` is LIFO, and a fresh index is `mapping.len()`. `UniKeyMap.remove` does not touch value maps, as upstream.
- Traversal matches upstream's stack: `rev()` pushes, a final `reverse()`, the state change before `f_continue`, and `pop` before
  `propagate_at`.
- Oracle evidence: programs A, B and C below match the oracle on the merged tree. Deleting the `reverse()` makes A and B diverge on which
  protected tag is reported. C does not diverge from that mutation.

### 5. Panic texts and `u16` wrapping

- **Panic texts:** I compared every `assert!`, `unreachable!`, `panic!` and `.expect` text in the lane with upstream by reading, not by
  triggering each one. None is invented, and the `internal error: entered unreachable code: ` prefix is written once, as `std/panic.ts`
  `unreachable` adds none.
- **`u16` wrapping: the oracle does wrap, so the lane's assumption is now verified.** I could not read this from upstream's build config,
  because `src/ci` and `src/bootstrap` are not in the sparse checkout (`Cargo.toml` and Miri's own set no `overflow-checks`). So I tested the
  pinned Miri with program D:

  | Exposed children, then | Oracle | Merged port |
  |---|---|---|
  | 70,000, no wildcard access | exit 0, no overflow panic | identical |
  | 65,536, then a wildcard write | exit 1: "there are no exposed tags which may perform this access here" (counter wrapped to 0) | identical |
  | 65,535, then a wildcard write | exit 0, write succeeds | identical |

- **It can matter, but only barely:** a program needs 65,536 exposed nodes in one tree, and then gets a false UB report. The port reproduces
  that. The `wildcard.ts:6` note can now say "verified" instead of assuming.

### 6. `eq_V` and the casts

- **`eq_V` is the right approach and hides nothing.** It follows the `eq_T` precedent in `dedup_range_map.ts`, and it is a required
  parameter with no default, so omitting it is a compile error. `identical` and `equivalent` keep their distinct semantics, and
  `unimap.test.ts:250` tests the difference.
- The risk is a caller passing identity, which would stop ranges merging and change printed trees. tb-b passes `LocationState_eq` and
  `ExposedCacheNode_eq` (its `tree.ts:94-100`), so that does not happen.
- **The casts hide no type error today**, confirmed on the real merge: tb-b declares `permission_(): Permission` and `Permission`
  parameters, and with the 7 casts removed `tsc` exits 0. They could hide a future one (F1).
- tb-b's opposite casts (`IFA()`, the `perms` namespace reads) were not type-checked this way. They work at runtime in the E2E run, and their
  correctness belongs to tb-b's review.

### 7. Tree Borrows off

**What runs:** only module evaluation. `lib.ts:40-48` already loaded these modules as stubs on base. They now assign prototype methods and
register `port_methods`. Every call into Tree Borrows is behind a `switch` on the borrow-tracker method in `borrow_tracker/mod.ts`, which
this lane did not touch. The only other importers outside `tree_borrows/` are generated types, `lib.ts` and the contract test.

**The lane's evidence was weak on its own.** "Times out on both trees" is a censored result and cannot detect a slowdown below the limit. The
one uncensored run was a single case. Its conclusion is right, though, and I measured it directly, running all 5 cases with no time limit,
lane and base concurrently at load roughly 90-300:

| Case | Oracle | Base CPU (s) | Lane CPU (s) | Output |
|---|---|---|---|---|
| `async-drop-initial.rs` | 0.3 s | 63.1 | 60.5 | identical to oracle on both trees |
| `feature-gate-generic_assert.rs` | 0.7 s | 114.2 | 113.9 | identical to oracle on both trees |
| `test-filter-multiple.rs` | 0.7 s | 115.6 | 114.4 | identical to oracle on both trees |
| `foreach-external-iterators-nested.rs` | 0.7 s | 104.5 | 105.4 | identical to oracle on both trees |
| `coroutine/smoke.rs#nomiropt` | 1.1 s | 156.0 | 157.5 | identical to oracle on both trees |
| **Total** | | **553.4** | **551.2** | |

- **All 5 now shown to match**, where the lane had shown only one. Lane CPU is 0.4% below base, which is noise.
- Module load: median user+sys **0.71 s base, 0.73 s lane** (8 runs each, alternating). Even if all of that 0.02 s is real, it is one-off
  per process and cannot push a case over a 60 s limit.
- `miri-hello`: output identical on both trees over 6 alternating pairs. Its timing is too noisy to use alone, since load dominated sys time
  (mean user 6.72 s base, 6.97 s lane).
- **I see no way this lane slows the default path.**

**For root:** CPU time itself inflates under this contention: `foreach-external-iterators-nested.rs` used 105 s here against the 57 s the
handoff measured. So these 5 will keep timing out against the 60 s wall limit on a loaded machine, on any branch. All five matched in accepted
gate `gate-20261102-174727-root-kxpt`. Run the gate with lanes stopped.

## Integration run (scratch merge of `6b9cdf47` + `7f82fec8`, based on `c9d3c553`)

- `tsc` exits 0 with tb-b's pending tests renamed in and the casts removed. `bun test src/miri/borrow_tracker/tree_borrows`: 96 pass, 0 fail.
  At the lane head alone: 61 pass. The contract test passes at the lane head (8 pass).
- Upstream's `tests/{pass,fail}/{tree_borrows,both_borrows}`, every Tree Borrows revision: **148 of 148 match**, about 97 of them reporting UB.
- A correction to my own run: 10 `#tree_implicit_writes` cases first stopped on a usage error from my script's flag order, on both sides, so
  those matches meant nothing. I reran all 20 implicit-writes revisions with the order fixed, confirmed no usage errors, and all 20 match. The
  148 counts those corrected results.

This settles most of the lane's "not checked" list:

| Lane's item | Result |
|---|---|
| 1. Any `-Zmiri-tree-borrows` run | 148 of 148 match |
| 2. `-Zmiri-tree-borrows-no-precise-interior-mut` | 2 programs match |
| 2. `-Zmiri-tree-borrows-implicit-writes`, `#[rustc_no_writable]` on real attributes | match, including `rustc_no_writable.rs` |
| 3. `-Zmiri-track-pointer-tag`, `log_creation` text | 3 programs match, about 140 "created tag" lines, both format branches hit |
| 4. `print_tree` | matches, through upstream's tests that print trees |
| 4. `tb_expose_tag` | matches, through upstream's wildcard tests and program D |
| 5. `tree/tests.rs` over the `Exhaustive_*` tables | passes |

`consistency_large`'s pinned SipHash values also reproduce exactly with the pinned toolchain's rustc.

## Programs for root

The scratch files are gone, so here they are. Run each with `-Zmiri-tree-borrows`, plus `-Zmiri-permissive-provenance` for D, and compare with
the oracle.

A, sibling order (the oracle reports protected tag `<475>`; without `reverse()` the port reports `<473>`):

```rust
fn two(_a: &mut i32, _b: &mut i32, _c: &mut i32, p: *mut i32) { unsafe { p.write(1) }; }
fn main() {
    let mut v = 0i32;
    let p = &raw mut v;
    unsafe { two(&mut *p, &mut *p, &mut *p, p) };
}
```

B, cousins at different depths (the oracle reports `<475>`; without `reverse()` the port reports `<477>`):

```rust
fn two(_a: &mut i32, _b: &mut i32, _c: &mut i32, q: *mut i32) { unsafe { q.write(1) }; }
fn main() {
    let mut v = 0i32;
    let p = &raw mut v;
    unsafe {
        let m1 = &mut *p;
        let r1 = &raw mut *m1;
        let m2 = &mut *r1;
        let r2 = &raw mut *m2;
        let a = &mut *r2;
        let b = &mut *r1;
        let c = &mut *p;
        two(a, b, c, r2);
    }
}
```

C, nested protected nodes (matches the oracle, but does not detect the `reverse()` mutation):

```rust
fn inner(_c: &mut i32, q: *mut i32) { unsafe { q.write(1) }; }
fn outer(a: &mut i32, q: *mut i32) { let r = &raw mut *a; unsafe { inner(&mut *r, q) }; }
fn main() {
    let mut v = 0i32;
    let p = &raw mut v;
    unsafe { outer(&mut *p, p) };
}
```

D, `u16` wrap, with `(N, WILDCARD)` = `(70000, false)`, `(65536, true)`, `(65535, true)`:

```rust
use std::cell::Cell;
const N: u32 = 65536;
const WILDCARD: bool = true;
fn main() {
    let c = Cell::new(0i32);
    let r: &Cell<i32> = &c;
    let mut addr = 0usize;
    let mut i = 0u32;
    while i < N {
        let q: &Cell<i32> = &*r;
        addr = q as *const Cell<i32> as usize;
        i += 1;
    }
    if WILDCARD {
        let p = std::ptr::with_exposed_provenance_mut::<i32>(addr);
        unsafe { p.write(7) };
    }
    println!("done {} {}", i, c.get());
}
```

## What I did not check

- **The gate and full suites.** Of the protected cases, I ran only the 5 above plus `miri-hello`. The lane's sample of 200 was not repeated.
- **Idle-machine timing.** Load was 50-300 throughout, so all CPU numbers are comparative, not absolute.
- **The merge with current main.** The integration run used the lane's base `c9d3c553`, not `dc5e3107`. Root's real merge must repeat it.
- **tb-b's own code.** It was exercised, not reviewed. A match there could in principle hide offsetting errors in both lanes, though F2's
  mutations show the comparison does respond to order changes when the programs pin order.
- **`tb_give_pointer_debug_name`'s two `eprintln!` texts.** Compared by reading only. No run named a wildcard or provenance-free pointer.
- **Panic paths, by triggering them.** Texts were read, and only the unit tests fire some. One observation outside this lane: with
  `-Zmiri-track-pointer-tag=1`, both sides panic on the same `!span.is_dummy()` assertion but render it differently
  (`rust-ts: internal compiler error:` against `thread 'rustc' panicked at`). That is the driver's general ICE format.
- **The code generator.** I read the generated `.gen.ts` files these modules use and relied on them, except `foreign_access_skipping.gen.ts`,
  of which I checked only its discriminant through `test_order`. `tools/codegen` itself was not reviewed.
- **Test files in full.** I read `perms.test.ts` through its upstream tests and state-machine tables, and sampled the others. Their strength is
  judged from the results above, not line by line.
- **Mutation coverage beyond traversal order.** Only `tree_visitor.ts` was mutated, so the unit tests' power on `perms.ts` and `wildcard.ts`
  is unmeasured.
- **Windows.** Not run.
