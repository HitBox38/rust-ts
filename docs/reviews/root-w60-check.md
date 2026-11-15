verdict: APPROVE WITH NITS

Independent check of root's wave 40t integration (`root-w60-check`). Subject: branch `integ-w60` at `b438218e`, root's own commits
`864a37a1` (the `yield1.rs` withdrawal, test timeouts, `write.ts` comments) and `6d23a76a` (18 LLVM pins, `coverage.test.ts`), and the
harness-m7d auto-merges into `harness/suites.ts` and `harness/m7-suites.test.ts`. The merged lanes (pm-self, fixers-60, rg-fix-a,
llir-callbr-mangler, harness-m7d) were reviewed already and are not re-reviewed here. I am read-only: this file is all I wrote to the tree.
Line numbers are at `b438218e`. AC power throughout, no `GATE_RUNNING`, `--jobs 6` at most, `RUST_TS_AGENT=root-w60-check-r1`,
`RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`, Bun 1.4.4. My scripts and outputs are in this session's scratch directory.

**The `yield1.rs` withdrawal is a sound withdrawal of a nondeterministic case, and it is the only baseline change.** The race is real: I
saw it flip with the oracle's own binary, 2 in 1,500 runs at load 70 and 16 in 3,200 with 8 copies running at once. Both edits are
needed together, because the gate refuses a baseline that protects a listed-unstable case. Everything else checks out. The pins equal fresh
downloads, the stop text is pinned by no test and needs `-C incremental` to reach, and every command passes.

**The main finding is that three more protected `run-pass-native` cases have the same race, and all three flipped when I ran them (N1).**
That is outside this commit's scope, as the decision limited the withdrawal to one case, so it does not block. Root should decide on them
before the next gate, though: `task-comm-0.rs` flipped about 2% of the time, roughly four times as often as `yield1.rs`.

## Findings

| # | Severity | Finding | Where |
|---|---|---|---|
| N1 | **medium** | **Three more protected `run-pass-native` cases print from two threads with nothing ordering the lines, and each one flipped in my runs.** I built each with the oracle rustc and ran it 1,500 times at load about 70, then 3,200 times as 8 parallel loops of 400 (load about 10 to 40). Any reordering would be a DIFF, so a lost protected case and a failed gate (see §1.3). **`tests/ui/threads-sendsync/task-comm-0.rs`:** the child prints `sent N` after each `send`, while `main` prints `N` after each `recv`. It flipped 26 in 1,500 runs, and 70 in 3,200, about 2.2% (`sent 10 10 20 sent 20 sent 30 30`, `10 sent 10 …`, …). **`tests/ui/threads-sendsync/comm.rs`:** the child prints `value sent` after its `send`, while `main` prints `received` after its `recv`. It flipped 0 in 1,500 runs, then 8 in 3,200 (`sending received 10 value sent`). **`tests/ui/threads-sendsync/unwind-resource.rs`:** `main` prints `hiiiiiiiii` right after `spawn`, while the child prints `Hello!`, which is yield1's exact shape. It flipped 1 in 1,500 runs, then 8 in 3,200 (`Hello! hiiiiiiiii …`). For comparison, `yield1.rs` flipped 2 in 1,500, then 16 in 3,200. **How I found them:** I scanned every protected case of both native suites whose source spawns a thread or process and prints: 58 of them. I read each one that has threads. All the others join before the other side prints, or print from one thread only (`spawn2`, `task-comm-9/10/12/13`, `threads`, `issue-29488`, `hashmap-memory`, `test-thread-*capture`, …), or print what a captured child wrote in fixed order (`atomic-print`, `stdout-stderr-separation`, `println-with-broken-pipe`, …). `run-fail-native` has none. **Recommendation:** decide whether to withdraw these three as `yield1.rs` was, in one root commit with the same two edits and an independent check, before the next gate. This check changes nothing. | `harness/baseline/run-pass-native.txt:2966` (comm), `:2992` (task-comm-0), `:3019` (unwind-resource); upstream sources |
| N2 | low | **The `yield1.rs` reason text says "never seen to flip on this host", which is no longer true.** The oracle-built binary flipped 2/1,500 and 16/3,200 (N1). The rest of the text is accurate (§1.2). `nativeOracleKey` does not hash `harness/suites.ts` (`suites.ts:2436`), so correcting the text does not re-key any oracle entry. **Recommendation:** next time `harness/` is touched, change it to "seen 16 in 3,200 runs under load (review root-w60-check)". | `harness/suites.ts:2680` |
| N3 | info | **w40r-audit N2's scan of the protected thread cases was wrong in its conclusion.** It reads: "Each joins the thread before the other side prints, or prints from one thread only." That does not hold for the three cases in N1. That audit's other evidence, for `yield1.rs` itself, stands. Worth knowing when that audit is cited as proof that nothing else is racy. | `docs/reviews/w40r-audit.md:64` |
| N4 | info | **This is the first time a protected case has left a baseline** (`history.jsonl` has no earlier withdrawal). AGENTS.md §2 has no procedure for it. The two decisions (history:715, :721) plus this check now serve as the precedent: list the case, remove it from the baseline in the same commit, and get an independent check. If N1 leads to more withdrawals, AGENTS.md §2 could say so in one line. | `AGENTS.md` §2; `docs/state/history.jsonl:715,721` |

