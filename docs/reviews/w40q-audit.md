PASS WITH NOTES

**Wave 40q's accept stands.** No protected case was lost, removed or tampered with. All 61 suites ran: the 60 with a baseline plus
`ir-hello`. I checked every one of the 542,304 protected ids in `harness/baseline/*.txt` at `ab0d5280` against this gate's jsonl, and
every one is `MATCH`. The accept commit (`0da8b38d`) changed exactly one baseline: it added `harness/baseline/ir-hello.txt`, which holds
`hello -Copt-level=0` and `hello -O`. Both are `MATCH` at tier N1. I compared every row of the 102 jsonl files the two gates share with
wave 40p's gate, on every field. The ids and their order are the same in every file. **Only 15 rows moved, and only in `attempts`.**
They are this gate's 15 retries: the same 15 cases as 40p's, all `MATCH` in both gates. Status counts did not change in the shared files:
MATCH 542,304, UNPORTED 308, DIFF 28, TIMEOUT 2, UNSTABLE 1, and 4,317 skipped/extra rows. The 103rd file, `ir-hello.jsonl`, adds 2 MATCH.
**No case's stop reason moved.**

**This is the first gate that can reach the ported LLVM backend, but no protected case does, except `ir-hello`, which exists to.** I
recomputed both binary keys from a `git archive` of `ab0d5280`, and both equal `gate.json`. Both builds now contain
`rustc_codegen_llvm` and the IR model: main.ts gained 89 inputs and miri.ts 88 (N5). Every new LLVM-side module sits in a lazy
initialiser in the bundle, and it runs only through `ported_backend`'s `require` (N7). That function is reached from a protected compile
only if the compile reaches `codegen_crate`, and no protected suite's argv lets main.ts get there (N6):
- the main.ts suites use `-Zunpretty`, `-Zparse-crate-root-only`, or `--emit=metadata` with no second `--emit` in any protected test;
- `check-rg*` send link compiles to the oracle;
- `mono-ui`'s `MonoOnly` never forwards;
- Miri forwards codegen to its dummy backend.

The three exceptions the brief names come to nothing (N6). The startup of a protected check-only case did not change (N7). Of the
changed `rustc_codegen_ssa` files that check-only compiles do load, `link_binary` changed only inside its `should_link()` block (N5).

**Host:** on AC power throughout. Load was higher than in 40p (1-minute median 54.0 against 42.4; N9), and the suites took 1.4%
longer in total. The retries are 40p's 15, and every alone time is within ±0.6 s of 40p's. None is above 45 s: the largest is
`dynamic-drop.rs` at 39.0 s. Two heavy cases took longer wall time but barely more user time, while swap grew during their runs (N8).

