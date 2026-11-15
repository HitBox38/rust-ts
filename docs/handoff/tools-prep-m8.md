# Handoff: tools-prep-m8 (M8 wave 41, step 1; scripts/tools batch)

Plan: `docs/plan-m8.md` D3, D4 and `scope.json` per D1 (D21: merges before any contract lane). No builds of cargo, clippy,
rustfmt or the test crate. Nothing under `src/` was touched.

## Files touched

| File | What |
|---|---|
| `UPSTREAM.json` | `rust.sparse` gains `src/tools/clippy` and `src/tools/rustfmt`. New top-level `cargo: { repo, commit 29c5daa1afc262323364e039bb70c83372cc702c, sha256 a1aaf161… }` (D3), beside `rust` because it is another repository |
| `scripts/upstream.ts` | `status` also checks that each sparse path is in the checkout's sparse set and on disk, and that UPSTREAM.json `cargo.commit` equals the pin's `src/tools/cargo` gitlink. `fetch` is unchanged: it already applies `sparse` |
| `scripts/tools-src.ts` (new) | `setup [cargo\|tools-deps]` and `status`, modelled on `rg-check.ts setup`, the only networked step; header has the details |
| `scripts/lib/tools-src.ts`, `scripts/lib/tools-src.test.ts` (new) | the pure parts (pin check, tarball URL and directory, the scratch manifest, the lock subset check) and their tests (node: imports only) |
| `scripts/lib/scope.ts`, `scripts/lib/scope.test.ts` | `tools` scope: `toolPathScopes`, `toolsExcluded`, `toolsEntryErrors`, `toolMarkerError`; `scopeOfPath` knows tool roots. 11 new tests (fixture tree + scope.json at the pin) |
| `scripts/coverage.ts`, `scripts/coverage.test.ts` | the tool crates as coverage crates (D4), see below. 4 new tests |
| `harness/scope.json` | new `tools` section (`crates` and `excluded`); see "Decisions" |
| `harness/m7-suites.test.ts` | **the one harness/ edit outside scope.json:** its test "the sparse list adds exactly the directories root approved" pins `sparse` exactly, so D3's two entries are added to its expectation (with a comment naming plan-m8 D3). Without it the gate's runner unit step fails. Root/reviewer: please confirm this is acceptable in this batch |
| `README.md` | Setup gains `bun scripts/tools-src.ts setup` |

## D3: sources, with sizes (measured on the root host, $RUST_TS_DATA = the main checkout's `.data`)

| Fetch | Size on disk | Notes |
|---|---|---|
| sparse `src/tools/clippy` + `src/tools/rustfmt` (`bun scripts/upstream.ts fetch`) | **37.0 MiB** (clippy 26.9, rustfmt 10.2) | `.git` did not grow (its blobs were already in the object store); 3.4 s. `upstream.ts status`: `ok sparse: 11 paths checked out`, `ok cargo 29c5daa1… (gitlink …)`; HEAD at the pin, so the files are the pin's. Checkout status clean |
| `cargo-src`: tarball | **4.3 MiB** | SHA-256 equals D3's |
| `cargo-src`: unpacked source `cargo-29c5daa1…/` | **25.4 MiB** | |
| `cargo-src/cargo-home` (`cargo fetch --locked`, oracle cargo) | **669.3 MiB** (500 crates: 561 MiB unpacked `registry/src`, 77 MiB `.crate`s, 32 MiB index) | **D23 says 365 MiB.** This is the plan's command (all targets). A host-only fetch (`--target aarch64-apple-darwin`) would hold about 216 MiB of sources (391 crates, measured from `cargo tree --workspace --target aarch64-apple-darwin -e normal,build,dev` over the fetched sources); I did not switch, since it is not what D3/D23 say and the cargo-build harness may need other targets' crates to resolve offline. Root's call |
| `tools-deps` (`setup tools-deps`) | **117.0 MiB** CARGO_HOME (116 packages) | D23 estimated ~0.1 GiB |
| **Total added** | **about 853 MiB** (37 + 699 + 117) | free space went from ~15.1 GiB to ~14.3 GiB. D23's "1.1–1.4 GiB without the testsuite trees" becomes about 1.4–1.7 GiB with the measured CARGO_HOME |

