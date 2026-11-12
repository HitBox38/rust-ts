PASS WITH NOTES

**Wave 40n's accept stands.** No protected case was lost, removed or tampered with. All 60 protected suites ran. Every one of the
542,304 protected ids in `harness/baseline/*.txt` at `66149ab3` is `MATCH` in this gate's jsonl. The accept commit (`b2aeb1f5`) changed no
baseline, and nothing in `harness/` or `scripts/` changed since wave 40m's tested head `72d95af6`. I compared every row of all 102 jsonl files
with wave 40m's gate, on every field. The ids and their order are the same in every file. **Only 20 rows moved, all in `attempts`/`retried`.**
They are the 12 retries of this gate and the 8 cases wave 40m retried that did not need a retry here. Every one is `MATCH` in both gates. Status
counts did not change: MATCH 542,304, UNPORTED 308, DIFF 28, TIMEOUT 2, UNSTABLE 1. UNPORTED rows carry their stop reason, so **no case's stop
moved either**.

**Both binaries were rebuilt, and they are the tested tree.** I recomputed both keys from a `git archive` of `66149ab3`: `a86e656c…` (main.ts,
2,114 inputs) and `66938fef…` (miri.ts, 2,301). Both equal `gate.json`. **Seven changed files are in both builds, not the three the brief
names.** Besides `session.ts`, `mono.ts` and `codegen_fn_attrs.ts`, the builds hold `rustc_codegen_ssa/{base,lib,back/lto}.ts` and the new
`assert_module_sources.ts` (N1). In those seven files, **every hunk inserts a whole new function or method, or edits comments and imports.
The exceptions are three edits to existing code:**
- the `Visibility` codec (N2);
- `codegen_dep_node` (N3);
- `CrateInfo::new`'s MSVC natvis branch (N1).

None of the three can reach protected output. The six new session methods are called only from `rustc_codegen_llvm`, which neither build has
(N4). The codegen paths in `base.ts` are not even in the binaries: Bun tree-shook them (N5).

**Host:** on AC power the whole run, with lower load than wave 40m. That load difference is the likely reason retries fell from 20 to 12.
No alone time is above 45 s.

Regression audit, 2026-11-12. Gate `gate-20261112-150635-root-u4a3`, tested `66149ab3`, accepted `b2aeb1f5`
(`git log -1 -- docs/state/history.jsonl`), `RUST_TS_SUBJECT=binary`, Bun 1.4.4. The previous accept is wave 40m: gate
`gate-20261112-061907-root-csyz`, tested `72d95af6`, accepted `463d6a25`. I ran no gate, no difftest and no full suite. What I ran:
- a comparison of every row of all 102 jsonl files against wave 40m's, on every field. I checked every id of the 60 baselines at `66149ab3`
  (`git show`) against this gate's jsonl. I also checked `gate.json`, the `history.jsonl` accept entry and the gate log (`.data/tmp/gate-w54.log`);
- `git diff` over `harness/`, `scripts/`, `UPSTREAM.json`, `tools/`, the config files and the runtime C files, from `72d95af6` to `b2aeb1f5`;
- both subject-bin keys, recomputed in a `git archive` tree of `66149ab3` with that tree's `buildSpec`, `subjectBinKey` and `subjectBinKeyOf`.
  The spec was rebased onto the gate's repo path from `meta.spec`, and Bun came from `meta.bun`;
- the diff of each changed build input (`git diff -U0` hunk by hunk), and a `git grep` for callers of every changed or new function they export;
- a 3-file `Bun.build` experiment in my scratchpad, checking how the bundler treats a `require()` inside a function no one uses (N5);
- `gate.json` `retryTimes`, `host.samples` and per-suite times against wave 40m. I also checked the retries, the unstable case and the two
  unprotected heavy timeouts in every gate since 2026-11-04, and the heavy-suite RSS in the gate logs since wave 47 (`gate-w47.log`).

Everything ran on AC power (`pmset -g batt`), with `RUSTUP_AUTO_INSTALL=0`. No gate was running (`.data/tmp/GATE_RUNNING` absent), and the
host was quiet (1-minute load about 1.2). I read code but changed none.

## Notes

