# Handoff: harness-w37 (harness batch, M6 wave 37; needs an independent review)

Branch `t3/6d969625`, from `main` `ccf5dc4a`. Harness, scripts and probe registrations only. No port code under `src/`
changed (no fixture moved either: the four probe fixtures stay where their lanes committed them and are reproduced
byte for byte), so there are no coverage changes of ported code, `// rustc:` markers, `unported(...)` calls or
`// PORT:` decisions. No baseline, oracle output, protected suite, oracle cache key or runner of a protected suite
changed (dump below).

## Files touched

| file | item | change |
|---|---|---|
| `scripts/lib/miri-trace.ts` | 1 | `maskAddresses(record, bases)`: an address with `[alloc<id>]` / `[a<id>]` is written relative to the first address seen with that id in the trace (`0xADDR+0x<n>`, `0xADDR-0x<n>`); `[wildcard]` stays `0xADDR`; `normaliseTrace` keeps one `AllocBases` map per trace |
| `scripts/miri-diff.test.ts` | 1 | the masking test rewritten; real records of the cached hello trace; per-trace bases, continuation lines, 64-bit addresses |
| `harness/compiletest.ts` | 2 | `needs-llvm-zstd` from `--print=backend-has-zstd`; `needs-deterministic-layouts` from `oracleStdLayoutsRandomized()` (+ `layoutOrders`, `needCondition`); a need's condition may be decided on first use |
| `harness/compiletest.test.ts` | 2 | both needs against the oracle; the layout parser on real oracle output; `type-sizes.rs` a case with `needs`, still rejected without |
| `scripts/miri.test.ts` | 2 | counts: run-pass 3,477 → 3,478 cases (+heavy), 498 → 497 skipped; only `needs-sanitizer-support` is still a needs skip |
| `tools/probes/mirisched/` (new) | 3 | `Cargo.toml.in` (`lockfile = "upstream"`) + `main.rs` copied from `docs/handoff/miri-threads-probe/` |
| `tools/probes/mirimath/` (new) | 3 | `Cargo.toml.in` (`lockfile = "upstream"`, `opt-level = 3` kept) + `main.rs` copied from `docs/handoff/miri-eval-fix-probe/` |
| `scripts/probes.ts` | 3 | `PROBE_FIXTURES` entries are `{ fixture, args?, host? }`; `fixture` passes `args` and refuses to rewrite a `host` fixture on another host |
| `tools/probes/fixtures.test.ts` | 3 | 4 probes; a `host` fixture on another host is a visible skip with the reason printed (also under `RUST_TS_REQUIRE_PROBES=1`) |
| `scripts/lib/ctfe-sample.ts` (new) | 4 | pure: `classify`, `sampleFiles`, `fileEdition`, `sampleReport`, `failures`, the class lists |
| `scripts/ctfe-sample.ts` (new) | 4 | the CLI (tool, not a suite) |
| `scripts/ctfe-sample.test.ts` (new) | 4 | the classes, selection, report, and one real CLI run |

## 1. miri-diff: offsets inside an allocation stay comparable

Miri prints a pointer as `0x<address>[alloc<id>]<tag>` (machine.rs `Provenance::fmt`; `{:#?}` prints the id as
`a<id>`, `impl Display for AllocId`). The address is the allocation's base plus the offset (`OFFSET_IS_ADDR`). The
base depends on the environment; the offset does not. The trace never prints a base, so per trace the **first address
seen with an id** stands in for that allocation's base. Every address with that id is written relative to it:
- `0x20150[alloc27]` then `0x20158[alloc27]` → `0xADDR+0x0[alloc27]`, `0xADDR+0x8[alloc27]`
  (before: both `0xADDR[alloc27]`);
- an address below the first one → `0xADDR-0x<n>`.

A record's masked text depends only on itself and earlier records, so records before the first difference stay
comparable. That is why the stand-in is first-seen, not the minimum over the trace: with the minimum, a late lower
pointer would rewrite earlier records and move the first difference.

- **Still hidden:** every pointer into one allocation moved by the same amount on one side, the first one included.
- **`[wildcard]`:** has no allocation to be relative to, so it stays masked whole.
- **Unchanged:** the id and tag stay, and bare integers stay.
- **No cache impact:** the oracle trace cache holds raw output (normalised after reading), so no entry is invalidated.

