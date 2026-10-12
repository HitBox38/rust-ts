CLEAN-WITH-NOTES

Regression audit `audit-1` of every protected-set change up to `gate-20261012-105941-root-hf6n` (commit 75852d6).
Read-only. The helper scripts are in `D:/rust-ts-data/audit-1/`. The runs are `D:/rust-ts-data/runs/audit-1-*`.

## 1. Baseline integrity: clean

| baseline | growth commits | named run | ids added | removed / dup | added ids not MATCH in run |
|---|---|---|---|---|---|
| lex.txt | 5b56a1d | gate-20261011-191820 | 25780 | 0 / 0 | 0 |
| escape.txt | 5155d4b (empty file), d115014 | gate-20261011-233648-root-9pw6 | 25780 | 0 / 0 | 0 |
| symbols.txt | 75852d6 | gate-20261012-105941-root-hf6n | 10 | 0 / 0 | 0 |
| escape-synthetic.txt | 75852d6 | gate-20261012-105941-root-hf6n | 11 | 0 / 0 | 0 |

- `git log --all` shows no other commit touching `harness/baseline/` on any branch. No file was renamed.
- Every HEAD id is MATCH in the latest accepted run. Every accepted run has `pass: true`, `lost: []`, and covered every
  suite that was protected at the time.

## 2. Expectation tampering: none found

I diffed `scripts/difftest.ts`, `gate.ts`, `lib/oracle.ts`, `lib/common.ts`, `probes.ts` and `harness/suites.ts` from
5b56a1d to 75852d6. None of the changes normalises output, swallows a status, maps UNPORTED/CRASH/TIMEOUT to MATCH, or
drops cases. `classify` still requires equal text and equal exit code for MATCH. A subject batch that fails or times
out marks its last section incomplete, so failures can only lose cases, never gain them. The batch retry-in-halves
change (5155d4b) only narrows TIMEOUT to single files. The oracle still throws when a single file fails.

### Findings

**F1 MEDIUM: an accepted run is not tied to a commit or a full gate.** `gate.json` records no HEAD sha, no dirty-tree
flag, no `--skip-static` flag and no list of skipped suites. `gate accept` accepts runs made with `--suites <subset>` or
`--skip-static`.
- Evidence (a): hf6n ran at 13:59:41+03 against a working tree that matches no commit. Its 10 `symbols/<sec>` ids
  first exist in 75852d6, committed at 18:45. 510bc5b, which is HEAD at run time, has a single `symbols` case with 5
  sections.
- Evidence (b): the first accept, 191820 at 19:19Z, predates the first commit containing the harness (5b56a1d, 19:39Z).
- Scenario: root runs `gate run --suites symbols --skip-static`, accepts it, and commits. A lex regression and a type
  error ship in an "accepted" commit. The ratchet itself survives, because baselines only grow and the next full gate
  fails. But attribution and bisect point at the wrong commit.
- Today this is mitigated: my re-runs at HEAD (section 3) reproduce the accepted results.
- Fix (harness batch): record `git rev-parse HEAD`, the porcelain status, `skipStatic` and the suites run. `accept`
  should refuse if `skipStatic` is set, if any baseline suite is missing from the run, or if HEAD or the tree differs.

**F2 LOW: unreviewed harness change in the integrate commit.** 75852d6 rewrites `harness/suites.ts`: one `symbols` case
becomes 10 per-section cases, and 5 more sections are enabled. AGENTS.md §2 requires a separate reviewed batch for
this. The change strengthens coverage, follows the harness-w2 reviewer's suggestion (lines 51-53 of that review), and
my re-run is 10/10. No action is needed beyond noting it. Next time, put such a change in its own reviewed commit.

**F3 LOW: baseline-growth commits do not name the run id.** 5b56a1d and 75852d6 do not name their run, which AGENTS.md §6
requires. d115014 does. In all three cases `docs/state/history.jsonl`, in the same commit, carries the id.

**F4 LOW (mitigated): the parse cache key holds only the pin, as harness-w2 flagged. Confirmed.**
- `oracleVersion()` falls back to `PIN.commit` because `cmd0 = "rustc"` is not a file. The parse key is therefore
  `[PIN.commit, PIN.commit, "parse", id, args, fileHash]`.