| # | severity | note | evidence |
|---|---|---|---|
| N1 | low | **The brief's list of reachable changes is short by four files.** Both builds also have `src/rustc_codegen_ssa/base.ts`, `lib.ts` and `back/lto.ts`, all changed, and the new `assert_module_sources.ts`. Two files the wave did not change also became build inputs: `rustc_codegen_ssa/decodable.gen.ts` (both builds) and `std/time.ts` (main.ts only; miri.ts already had it). In all seven changed inputs, every `-` line is a comment or an import. Every hunk sits between two existing functions or class members, except the three named in the summary. **The one change to an existing function in these four files is in `CrateInfo_new`.** Under `target.is_like_msvc && embed_visualizers`, it now calls the newly ported `collect_debugger_visualizers_transitive(tcx, "Natvis")`. Before, it stopped at `unported(…natvis…)`. A protected case is `MATCH`, so it never reached that stop. And no row in either gate names it: every UNPORTED row carries its reason, and all 308 are unchanged. The new modules' top-level code is constants, classes and functions only (`assert_module_sources.ts`, `std/time.ts`; `lib.ts` adds `RLINK_VERSION`/`RLINK_MAGIC`). Module load order is covered by the unit step's "fresh entry point (init order)" contract test, which passed. Whether `collect_debugger_visualizers_transitive` is ported correctly is a question for lane ssa-base's review, not for this audit. | §4; `git diff -U0 72d95af6 66149ab3`; `meta.json` inputs |
| N2 | info | **`Visibility` tag 3 cannot occur in any rmeta the port reads.** Upstream `mono::Visibility` (mono.rs:385) has three variants: `Default`, `Hidden` and `Protected`. So rustc's derived `TyEncodable` emits only tags 0–2, in every rlib the oracle toolchain built. In the port, `Interposable` was a fourth variant only in the old copy in `codegen_fn_attrs.ts`. `mono.ts`'s own `Visibility` already had three variants and mapped `SymbolVisibility::Interposable` to `Default` (`From`, mono.rs:399). In the port, the only producer of a `codegen_fn_attrs` `Visibility` is `codegen_attrs.ts:287`, which pushes `"Default"`, so the port's encoder never wrote tag 3 either. Both codecs are used only for `CodegenFnAttrs::foreign_item_symbol_aliases` (`codegen_fn_attrs.ts:271`, `:312`). Other `Visibility` codecs (`rustc_ast`, `rustc_middle/decodable.gen.ts`) are different types and did not change. The rmeta suites (`rmeta-core` 82,338, `rmeta-std`, `rmeta-alloc`, `rmeta-ui`, `check-ui-encode-mir`) are all `MATCH`. | upstream `compiler/rustc_middle/src/mono.rs:384-405`; `git grep Interposable 72d95af6` |
| N3 | info | **No caller of `CodegenUnit::codegen_dep_node` is in either build.** Its callers at `66149ab3`: `src/rustc_codegen_llvm/base.ts:86`, with no `rustc_codegen_llvm` file in either build, and a comment at `rustc_codegen_ssa/base.ts:1343`. `MonoItem::codegen_dep_node` (`mono.ts:385`) still stops at `unported`. The `undefined` return carries a `// PORT:` note: the disabled dep graph's `with_task` never reads the node. That is a design decision for the lane review. | `git grep codegen_dep_node 66149ab3` |
| N4 | info | **The six new session methods are reachable only from codegen.** They are `needs_plt`, `direct_access_external_data`, `branch_protection` and `must_emit_unwind_tables` on `Session`, and `calculate_pauth_abi_version` and `fn_attrs` on the new companion const `PointerAuthConfig`. Every call site is in `src/rustc_codegen_llvm/{attributes,base,context,intrinsic,mono_item}.ts`, which neither build includes: 11 sites, 0 in build inputs. All six are pure additions. No existing `Session` method changed, and `session.ts`'s only other change is a `type` import. | `git grep` of the six names, intersected with `meta.json` inputs |
| N5 | info | **The codegen code that `base.ts` adds is tree-shaken out of both binaries.** `base.ts` loads `./mir/mod.ts`, `./mir/operand.ts` and `./meth.ts` through `lazy_*` `require()`s with literal paths. None of the three is a build input. To show why, I bundled three files in my scratchpad. With an entry that imports only `used()`, the `require("./b.ts")` inside the unused `unused()` drops out of the metafile: inputs `[e.ts, a.ts]`. With an entry that calls `unused()`, `b.ts` is an input. So the bundler found no live path from `main.ts` or `miri.ts` to `codegen_crate`, `codegen_instance` or the other functions that call `lazy_mir*`/`lazy_meth`. The functions that are live, `CrateInfo_new`, `provide` and the allocator helpers, did not change, apart from N1. **Caveat:** tree-shaking is static and proves only that nothing is reachable through an import. That is enough here, because the gate ran in binary mode. Once `codegen_crate` goes live, those modules will join the build. | scratchpad experiment; `meta.json` inputs |
| N6 | low | **Retries fell from 20 to 12, all of them cases wave 40m also retried. Alone times are flat to lower, and none is above 45 s.** The 12 are mir: `issue-52475.rs`, `error-tainting-issue-122904.rs` and both `recursive-drop-elaboration*.rs`; and run-pass-miri: `repeated-vector-syntax.rs`, `unique-send-2.rs`, `dynamic-drop.rs`, `recursion-etc.rs`, `let-else-drop-order.rs`, `macro-comma-support-rpass.rs#std`, `move-3-unique.rs` and `issue-8827.rs`. Eight cases wave 40m retried passed in the pool this time: `infinite_loop.rs`, `projection-cache-rematch-impl-141124.rs`, `macro-comma-support-rpass.rs#core`, `stringify.rs`, and the four run-fail-miri panic cases. **`dynamic-drop.rs` took 38.6 s alone** (40m 39.7). That is the lowest of the 8 binary-mode gates (38.6–39.9), and it leaves 21.4 s of the 60 s limit, 6.4 s under the 45 s line. **`issue-8827.rs` took 38.4 s** (40m 39.3), tying its binary-mode low (38.4–39.3). Pool load at the 12 timeouts was 62.8–219.8 (40m: 100.4–288.9). Fewer retries go with lower host load (§6), on a binary that differs from 40m's only in code these cases cannot reach (§4). | `gate.json` `retryTimes` in every gate since 2026-11-04; `mir.jsonl`, `run-pass-miri.jsonl` |
| N7 | info | **Heavy-suite peak RSS rose against wave 40m, but stays within the range of earlier gates.** Max RSS (40m → 40n): `check-rg-encode-mir` 2,860 → 3,333 MB, `rmeta-core` 6,102 → 6,548, `check-rg-host` 2,579 → 2,947, `check-core` 5,741 → 5,993, `check-rg` 2,477 → 2,691, `mir-core` 6,440 → 6,472. Wave 40m was the lowest of the 7 binary-mode gates since wave 47. Over those gates the ranges are: `check-rg-encode-mir` 2,860–3,904, `rmeta-core` 6,102–7,261, `check-rg-host` 2,579–4,274, `check-core` 5,741–6,860. Every case is far under the 12,288 MB budget; the largest is `rmeta-core` at 6,548. Wall times dropped, `check-core` most (135.8 → 92.8 s). | `heavy` lines of `gate-w47.log` … `gate-w54.log` |
| N8 | info | **The unstable case is not new and was never protected. The two heavy timeouts are the usual ones.** The case is `miri-pass` `tests/panic/panic1.rs`. It is `UNSTABLE` in every gate since 2026-11-04. On 11-04 and 11-05 `tests/panic/mir-validation.rs` was unstable with it. `git log -S'tests/panic/panic1.rs' -- harness/baseline` finds no commit, and no baseline file holds it. In `run-pass-miri-heavy`, `hashset-connected-border-12860.rs` (1,848.4 s user, 2,029 MB) and `step_overflowing.rs` (1,849.7 s user, 1,704 MB) both hit the 1,800 s limit, exit 143. Both are `TIMEOUT` in all 16 gates since the suite began, are never `MATCH`, and are not among its 6 protected ids. Their user times are within 3 s of 40m's (1,845.9 and 1,846.8). | `miri-pass.jsonl`, `run-pass-miri-heavy.jsonl` in each gate since `gate-20261104-143144` |
| N9 | info | **The kept host samples are up to 659 s apart, as the sampler is built to keep them.** The gate polls power every 60 s. It keeps a poll only if the source changed or 600 s have passed, and it always keeps suite edges (`REAL_GATE_HOST`, `scripts/gate.ts:152`). So `powerLost: []` covers all 60 s polls, not just the 143 kept samples. As `host-state.ts` documents, a battery spell shorter than one poll would not show. | `scripts/gate.ts:152`, `scripts/lib/host-state.ts:239` |
| N10 | info | **Disk: 5.7 GiB free (99% used).** `subject-bin/` holds four builds: wave 40l's two (2026-11-11 22:38Z) and this gate's two (2026-11-12 15:06Z). Pruning is by age (`PRUNE_AFTER_MS`, 3 days). `.data/gate-bun/` is empty. | `ls`, `df` |

