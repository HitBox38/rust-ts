ACCEPT-WITH-NOTES

# Review: probe-tydump (`lane/probe-tydump` at 030ac10)

Reviewer: reviewer-tydump (independent, read-only on the lane).
- **Scope:** `git diff lane/plan-m3...lane/probe-tydump` (merge base 2e11981):
  - `tools/probes/tydump/{Cargo.toml.in,main.rs,prefix.rs}` and `tools/probes/thirdump/{Cargo.toml.in,main.rs}`;
  - `harness/suites.ts` (+132/-3: imports, then an appended M3 block);
  - `src/rust_ts/{tydump,thirdump}.ts`;
  - `docs/handoff/probe-tydump.md`.
- **Merge and build:**
  - `git merge-tree --write-tree main lane/probe-tydump` is clean.
  - `bunx tsc --noEmit -p .` prints nothing.
  - `bun scripts/coverage.ts --check`: markers ok.
  - `bun scripts/probes.ts build tydump thirdump` was a no-op: the binaries were already built from the lane's sources.

**Summary.**
- The prefix is upstream's `run_required_analyses` up to `definitions.freeze()`, statement by statement. Only the
  debug-assertions-only validator and the D1a const-eval arm are left out, and both omissions are documented.
- The three copied `#[rustc_dump_*]` modules and the four `should_encode_*` predicates are verbatim.
- Both probes are deterministic run to run, including thirdump's alloc ids.
- The suites are symmetric. The "no HIR" fix is fair.
- Nothing protected changed.
- There are no blocking findings: three LOW notes (L1 ambient `THIRDUMP_FORMAT`, L2 fact coverage vs plan §6, L3 the
  minicore skip ratio) and some INFO notes.

## 1. Stop point and headers (OK)
- **`prefix.rs` vs upstream at the pin.** I compared it line by line with `rustc_interface/src/passes.rs:1100-1161` and
  `rustc_hir_analysis/src/lib.rs:145-230`. The order of every statement is upstream's, and so are the comments.
  - **Differences:**
    - `hir_id_validator::check_crate` is left out. It is `#[cfg(debug_assertions)]`, so the release oracle does not run it either.
    - The `Static`/`Const` arm (lib.rs:166-184) is left out (D1a).
    - `emit_delayed_lints` is called as `rustc_interface::passes::emit_delayed_lints`.
    - One `num_definitions()` read after `hir_crate_items` is added. It is an observation only.
  - **Where it stops:** after `freeze()`. MIR_borrow_checking, the `analysis` error abort and misc_checking_3 are not run, as D1 says.
- **Copied crate-private code.** I diffed it with indentation normalized:
  - `collect_dump`, `outlives_dump` and `variance_dump` are identical to `collect/dump.rs`, `outlives/dump.rs` and
    `variance/dump.rs`, apart from the module wrapper and one replacement: `emit_err(TypeOf{..})` becomes a hand-built `Diag`.
  - That replacement matches the derive: `#[diag("{$ty}")]` expands to `DiagMessage::Inline(Cow::Borrowed(..))`
    (rustc_macros `diagnostics/message.rs:72`), with `#[primary_span] span` and arg `ty` (`diagnostics.rs:769-775`).
  - `should_encode_{variances,generics,type,fn_sig}` are identical to `rustc_metadata/src/rmeta/encoder.rs:1213/1252/1288/1349`.
  - The ConstArg/InferArg AnonConst skip is identical to `encode_def_ids` (encoder.rs:1500-1511).
- **thirdump vs pretty.rs.** The flow matches pretty.rs:333-341 (`ThirFlat`): `abort_if_errors`, then
  `"{:?}:\n{}\n"` over `hir_body_owners()`. Upstream's second `check_crate` is not repeated, and the header explains why
  correctly: the `has_errors` fatal in `analysis` (:1222) means the second call never re-emits the dump errors.
- **Headers.** The `main.rs` header of each probe documents every section, line format, applicability predicate and sort
  key: (1) DefIndex-sorted, (6) `items_in_stable_order`, (7) a scan over all ItemLocalIds, plus index and Vec order. The
  `prefix.rs` header lists every difference from upstream.
- **INFO I1 (D1a guard calls).** Leaving out the arm also drops two calls from its match guard:
  `generics_of(..).own_requires_monomorphization()` and `const_of_item(..)`. `generics_of` runs anyway (typeck and
  the dump). `const_of_item` is a lookup with no diagnostics, so I expect no visible effect. The header could say so in
  one line.
