# Handoff: harness-w38 (harness batch, wave 38; needs an independent review)

Branch `t3/preserve-unported-reasons-probes`, from `main` `c9d3c553`. Harness, scripts and probes only. No port code under
`src/` changed, so there are no coverage changes, `// rustc:` markers, `unported(...)` calls or `// PORT:` decisions. No
baseline, committed oracle output, suite definition or oracle cache key changed.

## Files touched

| file | item | change |
|---|---|---|
| `scripts/difftest.ts` | 1 | `unportedBuckets()`, `UNPORTED_NO_REASON`, summary key `unportedBuckets`; `SplitRunResult.unported` |
| `scripts/unported-buckets.test.ts` (new) | 1 | real `difftest()` runs with stub suites, read back from the run's files |
| `scripts/ctfe-sample.ts` | 2 | a missing `--file` is one `ERROR:` line |
| `scripts/ctfe-sample.test.ts` | 2 | finds the checkout as the CLI does; a test of the missing file |
| `harness/compiletest.ts` | 2 | the layout check returns undecided instead of throwing, and also checks the Miri sysroot |
| `harness/compiletest.test.ts` | 2 | both libraries, the undecided paths, `combineLayouts` |
| `scripts/probes.ts` | 2, 3 | `fixtureSelection`, `probeFixtureCmd`, `ProbeFixture.miri`, two new entries |
| `tools/probes/fixtures.test.ts` | 2, 3 | host from `RUST_TS_HOST_TUPLE`, truthful titles, the new probes, the os_str table check |
| `scripts/gate-probes.test.ts` | 2 | a missing probe's title, with and without `RUST_TS_REQUIRE_PROBES=1` |
| `tools/probes/miripaths/` (new) | 3 | `Cargo.toml.in`, `main.rs`, `paths.oracle.txt` (16 lines) |
| `tools/probes/miriepoll/` (new) | 3 | `main.rs`, `epoll.oracle.txt` (85 lines) |

## 1. UNPORTED buckets in the summary

Root corrected the brief mid-lane: the `<suite>.jsonl` rows already keep the reason, so row writing is unchanged. I
checked this on the wave 37 gate run: all 141 UNPORTED rows across its 13 suites with any have `unported`, including the
61 Miri cases (60 run-pass, 1 run-fail).

The summary already had the flat count `UNPORTED: <n>`, which stays as it is. New, next to it:

```json
"unportedBuckets": { "rustc_codegen_llvm::llvm_util::configure_llvm (-C target-feature)": 1 }
```

- Reason to count, most frequent first, ties by reason. The counts sum to `UNPORTED`.
- The key is absent when `UNPORTED` is 0, like the summary's other conditional parts.
- An exit 70 with no `rust-ts: unported:` line goes under `(no reason printed)`.
- **Split suites:** section rows have no reason of their own and that stays so (`split-run.test.ts` pins it). They count
  under their run's reason, so the sum still holds. That is what `SplitRunResult.unported` is for: it is not written to
  any row.

Statuses and how MATCH is decided are unchanged. **Readers:** `gate.ts` reads `<suite>.jsonl` (`id`, `status`) and
`gate.json`, and nothing parses `<suite>.summary.json`, so neither is affected. The console line is unchanged too.

## 2. The harness-w37 review's queued nits

There is no verdict file for this review in `docs/reviews/`. The list is the one in `docs/state/history.jsonl`.

| nit | outcome |
|---|---|
| ctfe-sample CLI test reads `RUST_TS_DATA` from the environment | **Fixed.** A child asks `scripts/lib/common.ts`, so `.env.local` counts. Plain `bun test` now runs it (10 pass, 0 skip). |
| `fixtures.test.ts` decides the host by `rustc -vV`, `math.test.ts` by `RUST_TS_HOST_TUPLE` | **Fixed.** `fixtures.test.ts` uses `RUST_TS_HOST_TUPLE`. `print.oracle.test.ts` already checks it against `rustc -vV`. |
| ctfe-sample `--file` on a missing file stack-traces without `ERROR:` | **Fixed**, tested. |
| layout check throws if its own compiles fail | **Fixed.** Undecided with the reason, so the test is skipped like any undecided need. `layoutOrders` itself still throws on bad input (tested); the check catches it. |
| layout check looks at the standard toolchain's std, not the Miri sysroot's | **Fixed.** Both are checked when the sysroot is built: oracle std 0/64 reordered, Miri sysroot std 0/64, each control 29/64. |
| `probes.ts fixture` with no names exits 1 on another host | **Fixed.** That fixture is left alone with a `note:`. Naming it is still an error. |
| a missing probe's test title says "skipped" when it fails | **Fixed.** Under `RUST_TS_REQUIRE_PROBES=1` the title says `(required, missing: ...)`. |

Three consequences to check in review:
- **`harness/compiletest.ts` is outside `scripts/` and `tools/probes`**, where the brief said this lane owns files. The
  two layout nits live only there, and item 2 says to fix them, so I edited it. `harness/suites.ts` is untouched. Expect
  a possible merge overlap if harness-m6c edits the same file.
