REQUEST CHANGES

# Review: harness batch `subject-bin` (compiled subject binary)

Reviewer: independent, read-only. Diff `git diff 9015f665...t3/compiled-subject-cache` (a5b7e0fd, bb3c6948, f28f8d5a), reviewed and
run from a detached worktree at f28f8d5a. Host: aarch64-apple-darwin, Bun 1.4.3, on AC power for every run (`pmset -g batt`
checked before each one); no `GATE_RUNNING`. `RUST_TS_AGENT=review-subject-bin-r1` (the lane used `subject-bin`).
`git -C $RUST_TS_DATA/rust status --short` is empty at the end.

The design holds up. Every output I compared is byte-identical between the modes. Module evaluation order matches, checked
with my own start-and-end tracer. Oracle keys are unchanged. The stack-depth gap is real, but no protected case I could find
comes near it. Two things must change before a gate relies on the binary. The cache key misses `tsconfig.json`, so a stale
build can be reused (F1, reproduced). And a Bun upgrade can silently turn the bytecode optimiser back on (F2, reproduced).
Both are small fixes.

## Must fix

**F1. The cache key does not cover `tsconfig.json` (or `package.json`, `bunfig.toml`, `bun.lock`), so a stale binary can be
used.** `scripts/lib/subject-bin.ts:305-309` (`subjectBinKey`) keys on the metafile inputs, and those are the 2,097/2,285 `.ts` files
only (checked in both `meta.json`s: no JSON or config file is listed). `Bun.build` reads the repo's `tsconfig.json` when it
transpiles. Reproduced: I added `"useDefineForClassFields": false` to `tsconfig.json` in the review worktree, and the main.ts
bundle text changed (sha1 `70fb71641164` → `6113aaa3c87d`) while the key stayed `8ce8a2d554c5`. So after a tsconfig change, the
harness would run a cached binary transpiled under the old settings, and source mode would use the new ones. In a gate that
could lose cases or, worse, accept cases into the protected set that only pass in the stale build. `package.json` (`sideEffects`,
`imports`) and `bunfig.toml` can also affect bundling, so key them too.
Fix: hash `tsconfig.json`, `package.json`, `bunfig.toml` and `bun.lock` into `subjectBinKeyOf` (a missing file hashes as absent).
Add a unit test that edits the fixture's tsconfig and expects a new key.

**F2. Turning the bytecode optimiser off depends on an option that `Bun.build` would silently ignore if a Bun release renamed
or dropped it.** The option is at `scripts/lib/subject-bin.ts:266`. I passed `Bun.build` misspelled options
(`optimize: { bytecodeXX: false }` and `optimizeXX: {...}`), and it returned `success: true` with no logs. After such a change,
the next build would get Bun's optimised bytecode, about −4.4% depth by the lane's table, and nothing would report it. The Bun
version is in the key, so an upgrade does trigger a rebuild. But the rebuild passes its only check (`--version`) and is used
anyway. The lane calls the option undocumented. In fact Bun 1.4.3's bundled docs name it
(`bun-types@1.4.3/docs/bundler/executables.mdx:313`), but the `.d.ts` types do not, hence the cast. A `bun-types@1.4.4` is already
in `~/.bun/install/cache`, so an upgrade is likely soon.
Fix (either one):
- (a) Binary mode refuses, with one `ERROR:` line, any `Bun.version`/`Bun.revision` not in a validated list in
  `subject-bin.ts` (today 1.4.3). The list grows only after the depth and order checks are re-run on the new version.
- (b) Add a depth smoke check, so a build must compile the nesting the source compiles at a fixed depth in the window found
  below (e.g. 9,950 parens at `-Zunpretty=normal`: source and unoptimised binary pass, optimised binary fails).

(a) is cheaper and also covers other changes a new bundler version might bring (module order, renames).

## Nits (may defer)