- **INFO I2 (no `analysis` query frame).** The prefix runs directly in `after_expansion`, not inside the `analysis`
  query. On an ICE, the "query stack during panic" therefore lacks the `#N [analysis]` frame that real rustc prints. This
  belongs with the documented `-Ztrack-diagnostics` limit. It is deterministic and has to be mirrored by the port. The
  handoff reports 0 ICEs on the full nocore corpus.
- **INFO I3 (stale handoff wording).** The handoff says "each function steals the THIR, so one run can print only one
  format", and the thirdump header says the same.
  - In fact `thir_flat`/`thir_tree` call `super::cx::thir_body` directly, not the query (`rustc_mir_build/src/thir/print.rs:9-26`).
    Each call builds a fresh `Steal`.
  - The behaviour is still right. Only the reason given is wrong.

## 2. Determinism (OK)
- **Sources of nondeterminism.**
  - std `HashSet`s (`with_hir`, `typecked`) are used only for `contains`.
  - Every `UnordMap`/`UnordSet` is sorted by a unique key: DefIndex, or ItemLocalId through `items_in_stable_order`.
  - `FxIndexMap`/`FxIndexSet` fields (`hidden_types`, the inner `closure_min_captures`, `coroutine_stalled_predicates`)
    keep their insertion order.
  - No `{:p}` or pointer values are printed. A scan of the outputs below finds no `0x…` values.
  - The only hash-like text is the StableCrateId in DefId paths (`[4430]`, `[cd62]`), which resdump already has.
- **Two runs of each probe**, with the suites' exact argv and env and cwd = upstream. stdout, stderr and the exit code were
  compared with `cmp`:

  | case | tydump stdout | thirdump stdout | identical both runs |
  |---|---|---|---|
  | cg_clif `mini_core.rs` (lib) | 282,094 B, exit 0 | 480,217 B, exit 0 | yes / yes |
  | `mini_core_hello_world.rs` (`--extern`) | 540,363 B, exit 0 | 880,480 B, exit 0 | yes / yes |
  | `tests/ui/privacy/privacy1.rs` (nocore) | 39,259 B, exit 1 | 0 B (aborts), exit 1 | yes / yes |
  | `tests/ui/lang-items/issue-87573.rs` (nocore) | 5,726 B, exit 1 | 0 B, exit 1 | yes / yes |
  | `tests/ui/lang-items/lang-item-generic-requirements.rs` | 0 B, exit 1 | 0 B, exit 1 | yes / yes |
  | `tests/ui/attributes/issue-90873.rs` | 336 B, exit 1 | 0 B, exit 1 | yes / yes |

- **Determinism across processes and over time.** The `--impl shim` runs re-execute the probe as the subject and compare
  it with the lane's cached oracle output from hours earlier:
  - tydump-nocore `--sample 30`: 30/30;
  - tydump-minicore: 46/46;
  - thirdump-minicore: 46/46.
- **thirdump alloc ids reach the compared output, and are deterministic.**
  - The flat format prints `AllocId` with `{:?}`, as `a1`, `a2`, …, not `allocN`. hello_world has `StaticRef { alloc_id: a1 … a4 }`.
  - `a1` (`NUM`) appears again later. That is `reserve_and_set_static_alloc`'s per-static dedup.
  - With `-Zthreads=1` the counter depends only on the order of query execution, so the output is stable.
  - **Port note (not a defect):** the subject must reproduce the probe's AllocId reservation order. That includes any
    reservation made during the prefix (e.g. a const eval from typeck, which is UNPORTED until M4/M6 per D1a) and the
    `hir_body_owners` order of THIR building. The real `-Zunpretty=thir-*` numbering differs (the statics are evaluated
    first), as the handoff measured. That is the expected D1a effect.

## 3. The "no lowered code" fix (OK, fair)
- **The rule** is `with_hir.contains(id) || index >= num_definitions_after_lowering`. A DefId that fails it gets only its
  header line, `<LocalDefId:?> <DefKind:?>`.
  - The excluded DefIds are ones where every fact query ICEs in `lower_to_hir` on the oracle, so they have no comparable
    facts to lose.
  - Their header line is still compared, so DefId creation and `def_kind` stay checked.
- **issue-90873:** 4 of its 5 DefIds are header-only: `{closure#0}` Closure, `d` Static, `d::{closure#0}` Closure and
  `{impl#0}` Impl. They all sit inside attribute expressions, which are never lowered.
