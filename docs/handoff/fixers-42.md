# fixers-42

Base: `integ-w40` merged at `6da1d531`. One commit per item. Checks at the end of this file.

| # | Item | Result | Commit |
|---|---|---|---|
| 1 | fixers-41 F1, `__CF_USER_TEXT_ENCODING` | Fixed. 1,110 whole-`environ` comparisons against the oracle under interposed uids and passwd entries: 298 differed before, 0 now. | `c0f9ded3` |
| 2 | fixers-41 F2, `HOME` under Miri | Fixed, plus `HOME=` (empty), which also differed. 5 real programs match the oracle. No other lossy path into Miri memory on this host. | `f8fd91b5` |
| 3 | fixers-41 F3, `RUSTC_LOG*` | Fixed, plus `MIRI_LOG` and `MIRI_LOCAL_CRATES`, which read the same way. 10 variables through the real driver match the oracle. | `f61219d0` |
| 4 | fixers-41 F4, near `ARG_MAX` | Fixed, no stop needed: exit 1 window gone at every cwd length tried. | `31baf92b` |
| 5 | fixers-41 N1-N4 | All done. A `.env` can no longer choose `RUST_TS_IMPL`. | `748e89e1` |
| 6 | perf-near-limit N1 | Hook and test added. A broken `first_reader` now fails. | `894c9c8e` |
| 7 | perf-near-limit N2, N3, N4 | N2 and N3 done, `context.ts` comments done. **`PORTING.md:152` is for root**, see below. | `551f8705` |
| 8 | ice-report-final N1-N3, N5, N6 | N1-N3 done. N5 and N6 were already fixed at the merge, by `8a79ff32`. | `5851b0bb` |

## For root

- **`PORTING.md:152` is out of `src/`.** "Interning looks the value up by its canonical key" no longer holds for types, regions, consts, predicates, clauses, lists, canonical inputs and external constraints, which use `value_hash` and `value_eq` on the stored value. The review also asks for a recorded decision.
- **Added beyond the brief, same class:** `HOME=` empty (std filters it and falls back to the passwd home; the port wrote `""`); `MIRI_LOG` and `MIRI_LOCAL_CRATES` with non-UTF-8 values.
- **Seen and left, all only with non-UTF-8 values:** `MIRI_BE_RUSTC`'s panic prints `JSON.stringify` where upstream prints `OsStr`'s Debug (`src/miri/bin/miri.ts`). `MIRI_CWD` is read lossily, which matters only if a directory of that lossy name exists. Not compared with the oracle.
- **Linux:** none of this ran there. `current_dir` under Miri is `process.cwd()`, lossy on a non-UTF-8 directory, which APFS refuses (checked: `touch` gives `Illegal byte sequence`), so it can only arise on Linux; `src/miri/shims/unix/env.ts` says so. Host file reads under Miri all stop `unported` (`src/std/fs.ts`), including `readlink`, though APFS symlink targets can hold such bytes.
- **Keep or discard:** the by-hand tools are in `$RUST_TS_DATA/tmp/w40/fixers-42-keep/`. The uid cases need the interposer, so they stay by hand as the review advised.

## Item notes

**1.** `CFFIXED_USER_HOME=` (empty) reads `/.CFUserTextEncoding`, not the passwd home. That is what the oracle does, in the same 1,110. The test's environment gains a file with non-UTF-8 bytes and a character cut at byte 63, at no added process. The old code fails it, in both the proc-macro and the Miri test.

**2.** `home_dir` moves to `src/std/env.ts`. A std program costs about 19 s under Miri, so the permanent test is a stand-in `InterpCx` in `shims_c.test.ts`; putting `process.env.HOME` back fails it. The real programs were run once by hand, not in a committed test: `HOME=/a\xffb`, empty, unset, plain, and valid UTF-8.

**4.** The shell's `PWD` was what overflowed. Measured in bytes below the largest environment that execs:

| cwd | Before: exit 1 | After: exit 1 | After: default stack | After: full stack |
|---|---|---|---|---|
| 131 bytes | 206-286 | none | 26-226 | 246+ |
| 370 | 206-526 | none | 26-226 | 246+ |
| 1000 | 206-1146 | none | 26-226 | 246+ |

Every point is an exact `environ`, stepping 20 bytes. Each byte within 12 of the edge between the two stacks was also read, with a 533-byte Bun path and with 3,000 entries; those two were run on a build with padding and without it, and neither failed, so I took the padding out. **Limit:** the kernel's count is measured, not documented, and the margin rests on the script's own text. A later macOS could reopen this as the same exit 1, which the new test would show.

**5.** The unit test checks `selected_impl` and that all six entries call it. By hand, with `.env` saying `shim` and no `rustc` on `PATH`: `main` and `tydump` run the port, exit 0; a real `RUST_TS_IMPL=shim` fails to find `rustc`, so the check does tell them apart. N2: printing addresses fails on `alloc_os_str_as_c_str` sized by `utf8_len`.

**6.** The programs are the review generator's `ints`, `consts` and `tait`, moved to `no_core` at 16 variables so none loads std. `tait` needs `define_opaque` declared by hand. Mutations of the committed test, all killed by the hook's panic:

| Mutation | Result |
|---|---|
| M1 int and float vars in the type table | killed |
| M2 const vars in the type table | killed |
| M3 `sub_roots` not marked | killed |
| M4 opaque count not compared at pass start | killed |
| M6 only the first stalled var marked | killed |
| M8 `update` does not report | killed |
| M9 `first_reader` keeps the latest | killed; `src/vendor/ena` and `traits/old_solve.test.ts` still pass with it |

**Not tried:** M5 and M7, which the review's own 41 programs did not catch either. On the rest, the old solver and `-Zdisable-fast-paths` are not exercised. The hook costs production one comparison per pass.

**7.** N3 is measured on `src/rust_ts/intern_key.ts`'s `value_hash`:

| Grid | Before: shared a hash | Largest bucket | After | Largest bucket |
|---|---|---|---|---|
| `Ref(r, t)`, 100 x 40,000 | 2,338,597 (58%) | 100 | 1,845 | 3 |
| Three ids, 100^3 | 939,916 (94%) | 492 | 119 | 2 |
| Two fields, 2,000^2 | 3,739,068 (93%) | 1,414 | 1,920 | 2 |

Random hashes would give about 1,860 on the 4,000,000-value grids. Real programs, alternating old and new, `-Zunpretty=mir`: output and exit identical.

| Program | Ginstr old | Ginstr new | RSS MB old | RSS MB new |
|---|---|---|---|---|
| `variance-overflow.rs` (5 runs each) | 60.0-60.3 | 59.8-61.2 | 764-769 | 761-768 |
| `deep-try-chain-issue-153583.rs` (2) | 61.1-61.7 | 61.5-61.7 | 888-889 | 889-890 |
| `hkl_forbidden.rs` (4) | 423.7-426.2 | 423.5-424.5 | 3,876-5,537 | 4,228-5,630 |

No instruction cost shows above noise. `hkl_forbidden`'s RSS is too noisy to read a change either way; those runs had changing load. **I changed one existing expectation:** `intern_key.test.ts` used `{a: 1, b: 2}` and its swap as a known collision, which the name salt ends, so it now uses `a0` and `b0`. That is a property of the hash, not an oracle value. N2 has no measured gain of its own.

**8.** N1's shapes are in `in_nested_item`, via a new `item_span`. `track_caller_check.ts` before and after: mapped counts and the two refused sites (`rustc_errors/json.ts:308`, `rustc_mir_transform/ref_prop.ts:313`) are unchanged; N3 moves 13 sites from `refused: other` to `refused: nested item`. `--oracle 100`: 0 wrong, ICE corpus 49 of 49. A first version wrongly refused 4 sites in `overflow.ts`, as a `where` clause's trailing comma looked like a const argument; the checker's list showed it, and angle-bracket depth replaced that test. **Not re-run:** the 118 ICE cases. The checker's static result says no mapping moved.

## `unported` and `PORT`

No new `unported(...)`. New `PORT` notes: `current_dir` (Linux, above), `home_dir`'s fallback through `os.homedir()`, and `PORT(perf)` on the `StalledPrefix` hook. `field_hash` has a doc comment, not a `PORT` marker, as the file is our own glue. `stalled_prefix_driver.ts` is test-only.

## Checks at head

- `bunx tsc --noEmit -p .`: clean, with `node_modules` linked for the run and removed.
- `bun scripts/coverage.ts --check --offline`: `markers ok (24848; vendor 5086; library 601)`.
- `RUST_TS_REQUIRE_PROBES=1 bun test`, per directory, 0 fail: `src/rust_ts src/rustc_log src/std src/rustc_data_structures src/vendor/ena src/rustc_driver_impl` 507 pass; `src/miri` 443; `src/rustc_trait_selection` 140; `src/rustc_middle` 362. These ran before the suites below; no code changed after. Under `bun test`, Bun does not load `.env.local`, so `RUST_TS_DATA` must be exported or `rustc_log/lib.test.ts` fails.
- Unit time added, CPU, best of 3, load about 10: about **2.5 s**, within plan-m7 F5's 5 s. `fulfill_stalled` 2.05 s, `rustc_log` oracle test 0.27 s, grid test 0.15 s, `stack.test.ts` 0.63 to 0.70 s. `environment.oracle` (5.66 to 5.54), `shims_c` and `track_caller` show no increase.

`RUST_TS_AGENT=fixers-42`, `RUST_TS_REQUIRE_PROBES=1`, AC power:

| Suite | Total | MATCH | Other |
|---|---|---|---|
| `miri-hello` (whole) | 1 | 1 | |
| `run-pass-miri` `--sample 100` | 100 | 100 | |
| `miri-pass` `--sample 100` | 100 | 99 | 1 UNPORTED, not protected: `tests/pass/shims/socket-no-blocking.rs` (sockets, plan-m6 D2) |
| `mir` `--sample 100` | 100 | 100 | |
| `check-ui` `--sample 100` | 100 | 100 | |

DIFF 0, CRASH 0, TIMEOUT 0. The gate and full suites were not run, as instructed. Upstream checkout: `git status --short --ignored` shows only `!! build/`.