- **N1. Prune can race a resolve.** At `scripts/lib/subject-bin.ts:427-437`, `pruneSubjectBins` stats `meta.json`, then runs
  `rm -rf`. Meanwhile, another process's `finished()` (`:324-333`) may have just checked that the build exists and touched it. A
  build idle for just over 3 days can be removed under a run that has just picked it, and that run's subjects then fail to
  spawn. This takes a build idle for about exactly 3 days plus a concurrent new build, so it is unlikely; a gate would show it as
  losses, not a silent pass. Fix: rename to `.trash-*` first, re-stat, then remove. Or take a lock file.
  Deletion is otherwise safe. It removes only children of `$RUST_TS_DATA/subject-bin`, never the kept build, and never a
  build touched within 3 days. Every gate touches its build at start, and a gate runs about 11 h.
- **N2. The `import.meta` rewrite judges comments and strings one line at a time** (`:135`, `:142-145`). An `import.meta.dir`
  on a continuation line of a multi-line template literal, or inside a block comment whose lines do not start with `*`, would
  be rewritten without an error. Today the bundle inputs hold exactly five real uses: `common.ts:8`, `miri_stack_first.ts:10`,
  `proc_macro_host.ts:70`, `track_caller.ts:106` and `rustc_session/config.ts:1635`. All are plain code, and the one in a doc
  comment (`track_caller.ts:111`) is skipped correctly. So nothing is wrong now. A stricter check would fail the build when a
  match is not at a token boundary that `Bun.Transpiler`'s scan agrees with.
- **N3. Two `src/` comments are now untrue (outside the lane's scope, so root should update them).**
  `src/rust_ts/miri_stack_first.ts:9` says a `--compile` bundle's `Bun.main` does not match; with the `Bun.main` define it does.
  `src/rustc_middle/ty/list.ts:51-52` says a bundle hard-codes `NODE_ENV` and that no harness path builds one; both are now
  false.
- **N4. Mixing modes weakens the ratchet.** The binary starts about 0.4 s faster and overflows about 0.9% sooner. A case accepted
  from a binary-mode gate near the 60 s timeout could time out in a later source-mode gate. A nesting case near the limit could
  go the other way. `gate.json` records `subject`, but the `history.jsonl` accept record does not. Once root switches, keep one
  mode for all gates, and name the mode in the accept decision.
- **N5. Disk use.** About 160 MB per build, and a new build for every tree edit when anyone runs in binary mode. The cache already
  holds 9 builds, 2.1 GB. This is fine for root; lanes should stay on `source` (the default).
- **N6. `subject-bin-compare.ts` counts a process that timed out on either side as `timed-out`, not as a difference.** It
  would be better to report one-sided timeouts as their own count, since they are where a speed or depth difference would show.
- **N7.** The handoff names the branch `t3/2ba7f49e`; the reviewed branch is `t3/compiled-subject-cache`.

## Checks, item by item

1. **Cache key.**
   - Covered: every bundled file's path and content, the spec (entry, entry path, bun path, repo, define, banner, every build
     option), `Bun.version`/`revision`, and the builder's source.
   - Not covered: config files (F1).
   - Files read at run time are read live in both modes, so they are consistent. These are `.env.local` (config.ts:1635,
     common.ts:45), `UPSTREAM.json` (common.ts:40), `proc_macro_host.c`, the TS sources that `track_caller` parses, and
     upstream `.rs` files.
   - The key is recomputed from the tree on every resolve, so an edit to `src/` cannot reuse a stale build. The lane's check
     that the build reads the same files, still hashing the same, also guards against an edit made during the build.
   - Builds are atomic: they are made in a temp dir, then `rename`d, and the loser of a race adopts the winner's build
     (fixture test).
