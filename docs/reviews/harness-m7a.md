verdict: REQUEST CHANGES

Batch: lane `harness-m7a`, branch `t3/m7-harness-ir-suites`, head `03427ddb` (own commits, on `integ-w39` at `d1bb28f3`). Handoff: `docs/handoff/harness-m7a.md`.
I am read-only on the lane: this file is all I wrote to the tree. Line numbers are at `03427ddb`. Load was 8-53, shared with other lanes. My scripts and tables are in `$RUST_TS_DATA/tmp/review-harness-m7a/`. Runs went to a private data root, a copy-on-write clone of the upstream checkout, removed afterwards. The shared checkout is unchanged (`git status --ignored`: `!! build/`). I also deleted one leftover of the lane's in shared data, `$RUST_TS_DATA/tmp/mono-ui-discard.ll`, the file H1 is about, which nothing reads.

**The main risk came out well.** N1 and N2 absorbed no semantic mutation out of 162 kinds on real oracle IR. The `check-rg` suites compare what they say and fail when a difference is planted. `upstream.ts fetch` is safe and changes nothing.

**What must change is `mono-ui`, H1.** Its shared `-o` makes the oracle itself wrong on 52 of 3,479 cases at the gate's concurrency: 98.5% with a perfect port, under the 99% gate M7a sets. A wrong entry stays cached. The fix is one line and I tested it. H2 is one more line. Everything else can follow, with H3 due in `harness-m7b`.

H-numbers are this review's findings. F-numbers are `docs/reviews/plan-m7.md`'s.

| # | Severity | Where | Finding |
|---|---|---|---|
| H1 | **HIGH, blocking** | `harness/suites.ts:2099`, `:2176` | `mono-ui`'s `-o` to one shared file: oracle failures that stay cached, false warnings, and multi-CGU programs forced to one CGU |
| H2 | MEDIUM, blocking | `harness/suites.ts:2128` | `rgOracleKey` omits `scripts/lib/rg-check.ts`, where the environment and output format live |
| H3 | MEDIUM, due in `harness-m7b` | `harness/suites.ts:2114`, `scripts/lib/ir-normal.ts:40-42` | F1's tier rule is a comment; nothing records or limits which tier a suite is read at |
| H4 | MEDIUM | `docs/handoff/harness-m7a.md` §3 | "Up to 9%" understates N3: 33-85% of single sites absorbed for kinds the lane did not try |
| H5 | LOW, due in `harness-m7b` | `scripts/ir-run.ts:92` | The handoff's "unchecked" is real: `-Csplit-debuginfo` puts the side and pid in the IR |
| H6 | LOW | `scripts/lib/rg-check.ts:116` | The fix for HEAD is complete only if `GIT_DIR` is unset; `RUSTFLAGS`, `RUSTC_WRAPPER` and ancestor cargo config also reach cargo |
| H7 | LOW | `scripts/lib/common.ts:70`, `scripts/difftest.ts:911` | With no `.env.local`, difftest's `ERROR:` gives the wrong remedy |
| H8 | LOW | `scripts/lib/llvm-tools.ts`, `harness/suites.ts:2110` | The pinned hashes are trust on first use, and only a unit test reads them |
| H9 | LOW | `harness/compiletest.ts:1273` | `mir-opt-o4`: "always level 4" is false for 53 of 406 |
| H10 | LOW | `scripts/lib/ir-normal.ts:14-18` | N1's list omits the parser's auto-upgrades, and "a missing `!guid`" is not always absorbed |
| N1-N3 | nit | below | Handoff figures, a misleading message, an untested check |

## 1. Normal form: can it hide a real miscompile?

**N1 and N2: not with anything I could construct.** I wrote my own mutators (`my-mut.ts`), not the lane's, and ran them through the lane's `normalForm`. Two sets:

- A fixture I wrote to reach every construct you listed (`fix.rs`), at `-O`, `-Copt-level=0` and `-O -Cdebuginfo=1`.
- 55 real programs: a sample of `mir-o2`'s cases by my own seed, each under 6,000 lines (59 built of 60; 4 too large to mutate cheaply).

That is 162 mutation kinds and 57,142 sites. Each was applied whole and to sampled single sites, at each tier.

