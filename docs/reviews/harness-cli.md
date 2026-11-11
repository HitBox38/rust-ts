APPROVE WITH NITS

# Review: harness-cli (wave 40j), the `cli` report suite

Reviewer: independent, read-only. Batch: branch `t3/add-cli-report-suite`, commit `a162f53c`, against its merge base
`0ce28aa2` (`harness/cli.ts`, `harness/cli.test.ts`, `harness/suites.ts` +18/-1, `docs/handoff/harness-cli.md`). Everything
below was run on the root host (aarch64-apple-darwin, M4 Pro), on AC power, with no gate running, from this worktree with
`.env.local` copied from integ-w39, `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0 RUSTC_ICE=0`, `--jobs 6` at most.

No must-fix findings. Every claim in the handoff that I checked reproduced. There are four nits.

## 1. Report-only

- There is no `harness/baseline/cli.txt` (the new unit test asserts this, `harness/cli.test.ts:222`). `gate.ts run` without
  `--suites` runs only `protectedSuites()`, the `.txt` files in `harness/baseline` (`scripts/gate.ts:595`, `:784-787`), so it never
  reaches `cli`. The suite is declared like `rlib-native` (`harness/suites.ts:2488`) and `mir-heavy` (`:1154`): a plain
  `SUITES` entry with no baseline and no flag. It has no `heavy` field.
