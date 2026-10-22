ACCEPT-WITH-NOTES

# Review: harness-w20 (`lane/harness-w20`, `d5cecdfc..b4b2793b`)

Reviewer: review-harness-w20 (independent, read-only on the lane checkout `.data/lanes/harness-w20`, HEAD `b4b2793b`, clean).

- **Scope:** `git diff --stat d5cecdfc..b4b2793b`:
  - `harness/compiletest.ts` (+420/-36)
  - `harness/suites.ts` (+86)
  - `scripts/difftest.ts` (+87)
  - new `harness/compiletest.test.ts`
  - `docs/handoff/harness-w20.md`
  - `docs/state/{current.json,history.jsonl}` (one decision)
  - No baseline, oracle-cache, probe, `src/` or `tools/` changes.
- **Build:**
  - `bunx tsc --noEmit -p .` in the lane prints nothing.
  - `bun test scripts harness` and `bun test harness scripts` both give 16 pass, 0 fail.
- **Merge:** the base `d5cecdfc` (integ-w19) is not on `main` yet. `git merge-tree main b4b2793b` conflicts only in `docs/state/current.json` and
  `docs/state/history.jsonl`. `harness/` and `scripts/` merge cleanly.

**Summary.**
- The existing suites are byte-identical. I checked this myself over every case, not a sample.
- The new suites mirror compiletest's argv and aux-crate handling faithfully.
- Building the aux crates as rmeta does not change the oracle output. I checked this by rebuilding them as full rlibs.
- There is no result tampering.
- The notes below are robustness issues in the aux build step. None of them can make an existing protected case pass or fail wrongly.

## 1. Existing suites unchanged: verified

- **Method:** a scratch script (`/tmp/rv-hw20/tools/hashsuites.ts`) loads `harness/suites.ts` from each tree in its own process:
  - the base tree, from `git archive d5cecdfc` into `/tmp/rv-hw20/old`;
  - the lane checkout.
- **What it hashes, per suite:**
  - every case's `[id, file, args, env, oracle([c]), subject([c])]`;
  - for batch suites, also `oracle(allCases)` and `subject(allCases)`;
  - `skipped()`;
  - the metadata: mode, cwd, timeouts, probes, `readsOnlyCaseFile`, the `oracle([empty])` head (the input of `oracleVersion`), and the key set.
  - The repo root is normalized (realpath) before hashing.
- **Result:** all 24 existing suites are identical. Every case of every suite was compared (25,780 lex/tokens/escape, 21.5k each for the ui-corpus
  suites, and so on).
- **Cache keys:**
  - `cachePath`, `fileHash`, `depsOf`, `oracleVersion` and `runOracle` are untouched in `scripts/difftest.ts`.
  - Their inputs (PIN, oracle head, name, id, args, file, env, deps) are identical.
  - So no existing oracle cache key changes.
- **MATCH logic:** `classify`/`firstDiffLine` are untouched. The difftest hunks are only:
  - the header;
  - the new `BlessedResult` types and helpers;
  - `RunOptions.report`;
  - the return type;
  - the `--report` validation;
  - one `blessedResults.push` after `results.push(r)` (`scripts/difftest.ts:514`);
  - the subset and blessed tallies;
  - the summary fields;
  - the CLI lines.
- **How the existing callers stay unchanged:**
  - `compileArgs` dropped its trailing `-Zparse-crate-root-only`. `uiFileCases` now appends it after the aux `--extern`s; existing suites have none,
    so their argv is identical (confirmed by the hashes).
  - `testProps` reads the new directives only with `extra`, which existing callers never pass.

## 2. New suites: faithful to compiletest and plan-m3 §4

**Case selection.**
- typeck: 250 files. traits: 1277 files. Both match the plan.
- With revisions there are 1744 typeck+traits cases.
- `#[rustc_dump_*]`:
  - I found 111 files by an independent grep (`#!?\[[^]]*rustc_dump_\w+`, outside `auxiliary/`).
  - The only extra raw `rustc_dump_` hit is a comment, in `tests/ui/layout/trivial-bounds-sized.rs:39`.
  - That gives 119 cases, as the handoff says.
- thir-print: 11 cases.
- Totals: tydump-ui 1849 cases, thirdump-ui 1860, 15 skipped each. These match the handoff.

**Argv against `src/tools/compiletest` at the pin.**
- *`build_all_auxiliary`* (runtest.rs:1274):
  - order is builds, then bins, then crates (`--extern` added right after each crate is built);
  - `path_to_crate_name` is the same;
  - modifiers become `mods:name=`.
  - Proc macros are rejected before any build, which is conservative and matches plan-m2 D6.
- *`build_auxiliary`* (runtest.rs:1393):
  - aux paths resolve against the root test's `auxiliary/`, also for nested crates;
  - the same revision is used;
  - `make_compile_args` gets `Emit::None`, `AllowUnused::No` and `LinkToAux::No`;
  - the nested `build_all_auxiliary` runs into the same directory (`bin/` for bins);
  - after that come `--crate-type dylib|lib|bin` (none for `no-prefer-dynamic`) and `-L <dir>`. The lane's order is identical (`compiletest.ts:619-638`).
