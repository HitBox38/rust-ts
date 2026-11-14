# Review: fixer lane `fixers-58` (wave 40r), queued nits

Reviewer, independent and read-only. Subject: branch `t3/fixers-58-queued-nits`, commits `b2015af3`, `64ac80a1`, `3149b5cc`,
`12fd90b7`, `3e9913bd`, `bc48b759`, `95c728c5` on main `e80bc814` (`git diff e80bc814 95c728c5`, 14 files, +259 −25). Handoff:
`docs/handoff/fixers-58.md`. Reviewed on branch `review/fixers-58` at `95c728c5`.

Setup: `.env.local` copied from `integ-w39`, plus `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`;
`bun install --frozen-lockfile`. On AC power the whole time. No `GATE_RUNNING` file existed.

## Verdict: **APPROVE WITH NITS**

No behaviour change. All nine findings are fixed as their reviews asked. The new tests fail under the mutations that matter.
Three nits follow (N1–N3). None blocks the merge.

## 1. Behaviour scan of the whole diff

- **Non-test code.** Leaving out comments and test files, the diff changes three things:
  - the order of methods in `triple.ts`;
  - the new export `with_fresh_llvm_init_for_tests` in `llvm_util.ts`, with its import;
  - nothing else.
- **Comment-only changes.** Every other change in a non-test file is a comment: `target.ts:203`, `codegen_backend.ts:335-338`,
  `regen.ts:13-14` and `pathdiff/lib.ts:10-13, :78`. I checked this by filtering out every `//`, `*` and `/**` line from the diff.
- **`triple.ts` is order-only.**
  - Every removed line comes back unchanged: `isOSFirmware` (Triple.h:954) and `isX86_64` (:1204) move below `isPS`.
  - The `isPS4`, `isPS5` and `isPS` bodies are untouched.
  - All 33 `Triple.h` markers in the class now follow header order: 880 → 894 → 900 → 906 → 954 → 1204 → 1235.
- **`with_fresh_llvm_init_for_tests` is test-only.**
  - Outside its definition, the repo references it only in `src/rustc_codegen_llvm/skeleton.test.ts`. The same holds for
    `with_fresh_llvm_options_for_tests`, which is used in `target.ts` and two test files.
  - It saves `INIT.completed`, clears it, and calls `with_fresh_llvm_options_for_tests(f)` inside `try`. It restores `INIT` in
    `finally` (`llvm_util.ts:50-58`), and the inner helper restores the options in its own `finally`. So a stop (`Unported`,
    `bug`) or a failing `expect` inside `f` still leaves both as they were.
  - Nesting works, and the test exercises it (see §2.1).

## 2. Each item

1. **fixers-57 N1, N2: fixed.**
   - N1: `docs/handoff/cg-lto-diag.md:50-51` now says that only the clearing of `dso_local` is ELF-only. That is what
     `cg-lto-diag.md` 194-197 asks for.
   - N2: `skeleton.test.ts:363-382` covers both options N2 offered.
     - It asserts that `INIT` is not completed when the wrapped body starts (`print` throws "LLVM is not initialized").
     - It drives `init`, then checks that a nested call resets a completed `INIT` and empty options, and restores them.
     - The `require_inited` check that used to follow the wrapper now sits inside it, which is correct because `INIT` is put back
       afterwards.
   - **Does the test fail if the reset is removed?** Yes. Mutation M1 (below) gives `14 pass, 1 fail`. Removing the restore (M2)
     also fails. In isolation the first assertion passes only because `INIT` starts out false. The nested call is the part that
     models "an earlier file already completed `init`", and that part catches both mutations.
