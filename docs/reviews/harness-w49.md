APPROVE WITH NITS

# Review: harness batch `harness-w49` (wave 40i)

Branch `t3/harness-w49`, commits `0bf9b004` (Item A, handoff) and `920fb64c` (Item B), against merge base `1b4bf086`.
Independent read-only review. I edited no code; I ran the checks below in scratch worktrees of `920fb64c`, on AC power, with
`RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0 RUSTC_ICE=0`.

No must-fix findings. Item A's rule matches compiletest at the pin for every component in tests/ui, and it registers 500 new
keys (100 per suite in five suites), with none lost or changed, as the handoff says. Item B's fixes do what the reviews asked,
and the tests I mutated catch the mutants, with one exception (N2). Four nits.

## Findings (must fix)

None.

## Nits

- **N1. An empty or unreadable symbol table is read as "every optional component missing", not as "undecided".**
  `harness/compiletest.ts:769` takes any `nm` that exits 0 as the full symbol table, and `:750` answers
  `present: symbols.has(sym)`. When `nm` prints nothing and exits 0, every `needs-llvm-components` line *ignores* its test
  with "ignored when the x86 LLVM component is missing", a confident wrong answer. That happens for a stripped library, or for
  a future pin whose driver links LLVM statically with local symbols stripped. Evidence: with a stub `nm` (`exit 0`, no output)
  first on PATH, `llvmComponentsLineDecision("//@ needs-llvm-components: x86")` gives
  `{"ignore":"ignored when the x86 LLVM component is missing"}`, and `tests/ui/abi/avr-sram.rs` gives 0 cases with
  "ignored by compiletest on x86_64-unknown-linux-gnu: ignored when the avr LLVM component is missing". On Linux, GNU `nm` may
  also print versioned names (`LLVMInitializeX86TargetInfo@LLVM_…`), which `nmSymbols` (`:731`) keeps as they are, so they
  would not match either. This is not a silent loss once the cases are protected: a protected case that becomes skipped is
  `lost` with its reason (`scripts/gate.ts:652-657`, `lostSkipped`). Before acceptance, though, the case list shrinks with a
  wrong reason. The behaviour is correct on the root host today: all 19 initializers show as `U _LLVMInitialize…TargetInfo`.
  Suggested fix, cheap: treat the table as undecided (the `string` branch) when it names no TargetInfo initializer at all, or
  none for the host's own architecture (rustc cannot run without it). Strip an `@…` version suffix in `nmSymbols`. Add one
  test with an empty table.
- **N2. `gateRun`'s use of `gateEnvRefusal` is not tested.** The handoff says "Mutant: back to `??` → fail" (harness-w48 N3).
  That holds inside `gateEnvRefusal` (`scripts/gate-unit.test.ts:302`), but the call site's mutant survives. I changed
  `scripts/gate.ts:603` back to `freezeEnvRefusal() ?? unitEnvRefusal(process.env)`, and `bun test scripts/gate-unit.test.ts`
  passed (1 pass, 0 fail). No test starts `gateRun` with both families set. It is a one-line call site, so a nit; one assertion
  in the gate-power or gate-probes child (start with `NODE_ENV` and `REGEN` both set, expect the joined text) would close it.
- **N3. `subject-bin-compare.ts` lost the "N more" line for 6 to 10 errors.** `scripts/subject-bin-compare.ts:106` prints
  `... more` only when `lines.length + notes.length > 10`. With 7 `ERROR:` lines and no notes, it prints 5 errors and no hint
  that 2 more exist (before this batch it printed `... 2 more`). The summary's `differs=7` and the exit code are still right.
  Fix: print the "more" line per list (`lines.length > 5`, `notes.length > 5`) with its count, as before.