- *`from_aux_file`:* there is no pass/fail default and the aux file's own revisions/check-cfg are used.
  - `add-minicore` and `incremental` in an aux file are rejected.
  - `-O` for a `run-pass` aux file is still applied, as upstream does.
- *`make_compile_args` `LinkToAux::Yes`:* `-L <aux dir>` comes after the external rustcflags and before the compile-flags, only when `has_aux_dir`
  (aux-bin alone gives no `-L`). This matches runtest.rs:1996.
- *`parse_aux_crate` / `parse_proc_macro`:* the regexes are identical. A parse panic upstream becomes a skip here.
- *`-Znext-solver=coherence`:* present. `//@[next] compile-flags: -Znext-solver` comes later and overrides it, as upstream.
- *needs-\*:* unevaluated `needs-*` and `incremental` are skipped with reasons (15 skips, listed in the handoff). That is conservative: no guessed
  evaluation.

**`-Zparse-crate-root-only`.**
- `m3UiCorpus` (`suites.ts:699`) strips only the harness's trailing copy, and throws if the argv does not end with it.
- The test's own copies survive:
  - `parse-const-unsafe-trait.rs` (`-Zparse-crate-root-only`);
  - three tests using the two-argument `-Z parse-crate-root-only`.
- All four MATCH in the lane's full run.
- Aux builds never get the flag.

**Rmeta-only aux crates: checked by experiment.**
- *Reading the code:*
  - `CrateLocator` loads rmeta-only crates for any build, and the missing-rlib error only comes at linkage (dependency_format), after the probes stop.
  - `--emit=metadata` drops only `optimized_mir`, `cross_crate_inlinable` and `deduced_param_attrs` (`encoder.rs:1181-1215`, `:1905`).
  - `mir_for_ctfe`, `promoted_mir`, `thir_abstract_const` and `mir_coroutine_witnesses` are still encoded, so auto traits on foreign coroutines and
    CTFE of foreign const fns behave the same.
- *Experiment:*
  - In a scratch copy (`/tmp/rv-hw20/rlib`), I rebuilt every aux crate as a full rlib (`--crate-type rlib`, no `--emit=metadata`,
    `--extern ...rlib`), into a scratch aux dir: 63 rlibs for the 57 cases.
  - I then ran the oracle `tydump` and `thirdump` probes on all 57 aux cases with both argvs.
  - Result: **57/57 identical** stdout, stderr and exit code for each probe, with aux paths normalized.
- *Search-path diagnostics:* no blessed typeck/traits stderr names an aux library path, so diagnostics that print `.rmeta` vs `.so` paths do not occur
  in this corpus.

**Inputs are identical on both sides.** Oracle and subject get the same `c.args`/`c.env` (`m3UiSuite`), and the subject reads the same oracle-built
rmeta files.

## 3. Host decision (x86_64-unknown-linux-gnu): agree

- It is consistent with every existing ui suite: `COMPILETEST_TARGET`, used by parse-ui, tydump-minicore and the with-std suites.
- The argv really passes `--target=x86_64-unknown-linux-gnu`, so this is not only about case selection. The real target std is installed in the
  oracle sysroot (`lib/rustlib/x86_64-unknown-linux-gnu`), as plan-m2 D1(1) requires.
- It is recorded in `docs/state/history.jsonl` (2026-10-21T09:27).
- The alternative (aarch64-apple-darwin) would make the case set depend on the machine. Example: `scalable-vectors/layout.rs` is skipped as
  `only-aarch64`; that is correct under D1.

## 4. No tampering

- **Baselines and oracle outputs:** no baseline or oracle-output edits, and the existing suites are unchanged (§1).
- **`--report blessed` is report-only:**
  - It is computed after `status` from the already-produced outputs.
  - It only adds a `<suite>.blessed.jsonl` and a summary field.
  - It is validated, and refused for suites without `blessed`.
  - `gate.ts:245` calls `difftest({ suite, runId, quiet })` without `report`, so it cannot reach the gate or `accept`.
- **Who produces outputs:**
  - Oracle outputs still come only from `runOracle`.
  - Aux crates are built only by `oracleRustcCmd` (the oracle rustc).
- **Subsets** are tallies only.

## 5. Tests and samples

- `bun test scripts harness`: 16 pass (12 deps, 4 compiletest).
- `bun scripts/difftest.ts --suite tydump-ui --sample 40 --report blessed` (run `rv-hw20-tydump-s40`):
  - MATCH 19, DIFF 0, UNPORTED 21, skipped 15;
  - subsets: typeck+traits 19/37, rustc_dump 0/3;
  - blessed: PASS 19, FAIL 17, NOT_COVERED 4.
- thirdump-ui `--sample 40` (`rv-hw20-thirdump-s40`): the same counts, and thir-print 0/0 in this sample.
- These are consistent with the handoff's full runs:
  - tydump-ui: 970/1849 MATCH, 10 DIFF, 1 TIMEOUT;
  - the lane's `hw20-full2-tydump` summary agrees.
- DIFF classifications I re-ran (`--filter`), first difference only; all four match the handoff:

