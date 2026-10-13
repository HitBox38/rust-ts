# Handoff: harness-w8 (harness/scripts/probe batch; needs an independent review)

Branch `lane/harness-w8`, based on main 57998d3, with main (6b099d0: stable-hash, target-cfg, hir-def) merged
in. Baselines are not touched; the three new suites start unprotected. No ported upstream code, so no
coverage numbers and no `// rustc:` markers; one `unported(...)` and one `// PORT:` (below).

## Files touched
- `harness/suites.ts`: suites `expanded-nocore`, `unpretty-expanded-nocore`, `resdump-nocore`.
- `tools/probes/resdump/{Cargo.toml.in,main.rs}` (new): rustc-dev probe, format documented in its header.
- `src/rust_ts/resdump.ts` (new): the subject of `resdump-nocore`.
- `scripts/difftest.ts`: `GZIP_OVER` 64 KiB → 4 KiB (oracle cache entries; write side only).

## 1. `expanded-nocore` / `unpretty-expanded-nocore`
- Cases: every `.rs` under tests/ui (the `parse` corpus, 21,526 files; id = path) minus 3 skipped
  (review fix M1, below), so 21,523. Single mode (one rustc per file).
- argv, oracle (`rustc +nightly`) and subject (`src/rust_ts/main.ts`) alike:
  `--target x86_64-unknown-linux-gnu --sysroot <oracle sysroot> --edition=<directive, as parse>
  -Zcrate-attr=feature(no_core) -Zcrate-attr=no_core -Zunpretty=ast-tree,expanded|expanded <file>`.
- Env, both sides: `RUSTC_ICE=0` (otherwise every ICE writes `rustc-ice-<timestamp>-<pid>.txt` into the
  upstream checkout and names it on stderr: nondeterministic; I deleted the 11 such files my first sample
  run left there) and `RUST_BACKTRACE=0` (a panic ICE would otherwise print a full backtrace with
  addresses). The env joins the cache key (existing mechanism).
- Timeouts as `parse`: subject 60 s, oracle 300 s (retry x4).

### Oracle facts (full corpus, from the cache)
| | expanded-nocore | unpretty-expanded-nocore | resdump-nocore |
|---|---|---|---|
| exit 0 | 5,712 (26.5%) | 5,713 | 5,868 |
| exit 1 | 15,796 (73.4%) | 15,798 | 15,652 |
| exit 101 (ICE) | 15 | 15 | 6 |
| ORACLE_TIMEOUT | 3 | 0 | 0 |
| empty stdout | 1,920 | 1,920 | 1,917 |
| files with E0463 | 1,424 | 1,424 | 1,424 |
| cache on disk | 133 MB | 88 MB | 94 MB |
| raw output | 1.75 GB | 39 MB | 264 MB |

- **The plan's claim (§2 D) is only half right.** With no_core nothing from std/core is injected or in the
  extern prelude, unresolved names give resolve errors (top codes: E0433 5,304 files, E0405 4,365, E0425
  4,317, E0432 926, E0531 609) and the expanded AST is still printed (91% of cases have stdout). But the exit
  code is then **1**, not 0: exit 0 only for the 26.5% without errors.
- **Metadata is loaded only when the file asks.** Full-corpus check: re-ran the unpretty-expanded oracle with
  an empty `--sysroot` and compared with the cached output: **669 cases (3.1%) depend on the sysroot**.
  - 642 have an `extern crate` item (414 of them `std`/`core`/`alloc`/`proc_macro`/`test`; the rest are aux
    crates, whose E0463 changes when the sysroot lacks the target: fatal + "target may not be installed").
  - 27 have a false crate-level `#![cfg(..)]`: cfg-stripping removes the injected `#![no_core]` too, so std
    is injected and loaded (e.g. `tests/ui/cfg/cfg-in-crate-1.rs`).
  - A 2018+ `use std::..`/`core::..` path does not load anything (E0433), verified.
  - List: `$RUST_TS_DATA/tmp/harness-w8/sysroot-dependent.txt` (scratch).
  These are the cases that need wave 11 (metadata); all others are reachable without it.
