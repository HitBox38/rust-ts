APPROVE WITH NITS

# Review: perf-subject-bin (harness batch, wave 40h)

Reviewer: independent, read-only. Diff `git diff bbde79e5...t3/optimize-subject-binary` (`60d583e6`, `09c19f1f`, `b6be5313`),
run from a detached worktree at `b6be5313` in my scratchpad (since removed). Host aarch64-apple-darwin, Bun 1.4.3, AC power for
every run (`pmset -g batt`), no `GATE_RUNNING`. `RUST_TS_AGENT=review-perf-subject-bin`, `RUSTC_ICE=0`. The upstream checkout's
`git status --short` was empty at the end, and no `rustc-ice-*` file was left.

The change is small and right. Deleting `rts.map` is safe: the embedded map still resolves frames, and `-Ztrack-diagnostics`
output is byte-identical from source, from the new build (which has no `rts.map` at all) and from the gate's build. The deletion
happens in the temp dir, before the smoke check and the rename. The order-tool bug is real, but it does not undermine the gate
accepted in binary mode. I re-ran the order check with real arguments on the main, Miri and mono entries, and the order is the
same each time. The gate's tree (`3541f8a5`) and the lane's base (`bbde79e5`) have the same `src/`, config files and builder,
so these results carry over to the gate's build. I reproduced the raw comparison (400 processes, 0 differences), the depth and
the instruction counts. No finding blocks the batch.

## Must fix

None.

## Nits

**N1. The order tool's guard is a heuristic with two holes** (`scripts/subject-bin-order.ts:32`, `:37`). It passes whenever *any*
argument spells one of the tool's options, so:
- `bun scripts/subject-bin-order.ts -- --keep --version`: Bun drops the leading `--`, `--keep` satisfies the guard, `dd < 0`, so
  `args = []` and the entry runs with no arguments again. That is the original bug, silently.
- `bun scripts/subject-bin-order.ts --entry src/miri/bin/miri.ts --version` (a forgotten `--`): the guard passes, and
  `parseArgs` takes `--version` as a tool flag. The subject runs with no arguments, and the tool reports "same".

Two possible fixes: refuse when `dd < 0` and `parseArgs` returns any key other than `entry`, `cwd`, `env`, `keep` and `verbose`
(or any positional). Or, simpler and also useful on its own, print the subject's argument count (or argv) on the result line,
so a run with no arguments shows. The lane's one-line fix covers the form that was actually used (`-- <args>` with no option in
front of it), as confirmed: `bun x.ts -- --version a` gives argv `["--version","a"]`, and `bun x.ts --x -- --version` keeps the
`--`.

**N2. Which earlier order evidence did the bug affect?** The bug bites only when `--` is the first word after the script name,
that is, main.ts entry, default cwd and no option. Every Miri run needs `--entry`, so those were unaffected. The subject-bin
handoff's main.ts rows (`docs/handoff/subject-bin.md:105`: `--version`, pm-ui ICE, track.rs, binops.rs, a mir-o2 case) give no
commands, so whether they ran with no arguments cannot be told now. That evidence does not matter for the ratchet, though:
- The subject-bin review used its own start-and-end tracer, not this tool (`docs/reviews/subject-bin.md:96-106`). It passed
  arguments: the mir case exits 1 there, which a run with no arguments would not.
- `root-w46-check.md` and `w40g-audit.md` do not cite order-tool runs.
- The lane's re-run (handoff §5) and mine (below) pass real arguments.

It would help to add one line to `docs/handoff/subject-bin.md`, or to state in the root decision that its main.ts order rows are
superseded by perf-subject-bin §5 and this review. Advice only.

**N3. The old gate builds still hold 130 MB of `rts.map`.** `$RUST_TS_DATA/subject-bin/2e56dd07…` (234 MB) and `511e00b7…`
(243 MB) keep their maps, and the builder's source is part of the key (`BUILDER_SOURCE`, `scripts/lib/subject-bin.ts:317`). So the
next gate builds two new binaries (174 + 179 MB) while the old ones stay until they are pruned (3 days unused). With about 7 GiB
free, root can delete the two old `rts.map` files now, which the frame test and my `-Ztrack-diagnostics` runs show is safe, or
the old builds once the next gate has built its own. Old builds still work if reached: `finished()` (`:390`) checks only
`meta.json` and `rts`, and `pruneSubjectBins` removes the whole directory.

**N4. The timing tool does not refuse on battery or while a gate runs** (`scripts/subject-bin-bench.ts:49`; the header at `:12`
only says not to do either). The gate refuses on battery. A bench run on battery gives numbers that look valid and are 3.5x
off, and a bench run during a gate breaks the gate's timing. A `pmset` check and a check for `$RUST_TS_DATA/tmp/GATE_RUNNING`
(with an override flag) would match the gate's behavior. Low priority.

## Checks, item by item

### 1. The `rts.map` deletion