| case | first difference |
|---|---|
| `non_lifetime_binders/foreach-partial-eq-next-solver.rs` | line 40: oracle `no implementation for \`T < T\` and \`T > T\``, subject `\`T == T\``. Handoff #1, port bug. |
| `dyn-iterator-deref-in-for-loop.rs#next` | line 80: oracle `aborting due to 1 previous error`, subject an extra `E0277 ... dyn Iterator<Item = &'a mut u8>`. Handoff #3. The `#current` revision MATCHes. |
| `next-solver/normalize/success-results-in-unconstrained-infer.rs#old` | line 24: oracle `""` (the ICE follows), subject `aborting due to 3 previous errors`. Handoff #6. |
| `next-solver/cycles/use-impl-to-normalize-own-self-ty-ice.rs#old` | line 3: the same `bug!` text, with the rustc `/rustc-dev/...select/mod.rs:2381:17` prefix vs `rust-ts: internal compiler error:`. Handoff #10, a root decision. |

## Findings

### BLOCKER
None.

### HIGH
None.

### MED

**M1. The aux build step has no timeout and an unkeyed environment, and it runs during `cases()`.**
- Location: `harness/compiletest.ts:645-675` (`buildAux`).
- *No timeout:* `Bun.spawnSync(oracleRustcCmd(..))` has none. A hung aux build hangs `cases()`, so difftest or the gate never starts and never
  prints `ERROR:`.
- *Unkeyed environment:* aux builds inherit the whole `process.env` plus `compileEnv(ap)`. The key (`:646`) covers the driver hash, case id, argv,
  `rustc-env` and source, but not the inherited environment. For example, `RUSTC_BOOTSTRAP` or `RUSTC_FORCE_RUSTC_VERSION` in a user's shell would
  change what is built or whether it succeeds, while the directory is reused afterwards.
- *Transient failures become skips:* any non-zero exit becomes a `Reject`, so the case is skipped for this run. That includes a signal (`exit null`),
  an OOM or a full disk.
  - This is not silent for protected cases: the gate reports them as lost.
  - But the run shows a skip reason, not an `ERROR:` line.
- *Suggested fix:*
  - give the aux build the suite's `oracleTimeoutMs`;
  - pass the same fixed env the case gets (`NOCORE_ENV` + `compileEnv`), or put the relevant inherited variables in the key;
  - print `ERROR:` (not a skip) when the exit is not a normal rustc error (signal, or no `error` line).

### LOW

**L1. The aux key covers only each aux file's own content.**
- Location: `compiletest.ts:646`.
- Files an aux crate reads (`mod x;`, `#[path]`, `include!`) are not covered, and `depsOf` scans only the main case file.
- Today none of the 46 aux files used by the 57 cases has such a dependency (scanned). The checkout is pinned, so only a sparse-set change could
  expose this, the same failure mode as review harness-w13 B1.
- Suggested fix: run `caseDeps` over each aux file and add the result to the key.

**L2. Stale header comments.**
- `compiletest.ts:31` says "stopping after parsing needs no target std", and `:37` says "nothing is written there when stopping after parsing".
- Both are now false for the M3 suites:
  - they type-check against the installed x86_64-linux rust-std;
  - the thir-print cases (`-Zunpretty=thir-tree`) create `build/x86_64-unknown-linux-gnu/test/ui/thir-print/...` in the upstream checkout.
- The second is harmless: other suites already wrote `build/.../ui/{attributes,hygiene,linking,pin-ergonomics}`, and `collectUiTests`/`caseDeps`
  never look under `build/`. Only the comments are wrong.

**L3. Untested code paths.**
- No case in the corpus uses `aux-bin`, or a `no-prefer-dynamic` aux crate without a crate-type attribute. Under the rlib experiment none dropped out.
- So `planAux`'s bin and no-crate-type paths (`compiletest.ts:631-636`) have no case or unit test.
- They read correctly against runtest.rs:1462-1505, but they are unexercised.

**L4. The rustc_dump subset differs from the plan.**
- The subset is 119 cases (111 files), against the plan's "127".
- It includes `rustc_dump_layout`/`rustc_dump_symbol_name` tests, which in tydump-ui only exercise type checking. The handoff says only 60 files use
  the check_crate/typeck dumps.
- The selection is a defensible reading of plan-m3 §4. Root should confirm that the M3 "rustc_dump ≥ 90%" gate is meant on this set, and amend the
  plan number.

**L5. Leftover temp directories.**
- A process killed mid-build leaves `$RUST_TS_DATA/aux/ui/<key>.tmp-<pid>` behind (`compiletest.ts:650-652`). It is harmless, never read as a
  result, and overwritten only by the same pid.
- Suggested fix: clean up `*.tmp-*` on start.

**L6. State-file merge conflicts.**
- `docs/state/current.json` coverage changed 15881 → 16457, recomputed on the integ-w19 tree, and it conflicts with `main`.
- Root resolves this when merging. There is no content issue.

## What I require
Nothing blocking. M1 should be fixed (timeout, fixed env or keyed env, `ERROR:` on abnormal exits) before the first `accept` that protects tydump-ui
or thirdump-ui cases. L1-L6 are optional.
