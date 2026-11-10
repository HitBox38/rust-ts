# harness-w49 (wave 40i): minicore `needs-llvm-components`, and queued harness nits

Harness batch: `harness/` and `scripts/` runner code and tests only. No `src/`, baseline, oracle output, suite expectation or
runner-verdict change. No baseline grows here: the new cases join the protected set only through a gate's accept.

## Files touched

| file | what |
|---|---|
| `harness/compiletest.ts` | `needs-llvm-components` evaluated as directives.rs `ignore_llvm` behind a new `llvmComponents` option (`uiCases`, `uiFileCases`, `ignoreDecision`); `rustcLlvmComponents`, `nmSymbols`, `llvmComponentOracle`, `oracleLlvmComponents`, `llvmComponentsDecision`, `llvmComponentsLineDecision` (tests) |
| `harness/suites.ts` | `minicoreCorpus` passes `{ llvmComponents: true }`; header comment |
| `harness/compiletest.test.ts` | 2 tests (decision and parse; old rule kept for other callers) |
| `scripts/gate.ts` | `gateEnvRefusal` (harness-w48 N3); `StaticStep.limitMs`, `STATIC_STEP_LIMIT_MS` (N4) |
| `scripts/gate-unit.test.ts` | N3 and N4 end to end |
| `scripts/lib/unit-steps.ts` | `UNIT_ENV_REFUSED` header: the forms the scan sees and its boundary (N1, N2) |
| `scripts/lib/unit-steps.test.ts` | `envReads` widened, `unnamedEnvReads` + `UNIT_ENV_UNNAMED`, `_PROBE` writer suffix, two harmless names (N1, N2) |
| `scripts/subject-bin-order.ts` | `orderArgs`: every word before `--` must be a tool option; argument count on the result line (perf-subject-bin N1) |
| `scripts/subject-bin-bench.ts` | `benchRefusal`: battery and `GATE_RUNNING`, with `--allow-battery` / `--allow-gate` (perf-subject-bin N4) |
| `scripts/lib/subject-bin.ts` | `staleConfigs` (root-w46-check N1); `afterBuild` test hook (N2); prune through `.trash-*` with a second look, `finished` marks first and tolerates ENOENT (subject-bin N1); `metaCodeUses` check of the `import.meta` rewrite (subject-bin N2) |
| `scripts/subject-bin-compare.ts` | `one-side-timed-out` count with a `note:` (subject-bin N6) |
| `scripts/subject-bin.cases.ts` | tests for all of the above in scripts/subject-bin.ts's family |

## Item A: `needs-llvm-components` in the minicore corpus

### How compiletest decides, and how the harness now does

- directives.rs `ignore_llvm` (pin, `:1252`), called per directive line in `make_test_description`'s `decision!` chain: with
  `needs-llvm-components: <c>...`, the first listed component not in `config.llvm_components` ignores the test ("ignored when
  the <c> LLVM component is missing"); otherwise it continues. A directive without a value panics (`parse_name_value_directive`).
- `config.llvm_components` is bootstrap's `llvm-config --components` of the LLVM that built the compiler under test
  (build_steps/test.rs `:2857`). The oracle is a dist toolchain with no `llvm-config`, so the list is read from its
  `rustc_driver`, by upstream's construction (compiler/rustc_llvm at the pin):
  - build.rs keeps the `llvm-config --components` entries that are in `REQUIRED_COMPONENTS` (it panics if one is missing) or
    `OPTIONAL_COMPONENTS` (19 target components), and sets `cfg(llvm_component = "<c>")` for each kept;
  - src/lib.rs `initialize_available_targets` calls a component's `init_target!` functions (the first is
    `LLVMInitialize<T>TargetInfo`) only under that cfg.
  - So a required component is always in the list, and an optional one is in it iff `rustc_driver`'s symbol table (`nm`)
    names its TargetInfo initializer. Both lists and the component -> symbol pairs are parsed from the pinned sources, not copied.
- The oracle (`nightly-2026-10-11`, aarch64-apple-darwin) imports all 19 initializers from `libLLVM.dylib` (`nm -u
  librustc_driver-*.dylib`), and `libLLVM.dylib` defines all 19. So every component in tests/ui (`x86` 162 lines ... `xtensa` 1;
  all 19 are optional components) is present, and every `needs-llvm-components` line continues, as compiletest would decide
  against this LLVM.
- Not decided, so the test is still rejected with the reason: a component in neither list (none in tests/ui at the pin), any
  component when `nm` fails or no driver is found (e.g. Windows). Never guessed.