- **Clean crates lose nothing.** In mini_core and hello_world the header-only DefIds are:
  - Mod, ForeignMod, LifetimeParam, Macro, Use and ExternCrate. All `should_encode_*` predicates are false for these kinds.
  - one AnonConst, the documented ConstArg skip.

  No Fn, Struct, Impl, Static, Closure or AssocTy is ever header-only. This agrees with the handoff: mini_core's output did not change with the fix.
- **Divergences stay visible.** The subject has to compute the same set from its own lowering, through owners and
  `lower_to_hir(..).children`. If the port's lowering drops or adds a child, the facts appear on one side only, which
  is a visible DIFF.

## 4. Suite symmetry (OK, one LOW note)
I loaded the lane's `harness/suites.ts` and printed `oracle([c])` and `subject([c])` for the two cg_clif cases. The
trailing argv is identical on both sides. Example:
`-Cdebuginfo=2 --target x86_64-unknown-linux-gnu --sysroot <oracle sysroot> -Cpanic=abort --check-cfg=cfg(jit) --check-cfg=cfg(target_has_reliable_f128) --edition=2024 -Zforce-unstable-if-unmarked <file> [--crate-type lib]`,
with `--extern mini_core=$RUST_TS_DATA/aux/mini_core-e4b1ebe52e82d30c/libmini_core.rmeta` in front for hello_world.
- **Flags.** These are cg_clif's `rustc_command` flags at the pin (`build_system/tests.rs:577-600`).
- **Settings.**
  - Env is `NOCORE_ENV`, plus `c.env` for UI cases, on both sides.
  - cwd is UPSTREAM on both sides (no `cwd` set).
  - Timeouts are 60 s for the subject and 300 s for the oracle, as in nocore.
  - tydump-nocore reuses `nocoreCorpus`, `nocoreArgs`, `NOCORE_ENV` and `NOCORE_SKIPPED` unchanged (21,523 cases, 3 skipped).
- **Aux rmeta.**
  - The oracle's rustc builds it (`--emit=metadata`, M2 D5 pattern). Its path key covers `rustcDriverHash()`, the source
    hash, the file name and the flags. The path is in the case args, so it is in the oracle cache key.
  - The subject gets the same file path and nothing else from the oracle.
  - The subject stubs read only `RUST_TS_IMPL`.
- **L1 (LOW): `THIRDUMP_FORMAT` is ambient and outside the cache key.**
  - The thirdump probe switches format on `THIRDUMP_FORMAT=tree`.
  - `run()` (`scripts/lib/common.ts:67`) starts from `process.env`, and `cachePath` hashes only `c.env`.
  - So if root ever runs the suite from a shell with `THIRDUMP_FORMAT=tree`, the oracle caches tree output under the
    flat-format key. The subject stub does not read the variable today, which makes this asymmetric as well.
  - **Recommendation (small harness or probe change, before protection):** pin it in the minicore case env (e.g.
    `THIRDUMP_FORMAT: null`, which `run()` supports), or select tree with a probe argument instead of the environment.
- **INFO I4.** The `-Zparse-crate-root-only` filter would also strip a test's own `compile-flags` copy of that flag.
  10 tests/ui files carry it, and none of them is in the minicore corpus, so nothing is affected today.
- **INFO I5.** `oracleAuxRmeta` trusts any existing `libmini_core.rmeta`. A truncated file left by an interrupted
  build would not be rebuilt. The key-named directory limits this to one key, and deleting the directory fixes it.
- **INFO I6.** The probe stops before `write_dep_info`/`write_interface`, so it also ignores rustc's `--emit=dep-info`-only
  and `-Zno-analysis` early returns. This is symmetric by construction, and the header documents the stop point.

## 5. Minicore skips (justified and documented; LOW note on scale)
- **Reasons and counts.** The reviewer run's `tydump-minicore.skipped.jsonl` has 589 entries. Every one carries
  compiletest.ts's reason, and the counts match the handoff:

  | reason | cases |
  |---|---|
  | `needs-llvm-components` | 520 |
  | `min-llvm-version` | 4 |
  | other `needs-*` (sanitizers, xray, unwind, asm-support) | 36 |
  | `add-minicore` | 16 |
  | `aux-build` (7 of them minicore) | 11 |
  | `only-*` (eabihf) | 2 |

  The skips come from the existing `uiCases` logic. This batch does not change it, and the protected parse-ui suites share it.
