# harness-w51 (wave 40l) — handoff

Harness batch. Pin `6f5da406b56c`. Base `b3772ebb`. Branch `t3/b73a6e2f`. AC power throughout (`pmset`: "Now drawing from 'AC
Power'"). `.env.local` from `integ-w39`, plus `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`; `RUST_TS_AGENT=harness-w51`
for the runs. Bun 1.4.4 (`~/.bun/bin/bun`, never touched; the unit-step run used an APFS clone in scratch). No gate. No
`GATE_RUNNING` seen. No baseline, oracle output, existing suite's cases or expectation changed.

Commits:
- `fe9bdb9b` item 1: bun-144 re-check-3 nits N1-N5
- `ba8d9811` item 2: scope-m7 review N1-N7 (N8 is handoff accuracy, nothing in code)
- `cbef2ddc` items 3 and 4: report suites `stats-ui` and `target-specs`
- this handoff

## Results in brief

| check | result |
|---|---|
| `bunx tsc --noEmit -p .` | clean before each commit |
| Runner unit step as the gate runs it (`unitStaticSteps("runner unit tests")` + `runStaticStep` from scripts/gate.ts, started from an APFS clone of Bun with its directory and a `bunx` link first on PATH, as `gateBunClone`'s re-exec does; parent env `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0 RUSTC_ICE=0`) | **558 tests, 0 failures, 0 skips** (0 allowlisted, 0 not allowed), 109 s. Was 512 at scope-m7's review. |
| `bun scripts/coverage.ts --check --offline` | `markers ok (25786, 32 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 735; llvm 174)` |
| Oracle-key dump (`scripts/oracle-keys.ts`), before (`ba8d9811`, harness untouched since base) and after (`cbef2ddc`) | 374,690 → 377,217 keys; `diff`: **0 lines removed or changed**, 2,527 added: `stats-ui` 2,193, `target-specs` 334. sha1 before `a3e1b6e5…`, after `c3454462…`. |
| `stats-ui`, full, `--jobs 6` | **2,193 / 2,193 MATCH** (ui 3/3, `-Zinput-stats` 730/730, `-Zmacro-stats` 730/730, `-Zmeta-stats` 730/730), 9.5 min. `runs/20261111-211659-harness-w51-pxfy` |
| `target-specs`, full, `--jobs 6` | **6 MATCH, 328 UNPORTED**, 0 DIFF/CRASH/TIMEOUT, 42 s. `runs/20261111-211505-harness-w51-tzxy` |
| Upstream checkout | clean after every run (`git status --porcelain`: nothing) |

## 1. bun-144 re-check-3 nits (`docs/reviews/bun-144-recheck3.md`)

- **N1, orphan's live copy.** After the spawn, the first process rewrites `owner.json` as `{ pid, child, startedAt }` (written
  whole to `owner.json.tmp`, then renamed). `pruneGateBunDirs` keeps a directory while either pid is alive. The `gate.ts` header
  says a later gate prunes a SIGKILLed gate's copy only once that gate has ended too.
- **N2, the prune and odd entries.** It uses `lstatSync`, so a link is never followed: a stray file or link with no `owner.json`
  goes when its own mtime is over 10 minutes old (only the link is removed, never its target). An entry that vanishes mid-scan
  (ENOENT) is skipped. Any other failure throws `cannot prune <dir>: <why>`. `gateBunClone` prints that as its one `ERROR:` line,
  with no stack trace. An `owner.json` that parses to `null` counts as having no live pid.
  `pruneGateBunDirs` has a test-only `afterList` hook, as `pruneSubjectBins` has `afterLook`.
- **N3.** `builtByRefusal` refuses a build whose record has no `bun.sha1` whenever the gate knows its own sha1.
- **N4.** `gateBunClone` refuses a `gate-bun/` directory whose real path holds a `:`, with one `ERROR:` line, before any copy.
  The check is on the real path, so a symlinked `RUST_TS_DATA` that resolves to such a path is caught too.
- **N5, a way to prune the v3 builds.** `bun scripts/subject-bin.ts prune --pre-v4` (lib `prunePreV4Builds`) removes the
  finished builds whose `meta.json` records no builder sha1, whatever their age. Those were keyed before `v: 4`, and no current
  builder finds them again. It skips builds that record a sha1, unfinished ones, trash, and a `meta.json` that does not parse or
  has no `bun`, and it moves each build to `.trash-*` first. **On this host there are none left**: I ran it on the real data dir
  and it removed 0. The two builds in `subject-bin/` are `v: 4` (389 MB).

Tests: `scripts/gate-bun.test.ts`, 29 pass (4 new tests and 2 new assertions on `builtByRefusal`), and
`scripts/subject-bin.cases.ts` (1 new test). The new orphan test does the reviewer's reproduction end to end: the real
`gateBunClone` runs, the first process is SIGKILLed while the second runs on, and the prune keeps the copy. Once the second
process ends, the prune removes it.

Mutation table (each mutant made, run on its own and reverted; each one made at least one test fail):

| mutant | failing test |
|---|---|
| `owner.json` without `child` (gate.ts) | the SIGKILL orphan test |
| the prune reads only `owner.pid` | the pids unit test and the orphan test |
| `statSync` instead of `lstatSync` | dangling link / mid-scan test |
| ENOENT not skipped | dangling link / mid-scan test |
| gate.ts rethrows the prune error instead of `die` | dangling link / mid-scan test (its "no stack trace" leg) |
| `builtByRefusal` lets a sha1-less record through | `builtByRefusal` test |
| the `:` check removed | the `:` test |
| `prunePreV4Builds` ignores the sha1 condition | `prune --pre-v4` test |

## 2. scope-m7 review (`docs/reviews/scope-m7.md`)

- **N1, template defaults** (`scripts/lib/cpp-fns.ts`). The class check skips `template <...>` parameter lists (balanced angle
  brackets, those inside parens not counted) before it looks for a variable's `=`. I compared the finder's output over every
  manifest file and every wrapper file, before and after. **The only change is the 10 IRBuilder.h definitions the review lists**
  (2899, 2905, 2910, 2914, 2923, 2930, 2937, 2946, 2958, 2959). Nothing was lost, and the wrappers still give 218 definitions.
- **N7, a brace-init then a paren-init in an initializer list** (cheap, so done). A `{` right after a name (or `>`) in a
  definition's head that has a `:` after its first `)` is a brace-init. It stays in the head's tokens until it closes. My first
  version also took an access specifier's `public:` for the init list and lost 6 definitions (Constants.h:609 and others). The
  final rule needs the `:` after the `)`, and a test pins that case (`public:` then `auto h() -> Foo {`).
- **N2, wrapper path typos** (`scripts/lib/llvm-src.ts` `wrapperMarkerErrors`). A `// rustc:` marker under
  `compiler/rustc_llvm/` that is not a wrapper path is now an ERROR, unless it names a real fn of the crate's Rust (`rustFns`,
  same line and name). End to end through `coverage.ts --check`: `llvm_wrapper/RustWrapper.cpp:404` and
  `llvm-wrapper/RustWrapper.cc:404` each give `ERROR: … names neither a wrapper function (compiler/rustc_llvm/llvm-wrapper/<file>.cpp
  or .h) nor a fn of compiler/rustc_llvm's Rust`. `llir-core-a`'s two `lib.rs` markers (`support.ts:105`, `:113`) pass, and are now
  checked.