2. **llir-tools-recheck-2 closing note 2: fixed, with N2.**
   - The test, `tools.test.ts:407-428`: with `-Zsplit-lto-unit` it expects exit 70, the exact stop text, and no `opt.bc`.
     Without the flag it expects exit 0, empty stderr, and an `opt.bc`.
   - **Is it sound?**
     - The pinned rustc accepts the `-Zsplit-lto-unit` command (exit 0, `opt.bc` 4160 bytes), so stopping by name is the
       right result for the port.
     - With the R1 stop disabled (M5), the test fails: exit 101, an ICE from opt's SIGABRT ("module flag identifiers must be
       unique").
   - **Is it cheap?**
     - Wall time is 2.14 s for the single test, including loading the file. That is two driver runs.
     - Its output goes in `llvm_tmp_dir()` subdirectories, which the describe's `afterAll` (`:164`) removes. The child
       processes left no temp directories behind.
   - **Environment.**
     - The test reads no variable by name. It passes `{ ...process.env, RUSTC_ICE, RUST_BACKTRACE }` to the child, the same
       pattern as `:292`. By the rules of `scripts/lib/unit-steps.test.ts`, spreading the environment into a child counts as no
       read.
     - The one variable that could falsify the child is `RUST_TS_IMPL`, and the gate refuses that one
       (`UNIT_ENV_REFUSED`).
     - `unit-steps.test.ts` passes on this tree.
   - **Is the success branch compared with the oracle?** No: it checks only exit code, stderr and existence. I compared by hand.
     - `opt.ll` matches the oracle's at N1, N2 and N3 (`scripts/lib/ir-normal.ts` `normalForm`). A raw diff shows only the
       demangled-name comments, a `preds` order (use lists, llir-uselist) and `mustprogress` on an intrinsic declaration.
     - `opt.bc` does **not** match the oracle's byte for byte: 4276 bytes against 4124. Disassembled, the differences are:
       - opt's extra `!{i32 1, !"EnableSplitLTOUnit", i32 0}`;
       - the metadata renumbering that follows from it;
       - the summary's module hash.
     - That is exactly the accepted difference in llir-tools' handoff PORT 8 (`docs/handoff/llir-tools.md:221-226`). The F4 test
       already checks it, as the only difference in the disassembly, at the wrapper level.
   - **Is that enough?** Yes, for what this test is for. It shows that the stop is reachable through the driver and does not fire
     on an ordinary module. A byte comparison would fail by design, and the content is pinned by F4. See N2 for a cheap
     strengthening.
3. **llir-init-recheck R1, R3, R4: fixed.**
   - R1: see §1.
   - R3: `target.oracle.test.ts:165-167` asserts `TLSSize` is `[24, undefined]` on the AArch64 and X86 machines.
   - R4: `target.oracle.test.ts:309-320` names the failing step. When `SYSROOT` is empty, it names
     `rustc +nightly --print sysroot`. Otherwise it names the missing dylib path or the host.
     - `existsSync` is imported, and tsc is clean.
     - I did not rerun the case with rustc removed from `PATH`. The branches are plain conditions on values the module already
       computes.
   - Mutation M3 (an `isPS4` body) fails `target.oracle.test.ts`.
4. **root-w57-check N1: fixed, with N3.**
   - The markers are on the right lines:
     - `// crate: pathdiff-0.2.3/src/lib.rs:247 assert_diff_paths` sits directly above the function (`lib.test.ts:29-30`), and
       upstream `fn assert_diff_paths` is at lib.rs:247.
     - `...:177 abs` sits directly above `const abs` (`lib.test.ts:42-43`), inside `test_absolute` (:176). Upstream `fn abs` is
       at lib.rs:177.
   - The `crate-skip` line is in the accepted format: `// crate-skip: pathdiff-0.2.3/src/lib.rs:121 diff_utf8_paths
     cfg(feature = "camino") is off` (`lib.ts:78`).
     - It has the same shape as the ena and pulldown-cmark precedents.
     - It sits after `diff_paths` (:43), which is upstream order.
     - `coverage.ts` counts it: `pathdiff-0.2.3 10/10 100.0% (1 skipped)`.
5. **mono-run-head N3: fixed, with N1.**
   - **The PORT note.** `codegen_backend.ts:335-338` names what the copy duplicates: llvm_backend.rs:336-357 and
     base.rs:723-739.
   - **The test.** `src/rust_ts/codegen_backend.test.ts` compares the two heads on one stub `tcx`.
     - It records how each run stops and the emitter's bytes through a real `DiagCtxt` and `AnnotateSnippetEmitter`.
     - It asserts that the copy and the port are equal, and also checks an expected stop for each case. So two heads that both
       broke the same way would still fail.
     - I checked the cases against upstream base.rs:716-739 and llvm_backend.rs:336-357.
       - The `-Zoffload` case sets `need_explicit_cpu`. A copy without the offload check would therefore hit `CpuRequired`.
       - `CpuUnsupported` sets both conditions.
     - `CodegenUnitNameBuilder::new(tcx)` (base.rs:735), which the copy leaves out, has no output.
   - **Mutations.**
     - Disabling the copy's `CpuUnsupported` check (M4a): 1 fail.
     - Commenting out its collector call (M4c): 1 fail.
     - The lane's two mutations, a swapped diagnostic and a changed key, are of the same kind.
     - Dropping the `Device` arm of the copy's offload check (M4b) **passes 4/4** (N1).
   - **Cost:** 4 tests in 0.21 s.
   - **Is a test outside the file list acceptable?** Yes. It is a new test file next to `codegen_backend.ts`, it tests only that
     file, and it imports nothing it changes. The handoff reports it.
   - **Not done:** the optional cross-reference in base.ts's `codegen_crate` (base.ts belongs to ir-fix-a). The handoff hands it
     to root.
