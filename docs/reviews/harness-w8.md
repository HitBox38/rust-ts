ACCEPT-WITH-FIXES

# Review: harness-w8 (`lane/harness-w8` at 583adc1)

Reviewer: review-hw8 (independent, read-only on the lane).
- **Scope:** `git diff main...lane/harness-w8` (merge base 6b099d0): `harness/suites.ts`, `scripts/difftest.ts`,
  `src/rust_ts/resdump.ts`, `tools/probes/resdump/{Cargo.toml.in,main.rs}`, `docs/handoff/harness-w8.md`.
- **Merge and build:**
  - `git merge-tree --write-tree main lane/harness-w8` is clean.
  - `bunx tsc --noEmit -p .` on the lane prints nothing.
  - `git diff main...lane/harness-w8 -- harness/baseline docs/state` is empty.

**Summary.** The suites are faithful to plan-m2 D1/D7, and the oracle facts in the handoff check out. The probe dumps
every field of `ResolverGlobalCtxt` and `ResolverAstLowering`, and it is deterministic. The cache change is
compatible and leaves every existing key unchanged.
- Two MEDIUM findings: the 3 slow-file skips are only proposed, not done (M1), and the probe sorts deterministic
  IndexMaps (M2). Neither blocks merging, because the new suites start unprotected. M1 should land before anyone runs
  the full suites routinely. M2 needs a decision before the suites are protected.
- **Gate recommendation:** do not protect these suites yet (§5).

## 1. Suite faithfulness
- **argv.** I printed every case of the three suites from the lane (scratch `argv2.ts`).
  - The oracle runs `rustc +nightly <args>` (the probe for resdump) and the subject runs `bun src/rust_ts/{main,resdump}.ts <args>`.
  - The trailing argv is identical on both sides in all 3 × 21,526 cases (0 mismatches).
  - `<args>` is `--target x86_64-unknown-linux-gnu --sysroot <oracle sysroot> --edition=<directive>
    -Zcrate-attr=feature(no_core) -Zcrate-attr=no_core [-Zunpretty=ast-tree,expanded | -Zunpretty=expanded] <file>`.
    resdump has no `-Zunpretty`, which is right: the pretty path never calls `after_expansion` (`rustc_driver_impl/src/lib.rs:281-292` vs `:303-309`).
  - Editions: 2015 19,765; 2018 705; 2021 734; 2024 316; `future` 6. This is the same `edition()` as `parse`.
  - The feature gate comes before `no_core`, as required.
  - `x86_64-unknown-linux-gnu` rust-std is installed in the oracle sysroot (`lib/rustlib/x86_64-unknown-linux-gnu`), so `extern crate std` really loads linux metadata.
- **Oracle facts, re-derived from the cache** (scratch `cachegrep.ts`, which recomputes `cachePath`). These match the handoff exactly:
  - expanded-nocore: exit 0 5,712; exit 1 15,796; exit 101 15; 3 not cached (the ORACLE_TIMEOUTs).
  - resdump-nocore: exit 0 5,868; exit 1 15,652; exit 101 6.
  - No `/Users/`, `.rustup` or `rustc-ice` text appears in any cached output.
  - The upstream checkout has no stray files (`git status` is clean, no `rustc-ice*`).
- **Sysroot dependence** (re-checked on a sample): 40 of the handoff's 669 "sysroot-dependent" files, and 56 unlisted files that
  mention `extern crate` or `cfg`. Each ran with the real sysroot and with an empty one: 40/40 listed outputs changed, 56/56 unlisted did not.
- **The 341 MATCHes are the same set in all three suites.** I re-ran the oracle on all 341:
  - Every one exits 1 with empty stdout.
  - Each fails at parse, or (6 cases) at `--edition=future`, before `cmdline_attrs::inject`.
  - Top first errors: unclosed delimiter (32), mismatched closing delimiter (30), "expected one of" (19+), diff markers (12).
  - **Spot-check of 20** (every 17th): all parse-fatal. Examples: `parser/raw/raw-str-delim.rs`, `parser/diff-markers/tuple-struct.rs`,
    `lexer/lex-bad-str-literal-as-char-4.rs`, `parser/issues/issue-68629.rs` (`\u{1c}`), `pub/pub-ident-struct-2.rs`,
    `allow-partial-mitigations/err-allow-partial-mitigations-2-errors.rs` (edition future).
  - **All 341 are already in `harness/baseline/parse.txt`.** They are legitimate matches: the same rustc behaviour, byte-identical, both sides really ran.
    Beyond `parse`, they only add the handling of `--target`, `--sysroot` and `-Zcrate-attr` before the parse failure.
    Their protective value is close to zero (see §5).