- **N3, `llvm-src add` validates first** (`scripts/llvm-src.ts`, lib `addPathErrors`, `addFiles`). The paths are checked before
  the gitlink check, any request or any write (`..`, `.`, empty segments, absolute, `\`, given twice). `addFiles` downloads every
  file before it places the first, so a failure on the 2nd path leaves nothing placed. The command test runs `add` with a
  `../../llvm-project/...` path: one `ERROR:` line, an empty `RUST_TS_DATA`, and the manifest unchanged.
- **N4, the import guard covers every runner test file** (`scripts/lib/unit-steps.test.ts`, replacing the hard-coded test in
  `scripts/coverage.test.ts`). It lists every runner-step test file (bun's patterns, `git ls-files`, `unitStepsOf`). It reads
  imports with `Bun.Transpiler.scanImports`, which drops type-only imports. From each test file it follows imports of every kind
  (static, side-effect, `export … from`, dynamic, `require`), and then static imports from the modules they reach. Lazy imports
  inside a module's functions are not followed. Today the only file that loads `common.ts` is `scripts/lib/deps.test.ts`, on
  the `COMMON_LOADERS` allowlist. The lesson is now in `scripts/lib/unit-steps.ts`'s header. I checked it with temporary new
  files (removed afterwards): a direct import, a transitive side-effect import (`import "../scripts/lib/oracle.ts"` from
  harness/) and a dynamic import inside a test each failed the guard. A type-only import passed.
- **N5** (PORTING §5c). A qualified name with template arguments is written without spaces. A function that a macro generates
  gets no `// llvm:` marker: it gets `// PORT: generated by <MACRO> (<path>:<line of the #define>) for <name>`. The cpp-fns
  header points there.
- **N6, the WRAPPER figure without D18's files** (`WRAPPER_EXCLUDED` in `scripts/lib/llvm-src.ts`, with a reason for each).
  `CoverageMappingWrapper.cpp` (11 fns) and `offload/OffloadWrapper.cpp` (10 fns) are left out, so **WRAPPER is 32/197 in 6
  files** (it was 32/218 in 8). Markers into those files are still checked. `--missing` on one prints a note with the reason. A
  key that names no wrapper file is an `ERROR:` in the full table and in `--check`. I left the inactive `#if` branch
  `PassWrapper.cpp:543 LLVMRustwrappedIrGetName` in the figure, since both branches are valid marker targets. Root may want a
  `rustc-skip:` there.

Tests: cpp-fns 23 pass (2 new), llvm-src 23 pass (5 new), coverage.test.ts 6 pass (the `--crate llvm-wrapper` expectation is now
197/6, plus a new `--missing` note test), unit-steps 1 new.

Mutation table (each mutant made at least one test fail):

| mutant | failing test |
|---|---|
| no template-list stripping | cpp-fns "class template with default template arguments" |
| no brace-init rule | cpp-fns "brace-init then a paren-init" |
| brace-init rule without "`:` after `)`" | the same test (`public:` + `auto h() -> Foo`) |
| wrapper check skips non-wrapper rustc_llvm paths | llvm-src "a typo of the wrapper path" |
| `addFiles` without the path check | llvm-src `addFiles` test |
| `addFiles` placing each file as it downloads | llvm-src `addFiles` test (the 404 leg) |
| the command without its early path check | llvm-src command test |
| the WRAPPER loop not skipping `WRAPPER_EXCLUDED` | coverage.test.ts `--crate llvm-wrapper` |

## 3. `stats-ui` (report only)

`harness/stats.ts` holds the cases and the suite builder (no `common.ts`). Registration and the commands are in `harness/suites.ts`,
after `cli`. There is no baseline, so the gate leaves it out by default; `--suites stats-ui` runs it.
- **The 3 UI tests** (`tests/ui/stats/*.rs`, listed by `collectUiTests`). They run as pm-ui runs its tests: compiletest's
  main-compile argv (`uiFileCases(.., { run: true, needs: true })`). `needs-asm-support` and `needs-deterministic-layouts` are
  evaluated for x86_64-unknown-linux-gnu, so input-stats.rs is a case (`uiCases` skips it). `--emit=metadata` is appended unless
  compiletest already passes `--emit metadata`: only meta-stats.rs, which is `build-pass`, gets it. Env is `NOCORE_ENV` + the
  test's, with the session variables pinned. Output goes to compiletest's `--out-dir` under the checkout's `build/`, as in
  pm-ui, and making the cases creates the output base dir. `statsUiArgs` refuses a parse-only argv and an argv with no stats
  flag. Case id: the file.
- **Crate cases.** Each of check-ui's 730 crates (`RMETA_UI_CORPUS`) runs once with each flag appended after its argv
  (`statsCrateCases`), through `scripts/rmeta-run.ts` without `--bytes` or `--dump`. The wrapper adds `-o <dir>/lib<side>-<pid>.rmeta`,
  so nothing lands in the checkout and the sides never share a file. Case id: `<flag> <crate file>`. Subsets: `ui`,
  `-Zinput-stats`, `-Zmacro-stats`, `-Zmeta-stats`.
- `oracleKey` = `rmetaOracleKey(false)` (the wrapper's source and the rustc build). The gate's `oracleRuns` sees `rustc` for both
  kinds, and `undeclaredRuns` is empty.
- **Result: 2,193 cases, 2,193 MATCH.** None of these matches is two empty outputs: each oracle output, decoded from the cache,
  holds 10 to 272 lines. On each flag 722 crates exit 0 and 8 exit 1 (the oracle rejects them, as in check-ui), and the port
  matches those 8 too.

## 4. `target-specs` (report only; owner's approval 2026-11-11)

`harness/target-specs.ts`, registered after `stats-ui`, with no baseline.
- **The target list comes from source.** `supportedTargets` parses the `supported_targets! { ... }` invocation in
  `compiler/rustc_target/src/spec/mod.rs` (not the `macro_rules!` that defines it) and keeps source order. It refuses any line
  that is not an entry, a comment or a blank, a tuple listed twice, and an empty list. **334 targets at the pin.** A test checks
  that the list, sorted bytewise as `print target-list` sorts it, equals the pinned toolchain's `rustc +nightly-2026-10-11
  --print target-list` output byte for byte.
- **Argv:** `--print target-spec-json --target <t> -Zunstable-options --sysroot <oracle sysroot>`, env `CLI_ENV`, no input. The
  `-Zunstable-options` comes from `printKinds(print_request.rs)` (`is_stable`: false at the pin), not from a hard-coded value. The
  sysroot is passed for the reason the `cli` print cases pass it. Case id: `target-spec-json <t>`.
- **Counts today:** 6 MATCH (`aarch64-apple-darwin`, `aarch64-unknown-linux-gnu`, `wasm32-wasip2`, `x86_64-apple-darwin`,
  `x86_64-pc-windows-msvc`, `x86_64-unknown-linux-gnu`) and **328 UNPORTED**. Every UNPORTED case stops at
  `rustc_target::spec::targets::<module> (built-in target <t>)`, so each one is a target spec not ported yet. Each oracle output
  is 23 to 231 lines, with exit 0. A sample of 20 ran first (all UNPORTED).

Tests: `harness/stats.test.ts` 4 pass and `harness/target-specs.test.ts` 5 pass: the pure functions on fixtures, the list at the
pin against the oracle, and each registered suite in a child (mode, counts, ids, commands, the gate's oracle-run check, no
baseline file).

Mutation table (each mutant made at least one test fail):

| mutant | failing test |
|---|---|
| `statsUiArgs` never appends `--emit=metadata` | its fixture test and the registered-suite test |
| the UI cases without `needs: true` | the registered-suite test (input-stats.rs skipped) |
| the flag not appended to crate cases | 3 tests |
| crate cases with `--bytes` | the registered-suite test |
| `-Zunstable-options` never added | 3 target-specs tests |
| `supportedTargets` without the duplicate check | its refusal test |
| `supportedTargets` skipping unreadable lines | its refusal test |

## Disk

About 2.9 GiB free at the end. Other lanes ran at the same time, so `df` is not a measure of this lane.
- Oracle cache, new entries: `stats-ui` 2,193 (3.7 MB apparent, about 9 MB allocated at 4 KB per small file); `target-specs`
  334 (0.4 MB apparent, about 1.3 MB allocated).
- `$RUST_TS_DATA/rmeta/stats-ui/`: 21 MB. These are rmeta-run's kept `oracle.rmeta`/`subject.rmeta` per crate case (as check-ui
  keeps them). They can be deleted; the next run writes them again.
- Run dirs: 4 dirs, 336 KB in all.
- **For root:** item 1 edits `scripts/lib/subject-bin.ts`, and the builder key hashes that file (`BUILDER_SOURCE`). So the first
  `RUST_TS_SUBJECT=binary` run after the merge (the gate's mode, if root uses it) builds both subject binaries again, about
  350 MB. The current two (389 MB) then go after 3 days unused, or with `bun scripts/subject-bin.ts prune`. My runs used source
  mode (`DEFAULT_SUBJECT_MODE`) and built nothing.
- Scratch is cleaned (the key dumps were 77 MB).

## Not applicable

No ported code was touched, so there are no coverage rows, no `unported(...)` and no `// PORT:` decisions of the porting kind.
The compiler TOTAL is unchanged. Only the separate WRAPPER figure moves, as described in §2 N6. I did not run the full
`coverage.ts`, which writes the shared `coverage.json`.

## Notes for root

- `docs/claims/harness-w51.md` (root's claim) is left for root to delete.
- These changes touch `harness/` and `scripts/`, so they need their own review (AGENTS §2). They add two suites to
  `harness/suites.ts` and add nothing to the gate's default set.
- `PORTING.md` §5c was edited (scope-m7 N5), as item 2 assigned.
- scope-m7 N8 (handoff accuracy) concerns that lane's handoff, which I did not edit.