- **N4. The decision reads the oracle's LLVM, not COMPILETEST_TARGET's.** The module emulates compiletest for
  `COMPILETEST_TARGET = x86_64-unknown-linux-gnu` (`harness/compiletest.ts:115`), but `oracleLlvmComponents` reads the
  aarch64-apple-darwin driver. Reading the oracle's LLVM is the right input, since the oracle is what must compile the case, and
  CI builds the same `LLVM_TARGETS_TO_BUILD` for both dist hosts, so the result is the same. The header comment
  (`:688-705`) should say so in one line, so that a later reader does not "fix" it.

## Checks

### 1. Item A against compiletest at the pin

- **directives.rs `ignore_llvm` (`src/tools/compiletest/src/directives.rs:1252`).**
  `parse_name_value_directive(line, "needs-llvm-components")`, then the first entry of `needed.split_whitespace()` that is not
  in `config.llvm_components.split_whitespace()` ignores the test with "ignored when the {c} LLVM component is missing". With
  `COMPILETEST_REQUIRE_ALL_LLVM_COMPONENTS` it panics instead (CI only). `llvmComponentsDecision` matches this: same order, same
  reason text, the env var left unset (as a local bootstrap run has it). `nameValueDirective` (`harness/compiletest.ts:201`)
  rejects a missing colon or an empty value, where compiletest panics (`directives.rs:674-698`); a test pins both. The new
  branch sits after the generic `needs-*` branch, which already excludes `needs-llvm-components` (needs.rs `:105` does the
  same), so the directive reaches it.
- **Symbol present ⇔ component in `llvm-config --components`.** Read from the pinned sources:
  - `compiler/rustc_llvm/build.rs:228-240` keeps exactly the `--components` entries that are in `REQUIRED_COMPONENTS ∪
    OPTIONAL_COMPONENTS`, panics if a required one is missing, and emits `cfg(llvm_component = "<c>")` for each one kept.
  - `src/lib.rs` `init_target!` (`:74-...`) defines the init fn only under that cfg, and its first function is
    `LLVMInitialize<T>TargetInfo` for all 19 optional components (the parser checks this and throws if not).
  - So, for an optional component: it is in the list ⇔ the cfg is set ⇔ the driver references the initializer.
  - A required component is always in the list.
  - Any other name (a non-target component such as `asmprinter`, an alias, a typo) cannot be decided from the driver. It is
    rejected with a reason, never guessed, and no tests/ui test names one.
- **Components in tests/ui at the pin.** I grepped every `needs-llvm-components:` value: x86 162, aarch64 78, arm 50, riscv 49,
  sparc 24, systemz 22, powerpc 21, nvptx 18, mips 17, loongarch 15, webassembly 14, avr 14, msp430 9, bpf 7, amdgpu 7, m68k 6,
  hexagon 6, csky 4, xtensa 1. These are exactly the 19 `OPTIONAL_COMPONENTS`; no required, unknown or alias names.
- **The oracle driver.** `nm` of `librustc_driver-3bee00c5d9e363a9.dylib` (nightly-2026-10-11, Mach-O arm64) lists all 19
  `U _LLVMInitialize…TargetInfo`, so every line continues, as compiletest would decide against this LLVM. `nm` takes 0.16 s.
- **The lists come from the pinned sources.** `oracleLlvmComponents` parses `$UPSTREAM/compiler/rustc_llvm/{build.rs,src/lib.rs}`
  (UPSTREAM at `6f5da406`, the pin). The parser throws `ERROR:` on a missing list, a component with no `init_target!`, an
  `init_target!` outside the list, or a first fn that is not a TargetInfo initializer; tests cover all four.
