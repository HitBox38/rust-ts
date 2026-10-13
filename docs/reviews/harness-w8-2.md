ACCEPT

# Review 2: harness-w8 fix round (`lane/harness-w8` 583adc1..3f76820)

Reviewer: review-hw8b (independent, read-only on the lane). This is a delta review of the fixes for the first review
(`docs/reviews/harness-w8.md` on `lane/review-hw8`, verdict ACCEPT-WITH-FIXES: M1, M2, L2).
- **Scope:** `git diff 583adc1 3f76820` touches `harness/suites.ts`, `scripts/difftest.ts`,
  `tools/probes/resdump/main.rs` and `docs/handoff/harness-w8.md`. Nothing else changed.
- **Merge and build:**
  - `git merge-tree --write-tree main lane/harness-w8` is clean (merge base 6b099d0).
  - `bunx tsc --noEmit -p .` in the lane worktree prints nothing.

All three fixes are done and correct. No new findings above INFO.

## M1: slow-file skips (fixed)
- **Implementation:** `NOCORE_SKIPPED` (`harness/suites.ts:318-332`, comment + list + filter) lists the 3 files with reasons. `nocoreCorpus()` filters
  them out of `cases()`, and `skipped()` returns them.
- **Limited to the nocore suites:** it is used only by `nocoreSuite` (expanded-nocore, unpretty-expanded-nocore) and
  resdump-nocore. The lane applies it to all three, not only expanded-nocore, so that the three keep one case list.
  The handoff says root asked for this, and the code comment explains it.
- **Counts:** each nocore suite has 21,523 cases (21,526 - 3), and the 3 removed ids are exactly the skipped ones.
- **Recorded with reasons:** I ran `difftest --filter <name>` for each of the 3 files on each of the 3 suites.
  - All 9 runs gave `total=0 ... skipped=1`.
  - Each `<suite>.skipped.jsonl` holds the id and its reason.
- **Root action:** record the skip decision with `state.ts record decision` at integration. Nothing is in
  `docs/state/history.jsonl` yet, which is right: the lane may not write state.

## M2: resdump order (fixed)
- **Upstream types at the pin:** `ResolverGlobalCtxt` and `ResolverAstLowering` live in `rustc_middle/src/middle/resolve.rs:164-269`.
  `ty/mod.rs` does not define them.
  - The 11 Index collections:
    - `effective_visibilities`: `EffectiveVisibilities.map` is an `FxIndexMap` (`privacy.rs:104`);
    - `macro_reachable_adts`: `FxIndexMap<_, FxIndexSet>`;
    - `maybe_unused_trait_imports`: `FxIndexSet`;
    - `glob_map`: `FxIndexMap<_, FxIndexSet>`;
    - `trait_impls`, `confused_type_with_std_module`, `doc_link_traits_in_scope` and `delegation_infos`: `FxIndexMap`;
    - `doc_link_resolutions`: `FxIndexMap<_, DocLinkResMap>`, where `DocLinkResMap` is an `FxIndexMap` (`resolve.rs:327`);
    - `delegation_inherent_fn_map`: `FxIndexMap<_, FxIndexMap>`;
    - `lint_buffer`: `LintBuffer.map` is an `FxIndexMap` (`rustc_errors/src/decorate_diag.rs:56`).
  - `rustc_resolve` passes all 11 through unchanged: `into_outputs` moves the resolver's fields into the struct (`lib.rs:1963-2014`).
  - The hash-order collections are `UnordMap`/`UnordSet` plus `NodeMap` and `LocalDefIdMap`.
    Both of those come from `define_id_collections!`, which expands to `UnordMap` (`rustc_data_structures/src/fx.rs:13-19`).