- **`needs` are decided once per target, not per suite**, so the need holds only if neither library is randomized. A
  proc-macro suite therefore also depends on the Miri sysroot once it is built. If that sysroot's check cannot decide,
  `needs-deterministic-layouts` is undecided for those suites too and `type-sizes.rs` is skipped. The ratchet would
  report that as a lost case. Without the sysroot, only the oracle's std is checked.
- **A lane worktree without `.env.local`** now skips the mirimath fixture test with the reason printed, as
  `math.test.ts` already did. It ran before because `rustc -vV` needs no such file. The gate is not affected.

## 3. Probes

- **`randstream`: already done.** harness-w36 registered it (`b7692094`), so nothing changed. Rebuilt from source now:
  byte-identical to `src/vendor/rand/stdrng.oracle.txt` (sha256 starts `c9d07ad619e177be`, as in the vendor-rand handoff).
- **`miripaths`: the os_str source.** It had none committed, only `$RUST_TS_DATA/tmp/shims-a/paths.rs`. That is now
  `tools/probes/miripaths/main.rs`. Apart from comments its two fns equal upstream's `os_str.rs:274-328` (diffed). The
  expectations are an inline table in `os_str.test.ts`, not a file, so the probe gets a new fixture and a test that each
  row is in that table and the row counts agree.
- **`miriepoll`: the epoll/eventfd source.** New program, `tools/probes/miriepoll/main.rs`: return values and errnos of
  eventfd reads and writes (including blocking), `epoll_ctl` errors, edge- and level-triggered readiness, ready order,
  `maxevents`, dup'd fds, two epoll instances, a timeout, and a wake from another thread.

**`miriepoll` differs from how `mirisched` and `mirimath` are registered, by necessity.** epoll and eventfd exist only on
the Linux target, so it cannot be a native cargo build. It is a `PROBE_FIXTURES` entry with `miri: true`, run from source
by the isolated Miri oracle, with no `Cargo.toml.in`. `bun scripts/probes.ts build` does not see it. It needs
`bun scripts/miri.ts setup`, and under `RUST_TS_REQUIRE_PROBES=1` a missing Miri oracle fails its test.

**Result worth knowing:** the port's `src/miri/bin/miri.ts` on this program gives the oracle's stdout byte for byte (85
lines, exit 0; about 19 s against the oracle's 1.3 s). I ran that once by hand. Nothing checks it continuously.

**Not covered by `miriepoll`:** paths that stop Miri (unsupported flags or operations, the null event on
`EPOLL_CTL_ADD`, which is UB). The texts of `epoll_ctl: encountered unknown unsupported flags` and `non-epoll FD passed`
in `shims_e.test.ts` are still from upstream reading. Covering them needs one Miri run per message, as `ub.sh` does.

`sync.oracle.txt` keeps its source in `docs/handoff/miri-shims-e-probe/`; I did not register it.

## For root

1. **Before the next gate:** the gate's probe pre-check now requires `miripaths`. It is built in the shared target; if
   that was wiped, run `bun scripts/probes.ts build miripaths`.
2. **For file owners under `src/` (not edited here):**
   - `src/miri/shims/os_str.test.ts:6` should name `tools/probes/miripaths` instead of the gitignored script.
   - `src/miri/shims/unix/shims_e.test.ts` could read `tools/probes/miriepoll/epoll.oracle.txt`, or a suite could run the
     port on the program. Either makes the match above continuous.
3. **Decisions to record:** the `unportedBuckets` shape; `ProbeFixture.miri`; `needs-deterministic-layouts` checking both
   libraries.

## Verification

- `bunx tsc --noEmit -p .`: 0 errors.
- `RUST_TS_REQUIRE_PROBES=1 bun test ./scripts ./harness --timeout=300000`: 151 pass, 0 fail, 20 files.
- `RUST_TS_REQUIRE_PROBES=1 bun test tools/probes/fixtures.test.ts`: 9 pass, 0 fail. All six fixtures match, and the
  four committed earlier were not rewritten (`git status` shows nothing under `src/`).
- `bun scripts/coverage.ts --check --offline`: `markers ok (24395; vendor 5050; library 584)`.
- Suite dump, base `c9d3c553` against this branch (harness-w37's scratch scripts): 53 suites, 362,928 cases on both. The
  only differences are `cwd` of five suites, the known repo-path artefact.
- Samples:
  - `difftest --suite run-pass-miri --filter tests/ui/cfg/crt-static-off-works.rs`: UNPORTED 1, row and bucket as above
    (run `20261103-224352-harness-w38-dc62`).
  - `difftest --suite pm-ui --sample 20`: MATCH 20/20, skipped 2.

The full `src` unit step and the gate were not run (root's).

Worktree setup, all gitignored: `.env.local` copied from the main checkout (children that strip `RUST_TS_DATA` need it) and
`bun install`. The shared probe target has a rebuilt `randstream` and a new `miripaths`.