`tools-deps` (re-check2 P7a): a scratch workspace at `$RUST_TS_DATA/tools-deps` whose root manifest lists `src/tools/clippy/clippy_config`
and `src/tools/rustfmt` (resolver 2, as the root workspace). Each package of those two and of their path dependencies (`clippy_utils`,
`rustfmt/config_proc_macro`) gets its upstream `Cargo.toml` copied byte for byte and its `src` and `build.rs` **symlinked** into the
checkout, so the codegen batches can run the oracle's `-Zunpretty=expanded` on the real sources. The rust checkout's root `Cargo.lock` is
copied in. **`cargo fetch` runs without `--locked`**: pruning the lock to what these packages reach is itself a lock change, which
`--locked` refuses. Instead the setup then refuses any package of the pruned lock that the root lock does not have with the same name,
version, source and checksum (`lockSubsetErrors`, unit-tested), so nothing resolves away from the pin. After setup,
`cargo metadata --offline --locked` and `cargo fetch --offline --locked` both succeed in it (checked by hand; nothing built). Re-running
the setup rewrites everything but the CARGO_HOME; the checkout stays clean (checked).

`bun scripts/tools-src.ts status` → `ok cargo-src 29c5daa1afc2 (…)`, `ok tools-deps at the root Cargo.lock (…)`.

## D4: coverage

`harness/scope.json` `tools.crates` names one coverage crate per entry, each a `PathScope` with its own `root`, counted like Miri
(rows in the per-crate table at 0 too, `--crate`, `--missing` with scope notes, `--check` against every fn under the root):

| Crate | Root | Fns (0 ported) |
|---|---|---|
| `clippy_lints` | `src/tools/clippy/clippy_lints/src` | 0/3,295 |
| `clippy_utils` | `src/tools/clippy/clippy_utils/src` | 0/982 |
| `clippy_config` | `src/tools/clippy/clippy_config/src` | 0/108 |
| `clippy` | `src/tools/clippy/src` (driver.rs, main.rs) | 0/24 |
| `declare_clippy_lint` | `src/tools/clippy/declare_clippy_lint/src` | 0/4 |
| `rustc_tools_util` | `src/tools/clippy/rustc_tools_util/src` | 0/11 |
| `rustfmt` | `src/tools/rustfmt/src` (lib, the four bins, `src/test/*`, cargo-fmt's tests) | 0/1,595 |
| **all tools** | | **0/6,019** |

**TOTAL** (full run, against a scratch `RUST_TS_DATA` so the shared `coverage.json` was not rewritten before the merge):
`TOTAL 26263/33892 fns ported (77.49%) across 74 crates`, from 26263/27873 (94.2%), because the tool rows count in TOTAL as Miri's does.
WRAPPER and VENDOR unchanged. `state.ts summary` will show the new figure after root's next full `coverage.ts` run.

`--check` (the gate's `markers` step) additionally refuses a `// rustc:` marker under `src/tools/` that is under neither Miri's root nor
a tool crate's root: one into a `tools.excluded` tree (message names the entry and reason), one under no root (`tests/`, `book/`,
`build.rs`, ...), and one into a tool root the checkout lacks (D21: "rejects markers into trees that are not checked out"). A missing
root otherwise prints a `note:` (as Miri). Checked by hand with a throwaway marker file (since removed): a right marker passes, a wrong
line is "matches no upstream fn", `clippy_dev` is "out of scope (… tools.excluded src/tools/clippy/clippy_dev: …)", `book/` is "under no
tool crate's root". `toolsEntryErrors` refuses tool entries that name nothing (roots or excluded paths that do not exist when the tool's
directory is checked out, roots not under `src/tools/<tool>/`, nested roots, overlap with Miri's root, names taken by Miri or a compiler
crate, excluded entries without a reason or overlapping a root). `--missing` on an out-of-scope tool path prints a note.