## 1. Protected set: nothing lost

| Check | Result |
|---|---|
| Baselines `72d95af6` = `66149ab3` = `b2aeb1f5` | `git diff --shortstat 72d95af6 b2aeb1f5 -- harness/baseline`: empty. 60 files |
| Protected ids (`66149ab3`) against this gate's jsonl | **542,304, every one `MATCH`**, no duplicate ids. Each suite's `gate.json` `baseline` equals its baseline's line count |
| `gate.json` | `pass: true`, `staticOk`, `skipStatic: false`, `head` `66149ab3`, `dirty: []`, `unstableOk`, `upstreamOk`, `staticNotes: []`. 60 suites, the same 60 as 40m. Summed over suites: `lost` 0, `gained` 0, `lostSkipped` 0, `oracleTimeouts` 0, `upstreamChanges` 0, batch-only failures and timeouts 0. Baseline 542,304, match 542,304, total 542,643, all equal to 40m |
| Gate log | 60 `ok … lost=0 gained=0` lines, then `gate PASS run=gate-20261112-150635-root-u4a3`. No `ERROR`, no power note |
| `history.jsonl` accept entry (20:50:44Z) | `runId` `gate-20261112-150635-root-u4a3`, `head` `66149ab3`, 60 suites. Each `protected` equals its baseline's line count at `b2aeb1f5` (0 mismatches, sum 542,304) |
| `b2aeb1f5` | parent `66149ab3`. Changes only `README.md`, `docs/next.md`, `docs/state/current.json` and `docs/state/history.jsonl` (+1 line). **0 gained, no baseline file touched** |
| Unstable | `miri-pass` `tests/panic/panic1.rs`, as before (N8) |