2. **Rewrites.**
   - The same-length `import.meta.*` calls keep columns; the edge cases are in N2.
   - `process.argv[0..1]` is set by the banner; `env.ts:86` then sees `[entry, …args]` as in source.
   - The raw argv and `execPath` re-exec are right for a binary.
   - `Bun.main` is defined as the real entry path, so `miri_stack_first.ts:10` holds.
   - `NODE_ENV` is a getter on the run-time environment. No module assigns `process.env.NODE_ENV`.
   - No bundled module reads `constructor.name` or a function's `.name` for output. I bundled both entries and found no
     function or class in `std/panic.ts`, `std/panicking.ts`, `std/result.ts`, `rustc_span/macros.ts` or `track_caller.ts`
     renamed.
   - **Module order, my own tracer** (scratchpad `tr/order.ts`): it records both the start and the end of every repo module
     body. It runs source as `bun --preload <runtime plugin>`, and the binary as a fresh `--compile --bytecode` build with the
     lane's rewrites plus the same trace. The trace (start + end lines), exit code, stdout and masked stderr were identical for:

     | command | trace lines |
     |---|---|
     | main.ts `--version` | 4,160 |
     | a `mir` case (closure-in-array-len.rs, exit 1) | 4,160 |
     | a `pm-ui` case (attr-macro-changes-type-kind.rs) | 4,160 |
     | `scripts/mono-run.ts` on a `mono-ui` case (not a binary entry; a third bundle) | 4,184 |
     | miri.ts on a `run-pass-miri` case (type-name.rs, preload path) | 4,530 |
     | miri.ts on a `run-fail-miri` case (exit 101) | 4,532 |
     | two unit-test-style entries whose first import is a cycle member (`rustc_hir/def.ts` + `rustc_attr_ir/data_structures.ts`; `rustc_middle/ty/mod.ts` + `rustc_span/symbol.ts`) | 802 / 942 |

     Negative control: without the `export *` fix, `--version` diverges at trace line 626 (`extern_abi.ts` against
     `callconv.ts`), as the lane reported. So the tracer would have caught a difference, and the fix works.
3. **`track_caller.ts`.** `frame_file` maps only paths that start with `src/` or `scripts/`. Source frames are absolute, so
   source mode is unchanged (track_caller.test.ts passes). `/$bunfs/…` and other absolute paths stay as they are and are refused.
   A `src/../../x` path joins to outside the repo, so `startsWith(SRC_ROOT)` refuses it. `scripts/…` frames map outside
   `SRC_ROOT` and are refused, as in source. The panic-machinery checks (`fr.file === STD_PANIC`…) compare paths that are real
   paths on both sides. In the binary run, all 8 protected `tests/ui/track-diagnostics/track*.rs` cases in `mir` gave output
   identical to source (below).
4. **Remaining differences.** No protected MATCH can contain JS frame text, because the oracle prints none. The
   `tests/ui/resolve/proc_macro_generated_packed.rs` ICE, which goes through track_caller, is in the lane's pm-ui evidence.
   - Stack depth, reproduced:

     | depth (parens, `-Zunpretty=normal`) | source | binary | source at 97% stack |
     |---|---|---|---|
     | 9,800 | compiles | compiles | compiles |
     | 9,950 | compiles | compiles | fails (138) |
     | 10,040 | compiles | compiles | fails |
     | 10,100 | compiles | fails (SIGBUS, 138) | fails |
     | 10,140 | compiles | fails | fails |

     So the binary's limit is between 10,040 and 10,100 (the lane: about 10,060), and 97% of the stack is a margin about 3×
     the binary's gap.
   - Headroom probe (scratchpad `tr/headroom.ts`), beyond the lane's syntactic scan: I took every protected file with
     `recursion_limit` ≥ 256, plus the lane's six nesting files and the 8 track-diagnostics cases. I ran each in the suites
     that protect it (`mir`, `thir-tree`, `run-pass-miri`) three ways: source, source at 97% stack, and binary. The
     recursion-limit files are issue-93775, make-sure-to-filter-projections-by-def-id, method-on-deeply-nested-struct-perf(-2),
     normalize-param-env-6, issue-91949-hangs-on-recursion, deep-futures-are-freeze, weird-exprs (both), issue-32498 and
     recursion_limit/overflow.rs. **All 32 runs: the 97% run and the binary are identical to source.** No protected case I
     could find is within 3% of the stack limit.
   - `optimize: { bytecode: false }`: see F2.
5. **`BUN_JSC_*`, record, retention, fallback.**
   - The refusal works (unit test), and no harness or suite env sets a `BUN_JSC_*` variable per case. `stack.ts` sets
     `maxPerThreadStackUsage` only inside the subject's own re-exec.
   - `gate.json` gets `subject` in both writes.
   - Retention: N1.
   - There is no silent fallback: a failed build or check is one `ERROR:` line and exit 1, before the static steps.
   - Source mode gives exactly the old commands (unit test, and the `oracle-keys` result below).