- **Placement and atomicity** (`scripts/lib/subject-bin.ts:460`). `buildFiles(tmp)` runs right after `Bun.build`, inside
  `.tmp-<key>-<pid>-<rand>`. That is before the input checks, the smoke check, writing `meta.json` and `renameSync(tmp, dir)`.
  A failure throws, and the `finally` removes the temp dir. A finished directory never has the map, and is never half-built.
  `buildFiles` throws if anything other than `rts` remains, which also catches an empty build.
- **Fresh builds** (this tree): `main.ts` → `342b34d8…`, `miri.ts` → `ad9c708c…`. Each directory holds exactly
  `meta.json rts` (174 and 179 MB). The `rts` sizes equal the gate builds' (181,955,186 and 186,941,810 bytes). The bytes differ
  because the repo path is embedded, and mine differs from the gate's.
- **The embedded map is still used.** I added `-Ztrack-diagnostics` to the `mir` suite's argv and ran three subjects from the
  same cwd: source, the new build (no `rts.map` on disk) and the gate's build `2e56dd07` (whose `rts.map` sits beside it). The
  results (exit code, stdout+stderr sha1):

  | input | source | new build | gate build |
  |---|---|---|---|
  | `e0308.rs` (`let x: u32 = "a"`), `--sysroot` | exit 1, `7d3303df13c7`, 1 `created at` | same | same |
  | a 4-error file, `--edition=2021` | exit 70, `3fb09056101f`, 3 `created at` notes, then a refused location | same | same |
  | the same with `--target x86_64-unknown-linux-gnu` | same as above | same | same |
  | `tests/ui/track-diagnostics/track{,2,6}.rs`, `mir` argv | exit 70 (location refused), `a6f051d62eed` | same | same |

  Locations resolve from the embedded map, with the same file:line:col as source. No protected case passes `-Ztrack-diagnostics`
  today: only the 8 `track*.rs` tests ask for it, the ui suites do not include them, and `mir` ignores compile-flags. So this
  check used hand-built argv.
- **Build key.** Every edit to the builder's source changes the key, so the next gate builds afresh (N3). It should change: the
  directory a key names now has different contents. Nothing else needs to be in the key. The binary comes from the same options,
  and `gate.json` records the build hashes.
- **Tests.** `bun test ./scripts/subject-bin.cases.ts`: 22 pass. `bun test scripts/subject-bin.test.ts`: pass. Mutation: with
  `buildFiles(tmp)` commented out, the new frame/contents test fails (21 pass, 1 fail), as the handoff says. `bunx tsc --noEmit -p
  .`: clean. `git diff --stat bbde79e5 b6be5313 -- src harness tsconfig.json package.json bun.lock`: empty.

### 2. The order-tool guard and the module order

The bug is real, and the handoff describes it correctly (N1, N2 above). My re-run uses the guarded tool with explicit `--entry`
and `--cwd` options, the harness's argv, cwd and environment (`s.subject([c])`, `cwdOf(s)`, `caseEnv`, `RUST_TS_IMPL=port`;
null env entries removed), and a fresh trace build per run:

| entry | case and args | result |
|---|---|---|
| `src/rust_ts/main.ts` | `mir` `closure-in-array-len.rs`, 8 args, upstream cwd | same order, 2,080 modules; same output (exit 1, stderr 495 bytes) |
| `src/rust_ts/main.ts` | `-Ztrack-diagnostics --sysroot … --edition=2021 multi.rs` (lazy error-reporting `require()`s) | same order, 2,080; same output (exit 70, stderr 1,692 bytes) |
| `src/miri/bin/miri.ts` | `run-pass-miri` `async-closures/type-name.rs`, 32 args, Miri env | same order, 2,265; same output (exit 0, stderr 295 bytes) |
| `scripts/mono-run.ts` | `mono-ui` `codegen/correctly-monomorphize-generic-drop-impl.rs`, 37 args | same order, 2,092; same output (exit 0, stdout 1,790 bytes) |

The tool's source side runs Miri with its own trace preload instead of `--preload miri_stack_first.ts`. This does not matter:
`miri.ts:24` imports `miri_stack_first.ts` first, so that module still evaluates first. mono-run.ts is not a binary entry
(`mono-ui` runs from source in both modes), so that row covers a third bundle only. **The order matches.** The gate's tree and
this one have identical `src/` and builder, so the binary-mode gate `gate-20261110-023454-root-88uo` stands on valid order
evidence.

### 3. The diagnosis (spot-check)

`mir` `recursive-drop-elaboration.rs`, the harness argv, alone, `/usr/bin/time -l`, 2 rounds interleaved, load 1.4-2.5. Same
output hash (`9410868246`) in all 8 runs:

| variant | G instructions | wall s | user s | max RSS MB |
|---|---|---|---|---|
| source | 510.9, 512.7 | 24.93, 25.21 | 27.5, 27.9 | 3,008, 3,113 |
| current binary (new build) | 609.7, 608.9 (+19%) | 27.71, 28.15 | 32.1, 32.2 | 3,923, 3,931 |
| plain `Bun.build` bundle, `bun main.js` | 616.8, 617.2 | 28.41, 28.72 | 32.9, 33.1 | 3,929, 3,923 |
| plain bundle + `minify: { syntax: true }` | 616.8, 616.6 | 28.91, 28.92 | 33.2, 33.1 | 3,887, 3,924 |