Tests (`scripts/miri-diff.test.ts` "pointer addresses"):
- The real records of the cached `tests/miri/hello` oracle trace: `&str` pointers into alloc1, and the `OnceLock` in
  alloc223 with its `Once` field `0x38` in.
- All bases shifted by `0x1000`: the traces match.
- The field at `0x30` instead of `0x38`: they diverge at that record. The old mask hid this.
- Another allocation or another tag: still differs.
- Bases are per trace. A continuation line counts too. 64-bit addresses are exact (BigInt).

In the cached hello trace, 1,466 records carry a pointer address and 529 of them now show a nonzero offset that the
old mask hid.

## 2. `needs-llvm-zstd`, `needs-deterministic-layouts` decided by the oracle

- **`needs-llvm-zstd`:** needs.rs `llvm_has_zstd` asks `--print=backend-has-zstd`, without `--target`
  (`query_rustc_output` adds only `target_rustcflags`). The default backend is llvm, as for `has_mnemonic`. The oracle
  here prints `false`, so a test with it is ignored with needs.rs's reason. **No tests/ui case uses it at the pin.**
  - Host dependence (like `needs-asm-ret`): the answer is this host's LLVM's. A Linux dist toolchain may print `true`.
- **`needs-deterministic-layouts`** (`!config.rust_randomized_layout`, "rustc/stdlib were compiled with randomized
  layouts"). The reviewer's "the dist nightly is not built with randomized layouts" is now checked against the oracle,
  not assumed. `oracleStdLayoutsRandomized()` (header in compiletest.ts):
  - **What the oracle can do.** It *can* randomize: its rustc_abi has the `randomize` feature. A crate compiled with
    `-Zrandomize-layout` has its fields shuffled. So "can this rustc randomize" does not decide the need.
  - **How std's setting is visible.** `-Zrandomize-layout` puts `ReprFlags::RANDOMIZE_LAYOUT` into every ADT's
    `ReprOptions` in the crate's metadata. Any crate that lays out such an ADT shuffles it. So std's setting shows in
    the field order of std's types, as another crate sees them.
  - **The probe.** `#[rustc_dump_layout(debug)]` on `core::ops::Range<[u8; k]>` for k = 1..=64. The type has two equal
    fields, so the deterministic order is `[0, 1]`. Each k gives a different shuffle seed (field layouts'
    `randomization_seed`), so a randomized `Range` would swap about half of them.
  - **The control.** The same struct in an aux crate compiled by the oracle with `-Zrandomize-layout`
    (`rl_aux::Range`). It must show swaps, or the check returns `undefined` (skip, as before).
  - **At the pin:** `core::ops::Range` is reordered 0/64; the control 29/64. So the need holds.
  - **Cost:** 2 metadata-only compiles in a temp dir under `$RUST_TS_DATA/tmp`, removed afterwards. About 50 ms, only
    when a test with this need is evaluated (the condition is decided on first use).
  - **Assumption** (in the header): bootstrap passes the flag to every crate of the std build, so `core`'s `Range`
    stands for the standard library.

Case-list effect (from the dump):
- **run-pass-miri:** 3,469 → 3,470 cases; skipped 498 → 497. `tests/ui/structs-enums/type-sizes.rs` is now a case.
  - Its skip reason was the `needs-deterministic-layouts` "depends on compiletest configuration" one.
  - Miri oracle timing: `bun scripts/miri.ts time --suite run-pass-miri --filter structs-enums/type-sizes.rs`: exit 0,
    33 ms user. Not heavy.
- **pm-ui, pm-expanded:** unchanged. type-sizes.rs is not in the pm corpus (it is not a proc-macro test), so the
  lane brief's "Miri/pm case sets" is only the Miri one.
- **Every other suite:** unchanged. Suites without `needs: true` keep the old rule.

Not done (outside this lane's scope, from the same review note L3): `needs-git-hash` and `needs-*-debug-assertions`
could be decided the same way (`rustc -vV` commit hash; `cfg(debug_assertions)` of the sysroot). How many cases they
hide in the Miri/pm sets was not counted; a candidate for the next harness batch.

## 3. Probes `mirisched` and `mirimath` registered

| probe | from | fixture | lines |
|---|---|---|---|
| `tools/probes/mirisched` | `docs/handoff/miri-threads-probe/` (was `schedprobe`) | `src/miri/concurrency/scheduler.oracle.txt` | 17,709 |
| `tools/probes/mirimath` | `docs/handoff/miri-eval-fix-probe/` | `src/miri/math.oracle.txt` (`mirimath aarch64-apple-darwin`) | 125 |

- **Lockfile decision:** both use `lockfile = "upstream"`, i.e. upstream's Cargo.lock, the lock the oracle's Miri was
  built with. The lanes' own `Cargo.lock`s were fresh resolutions with newer bitflags 2.13.2, smallvec 1.16.3, cfg-if,
  cpufeatures and libc. Upstream's lock has bitflags 2.10.0 and smallvec 1.15.1. rand 0.10.1, chacha20 0.10.0 and
  rustc_apfloat 0.2.3 are the same in both.
- **Fixtures reproduce byte for byte** with upstream's lock:
  - `bun scripts/probes.ts build mirisched mirimath`: built.
  - `bun scripts/probes.ts fixture`: all four `unchanged` (randstream 254, miriaddr 3,673, mirisched 17,709, mirimath
    125 lines).
- **`PROBE_FIXTURES` shape:** entries are now `{ fixture, args?, host? }`. mirimath gets `args: [tuple]` and
  `host: "aarch64-apple-darwin"`, because part 2 of its output is the host libm's.
  - On another host (`oracleHost()`), `fixtures.test.ts` skips it and prints the reason, as `src/miri/math.test.ts`
    does. A host mismatch is not a missing probe, so it skips under `RUST_TS_REQUIRE_PROBES=1` too.
  - `probes.ts fixture mirimath` there dies with `ERROR: ... holds the results of host aarch64-apple-darwin, this host
    is ...; not rewritten`.
  - Both paths were tried by setting `host` to x86_64-unknown-linux-gnu temporarily: 4 pass, 1 skip with the line
    printed; `fixture` refused.
- **Gate pre-check:** the literal `probeBinary("mirisched")` / `probeBinary("mirimath")` lines make the gate's
  unit-test probe pre-check require both probes. Both are built in the shared target dir
  (`$RUST_TS_DATA/target/probes/release/`).
- **Left in place:** the `docs/handoff/*-probe/` copies (other lanes' handoffs, as harness-w36 did). The comments in
  `src/miri/math.test.ts` (header, line 3) and the miri-threads test still point at the handoff copies. That is a
  port-side comment update for the file owners: "the probe is tools/probes/mirimath".

## 4. `scripts/ctfe-sample.ts` (tool, not a suite)

`bun scripts/ctfe-sample.ts [--n N|all] [--filter RUSTC_LOG] [--dir DIR] [--jobs J] [--file F.rs]`. Defaults
`--n 150 --filter rustc_const_eval::interpret=info --dir tests/ui/consts --jobs 6`.

**Kept from the lane's script:** the same selection (every k-th sorted file), argv, caps (5 MB per stream, streamed
and killed), 120 s timeout, classes and grouping.

**Changes:**
- The pure part is in `scripts/lib/ctfe-sample.ts`, so it is tested in-process.
- It runs this tree's port (`src/rust_ts/main.ts`), not a `<worktree>` argument. `RUST_TS_IMPL=port` is forced.
- The oracle is `oracleRustcCmd` (`rustc +<pin>`), after `verifyOraclePin`. The sysroot is `oracleSysroot()`.
- The environment is `caseEnv` (the harness's scrubbed variables) plus `RUSTC_LOG`, `RUSTC_ICE=0`, `RUST_BACKTRACE=0`.
- The file argument is relative to the upstream checkout (the suites' convention), not absolute.
- Output goes to `$RUST_TS_DATA/ctfe-sample/<run id>/{results.jsonl,report.txt}`. The console shows the counts and
  the top 5 groups per class.

**Classes:**
- `crashed` (port exit 101 where the oracle did not ICE), `port-timeout` and `differed` are **failures**: exit 1 with
  one `ERROR: ctfe-sample: <n> of <m> files failed (differed d, crashed c, port-timeout t)` line.
- `port-unported` and `oracle-skip` are counted, not failures.
- When both sides ICE (exit 101), the outputs are compared.

**Reproduces the lane's numbers:** the 150-file default run gives matched 147 (97 with INFO lines), differed 0,
crashed 0, port-timeout 0, unported 0, oracle-skip 3 (all "oracle output over the cap"). That is exactly
miri-log-fix §5's first row. It took 33 s wall with 6 jobs (`$RUST_TS_DATA/ctfe-sample/20261102-114305-harness-w37-wnkg`).

Test (`scripts/ctfe-sample.test.ts`, in `bun test ./scripts`):
- Every class, including:
  - a crash's message and repo-relative top frames;
  - both-ICE compared;
  - unported and oracle-skip are not failures.
- The selection.
- The edition header.
- The report lines.
- One real CLI run on `tests/ui/consts/const-fn-val.rs`: the counts sum to 1, `results.jsonl` exists, and exit 1 with
  the ERROR line exactly when the class is a failure. It is a visible skip without the upstream checkout.

## Suite dump (before/after)

harness-w36's scratch scripts, copied to `$RUST_TS_DATA/tmp/harness-w37/{dump,compare}.ts`.
- **Base:** a detached worktree of `ccf5dc4a` at `$RUST_TS_DATA/tmp/harness-w37/base`.
- **Branch:** this tree, final state.
- **What each suite's entry covers:** every scalar field, each case's full JSON hash by id, each skip's reason by id,
  `unstable()`, the oracle/subject command of the first case and the hash of all, `oracleKey()`, and the own keys.
- **Size:** 53 suites on both sides; 362,927 → 362,928 cases. `$RUST_TS_DATA/tmp/harness-w37/compare.txt`.

Every difference:
- `escape-synthetic`, `fluent-parse`, `fluent-format`, `emit`, `miri-hello`: `cwd` only. It is the repo path (scratch
  worktree vs this worktree), the same artefact harness-w36 reported.
- `run-pass-miri`: cases +1 −0, none changed (`tests/ui/structs-enums/type-sizes.rs`); skipped −1 (that file).

No protected suite differs (all 46 of `harness/baseline/` are in the dump): their cases, skips, unstable lists,
commands and oracle keys are equal. `pm-ui` and `pm-expanded` are unchanged.

## Verification

- `bunx tsc --noEmit -p .`: 0 errors.
- `RUST_TS_REQUIRE_PROBES=1 bun test ./scripts ./harness --timeout=300000`: 148 pass, 0 fail, 19 files.
- `RUST_TS_REQUIRE_PROBES=1 bun test tools/probes/fixtures.test.ts`: 5 pass.
- `bun scripts/coverage.ts --check --offline`: `markers ok (23954; vendor 5050; library 506)`.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/miri/math.test.ts src/miri/concurrency`: 53 pass (the fixtures' own tests).
- `RUST_TS_AGENT=harness-w37`, same samples on base (`ccf5dc4a` worktree) and branch, case ids and statuses identical:
  - `bun scripts/difftest.ts --suite pm-ui --sample 20`: MATCH 20/20, skipped 2 (branch run
    `20261102-114436-harness-w37-m3j7`, base `20261102-114508-harness-w37-qf2c`).
  - `bun scripts/difftest.ts --suite expanded --sample 100`: MATCH 100/100, skipped 3 (branch
    `20261102-114443-harness-w37-xids`, base `20261102-114514-harness-w37-vh5l`).

## For root

1. **Decisions to record:**
   - (a) miri-diff addresses are relative to each allocation's first-seen address per trace; `[wildcard]` stays fully
     masked.
   - (b) `needs-llvm-zstd` and `needs-deterministic-layouts` are evaluated from the oracle in the M6 run/pm case sets.
     run-pass-miri gains `type-sizes.rs`.
   - (c) mirisched/mirimath build with upstream's Cargo.lock (not the lanes' own locks); the fixtures are unchanged.
   - (d) mirimath's fixture test skips on another host, also under `RUST_TS_REQUIRE_PROBES=1`.
   - (e) `scripts/ctfe-sample.ts` is a tool: crash, timeout and difference fail it; not part of the gate.
2. **Build the probes** wherever the gate runs: `bun scripts/probes.ts build mirisched mirimath`. They are built here.
3. **Port-side comment follow-up:** math.test.ts and the scheduler test name the handoff probe directories.