- Scope (my decision, as the `needs` precedent of harness-w36): only callers that pass `llvmComponents` evaluate it. That is
  `minicoreCorpus`, which **five** suites share: tydump-minicore, thirdump-minicore, mirdump-minicore, mir-minicore, mir-o0
  (the brief named the last three; the corpus is one function, so all five get the cases). Every other caller keeps the old
  rule (the directive rejects the test), so no other suite's case set changes. The proc-macro, run and Miri suites (`needs:
  true`) could take it next; not done here.

### Would it register cases compiletest would not?

No. The directive now continues exactly when compiletest's `ignore_llvm` continues for this LLVM, and every other directive of
those tests is decided as before. A test whose old rejection hid a later one now shows that one.

### Oracle-key dump (all registered cases, every suite)

`bun scripts/oracle-keys.ts --out <file>`, before on a clean worktree at HEAD `1b4bf086`, after on this branch:

| | keys | suites not listed | sha1 |
|---|---|---|---|
| before | 372,181 | 0 | `6d1b393ca38299f366dd85f1dbdea12af009c41b` |
| after | 372,681 | 0 | `d4ab0b6119beb5615138207542912f0327b053ec` |

Compared by (suite, case id): **0 lost, 0 changed, 500 new**, all in the five minicore-corpus suites. (A second dump with
Item B's changes also in is in "Evidence" below.)

### New cases per suite, and results

The scout's "520 skipped" counts every case whose first rejection was this directive. In mir-minicore (same in each suite)
those 520 cases now go:

| now | cases |
|---|---|
| **case** | **100** |
| skipped: `add-minicore` (builds minicore) is not reproduced | 368 |
| skipped: `min-llvm-version` / `max-llvm-major-version` not evaluated | 13 + 7 |
| skipped: needs an auxiliary crate (the minicore corpus builds none) | 29 |
| skipped: `needs-asm-support` is not evaluated by this harness | 3 |

The scout's 132 "target only the port's specs" included `add-minicore` tests, which stay skipped. Every case id is the same
before and after (635 per suite); only the 520 change status.

`difftest --suite <s> --jobs 6` (run ids `harness-w49-<suite>`; `--filter` takes one substring and each suite has only 146
cases, 46 old + 100 new, so I ran the suites whole, source mode):

| suite | new cases | MATCH | DIFF | UNPORTED | old 46 (all protected) |
|---|---|---|---|---|---|
| tydump-minicore | 100 | 41 | 0 | 59 | 46 MATCH |
| thirdump-minicore | 100 | 41 | 0 | 59 | 46 MATCH |
| mirdump-minicore | 100 | 41 | 0 | 59 | 46 MATCH |
| mir-minicore | 100 | 41 | 0 | 59 | 46 MATCH |
| mir-o0 | 100 | 41 | 0 | 59 | 46 MATCH |

The per-case statuses are the same in all five suites. No CRASH, TIMEOUT, ORACLE_TIMEOUT or UNSTABLE. The 59 UNPORTED stops:
57 are other targets' specs (`rustc_target::spec::targets::*`): i686_unknown_linux_gnu 11, avr_none 6, nvptx64_nvidia_cuda 4,
3 each for aarch64_unknown_none, aarch64_pc_windows_gnullvm, i686_pc_windows_gnu, i686_pc_windows_gnullvm,
i686_uwp_windows_gnu, x86_64_pc_windows_gnu, x86_64_pc_windows_gnullvm, x86_64_uwp_windows_gnu and
aarch64_unknown_linux_pauthtest, 2 each for x86_64_unknown_none and amdgcn_amd_amdhsa, and 1 each for
armv7_unknown_linux_gnueabihf, riscv32i_unknown_none_elf, riscv64gc_unknown_none_elf, m68k_unknown_linux_gnu and
x86_64_unknown_uefi. The other two are `rustc_codegen_llvm::llvm_util::configure_llvm (-Z fixed-x18)` (abi/fixed_x18.rs#x64)
and `rustc_target::spec::TargetTuple::from_path (--target <path>.json)` (codegen/mismatched-data-layouts.rs).

By directory (new cases, MATCH / UNPORTED): abi 0/10, codegen 0/1, compile-flags/invalid 3/0, …/function-return 6/1,
…/indirect-branch-cs-prefix 2/1, …/reg-struct-return 2/1, …/regparm 2/6, crate-loading 0/2, debuginfo 7/21, linkage-attr 3/0,
linking 7/0, pointer_authentication 5/2, sanitizer 2/3, sanitizer/cfi 0/2, stack-protector 0/3, statics 0/1, target-cpu 0/5,
target-feature 2/0.

So a gate that runs these suites would protect 41 new cases in each of the five (205 in all).

## Item B: queued harness nits

Every fix has a test that fails without it (mutants below, each run against the test file that covers it).

### docs/reviews/harness-w48.md

- **N1** (scan misses `Bun.env`, destructuring, computed names). `envReads` now sees `process.env`, `Bun.env` and
  `import.meta.env`, in dot, `["X"]` and destructuring forms (`{ X, Y: y, Z = d, ...rest } = <env>`). Reads it cannot name (a
  computed key, a computed destructuring key, the env object assigned to a name) are found by `unnamedEnvReads`; a test file
  with one must be in `UNIT_ENV_UNNAMED` with why (four today: gate-unit, std/env, anstyle_query, probes/fixtures), and each
  listed file must still have one. The wider scan found two real reads: `scripts/gate-power.test.ts` and `gate-probes.test.ts`
  destructure `NODE_ENV` and `RUST_TS_FREEZE_LISTS` out of the environment they give a gate. Both are named harmless: the gate
  refuses to start with either set. The `UNIT_ENV_REFUSED` header now names the forms. Mutants: `ENV_OBJ` limited to
  `process.env` → fail; destructuring keys dropped → fail; the `x = <env>` alias pattern disabled → fail.
- **N2** (helpers scanned for writer names only; `PROBE` missing). `_PROBE` added as a **suffix** only: in the middle it would
  match `FAKE_PROBE_EXIT` (a stub's exit code), which the review's "only the three refused ones" did not count. The test now also
  requires `TYREPR_PROBE` to be found. The boundary (helper knobs such as `RUST_TS_ALIAS_MONO` are neither listed nor refused) is
  stated in the `UNIT_ENV_REFUSED` header, as the review allowed. Mutant: `_PROBE$` dropped → fail.
- **N3** (one family per refusal). `gateEnvRefusal` joins `freezeEnvRefusal` and `unitEnvRefusal` with "; and ", and
  `gateRun` uses it. Mutant: back to `??` → fail.
- **N4** (timed-out wording tested only directly). `StaticStep.limitMs` (default `STATIC_STEP_LIMIT_MS`, 30 min). A new
  end-to-end case runs a one-process step whose test sleeps 60 s under a 1 s limit, and expects "wrote no junit report … (bun
  test timed out)" plus the timed-out `crashedLine` naming `src/h.test.ts`. Mutants: call site `crashedLine(last, false)` →
  fail; `limitMs` ignored → fail.

### docs/reviews/perf-subject-bin.md

- **N1** (two holes in the `--` guard). `orderArgs` replaces the guard: every word before `--` must be one of the tool's options
  (`--entry`/`--cwd`/`--env` with a value, `--keep`/`--verbose` as bare flags). So `-- --keep --version` (Bun drops the `--`) and
  `--entry m.ts --version` (forgotten `--`) are both refused, naming the word. Also fixed: `--env` given twice kept only the
  last (parseArgs overwrote it), and the result line now shows the subject's argument count. Mutants: the old "any option
  present" rule → fail; `--env` not repeatable → fail.
- **N4** (bench runs on battery or during a gate). `benchRefusal`: on battery (`pmset`, parsed as the gate does) or while
  `$RUST_TS_DATA/tmp/GATE_RUNNING` exists, unless `--allow-battery` / `--allow-gate`. Mutants: either check off → fail.

### docs/reviews/root-w46-check.md

- **N1** (a `tsconfig.json` edit in the window before the key is computed). `staleConfigs`, checked at the start of every
  build. In the builder module's own repo (the runtime read its config at process start) a config file with mtime ≥
  `performance.timeOrigin` is stale. In any other repo the contents are compared with those this process saw at its first build
  there. A stale file refuses the build: "changed after this process first read it, and Bun keeps the first copy: build in a new
  process". The gate and difftest build through the CLI child (`subjectBin` spawns `scripts/subject-bin.ts build`), whose
  `timeOrigin` is its own start, so the window is now closed there. The F1 fixture test now rebuilds after its tsconfig edit in
  a new process, as the fix requires, and checks that the in-process build is refused. Mutants: the throw off → fail; the mtime
  rule off → fail.
- **N2** (re-check and `CONFIG_FILES` untested). One assertion pins `CONFIG_FILES` to the four files. A test-only `afterBuild`
  hook (run right after the bundler's second pass) edits the fixture's tsconfig, then an input, mid-build: both builds stop
  ("… changed while src/entry.ts was being built") and leave the cache as it was. Mutants M5 (empty config re-check) and M6
  (`bun.lock` dropped) from the review → both fail now.

### docs/reviews/subject-bin.md

- **N1** (prune race). `pruneSubjectBins` moves an old build to `.trash-<name>-<pid>-<rand>`, looks at its `meta.json` again
  there, and moves it back if a run marked it used in between (else removes it). `finished` now marks `meta.json` used before
  anything else and treats ENOENT as "no build" (the run builds anew), not an error. A test hook (`afterLook`) marks the build
  as a resolver would, inside the window: the build stays and the next resolve finds it. Without a resolver it is removed and
  no trash is left, and a resolver after the move builds again. Left: a run that resolved in the microseconds between the
  move and the move back, and spawns in that window, fails to spawn. That needs a build idle for 3 days plus that exact timing,
  and it shows as a loss, not a silent pass. Mutants: no second look → fail; ENOENT not tolerated → fail.
- **N2** (per-line `import.meta` rewrite). The line-based replacement is now checked against Bun's own parse. `metaCodeUses`
  transpiles with `define` mapping each `import.meta.<prop>` to a marker, and `define` touches only code (not comments,
  strings, template text or regexes). The replacements of each property must equal its code uses, and the rewritten text must
  have none left; otherwise the build stops. Tests: a multi-line template line and a block comment line are refused; a code
  line starting with `*` is refused (the count, then the leftover check when both errors cancel in the count). All 32 modules of
  src/ and scripts/lib/ that the rewrite accepted at HEAD still pass (and scripts/lib/unit-steps.ts, whose new comment names
  `import.meta.env`); the same 2 non-bundle files are refused as before.
  Mutants: count check off → fail; leftover check off → fail.
- **N5** (disk use): **not fixed in code**. The review's own conclusion is that ~160 MB a build is fine for root and lanes
  stay on `source` (the default). A count cap would break the guarantee that a build resolved within 3 days stays, so a lane's
  builds could evict a running gate's binary. Today `$RUST_TS_DATA/subject-bin` holds 2 builds (352 MB), and none is keyed to
  this worktree (I built none; difftest ran in source mode).
- **N6** (one-sided timeouts). `compareRecords` gives `one side timed out` (which side, both times) when only one side timed
  out; `timed out` now means both. The CLI counts `one-side-timed-out` separately and prints a `note:` per process, not an
  `ERROR:`: a time under load is noisy, and the exit code stays that of differs/missing. A CLI test checks the counts, the note
  and exit 0. Mutant: one-sided folded back into `timed out` → fail.

### Mutation runs, Item A

Run against harness/compiletest.test.ts: a missing component not ignored, the option not passed through `uiFileCases`, an
undecided component taken as present, required components not short-circuited, the Mach-O `_` not stripped, and the directive
evaluated for every caller. Each one fails the tests.

## Evidence

- `bunx tsc --noEmit -p .`: clean.
- Unit steps as the gate runs them (`unitStaticSteps` + `runStaticStep` from scripts/gate.ts, one at a time, parent with
  `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0 RUSTC_ICE=0`, source mode):

  | step | tests | failures | skipped | time |
  |---|---|---|---|---|
  | runner unit tests | 436 | 0 | 0 | 80 s |
  | unit tests (src/tools, workers) | 7396 | 0 | 1 (allowlisted) | 535 s |
  | unit tests (alone) | 39 | 0 | 0 | 156 s |

  Runner 436 = 434 (harness-w48) + the 2 new compiletest tests; the other new checks sit in existing tests.
- Oracle-key dump: above (0 lost, 0 changed, 500 new). A final dump with every change of this branch in is byte-identical to the "after" dump
  (372,681 keys, sha1 `d4ab0b61…`), so Item B moved no key.
- Load during the src/tools step was 15-18 (three porter lanes on the machine).

## `unported(...)` and `// PORT:`

None (no ported code touched). Coverage unchanged (no `src/` change).

## Notes for root

- The scout's "132 cases" was an overcount for this change: 100 per suite become cases; the rest were `add-minicore` tests.
- A gate that runs these suites would protect 41 new cases in each of five suites. tydump-minicore and thirdump-minicore get the
  same new cases as the three suites the brief named.
- Next candidates of the same kind: `min-llvm-version` / `max-llvm-major-version` (20 minicore cases; the oracle prints `LLVM
  version: 23.1.3` in `rustc -vV`), and `needs-llvm-components` for the `needs: true` suites (pm, run, Miri).
- Scratch runs to delete when no longer needed: `$RUST_TS_DATA/runs/harness-w49-*` (5 dirs).