- `accept`: a default run has no `cli` entry in `gate.json`, so `accept` (which loops over `g.suites`, `scripts/gate.ts:758`)
  cannot create a baseline for it. A run of `--suites cli` alone is refused, because the protected suites were not run (`:753`).
  - **Observation (not this batch's to fix):** the suite is report-only only because no baseline file exists. A run with
    `--suites <every protected suite>,cli`, followed by `accept`, would write `harness/baseline/cli.txt` with the 49 MATCH cases.
    The same holds for `rlib-native`, `mir-heavy` and every other report suite today. It can only happen if someone names
    `cli` on purpose, not by accident.

## 2. The lists are derived

- **Error codes.** `explainCodes` gives 518 codes. I compared them with the `error_codes!` macro body in
  `compiler/rustc_error_codes/src/lib.rs`: the same 518. That includes the 4 entries marked `// REMOVED:` in the macro, which
  still have a `.md`, and the directory has nothing other than `E\d{4}.md`.
- **Removed codes.** `removedCodes` finds 135 lines. Every line in lib.rs's tail that starts with a code is one of them, and the
  three continuation comments that mention a code (`//         // as E0412`, …) are rightly skipped. All 135 are unique. Five
  of them have a description (E0445, E0722, E0744, E0776, E0796), which leaves 130 `explain` cases, as claimed.
- **Print kinds.** `printKinds` finds 27 kinds. They are identical, name for name, to the oracle's
  `error: unknown print request: help … valid print requests are: …` list. I also checked stability against the oracle: each of
  the 27 kinds run with `--target x86_64-unknown-linux-gnu --sysroot <oracle>` and no `-Z`. Exactly the 9 kinds the parser marks
  unstable error with "unstable-options": `all-target-specs-json`, `backend-has-mnemonic`, `backend-has-zstd`, `check-cfg`,
  `crate-root-lint-levels`, `supported-crate-types`, `target-spec-json`, `target-spec-json-schema`, `wasm-proc-macro-tuple`.
- `mnemonicExample` gives `RET` and `specialUnknownRequests` gives `["lints"]`, both matching upstream. Categories are right:
  3 `Crate` kinds, and 2 `Linker` kinds that never get an input.
- The parsers fail loudly (`ERROR:` throw) when a variant lacks a name, category or stability. See N2 for two quiet gaps.

## 3. Determinism of the oracle side

- **Colour.** `--explain … --color always` with no tty goes through `show_colored_md_content`, which writes through
  `anstream::Stdout::always`. The markdown renderer's width is the constant `DEFAULT_COLUMN_WIDTH = 140`
  (`rustc_errors/src/markdown/term.rs:8`) and nothing in the compiler changes it, so the output does not depend on the terminal.
  The pager path needs `stdout().is_terminal()`, and difftest pipes stdout. The scrubbed environment (`scripts/lib/env.ts`)
  unsets `CLICOLOR*`, `NO_COLOR`, `FORCE_COLOR`, `TERM`, `COLORTERM` and the Apple `*_DEPLOYMENT_TARGET` variables. That last
  part matters for the host's `print deployment-target`, `target-spec-json` and `cfg`.
- **Sysroot.** Every `print` and `print-unstable` case carries `--sysroot <oracleSysroot()>`. This holds in the generated
  cases (I dumped all 2,009) and is asserted by the unit test.
- **Oracle run twice, no cache.** I ran the oracle twice per case outside difftest, with difftest's cwd (the upstream checkout)
  and env (`caseEnv`), on 187 cases: every `print`, `print-unstable`, `W-help`, `ls=root` and `ls=all` case, plus every 25th
  `explain`, `explain-color` and `crate-root-lint-levels` case.
  - Result: 0 runs differed, 0 cache entries were missing, and 0 disagreed with the cached oracle output in exit code and
    stdout.
  - Exit codes: explain 21×0 and 5×1 (removed codes), explain-color 21×0, W-help 2×0, print 47×0 and 15×1, print-unstable
    9×1, crate-root 29×0, ls 38×0.
- **Sample runs.** `bun scripts/difftest.ts --suite cli --sample 100 --jobs 6`, run twice (runs `20261111-024855-…-xd47` and
  `20261111-024922-…-w6sy`): both show MATCH 0 and UNPORTED 100. The sha1 of the sorted (id, status) lists is identical,
  `2d22259d…`. The sample held only explain, explain-color and crate-root cases, all UNPORTED; that is why I added the direct
  oracle check above and the filter runs below.
- **Filter runs.** `--filter print`, `--filter W-help` and `--filter ls=`:
  - print 62: MATCH 40, UNPORTED 22;
  - print-unstable 9: all 9 MATCH;
  - W-help 2 and ls 38: all UNPORTED;
  - DIFF, CRASH and TIMEOUT: 0.

  This is the handoff's 49 MATCH.
- **`-Zls` inputs.** I built std's closure without std (`libClosure("std")` minus std, 19 crates) with `oracleLibRmeta` into a
  throwaway `RUST_TS_DATA` (upstream symlinked, since deleted). It took 25 s at load average about 20. All 19 rmetas are
  byte-identical to the ones the cases point at.
  - core's directory key (`m5-core-7c361f5788808ce7`) is the same.
  - The keys of the 18 crates with dependencies differ, because their argv holds the dependencies' absolute
    `$RUST_TS_DATA/aux/…` paths. The rmeta's path, which is in the case argv and so in the cache key, therefore changes
    whenever its inputs, argv, env, the rustc_driver build or the data dir change. A rebuilt rmeta with other content always
    has a new path, so the oracle re-runs.
- **No writes.** `git status --porcelain --ignored` of the upstream checkout shows only the existing `build/` after all of the
  above, and `find -newer <stamp>` over the checkout is empty. Nothing new appeared in the scratch cwd.
  - `crate-root-lint-levels` keeps check-ui's `--emit=metadata` with no `-o`, but `print_crate_info` returns
    `Compilation::Stop` first. No case gives the Linker kinds an input.

## 4. Exclusions

- **Host `target-cpus`: justified.** On this host it prints `native - Select the CPU of the current host (currently apple-m4)`.
  See N1 for the CLI-target side.
- **`link-args` and `native-static-libs` with an input: justified.** They would run codegen and the host linker, and write a
  binary into the checkout.
- **`sysroot` and `target-libdir` without `--sysroot`: justified.** They print the rustup install path, which no key covers.
- **Other host dependence.** I ran every host-target print kind and grepped for `currently` / `native` / `apple-m`. The only
  hit is `target-features`, which lists `apple-m4 - Apple M4.` and `apple-m5 - Apple M5.`. Those are LLVM's static AArch64 tuning
  features, listed whatever the CPU, not the host's CPU.
  - rustc builds `target-features` from the target machine at the spec's CPU unless `-Ctarget-cpu=native` is given, which no
    case passes. Host `cfg` has no hits.
  - The other host-target outputs depend on the host tuple, which `oracleVersion` (the host's rustc_driver build) covers.
  - Nothing else host-dependent is left in.

## 5. Oracle-key dump

`bun scripts/oracle-keys.ts --out …`, at `0ce28aa2`, then at `a162f53c`, in this worktree:
- before: 372,681 keys, sha1 `d4ab0b6119beb5615138207542912f0327b053ec`, 0 suites not listed;
- after: 374,690 keys, sha1 `e374a56768d2667c416a0070869ce6a4ed66e287`, 0 not listed.

`grep -v '^cli\t' after | cmp - before` is byte-identical. There are 2,009 `cli` lines with 2,009 distinct keys, and no key is
duplicated anywhere in the after dump. (`main` has moved on to `759492bc` since, with only a `docs/next.md` change.)

## 6. Runner unit step and tsc

- I ran `unitStaticSteps(<runner unit step>)` and `runStaticStep`, imported from `scripts/gate.ts` as the gate runs them.
  Result: `runner unit tests` pass. The junit report has 440 tests, 0 failures and 0 skips; the skip allowlist reports 0, under
  `RUST_TS_REQUIRE_PROBES=1`. It took 64 s.
- `bunx tsc --noEmit -p .`: clean.

## Nits

- **N1. `harness/cli.ts:30`, `:172`: the CLI target can get a `native` line on other hosts.** The header says `target-cpus` is
  "Kept for the CLI target, which has no `native` line" (the handoff says the same). Upstream prints the `native` line whenever
  `sess.host.arch == sess.target.arch` (`rustc_codegen_llvm/src/llvm_util.rs:550-560`; the comment there reads "Only print the
  'native' entry when host and target are the same arch").
  - So on any x86_64 host (x86_64 Linux, macOS or Windows, which AGENTS.md §5 still mentions), `print target-cpus --target
    x86_64-unknown-linux-gnu` names the host's CPU model: the same problem the host exclusion avoids.
  - The gate runs only on the aarch64 root host and the key covers the host's rustc_driver build, so nothing is wrong today.
  - Fix: word the header as "on a host whose arch differs from the CLI target's", or skip both `target-cpus` cases when the
    host arch is x86_64.
- **N2. Two parser gaps that fail quietly.**
  - `harness/cli.ts:65`: `removedCodes` scans all of lib.rs (`^//\s+E\d{4},`, multiline) rather than the part after
    `// Undocumented removed error codes`.
  - `:100`: the `PrintKind` variant regex `^\s*(\w+),` would silently drop a variant written without a trailing comma, and
    extra `name`/`category` arms are never compared with the variant list.
  - Neither happens at the pin (the oracle cross-check above matches exactly), and rustfmt keeps trailing commas. Cheap
    hardening: scope the removed-code scan to the tail, and throw if `names.size !== variants.length`.
- **N3. `harness/suites.ts:2525`, `harness/cli.ts:226`: listing the suite builds the aux rmetas.**
  - `cases()` builds any missing `-Zls` rmeta with the oracle (`oracleLibRmeta`) as a side effect of listing. This happens for
    `--filter explain`, for `scripts/oracle-keys.ts`, and in the new unit test (`harness/cli.test.ts:173`).
  - So that unit test is the first one in the gate's `runner unit tests` step that runs oracle builds, on a fresh data dir or
    after a pin bump (the rustc_driver hash is in the key).
  - If an aux build fails, the whole suite cannot be listed, the explain cases included.
  - Measured: 25 s for all 19 crates from scratch at load average about 20, against the test's 120 s limit. Acceptable, but it
    should be in the handoff's notes for root (or the `-Zls` paths could be made lazy, per case).
- **N4. `harness/cli.ts:156-157`: a branch is left without a case.**
  - The 130 removed codes all take the same `early_fatal("… is not a valid error code")` path.
  - No case reaches the branches where `handle_explain`'s parse fails (`--explain foo`) or where `code <= ErrCode::MAX_AS_U32`
    is false. `ErrCode` is a `newtype_index!` (`rustc_errors/src/codes.rs:17`), so its maximum is 0xFFFF_FF00: e.g.
    `--explain E4294967295` parses but is over it. (`E99999` would only take the missing-description path again.) Adding those
    two would cover every branch of `handle_explain` cheaply.
  - Optional; the handoff already lists other possible additions.
