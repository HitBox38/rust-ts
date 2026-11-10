APPROVE WITH NITS

# Review: root's own commits on `integ-w46` (lane `root-w46-check`)

Reviewer: independent, read-only on code. Reviewed `ea21be65` and `344a014d` (`integ-w46` at `344a014d`), run from my own
worktree fast-forwarded to it. Host: aarch64-apple-darwin, Bun 1.4.3 (`c6da4a4d3010e5553438c60f6bd76d981976867c`), on AC power.
`RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`, `RUST_TS_AGENT=root-w46-check`. The only thing I installed was `node_modules`
(`bun install --frozen-lockfile`; the tree stayed clean). I reverted every mutation with `git checkout -- <file>`.

F1 and F2 close the subject-bin review's findings as that review states them. The new tests fail when each fix is reverted. The
comment edits are true. `ea21be65` does what the fixers-50 review asked. No finding blocks the merge. The three nits are below.
N1 is the only one with any effect on the cache. It needs a config edit in a window of under a second, so it is not a must-fix.

## Findings

None.

## Nits

**N1. Bun reads `tsconfig.json` once per process, so a config edit just before `configInputs` gets a stale binary under the new
key. The post-build re-check cannot see it.** `scripts/lib/subject-bin.ts:345` (`subjectBinKey`: `configInputs`) and `:442` (the
re-check).
- Evidence, scratch fixture (a class with a field, built with `Bun.build`; a fresh process with `useDefineForClassFields: false`
  gives `621b3a5b2c`):
  - A script in the fixture directory writes that tsconfig at its top level, then calls `Bun.build`. It still gets the old
    output (`650222d490`).
  - A script that builds, edits the tsconfig, then builds again in the same process also gets `650222d490` both times.
- Bun caches the tsconfig on first read. Its runtime reads it at process start to transpile the script itself. That covers
  `bun scripts/subject-bin.ts build`, which lives in the repo, and the bundler reuses the cached copy.
- The race: `tsconfig.json` changes between the CLI's start and `configInputs(spec.repo)`, which is module-load time. The key
  hashes the new content and the build uses the old. The re-check reads the disk again, finds new = new, and passes. The
  result is the F1 failure, in a narrow window.
- A change after `configInputs` is caught by the re-check. That is correct, though only by accident: the build used the
  start-time content.
- The same cache means the fixture test at `scripts/subject-bin.test.ts:206` compiles `b` with the fixture's tsconfig as the
  test process first saw it. The test pins the key, which is the fix, not the build's content. That is fine, but it is worth
  knowing.
- Fix (cheap): refuse when any `CONFIG_FILES` mtime is ≥ `performance.timeOrigin`. Or run the bundling in a child process
  started after `configInputs`.

**N2. The post-build re-check and the contents of `CONFIG_FILES` are untested.** The commit message says "Tests for both fail
when the fix is reverted". That holds for the key and the refusal (mutants below), but these two mutants survive:
- M5: replace the re-check loop at `:442` with an empty one. 19/19 pass.
- M6: drop `"bun.lock"` from `CONFIG_FILES` (`:309`). 19/19 pass. The key test at `:134` iterates over `CONFIG_FILES`, so it
  shrinks with the list.

Fix: one assertion that `CONFIG_FILES` equals the four files the review named. The re-check could be tested with a plugin or
hook that edits the fixture's tsconfig between the two bundler passes, but given N1 that is optional.

**N3. The tests still say `closures.rs` pins FxHashSet order.** The case file's header is now right. But
`src/rustc_session/code_stats.oracle.test.ts:21-26` still introduces every case as an FxHashSet-order tie, and the test title at
`:46` is ``ties in FxHashSet order: ties/${file}`` for `closures.rs` too. The fixers-50 review's N1 pointed at that test header.
Fix: one clause in the header, or a different title for `closures.rs`.

## Checks, item by item

