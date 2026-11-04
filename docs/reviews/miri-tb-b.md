# Independent review: miri-tb-b (Tree Borrows `tree.rs`, `diagnostics.rs`, `tree/tests.rs`)

Branch `t3/port-tree-borrows-tree-diagnostics`, head `7f82fec8`, against merge base `c9d3c553`. The dynamic checks ran on my
own detached merge with miri-tb-a (`6b9cdf47`, a clean merge, not pushed), with the two `.pending-tb-a` files renamed as the
handoff says. Reviewed on 2026-11-04 on the root host, at load 40 to 140. No code was edited, and neither the gate nor a full
suite was run.

## Verdict: **APPROVE WITH NITS**

I found no behavioural defect. The port matched the oracle byte for byte on everything it could run, including the revisions
and flags the lane missed, except for ICE rendering and one allocation size limit outside this lane (both below). All four
nits are low severity: two test gaps and two tidying items.

## Findings

Line numbers are at `7f82fec8`.

1. **low, test gap: `src/miri/borrow_tracker/tree_borrows/tree.ts:610`** (`perm.accessed` in `dealloc`'s strong protector
   check). The port is correct, but nothing protects it. With that condition removed, all 96 Tree Borrows tests pass and 24
   upstream cases selected by name (`protect`, `dealloc`, `mixed_cell`) still match.
   Failing scenario for that mutant: the program below exits 0 on the oracle and the port, and the mutant reports `deallocation
   through <482> (root of the allocation) at alloc287[0x0] is forbidden`. Add it as a fixture.
   ```rust
   use std::alloc::{alloc, dealloc, Layout};
   unsafe fn f(_x: &mut [u8; 0], p: *mut u8, layout: Layout) { dealloc(p, layout); eprintln!("dealloc passed"); }
   fn main() { unsafe {
       let layout = Layout::from_size_align(4, 1).unwrap();
       let p = alloc(layout);
       p.write_bytes(0, 4);
       f(&mut *(p as *mut [u8; 0]), p, layout);
       eprintln!("done");
   } }
   ```
2. **low, test gap: `src/miri/borrow_tracker/tree_borrows/diagnostics.ts:500`** (`children_sorted.sort`). The port is correct,
   but with the sort removed the unit tests pass and 148 of 148 upstream cases still match under `-Zmiri-provenance-gc=1`. Order
   only matters after the GC replaces a dead parent by a higher-numbered child.
   Failing scenario for that mutant, with `-Zmiri-provenance-gc=1`: the program below prints `<476>` then `<477>` on the oracle
   and the port, and `<477>` then `<476>` on the mutant. Add it as a fixture.
   ```rust
   use std::alloc::{alloc, Layout};
   extern "Rust" {
       fn miri_get_alloc_id(ptr: *const ()) -> u64;
       fn miri_print_borrow_state(alloc_id: u64, show_unnamed: bool);
   }
   fn main() { unsafe {
       let p = alloc(Layout::new::<u8>());
       *p = 0;
       let id = miri_get_alloc_id(p as *const ());
       let mut a = &*p as *const u8;
       let b = &*p as *const u8;
       let a2 = &*a as *const u8;
       miri_print_borrow_state(id, true);
       a = std::ptr::null();
       for _ in 0..8 { std::hint::black_box(&a); }
       miri_print_borrow_state(id, true);
       let _ = (*b, *a2);
       std::alloc::dealloc(p, Layout::new::<u8>());
   } }
   ```
3. **low, stale after integration: `tree.ts:14`, `tree.ts:49-91`, `diagnostics.ts:33-58`,
   `tree/tests.test.ts.pending-tb-a:5-7`, `tree_scenarios.test.ts.pending-tb-a:3-5`, `oracle/README.md:6`.** Once merged, these
   comments name files that no longer exist, and the casts and the `unported` branch in `fmt_Permission` are dead. No behaviour
   changes; it only misleads readers. I replaced every cast with a direct call and imported tb-a's own eqs (`PermissionPriv_eq`,
   `ExposedCacheNode_eq`). `tsc` still reports 0 errors and all 96 tests pass, so root can remove them safely at integration.
4. **low, order: `tree/tests.test.ts.pending-tb-a:583`, `:678`.** The two `impl Exhaustive` blocks sit after their classes, so
   their markers run out of upstream order (`:499` after `:580`, `:654` after `:702`). This affects a test file only, and every
   marker points at the right fn.

## 1. Order, logic, names, markers

- A script of mine compared markers with upstream fn lines: `tree.rs` 29/29, `diagnostics.rs` 29/29, `tree/tests.rs` 39/39, with 0
  bad and 0 missing. Order holds in `tree.ts` and `diagnostics.ts`; the only exceptions are finding 4.
