APPROVE WITH NITS

# Review: harness batch `harness-w51` (wave 40l)

Branch `t3/harness-report-suites`, commits `fe9bdb9b`, `ba8d9811`, `cbef2ddc`, `8b846ca3`; diff
`git diff b3772ebb...t3/harness-report-suites` (22 files, +1168/−72). The reviewer is independent and read-only on code. Host:
AC power (`pmset`: "Now drawing from 'AC Power'"), no `GATE_RUNNING`, Bun 1.4.4. `.env.local` came from `integ-w39`, with
`RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`. No subject binary was built, nothing was written into
`$RUST_TS_DATA/llvm-src/`, and the upstream checkout was clean afterwards.

There are no must-fix findings. Every claim in the handoff that I could reproduce held, down to the exact counts and sha1s.

## What I checked, with evidence

### 1. The prune (`scripts/lib/bun-pin.ts` `pruneGateBunDirs`, `scripts/gate.ts` `gateBunClone`)

I built a scratch `gate-bun/` and ran the real `pruneGateBunDirs` on it. Pids: a `sleep 60` stood in for a live process, and an
exited `true` gave a dead pid.

| entry | expected | result |
|---|---|---|
| `{pid: dead, child: live}` (orphaned second process) | kept | **kept** |
| `{pid: live}` (only the first process recorded) | kept | **kept** |
| `{pid: dead, child: dead}` | removed | removed |
| a dead run dir holding links `inner` → an outside dir and `innerfile` → an outside file | removed, outside left intact | removed; **outside intact** |
| entry `run-linkdir`: a link (lstat 1 h old) to an outside dir whose `owner.json` names a dead pid | the link goes, not its target | the link went; **target and its files intact** |
| entry `run-linkfile`: an old link to a file | the link only | the link only |
| `owner.json` = `null` | no live pid | removed |
| half-made dir, fresh / 1 h old | kept / removed | kept / removed |
| entry removed between listing and look (`afterList`) | skipped, no throw | `[]`, no throw |
| after the `sleep` ends: both live-pid dirs | removed | removed |

A symlink inside `gate-bun/` cannot make the prune delete outside it. `lstatSync` never follows the entry, and Bun's
`rmSync(..., {recursive: true})` removes a link inside a removed directory without traversing it. The outside files survived
both cases.

`subject-bin prune --pre-v4` (`prunePreV4Builds`, `scripts/lib/subject-bin.ts:666`), run on a scratch root:
- **Removed:** a meta with `bun` but no `sha1`, a meta with `sha1: null`, and a top-level link to an outside dir with such a
  meta. Only the link was removed; the outside `rts` and `meta.json` were intact.
- **Kept:** a `v: 4` build (`sha1` a string), a dir with no meta, a meta that does not parse, a meta without `bun`, `.tmp-*`
  and `.trash-*`.
- **No current build can be touched.** Every build that current code finishes writes `bun: builderBun()`
  (`subject-bin.ts:593`), and that always carries `sha1`. Only a build made by a checkout older than `e71d868d` can match.

### 2. The finder and the marker checks

- **Finder before and after.** I ran `git show b3772ebb:scripts/lib/cpp-fns.ts` and the branch's `cppFns` over all 56
  manifest files (from `$RUST_TS_DATA/llvm-src/<commit>/`) and every `.cpp`/`.h` of the wrappers: 4,749 definitions before and
  4,759 after. The `diff` holds exactly 10 added lines and nothing removed: `IRBuilder.h` 2899, 2905, 2910, 2914, 2923, 2930,
  2937, 2946 (`IRBuilder`) and 2958, 2959 (`getInserter`). The wrappers give 218 both times. **Confirmed.**
- **Synthetic inputs.** The old and new finder agree on trailing return types (`-> std::vector<int> {`, `-> llvm::Value {`), a
  qualified brace base (`: ns::Base{1} {`), a ternary in a default argument, `const` methods and `S<int> s = S<int>{};`. The new
  finder fixes the scope-m7 cases: `template <typename T = int> class Box` and the `Base{a}, Member(a) {` case.
- **A typo'd wrapper path now fails.** I temporarily edited the marker at `src/rust_ts/llvm/core.ts:175`, ran
  `coverage.ts --check --offline` on each version, and reverted.
  - `llvm_wrapper/RustWrapper.cpp:145`, `llvm-wrapper/RustWrapper.cc:145` and `src/lib.rs:19` each give
    `ERROR: … names neither a wrapper function … nor a fn of compiler/rustc_llvm's Rust`, exit 1.
  - A wrong line (`RustWrapper.cpp:146`) gives `matches no C++ function definition`, exit 1.
  - A typo in the crate name passes (N2).
