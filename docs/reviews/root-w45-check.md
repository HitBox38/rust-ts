**Verdict: APPROVE WITH NITS.** Root's three commits do what they say, the five merges are exact, and the whole-branch checks pass. N1 is a
residual in the E0464 test that the new rule makes loud rather than silent. N2 and N3 are wording and bookkeeping.

# Independent check: root's commits and merges on `integ-w45` (lane `root-w45-check`)

Checked: `integ-w45` at `51d6ca81`, against `main` at `74f215e6`. Read-only on code: the only edit was a temporary mutant of
`src/rustc_session/filesearch.ts`, restored with `git checkout`, with a clean tree afterwards. Settings: `.env.local` from `integ-w39` plus
`RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`, `RUST_TS_AGENT=root-w45-check`, on AC power, Bun 1.4.3. The worktree had no
`node_modules`; `bun install --frozen-lockfile` installed it, and `git status` was unchanged. No gate and no full suite was run.

## Findings

- **N1 (low, test; simulated, not reproduced on a real file system): `src/rustc_metadata/locator.oracle.test.ts:92-93, 109`. On a file
  system whose `readdir` follows a seeded hash of the name, some seeds give no filler count up to 200 that swaps a `libfoo` pair. `setup()`
  then throws, and the whole file fails.** I fed the port's `slice_sort_unstable_by` the same names and layout under 303 `readdir` orders
  that stay fixed as files are added: creation order, reverse, sorted, and 300 orders by an FNV hash of the name with different seeds. The
  last of these models ext4, whose htree hash order uses a per-file-system seed and also applies to one-block directories. With the new
  predicate, 259 orders stop (by n = 17 in 75; the largest stop is n = 199). **44 of the 300 seeded orders reach 200 and throw `ERROR: no
  filler count up to 200 ...`.** The old predicate stopped at 17 in 223 of the 303, with only `libz` pairs differing: a vacuous pass. So
  10bafc70 turns a silent hole into a loud failure, which is the right direction. The lane's review found every order stopping by n = 38
  because its shuffles were redrawn at each count, which a real directory does not do. APFS is unaffected (no seed; the root host stops at
  17, below), and the gate runs only there (AGENTS §5). It would matter in the Linux VM of later milestones. Possible fix: when counts run
  out, vary the filler names too (another prefix or length), or loop over filler sets rather than counts. Not blocking.