- `coverage.ts --missing` agrees on the counts. `coverage.ts --check --offline` prints `markers ok`, and `contract.test.ts` passes
  8 of 8 on the merge.
- I read `tree.ts` and `diagnostics.ts` line by line against upstream and found no divergence.
- `LocationState` is cloned where it stays live next to its source (`new_child`, `perform_access_no_fluff`, `rperm`), and
  `clone_LocationTree` deep-clones it on range splits.
- Sharing `Permission` and `PermTransition` is safe: no code assigns `inner`, `from` or `to`. `create_event` shares `transition`
  although the handoff's PORT note 2 lists it as cloned; the object is fresh and immutable, so this is harmless.
- I found no `===` on objects: `UniIndex` compares by `.idx`, and the other uses are numbers or string enums.

## 2. `tree.ts`

- `perform_access`, `perform_normal_access` and `perform_wildcard_access` match upstream in visit order and in which error
  comes first. So do `dealloc`'s root order, the protector-release skip and `get_min_exposed_child` after its last edit.
- I read the traversal entry points in tb-a's `tree_visitor.ts`, which match. I did not read the stack internals line by line,
  but the end-to-end runs below exercise them.
- **Upstream bug confirmed against the oracle.** An unnamed wildcard root with two named children, printed with
  `show_unnamed = false`, panics the oracle at `diagnostics.rs:651:9` with `assertion failed: v.is_empty()`, exit 101. The port
  also exits 101 with the same assertion text, and its output before the panic is identical. Only the ICE rendering differs, as
  it does for any port ICE. With 0 or 1 named children, both sides are byte-identical.
- **Another upstream panic, not in the handoff.** `miri_pointer_name` with `nth_parent` past the root panics with
  `Option::unwrap()` at `diagnostics.rs:243:52`. The port gives the same text and exit 101. The fuzz hit this 20 times.

## 3. `diagnostics.ts`

Format strings match upstream, including `{alloc_id}` in `TbError::build` versus `{alloc_id:?}` in
`no_valid_exposed_references_error`. I regenerated all 11 oracle fixtures: each `.stderr` and `.exit` equals a fresh oracle run,
and the port equals the oracle on all 11.

## 4. `tests.rs` port and mutation tests

The property statements, preconditions and loop nesting match upstream. The string keys used for `Hash`/`Eq` cover every field of
the derived impls. The only addition makes the test stronger (`expect(ok).toBeGreaterThan(0)`).

I ran 26 mutants against the Tree Borrows tests: 18 were killed and 8 survived.

| survivor | what happened |
|---|---|
| T4, `dealloc` ignores `accessed` | test gap, finding 1; caught by the program there |
| D3, children unsorted | test gap, finding 2; caught by the program there |
| T5, `max_local_tag >= node.tag` becomes `>` | equivalent: tags are unique, and the accessed root's own tree is skipped before this runs |
| T9, GC may replace a root | equivalent: the function is only called on children, which always have a parent |
| T11, `tag > min_exposed_child` becomes `>=` | equivalent: on equality the next root breaks anyway |
| D4, `Display` of `AllocId` instead of `Debug` | equivalent: same text in upstream's impls and in the mutant's test run |
| T14, `Disabled` skip removed | upstream says this only affects diagnostics; 195 of 195 upstream cases still match |
| D7, `v.is_empty()` assert removed | no test, by the lane's choice; my wildcard program above reaches it |

The ported properties caught the semantic mutants aimed at them: `tree_compacting_is_sound` (P3),
`protected_enforces_noalias` (P2), `all_read_accesses_commute` (P1, P2, P4), and `test_all_patterns` (P4).

## 5. Merged tree and casts

- `bunx tsc --noEmit -p .`: 0 errors. `bun test src/miri/borrow_tracker/tree_borrows`: 96 pass, 0 fail.
- **No `PORT(contract): pending miri-tb-a` cast hides a mismatch.** I checked `IFA()`'s 5 methods, `allows`, `to_relatedness`,
  the `UniValMap.equivalent` overload, `short_name`, `summary`, `is_relevant`, `endpoint` and `display_Permission`. With all of
  them replaced by direct calls, `tsc` still reports 0 errors. The same held with tb-a's three `as unknown as Permission` casts
  removed (`wildcard.ts:246`, `:319`, `mod.ts:414`).
- `UniValMap.equivalent` really uses `eq_V` (`options_eq`, `unimap.ts:104-114`). Making `LocationTree_eq` compare by identity
  kills the structural test and the GC merging test (T3).

## 6. End-to-end comparison (own script, on the merged code after the last edit)