This matches the handoff to within 0.3%. A plain bundle with no compile step, no bytecode and no sourcemap costs as much as the
binary, so the cost is in the bundle's shape. My tests did not cover bytecode, the optimizer or the sourcemap; the lane's table
is consistent with that conclusion. Advice in the last section.

### 4. The recommendation

See the last section.

### 5. Evidence reproduced

- **Raw comparison**, `difftest --sample 200 --raw-subject` in each mode, then `scripts/subject-bin-compare.ts`, with my agent id
  (a different sample from the lane's):

  | suite | source | binary | compare |
  |---|---|---|---|
  | `mir` | 200 MATCH | 200 MATCH | 200/200 same, 0 differ, 0 timed out (subject s 323.6 → 128.7) |
  | `run-pass-miri` | 200 MATCH | 200 MATCH | 200/200 same, 0 differ, 0 timed out (subject s 722.5 → 493.3) |

  Runs: `$RUST_TS_DATA/runs/20261110-1112…-review-perf-subject-bin-*` (four directories).
- **Depth**: the deepest `((…1…))` that compiles at `-Zunpretty=normal`, bisected to ±6, 2 passes each, load 3.4-3.7:
  - source: 10,180, 10,180
  - new build: 10,083, 10,083
  - gate build `2e56dd07`: 10,083, 10,083

  The first failure is a SIGBUS stack overflow on every side. This is the lane's range (10,078-10,095 and 10,089-10,095), and
  the new build has the gate build's depth.
- **Oracle keys**: not re-dumped. The batch changes no `src/`, `harness/` or suite file (`git diff --stat` above is empty), so
  the keys cannot have changed.
- **Disk**: my two builds (keyed to my scratch worktree), the bundles and the worktree are deleted. The gate's builds were only
  run, never touched.

## Advice

### Item 3: is "no build option helps" convincing?

For the options it names, yes. My table shows the plain bundle equal to the binary, and `minify-syntax` changing nothing. The
lane's table shows bytecode, the optimizer and the sourcemap each within 1%. Other options are closed by the port's semantics,
not by measurement: `splitting` (the lane got missing prototype extensions), `format: "cjs"` (refused because of the top-level
`await`), and `target: "node"`/`"browser"` (these drop `bun:ffi` and the Bun globals the port uses). What remains untried and
cheap:
- **`minify.whitespace`/`identifiers`.** Unlikely to matter for the JIT. Skip unless someone is already rebuilding.
- **A newer Bun.** The `__esm` wrapping is the bundler's codegen. The next `VALIDATED_BUN` bump should re-run
  `subject-bin-bench.ts` on this case. That is the tool's purpose, and it costs about 2 minutes.
- **`format: "cjs"` after removing main.ts's top-level `await`** (src/rust_ts glue, a small change). This would show whether
  CJS wrapping behaves differently from `__esm`. Likely not, since required ESM modules get wrapped the same way, so it is low
  priority.

The lane says honestly that its attribution of the remaining ~15 points is not proven: one big module of lazily initialized
scopes, against 2,100 ESM modules, with diffuse ~1.15x inclusive time everywhere. I agree that a port-wide `src/` change (option
3) should not be made on this evidence. The lane proposes one crate first as the next experiment, and that is the right size.

### Item 4: the solo retry from source

**Sound, with conditions.** A pool TIMEOUT is not an output: the retry asks whether the case produces the right bytes within
the limit when run alone. Source mode is the reference form of the subject. There is no output difference between the modes
across about 1,400 compared processes (the lane's 1,000, my 400, plus the subject-bin evidence). Root's 2026-11-10 decision
already re-runs a binary-mode loss in source before counting it. Retrying in source moves that rule earlier, into the gate. It
also removes about 11% wall and about 20% RSS (TAIT) exactly where the margins are thin. The retry fires only on TIMEOUT. A
binary-only stack overflow (the 1% depth gap) is a crash, not a timeout, so it would still show as a loss and go through the
existing rule. The depth question does not change.

Conditions for the harness batch that implements it:
1. **Record the mode per attempt.** `CaseResult.attempts.alone` needs the mode it ran in. `gate.json` and the accept decision
   should name "pool: binary, retry: source". `history.jsonl` does not record the mode (subject-bin review N4).
2. **Keep it once adopted.** A case protected only through a source retry could time out in a later gate that retries in binary
   mode. This is the same "one mode for all gates" rule as N4, now applied per attempt type.
3. **The tree must not change.** A source retry reads the live tree, while the pool ran a build keyed to the tree at its start.
   The gate's existing clean-tree/HEAD check covers this, as long as it runs after the retries. The batch's reviewer should
   confirm that order.
4. **The 45 s rule now measures source time.** After the change, `retryTimes` record source times, so the binary's own
   long-case cost becomes visible only as more pool TIMEOUTs (`attempts.pool`). The 2026-11-09 decision should say which
   number it watches.

With these, mixing the modes this way is narrower and safer than N4's concern: one mode is used per attempt type, the change
goes in the deeper and slower-starting mode's favour, and each attempt's mode is recorded.