**Every row, this gate against wave 40m's.** The same 102 files, with the same ids in the same order. Every field is equal, except:

| Suite | Rows | Change |
|---|---|---|
| `mir` | 6 | 4 with `attempts` changed only (the 4 mir retries, both gates); `infinite_loop.rs` and `projection-cache-rematch-impl-141124.rs` lost `retried`/`attempts` (no retry here) |
| `run-pass-miri` | 10 | 8 with `attempts` changed only (retried in both gates); `macro-comma-support-rpass.rs#core` and `stringify.rs` lost `retried`/`attempts` |
| `run-fail-miri` | 4 | `panic-in-cleanup.rs`, `panic-in-ffi.rs`, `panic-main.rs#abort-full`, `#unwind-full` lost `retried`/`attempts`: no retry in this gate |

Every moved row is `MATCH` in both gates.

**`harness/` and `scripts/`, `72d95af6..b2aeb1f5`:** `git diff --stat` prints nothing. **No change** in `harness/baseline`, `harness/suites.ts`,
`harness/corpus/`, oracle outputs, any runner script, `tools/`, `UPSTREAM.json`, `tsconfig.json`, `package.json`, `bunfig.toml`, `bun.lock`,
`src/std/thread.c` or `src/rust_ts/proc_macro_host.c`. With no runner or suite change, the oracle keys and the runner's behavior cannot have moved.

## 2. Static steps

From the gate log `.data/tmp/gate-w54.log`: `note: subject binary (src/rust_ts/main.ts a86e656c…, src/miri/bin/miri.ts 66938fef…)`, then
`ok` for typecheck, unit tests, unit test skips (1, allowlisted, 0 not allowed under `RUST_TS_REQUIRE_PROBES=1`), unit tests (alone, 0 skips),
runner unit tests (0 skips), markers, marker order, info sites and frozen lists. `gate.json`: `staticOk: true`, `skipStatic: false`,
`unitTestSkips` `{skipped: 1, allowed: 1, unexpected: []}`, `frozenLists.runId` `gate-20261112-150635-root-u4a3-frozen-lists`.

## 3. Bun records

