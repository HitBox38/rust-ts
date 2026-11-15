APPROVE WITH NITS

# Review: harness-w40s (wave 40s), `t3/harness-objwrite-probe` at `0a8e6e1c`

Reviewer: independent, read-only on the code (AGENTS.md §1).
- **Scope:** `git diff 2bf7435a 0a8e6e1c`: commits `e3969f94` (the objwrite probe), `c26869c0` (harness-m7b-recheck notes 1–6) and
  `0a8e6e1c` (notes 2 and 5 moved to `harness/suites.ts`, and the handoff). 15 files: `tools/probes/objwrite/*` (new),
  `tools/probes/fixtures.test.ts`, `scripts/{probes,criteria,criteria.test,difftest,miri.test}.ts`, `harness/{suites,m7-suites.test}.ts`,
  `docs/handoff/harness-w40s.md`. Nothing under `src/`, `harness/baseline/` or `docs/state/` changed.
- **Setup:** review branch `review/harness-w40s` at `0a8e6e1c`. `.env.local` was copied from `integ-w39`, plus `RUST_TS_REQUIRE_PROBES=1` and
  `RUSTUP_AUTO_INSTALL=0`. `bun install --frozen-lockfile`. AC power throughout, no `GATE_RUNNING`, `--jobs 6`, `RUST_TS_AGENT=review-harness-w40s`.

**Summary.** The batch does what the handoff says, and every claim I checked holds:
- No protected suite changes, apart from one display-only reason text.
- The probe builds from this source in an isolated data directory and prints the committed fixture byte for byte.
- All four of review vendor-object-write's surviving mutations now fail `objwrite.test.ts`.
- `criteria.ts` only adds lines, with the same exit codes.

Two nits, both about documentation and test precision. Neither affects behaviour.

## 1. Protected suites are untouched