| Mutation | N1 | N2 | N3, whole | N3, one site |
|---|---|---|---|---|
| `!range` dropped, or its node's bounds changed | caught | caught | caught, 1 of 16 programs absorbed | 13% absorbed when dropped |
| `!nonnull` dropped or added | caught | caught | caught | 2-3% absorbed |
| `!noundef` dropped | caught | caught | caught | 10% |
| `!noundef` added | caught | caught | caught | **49%** |
| `!align` dropped or changed | caught | caught | caught, 1 of 15 absorbed | 13% when dropped |
| `dereferenceable(N)`, on define and on call | caught | caught | caught | caught |
| `sret` type on define and call, `sret` dropped on call | caught | caught | caught | caught |
| Call attrs: `noundef` on an arg, a call-site group, `tail`, `zeroext` to `signext`, `range()`, `align` | caught | caught | caught | caught |
| `fast` dropped or to `nsz`, `nsz` added, algebraic flags dropped, `fcmp` predicate | caught | caught | caught | caught |
| `volatile` dropped or added, on load and store | caught | caught | caught | caught |
| Atomic orderings, `cmpxchg` failure order and `weak`, `atomicrmw` op, fence, `atomic` dropped | caught, or a verifier error | same | same | same |
| `landingpad`: cleanup, catch and filter clauses | caught | caught | caught | caught |
| Personality removed or re-pointed | error or caught | same | same | same |
| `invoke` normal and unwind targets, invoke made `nounwind`, `resume` | caught, or a verifier error | same | same | same |
| Switch: case value, two targets swapped, two cases reordered, default target | caught | caught | caught | caught |
| Phi: values swapped, pairs reordered, a wrong input (rustc wrote no phi in 55 programs, so a synthetic function) | caught | caught | caught | - |
| Block order, `br` targets swapped | caught | caught | caught | caught |
| Globals: linkage, `dso_local`, visibility, `unnamed_addr`, `section`, alignment, `constant`, initializer, `llvm.used` | caught | caught | caught | caught |
| `thread_local` dropped | verifier error | same | same | - |
| Datalayout (6 edits, including `-i128:128` and `-p270...`, which bitcode upgrades), triple (3) | caught | caught | caught | - |
| `source_filename`, `llvm.ident`, `module asm`, a module flag's value, a flag removed or added | caught | caught | caught | caught |
| Inline asm: template, constraint, `sideeffect`, `alignstack`, `inteldialect`, clobbers, `nomem` attrs, `!srcloc` | caught | caught | caught | caught |
| `add nuw` dropped | caught | caught | caught, 1 of 12 absorbed | **38%** |
| `icmp samesign` added | caught | caught | caught, 4 of 29 absorbed | **33%** |
| Alloca size or alignment wrong | caught | caught | caught | **43%** |
| `assume` call deleted | caught | caught | caught, 8 of 22 absorbed | **85%** |
| `inbounds` dropped on a GEP | caught | caught | caught | 16% |
| `load` align 8 to 1 | caught | caught | caught | 9% |

The bitcode path (N2, N3) gave up nothing beyond names on any mutation. The input's target lines work as the handoff says.

**N1's absorptions, one at a time:**

| Absorbed | Pushed with | Can it hide a difference in behaviour? |
|---|---|---|
| Default alignments | `load`/`store` `i64`/`ptr` with no `align` | **No.** The parser fills in the default from the module's datalayout, which is itself compared, so the module is the same. Omitting a **non-default** one stays visible: `alloca [N x i8]` (395 sites) and globals (74 sites) are caught |
| Intrinsic declaration attributes | Group dropped, `noalias noundef` added, `noreturn` on all | **No.** The parser replaces them, for every reader of text, and D1's pipeline reads text. **Call sites stay visible:** `noalias` on a `memcpy` arg, its `align`, length and volatile flag are all caught (163 sites) |
| Unused nodes | An attribute group, a real-looking `!range`, a struct type | **No.** Nothing refers to them. A use re-pointed at an identical node is the same node. An unused **declaration** or **global** stays visible |
| A missing `!guid` | Removed everywhere, one at a time, swapped, wrong | **No.** `assign-guid` recomputes it from name, linkage and `source_filename`, all compared. Wrong or swapped is caught. But see H10: on one program removal is *not* absorbed. That is a false difference, never a hidden one |

Two more absorptions the header does not list, also harmless, in H10: `PIC Level`/`PIE Level` behaviour and `nocapture` spelling. In each case both spellings parse to one module, so nothing downstream of the text can tell them apart.

**What this rests on.** N1 equal means "these two texts parse to one module, up to `!guid`". It is the right statement only because the port's pipeline reads text. The oracle's in-memory module can differ from its own text (the attributes on intrinsic declarations are one case). That is D2's business, not this lane's.