`--check --offline`: 2.4 s before, 2.8 s after. Full run: 2.7 s.

## Decisions (for root to record; I did not write `docs/state/`)

1. **The tool crates count in TOTAL**, as Miri does (D4 says "following Miri (plan-m6 D2)"). The alternative, a separate TOOLS
   figure like WRAPPER, would keep TOTAL at the compiler + Miri.
2. **`declare_clippy_lint` (4 fns) and `rustc_tools_util` (11 fns) are coverage crates too**, though D4 names only five: §1c counts them
   in clippy's in-scope total, D14's `clippy-contract-a` includes `declare_clippy_lint`, and the driver's `--version` line comes from
   `rustc_tools_util`. Mapping by D4's pattern: `src/declare_clippy_lint/lib.ts`, `src/rustc_tools_util/lib.ts`. Without an entry their
   markers would be refused by the new `--check` rule.
3. **`tools.excluded`** holds D4's five (`clippy_dev`, `lintcheck`, `clippy_lints_internal`, `clippy_dummy`, rustfmt's `check_diff`)
   and three more crates outside every root, for clearer refusals: `clippy_test_deps` (built by the oracle, D10), rustfmt's `ci`, and
   rustfmt's `config_proc_macro` (proc macros, replaced by tools/codegen per D5, as `rustc_macros` is in `excluded`).
4. **UPSTREAM.json `cargo` is top-level**, beside `rust`. `harness-m8a-gate` adds `tools` for D2; root merges the two edits.
5. **`cargo fetch --locked` for cargo is all targets**, per D3 (669 MiB, not 365); a host-only fetch would save about 0.35 GiB.

## Things root should know

- **`rg-build`'s subject key hashes `UPSTREAM.json`** (`scripts/rg-build.ts` `portInputs`), so this batch (and `harness-m8a-gate`'s)
  makes the next gate rebuild ripgrep through the port (the heavy subject side; oracle cache unaffected). No other cache key reads
  UPSTREAM.json's `sparse` or a new key; difftest case keys depend on each case's files, which the new trees do not touch.
- **Worktrees on an older `UPSTREAM.json`** that run `bun scripts/upstream.ts fetch` will `sparse-checkout set` without the two tool
  paths and remove them from the shared checkout; after that `--check` refuses any tool marker until a fetch from this commit or later.
- PORTING.md §2's path list could gain D4's tool mapping (`src/tools/clippy/<crate>/src/…` → `src/<crate>/…`, `src/tools/rustfmt/src/…`
  → `src/rustfmt/…`); it is written in `harness/scope.json`'s `tools.comment` meanwhile. PORTING is root's file.
- Unit-step cost (D13): the new runner tests add about 4 s (the 10 `coverage.ts` spawns in `coverage.test.ts`; the scope and
  tools-src tests are in-process, well under 0.1 s).

## Checks run

- `bunx tsc --noEmit -p .`: clean.
- `bun test scripts/lib/scope.test.ts scripts/lib/tools-src.test.ts scripts/coverage.test.ts`: 47 pass.
- Files that read UPSTREAM.json or scope.json: `harness/m7-suites.test.ts harness/pm.test.ts harness/target-specs.test.ts
  scripts/gate-bun.test.ts scripts/gate-power.test.ts scripts/ir-normal.test.ts scripts/mono-run.test.ts tools/codegen/codegen_m7.test.ts`:
  128 pass. `scripts/lib/unit-steps.test.ts` (no runner test loads common.ts) and the toolchain, llvm-tools, deps, rg-check, sysroot-key,
  gate-static-stop tests: 58 pass.
- `bun scripts/coverage.ts --check --offline`: `markers ok (27358, …)`.
- No difftest runs: nothing under `src/` changed. No `unported(...)` and no `// PORT:` decisions (no port code in this lane).

## Environment notes

The worktree had no `.env.local` or `node_modules`: I copied the main checkout's `.env.local` and symlinked its `node_modules` (both
gitignored). No gate was running (no `$RUST_TS_DATA/tmp/GATE_RUNNING`); host on AC power.