## 2. `resdump` probe
- **Built in scratch** (`cargo +nightly build --release`, same env as `probes.ts`): the binary is byte-identical (`cmp`) to
  `$RUST_TS_DATA/target/probes/release/resdump`.
- **Determinism:** I picked 30 files, 3 each from resolve, imports, macros, hygiene, delegation, rustdoc, privacy, lint/unused,
  traits and proc-macro aux. I ran the probe twice with the suite's argv and env.
  - All 30 were identical (stdout, stderr and exit code).
  - 27 had a dump (26 sections each, 320 KB in total); 3 were fatal before the callback.
- **Completeness** against `rustc_middle/src/middle/resolve.rs:164-245`:
  - All 20 `ResolverGlobalCtxt` fields are printed.
  - From `ResolverAstLowering`: `partial_res_map`, `next_node_id`, `owners` (all 8 fields of `PerOwnerResolverData`, with `id` as the key),
    `lint_buffer` and `disambiguators` (keys only).
  - The definitions table: `def_kind` is fed for every def (`ty/context.rs:1347`; crate root `rustc_resolve/src/lib.rs:1835`), so the dump never triggers HIR lowering.
- **Callback placement:** `after_expansion` runs right after `tcx.resolver_for_lowering()` and before `write_dep_info` and
  `early_lint_checks`, as upstream does (`lib.rs:303-311`).
  - `config` matches `TimePassesCallbacks::config` minus time-passes (`lib.rs:161-167`).
  - `main` keeps rustc's order: `early_dcx`, ICE hook, `catch_with_exit_code(compiler_entrypoint(raw_args))`.
  - It skips `init_rustc_env_logger`, `signal_handler::install` and `install_ctrlc_handler`. That is only visible with `RUSTC_LOG` set or on SIGSEGV (see L1); no oracle case exits with a signal.
- **Sort keys and totality:**
  - Every Unord or `define_id_collections` map (`expn_that_defined`, `extern_crate_map`, `module_children`,
    `ambig_module_children`, `paths_matching_assoc_types`, `all_macro_rules`, `partial_res_map`, `owners` and its 6 maps,
    `disambiguators`) is sorted by its unique key.
  - The one non-unique key is the `Span` key (lo, hi, `{:?}`). A tie there only happens when the printed lines are identical, so order cannot show.
  - Nothing is deduplicated: `sort_by_key` is stable, and section counts are the collection lengths.
  - No collection is printed in hash order.
- **Subject protocol:**
  - `src/rust_ts/resdump.ts` mirrors the probe's `main`: `EarlyDiagCtxt`, `catch_with_exit_code`, `compiler_entrypoint`, `raw_args`, with argv[0] = script path.
  - Its exit codes and the `shim`/`stub` modes match `main.ts`.
  - `unported(...)` sits in `after_expansion`, with a `// PORT:` note that the ported `Callbacks` lacks the hook.
  - The port currently stops earlier, at `cmdline_attrs::inject`.

### M2 (MEDIUM): deterministic `FxIndexMap`/`FxIndexSet` collections are sorted, which hides insertion-order divergences
- **Where:** `tools/probes/resdump/main.rs`:
  - 167 effective_visibilities, 171-180 macro_reachable_adts (and its inner set), 189 maybe_unused_trait_imports,
    213-222 glob_map (and inner), 230 trait_impls, 240 confused_type_with_std_module, 244-251 doc_link_resolutions
    (and inner `DocLinkResMap`, which is an `FxIndexMap`, `resolve.rs:327`), 256 doc_link_traits_in_scope, 266 delegation_infos,
    270-277 delegation_inherent_fn_map (and inner), 315 lint_buffer keys.
  - All 11 are `FxIndexMap`/`FxIndexSet` (`EffectiveVisibilities.map` too, `privacy.rs:104`; `LintBuffer.map`, `decorate_diag.rs:56`).
- **Scenario:** iterating these maps is deterministic, and the order is observable downstream:
  - `maybe_unused_trait_imports` and `trait_impls` order drives later lint and coherence diagnostic order;
  - `StableHash` of an IndexMap is order-sensitive.
  A port that inserts in a different order (for example, a different import-resolution order) matches `resdump-nocore` and only diverges in a later suite, far from the cause.
- **Why decide now:** once the suites are protected, switching the probe to the stricter format rebuilds the oracle (new probe hash) and can lose protected cases.
- **Fix:**
  - Either print these 11 collections, and their inner Index collections, in iteration order. Keep sorting only Unord and id-collection maps.
  - Or, if root prefers sorting (for example, to postpone emulating insertion orders that upstream derives from hashbrown iteration), record that as a decision.
  Either way, the header and the handoff should say which collections are sorted.