- **L3 (LOW): the run set is 46 cases, 7% of the corpus, and the M3b ≥ 80% threshold is computed over it.**
  - The `needs-llvm-components` skips cover 206 files. 161 of them also say `add-minicore`, so they would be skipped
    anyway until D11 support lands.
  - The other **45 files (127 cases)** are native `#![no_core]` tests skipped only for `needs-llvm-components`. The probe
    never reaches codegen, and the oracle's LLVM has every component, so these could run today.
  - Nothing is hidden: every skip is listed with a reason. But the M3b share means little until follow-ups 1 and 2 in the
    handoff are done.
  - **Recommendation for root:** schedule those follow-ups (harness-w13/w20) before M3b protects these suites. Adding
    cases to an unprotected suite costs nothing.
- **Corpus selection.** It is correct. `minicoreUiFile` uses line-anchored regexes, so a commented-out `#![no_core]` does
  not match, and `auxiliary/` files are excluded. Choosing root directories and then filtering by file keeps exactly the
  wanted files' cases and skips.

## 6. Coverage of the dump vs plan §6 (LOW)
- **L2 (LOW): the dump covers less than plan §6 lists, and orders items differently.**
  - **Covered differently, nothing lost:**
    - `predicates_of` is `clauses_of` at the pin. It includes `explicit_clauses_of` and `inferred_outlives_of`
      (`collect/clauses_of.rs:28-44`), so explicit and inferred predicates are both covered.
    - Variant and field types are covered by `type_of` on the Variant, Field and Ctor DefIds.
  - **Not dumped:** `adt_def` (repr, flags, discriminants) and `associated_item` (container, defaultness, `trait_item_def_id`).
  - **Order:** items come in DefIndex order rather than "DefPath order".
    - DefIndex order is `iter_local_def_id`'s order, which is what the encoder uses, and it is deterministic.
    - It is arguably stricter, because it also checks the order in which DefIds are created.
  - **Recommendation:** either add `adt_def`/`associated_item` lines, or record a decision that these are out of scope.
    Do it before the first protection, because changing the output format later loses protected cases.

## 7. Nothing protected changed (OK)
- `git diff --stat lane/plan-m3...lane/probe-tydump -- scripts harness/baseline harness/compiletest.ts docs/state src/`
  (minus the two new subject files) is empty.
- The `suites.ts` changes are only:
  - the new imports `existsSync`, `mkdirSync`, `DATA`, `hash` and `rustcDriverHash`, all existing exports;
  - the appended block.
- Existing suite definitions, `NOCORE_*`, cache-key inputs and runners are untouched.
- Existing baselines are untouched, and the new suites have none.

## 8. Spot-check (OK)
All runs used `RUST_TS_AGENT=reviewer-tydump` in the lane worktree:

| suite | impl | sample | MATCH | DIFF | UNPORTED | other | skipped | run |
|---|---|---|---|---|---|---|---|---|
| tydump-nocore | port | 30 | 4 | 0 | 26 | 0 | 3 | `20261014-013705-reviewer-tydump-rgb4` |
| tydump-nocore | shim | 30 | 30 | 0 | 0 | 0 | 3 | `20261014-013707-reviewer-tydump-3ejs` |
| tydump-minicore | port | full 46 | 4 | 0 | 42 | 0 | 589 | `20261014-013714-reviewer-tydump-dcge` |
| tydump-minicore | shim | full 46 | 46 | 0 | 0 | 0 | 589 | `20261014-013717-reviewer-tydump-0b7e` |
| thirdump-minicore | port | full 46 | 4 | 0 | 42 | 0 | 589 | `20261014-013718-reviewer-tydump-x8a3` |
| thirdump-minicore | shim | full 46 | 46 | 0 | 0 | 0 | 589 | `20261014-013720-reviewer-tydump-gq0y` |

- **Port runs.** Every UNPORTED case stops at the subject's single `unported("rust_ts::tydump::prefix::run_required_analyses_prefix …")`.
  The MATCHes are cases that end before `after_expansion`, at parse, expansion or resolve errors, as the handoff says.
- **Shim runs.** These are 100%, as expected.

## Gate recommendation
- **Merge:** OK to merge. The suites start unprotected.
- **Before protecting tydump-*/thirdump-*:**
  - fix L1, pinning `THIRDUMP_FORMAT`;
  - decide L2, the `adt_def`/`associated_item` facts;
  - widen the minicore run set (L3: `needs-llvm-components`, `add-minicore`).
- **Record:** the decision the handoff asks for, that thirdump prints flat by default with tree available via the env
  var (but see L1).

## Scratch
- Scratch was under `$RUST_TS_DATA/tmp/review-tydump/` and has been deleted.
- The six sample runs stay in `$RUST_TS_DATA/runs/` (listed in §8).