- **The dump.** I wrote my own scratch dump (not the lane's). For every suite it hashes:
  - the non-function metadata, the cases (id, file, args, env), the skips;
  - the unstable ids and, separately, their reasons;
  - every case's oracle and subject command, `caseLock` and `irArgs` (or the batch command);
  - `blessed` (every 50th case), the subsets' membership, `criterion`;
  - `oracleKey()` in clear, and the full `caseOracleCacheKey` of every 25th case.
- **Same path for both.** It ran on `0a8e6e1c`, then on `2bf7435a` (detached), both checked out in this one worktree.
- **Result.** 81 suites on both sides, same names, same order, no throws. The one difference is `run-pass-native`'s `unstableReasons`.
  Its `unstableIds`, `oracleKey`, cache keys, cases and skips are identical.
- **Does the reason text re-key or re-score anything? No.**
  - `Suite.unstable`'s reason reaches only the `unstable` text of a result (difftest `unstableOf`, read at lines 446/822/1066) and gate's
    display. The status (`UNSTABLE`), gate's `protectedUnstable` and criteria's counts read only the ids.
  - `oracleCacheKey` (difftest.ts:386) has no unstable part.
  - `nativeOracleKey` hashes `native-run.ts` and `lib/unstable.ts`, not `harness/suites.ts`. No oracle key hashes `harness/suites.ts`
    (grep).
- **`scripts/native-run.ts` and `scripts/lib/`** are unchanged (`git diff --stat 2bf7435a 0a8e6e1c -- scripts/native-run.ts scripts/lib/`
  is empty). Moving notes 2 and 5 out of native-run.ts was right: a comment there would have re-keyed every native case.

## 2. The probe

- **Shared build.** `$RUST_TS_DATA/target/probes/release/objwrite` (02:12) carries `source.hash`
  `6b399dd602c71cd5e2047210a67f66ed36a11766`, which is `probeSourceHash("objwrite")` here (`probeStaleness`: current).
  - Its `Cargo.toml` equals this template, apart from `@SRC@` (another worktree's path).
  - Its output on `cases.txt` equals `objwrite.oracle.txt` (`cmp`).
- **Isolated build.** I built it with `RUST_TS_DATA=<scratchpad>/data` (only `rust` symlinked to the shared upstream checkout), so the
  shared data was not touched: `bun scripts/probes.ts build objwrite` printed `built objwrite`.
  - Same stamp hash, same size (98064 bytes).
  - Its output equals the fixture.
  - `otool -L` shows `@rpath/librustc_driver-….dylib` and `@rpath/libLLVM.dylib`, so the probe's `object` code is librustc_driver's.
    Had `--extern` named a copy whose code is not in a linked library, the link would have failed.
- **Tests.**
  - `RUST_TS_REQUIRE_PROBES=1 bun test ./tools/`: 84 pass, 0 fail (19 files). `fixtures.test.ts` alone: 13 pass.
  - `objwrite.test.ts`: 5 pass.
- **Mutations.** I re-applied each one alone, by exact unique-string replacement, ran `bun test ./tools/probes/objwrite/objwrite.test.ts`,
  then `git checkout -- src/`. `git status --short src/` was empty after each, and 5 pass after all four.

  | mutation | site | result |
  |---|---|---|
  | M2 `Rela64_r_info` with `r_sym`/`r_type` swapped | `src/vendor/object/elf.ts:906` | **1 fail**: line 190, `out x86_64-elf.o` |
  | M4 TLV entry of 2 pointers | `src/vendor/object/write/macho.ts:256` | **1 fail**: line 39, `object 1248` vs `1232` |
  | M5 comdat header `sh_info: 0` | `src/vendor/object/write/elf/writer.ts:942` | **1 fail**: line 205, `out x86_64-elf.o` |
  | M6 `BRANCH26` addend implicit (its `case` removed) | `src/vendor/object/write/macho.ts:416` | **1 fail**: line 102, `object 1088` vs `1072` |

- **`sysroot_extern`: is it robust?** Yes, as the code stands.
  - `compilerCrateFile` (scripts/probes.ts:282) takes only a `lib<crate>-<hex>.rmeta` with no same-hash `.rlib`. Any other count of
    candidates is one `ERROR:` line naming what it found.
  - The crate name is checked against an identifier pattern before it is used in the regex (probes.ts:258), and the option needs
    `rustc_dev = true`.
  - On the pinned sysroot, `object` has exactly two copies: std's `libobject-19b4….{rlib,rmeta}` and the compiler's
    `libobject-0a888….rmeta` (listed in `manifest-rustc-dev-aarch64-apple-darwin`). The rule cannot pick std's copy.
  - Wrong-copy risk: a second metadata-only copy (two compiler versions of one crate, like `rustc_hash` here) is an error, not a guess.
  - The rule's stated premise is broader than what is true: see N1.
- **Other probes' flags are unchanged.** Without `sysroot_extern`, `CARGO_ENCODED_RUSTFLAGS` is still `-C\x1flink-arg=-Wl,-rpath,…`
  off Windows and unset on Windows, as before (probes.ts:323–324).
- **The gate on other hosts.**
  - `checkProbes` (gate.ts:192) adds every probe that `oracleTestProbes` finds in a test file, and `fixtures.test.ts` names
    `probeBinary("objwrite")` literally.
  - So a host without the build fails the gate's pre-check in seconds, with `ERROR: probe 'objwrite' not built (needed by unit tests); run:
    bun scripts/probes.ts build objwrite`. The check documents itself, and no further note is needed there.
  - The fixture is not host-specific: the probe writes objects for named architectures, so there is no `host` key and no
    AGENTS.md §5 entry.
  - It needs the `rustc-dev` component, which the other rustc-dev probes need already.
- **The oracle toolchain.** `build` calls `verifyOracleToolchain` first. The toolchain's `lib/rustlib` listing and its recursive file
  count were the same before and after my build.

## 3. `criteria.ts` and `difftest.ts`

- **`criteria.ts` on main and on the branch** (`--run gate-20261114-162816-root-vc2v`):
  - **`--milestone M7`:** exit 1 on both. The branch adds only four lines: `milestone M7a: met (4 of 4 groups met)`, M7b met (3 of 3),
    M7c not met (2 of 3), then `exit 1: not met: M7c; met all the same: M7a, M7b (…)`.
  - **`--milestone M6`:** exit 0 on both. The branch adds only `milestone M6b: met (3 of 3 groups met)` and `exit 0: every selected
    milestone is met (M6b)`.
  - Every group line is identical. A selection with no group still dies before any verdict line (criteria.ts:224).
- **difftest.**
  - `criterionExcludesUnstable` (difftest.ts:999) is true exactly when a non-`allCases` group naming the suite has `excludeUnstable`.
    From `GROUPS`, that is mir-o2, mono-ui, run-pass-native, run-fail-native and ir-run-pass.
  - It is false for the M6 groups, the `allCases` hellos and the count group check-rg. `miri.test.ts` pins all eleven, and
    `criteria.test.ts` pins that the groups naming one suite agree.
  - Only there does `criterionOf` drop UNSTABLE and add the `unstable` field. Every other suite's summary keeps its shape.
  - `difftest.ts` now imports `criteria.ts`, which imports only `node:fs` and `node:path` and runs its CLI only under `import.meta.main`:
    no side effect, no cycle.
  - The sample run below prints `(ORACLE_TIMEOUT excluded: 0, UNSTABLE excluded: 0)` for mono-ui, as intended.

## 4. `libcLoadedOn`

- **Offsets are kept.** `blankRustNoise` maps code unit to code unit (`split("")`/`join("")`, blanks only), so reading the predicate from
  `attrs` at the offsets found in `clean` is sound. Parentheses are balanced in the blanked text, so a `)` in a string no longer cuts a
  predicate short.
- **The six new cases** match what the code does.
- **The corpus is unchanged.** From the dump:
  - `run-pass-native`: 3414 cases; cases hash and skips hash `ef3e72d022e0bd6f` identical on main and the branch.
  - `ir-host`: 3415 cases; skips hash `4f3587ab0ea11af0` identical, cases identical.
  - Every other suite's cases and skips are identical too (§1).

## 5. `m7-suites.test.ts`

- The old assertion (no baseline for the six M7b suites) has been false since the 40r accept, so main failed this test. The new one
  asserts that each has a baseline file.
- That is a correction, not a weakening: gate.ts's default suites are the ones with a baseline file. But it pins only that the file
  exists, not what it holds: see N2.

## 6. Commands

| command | result |
|---|---|
| `bunx tsc` | exit 0, no output |
| `bun test ./harness/ ./scripts/` | 577 pass, 0 fail (54 files) |
| `RUST_TS_REQUIRE_PROBES=1 bun test ./tools/` | 84 pass, 0 fail (19 files) |
| `difftest --suite mono-ui --sample 200 --jobs 6` | 200 MATCH (`20261115-011952-review-harness-w40s-na9c`) |

## Findings

- **N1** (`scripts/probes.ts:35-36`; `docs/handoff/harness-w40s.md:28`): `sysroot_extern`'s premise is stated too broadly.
  - The header says compiler crates are shipped as metadata and std's dependencies are `.rlib`s. The handoff says all 30 `.rlib`s are std's.
  - In fact the pinned `rustc-dev` component ships 3 `.rlib`s (`manifest-rustc-dev-aarch64-apple-darwin`): `librustc_public`,
    `librustc_public_bridge` and `libtikv_jemalloc_sys`.
  - The selection rule is still safe. It relies only on "metadata-only implies compiler", which holds, and for such a crate it stops with
    "no metadata-only …", never with the wrong copy.
  - Fix: reword the header to say that only `.rmeta`-only crates can be pinned, and that a compiler crate shipped as an `.rlib` gets the
    error. Optionally, choose from the `manifest-rustc-dev-<host>` file list, which names the compiler's copies exactly.
- **N2** (`harness/m7-suites.test.ts:283`): the corrected assertion checks only that each of the six baseline files exists.
  - The ir-hello test above it (lines 112–113) pins the baseline's contents.
  - `native-hello.txt` is one fixed line (`hello`) and could be pinned the same way. For the growing ones, a non-empty check would at
    least catch an emptied file.
  - Not a regression: the gate's own loss check is what guards the contents.