6. **ssa-archive-recheck note 2: fixed.** `regen.ts:13-14` and `docs/handoff/ssa-archive.md:91-92` name both sections.

## 3. Mutations

Each mutation was applied with `sed` and reverted with `git checkout -- <file>`. `git status` was clean after each one.

| # | Mutation | Test run | Result |
|---|---|---|---|
| M1 | `llvm_util.ts:52` `INIT.completed = false;` removed | `skeleton.test.ts` | 14 pass, **1 fail** |
| M2 | `llvm_util.ts:56` `INIT.completed = saved;` removed | `skeleton.test.ts` | 14 pass, **1 fail** |
| M3 | `triple.ts:330` `isPS4` tests `"PS5"` | `target.oracle.test.ts` | 18 pass, **1 fail** |
| M4a | `codegen_backend.ts:349` `CpuUnsupported` condition made `false` | `codegen_backend.test.ts` | 3 pass, **1 fail** |
| M4b | `codegen_backend.ts:342` `Device` arm of the offload check dropped | `codegen_backend.test.ts` | 4 pass, 0 fail (N1) |
| M4c | `codegen_backend.ts:356` collector call commented out | `codegen_backend.test.ts` | 3 pass, **1 fail** |
| M5 | `tools.ts:720` R1 stop disabled | `tools.test.ts -t 'R1 end to end'` | **fail** (exit 101, opt SIGABRT) |

M5's ICE kept its input under `$RUST_TS_DATA/tmp/llir/40562/`, as D16 says it should. I removed that directory. It was mine,
and nothing else had been written to it.

## 4. Commands

| Check | Result |
|---|---|
| `bunx tsc` | exit 0 (10.1 s) |
| `bun scripts/coverage.ts --check` | `markers ok (27154, 74 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5326; library 745; llvm 524)` |
| `bun test ./src/rust_ts/llvm/ ./src/rustc_codegen_llvm/ ./src/vendor/pathdiff/ ./src/rust_ts/ ./scripts/lib/unit-steps.test.ts`, `CI=1` | 430 pass, 0 fail, 0 skip, 42 files (87.6 s) |
| the same, `CI` unset | 430 pass, 0 fail, 0 skip, 42 files (88.7 s) |
| `RUST_TS_AGENT=review-fixers-58 difftest --suite mono-ui --sample 200 --jobs 6` | MATCH 200/200, 488 skipped (run `20261114-133323-review-fixers-58-lith`, 45.7 s) |

## Findings

- **N1 (test gap).** `src/rust_ts/codegen_backend.test.ts:65`: the only `-Zoffload` case is `[{ $: "Host" }]`. A copy that
  drops the `Device` arm of `codegen_backend.ts:342`, or a ported head that does, still passes, as M4b shows. A fifth case with
  `offload: [{ $: "Device" }]` and `need_explicit_cpu: true` would cover it at no measurable cost.
- **N2 (test strength, optional).** `src/rust_ts/llvm/tools.test.ts:292-295`: the control branch checks exit code, stderr and
  that `opt.bc` exists.
  - The port's `opt.bc` is not the oracle's: 4276 bytes against 4124, because of PORT 8's extra `EnableSplitLTOUnit` 0 flag. The
    `opt.ll` written by the same command matches the oracle at N1.
  - Either of two changes would make the branch say what is true:
    - compare that `opt.ll` with the pinned rustc's at N1, which costs one more oracle run of about 0.3 s;
    - or add a comment that the bitcode differs from the oracle's by PORT 8, and that F4 pins the content.
  - The handoff's "4276 bytes, the size the reviewer saw" is accurate, but it can be read as matching the oracle, which it does
    not.
- **N3 (order, pre-existing).** `src/vendor/pathdiff/lib.test.ts:30`: `assert_diff_paths` (lib.rs:247) is the last fn upstream,
  but it sits first in the `describe`. Now that it carries a marker, the misplacement is visible. A function declaration is
  hoisted, so it can move below `test_current_directory` (lib.rs:241) without any other change.

**For root:** the optional base.ts cross-reference from mono-run-head N3 is still open (it is ir-fix-a's file).