**N3:** see H4. **What decides the tier, and whether N3 can be used silently:** see H3.

## 2. `time.rs`

**Reproduced.** My dump (`dump.ts`, not the lane's) on `b74a0659` against `03427ddb`:

- `miri-pass` 353 to 352, `miri-pass-heavy` 7 to 8: the one case, with its argv, env and cwd hash unchanged, and one new skip line.
- It is in no baseline (`grep -rl shims/time.rs harness/baseline`: nothing). `harness/baseline/miri-pass.txt` holds `time-with-isolation.rs`, whose oracle key is unchanged. No baseline file changes in the lane.
- M6's figures cannot move for this reason: `scripts/criteria.ts:22` reads the two suites as one group. On gate `gate-20261104-143144-root-lpo8` the lane's `criteria.ts` prints 3473/3478, 294/294 and 337/360, all met.

**One correction: the oracle key is not unchanged.** `oracleCacheKey` includes the suite's name (`scripts/difftest.ts:356`), so this one case goes from `92d931df...` to `cf36e942...`. It is one oracle re-run of about 2 s and harmless, but the entry is new.

The A12 amendment is in `docs/plan-m6.md`, gives the reason (a property of the program), and keeps the program's own bound. Agreed.

## 3. Existing suites, keys and `upstream.ts fetch`

- **Case lists:** all 58 existing suites, 364,386 cases: the `time.rs` move and nothing else. Each case's argv, env and cwd compared by hash.
- **Skip reasons:** 58 reworded (52 `run-pass-aux-miri`, 2 `borrowck-ui-report`, one each `mirdump-ui`, `thir-tree`, `thirdump-ui`, `tydump-ui`), from "deferred to M6" to what they need. **A reword affects nothing:** the reason is in no key, and its only other readers print it (`scripts/gate.ts:371`, `scripts/miri-diff.ts:77`). The reason's "proposed" is out of date now that root has decided (2026-11-05T04:39), a nit.
- **Oracle keys:** 3,852 sampled by my own hash, 0 differ between base and head, whose `UPSTREAM.json` differs. The key takes `PIN.commit`, never the sparse list.
- **No `tests/ui` path reads the new directories:** `git grep` finds two comments and no path.

### What `bun scripts/upstream.ts fetch` does on the root checkout

I ran it on a copy-on-write clone of the shared checkout, with a private `RUST_TS_DATA`. Four git commands (`scripts/upstream.ts:21-25`), the clone being skipped as it exists:

1. `git sparse-checkout set <the 9 paths>`: adds `tests/codegen-llvm` and `tests/mir-opt`.
2. `git fetch --depth 1 --filter=blob:none origin <pin>`: already there. It needs the network. Offline it stops with one `ERROR:` after step 1, leaving a valid checkout, and can be rerun.
3. `git checkout --quiet <pin>`: no change.
4. `git submodule update --init --depth 1 -- library/backtrace`: no change.

**Measured:** 6.7 s. 2,625 files added (1,748 and 877, 11.7 MB). **0 removed, 0 modified, 0 mtimes changed** across the 44,247 existing files. `HEAD` and `.git/shallow` the same. `git status --ignored` still `!! build/`. Object count unchanged: the blobs are already in the pack.

**On the private checkout's aux directories: the lane is right and it does not matter for root.** `auxKey` hashes each step's argv, which holds absolute paths, so a *different* checkout path gives other aux directories and 191 of the 3,852 sampled keys differ. That is what a private clone shows. **The test that applies to root is the same path before and after**, which I ran: every suite dumped before and after the fetch at one fixed path, **736,520 lines, 0 differ**, the same 3,852 sampled keys included.

**So on root: nothing rebuilds, no oracle entry and no aux directory changes. Safe with no gate running.** Merge first. A later `upstream.ts fetch` from a branch that predates this `UPSTREAM.json` would narrow the sparse list and remove both directories; `mir-opt-o4` then stops with its one `ERROR:`.

## 4. `check-rg`, `check-rg-encode-mir`, `check-rg-host`

**Do they compare what they say? Yes.**

- **Raw diff, not through the harness:** `diff -rq` of the lane's kept oracle and subject trees, all three suites: identical, apart from the two files `treeLine` leaves out and says so. `rg.mir` is byte-identical in each (2,401,459, 6,925,450 and 2,394,496 bytes).
- **One absolute target path, nothing normalised:** read in `scripts/rg-check.ts`, and confirmed by the identical trees.
- **`rg`'s MIR is compared,** and `-Zalways-encode-mir` does encode: `regex_syntax`'s rmeta goes from 4,214,183 to 6,315,965 bytes.
- **Fresh run:** `check-rg-host` **36/36**, on a different data root that is itself inside a git repository, 445 s user, 3.2 GB.

**Planted differences, in a scratch copy of the port. Each fails exactly where it should:**

| Planted | Result |
|---|---|
| One byte appended to `lexopt`'s `.rmeta` | DIFF `lexopt`, DIFF the run's case, DIFF `rg`: it then stops reading that metadata (exit 70), reported as DIFF with its stop |
| One extra stderr line from `walkdir` | DIFF `walkdir` |
| One extra line in `rg`'s MIR | DIFF `rg`, line 6 of its section: `2401459` against `2401482` bytes |
| A comment added to one `.d` file | DIFF the run's case, by the tree hash, and no crate |

**`GIT_CEILING_DIRECTORIES`:** with `$RUST_TS_DATA` in a repository, the build reports `output from git rev-parse is empty` and the suites match. Complete for discovery, but `GIT_DIR` beats it: H6.

**Anything else sensitive to where `$RUST_TS_DATA` sits:** absolute paths are in the rmetas and `.d` files, and both sides share them. The case's key holds no path, so moving `$RUST_TS_DATA` **with** its oracle cache gives false DIFFs, loud, healed by the re-run. It does not hide anything.

**Build scripts go to the oracle: stated** in each suite's description, `scripts/rg-rustc.ts`'s header, and pinned by a test. Accurate as worded: the 10 `Compiling` lines are build scripts, and ripgrep's graph has no proc macro, so nothing else takes that route.

**What is not tested:** the port compiling a build script or any linked output; proc macros in a real crate graph; running `rg`; `.rustc_info.json`, excluded by design, though what it answers steers the build, and that is in the hash. A port stop is a DIFF rather than UNPORTED, as stated: `difftest`'s stop buckets will not list it.

## 5. `mono-ui`'s subject

**`scripts/mono-run.ts` is right.** Tested on a **real merge** of `03427ddb` and `t3/wire-monomorphize-providers` (`8617e37e`). The conflicts have a real resolution, not one side: in `collector_oracle/run.ts` the wire side's hunk is empty, so abi-vtable's `slot` and `walk` stay; in `partitioning.oracle.test.ts`, abi-vtable's empty `STOPS` with the wire side's `results` type. `tsc` is clean, 67 of `partitioning.oracle.test.ts` pass, and `wire.test.ts` passes (one test timed out at Bun's own 5 s under load 30; the gate passes `--timeout=60000`, and it passes with that).

| Run on the merge | Result |
|---|---|
| `mono-run`, hello | Exit 0, stdout and stderr byte-identical to the oracle |
| `mono-run`, compile error | Exit 1, stderr identical |
| `mono-run`, warnings | Exit 0, all identical, with the summary |
| `main.ts`, same hello | **Exit 70: never reports success** |
| `mono-run`, `-Cincremental` (another stop) | Exit 70: the catch is that one `Unported` only |
| `mono-run` at `03427ddb`, no wire lane | Exit 70: the older text does not match |
| `mono-ui --sample 120`, my seed | **120/120** |
| `mono-ui --filter '#' --jobs 8`, revisions only | **253/263: all 10 DIFFs are H1** |

If `ssa-base` rewords the stop, the catch stops matching and every case goes UNPORTED: the safe direction. `AFTER_COLLECTION` matches the wire lane's text at `src/rust_ts/codegen_backend.ts:260`.

## 6. `mir-opt-o4`, `dump_dataflow.rs`, `ir-diff`, the `llvm-tools` guard

**`mir-opt-o4` is what F7 asked for,** and the name says so. F7 ran level 4 with each test's flags and pass and called that approximate, so `.diff` comparison was never the ask. Sample of 60 on the private checkout: **60/60**, checkout clean. See H9 for what it leaves out.

**`dump_dataflow.rs` cannot dirty the checkout:** `-Zdump-mir-dir` is last on both sides (`harness/suites.ts`, `mirOptDumpDir`), so it overrides a test's own. After the sample `git status --ignored` is still `!! build/`, with no `mir_dump`. A test pins it on that test's flags. I did not run that one case myself.

**`ir-diff`'s call trace is oracle-only:** stated, and its test uses a fake port. `src/rust_ts/llvm` does not exist yet, so the port half of F1's classification ("model behaviour") is a contract with no result. `scripts/lib/llvm-trace.ts`'s format is the thing `llir-core` must hit.

**`llvm-tools` guard:** no `rustup component add` runs anywhere. The only mention in the lane's code is a test that the error does not say it. `scripts/probes.ts:273` has older advice to run it, in an error message, from 2026-10-13, which is not this lane's and contradicts the agent brief. Paths and hashes are in the handoff and in `scripts/lib/llvm-tools.ts`. How they are derived: H8.

## 7. Queued nits

| Nit | State |
|---|---|
| `integ-w38-recheck` N3, `criteria.ts` requires the protected set | **Fixed.** Read with `git ls-tree` at the gate's own commit. Unit test passes; the real gate above still prints met |
| `integ-w38-recheck` N1, `pid === self` | **Fixed.** A per-process set; a leftover with this pid is still taken over. Unit test passes |
| `harness-w39` N2, stale probe pre-check | **Fixed.** See below |
| `harness-w39` N3, lock's use untested | **Fixed.** Test passes |
| `harness-w39` N4, `sysMs` read as `userMs` | **Fixed.** Test passes |
| `m6-audit` F2, the skip reason | **Fixed** |

**`checkProbes` does not stop a gate wrongly, on what I tried.**

- **Today:** all 38 probes are `unknown` (no stamps, as `harness-w39` A1 says). `checkProbes` over every suite with unit tests returns true.
- **A stale stamp, on a fake data root:** `lex` stops in 0.6 s with one clear `ERROR:` and the build command, before any oracle or suite. A suite that does not use that probe passes without unit tests. With unit tests it stops, correctly, since those use every probe.
- **Worktree independence:** the hash uses paths relative to `tools/probes`, so another worktree at one commit agrees.
- **The cost remains:** the advice, a rebuild, can empty that probe's oracle cache (`harness-w39` A1). That is the rule as it was, now reached in seconds instead of at the end of a gate.

**`.env.local`:** a clear `ERROR:` from the gate, `phase-diff` and `ir-diff`, and from difftest when only the tuple is missing. Wrong remedy from difftest with nothing set: H7.

## 8. Cost

**Unit step (F5):** I measured the six test files alone: 10.9 s wall at load 27 and 6.9 s user+sys, with Bun's start-up and the lock test's older tests in those numbers, so not comparable with the lane's 4.9 s wall and 5.6 s CPU. `./scripts ./harness` together: 273 pass, 24.3 s wall. **It is at the limit, as the lane says.** No action, but with 37 lanes planned nothing is left to spare. A harness lane this size is F11's "split" case, and the unit step's split is still the other option F5 named.

**Out of gate defaults: fine.** They have no baseline, a test pins it, and H1 shows why accepting first needs a clean run. **If each went in**, from the lane's runs and mine:

| Suite | CPU per gate | Wall at 12 jobs, quiet | Peak |
|---|---|---|---|
| `mir-o2` | about 110 min | about 9 min | |
| `mono-ui` | 140-215 min | 12-18 min | |
| `ir-hello` | seconds today, grows at wave 41 | seconds | |
| `mir-opt-o4` | about 14 min | 1-2 min | |
| `check-ui-encode-mir` | about 4 min | 20 s | |
| `check-rg` | 8 min | 2-7 min, one process | 3.3 GB |
| `check-rg-encode-mir` | 11 min | 6 min, one process | 4.8 GB |
| `check-rg-host` | 8 min | 2 min, one process | 3.3 GB |
| **All** | **about 5-6 h** | **about 35-45 min**, on a 10.66 h gate | |

## Findings

### H1. HIGH, blocking: `mono-ui`'s shared `-o` makes the oracle wrong on 52 of 3,479 cases

`MONO_ARGS` (`harness/suites.ts:2099`) gives every case `-o $DATA/tmp/mono-ui-discard.ll`. The comment says one discarded file is fine as it is never read. It is not fine, in three ways:

1. **The oracle fails under concurrency.** rustc writes `<output stem>.<cgu name>.rcgu.ll` beside the output, then copies and removes it. Two runs with one crate name share that temp path, so one fails with `error: could not copy ...`, exit 1. Revisions of one test share a crate name and sit next to each other in the list: 145 adjacent pairs, 341 cases in same-name groups.
2. **`-o` adds an oracle warning the port cannot have.** `warning: ignoring -o because multiple .ll files were produced`, or `--emit=llvm-ir with -o incompatible with -C codegen-units=N`.
3. **`-o` changes what is tested.** It forces those programs to one CGU, so the mono items differ on 10 cases. They are the programs aimed at multiple CGUs: `no-segfault-with-multiple-codegen-units.rs`, `lto-many-codegen-units.rs` and others. `scripts/ir-run.ts`'s own header says this is why it uses `--out-dir`.

**Measured, oracle only, the whole suite at the gate's concurrency (12 jobs, load 25):**

| | Could not copy | `-o` warning | Nonzero exit |
|---|---|---|---|
| As defined | **36** | **16** | 37 |
| Each case with its own `--out-dir` | **0** | **0** | 1 (`randomize.rs#randomize-layout`, in both) |

**Failing scenario.** With a perfect port, `mono-ui` is at most (3,479 - 52) / 3,479 = **98.5%, under M7a's 99%**. The oracle's failure is cached, and `single`-mode suites do not re-run the oracle on a DIFF: I re-ran one at `--jobs 1` and it stayed DIFF on the cached failure. So the 36 stay until the key changes, and differ per machine and load. Reproduced through the real suite: `mono-ui --filter '#' --jobs 8` on the merge gives 253/263, with 10 false DIFFs (5 of each kind).

**Why the lane saw 200/200:** a sample of 200 at `--jobs 3` from the corpus; 3 oracle entries a little apart rarely collide. At this head only 200 of 3,479 entries are cached, none failed.

**Fix, tested:** no `-o`; `--out-dir $DATA/tmp/mono-ui-out/<hash of the id>` per case. On the merge, with that change: the 24 cases of `lto/`, `issue-64655`, `multiple-codegen-units` and `parallel-codegen` are **24/24 MATCH**, so the port handles real multiple CGUs. About 5.8 MB for those 24; the plan's figure for the whole corpus is about 230 MB. `harness/m7-suites.test.ts` pins `MONO_ARGS`' `-o` and needs updating. Nothing is accepted yet, so nothing else moves.

### H2. MEDIUM, blocking: `rgOracleKey` omits the library that defines the output

`harness/suites.ts:2128` hashes `scripts/rg-check.ts` and `scripts/rg-rustc.ts`. `irOracleKey` beside it hashes its library. But `rgCargoEnv`, `mirArgs`, `crateSection`, `treeLine`, `classifyCall` and `unitKey` live in `scripts/lib/rg-check.ts`, which is not hashed.

**Failing scenario.** Change `rgCargoEnv` or `mirArgs`: the key stays, and the next run scores the new subject against the old oracle. Once protected, that is a gate reporting UNSTABLE or lost cases for all 36. It is loud and it heals, as the re-run drops the entry, so it costs a gate rather than hiding anything. **The `GIT_CEILING_DIRECTORIES` fix moved the key only because the same commit also touched `scripts/rg-check.ts`.** Add the file.

### H3. MEDIUM, due in `harness-m7b`, before the first `ir-*` baseline: the tier rule is a comment

**What decides the tier today:** `irRun` (`harness/suites.ts:2114`) passes no `--tier`, so `ir-run.ts` defaults to N1. There is no suite field for it. That is correct for now, as `ir-hello` is the only user.

**Is the rule encoded so N3 can't be used silently? No.** F1's rule is `scripts/lib/ir-normal.ts:40-42`, a comment, plus the review. Nothing checks it:

- `gate.json`, summaries and `docs/state/history.jsonl` do not record a tier. It shows only in the `ir: <file> <tier>` line inside compared output.
- `criteria.ts` has no M7 group.
- "The lost tier stays as a report" has no mechanism.
- At M7b's gate "root records each of `ir-run-pass`'s three tiers": one suite prints one tier, and `--keep` is not for suites.

**Failing scenario.** Under pressure at M7c, `harness-m7b`'s successor adds `"--tier", "N3"` to `irRun`. AGENTS.md section 2 makes that a reviewed batch, so it is not silent to a reviewer. But `gate accept` then protects N3 results with nothing in the record saying so, and N2's bugs stop showing with no report left to read.

**Asked of `harness-m7b`:** a required `Suite.irTier`; a test that fails on anything but N1 without a named decision in `docs/state/`; the tier printed in the summary and in `gate.json`; a report form for lower tiers. Note also that `--tier` is not in the oracle key (`c.args` and `irOracleKey` omit it). Today that fails loudly, as the `ir:` line differs. Put it in the key.

### H4. MEDIUM: "up to 9%" understates N3

The lane's mutators give at most 9% absorbed at one site. On 55 real programs, 3 sites each, kinds the lane did not try:

| Kind | N3 absorbs, one site | Whole mutation absorbed |
|---|---|---|
| `assume` call deleted | **85%** (46/54) | 8 of 22 programs |
| `!noundef` added on a load | **49%** (19/39) | 0 of 14 |
| Alloca size wrong, alloca align wrong | **43%** (71/165 each) | 0 of 55 |
| `add nuw` dropped | **38%** (9/24) | 1 of 12 |
| `icmp samesign` added | **33%** (23/70) | 4 of 29 |
| `inbounds` dropped | 16% (12/74) | 0 of 26 |
| `!range` dropped, `!align` dropped | 13% | 1 of 16, 1 of 15 |
| `zext` becomes `sext` | 7% (3/43) | 0 of 55 |

The reason is what rustc's pre-pass IR looks like: many allocas, loads and compares are dead or fold.

**How to read it, which I think is fair to N3.** What I looked at are dead or fold to one value, which cannot change *this* program. I did not prove that for all of them. The harm is elsewhere: a wrong alloca size on a dead alloca means the port computed a layout wrong, and the same path can be live in the next program. A systematic bug still shows on many programs; a rare one may not. So **N3 at a gate says less than the handoff's table suggests**, and its rule should be taken as "one recorded decision for a much weaker check".

N1's and N2's one-site columns are 100%, apart from the harmless rows of §1. Add the figures to the handoff, or cite this table.

### H5. LOW, due in `harness-m7b`: split debuginfo puts the side and pid into the IR

The handoff marks this unchecked. Oracle against itself through `ir-run.ts`, two `--out` directories:

| Flags | Result |
|---|---|
| None; `-Cdebuginfo=2` on x86_64-linux; `-Cdebuginfo=1` on the host, default and unpacked | Identical |
| x86_64-linux `-Cdebuginfo=2 -Csplit-debuginfo=unpacked`, and `packed` | **Differ:** `splitDebugFilename` holds `<side>-<pid>` (`scripts/ir-run.ts:92`) |

The pid means it would not even reproduce across two oracle runs. No M7a suite has debuginfo. `harness-m7b` needs a fixed path per case, used by both sides one at a time, as `check-rg` does.

### H6. LOW: what else reaches cargo

`scripts/rg-check.ts:88-90` starts from the process's environment. difftest's overlay scrubs `CARGO_*` but not these:

- **`GIT_DIR` beats the ceiling.** Tested: with both set, `git rev-parse` in ripgrep's directory prints the outer repository's hash. **Failing scenario:** root runs the gate from `git rebase --exec` or a hook, which sets `GIT_DIR`. `rg`'s MIR gets that commit's hash, and the cached oracle's differs.
- **`RUSTFLAGS`, `RUSTC_WRAPPER`, `RUSTC_WORKSPACE_WRAPPER`.** Set for one side's run only, these change the build, against a cached oracle that did not have them.
- **Cargo reads `.cargo/config.toml` from every ancestor of the cwd:** `rust-ts/.cargo` and `~/.cargo`, whatever `CARGO_HOME` says. None exists today.

All are false differences, not hidden ones. `rgCargoEnv` can clear the variables. Say the config limit in the header.

### H7. LOW: difftest's `ERROR:` with no `.env.local` gives the wrong remedy

The check the handoff added is right, and the gate, `phase-diff` and `ir-diff` print it. But with nothing set, difftest's `requireUpstream()` (`scripts/difftest.ts:911`) comes first and prints:

`ERROR: upstream checkout missing at <worktree>/.data/rust; run: bun scripts/upstream.ts fetch`

**Failing scenario:** an agent in a fresh worktree does what it says, and clones rust into that worktree's `.data`, about 500 MB, and then sees no oracle cache. It should say to copy `.env.local` when none exists.

### H8. LOW: the guard's expected hashes are trust on first use

`LLVM_TOOLS_PINNED` was read from the files on this host. Only `libLLVM`'s has a second witness (review plan-m7's `468b56993bc4`). `opt`, `llc` and `llvm-as` were not checked against anything independent, such as the dist tarball, so the pin shows that they have not changed, not that they are the release's. The unit test does confirm their `--version` matches `rustc -vV`. That is reasonable; say it in the header.

Only `llvm-tools.test.ts` reads the pins, and `llvmToolsError` runs only in `ir-tiers.ts` and `ir-diff.ts`. **On difftest's path, by reading, not by running:** a changed tool re-keys `irOracleKey` and re-runs the oracle with no message until the gate's unit step. A missing one throws raw `ENOENT` from `llvmToolHashes` instead of an `ERROR:` line. Call `llvmToolsError` from `irOracleKey`.

### H9. LOW: `mir-opt-o4` is not always at level 4, and what that costs

`harness/compiletest.ts:1273` says "always `-Zmir-opt-level=4`", and the suite's description says so too. A test's own flag comes later and wins. Effective levels of the 406 cases: **4 on 353, 2 on 21, 1 on 6, 0 on 26.** That is compiletest's order too and is fine; correct the words.

**Worth knowing:** 207 cases carry `test-mir-pass`. compiletest runs those at level 0 with that pass alone. Here the pass runs after the whole level-4 pipeline, so its designed input may be gone by the time it runs, and a bug in that pass need not show. F7 asked for this form and it is the better test of pass ordering. A report suite in compiletest's mode, with the same corpus, would close the gap for 2-3 min of CPU. Root's call, not a defect.

### H10. LOW: N1's header is incomplete, and one claim is not always true

`scripts/lib/ir-normal.ts:14-18`:

- **Not listed, absorbed at every tier, harmless:** the parser's auto-upgrades. `PIC Level` Min to Max (40 of 165 one-site "module flag behaviour" mutations), `PIE Level`, `nocapture` for `captures(none)`. A struct type no one uses, too. List them, since this header is the statement of what is discarded.
- **"A missing `!guid`" is not always absorbed.** On `tests/ui/sanitizer/cfi/coroutine.rs#cfi` (flags include `lto`), removing every `!guid` leaves 7 of 229 different at all three tiers: `main`, `lang_start` and the allocator shims, all `internal` in the text. Evidently they were assigned before internalisation (my reading; I did not trace it). 1 of 55 programs. **This is the safe direction,** a false difference. But `llir-*` should know: at most 37 cases carry an `lto` flag, and for those the port cannot leave `!guid` to `assign-guid`.

### Nits

- **N1. Handoff figures:** `rg`'s encoded MIR is 6,925,450 bytes in the lane's kept trees, not 6,927,138, presumably from before the `GIT_CEILING_DIRECTORIES` fix. `time.rs`'s oracle key changes (§2).
- **N2.** `scripts/gate.ts:345`: a stale probe ends with `missing probes; build them and re-run the gate`. The line before is right, this one is not.
- **N3.** `checkProbes`'s staleness has no unit test, and the handoff says one needs a stale stamp in shared `probes/`. It does not: a private `RUST_TS_DATA` with `probes/<name>/source.hash` and `target` linked is enough, in 0.6 s (`stale.ts`).

## What I did not check

- **No port IR exists.** Every tier result is on the oracle's text and mutations. Port-written text could reach parser paths rustc's never does. M7c's 95% and F1's rule have no measurement.
- **Full port runs of `mir-o2` and `mono-ui`.** Oracle side of `mono-ui` in full; port side 120 sample, 263 revisions, 24 with the fix. `mir-o2` 40/40 and `check-ui-encode-mir` 20/20 on my seed; their other cases I did not run. `mir-opt-o4` 60 of 406, so I did not reproduce `dump_dataflow.rs`'s UNPORTED.
- **`check-rg-encode-mir` was not rerun.** I checked the lane's kept trees by raw diff only. `check-rg` was run only with plants (two runs); the clean evidence for it is the same raw diff.
- **Mutations are text edits.** Rustc wrote no phi in 55 programs, so phi is one synthetic function. Inline asm, fast-math, volatile store and a few global forms had sites only in my fixture. Programs over 6,000 lines were not mutated.
- **H4's "absorbed means dead or folded"** is from reading a sample of them and from what `instsimplify` does, not a proof per site. I did not build any absorbed program to compare behaviour.
- **The tracer** beyond the lane's passing test, and x86_64 hosts. Windows not at all.
- **The race's rate** is one pass at load 25 and varies; the 16 warnings are deterministic.
- **`scripts/ir-tiers.ts`'s lane table** was not re-run; my tables replace it where they overlap.
- **The merge is mine and scratch.** The wire lane is still in review, and root's real merge may differ. I did not review the wire lane's own code beyond what `mono-run` meets.