| Check | Result |
|---|---|
| `gate.json` `bun` | `1.4.4`, `38afee6c84fcf48c0edb2466aa4b27d287a59c30`, unchanged |
| `bunExec.start` / `.end` | both at `.data/gate-bun/run-58438-Fhw1T6/bun`, sha1 `7c1f29cd…`, `1.4.4`, `38afee6c8`; `goodAt` 20:50:20.937Z |
| `bunClone` | same path, `from` `~/.bun/bin/bun`, `how: clonefile`, `parent` 58438 |
| Clone removed | `.data/gate-bun/` is empty |
| Builds' `meta.json` | both: `bun` 1.4.4, full revision, sha1 `7c1f29cd…`; `builtAt` 2026-11-12T15:06:39.594Z / 15:06:44.080Z (built by this gate) |

## 4. Subject binaries and the reachable changes

| Entry | Recomputed at `66149ab3` | `gate.json` | inputs (40m) | `inputs` / `config` / `runtimeC` / spec vs `meta.json` |
|---|---|---|---|---|
| `src/rust_ts/main.ts` | `a86e656ca3a9cd5952aa74245293304adfd34e83` | equal | 2,114 (2,111) | all identical |
| `src/miri/bin/miri.ts` | `66938fefc70c766d5fc78ef3cb456a7c208166d1` | equal | 2,301 (2,299) | all identical |

The key (`subjectBinKeyOf`, v4) hashes the spec (with the Bun path replaced by a placeholder), the Bun (version, revision, sha1), the builder
source (`subject-bin.ts`, unchanged), every bundled input's path and sha1, `CONFIG_FILES` and `RUNTIME_C_FILES` (both identical to 40m's
builds). The rebased spec equals `meta.spec`.

**Inputs against wave 40m's builds** (same in both builds, except `std/time.ts`):

| Kind | Files |
|---|---|
| Changed by the wave | `src/rustc_session/session.ts`, `src/rustc_middle/mono.ts`, `src/rustc_middle/middle/codegen_fn_attrs.ts`, `src/rustc_codegen_ssa/base.ts`, `src/rustc_codegen_ssa/lib.ts`, `src/rustc_codegen_ssa/back/lto.ts` |
| Added by the wave and newly an input | `src/rustc_codegen_ssa/assert_module_sources.ts` |
| Unchanged, newly an input | `src/rustc_codegen_ssa/decodable.gen.ts` (both; `lib.ts`'s rlink codecs); `src/std/time.ts` (main.ts only; `base.ts`'s `Instant`/`Duration`) |
| Removed | none |

Of the 76 files changed in `72d95af6..66149ab3`, the other 69 are in neither build. They are under `src/rustc_codegen_llvm/`,
`src/rust_ts/llvm/`, `src/rustc_codegen_ssa/{mir/*,meth,mono_item,size_of_val}.ts`, tests and their fixtures, and `docs/`.

**Each changed input, and why it cannot change protected output:**

| File | What changed | Why protected output cannot move |
|---|---|---|
| `rustc_session/session.ts` | +6 methods (`PointerAuthConfig.{calculate_pauth_abi_version,fn_attrs}`, `Session.{needs_plt,direct_access_external_data,branch_protection,must_emit_unwind_tables}`), header comment, `type` import | Pure additions; callers only in `rustc_codegen_llvm` (N4) |
| `rustc_middle/mono.ts` | `CodegenUnit::codegen_dep_node` returns `undefined` instead of `unported` | Only caller is `rustc_codegen_llvm/base.ts:86`, outside both builds (N3) |
| `rustc_middle/middle/codegen_fn_attrs.ts` | Duplicate `Visibility` type removed, re-exported from `mono.ts`; codec tag 3 (`Interposable`) dropped | Tag 3 is never written by rustc or by the port (N2) |
| `rustc_codegen_ssa/base.ts` | +~1,090 lines of new functions; natvis branch of `CrateInfo_new` now ported | New functions are tree-shaken out or unreachable (N5); the natvis branch was an `unported` stop no case reaches (N1) |
| `rustc_codegen_ssa/lib.ts` | `ModuleCodegen::{new_regular,new_allocator,into_compiled_module}`, `CompiledModule.for_each_output`, `CompiledModules::{serialize_rlink,deserialize_rlink}`, `CodegenError`, rlink constants, stubs | New members only; no existing member's body changed; rlink is `-Zno-link`/`-Zlink-only`, which no suite passes |
| `rustc_codegen_ssa/back/lto.ts` | `ThinModule::{name,cost,data}`, `SerializedModule.{from_file,data}`, `check_lto_allowed` | New members only; `crate_type_allows_lto` and `exported_symbols_for_lto` (which `CrateInfo::new` calls) unchanged |
| `rustc_codegen_ssa/assert_module_sources.ts` | New file | Imported by `base.ts`; top level is constants and classes; `assert_module_sources` is called from `codegen_crate` only |