## 3. Env
- **`RUSTC_ICE=0`:** `ice_path` returns `None` when the variable is `"0"` (`lib.rs:1422-1426`). The only effects:
  - no `rustc-ice-<ts>-<pid>.txt` is written into the upstream checkout;
  - no "please attach the file at …" note.
  Both are nondeterministic, so this is correct and masks nothing comparable.
- **`RUST_BACKTRACE=0`:** the effects:
  - Unset, nightly rustc sets `BacktraceStyle::Full` for panic ICEs (`lib.rs:1466-1472`). `=0` suppresses those frames, which vary, and prints the fixed "run with RUST_BACKTRACE=1" note.
  - The query-stack limit is 2 frames either way (`lib.rs:1611`), because `is_some_and(x != "0")` is false both when unset and when `0`.
  - Delayed-bug ICEs (all 15 oracle ICEs) print no panic backtrace in either case.
  Correct, and nothing deterministic is masked.
- **Host dependence:** 16 expanded-nocore and 6 resdump outputs contain the ICE note `running on aarch64-apple-darwin`.
  These outputs depend on the host, despite plan-m2 decision 1 ("host-independent"). The subject must print `RUST_TS_HOST_TUPLE` there. INFO.
- **`--sysroot <oracle sysroot>` on both sides** follows D1 and is necessary: the subject cannot locate the oracle sysroot, and 669 cases depend on it.
  The absolute path makes the cache key per machine; baselines stay id-only. Agreed.

### L1 (LOW, pre-existing, all suites): the rest of the environment is inherited unscrubbed
- **Where:** `scripts/lib/common.ts:65-77` (`run` merges `opts.env` over `process.env`).
- Front-end crates at the pin read these variables:
  - `RUSTC_LOG`: the probe never initialises the logger, so the probe and real rustc diverge when it is set;
  - `RUSTC_BOOTSTRAP`: nightly detection;
  - `RUSTC_FORCE_RUSTC_VERSION`: `StableCrateId`, and so every `DefId`/`DefPathHash` line in resdump;
  - `RUST_MIN_STACK`, `CARGO_CRATE_NAME`, `TERM`/`COLORTERM`, and anstream's `CLICOLOR_FORCE`/`NO_COLOR`.