1. **F1 and F2 against `docs/reviews/subject-bin.md`.**
   - **F1.** `tsconfig.json`, `package.json`, `bunfig.toml` and `bun.lock` are hashed into `subjectBinKeyOf`. A missing file is
     keyed as `absent`. Key version `v: 2` drops the old builds. A unit test edits the fixture's tsconfig and expects a new key,
     as the review asked.
     - **Other bundler reads.** A bundle-only pass of `main.ts` (2,097 inputs) and `miri.ts` (2,285 inputs), with the spec's
       define, banner and plugin, reads only `.ts` files. All are under `src/` except `scripts/lib/{common,env,miri,toolchain}.ts`.
     - **`node_modules`.** No `node_modules` file is an input today. If one were, it would be keyed: in a scratch fixture that
       imports a package, the metafile lists `node_modules/foo/index.js`.
     - **Nested configs.** There is no nested `tsconfig*.json`, `package.json`, `bunfig.toml` or `jsconfig.json` under `src/`,
       `scripts/`, `harness/` or `tools/`, tracked or untracked. The root tsconfig has no `extends`.
     - **`.env` and the build environment.** `Bun.build` inlines neither `process.env.FOO` from the builder's environment nor
       a `.env` in the cwd: the output was identical with `FOO=bar` set, with `FOO=bar` in `.env`, and with neither.
       `NODE_ENV` is the define, and the banner reads it at run time.
     - **No global `~/.bunfig.toml`** exists.
   - **Post-build re-check.** It is correct as written. It compares every config file against the keyed content and handles
     `absent` on both sides. Its limit is N1.
   - **F2.** `binaryModeRefusal` refuses unless both `Bun.version` and `Bun.revision` match an entry of `VALIDATED_BUN`
     (`:83`, `:94`). The message is one line, and the CLI and `subjectBin` print it as `ERROR:`. That is the review's option (a).
   - **The refusal on every path.**
     - It is checked in `subjectBin()` (`:501`) before the CLI is spawned. The CLI runs `process.execPath`, the same Bun.
     - `scripts/subject-bin.ts build` checks it at `:24`.
     - Every other binary use goes through `subjectBin`: `subjectCmd` (harness/suites.ts `bunCmd` and the Miri driver
       command), and `prepareSubject`, which the gate (`gate.ts:596`), difftest (`difftest.ts:1035`) and phase-diff
       (`phase-diff.ts:49`) call.
     - No script outside `scripts/lib/subject-bin.ts` and `scripts/subject-bin.ts` runs a binary from `SUBJECT_BIN_DIR`
       directly.
     - The binary embeds the builder's Bun, so checking the builder's Bun is the right check.
   - **The current host.** The refusal does not wrongly refuse it: `bun -e 'Bun.version, Bun.revision'` gives
     `1.4.3 c6da4a4d3010e5553438c60f6bd76d981976867c`, the listed entry. The handoff the message cites
     (`docs/handoff/subject-bin.md`) has the depth and module-order checks.
2. **Mutation checks** (`bun test scripts/subject-bin.test.ts`, 19 tests).

   | mutant | result |
   |---|---|
   | M1: `config` left out of the key's JSON | 2 fail (key test `:134`, fixture test `:206`) |
   | M2: the `VALIDATED_BUN` check disabled | 1 fail (`:46`) |
   | M3: version only, not revision | 1 fail (`:46`) |
   | M4: revision only, not version | 1 fail (`:46`) |
   | M5: no post-build re-check | 0 fail (N2) |
   | M6: `bun.lock` dropped from `CONFIG_FILES` | 0 fail (N2) |

3. **The comment edits** (`344a014d` N3).
   - Each replaces comment lines with the same number of lines (1→1, 2→2), and no `// rustc:` marker line is in the diff. The
     marker check is clean.
   - The only tests that name these files use paths, not line numbers (`scripts/subject-bin.test.ts:63,66,221`,
     `scripts/miri.test.ts:260,300`).
   - **`miri_stack_first.ts:9`.** The claim is true: the build defines `Bun.main` as the entry's real path and rewrites
     `import.meta.dir` to the module's real dir. The subject-bin review confirmed that the Miri preload path runs the same
     modules in the same order. The new line is 249 characters, the longest in the file, to keep the line count. That is a
     style point only.
   - **`list.ts:51-52`.** The claim is true. The bundled `FREEZE_LISTS` initialiser reads
     `__rts_subject_node_env === "test"`, and the banner defines that global as a getter that returns
     `process.env["NODE_ENV"]` at run time. It is the bundle's only `NODE_ENV` read.
4. **`ea21be65`.**
   - **The header claim.** I made `print_type_sizes` iterate in insertion order
     (`[...Map.prototype.keys.call(type_sizes)]`, `src/rustc_session/code_stats.ts:221`). `ties/closures.rs` still passes, and
     `ties/locals.rs` and `ties/upvars.rs` fail. So the new header ("does not pin FxHashSet order …; the other tie files do")
     is accurate. The test's own header is not updated (N3).
   - **The `// PORT:` placement.** The `// PORT: exported for archive.test.ts (fixers-50).` line now sits above the other
     `PORT` note and the six `// crate:` markers. The last marker is directly above
     `export function tempfile_with_suffix` (`archive.ts:182-191`), as PORTING §3 and the file's other notes have it.
5. **Static checks and tests.**
   - `bunx tsc --noEmit -p .`: exit 0.
   - `bun test scripts/subject-bin.test.ts`: 19 pass.
   - `bun scripts/coverage.ts --check`: `markers ok (24896; vendor 5311; library 610)`.
   - `bun test src/rustc_session/code_stats.oracle.test.ts`: 4 pass. The pinned rustc was present, so the three ties cases ran
     rather than skipped.
   - `bun test src/rustc_codegen_ssa/back/archive`: 1 pass.