All of this matches the jsonl: no row's status or stop reason moved (§1).

## 5. Margins

**Solo retries** (alone wall / user s; pool load at the timeout, 40m → 40n):

| Case | wave 40m | wave 40n | Δ wall | pool load |
|---|---|---|---|---|
| `dynamic-drop.rs` | 39.7 / 48.8 | **38.6 / 47.6** | −1.1 | 288 → 112 |
| `issue-8827.rs` | 39.3 / 46.8 | **38.4 / 46.0** | −0.9 | 173 → 208 |
| `recursive-drop-elaboration-2.rs` | 29.2 / 33.0 | 28.0 / 32.4 | −1.2 | 211 → 107 |
| `recursive-drop-elaboration.rs` | 28.9 / 32.9 | 28.2 / 32.4 | −0.7 | 211 → 107 |
| `error-tainting-issue-122904.rs` | 28.8 / 32.9 | 28.3 / 32.6 | −0.5 | 206 → 100 |
| `move-3-unique.rs` | 26.4 / 31.6 | 26.4 / 31.4 | 0.0 | 284 → 220 |
| `issue-52475.rs` | 20.4 / 21.2 | 20.3 / 21.0 | −0.1 | 162 → 127 |
| `repeated-vector-syntax.rs` | 20.9 / 26.8 | 20.1 / 26.0 | −0.8 | 122 → 63 |
| `recursion-etc.rs` | 16.9 / 19.0 | 16.8 / 18.8 | −0.1 | 289 → 111 |
| `unique-send-2.rs` | 16.8 / 23.2 | 15.9 / 22.2 | −0.9 | 176 → 74 |
| `macro-comma-support-rpass.rs#std` | 15.3 / 24.5 | 14.6 / 23.5 | −0.7 | 273 → 175 |
| `let-else-drop-order.rs` | 13.9 / 21.0 | 13.2 / 20.2 | −0.7 | 265 → 139 |
| `infinite_loop.rs` (mir) | 15.4 / 16.1 | not retried | — | 162 → — |
| `projection-cache-rematch-impl-141124.rs` (mir) | 14.7 / 18.7 | not retried | — | 219 → — |
| `macro-comma-support-rpass.rs#core` | 12.8 / 21.1 | not retried | — | 273 → — |
| `stringify.rs` | 11.4 / 24.3 | not retried | — | 276 → — |
| `panic-in-ffi.rs` (run-fail-miri) | 11.2 / 18.5 | not retried | — | 115 → — |
| `panic-in-cleanup.rs` (run-fail-miri) | 8.9 / 14.5 | not retried | — | 115 → — |
| `panic-main.rs#abort-full` (run-fail-miri) | 8.5 / 14.2 | not retried | — | 117 → — |
| `panic-main.rs#unwind-full` (run-fail-miri) | 8.3 / 14.0 | not retried | — | 116 → — |

Every repeated case is the same as 40m or up to 1.2 s faster alone. No case is above 45 s alone. The largest, `dynamic-drop.rs` at 38.6 s,
leaves 21.4 s of the 60 s limit. Its binary-mode range since 2026-11-10 is 38.6–39.9 s, and `issue-8827.rs`'s is 38.4–39.3 s. Both are at
the low end. Every retry started its alone run on a host that was still busy: load 104 at the first mir retry, 219 at the first
run-pass-miri one.

**Heavy suites**, one case at a time: every miri-heavy case is within ±1.7 s of 40m (`dynamic-drop-async.rs` 78.0 → 77.3,
`task-comm-6.rs` 159.1 → 157.4, `issue-94923.rs` 84.6 → 85.6). These cases are over 45 s, but they run in the heavy suites, under their
1,800 s limit and outside the 45 s rule. Compiler-heavy wall times fell, `check-core` 135.8 → 92.8 s; RSS is in N7.

## 6. Power and host