Regression audit, 2026-11-14. Gate `gate-20261114-065555-root-0e2v`, tested `ab0d5280`, accepted `0da8b38d`
(`git log -1 -- docs/state/history.jsonl`), `RUST_TS_SUBJECT=binary`, Bun 1.4.4. Previous accept: wave 40p, gate
`gate-20261113-233839-root-yszn`, tested `03e9e796`, accepted `c23a6bd2`. I ran no gate, no difftest and no full suite. What I ran:
- a comparison of every row of the 102 shared jsonl files against 40p's gate, on every field. I also checked every id of the 60
  baselines at `ab0d5280` (`git show`) against this gate's jsonl. I checked `gate.json`, the `history.jsonl` accept entry, the gate log
  (`.data/tmp/gate-w57.log`, against 40p's `gate-w56.log`) and the three junit files;
- `git diff` over `harness/`, `scripts/`, `tools/`, `UPSTREAM.json`, the config files and the runtime C files, from `03e9e796` to `0da8b38d`;
- both subject-bin keys, recomputed in a `git archive` tree of `ab0d5280` with that tree's `buildSpec`, `subjectBinKey` and
  `subjectBinKeyOf`. The key was taken over `meta.spec`, the gate's own spec. Separately, the archive's spec, rebased onto the gate's paths,
  equals `meta.spec`;
- the inputs of both builds against 40p's (`meta.json`), and `git diff` of the changed inputs that a check-only compile runs;
- an in-memory `Bun.build` (no sourcemap, no output file) of both entries from archive trees of `03e9e796` and `ab0d5280`. I counted
  which modules sit in lazy `__esm` initialisers, and searched for static importers of the added files;
- a reading of `harness/suites.ts` at `ab0d5280`, for each protected suite's subject entry and argv. I grepped the sources of the
  protected `--emit=metadata` cases for `--emit`/`-Zno-codegen`, and all 26,599 protected `.rs` files for the statistics flags;
- timings of the old and new main.ts binaries (`a38b56e9`, `c8a4e911`): 8 runs each, alternating, on the protected `mir` case
  `tests/ui/entry-point/hello-world.rs` with `-Zunpretty=mir` and with `-Zunpretty=ast-tree`. Both write nothing. I also timed `-vV` on
  both pairs of binaries;
- `gate.json` `retried`/`retryTimes`/`attempts`, `host.samples`, per-suite times and the gate log's heavy lines against 40p.

Everything ran on AC power (`pmset -g batt`), with `RUSTUP_AUTO_INSTALL=0`. No gate was running (`.data/tmp/GATE_RUNNING` absent), and the
host was quiet (1-minute load 3–5). I read code but changed none.

## Notes

| # | severity | note | evidence |
|---|---|---|---|
| N1 | low | **The brief's facts hold, with three refinements.** **(a)** The model's `llvm_util::init` runs at the first forward *that has a session*: `codegen_crate`, `join_codegen` or a forwarded `link`. The three statistics forwards (`print_pass_timings`, `print_statistics`, `print_statistics_json`) pass `undefined` and load the port without init (see N2). **(b)** The brief describes the lazy `require` as main.ts's. **miri.ts gained the same inputs too (88 of main.ts's 89; it already had `std/fs.ts`)**, because both build the same stand-in. Miri never calls the forwards (N6). **(c)** The 15-minute load was 101 at 10:27:47Z (3 h 32 min in), when `tydump-nocore` started, as the brief says. Its peak was 147.1 at 10:13:56Z, during `run-pass-miri`. `gate.json` records no process names, so I cannot confirm which processes were on top. | `codegen_backend.ts:316-329`; `inputs.json` diff; `host.samples` |
| N2 | low | **A check-only compile can reach the statistics forwards, contrary to `ported_backend`'s doc comment.** The comment (`codegen_backend.ts:309-311`) says those forwards "are only reached after `join_codegen`". But `Linker::link` (`rustc_interface/queries.ts:69-79`, queries.rs:49) calls them after the check-only branch too, under `-Ztime-llvm-passes` with one CGU, `-Zprint-codegen-stats` or its `-json` form. Such a compile now loads `rustc_codegen_llvm` and stops at the model's FFI stub (`ffi.ts:1174` `stub("LLVMRustPrintPassTimings")`), not at the stand-in's old `unported`. Both are stops, so no status can turn into MATCH or out of it. **No protected case passes those flags.** A grep of all 26,599 protected `.rs` files finds only `compiler/rustc_codegen_llvm/src/llvm/ffi.rs`, a lex/parse corpus file, not a compile with flags. No row moved, the unprotected ones included. The comment should be fixed in a later wave. | `queries.ts`; `ffi.ts`; grep |
| N3 | info | **One sentence of the cg-register review is wrong; its conclusion stands.** The review says "upstream's mono-time errors are mostly non-fatal and run on into codegen" (`docs/reviews/cg-register.md:170`). In fact `collect_and_partition_mono_items` calls `tcx.dcx().abort_if_errors()` right after collection (partitioning.rs:1183). So a post-mono error ends the compile inside the head, as `CpuRequired`/`CpuUnsupported` do. That makes "a protected case whose oracle fails after codegen starts" a larger class than the review counted. **It is still empty for the main.ts suites, which never reach `codegen_crate` (N6). In `mono-ui`, those cases run `mono_collection_head`, the old head word for word (`docs/reviews/mono-run-head.md`), and all 3,475 rows are unchanged.** | partitioning.rs:1169-1183 |
| N4 | info | **`harness/`, `scripts/` and `tools/` changed in four files, as the brief lists; nothing reads them in a way that changes a protected run.** See §1's table. `scope.json` and `llvm-manifest.json` are read only by `scripts/coverage.ts`, `scripts/lib/{scope,llvm-src,cpp-fns}.ts`, `scripts/llvm-src.ts` and their tests. The `src/` hits are comments. Neither file is a build input, and no runner, `harness/suites.ts`, `difftest.ts` or `gate.ts` reads them. `tools/`, `UPSTREAM.json`, `harness/suites.ts`, `harness/corpus/`, the config files and the runtime C files did not change. | `git diff --stat`; `git grep` at `ab0d5280` |
| N5 | info | **Both binaries were rebuilt from the tested tree. The changes they carry that a check-only compile runs are inert.** Recomputed at `ab0d5280`: main.ts `c8a4e911…` (2,203 inputs; 40p 2,114) and miri.ts `0dbaa6a0…` (2,389; 40p 2,301), both equal `gate.json`. Inputs, config, runtime C and the rebased spec equal each build's `meta.json`. Config and runtime C also equal 40p's. **Added** (none removed): 43 `rustc_codegen_llvm`, 16 `rust_ts/llvm`, 27 `rustc_codegen_ssa` (`mir/*`, `meth`, `mono_item`, `back/{write,command,link.gen,symbol_edit}`, traits, `debuginfo`), `rustc_middle/ty/typetree.ts`, `scripts/lib/llvm-tools.ts` (unchanged; node-only imports), and in main.ts `std/fs.ts` (unchanged). **Changed in both:** `codegen_backend.ts` (the forwards), `back/{link,linker,archive}.ts`, and five vendor files (`object` ELF/Mach-O symbol helpers and constants, `ar_archive_writer` `MachineTypes` and import libraries: additions only). In `link_binary`, which every check-only compile runs through the stand-in's `link`, the only change outside `if (outputs.outputs.should_link())` is a `new RmetaLinkCache()`, a bare `Map` holder. The link, staticlib, native-link and stdout branches it now fills are inside that block. `ArchiveBuilder.build` is reached only by `link_rlib`, which no protected case runs. Miri's aux rlibs come from the oracle's Miri. | key recomputation; `meta.json`; `git diff` of `link_binary` |
| N6 | info | **No protected case can reach `codegen_crate`, `join_codegen`, `link`'s forward or the model's init, except `ir-hello`.** Per suite, at `ab0d5280` (§4's table): main.ts suites (parse, hir-tree\*, expanded\*, unpretty-\*, mir\*, mir-opt-o4, mir-o2, thir-tree) use `-Zunpretty`, which returns before `start_codegen`. parse-ui uses `-Zparse-crate-root-only`. check-ui, check-ui-encode-mir, rmeta-ui, pm-ui, check/rmeta-{core,alloc,std} use `--emit=metadata`. In `passes.ts:1517`, `!should_codegen()` then skips `codegen_crate`, and `Linker::link` takes the `CompiledModules` branch, so `link` runs the old body (`PORTED_BACKEND` is unset). **Emit combinations:** `--emit` lists add up, so a test's own `--emit=link` would turn codegen on. A grep of the protected pm-ui, check-ui, check-ui-encode-mir and rmeta-ui sources finds no `--emit` or `-Zno-codegen` (rmeta-ui's corpus also excludes any directive but `edition`/`no-prefer-dynamic`). `check-rg*` send every compile that emits `link` to the oracle (`scripts/rg-rustc.ts`). The dump suites run their own entries, which never call codegen. The Miri suites use `MiriCodegenBackend`: `codegen_crate`, `join_codegen` and `link` go to `DummyCodegenBackend`, and the stand-in serves `init` and `target_config` only (`miri.ts:289-321, 379-387`; `src/miri/` unchanged). **`mono-ui`:** `MonoOnly.codegen_crate` runs `mono_collection_head` and returns `CompiledModules`, so `join_codegen` is skipped, and `link` is overridden. **A protected case whose oracle fails after codegen starts:** only the head's fatal paths could have matched under the old stand-in (N3), and none of them runs in a main.ts suite. | `harness/suites.ts`; `passes.ts`; `queries.ts`; `miri.ts`; greps |
| N7 | info | **Bundling the lazy `require` did not change startup.** All 59 LLVM-side modules are inside lazy `__esm` initialisers in both bundles. The only value importers of the added files are `ported_backend`'s two `require`s, `base.ts`'s existing lazy `require`s (live now that the port calls `base.ts`), and the changed `link`/`archive`/`linker.ts`, which import `command.ts`, `link.gen.ts`, `symbol_edit.ts` and `std/fs.ts`: declarations only. In main.ts one pre-existing module moved into an initialiser (`ar_archive_writer/coff.ts`). **In miri.ts, 419 pre-existing modules moved into initialisers** (1,543 → 2,051 `__esm`). The bundler keeps ESM evaluation order for those, and every Miri row is unchanged. **Measured, old vs new main.ts, median of 8:** `hello-world.rs` at `-Zunpretty=mir` 177 vs 180 ms, and at `-Zunpretty=ast-tree` 69 vs 69 ms, with byte-identical stdout, stderr and exit. `-vV`: main 58 vs 59 ms, miri 64 vs 63 ms. Suite times: check-ui 27 → 29 s, parse-ui 14 → 14, miri-pass 146 → 147, run-pass-miri 1,059 → 1,066, at higher load (N9). | `Bun.build` of both archives; timings |
| N8 | low | **`mir-core` took 28.8 s longer and `check-core` 12.3 s longer, but their user time rose only ~4%.** Wall / user: `mir-core` 89.5 / 145.3 → 118.3 / 151.1 s, `check-core` 104.2 / 142.3 → 116.5 / 148.3 s. Max RSS fell (7,041 → 6,365 and 6,428 → 5,631 MB). Swap grew during both runs (6.2 → 7.1 GB in check-core, 6.8 → 7.2 GB in mir-core; flat in 40p), and check-core started at 1-minute load 64 (40p: 29). So I put it down to the host's memory pressure, not the binary. Neither compile reaches the changed code (`-Zunpretty=mir` and `--emit=metadata`). Every other heavy case is within ±3 s wall, and its user time within −1 to +4%. `mir-core` was 101.3 s in 40o. Both are far under the 1,800 s limit. | gate logs w56/w57; `hostStart`/`hostEnd` |
| N9 | info | **Retries: the same 15 cases as 40p, with alone times within ±0.6 s. None is above 45 s.** `retried` is equal in every suite, so only `attempts` moved. The largest are `dynamic-drop.rs` 39.0 s (40p 38.6) and `issue-8827.rs` 37.6 s (38.1); every alone run finished. Pool load at the timeouts was 114–251 (40p 59–260). Load over the run, 1-minute: median 42.4 → **54.0**, p90 94.0 → **126.0**, max 211.2 → **208.3**, samples above 100: 9 → **24**. Summed suite time 20,891 → 21,180 s (+1.4%). | `retryTimes`; `host.samples` |
| N10 | info | **The unstable case and the heavy timeouts are the usual ones.** `miri-pass` `tests/panic/panic1.rs` is the only UNSTABLE row (the `gettid` shim). The only TIMEOUT rows are `run-pass-miri-heavy`'s `hashset-connected-border-12860.rs` (1,849 s user) and `step_overflowing.rs` (1,851.1 s user), both exit 143 at 1,800 s, as in 40p. Neither is among that suite's 6 protected ids. `step_overflowing.rs` is protected in 17 other suites, where it is MATCH. | jsonl; baselines |
| N11 | low | **Disk: 6.1 GiB free (99% used), half of 40p's 12 GiB.** `subject-bin/` holds four builds: 40p's two and this gate's two. `.data/gate-bun/` is empty. Worth pruning before the next gate. | `df -h`; `ls` |
| N12 | info | **`ir-hello` took about 1 s for both cases (two processes).** The pre-gate run `20261114-064228-root-w57-qs7k` also took 1 s. Both cases are MATCH at N1, which requires the port's normalised IR to equal the oracle's. Its oracle key (`irToolsKey`, `ir-normal.ts`) did not change in this wave. | `ir-hello.summary.json`; `gate.json` |

## 1. Protected set: nothing lost

| Check | Result |
|---|---|
| Baselines `03e9e796` = `ab0d5280` | `git diff --stat 03e9e796 ab0d5280 -- harness/baseline`: empty. 60 files |
| Protected ids (`ab0d5280`) against this gate's jsonl | **542,304, every one `MATCH`**, no duplicate ids. Each suite's `gate.json` `baseline` equals its file's line count |
| `gate.json` | `pass: true`, `staticOk`, `skipStatic: false`, `head` `ab0d5280`, `dirty: []`, `unstableOk`, `upstreamOk`, `staticNotes: []`. 61 suites: 40p's 60 in the same order, then `ir-hello` before the heavy ones. Sums: `lost` 0, `gained` 2 (both `ir-hello`), `lostSkipped` 0, `oracleTimeouts` 0, `upstreamChanges` 0, batch-only failures and timeouts 0, `retried` 15, `unstable` 1. Baseline 542,304, match 542,306, total 542,645 |
| Gate log (`gate-w57.log`) | 60 `ok … lost=0 gained=0` lines, `ok ir-hello: protected=0 match=2/2 lost=0 gained=2`, `note: ir-hello: read at IR tier N1`, then `gate PASS run=gate-20261114-065555-root-0e2v`. No `ERROR`, no power note |
| `history.jsonl` accept entry (2026-11-14T12:58:34Z) | `runId` and `head` match; 61 suites. Each `protected` equals its baseline's line count at `0da8b38d` (0 mismatches, sum 542,306); `ir-hello` `{protected: 2, total: 2, irTier: "N1"}` |
| `0da8b38d` | parent `ab0d5280`. Changes `README.md`, `docs/next.md`, `docs/state/current.json`, `docs/state/history.jsonl` (+1) and **adds `harness/baseline/ir-hello.txt` (2 lines: `hello -Copt-level=0`, `hello -O`)**. No other baseline touched |
| `ir-hello` | Gate-scope decision 2026-11-14T06:52 ("ir-hello … joins the gate's --suites"). `ir-hello.jsonl`: 2 rows, both MATCH; summary `irTier: "N1"`, criterion met (2/2) |

**Every row against 40p.** The same 102 files, with the same ids in the same order. Every field is equal, except:

| Suite | Rows | Change |
|---|---|---|
| `mir` | 6 | `attempts` only (the 6 mir retries) |
| `run-pass-miri` | 9 | `attempts` only (the 9 run-pass-miri retries) |

Every moved row is MATCH in both gates. `mono-ui`'s 3,475 protected rows (and its 1 UNPORTED row) are unchanged, field for field.

**`git diff --stat 03e9e796 0da8b38d -- harness/ scripts/ tools/`:**

| File | Change | Effect on protected suites |
|---|---|---|
| `harness/baseline/ir-hello.txt` | new, 2 ids (the accept) | The protected set grows by `ir-hello`'s 2 cases |
| `harness/llvm-manifest.json` | +1 pin, `llvm/lib/Support/Unix/Signals.inc` (`631110e5`) | None: read only by coverage and llvm-src tooling (N4) |
| `harness/scope.json` | +`"pathdiff": "=0.2.3"` under `vendor` (`2b6ac7f1`) | None: read only by coverage (`--check` accepts `// crate:` markers of that version) (N4) |
| `scripts/mono-run.ts` | `MonoOnly.codegen_crate` = `mono_collection_head(tcx)` + `new CompiledModules([], undefined)`; `AFTER_COLLECTION` removed; header (`24030842`, review `mono-run-head`) | Same statements in the same order as the old head plus caught stop (`docs/reviews/mono-run-head.md`); `mono-ui` rows unchanged. `AFTER_COLLECTION` had no other user (`git grep`) |

## 2. Static steps

From the gate log: `note: subject binary (src/rust_ts/main.ts c8a4e911…, src/miri/bin/miri.ts 0dbaa6a0…)`, then `ok` for typecheck,
unit tests, unit test skips (1, allowlisted), unit tests (alone, 0 skips), runner unit tests (0 skips), markers, marker order, info sites
and frozen lists. `gate.json`: `unitTestSkips {skipped: 1, allowed: 1, unexpected: []}`, `frozenLists.runId`
`gate-20261114-065555-root-0e2v-frozen-lists`.

Junit, 40p → 40q: unit tests 7,892 → **7,949 tests, 1 skipped, 0 failures (7,948 pass)**; unit tests (alone) 39 → **39**; runner unit tests
561 → **561**, 0 failures. That is the pre-gate step's 7,948 + 39 + 561. The +57 are the wave's new tests (pathdiff, archive, link, linker,
symbol_edit and others).

## 3. Bun records

| Check | Result |
|---|---|
| `gate.json` `bun` | `1.4.4`, `38afee6c84fcf48c0edb2466aa4b27d287a59c30`, unchanged from 40p |
| `bunExec.start` / `.end` | both `.data/gate-bun/run-53206-Ikt3A3/bun`, sha1 `7c1f29cd…`, `1.4.4`; `goodAt` 12:57:54.931Z |
| `bunClone` | same path, `from` `~/.bun/bin/bun`, `how: clonefile`, `parent` 53206; `.data/gate-bun/` now empty |
| Builds' `meta.json` | both `bun` 1.4.4, full revision, sha1 `7c1f29cd…`; `builtAt` 06:55:59.610Z / 06:56:04.316Z (by this gate, started 06:55:55Z) |

## 4. Subject binaries and reachability

| Entry | Recomputed at `ab0d5280` | `gate.json` | inputs (40p) | added / removed / changed |
|---|---|---|---|---|
| `src/rust_ts/main.ts` | `c8a4e9113a5c4ebf67ba3c6dd6653a71563429f8` | equal | 2,203 (2,114) | 89 / 0 / 9 |
| `src/miri/bin/miri.ts` | `0dbaa6a050226f447f84f24109b4fb000a2e46bf` | equal | 2,389 (2,301) | 88 / 0 / 9 |

**Protected suites and the forwarded backend** (N6):

| Suites | Subject | Why codegen is not reached |
|---|---|---|
| parse, hir-tree(-nocore), expanded(-nocore), unpretty-\*, mir, mir-minicore, mir-o0, mir-o2, mir-opt-o4, mir-{core,alloc,std}, thir-tree | main.ts | `-Zunpretty=…` (last on the argv, or the test's own): the driver returns after printing |
| parse-ui | main.ts | `-Zparse-crate-root-only` |
| check-ui, check-ui-encode-mir, rmeta-ui, pm-ui, check-{core,alloc,std}, rmeta-{core,alloc,std} | main.ts | `--emit=metadata`, no other `--emit` in any protected test: `codegen_crate` skipped, `link` takes the old body |
| check-rg, check-rg-encode-mir, check-rg-host | main.ts via `rg-rustc.ts` | Port gets `cargo check` units only; link compiles go to the oracle |
| mono-ui | `scripts/mono-run.ts` (source) | `MonoOnly` never forwards: its own `codegen_crate` and `link`; `join_codegen` skipped |
| miri-hello, miri-pass(-heavy), run-pass-miri(-heavy), run-fail-miri, run-pass-aux-miri | miri.ts | `MiriCodegenBackend` → `DummyCodegenBackend`; stand-in used for `init`/`target_config` only |
| lex, escape(-synthetic), symbols, tokens(-str), fluent-\*, emit, resdump\*, tydump-\*, thirdump-\*, mirdump-\*, borrowck-ui(-report) | dump entries (source) | No driver codegen |
| **ir-hello** | main.ts via `ir-run.ts` | **Reaches the port by design** (`--emit=llvm-ir`); 2/2 MATCH at N1 |

## 5. Margins

**Solo retries** (alone wall / user s, 40p → 40q):

| Case | wave 40p | wave 40q | Δ wall |
|---|---|---|---|
| `dynamic-drop.rs` | 38.6 / 47.6 | **39.0 / 47.8** | +0.4 |
| `issue-8827.rs` | 38.1 / 45.6 | 37.6 / 45.1 | −0.5 |
| `error-tainting-issue-122904.rs` | 28.5 / 32.8 | 28.2 / 32.5 | −0.3 |
| `recursive-drop-elaboration-2.rs` | 27.8 / 32.1 | 28.1 / 32.4 | +0.3 |
| `recursive-drop-elaboration.rs` | 28.0 / 32.3 | 28.0 / 32.3 | 0.0 |
| `move-3-unique.rs` | 26.2 / 31.4 | 26.0 / 31.1 | −0.2 |
| `issue-52475.rs` | 20.6 / 21.3 | 20.0 / 20.8 | −0.6 |
| `repeated-vector-syntax.rs` | 20.0 / 26.0 | 19.6 / 25.4 | −0.4 |
| `recursion-etc.rs` | 16.3 / 18.4 | 16.4 / 18.4 | +0.1 |
| `unique-send-2.rs` | 15.8 / 22.2 | 15.9 / 22.3 | +0.1 |
| `infinite_loop.rs` | 14.9 / 15.6 | 15.2 / 15.8 | +0.3 |
| `macro-comma-support-rpass.rs#std` | 14.6 / 23.6 | 15.1 / 23.9 | +0.5 |
| `projection-cache-rematch-impl-141124.rs` | 14.1 / 18.3 | 14.0 / 18.5 | −0.1 |
| `let-else-drop-order.rs` | 13.2 / 20.2 | 13.3 / 20.3 | +0.1 |
| `macro-comma-support-rpass.rs#core` | 12.0 / 20.5 | 12.3 / 20.7 | +0.3 |

No case is above 45 s alone. The largest leaves 21.0 s of the 60 s limit.

**Heavy cases**, one at a time, wall (40p → 40q): miri-heavy all within ±1.2 s (`task-comm-6.rs` 158.5 → 157.5, `issue-94923.rs` 83.4 →
84.6). Compiler-heavy: `check-core` 104.2 → 116.5, `mir-core` 89.5 → 118.3 (N8), `rmeta-core` 90.8 → 92.8, `check-rg-encode-mir` 76.9 →
78.7, `check-rg` 55.7 → 58.3, `check-rg-host` 55.6 → 57.2; alloc/std cases within ±0.6 s. Max RSS at most 6,718 MB (`rmeta-core`) against the
12,288 MB budget. `heavyErrors` is empty in every suite.

## 6. Power and host

| Check | Result |
|---|---|
| `host.powerLost` | `[]` |
| `host.allowBattery` | `false` |
| Samples | 146 (06:55:55Z → 12:57:54Z), **all `AC Power`, `onBattery: false`, 100%**. Every suite's `hostStart`/`hostEnd` read AC |
| Load (1-min), 40p → 40q | median 42.4 → **54.0**, p90 94.0 → **126.0**, max 211.2 → **208.3**; above 100: 9 → **24**; above 200: 1 → **2** (08:14Z in `mir`, 10:13Z in `run-pass-miri`) |
| Load (15-min) | max 122.4 (40p) → **147.1** at 10:13:56Z; **101 at 10:27:47Z (3 h 32 min)**, when `tydump-nocore` started (N1c) |
| Swap | 5.9–7.2 GB (40p 6.0–6.4) |
| Suite time | 21,180 s against 20,891 s (+1.4%); largest relative rises are small suites at higher start load (`check-ui-encode-mir` 6 → 8 s, `borrowck-ui` 135 → 151 s) and N8 |

## 7. Unstable and unprotected

- **Unstable:** `miri-pass` `tests/panic/panic1.rs`, as before; `unstableOk: true` (N10).
- **Unprotected timeouts:** the two `run-pass-miri-heavy` cases of N10, the only TIMEOUT rows.
- **Other unprotected rows** (UNPORTED 308, DIFF 28) are row-for-row identical to 40p's, their `unported` and `first` fields included.

## 8. Suites not run (report-only)

`harness/suites.ts` at `ab0d5280` registers 75 suites. 61 ran: the 60 with a baseline, plus `ir-hello`, by the recorded scope decision.
The other 14 have no baseline at `0da8b38d` and did not run: `check-chain`, `check-core-bin`, `cli`, `host-rlib`, `mir-heavy`, `miri-fail`,
`miri-pass-tb`, `miri-sysroot-alloc`, `miri-sysroot-core`, `miri-sysroot-std`, `parse-ui-json`, `rlib-native`, `stats-ui`, `target-specs`.
That is 40p's list minus `ir-hello`. The new linker, archive and link code is exercised by the unit step and by `ir-hello` (which emits
IR, not a link), not by a protected link.

## What I did not check

- **Protected cases beyond the gate's jsonl.** I re-ran no case. Statuses come from the jsonl, compared row by row with 40p's.
- **The lanes' code.** That covers the fidelity of `link.rs`'s first half, `linker.rs`, `archive.rs`, `symbol_edit.rs`, `rpath.rs`,
  pathdiff, and the forwarding design. Those belong to their reviews. I checked reachability, not correctness.
- **Dynamic reachability for every case.** N6 rests on the suites' argv, the driver's `should_codegen` branch and greps. N7 rests on the
  bundler's output. I traced no case. The startup timings cover one protected case and `-vV`.
- **The `mono-ui` cases' oracle exit codes.** They do not matter: `MonoOnly` never forwards.
- **Coverage numbers and the oracle-key dump.** I did not run `scripts/coverage.ts` (which rewrites `$RUST_TS_DATA/coverage.json`) or
  `scripts/oracle-keys.ts`. The gate's `markers` step passed. No runner or suite definition changed besides `mono-run.ts`, a subject.
- **The cause of N8's swap growth.** I compared timings and samples only.

## Side effects outside my scratchpad

- I copied `.env.local` into this worktree from `.data/integ-w39/.env.local`, and `bun install --frozen-lockfile` linked `node_modules`.
  Both are gitignored.
- I ran the existing `subject-bin` builds `a38b56e9`, `c8a4e911`, `674d0f30` and `0dbaa6a0` for timing (`-vV`; `-Zunpretty` with cwd
  the upstream checkout). They write nothing, and `git status` of the upstream checkout stayed clean.
- I wrote nothing under the main checkout's `.data`. The key recomputation and the bundle analysis ran `Bun.build` in memory over
  `git archive` trees in my scratchpad, which I deleted afterwards.
- This file is the only tracked change.