- **N2 (nit, wording; read only): `PORTING.md:42-44`. The new sentence lists "panic" among the effects a movable read must not have, but
  the read it was written for can panic.** `current_user_relevant_span` reaches `Body::source_info`'s `assert_eq!` and `terminator()`'s
  `expect` (perf-miri review §1). Read strictly ("cannot panic"), the rule excludes `ae95bbec`, its own precedent. Read loosely ("does not
  panic in the oracle"), a lane can argue that any read whose panics "cannot happen upstream" qualifies. Neither reading lets in a read
  with a real effect: cache fill, lazy value, query, backtrace and log are named, and "no side effect at all" covers writes. Two gaps
  remain at the edges. Interning is not named, though it moves interner counts that `RUSTC_LOG` cases print; "cache fill" arguably covers
  it. An `unported(...)` stop is not named either: moving a read that can reach `unported` past the return turns an UNPORTED into a
  status that never ran the stop. Suggested wording: "...no cache fill or interning, lazy value, query, backtrace or log, and no panic or
  `unported` stop except on a broken upstream invariant (a port bug)...". With that, it cannot be stretched to a read with an effect.
- **N3 (nit, bookkeeping; read only): `docs/next.md:517-526`. Seven queued lines are now false on `integ-w45`: the merged lanes closed
  them.** Root's edits in this wave are accurate (see below). But these older lines still say "open" or "no test fails":
  - `:517` "Still open: `-Zprint-type-sizes` at those sizes" (fixers-49 item 2; ties stop `unported`, queued as review N1);
  - `:518` root-w44-check N1 (harness-w46);
  - `:522` perf-tait N2, N3 "no test fails" and "`element_slice_eq`'s length check ... unpinned" (fixers-49 item 3; its review §mutants: 1
    fail each);
  - `:523` harness-w45 review N1 and N6 (harness-w46);
  - `:524` the three cycles and the missing `// crate:` markers (fixers-49 items 1, 4);
  - `:525` "Still open: N5, ... `.rlib` files beside tests" (harness-w46, and root's 67916936);
  - `:526` fixers-47 O3 and "the proposed `rlib-native` report suite" (fixers-49 item 5, harness-w46). O1 is correctly still open.

  Root marked such lines "(Done in wave ...)" in its close-the-check commits in earlier waves (`4021d1a0`, `680cc49e`), so this is
  probably just pending. Listed here so none is missed.

## Root's commits

**10bafc70 (E0464 sort test).**
- The rule is right. `FileSearch::new` (`filesearch.ts:66-95`) sorts every `lib*` name of the `-L` paths and the target lib dir by file
  name alone. The test's `empty_sysroot` has no target libraries, and the Linux target's prefixes are all `lib`, so the helper sorts the
  same list. E0464's candidates differ between ipnsort and a stable sort only when a `libfoo-*` pair does. Filtering both sorted lists to
  `libfoo` entries and comparing them by position is exactly that, since `a` and `b` never tie.
- Kills the stable-sort mutant, reproduced. I replaced the sort with `files.sort(...)` (stable) and ran the file: 35 pass, 1 fail, on
  `-L of one directory twice, once through a symlink (E0464)` with `candidate #1: d_dup_link/libfoo-a.rmeta` against the oracle's
  `./d_dup/libfoo-a.rmeta`. Restored. Unmutated: 36 pass, 0 fail, and `d_dup` holds 17 `libz` fillers, so APFS stops at once.
- Bounded: an `ERROR` past 200. Each step is one `readdir` of two names for one directory and a sort of at most about 400 entries. See N1
  for the file systems where the bound is reached.
- The decision record (history.jsonl, 2026-11-09T07:53) is accurate. `git diff main..integ-w45 -- harness/scope.json` is exactly the two
  entries. Upstream's `Cargo.lock` at the pin has one entry each: memmap2 0.2.3 (line 2483) and tempfile 3.23.0 (line 5638).
  `ar_archive_writer` (`=0.5.3`) was recorded by root the same way (`c62ed969`).

**67916936 (`.gitignore`).** I took `git status --short --ignored` before and after a run of `check.oracle.test.ts` and
`compare_impl_item.oracle.test.ts` (59 pass, 0 fail). There was no difference: only `.env.local` and `node_modules`, both mine. No `.rlib`
is under `src/`. Both tests write their oracle `.rlib` files to a scratch `OUT_DIR` and assert they are there (`check.oracle.test.ts:84`,
`compare_impl_item.oracle.test.ts:106`).

**51d6ca81 (PORTING).** Covered by N2. "Counts too" places the move under the PORT(perf) sentence before it, so the comment, measured
gain, "cannot show in any output" and adversarial review still apply. The added test requirement ("fails if the read is dropped") is met
by `data_race.test.ts` (perf-miri review §2).

**`docs/next.md` edits (10bafc70, 67916936, 51d6ca81).** I checked each added line against its review:
- fixers-49 N1, N3, N5, O1: `code_stats.ts:157-165` is the tie stop.
- harness-w46 N1-N3: `rlib-native-run.ts:157` is the compiler spawn.
- perf-miri N3, N2: `harness/suites.ts:1547` is the `run-pass-miri-heavy` comment. The figures 4.1-4.2 s oracle and 36-37 s alone match
  the handoff (36.2-37.9 s alone).
- The three status cells: fixers-49 "root closed N2" is 10bafc70. perf-miri's 2.1% and 8-9x match the handoff.

None of them is false. N3 covers older lines.

## Merges

For each lane's final commit (`be37c102` fixers-49, `6b626e38` its review, `90045ea7` harness-w46, `6a489ed1` its review, `750a5e20`
perf-miri with its review), I compared every file the lane changed from `74f215e6` with `integ-w45`.
- The only difference is `locator.oracle.test.ts`. Its diff from `be37c102` is exactly 10bafc70's.
- No file is touched by two lanes. fixers-49 and harness-w46 touch different tests and different scripts.
- Every file in `git diff --name-only main..integ-w45` (73) belongs to a lane or a root commit, and every such file is in that diff.
- `git show --cc` is empty for all five merges, so none carries its own resolution.

Nothing was dropped or altered.

## Whole branch

- `git diff main..integ-w45 -- harness/baseline`: empty.
- `harness/scope.json`: only the two vendor entries.
- Suites: I loaded `harness/suites.ts` from `integ-w45` and from a `git archive` of `main`. For each suite I compared the case count and
  hash (id, file, args, env), `oracleKey()`, and the oracle command for the first three cases, with the repo path normalized. All 60
  protected suites (`harness/baseline/*.txt`) are identical. The only differences: `miri-sysroot-core`, `-alloc` and `-std` changed
  `oracleKey()` (cases unchanged), and `rlib-native` is new (58 cases). All four are report suites.
- `bunx tsc --noEmit -p .`: exit 0.
- `bun test ./scripts ./harness`: 424 pass, 0 fail (42 files).
- `bun scripts/frozen-lists.ts`: 48/48 protected cases of mir, mir-o2 and check-ui MATCH, with 4 near-limit TAIT cases left out (run
  `frozen-lists-20261109-083513-root-w45-check-x750`).
- `bun src/rust_ts/info_sites_check.ts`: exit 0 (136 sites, 3 skipped; 83 in ported fns, 18 in fns not ported).
- Samples of 100 (`RUST_TS_AGENT=root-w45-check`):

| suite | result | run |
|---|---|---|
| mir | 100 MATCH (1 skipped) | `20261109-083538-root-w45-check-kjgu` |
| check-ui | 100 MATCH | `20261109-083552-root-w45-check-53j4` |
| rmeta-ui | 100 MATCH | `20261109-083605-root-w45-check-7u9b` |
| mono-ui | 100 MATCH (488 skipped) | `20261109-083618-root-w45-check-le48` |
| run-pass-miri | 100 MATCH (497 skipped) | `20261109-083644-root-w45-check-e7bt` |

## Not checked

- The lanes' code beyond the merge comparison: their reviews cover it. That includes `ae95bbec`'s faithfulness and fixers-49's
  `code_stats.ts` port.
- N1 on a real ext4 or other hashed file system: I simulated it, I did not run it.
- The full `bun test ./src ./tools` unit step, the gate, and every full suite.
- Report suites' results, including the new `rlib-native`.
- Windows.