- **Oracle ICEs:** all 15 (6 in resdump) are delayed bugs: malformed attributes (`repr`, `test_runner`,
  `proc_macro_derive`, `macro_use`, tool attrs, ...) whose real error is emitted at HIR time, which
  `-Zunpretty` never reaches. The output contains `delayed at /rustc-dev/<commit>/compiler/<file>.rs:L:C`,
  so matching them needs upstream source locations in the port. Listed by `cachestats.ts`.
- **ORACLE_TIMEOUT (expanded-nocore only):** `associated-consts/issue-93775.rs`,
  `parser/survive-peano-lesson-queue.rs`, `expr/if/expr-stack-overflow.rs`. These are the very deep ASTs whose
  `{:#?}` is huge; `deep-try-chain-issue-153583.rs` finished. The `-Zunpretty=expanded` variants all
  finished. An ORACLE_TIMEOUT is never cached, so every gate run of `expanded-nocore` pays up to
  300 s + 1200 s for each of these three cases in parallel slots. See "Proposals".

### Cost (measured; load average 55-70 on 12 cores during all runs)
- Oracle: 0.03 s CPU per rustc (max 0.09 s in a 500-file sample, outside the 3 timeouts); 500 files x 3
  invocations took 24 s wall at 8 jobs. Full corpus: about 6-8 min of oracle wall per suite at 8-10 jobs.
- Subject (bun, one process per case): the full suites took 3,112 s (expanded-nocore, including the
  timeout retries), 1,057 s and 1,016 s at `--jobs 10`. The subject dominates.
- Cache: 315 MB total for the three suites with the new 4 KiB gzip threshold. With the old 64 KiB threshold the
  500-sample extrapolation was ~0.7 GB. Disk now has 6.5 GB free.
- **Decision: full corpus, no subset.** The oracle cost is small and paid once per oracle build.

## 2. `resdump` probe + `resdump-nocore`
- The probe is `rustc_driver_impl::main` with its own callbacks: `install_ice_hook(DEFAULT_BUG_REPORT_URL)`,
  `catch_with_exit_code(|| compiler_entrypoint(&raw_args(..), &mut ResDump))`.
  - `config` sets `trimmed_def_paths = true`, as `TimePassesCallbacks::config` does.
  - `after_expansion` runs right after `tcx.resolver_for_lowering()`, before `write_dep_info`, early lints
    and analysis. It prints the dump to stdout and returns `Stop`.
- argv is expanded-nocore's without `-Zunpretty`, because the pretty path never calls the callbacks. Same
  env. stderr is rustc's diagnostics up to and including resolution, then `aborting due to ..`. Nothing is
  written to disk (stopping before `write_dep_info`). The exit code is rustc's.
- **Dump** (format and sort keys are in the header of `main.rs`):
  - **ResolverGlobalCtxt** (`tcx.resolutions(())`), every field: visibilities_for_hashing,
    expn_that_defined, effective_visibilities, macro_reachable_adts, extern_crate_map,
    maybe_unused_trait_imports, module_children, ambig_module_children, glob_map, main_def, trait_impls,
    proc_macros, paths_matching_assoc_types, confused_type_with_std_module, doc_link_resolutions,
    doc_link_traits_in_scope, all_macro_rules, stripped_cfg_items, delegation_infos,
    delegation_inherent_fn_map.
  - **ResolverAstLowering**: next_node_id and partial_res_map. At the pin, `import_res`, `label_res_map`,
    `lifetimes_res_map`, `extra_lifetime_params_map`, `trait_map` and `node_id_to_def_id` live per owner in
    `owners: NodeMap<PerOwnerResolverData>`, so each owner is printed with them. Also the lint buffer and
    the disambiguator keys.
  - **The definitions table**: every LocalDefId with its `def_kind` (fed by `create_def`), DefKey and
    DefPathHash. This checks def_collector and stable hashing.
  - Values use upstream `{:?}`: DefId through the tcx (`DefId(0:3 ~ krate[510d]::Cat)`), Span through the
    source map.