| Check | Result |
|---|---|
| `host.powerLost` | `[]` |
| `host.allowBattery` / `gate.json` `allowBattery` | `false` / not set |
| Samples | 143 kept (15:06:35Z → 20:50:21Z), **all `AC Power`, `onBattery: false`, 100%**. Every suite's `hostStart` and `hostEnd` read AC |
| Load (1-min), 40m → 40n | median 70.9 → **55.1**, p90 184.6 → **96.8**, max 275.3 → **202.5**; samples above 100: 53 → **13**; above 200: 9 → **1** (18:13:35Z, during `run-pass-miri`) |
| Suite start load, 40m → 40n | mir 137 → 71, miri-pass 78 → 69, run-fail-miri 169 → 90, run-pass-miri 136 → 87, tydump-nocore 136 → 81, run-pass-miri-heavy 16 → 3 |
| Swap | 6.0–7.3 GB (40m: 5.6–7.3) |
| Suite time | 20,093 s against 25,008 s. Without `tydump-nocore` (40m's battery spell): 18,036 s against 19,966 s (−9.7%). `tydump-nocore` 5,042 → 2,057 s, back to its pre-spell level (40l: 2,289 s) |
| Polling | power every 60 s; kept on change or every 600 s, plus suite edges (N9) |

## 7. Unstable and unprotected

- **Unstable:** `miri-pass` `tests/panic/panic1.rs`, the only `UNSTABLE` row in the gate. It is unstable in every gate since
  2026-11-04, and no baseline has ever held it (N8). `gate.json` `unstableOk: true`.
- **Unprotected timeouts:** `run-pass-miri-heavy` `hashset-connected-border-12860.rs` and `step_overflowing.rs`, both `TIMEOUT` at 1,800 s
  and both `TIMEOUT` in every gate since the suite began (N8). These are the gate's only 2 `TIMEOUT` rows.
- **Other unprotected statuses** (UNPORTED 308, DIFF 28) are row-for-row identical to 40m's, stop reasons included.

## 8. Suites not run (report-only)

`harness/suites.ts` at `66149ab3` registers 75 suites. 60 have a baseline, and the gate ran exactly those 60. The other 15 have no file in
`harness/baseline/` and **did not run**: `check-chain`, `check-core-bin`, `cli`, `host-rlib`, `ir-hello`, `mir-heavy`, `miri-fail`,
`miri-pass-tb`, `miri-sysroot-alloc`, `miri-sysroot-core`, `miri-sysroot-std`, `parse-ui-json`, `rlib-native`, `stats-ui`, `target-specs`.
None protects anything, so nothing about them can be a loss. M7a's `ir-hello` criterion is still "not in this gate".

## What I did not check

- **Protected cases beyond the gate's jsonl.** I re-ran no case. Statuses come from the jsonl, compared row by row with 40m's.
- **The oracle-key dump.** I did not dump keys with `scripts/oracle-keys.ts`, which would touch the shared `aux/` cache. No runner, suite or
  harness file changed, so the keys cannot have moved.
- **The lanes' code.** That means the fidelity of `collect_debugger_visualizers_transitive`, the session methods, the rlink codecs and
  `codegen_dep_node`'s `undefined`, and the six lanes' queued nits. Those belong to their reviews. I checked reachability, not correctness. I
  did not check each merged file's blob against its lane head.
- **Dynamic reachability.** N5 and §4 rely on static import graphs, tree-shaking and `git grep`. I ran no case with a tracer. Because the gate
  runs in binary mode, the builds' input lists cover all of `main.ts`'s and `miri.ts`'s code.
- **Coverage numbers.** I did not run `scripts/coverage.ts`, which rewrites `$RUST_TS_DATA/coverage.json`. The gate's `markers` step passed.
- **Typecheck and the unit steps** were not re-run. I relied on the gate log.

## Side effects outside my scratchpad

- I copied `.env.local` into this worktree from `.data/integ-w39/.env.local`, and `bun install --frozen-lockfile` linked `node_modules`.
  Both are gitignored.
- I wrote nothing under the main checkout's `.data`: no run dir, no subject build, no oracle cache entry, no coverage file. The key
  recomputation ran `Bun.build` in memory, with no output, over a `git archive` tree in my scratchpad. I deleted that tree afterwards, along
  with the 3-file bundler experiment.
- This file is the only tracked change.