- **`llvm-src add` refuses bad paths and writes nothing.**
  - Five argument sets each print one `ERROR: add: … nothing fetched or written` and exit 1: `../..`,
    `../../llvm-project/llvm/lib/IR/Core.cpp`, `llvm/lib/IR/Core.cpp ./x`, `/etc/passwd`, and the same path given twice.
  - The listing of `$RUST_TS_DATA/llvm-src` had the same md5 before and after. `find -newer` found nothing new, and
    `harness/llvm-manifest.json` was unchanged.
- **WRAPPER denominator.** By file it is right: 218 − 11 (`CoverageMappingWrapper.cpp`) − 10 (`offload/OffloadWrapper.cpp`) =
  **197 in 6 files**. I recounted by D18's list (see N1): 15 more functions are reachable only from Rust that D18 excludes.

### 3. The new suites

- **Report-only.** Neither suite has a file in `harness/baseline/`. `gate.ts` `protectedSuites()` (`gate.ts:623`) is that
  directory, so neither is in the default set. Both are declared like `cli`: `mode: "single"`, 60 s timeouts, and no baseline.
- **`target-specs` list.** `supportedTargets(mod.rs)` gives 334 tuples. Sorted, they are byte-identical (`cmp`) to
  `rustc +nightly-2026-10-11 --print target-list`, which reports `rustc 1.101.0-nightly (6f5da406b 2026-10-10)` and whose output
  is already bytewise sorted.
- **`target-specs` argv.** It is `--print target-spec-json --target <t> -Zunstable-options --sysroot <oracle sysroot>`, with
  env `CLI_ENV`.
- **The 6 MATCH cases.** They are exactly the 6 modules under `src/rustc_target/spec/targets/`:
  - `aarch64_apple_darwin`
  - `aarch64_unknown_linux_gnu`
  - `wasm32_wasip2`
  - `x86_64_apple_darwin`
  - `x86_64_pc_windows_msvc`
  - `x86_64_unknown_linux_gnu`
- **`stats-ui` argv matches `docs/handoff/stats.md`.**
  - `macro-stats.rs` equals `uiCases`' argv without `-Zparse-crate-root-only`, element for element.
  - `meta-stats.rs` is the same plus a trailing `--emit=metadata`.
  - `input-stats.rs` differs from `macro-stats.rs` in exactly three elements: the file, the `--out-dir`, and
    `-Zinput-stats`/`-Zmacro-stats`.
  - The UI cases' env equals `uiCases`' env.
  - A crate case is check-ui's argv plus the flag, with identical env. Both sides go through `rmeta-run.ts` with no
    `--bytes`/`--dump`, and the subject goes through `subjectCmd`.
- **Oracle determinism.** I ran 50 `stats-ui` cases twice through the suite's own oracle commands, with `caseEnv` from the
  upstream checkout. The sample was all 3 UI tests plus 47 crate cases (18 input, 18 macro, 11 meta), one of them with exit 1.
  All **50 of 50 were identical** in exit, stdout sha1 and stderr sha1. As an extra check, 30 `target-specs` cases ran twice
  and were all identical as well.

### 4. The oracle-key dump

I ran `bun scripts/oracle-keys.ts` at `b3772ebb` and at `8b846ca3`:
- **Before:** 374,690 keys, sha1 `a3e1b6e58756…`.
- **After:** 377,217 keys, sha1 `c34544623e40…`.
- **Diff:** a single hunk `374690a374691,377217` with 0 `<` lines, adding `stats-ui` 2,193 and `target-specs` 334.
- Both sha1s match the handoff.

### 5. The subject-bin change

The change is correct, but it was not needed in that file (N3). `BUILDER_SOURCE` is the hash of `scripts/lib/subject-bin.ts`
itself (`:349`), and it goes into every build key (`:442`). Adding `prunePreV4Builds` there re-keys both binaries, as the
handoff says. Put in the CLI (`scripts/subject-bin.ts`, which is not hashed), it would have re-keyed nothing. The cost is one
rebuild (~350 MB). Any change to the subject's src inputs causes that same rebuild anyway.

### 6. Static checks

- **Runner unit step as the gate runs it:** `unitStaticSteps(<runner unit tests>)` + `runStaticStep` from `scripts/gate.ts`.
  - It ran under `$S/bunclone/bun`, an APFS clone (`cp -c`) of `~/.bun/bin/bun`, with a `bunx` link and that dir first on
    PATH (`process.execPath` = the clone), and `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0 RUSTC_ICE=0`.
  - Result: pass. The junit report shows **558 tests, 0 failures, 0 skipped**, and the gate reports 0 allowlisted and 0 not
    allowed, in 86 s at load ~20.