- **Order rules (after review fix M2).** Only collections whose upstream iteration order is a hash order are sorted:
  - which ones: Unord maps/sets and `NodeMap`/`LocalDefIdMap` (= UnordMap), i.e. expn_that_defined, extern_crate_map,
    module_children, ambig_module_children, paths_matching_assoc_types, all_macro_rules, partial_res_map, owners
    and their 6 maps, and disambiguators;
  - keys: LocalDefId by DefIndex, NodeId numerically, Symbol by string, Span by (lo, hi) then text.

  The 11 FxIndexMap/FxIndexSet collections print in upstream iteration order, inner Index collections included:
  effective_visibilities, macro_reachable_adts, maybe_unused_trait_imports, glob_map, trait_impls,
  confused_type_with_std_module, doc_link_resolutions, doc_link_traits_in_scope, delegation_infos,
  delegation_inherent_fn_map and the lint buffer. That order is deterministic and visible downstream, so the port
  must reproduce it.

  Vecs keep upstream order. Each sort has a comment in `main.rs` saying why.
- **Not printed (deliberately):**
  - the `PerParentDisambiguatorState` contents (a private FxHashMap; they are implied by the DefKeys);
  - a buffered lint's decorate closure (opaque; prints as `DecorateDiagCompat`). Its lint name, node and
    primary spans are printed; the rendered lint shows up in expanded-nocore's stderr.
  - `def_span` / `visibility` queries: the crate root's `def_span` would need HIR, and
    visibilities_for_hashing already lists every fed visibility.
- **Subject** `src/rust_ts/resdump.ts` mirrors the probe's `main` with the ported driver
  (`catch_with_exit_code`, `compiler_entrypoint`, `raw_args`).
  - `shim` runs the probe and `stub` reports unported, as main.ts does.
  - `unported("rust_ts::resdump::dump (...)")` sits in `after_expansion`.
  - `// PORT:` the ported `Callbacks` interface has no `after_expansion` yet. driver-m2 must add it and call
    it after `resolver_for_lowering`; then this callback object is used as is, and its body becomes the
    dump.
- Validation: probe output inspected by hand on `resolve/issue-2356.rs` (all sections present, sorted).
  Results on samples of 100: `--impl shim` 100/100 MATCH and `--impl stub` 100/100 UNPORTED, for all three
  suites.

## 3. Full runs and samples (subject = port)
| run | MATCH | DIFF | UNPORTED | CRASH | TIMEOUT | ORACLE_TIMEOUT |
|---|---|---|---|---|---|---|
| hw8-full-expanded-nocore (before merge) | 341 | 0 | 21,182 | 0 | 0 | 3 |
| hw8-full-unpretty-expanded-nocore | 341 | 0 | 21,185 | 0 | 0 | 0 |
| hw8-full-resdump-nocore | 341 | 0 | 21,185 | 0 | 0 | 0 |
| after merging main: `--sample 200`, each suite | 5 | 0 | 195 | 0 | 0 | 0 |

- **UNPORTED:** one bucket, `rustc_builtin_macros::cmdline_attrs::inject (-Z crate-attr=feature(no_core))`.
  That is the first unported step; `create_and_enter_global_ctxt` comes next.
- **The 341 MATCH** are the same set in all three suites: files whose parse errors are fatal before
  expansion. They are legitimate matches.
- **DIFF buckets:** none.

## 4. Gate integration
- The suites are registered with no baselines, so `gate.ts run` (protected suites only) is unchanged.
- `gate.ts run --suites expanded-nocore,unpretty-expanded-nocore,resdump-nocore` works. `checkProbes`
  accepts them; resdump must be built with `bun scripts/probes.ts build resdump`.

## Review fixes (docs/reviews/harness-w8.md on `lane/review-hw8`: ACCEPT-WITH-FIXES)
- **M1:** done (see "Skipped slow files").
- **M2:** done (see "Order rules"). The probe was rebuilt, so its cache key changes; the old resdump entries are unreachable.
- **L2:** the gzip threshold now counts UTF-8 bytes (`Buffer.byteLength`).
- **L1** (scrub the rest of the inherited environment) is left for a separate harness batch, as root decided.
- **Spot checks after the fixes:**
  - `resdump-nocore --sample 100`: shim 100/100 MATCH; port 3 MATCH + 97 UNPORTED. All 97 are `cmdline_attrs::inject`.
  - `expanded-nocore --sample 100`: 3 MATCH + 97 UNPORTED.
  - `--filter issue-93775`: 0 cases, 1 skipped, with its reason.
  - Probe determinism: 30 imports/resolve files run twice gave identical output.
  - Case lists: unchanged for the 12 existing suites. The nocore suites now have 21,523 cases and 3 skipped.

