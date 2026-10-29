# Handoff: harness-m5a (split mode, heavy class, `check-core-bin` + `mir-core`; harness batch, needs an independent review)

Branch `lane/harness-m5a`, base `644cc1e0`. Implements plan-m5 §4.1–4.2 (D6, D11) and wave 31's first M5 suites. No
ported upstream code: no coverage numbers, no `// rustc:` markers, no `// PORT:`, no `unported(...)`. Baselines, oracle
outputs, probes and existing suites are unchanged (the existing suites' behaviour is proven unchanged in §5). The two
new suites are unprotected.

## Files touched
- `scripts/lib/split.ts` (new, pure): the `Section`/`SplitOutput`/`SplitHashes` types, `uniqueIds`, `mirBodyKey`,
  `splitMirPretty`, the `SPLITTERS` registry, and `compareSections`.
- `scripts/lib/split.test.ts` (new, 13 tests): the MIR splitter on synthetic output (preamble, fn, promoted, CTFE,
  allocations, trivial and anonymous consts, `static mut`, round trip). Also `uniqueIds`, and **missing, extra and
  reordered** sections, plus a changed body vs. a changed separator.
- `scripts/lib/common.ts`: `ProcResult.usage` (user/sys CPU and max RSS from Bun's `resourceUsage()`). Nothing else
  changed.
- `scripts/difftest.ts`: split mode (`runSplit`), heavy class, and the `inputDirs`/split parts of the cache key. Also the
  summary fields `extra`/`heavy` and the CLI lines.
- `scripts/gate.ts`: heavy suites run last, `--skip-heavy` → `notRun`, and the per-run resource lines in the output and
  in gate.json.
- `harness/suites.ts`: `Suite.mode` gains `"split"`, and `Suite.split`, `Suite.heavy` and `Suite.inputDirs` are new
  (all documented). One appended "M5" block with the two suites.

## 1. Split mode (`mode: "split"`, D6)
- Each `Case` is a **run**: one oracle process and one subject process. `Suite.split` names a splitter in
  `scripts/lib/split.ts` `SPLITTERS`, which cuts stdout into sections plus a **skeleton**: every line outside the
  sections, with each section replaced by `<<id>>`.
- Reported cases:
  - **The run case**, id = the run's id (`core`). It compares the skeleton, stderr and exit code.
  - **One case per oracle section**, `<run id>|<section id>`. It is MATCH iff the subject printed a section with the
    same id and the same text.
  - "Run case MATCH and every section MATCH" ⟺ the whole output is identical. A missing, extra or reordered section,
    or a lost blank separator, changes the skeleton.
- **Missing ≠ MATCH.** An oracle section absent from the subject's output is DIFF, with `first: "missing from the
  subject's output"`. Sections only the subject prints are not cases: they are counted in the summary (`extra`) and
  listed in `<suite>.extra.jsonl`.
- **Run-level failures.** If the subject times out, or exits with a code other than the oracle's (UNPORTED for 70,
  CRASH for 101 when the oracle didn't ICE, else DIFF), every case of the run gets that status.
  - `unported` / `first` are recorded only on the run case. `first` is the first stderr/exit difference. This keeps
    the jsonl at about 100 B per section.
  - Unstable oracle output (`Suite.unstable` listing the run, or `UNSTABLE_ORACLE_PATTERNS`) makes every case of the
    run UNSTABLE.
  - An oracle timeout reports only the run case, as ORACLE_TIMEOUT: there are no sections. Protected sections would
    then show as "no longer a case" (lost), which is correct for a run that compared nothing.
  - `Suite.unstable` may also list single section ids.
- **Ids never use positions.** id = key + an occurrence index among equal keys (`uniqueIds`: `key`, `key @2`, ...).
  `mirBodyKey` is the body's header line without ` {` / ` = {`. For a trivial const it is the line without its
  `= const <val>;`, so a wrong value is a DIFF, not a missing case. A CTFE body adds ` [ctfe]`, and promoteds end in
  `::promoted[N]` already.
  - **Decision for root:** the task says "keyed by def path". I key by the whole header (def path plus signature),
    which is what plan-m5 §4.1 says ("block header + occurrence index"). On core, 17,704 bodies repeat a def path
    (macro-generated impls all print as the same `<impl at <span>>`), but only 1,107 repeat a key, so far fewer ids
    depend on an occurrence index.
  - The cost: a subject that prints a wrong signature turns that case into missing + extra, not a DIFF. The run case's
    first difference (`<<oracle id>>` vs `<<subject id>>`) still points at it.
- **Storage (disk at 97%).**
  - The oracle cache entry of a split run is `{code, stderr, hashes: {sections: [id, sha1][], skeleton: sha1}}`,
    gzipped. That is about 1.5 MB for core, never the 47 MB text.
  - When a run has DIFFs, the diff files need the oracle's text. A cached oracle is then **run once more**: core costs
    6 s user. That re-run must reproduce the cached hashes; otherwise there is an `ERROR:` line, the entry is replaced
    and the fresh output is scored.
  - Diff files are capped at 500 as before. Their names are a cut id plus a 10-hex hash: core's ids reach 619 chars,
    over the 255-byte filename limit.
- **Cache key.** Split suites add `{split: <name>, source: sha1(scripts/lib/split.ts)}` (a changed splitter means
  changed ids). `inputDirs` suites add a hash of every file under those directories, in place of the deps scan.
  `caseDeps` on library/core probes 2.2M paths in 22 s and builds a 220 MB JSON key, which is unusable. Other suites'
  keys are unchanged: the extra parts are pushed only when the fields are set.
- `--filter` / `--sample` on a split suite select among the reported cases; every run still runs.
- Rejected with `ERROR:`: a split suite with `subsets` or `blessed`, an unknown splitter, and a heavy batch suite.

## 2. Heavy class (`heavy: { rssBudgetMb }`, D11)
- jobs = 1. Within a run the oracle runs first, then the subject (never concurrently). A subject TIMEOUT is not re-run:
  it already ran alone.
- Per run: wall/user/sys time, max RSS and exit code of each process (`"cached"` for an oracle that didn't run). These
  go to the summary (`heavy`) and get one printed line in difftest and in the gate (`heavy <suite> <run>: subject …;
  oracle …`).
- A subject over `rssBudgetMb` gets a `note: … over the suite's budget … (plan-m5 D11: reported, not a status)` line and
  `overBudget: true`. **It does not fail the gate. Decision for root:** D11 says "fail loudly" but also "a reported
  regression, not a timeout". If it should fail the gate, it is a one-line change in `gateRun`.
- RSS comes from `wait4` via Bun's `Subprocess.resourceUsage()` (bytes; on macOS the same number `/usr/bin/time -l`
  prints, measured). The oracle runs through the rustup proxy, so its figure covers the proxy and the rustc it waits
  for.

## 3. Suites (milestone M5, unprotected)
Both suites use D1's argv from the upstream checkout: `--crate-name core --edition=2024 library/core/src/lib.rs
--crate-type <…> --target x86_64-unknown-linux-gnu -Zforce-unstable-if-unmarked --emit=metadata`. Shared setup:
- env `NOCORE_ENV`; no session-variable pinning (core's dep-info has no `# env-dep`, and `pinSessionEnv` would run the
  deps scan);
- heavy, with a 12 GB budget (D10's M5a target), subject timeout 1,800 s, oracle 300 s (+ the 4x retry);
- `inputDirs` = library/core/src, library/stdarch/crates/core_arch, library/portable-simd/crates/core_simd. core's
  `--emit=dep-info` lists 418 files, all under these.

The two suites:
- `check-core-bin`: single mode, 1 case (`core`), with `--crate-type bin -Zcrate-attr=no_main` (plan §2's row). It
  compares stdout + stderr + exit.
- `mir-core`: split mode (`mir-pretty`), `--crate-type lib -Zunpretty=mir`. It has 47,733 body cases plus the run case
  `core`. The plan's 50,239 counts `^}$`, which includes allocations' closing braces.
- Writes into the upstream checkout: mir-core writes none. check-core-bin's oracle always creates an (empty)
  `libcore.rmeta` (rustc_metadata fs.rs:62), so that suite adds `--out-dir build/rust-ts/check-core-bin`, an untracked
  option under the ignored `build/` (see §5).
- compiler_builtins aux chain: **not done.** Wave 31 has no suite that needs it: `check-alloc` and the aux chains are
  harness-m5c, wave 34. Building it means caching core's 54 MB oracle rmeta under `aux/`, a cost with no consumer yet.
  Suggested shape for m5c: `oracleAuxRmeta`-style, keyed by `rustcDriverHash()` + inputDirs hash + argv, with an empty
  `--sysroot` dir and `--extern core=<oracle core rmeta>`.

## 4. Gate
- Suites run in the given order, with heavy suites moved last (serially, like every gate suite).
- `--skip-heavy`:
  - leaves heavy suites out, with a `note:` line and `notRun: [{suite, reason}]` in gate.json;
  - their cases are not counted as lost;
  - `accept` still refuses a run that skipped a **protected** suite (the existing check).
  - **Decision for root:** once `mir-core` is protected, every acceptable gate run includes the core runs (2 subject runs: about 1.5–4.5 min wall and
    7–9 GB each today; see §5).
- Lost/gained logic is unchanged and works on section ids. Once protected, `mir-core.txt` would be about 5.2 MB of ids.

## 5. Verification
- `bunx tsc --noEmit -p .`: clean. `bun test scripts`: 49 pass (13 new). `bun test harness`: 7 pass.
  `bun scripts/coverage.ts --check`: markers ok.
- Existing suites unchanged (`RUST_TS_AGENT=root-f5de`; before = root's base runs in `.data/tmp/w30/dm5-before-*.log`):

| run | before | after |
|---|---|---|
| `mir-minicore` (all 46) | MATCH 46 | MATCH 46 |
| `mir --sample 300` | MATCH 290, UNPORTED 8, UNSTABLE 2 | MATCH 290, UNPORTED 8, UNSTABLE 2 (per-case `id,status` identical to run `20261029-103033-root-f5de-w2xi`) |

- Split end to end on a temporary split copy of `mir` (a throwaway script, not committed;
  tests/ui/mir/gvn-loop-miscompile.rs, budget 1 MB):
  - all MATCH (6 cases), with the over-budget note printed;
  - with `-Zmir-opt-level=0` on the subject only: 2 sections DIFF with correct first lines, via the oracle re-run from
    cache;
  - with a bogus `-Z` flag: a run-level DIFF on all 6 cases, `first` on the run case only, one diff file.
- Heavy runs, serially (no gate running, but other lanes were active: load average 40–65, so wall times are inflated;
  user CPU is the comparable number):

| suite | run dir | result | subject (port) | oracle |
|---|---|---|---|---|
| `check-core-bin` (1st run, before the `--out-dir` fix) | `harness-m5a-check-core-bin` | UNPORTED 1/1 | 265.5 s wall, 178.2 s user, **6,917 MB** max RSS, exit 70 | 4.6 s wall, 4.4 s user, 1,051 MB |
| `check-core-bin` (final argv) | `harness-m5a-check-core-bin-2` | UNPORTED 1/1: `rustc_middle::query::keys: QueryKey for (ValidityRequirement, ty::PseudoCanonicalInput<'tcx, Ty<'tcx>>) (cache)` (plan §2's stop, lane query-keys) | 96 s wall, 143.1 s user, **9,008 MB** max RSS, exit 70 | 4.8 s wall, 4.6 s user, 1,052 MB |
| `mir-core` | `harness-m5a-mir-core` | 47,734 cases (47,733 bodies + run case `core`), all UNPORTED: `StableHash without a TS impl` (D9's stop: HIR hashing of a lib crate) | 67.6 s wall, 49.1 s user, **6,902 MB** max RSS, exit 70 | 23.7 s wall, 6.8 s user, 1,170 MB (fresh; cache entry 1.49 MB) |

Neither run went over the 12 GB budget. mir-core's jsonl is 6.8 MB. The second check-core-bin run used less user CPU but
reached 9.0 GB, against 6.9 GB in the first: the load fell from about 65 to about 11 between the runs, so both figures
are noisy.

**Stray found and fixed.** The first check-core-bin run left a 0-byte `libcore.rmeta` in the upstream checkout: the
oracle wrote it, because rustc always creates the metadata file (rustc_metadata fs.rs:62), and I reproduced this in a
temp cwd. difftest reported it with `ERROR:` as designed. I moved the stray to
`$RUST_TS_DATA/tmp/upstream-strays/libcore.rmeta.harness-m5a`. The suite now passes `--out-dir
build/rust-ts/check-core-bin`. After the re-run the upstream checkout is clean outside `build/`, and the rmeta is
under `build/rust-ts/check-core-bin/`. mir-core writes nothing.

## 6. Notes / follow-ups
- `run()` buffers stdout in a JS string. That is fine for core's 47 MB MIR, but a split hir-tree/thir-tree of core
  (1.56 GB) would need a streaming splitter.
- `mir-core` takes about 6 s user for the oracle. The subject's cost dominates every run: see §5.