- The scenario in the review ("`rustup update nightly` would not invalidate it") cannot serve stale results.
  `verifyOraclePin()` runs at the start of every `difftest()` and `phase-diff`. It dies if `rustc +nightly -vV` reports a
  commit-hash other than `PIN.commit`.
- Residual risk: a different build of the same commit, such as a locally built toolchain linked as `nightly` or another
  host, would share entries. parse has no baseline, so no protected case is exposed.
- Operational risk: `UPSTREAM.json` pins the floating `toolchain: "nightly"`. Any routine `rustup update` stops the
  oracle until someone reinstalls it.
- Recommendation, before the first parse baseline: set `toolchain` to `nightly-2026-10-11`, and add a hash of the
  sysroot `rustc_driver` library to the key.

**F5 LOW (fixed, no impact): process-global `oracleVersionCache`, fixed in 0fd719d.**
- In 9pw6 the gate ran escape first (readdir order), so the lex entries were keyed by the escapes probe hash. This is
  the reverse of the case the harness-w2 review describes.
- No impact: hf6n re-ran lex and escape under correct keys. My scan finds all 25780 lex and 25780 escape entries under
  the correct per-probe keys.

**F6 INFO: batch suites compare stdout only.** The oracle exit code is forced to 0, and stderr is dropped on success on
both sides. If a file were missing from both outputs, `"" == ""` would MATCH. Scan result: 0 empty and 0 bad-header
oracle entries across lex and escape.

**F7 INFO: about 65% of escape cases are vacuous.**
- 16,673 of the 25,780 protected escape cases are header-only: the file has no quoted literal. tests/ui accounts for
  15,833 of them.
- I cross-checked with the lexdump oracle. The literal count agrees in all 25,780 files (0 mismatches). No header-only
  file has a terminated quoted literal.
- The real escape coverage is 9,107 files plus escape-synthetic. This is not a defect, but "25,780" overstates the
  coverage.

**F8 INFO: dead oracle helper.** `oracle()` in `scripts/lib/oracle.ts` is unused. Its key hashes the command path, not
the probe binary, so if anyone adopted it, it would serve stale probe output after a rebuild. Delete it or fix it.

**F9 INFO: no probe staleness check.** Nothing checks that the probe binaries match `tools/probes/*` sources. A rebuild
changes the hash and invalidates the cache correctly, but a source change without a rebuild goes unnoticed. The
harness-w2 review notes a related gap: `PIN.release` is not checked against symdump's `CFG_RELEASE`.

## 3. Independent re-run at 75852d6 (`RUST_TS_AGENT=audit-1`)

| suite | result |
|---|---|
| symbols (full) | 10/10 MATCH |
| escape-synthetic (full) | 11/11 MATCH |
| lex --sample 500 | 500/500 MATCH |
| escape --sample 500 | 500/500 MATCH |

- Static checks at HEAD: `tsc --noEmit` exit 0. `bun test src` 104 pass, 0 fail. `coverage --check` ok (751 markers).
  `bun test tools` 9 pass.
- Oracle spot-check: I ran `lexdump.exe` live on 3 sampled cases and compared with the cache entries (key recomputed
  from `difftest.ts` `cachePath`):
  - `compiler/rustc_builtin_macros/src/format_foreign/shell/mod.rs` (1320 lines)
  - `tests/ui/explicit-tail-calls/signature-mismatch.rs` (203 lines)
  - `tests/ui/std/open-options-ext-compat.rs` (206 lines)

  All three: fresh equals cached byte for byte, the output starts with the `file:` header, and the subject's live output
  equals the fresh oracle output. I also re-ran 3 header-only escape files live: fresh equals cached.
- The probes link `@UPSTREAM@/compiler/rustc_lexer` by path, so they are built from the pinned source.

## 4. Unrun suites

- `parse` (M1) is defined in `harness/suites.ts` but has no baseline file, so the default gate does not run it. That is
  OK: nothing in parse is protected yet, and it is the M1 goal. Fix F4 before its first accept.
- `tools/**/*.test.ts` (codegen: macros, oracle, rustc_lexer; 9 tests) is not part of the gate, which runs only
  `bun test src`. Severity LOW: generated code is exercised indirectly through `src` and difftest. It passes today.
  Consider adding `bun test tools` to `staticChecks`.
- All 4 suites that have a baseline were run in the latest accepted gate.
