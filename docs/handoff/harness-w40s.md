# harness-w40s (wave 40s): review notes, and the objwrite probe

Harness/tools batch (AGENTS.md §2): `harness/`, `scripts/`, `tools/` only. Nothing under `src/` changed (the four mutations below
were applied one at a time and reverted with `git checkout -- <file>`; `git status` was clean after each).
Base `2bf7435a`. Branch `t3/harness-objwrite-probe`. AC power throughout, no `GATE_RUNNING`, `--jobs 6`, `RUST_TS_AGENT=harness-w40s`.

## Files touched

- `tools/probes/objwrite/` (new): `Cargo.toml.in`, `main.rs` (the probe), `cases.txt` (the review's script, verbatim),
  `twin.ts` (the port's side), `objwrite.oracle.txt` (the probe's output, a `PROBE_FIXTURES` fixture), `objwrite.test.ts`.
- `scripts/probes.ts`: the `sysroot_extern` option (below), `compilerCrateFile`, and the `objwrite` `PROBE_FIXTURES` entry.
- `tools/probes/fixtures.test.ts`: checks the objwrite fixture against the probe (`probeBinary("objwrite")`, so the gate's
  probe check now requires it).
- `scripts/criteria.ts`, `scripts/criteria.test.ts`: note 1; the excludeUnstable consistency test (note 3).
- `scripts/difftest.ts`, `scripts/miri.test.ts`: note 3.
- `harness/suites.ts`: notes 2, 4, 5, 6 and `Suite.criterion`'s doc.
- `harness/m7-suites.test.ts`: note 4's tests, plus a stale assertion fixed (below).

## 1. The objwrite probe (review vendor-object-write N2)

- **Built like the other rustc-dev probes** (`bun scripts/probes.ts build objwrite`): `rustc_dev = true`, cargo with the pinned
  toolchain, `verifyOracleToolchain` first, the source-hash stamp, the rpath to `<sysroot>/lib`. Nothing is installed or changed
  in the toolchain.
- **`sysroot_extern = ["object"]`** (new in scripts/probes.ts, rustc-dev probes only). The sysroot has two `object` 0.39.1:
  std's (`libobject-19b4….rlib` + `.rmeta`, no `write`) and the compiler's (`libobject-0a888….rmeta` only, its code inside
  librustc_driver). `extern crate object` alone stops with E0464 (tried, with `rustc_driver` loaded first too). The option adds
  `--extern object=<the one metadata-only lib object-*.rmeta>` to `CARGO_ENCODED_RUSTFLAGS`, which is the reviewer's own command
  line. The rule holds on this sysroot: all 234 metadata-only `.rmeta`s are compiler crates, and all 30 `.rlib`s are std's.
  Anything other than exactly one candidate is one `ERROR:` line. `RUSTC_DEV_MANIFEST` allows the key.
- **Fixture convention** (`PROBE_FIXTURES`): the probe prints to stdout, not to files as the scratch one did. For each `out` it
  prints `out <name>`, the step log since `new`, then `object <len>` and the bytes as hex, 32 per line with the offset. That stdout is
  `tools/probes/objwrite/objwrite.oracle.txt` (479 lines, 26 KB), and `bun scripts/probes.ts fixture objwrite` rewrites it.
- **Tests:**
  - `tools/probes/objwrite/objwrite.test.ts` needs no probe, so it always runs. It runs the twin on `cases.txt` and compares the
    result with the fixture. On a mismatch it names the first differing line and its `out` section. It also checks the fixture's
    list of `out`s and the probe's build metadata, and unit-tests `compilerCrateFile`.
  - `tools/probes/fixtures.test.ts` compares the fixture with the built probe. `RUST_TS_REQUIRE_PROBES` decides whether a missing
    probe skips or fails, as for every other fixture.
- **Results:**
  - Probe and twin agree byte for byte over 15 outputs: **13 objects** and 2 write errors.
    - Mach-O x86_64, aarch64, PowerPc and i386.
    - ELF x86_64, i386, mips64el, mips64 BE, mips BE, arm, ppc64 BE, aarch64 and riscv64.
  - **15 error messages** in all, the 2 write errors included.
  - Note: the review says "14 objects"; this script writes 13, plus the 2 errors.

| mutation (review §6) | committed tests before | now |
|---|---|---|
| M2 `Rela64_r_info` with `r_sym`/`r_type` swapped (`src/vendor/object/elf.ts`) | pass | **fails**: line 190, x86_64-elf.o `.rela` entry |
| M4 TLV entry 2 pointers, not 3 (`write/macho.ts`) | pass | **fails**: x86_64-macho.o `object 1232` vs `1248` |
| M5 comdat header `sh_info: 0` (`write/elf/writer.ts`) | pass | **fails**: line 205, x86_64-elf.o section header |
| M6 `BRANCH26` addend implicit (`write/macho.ts`) | pass | **fails**: aarch64-macho.o `object 1072` vs `1088` |

In each run, only the new objwrite test failed (23 pass, 1 fail over `tools/probes/objwrite/`, `src/vendor/object/` and
`link_objects.test.ts`).

**Root:** the probe is already built in the shared `$RUST_TS_DATA/target/probes` (stamped). A host that lacks it needs
`bun scripts/probes.ts build objwrite`, because the gate's probe check now requires it.

## 2. harness-m7b-recheck notes

1. **criteria.ts.** After the group lines, it now prints one line per milestone (`milestone M7a: met (4 of 4 groups met)`) and a
   last line saying what the exit status means. Exit behaviour is unchanged, and gate.ts does not read the script. On
   `gate-20261114-162816-root-vc2v --milestone M7` it prints M7a met, M7b met, M7c not met (2 of 3), then
   `exit 1: not met: M7c; met all the same: M7a, M7b (read each milestone's line, not the exit status)`.
   Tested with `milestoneVerdicts`.
2. **Compile-to-compile nondeterminism.** There is no cheap check: comparing two compiles would double every oracle compile.
   The limit is documented in the native section header of `harness/suites.ts`, which says `oracle-self` is the tool that finds such
   cases. Not in native-run.ts's header: see "Suites" below.
3. **The difftest criterion and UNSTABLE.** `criterionExcludesUnstable(suite)` follows criteria.ts's `GROUPS`: true exactly when a
   non-`allCases` group naming the suite has `excludeUnstable`. That is mir-o2, mono-ui, run-pass-native, run-fail-native and
   ir-run-pass.
   - `criterionOf` then leaves UNSTABLE out and records `unstable`. The printed line adds `UNSTABLE excluded: N`.
   - M6 suites' summaries are unchanged: there is no `unstable` field unless it is excluded.
   - Tested: 282/289 with 7 UNSTABLE reads 282/282, as in criteria.ts.
   - A criteria.test.ts test checks that the groups naming one suite agree on `excludeUnstable`.
4. **`libcLoadedOn`.** `cfgAttrs` now finds each attribute and balances its parentheses in the comment-blanked text, then reads
   the predicate from the raw text at the same offsets.
   - A commented-out `#[cfg]` (line, block or nested comment) is no longer a gate.
   - A `)` inside a cfg string value no longer cuts the predicate short.
   - Six new cases in `m7-suites.test.ts`.
5. **The `HOME` sweep's reach.** The harness/suites.ts native header now says that a process running a platform binary is
   invisible to `ps -E`, so a `setsid()` escapee that execs one survives the run, still sandboxed. native-run.ts's header and
   `killEscaped`'s doc are unchanged, for the reason in "Suites".
6. **`yield.rs`.** The reason now says the race is rare on this host: seen once (first review), then stable in 3 and in 6 oracle
   runs. It also says the source has a real race (`main`'s `1 2 3` against the child's `4 5 6`, with only `yield_now` between them).

**Also fixed:** `harness/m7-suites.test.ts` asserted that the six M7b suites have no baseline. That has been false since the 40r
accept (`4ec9a565`), so the test failed on main. It now asserts that they do.

## Suites: the dump

Scratch script `…/scratchpad/dump.ts`, not committed. Per suite, it hashes:
- the metadata;
- the cases (id, file, args, env, mode, cwd);
- the skips;
- the unstable ids and, separately, their reasons;
- every case's oracle and subject command, `caseLock` and `irArgs` (or the batch command);
- `blessed`;
- the subsets' membership;
- `oracleKey()`;
- every 25th case's full oracle cache key.

It ran on `2bf7435a` and on the branch, both checked out in this same worktree.

- **First dump: native-run.ts's header was the wrong place.** The native suites' `oracleKey` hashes the whole of
  `scripts/native-run.ts`, so a comment-only edit there re-keys every native case (native-hello, run-pass-native, run-fail-native).
  The two notes moved to `harness/suites.ts`, and native-run.ts is byte-identical to base.
- **Final dump: 81 suites, all identical**, except `run-pass-native`'s `unstable-reasons`. That is note 6's intended text change;
  its unstable ids are identical. Details are in the final message.

**For root:** a header note in native-run.ts should ride along with its next functional change, which re-keys anyway.

## Commands

| command | result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `bun test ./harness/ ./scripts/ --timeout=300000` | 577 pass, 0 fail (54 files) |
| `RUST_TS_REQUIRE_PROBES=1 bun test ./tools/` | 84 pass, 0 fail (19 files) |
| `bun scripts/coverage.ts --check` | markers ok |
| `difftest --suite mono-ui --sample 200 --jobs 6` | 200 MATCH (`20261115-004609-harness-w40s-7xzo`) |
| `difftest --suite run-pass-native --sample 200 --jobs 6` | 191 MATCH, 9 UNPORTED, none protected (`20261115-004747-harness-w40s-2yi4`) |

Not run (root's): the gate, full suites, the `src` unit step.

## Ported code

None. There are no `unported(...)` or `// PORT:` decisions: this batch ports no upstream code.