- **`bun scripts/coverage.ts --check --offline`:**
  `markers ok (25786, 32 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 735; llvm 174)`, the same as the
  handoff.
- **`bunx tsc --noEmit -p .`:** exit 0, no output.

## Findings (must fix)

None.

## Nits

**N1. The WRAPPER figure still counts 15 functions that only D18-excluded Rust reaches** (`scripts/lib/llvm-src.ts`
`WRAPPER_EXCLUDED`, `:166`).
- **Method.** I grepped each `LLVM*` wrapper function of the 6 counted files in `rustc_codegen_llvm/src`, leaving out
  `llvm/ffi.rs`, the seam. These 15 are called only from files that `harness/scope.json` excludes under D18.
- **14 are reached only through Enzyme/`-Zautodiff`** (`llvm/enzyme_ffi.rs`, with `typetree.rs` also calling `IsCall`). All
  are in RustWrapper.cpp:
  - `LLVMRustHasAttributeAtIndex` (398)
  - `LLVMRustGetTerminator` (419)
  - `LLVMRustEraseInstFromParent` (424)
  - `LLVMRustGetArrayNumElements` (650)
  - `LLVMRustGetLastInstruction` (944)
  - `LLVMRustEraseInstUntilInclusive` (951)
  - `LLVMRustHasMetadata` (969)
  - `LLVMRustDIGetInstMetadata` (976)
  - `LLVMRustRemoveEnumAttributeAtIndex` (985)
  - `LLVMRustPositionBefore` (1414)
  - `LLVMRustPositionAfter` (1420)
  - `LLVMRustGetFunctionCall` (1428)
  - `LLVMRustIsCall` (165)
  - `LLVMRustVerifyFunction` (194)
- **1 is reached only through `-Zoffload`** (`builder/gpu_offload.rs`): `LLVMRustPositionBuilderPastAllocas` (RustWrapper.cpp:1403).
- **Effect.** By D18's list the denominator is 182, or 181 without the dead `#if` branch `PassWrapper.cpp:543` that the handoff
  left in. WRAPPER cannot reach 197 without `rustc-skip:` markers, which is scope-m7 N6's complaint at a smaller scale.
- **Fix.** Either add per-function entries next to the file entries, or record in decision 2 that the figure excludes D18 by
  file only. Root's call.

**N2. A crate-name typo in a `// rustc:` marker still passes `--check`** (`scripts/lib/llvm-src.ts:211` checks only paths under
`compiler/rustc_llvm/`).
- **Evidence.** Each of these passes with `markers ok`: `compiler/rustc-llvm/llvm-wrapper/RustWrapper.cpp:145`,
  `compiler/rustc_midle/src/ty/mod.rs:145` and `compiler/rustc_codegen_gcc/src/lib.rs:145`.
- **Scope.** This is older than the batch and general: any marker into a crate directory that does not exist, or into an
  excluded crate, goes unchecked. It is the same class of typo as scope-m7 N2.
- **Fix.** In a later harness batch, refuse a `// rustc: compiler/<crate>/` whose `<crate>` is not a directory of the checkout.

**N3. `prunePreV4Builds` sits in the hashed builder module** (`scripts/lib/subject-bin.ts:666`; key `:349`, `:442`).
- **Effect.** Every build is re-keyed for a function the builder never calls.
- **Fix.** Keep such CLI-only helpers in `scripts/subject-bin.ts`, or note the rule in the lib's header. The lib's own header
  could warn that any edit to it rebuilds both binaries.

**N4. An orphan can be pruned in a short window** (`scripts/gate.ts:888-889`).
- **Effect.** `owner.json` gains `child` only after `Bun.spawn` returns. A SIGKILL of the first process between the spawn and
  the rename leaves an orphan whose copy a later prune will remove. The window is two synchronous syscalls.
- **Fix.** None needed. The `gate.ts` header's "`owner.json` records both processes" could say "once the second has started".

**N5. Duplicated comment** (`scripts/lib/unit-steps.test.ts:93`). The line holds the comment `// Lane unit-parallel: the
src/tools step runs in workers, …` twice, back to back (253 chars).

**N6. Handoff accuracy** (`docs/handoff/harness-w51.md:3`). It gives the branch as `t3/b73a6e2f`, but no such branch exists. The
branch is `t3/harness-report-suites`, the same slip as scope-m7 N8.