## Checks
- `bunx tsc --noEmit -p .`: clean, before and after the merge.
- `bun scripts/coverage.ts --check`: markers ok (4319; vendor 2403) after the merge.
- `RUST_TS_REQUIRE_PROBES=1 CI=true bun test --timeout=60000 src tools`:
  - before the merge: 2051 pass, 1 skip (the allowlisted one), 0 fail;
  - after the merge: 2211 pass, 1 skip, 0 fail.
- Case lists: `sha256(JSON.stringify(cases()))[:16]` is identical to main 6b099d0 for every existing suite,
  and matches harness-w7's table: lex a8a356bd10b8a7b6, parse b244fb01ad2573be, escape a8a356bd10b8a7b6,
  symbols 7b46e1e12e1f8d93, escape-synthetic 6618a744d214bf09, fluent-* 696bc26b11376778,
  emit 1bf53fe82cb7084a, tokens ecb7ce76882d03ee, tokens-str 65fb6186a8e1cf70, parse-ui c6b78cbec4740944,
  parse-ui-json 38cb955080adddcc.
  - The new suites' hashes include the absolute sysroot path, so they are per machine; their ids are not.
- `git diff main -- harness/baseline`: empty.

## Decisions for root to record
1. The nocore suites pass `--sysroot <oracle sysroot>` on both sides (D1). The subject cannot derive the
   oracle's sysroot from its own location, and 669 cases depend on the sysroot's contents.
2. Both sides run with `RUSTC_ICE=0 RUST_BACKTRACE=0`.
3. Full tests/ui corpus, single mode, timeouts as `parse` (60 s subject, 300 s oracle, retry x4).
4. Oracle cache entries are gzipped above 4 KiB (was 64 KiB).
5. resdump stops right after `resolver_for_lowering` (no early lints).
   - It sorts only hash-order (Unord/id-collection) maps and sets, by the keys above.
   - It prints IndexMaps/IndexSets in upstream order and keeps Vec order (review M2).
   - It omits the disambiguator state and lint closures.
6. The 3 slow files are skipped in all three nocore suites, with reasons in `skipped()` (review M1; see below).
7. Do not protect the nocore suites until the port gets past `cmdline_attrs::inject` (review §5). No baselines.

## Skipped slow files (review fix M1, done)
- **Files:** `associated-consts/issue-93775.rs`, `parser/survive-peano-lesson-queue.rs` and `expr/if/expr-stack-overflow.rs`.
- **Why:** they are ORACLE_TIMEOUT in `expanded-nocore` and never cached, so they would cost up to 25 min each per run. Without a timeout, the first two printed nothing after 2 min of CPU each (about 27 min of wall time at load 60+), and I killed them. `expr-stack-overflow.rs` produces ~13 GB in `parse`.
- **Fix:** `NOCORE_SKIPPED` in `harness/suites.ts` filters them out of `cases()` and lists them with reasons in `skipped()`. This applies to all three nocore suites, as root asked, so they keep one case list.

## Proposals (not done)
- For the M2a ≥95% gate, consider excluding:
  - the 669 sysroot-dependent cases (they need metadata, wave 11);
  - the 15 delayed-bug ICE cases.
  These are 3.2% of the corpus.

## What a reviewer should check
1. Probe vs rustc's driver: does `compiler_entrypoint` + `ResDump` produce the same diagnostics up to
   resolution as `rustc` without `-Zunpretty`? Check `config` against `TimePassesCallbacks::config`, and the
   effect of skipping `install_ctrlc_handler`, `signal_handler` and the logger.
2. Dump completeness against `middle/resolve.rs` at the pin: every field is printed or listed as omitted
   with a reason.
3. Sort keys: is anything printed in hash-map order? Check `UnordItems` (collected through `unord_vec`,
   then sorted) and `FxIndexMap` values.
4. The env pinning (`RUSTC_ICE`, `RUST_BACKTRACE`) and whether other inherited env can change rustc output
   (`RUSTC_LOG`, `CLICOLOR_FORCE`, ...).
5. The gzip threshold change: readers stay compatible, and only write size changes.
6. The oracle statistics above, against the cache, with `$RUST_TS_DATA/tmp/harness-w8/scripts/cachestats.ts
   <suite>`.