- **Fix (separate reviewed harness batch, since it changes the existing suites' cache keys):** set these to `null` (unset) for every rustc and probe suite.

## 4. Cache
- **Readers:** `readCached` (`difftest.ts:123-134`) picks the format by the gzip magic, whatever the size. Old raw entries (≤ 64 KiB) and gzipped entries stay readable.
- **Atomicity:** writes are still tmp + `renameSync` (`:138-143`), unchanged.
- **Keys:**
  - `cachePath` (`:145-151`) is untouched, and `GZIP_OVER` is not part of the key.
  - Case lists, hashed on main and on the lane with the same `sha256(JSON.stringify(cases()))[:16]`, are identical for all 12 existing suites
    (lex a8a356bd10b8a7b6, parse b244fb01ad2573be, …, parse-ui-json 38cb955080adddcc), and so are the `skipped()` hashes.
  - Oracle/subject argv is identical except for the worktree path in the subject's `bun <repo>/src/...`, which is not in the key.
  - The existing suites have no `env`, so their keys are unchanged.
- **Measured growth:** I recomputed every key of the three suites and stat'ed the entries:

| suite | cached | apparent | on disk | gzipped | raw > 4 KiB |
|---|---|---|---|---|---|
| expanded-nocore | 21,523 | 90.0 MB | 133.3 MB | 19,529 | 70 |
| unpretty-expanded-nocore | 21,526 | 25.4 MB | 88.4 MB | 1,450 | 4 |
| resdump-nocore | 21,526 | 47.2 MB | 93.8 MB | 15,315 | 72 |

  - Total: 315.5 MB on disk, which matches the handoff. The whole cache is 2.8 GB, and 5.9 GB is free.
  - The raw entries over 4 KiB were written by the first run, before b8a7501. Only 6 were written after it (see L2).

### L2 (LOW): the threshold compares UTF-16 length, not bytes
- **Where:** `difftest.ts:141` (`json.length > GZIP_OVER`).
- 6 entries written after the change are stored raw at 4.1-4.4 KiB, because multi-byte characters make the byte length exceed the UTF-16 length.
- Harmless.
- **Fix:** use `Buffer.byteLength(json)`, or say "4 Ki UTF-16 units" in the comment.

## 5. Gate cost and recommendation
- **Measured:**
  - My `--sample 100` spot-runs took 16 s each (100 subject processes, oracle cached), roughly 0.15 s of wall time per case. The handoff's full runs took 17-52 min per suite at load 55-70.
  - Every subject case today is bun startup plus `cmdline_attrs::inject` → UNPORTED.
- **Value today:** all 341 protectable cases are parse-fatal files already protected by `parse`.
- **Recommendation: do not protect any of the three now.** Adding them costs roughly 1-1.5 h per gate run for almost no new protection.
- **Protect `expanded-nocore` + `resdump-nocore`** (the plan's M2a pair) at the first integration where driver-m2/wave 10
  gets past `inject`, so that MATCHes exist beyond the parse-fatal set. Before that:
  - M1 landed;
  - M2 decided;
  - `unpretty-expanded-nocore` left unprotected until it adds signal that `expanded-nocore` lacks (the pretty-printer), or until M2a.
- If the gate cost then hurts, the lever is the subject's per-case startup (a batch driver as in `parse`), not a smaller corpus.

## 6. Skips
### M1 (MEDIUM): the 3 slow-file skips are proposed but not implemented or recorded
- **Where:** `harness/suites.ts:318-328`. `nocoreSuite` has no `skipped()` and does not filter its cases, and there is no decision in `docs/state/history.jsonl`.
- **Scenario:** these 3 cases are never cached:
  - `associated-consts/issue-93775.rs`
  - `parser/survive-peano-lesson-queue.rs` (8.1 MB)
  - `expr/if/expr-stack-overflow.rs`
  - Every full run of `expanded-nocore` pays up to 300 + 1,200 s of a slot for each of them.
  - A porter's `--sample 200` hits at least one of them in about 2.8% of runs and stalls for up to 25 min.
  - In `parse` the oracle finishes on all three (the subject TIMEOUTs there), so this is specific to the expanded `{:#?}`.
- **The proposal is reasonable:**
  - The handoff measured 2 min of CPU with no output.
  - `expr-stack-overflow.rs` alone is ~13 GB of output in `parse`.
  - None of the three is protected anywhere (none is in `parse.txt`).
- **Fix:**
  - Give `expanded-nocore` a `skipped()` that lists the three with the reason "oracle `{:#?}` of the expanded AST does not finish in 1,500 s", and filter them out of `cases()`, as `parse-ui` does via `uiCases`.
  - The other two suites finished on all three and need no skips.
  - Root records the decision.

## 7. Nothing else changed
- Case lists, skipped lists and argv of the 12 existing suites are unchanged (§4).
- No baselines or state files were touched.
- The only edits outside the new suites are `difftest.ts` `GZIP_OVER` and its comment.

## Spot-runs (lane worktree, `RUST_TS_AGENT=review-hw8`)
| suite | total | MATCH | DIFF | UNPORTED | CRASH | TIMEOUT | ORACLE_TIMEOUT | run |
|---|---|---|---|---|---|---|---|---|
| expanded-nocore | 100 | 2 | 0 | 98 | 0 | 0 | 0 | 20261013-080437-review-hw8-qnis |
| resdump-nocore | 100 | 2 | 0 | 98 | 0 | 0 | 0 | 20261013-080457-review-hw8-4nxj |

- All 98 UNPORTED cases are in one bucket: `rustc_builtin_macros::cmdline_attrs::inject (-Z crate-attr=feature(no_core))`.
- Both MATCHes (`impl-trait/precise-capturing/unexpected-token.rs`, `parser/missing-closing-generics-bracket.rs`) are in the 341 set.

## INFO
- **I1:** `lint_buffer` prints only primary spans. `span: None` and an empty `MultiSpan` both print `[]`. Acceptable, since the
  decorated lint is opaque (`DecorateDiagCompat`'s `Debug` is empty) and early-lint text shows up in expanded-nocore's stderr.
- **I2:** the suites ignore `//@ compile-flags` (`--crate-type`, `--cfg`, `-Zunstable-options` for `edition: future`, …) by design. Wave 12 (`ui-expanded`) emulates compiletest.
- **I3:** `unpretty-expanded-nocore` is 25 MB of data in 88 MB on disk, because of 4 KiB block granularity. This is inherent to one file per entry.
- **I4:** the handoff's "IndexMap-built buffers keep upstream order" applies only to Vec values. The IndexMaps themselves are sorted (M2).

## Scratch
Everything was under `$RUST_TS_DATA/tmp/review-hw8/` and has been deleted. The spot-run outputs stay in `$RUST_TS_DATA/runs/`.