Argv is built the way `tests/ui.rs` and `ui_test` build it: `-Dwarnings -Dunused -Ainternal_features -Zui-testing`, the Miri
sysroot, the target, the edition (from `//@edition` if present), `--cfg=<rev>`, `-Cextra-filename=-<rev>`, then base
`compile-flags` followed by the revision's. `rustc-env` and the `MIRI_*`/`RUST_BACKTRACE` variables are applied. Each case
compares stdout, stderr and exit code.

| run | cases | result |
|---|---|---|
| `tests/{pass,fail}/{tree_borrows,both_borrows}`: 123 files, every revision, including 35 with `-Zmiri-tree-borrows-implicit-writes` | 195 | **195 MATCH, 0 differences** |
| Other `tests/{pass,fail,panic}` files with a `-Zmiri-tree-borrows` directive (49 files) | 139 | 134 MATCH, 2 TIMEOUT, 3 UNPORTED |
| The Tree Borrows revisions of the first row, plus `-Zmiri-provenance-gc=1` (GC and merging on every chance) | 148 | **148 MATCH** |
| 200 random programs (retags, protected calls, exposes, wildcard roots, `Cell`, naming, printing, dealloc), across 4 flag sets including GC 1, implicit writes and no-precise-interior-mut | 200 | 180 byte-identical; 20 are the upstream panic in section 2 |

- **What the first row exercised on the oracle:** 135 UB reports, 58 histories, 18 tree prints, 10 `<wildcard>`, 5 protector
  releases.
- **The 2 timeouts** were `tests/pass/async-drop.rs` `#stack` and `#tree`, at the 600 s cap under load. Rerun one job at a time
  with no other job of mine running, all three revisions MATCH in 17 to 20 s. They are not a finding.
- **The 3 UNPORTED** are `tests/pass/concurrency/sync.rs` in every revision, including `stack`: `mio::Poll::new (host I/O,
  isolation off; plan-m6 D5)`. This is unrelated to this lane.
- **The 20 panics:** same panic text on both sides and identical output before the panic. The difference is only ICE rendering.
- **The script can report a difference.** With a different borrow model it reports DIFF, a missing oracle or port is a
  HARNESS_ERROR (never a match), and identical args report MATCH. Every oracle exit also matched its suite's expectation (0 for
  pass, 1 for fail).
- **That last check caught two mistakes of mine.** My first version applied `compile-flags` in file order, so the oracle stopped
  with `-Zmiri-tree-borrows is required before ...`, and it ignored `//@edition`, so `generators.rs` failed to compile. Both sides
  then "matched" without running anything. I fixed the script and discarded and reran the 36 affected results; the numbers above
  are from the fixed script.

## 7. `transition_range` as `BigInt`

The current handling is **correct at the boundaries**, so retyping it is a performance choice only, and root's call.

- `Size::bytes()` stops above 2^53 - 1, so `BigInt(number)` is always exact.
- A hand-driven tree at offsets 2^31, 2^32, 2^44 - 1 and 2^53 - 2 gave the expected title, `[0x..]` text and ranges. The expected
  text was computed from upstream's format strings, not produced by the oracle.
- Byte-identical end to end: a 3 GiB allocation with UB at `[0xbfffffff]`, and a 2^54 allocation (the same resource exhaustion on
  both sides).
- The oracle's own output for offset `0x100000123` has the same format.

**For root, outside this lane:** an allocation of 2^32 + 4096 bytes succeeds on the oracle, while the port reports `resource
exhaustion: tried to allocate more memory than available to compiler`. That is the engine's buffer limit
(`src/miri/alloc/alloc_bytes.ts:8`). So the port has no end-to-end Tree Borrows path above about 4 GiB.

## Not checked

- tb-a's files as such, which are reviewed separately (`tree_visitor.ts` stack internals, `perms.ts`, `wildcard.ts`). They were
  only exercised through tests and the end-to-end runs.
- `tests/pass-dep`, `fail-dep`, `native-lib`, `genmc` and `many-seeds` (they need dependencies or other modes).
- Comparison with upstream's blessed `.stderr` files. I compared raw output with the oracle instead, and upstream's expected exit
  status.
- The lane's exact argv, without `-Zui-testing`, except on the 11 fixtures and my own programs.
- GC stress on the 139 "other" cases.
- End-to-end offsets above 2^32. My one oracle run at 2^44 was killed with exit 137, and I did not retry it on a shared machine.
- Threads in the random programs, which also use only one allocation and only `Cell<u8>` for interior mutability.
- `bun test src/miri` as a whole: I ran only the Tree Borrows tests and `contract.test.ts`.
- The gate.

Scripts and raw results stay in my session scratchpad, not in the repo.