6. **Oracle keys.** `scripts/oracle-keys.ts` in a base worktree at 9015f665 (script copied in, untracked) and on the branch in
   both modes: 372,181 keys each, sha1 `5d0766429cc8b685d9c12369a5ae59dd2a5049db` all three times. That is the lane's sha1,
   reached from a different repo path. No oracle command or key reads `bunCmd`/`subjectCmd`; `oracleRuns` matches only
   wrapper and oracle commands.
7. **Independent evidence** (`--sample 200 --jobs 12`, seed `review-subject-bin-r1`, raw records compared with
   `scripts/subject-bin-compare.ts`, on builds `8ce8a2d554c5` (main.ts) and `fdac9e2d1041` (miri.ts)). "Same" means a
   byte-identical command, exit code, stdout and stderr; "pid-masked" means identical except for a panic's thread id.

   | suite | MATCH source/binary | processes | same | pid-masked | differs | subject-s source → binary |
   |---|---|---|---|---|---|---|
   | mir | 200/200 | 200 | 200 | 0 | 0 | 364.5 → 131.3 |
   | pm-ui | 200/200 | 200 | 199 | 1 | 0 | 360.4 → 108.6 |
   | rmeta-ui (rmeta) | 200/200 | 200 | 200 | 0 | 0 | 325.4 → 93.4 |
   | thir-tree | 199/199 (+1 UNPORTED both) | 200 | 200 | 0 | 0 | 380.2 → 145.7 |
   | run-pass-miri | 200/200 | 200 | 200 | 0 | 0 | 776.4 → 493.0 |
   | run-fail-miri | 200/200 | 200 | 200 | 0 | 0 | 980.8 → 943.9 |

   No timeouts, no missing processes, no differences. main.ts suites took 61–71% less subject time, consistent with the
   lane's −66%.
8. **Static checks.**
   - `bunx tsc --noEmit -p .` is clean.
   - Tests pass on the branch: `scripts/subject-bin.test.ts`, `src/rust_ts/track_caller.test.ts` and `scripts/miri.test.ts`
     (52 pass); `scripts/gate-{probes,unit,static-stop}.test.ts` and `harness/{m7-suites,miri-ui,pm}.test.ts` (45 pass); and
     `scripts/lib/deps.test.ts` (12 pass, as on base). That last test failed once, but only while I had run the whole test
     tree in parallel by mistake.
   - `harness/` changes are only `bunCmd` → `subjectCmd`, the `miriSubjectOf` driver branch, an import and a doc comment. There
     is no suite, case, baseline, expectation or oracle change, and no `harness/baseline/` file in the diff.

## Recommendation

Do not switch `DEFAULT_SUBJECT_MODE`. Root may run the next gate with `RUST_TS_SUBJECT=binary` once these conditions hold:

1. F1 and F2 are fixed (key the config files; refuse any unvalidated Bun version), and this branch is merged with root's
   explicit OK for the `src/rust_ts/track_caller.ts` change, which I found correct and source-neutral.
2. No `BUN_JSC_*` variable is set, the host is on AC power, and nothing else runs a binary-mode build during the gate.
3. The accept decision names the subject mode and build hashes (N4). Later gates stay in binary mode, or any loss in a
   source-mode gate is first re-run in the other mode before it is treated as a regression.
4. A gate that loses any case in binary mode is re-run on those cases with `RUST_TS_SUBJECT=source` before diagnosis, so a
   binary-only loss (the 0.9% depth gap or anything unforeseen) is recognised as a harness issue, not a port regression.

If root wants a gate in binary mode before F1 and F2 land, it is safe on today's evidence only if `tsconfig.json`,
`package.json` and `bunfig.toml` have not changed since the cached builds were made, and Bun is still 1.4.3. Safest is to
`rm -rf $RUST_TS_DATA/subject-bin/*` first, so the gate builds fresh, and to confirm `bun --version`.