## 1. The `yield1.rs` withdrawal (`864a37a1`)

### 1.1 The race is real

`tests/ui/threads-sendsync/yield1.rs` (upstream, at the pin):

```rust
pub fn main() {
    let mut result = thread::spawn(child);
    println!("1");
    thread::yield_now();
    result.join();
}
fn child() { println!("2"); }
```

Nothing orders `main`'s `println!("1")` against the child's `println!("2")`. `yield_now` is only a hint, and it comes after `main`'s print
anyway. std's stdout is a `LineWriter` behind a reentrant lock, so each line comes out whole, but their order is up to the scheduler.
**Measured** with `rustc +nightly` (1.101.0-nightly 6f5da406b, the oracle) building the upstream file, output through a pipe as native-run
captures it:

| Program | 1,500 runs, load 70 | 8 × 400 runs in parallel |
|---|---|---|
| `yield1.rs` | 1498 `1 2`, **2 `2 1`** | 3184 `1 2`, **16 `2 1`** |
| `yield.rs` (listed since harness-m7b) | 348 of 1,500 differ from `1 2 3 4 5 6` | not run |

### 1.2 The reason text is accurate, except one clause (N2)

The listed reason is `INTERLEAVING("`1` (main) and `2` (the spawned thread) come out")` plus a note. The note says `main` prints `1`, the
spawned thread prints `2`, and only `yield_now` comes before the join, "the same race as yield.rs". Each part matches the source above. It
cites w40r-audit N2 and w40s-audit N1 correctly, and gives the right reason: "the gate re-runs only timeouts alone". The one clause that is
out of date is "never seen to flip on this host" (N2).

### 1.3 The premise of the correction holds: a DIFF is final

- native-run runs the subject's program once (`--runs 1`) and the oracle's twice (`harness/suites.ts:2352`). The oracle's entry is cached.
- Only subject TIMEOUTs are re-run alone (`scripts/difftest.ts:1183-1203`, `SUBJECT_TIMEOUT_RETRY_CAP`).
- The oracle is re-run on a DIFF only for split runs (`scripts/difftest.ts:895-935`). Native cases are single-case runs. And even a re-run
  that reproduced `1\n2` would leave a subject's `2\n1` as a DIFF.

So a flipped subject run would make the case `lost` and fail the gate, as w40s-audit N1 says. The first decision (history:715) assumed a
retry that does not exist, and the correction (history:721) is right.

### 1.4 Both edits are needed together, and the gate enforces it

`scripts/gate.ts:704-709`: at the start of a run, `protectedUnstable(suite)` (`:180-183`) lists the protected ids that `Suite.unstable`
lists. If there are any, the run prints `ERROR:` and fails (`unstableOk` false, `pass` false, `:792`). `accept` refuses to add one too
(`:950-951`). **Checked by calling it:**

- `protectedUnstable("run-pass-native", <baseline at b438218e>)` is `[]` (3,388 ids).
- The same baseline with `yield1.rs` added gives `["tests/ui/threads-sendsync/yield1.rs"]` (3,389 ids).
- `run-fail-native` gives `[]`.

So listing the case without removing it would fail every gate. Removing it without listing it would let the next accept protect it again.

### 1.5 It is the only baseline change

`git diff 3441349c b438218e -- harness/baseline` (`3441349c` is the merge base with `main`) is exactly one line:
`-tests/ui/threads-sendsync/yield1.rs`. `run-pass-native.txt` has 3,388 lines. `main` has not touched `harness/`, `scripts/` or `src/` since
that merge base: only `docs/state/*` and a review file. No suite definition, oracle output or runner was changed to make a result pass. The
`harness/suites.ts` change is the one entry in `NATIVE_UNSTABLE`.

**Soundness against AGENTS.md §2.** The edit does not make a failing result pass: `yield1.rs` was MATCH in both gates since the audit
(w40s-audit N1). It removes a case whose oracle output is not reproducible, and the gate's own rule says such a case can never be protected
(`gate.ts:53-54`). It follows two recorded decisions and two audits, sits in one commit, and has this independent check. Criteria are not
affected: M7c `run-pass-native` excludes UNSTABLE (`scripts/criteria.ts:64`), so the figure goes from 3,389/3,396 to 3,388/3,395, still
99.79%.

**The difftest agrees:** `--filter threads-sendsync/yield` at `b438218e` reports `yield.rs` and `yield1.rs` UNSTABLE, with the listed
reasons, and `yield2.rs` MATCH.

## 2. The harness-m7d auto-merges

- `git diff 864a37a1 b438218e -- harness/suites.ts` adds harness-m7d's suites and changes nothing in `NATIVE_UNSTABLE` or the native suites.
  `yield1.rs` is still listed (`harness/suites.ts:2680`).