- **Hand checks.**
  - `tests/ui/abi/avr-sram.rs`: four revisions, each `[rev] needs-llvm-components: avr` plus `--target avr-none`;
    `ignore-backends: gcc` continues. All four are now cases, and all stop `unported` (`rustc_target::spec::targets::avr_none`),
    which is right: compiletest would run them.
  - `min-llvm-version` (`tests/ui/asm/global-target-feature.rs#riscv`): stays skipped with "`min-llvm-version` … is not
    evaluated". Correct: compiletest would compare against `llvm_version` (the oracle says 23.1.3), which this harness does not
    evaluate. It also has `add-minicore`. All 8 files skipped on `min-llvm-version` / `max-llvm-major-version` have
    `add-minicore` too, so they would stay skipped either way.
  - `add-minicore` (`tests/ui/abi/arm-unadjusted-intrinsic.rs#arm`): stays skipped ("`add-minicore` (builds minicore) is not
    reproduced"). Correct: compiletest would build minicore and pass `--extern minicore`; this corpus does not build it, so its
    command cannot be reproduced.
  - Every other directive of the new cases is decided by the existing, reviewed chain. The only status change is this one
    directive's.

### 2. Protected sets and keys (reproduced)

- `bun scripts/oracle-keys.ts --out`:
  - **before**, on this review worktree, whose `harness/` and `scripts/` equal `1b4bf086`: 372,181 keys, sha1 `6d1b393c…`.
  - **after**, on `920fb64c`: 372,681 keys, sha1 `d4ab0b61…`.
  - Both sha1s are byte-identical to the handoff's.
- Compared by (suite, id): **0 lost, 0 changed, 500 new**: tydump-minicore, thirdump-minicore, mirdump-minicore, mir-minicore and
  mir-o0, 100 each. The 100 new ids are the same set in all five.
- `git diff 1b4bf086...t3/harness-w49 -- harness/baseline`: empty.
- `bun scripts/difftest.ts --suite mir-minicore --jobs 6` on the branch (run `review-harness-w49-mir-minicore`):
  - total 146, MATCH 87, DIFF 0, UNPORTED 59, no CRASH, TIMEOUT, ORACLE_TIMEOUT or UNSTABLE, skipped 489.
  - All **46/46** protected cases MATCH; 87 − 46 = 41 new MATCH, matching the handoff.

### 3. Robustness

| situation | result |
|---|---|
| `nm` not on PATH (`Bun.spawnSync` throws) | caught; each optional component rejects with "`nm librustc_driver-….dylib` failed, so the oracle's LLVM components are unknown": a skip with a reason. Tested by stub. |
| `nm` exits non-zero | same. Tested by stub. |
| no driver library matches `^(lib)?rustc_driver-[0-9a-f]+\.(dll\|so\|dylib)$` in `sysroot/{lib,bin}` (a renamed dylib) | "no rustc_driver library in the oracle sysroot": a skip with a reason. |
| `nm` exits 0 with no usable symbols | wrong but confident "ignored": **N1**. |

- Once the cases are protected, any of these turns them into `lost` with the skip reason in gate.json (`lostSkipped`), so
  the gate cannot silently drop them.
- Nothing registers a case without a positive symbol match.
- Caching: the result is memoized per process (`llvmComponentsMemo`) and not cached on disk. It is recomputed from
  `oracleSysroot()` of the pinned toolchain in each process, so it is keyed to the oracle toolchain by construction. At 0.16 s
  per read, a disk cache is not needed.
- `uiCases`'s memo key includes `llvm-components|`, so the two rules never share an entry.

### 4. Item B

Mutants, each run against its covering test. I checked each against an unmutated baseline: the subject-bin cases gave 31 pass,
0 fail.

| mutant | result |
|---|---|
| prune without the second look (`again` always undefined) | fails "prune keeps a build a run resolves between prune's look and its removal" |
| `rewriteImportMeta` leftover check off | fails "a match the line-by-line judgment gets wrong stops the build" |
| `rewriteImportMeta` count check off | fails (subject-bin.test.ts) |
| stale-config throw off | fails (subject-bin.test.ts) |
| mtime rule off (`>= Infinity`) | fails "staleConfigs: in this module's own repo…" |
| Item A: undecided component taken as present | fails harness/compiletest.test.ts (9 pass, 1 fail) |
| `gateRun` call site back to `??` | **survives** (N2) |

- **Prune race** (`pruneSubjectBins`, `finished`). I walked through every interleaving of a resolver R (`finished`: utimes
  `meta.json` first, then read it and check the binary) against a prune P (look, rename to `.trash-*`, look again, rename back
  or remove):
  - R marks before P's first look: P skips.
  - R marks between P's look and P's rename: P's second look sees the mark and renames the build back. If R built the same key
    anew in that window, the rename back fails (the target is not empty) and only the old copy goes.
  - R's utimes or read after the rename: ENOENT, `finished` returns `undefined`, and R builds anew, so nothing in use is
    touched.
  - Two prunes: the second one's rename fails (ENOENT) and it skips. A `.trash-*` dir that a second prune finds is removed
    only when its mark is old, which means no resolver marked it before the move, and none can mark it after (resolvers look
    only at `<root>/<key>`).
  - So no build that was marked used is lost, and none is deleted while a resolver can still reach it by name, except the
    documented window: R resolved before the move and spawns between the move and the move back. That window is microseconds
    wide, needs a build idle for 3 days, and fails loudly as a spawn error.
  - A running process keeps its open inode in any case.
- **`import.meta` check** (`metaCodeUses`). `Bun.Transpiler` `define` replaces code uses only, with dead-code elimination off.
  The rewrite must replace exactly as many uses of each property as Bun parses, and the result must leave none. A use in a
  type position (erased by the transpiler) would be refused, not miscompiled: conservative. The four test texts cover the
  template, block-comment, `*`-line and cancelling cases. The handoff reports that every currently accepted module still
  passes; the unit steps below build through it.
- **Config mtime refusal** (`staleConfigs`).
  - In the module's own repo, a config file with mtime ≥ `performance.timeOrigin` refuses the build. In any other repo, the
    contents are compared with the first build's. The message says to build in a new process.
  - Gate and difftest build through the `scripts/subject-bin.ts build` child, whose `timeOrigin` is its own start, so the
    root-w46-check N1 window is closed there.
  - A same-content touch (a checkout) makes a long-lived process refuse with a clear message: conservative, acceptable.
  - The fixture test now rebuilds in a child after its tsconfig edit, as the fix requires.
- **perf-subject-bin N1** (`orderArgs`): every word before `--` must be a tool option, `--env` may repeat, and single options
  given twice are refused. The tests cover both review holes.
- **perf-subject-bin N4** (`benchRefusal`): battery and `GATE_RUNNING`, each with its override. `pmset` is unavailable on
  non-macOS (`null`), which gives no refusal, as the gate does.
- **harness-w48 N1, N2** (env scan): reads `process.env`, `Bun.env` and `import.meta.env` in dot, `["X"]` and destructuring
  forms. Unnamed reads are pinned to a listed set of four files, each with a reason. `_PROBE` is matched as a suffix only, and
  `TYREPR_PROBE` must be found. These ran in the runner step.
- **harness-w48 N4** (`limitMs`): the end-to-end timed-out case ran in the runner step.
- **subject-bin N6**: one-sided timeouts are their own count with a `note:`, and the exit code is unchanged. See N3 for the
  print limit.
- **Declining subject-bin N5** is reasonable. The review itself concluded that about 160 MB per build is fine for root and that
  lanes stay on `source`. A count cap would break the "used within 3 days stays" guarantee that protects a running gate's
  binary.

### 5. Unit steps and tsc (on `920fb64c`, one at a time, as `unitStaticSteps` + `runStaticStep`)

| step | tests | failures | skipped | time |
|---|---|---|---|---|
| runner unit tests | 436 | 0 | 0 | 64 s |
| unit tests (src/tools, workers) | 7396 | 0 | 1 (allowlisted) | 355 s |
| unit tests (alone) | 39 | 0 | 0 | 92 s |

These are the same counts as the handoff's. All steps pass, and none has an unexpected skip under `RUST_TS_REQUIRE_PROBES=1`.

`bunx tsc --noEmit -p .`: clean.

Scratch to delete: `$RUST_TS_DATA/runs/review-harness-w49-mir-minicore`.