- **Probe:**
  - All 11 collections, and their 4 inner Index collections, are now iterated directly with no sort.
    `did()` and the `DefId` import are removed.
  - Exactly 9 sorts remain, on: `expn_that_defined`, `extern_crate_map`, `module_children`, `ambig_module_children`,
    `paths_matching_assoc_types`, `all_macro_rules`, `partial_res_map`, `owners` (and each owner's 6 NodeMaps) and `disambiguators`.
    All of these are hash-order (Unord) collections. Each sort has a comment naming its upstream type.
  - The header's order table and the handoff's "Order rules" agree with the code.
- **Build:** I built the lane source in scratch with the `probes.ts` environment. It is byte-identical (`cmp`) to
  `$RUST_TS_DATA/target/probes/release/resdump`, so the suite runs the reviewed code.
- **Determinism:** I took 30 files from delegation, privacy, imports, resolve, traits, lint/unused, hygiene, macros,
  suggestions and rust-2018, choosing the ones whose Index sections were fullest. I ran each twice with the suite's argv and env.
  - All 30 were identical (stdout, stderr and exit code), and all 30 produced a dump.
  - Non-empty Index sections across the 30 files:
    - effective_visibilities 30;
    - lint_buffer 14;
    - trait_impls 13;
    - delegation_inherent_fn_map 4;
    - delegation_infos 3;
    - maybe_unused_trait_imports 3;
    - glob_map 2.
  - The fix is visible: in 12 files `effective_visibilities` is not in DefIndex order, and in 2 files `lint_buffer` is not in NodeId order.
  - **Not exercised by this sample:** macro_reachable_adts, confused_type_with_std_module and the doc_link sections were empty in all 30.
    Their code is the same direct iteration.
- **Spot-run:** `resdump-nocore --sample 50` (`RUST_TS_AGENT=review-hw8b`, run 20261013-082130-review-hw8b-ajwe) gave
  50 UNPORTED, 0 DIFF, 0 CRASH, and `skipped=3`. The new probe hash re-keyed the oracle cache, as the handoff says.

## L2: gzip threshold (fixed)
- `writeCached` now tests `Buffer.byteLength(json) > GZIP_OVER`, and the comment says "UTF-8 bytes".
- **Backward compatible:** `readCached` is unchanged and still picks the format by the gzip magic, so raw and gzipped
  entries of any size stay readable. `GZIP_OVER` is not part of the cache key.
- **Atomic:** writes still go to a tmp file followed by `renameSync`, unchanged.

## Nothing else changed
- **Case lists:** I hashed `sha256(JSON.stringify(cases()))[:16]` and the `skipped()` list for every suite, on main and on the lane.
  The 12 existing suites are identical, for example lex a8a356bd10b8a7b6, parse b244fb01ad2573be and parse-ui-json 38cb955080adddcc.
  The diff is only the 3 new nocore suites.
- **Baselines and state:** `git diff main 3f76820 -- harness/baseline docs/state` is empty.
- **Unit tests:** `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=120000 src tools` in the lane worktree gave 2211 pass, 1 skip, 0 fail
  (2212 tests, 134 files, 60 s).
  - The only skip is in `src/rustc_span/source_map/tests.test.ts`. That file holds `read_binary_file_handles_lying_stat`, the one entry
    in `ALLOWED_SKIPS` (a Linux-only test).

## INFO
- **I1:** in resdump-nocore and unpretty-expanded-nocore, the skip reason names the `-Zunpretty=ast-tree,expanded` oracle.
  Those two suites' oracles finish on these files; the suites skip them only to share one case list.
  The comment says so, but the reason string alone could mislead a reader of `skipped.jsonl`.
- **I2:** the probe header's sort-key list now jumps from (1) to (3), because (2), the DefId key, was removed. This is cosmetic.
- **I3:** the first review's recommendation still holds: do not protect the nocore suites until the port gets past
  `cmdline_attrs::inject`. Today every non-parse-fatal case is UNPORTED.

## Scratch
Everything was under `$RUST_TS_DATA/tmp/review-hw8b/` and has been deleted. The spot-run outputs stay in `$RUST_TS_DATA/runs/`.