- `harness/m7-suites.test.ts`: harness-m7d added four lines (native-hello's protected set, and non-empty native and IR baselines) next to,
  not over, root's change. The counts read `{ "run-pass-native": 19, "run-fail-native": 7 }` and `[19, 7]` (`:275-276`), with the comment at
  `:274`. That is right: run-pass-native lists 19 entries, run-fail-native 7.
- `bun test ./harness/`: **90 pass, 0 fail** (13 files).

## 3. The LLVM pins (`6d23a76a`)

- **Fresh fetch:** I downloaded each of the 18 added paths from `raw.githubusercontent.com/rust-lang/llvm-project/<commit>` into an empty
  scratch directory. The commit is `aab11ee0ea5ea9a1d462ad0bc1fae9d9bb643019`, the manifest's `commit`, and it equals the rust checkout's
  `src/llvm-project` gitlink (`git ls-tree`). All **18 SHA-256s equal the manifest's**. The copies under `$RUST_TS_DATA/llvm-src/<commit>/`
  equal them too.
- **The lane's patch:** the `+` lines of `docs/handoff/llir-callbr-mangler/llvm-pins.patch` are the same 18 path/hash pairs as the manifest's
  additions (`diff` empty).
- `bun scripts/llvm-src.ts check`: `llvm-src ok: 134 files at aab11ee0ea5e (the checkout's gitlink)`.
- `bun scripts/coverage.ts --check`: `markers ok (27358, 103 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5392; library 745; llvm 676)`,
  exit 0.
- The `scripts/coverage.test.ts` example now uses `LLVMWrapper.h` (0/4 ported: `write_impl`, `current_pos`, the constructor and destructor),
  and it passes in `bun test ./scripts/`.

## 4. The `back/write.ts` stop text and comments

- **No test pins the old text.** `git grep 'rustc_fs_util link_or_copy'` and `'link_or_copy, WorkProduct'` outside `docs/` find nothing. The
  new text appears only at `src/rustc_codegen_ssa/back/write.ts:1142`.
- **Unreachable without `-C incremental`.** `execute_copy_from_cache_work_item` (`write.ts:1126`) runs only for a `CopyPostLtoArtifacts`
  work item (`:2044`, `:2087`). Those come from two places:
  - `submit_post_lto_module_to_llvm` (`:2380`), called only for `CguReuse::PostLto` (`base.ts:975-980`). `determine_cgu_reuse` returns `"No"`
    whenever the dep graph is not fully enabled (`base.ts:1321-1324`), and it never is (no dep graph, plan-m3 D12).
  - thin LTO's `copy_jobs` (`write.ts:655-660`), filled only when `prev_key_map` is set and a module is green
    (`rustc_codegen_llvm/back/lto.ts:520-529`). That needs the incremental session dirs, which the code asserts.
- **The new wording is accurate.** `link_or_copy` is ported, with tests (`src/rustc_fs_util/lib.ts`, `lib.test.ts`, lane rg-fix-a). The
  `submit_pre_lto_module_to_llvm` comment (`write.ts:2387-2390`) still names rustc_incremental as the unported part, which is right.
- The two 120 s timeouts (`link_with_args.oracle.test.ts:360`, `rpath.oracle.test.ts:66`) match review fixers-60 N1. `back/`'s tests pass.

## 5. Commands

| Command | Result |
|---|---|
| `bunx tsc` | exit 0, no output |
| `bun scripts/coverage.ts --check` | `markers ok (27358 …; llvm 676)`, exit 0 |
| `bun test ./harness/` | 90 pass, 0 fail |
| `bun test ./scripts/` | 504 pass, 0 fail (43 files) |
| `bun test ./tools/` | 84 pass, 0 fail (19 files) |
| `bun test ./src/rustc_codegen_ssa/back/` | 114 pass, 0 fail (20 files) |
| `difftest --suite run-pass-native --sample 200 --jobs 6` | MATCH 198, UNPORTED 1 (`lto/all-crates.rs`, unprotected), UNSTABLE 1 (`equal-pointers-unequal/exposed-provenance/segfault.rs`, listed); **198 protected rows, all MATCH**; DIFF 0 |
| `difftest --suite ir-run-pass --sample 200 --jobs 6` | MATCH 196, UNPORTED 4 (`lto/all-crates.rs`, three `sanitizer/cfi`, unprotected); **196 protected, all MATCH**; DIFF 0 |
| `difftest --suite pm-ui --sample 200 --jobs 6` | MATCH 200/200; **200 protected, all MATCH** |
| `difftest --suite mono-ui --sample 200 --jobs 6` | MATCH 200/200; **200 protected, all MATCH** |
| `difftest --suite pm-self --sample 30` | MATCH 30/30 (no baseline yet) |
| `difftest --suite run-pass-native --filter threads-sendsync/yield` | `yield.rs`, `yield1.rs` UNSTABLE (listed); `yield2.rs` MATCH |

No protected case left MATCH in any sample. `yield1.rs` did not fall in the 200-case sample, so I ran it by filter (last row). Run
directories: `$RUST_TS_DATA/runs/root-w60-check-*`.
