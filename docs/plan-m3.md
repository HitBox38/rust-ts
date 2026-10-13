# M3 plan — HIR, typeck, trait solving

Source: the plan-m3 planner (read-only; it ports no code). Status: **proposed**. Root accepts or amends
decisions D1–D12 and records them with `bun scripts/state.ts record decision`.
Pin `6f5da406b56c` (1.101.0-nightly). Line counts are from `wc -l` at the pin, without `tests.rs`. Paths are
relative to `compiler/` unless they say otherwise.

## 1. What the M3 gate commands run at the pin

### 1a. `-Zunpretty=hir-tree` and `-Zunpretty=hir`: AST lowering only, no analysis

`rustc_driver_impl/src/lib.rs:281` runs `pp_mode.needs_ast_map()`, which is true for `Hir(_) | HirTree | ThirTree
| ThirFlat` (`rustc_session/src/config.rs:3316`). It then calls `create_and_enter_global_ctxt`, then
`early_lint_checks`, then `pretty::print` (`pretty.rs:232`).

- `needs_analysis()` (config.rs:3334) is **false** for `HirTree` and for `Hir(Normal|Identified)`, so typeck does not
  run.
- HirTree (pretty.rs:298) is `hir_crate_items(()).owners()`, then `"{owner:#?} => {hir_owner_nodes(owner):#?}\n"`.
  - `hir_crate_items` is `rustc_middle/src/hir/map.rs:1345`.
  - `hir_owner_nodes` goes through `hir_owner`, then `lower_to_hir` (`rustc_ast_lowering/src/lib.rs:703`). That
    runs `index_ast` (:587) and `resolve_type_relative_delegations`, then lowers each owner from
    `resolver_for_lowering`.
- `OwnerNodes` Debug is hand-written (`rustc_hir/src/hir.rs:1356`): node 0, the `parents` list, `bodies` (a
  SortedMap) and `opt_hash`. Everything else is derived Debug of HIR, plus the DefId, HirId and Span Debug impls
  that M2 already has.
- Lowering touches only a little of tcx: `features`, `sess`, `def_kind`, `local_parent`, `source_span`,
  `lang_items` (two rare paths: pin-drop sugar at item.rs:1039, async closure bounds at path.rs:604), and
  `hash_owner_nodes`.
- **`opt_hash` is `Some(Fingerprint)` for lib crates.** The chain is `needs_owner_info_hash` → `needs_hir_hash` →
  `needs_metadata` (context.rs:1132, 1175), so lib crates need HashStable over all of HIR.
  - Verified on the oracle: a `--crate-type lib` file prints `opt_hash: Some(Fingerprint(..))`, and a bin prints
    `None`.
  - About 1,041 of 20,463 non-aux tests/ui files are lib crates.
- `Hir(Normal)` adds `rustc_hir_pretty::print_crate` (`rustc_hir_pretty/src/lib.rs`, 2,751 lines).

### 1b. `-Zunpretty=thir-tree` and check builds need the whole `analysis`, so they need M4 code

`pretty::print` first calls `ex.tcx().ensure_ok().analysis(())` when `needs_analysis()` is true, and it is true for
ThirTree and ThirFlat. ThirTree (pretty.rs:321) then calls `rustc_hir_analysis::check_crate` and
`abort_if_errors()`, and prints `"{did:?}:\n{thir_tree(tcx, did)}\n"` for every `hir_body_owners()`.

`analysis` (`rustc_interface/src/passes.rs:1209`) runs `run_required_analyses` (:1100), in this order:

1. `hir_crate_items`, `commit_end_of_determinism`, `delegation::check_glob_and_list_delegations_target_expr`.
2. misc_checking_1:
   - `entry_fn`, `check_externally_implementable_items`, `proc_macro_decls_static`, `report_unused_deps`;
   - `exportable_items`, `stable_order_of_exportable_impls`;
   - per module: `check_mod_attrs` and `check_mod_unstable_api_usage`;
   - `limits`.
3. `emit_delayed_lints` (:1083).
4. **`rustc_hir_analysis::check_crate` (:1155)**, which is `rustc_hir_analysis/src/lib.rs:145`:
   - `check_type_wf`, which runs `check_well_formed` per owner (wfcheck.rs:2614 / :221);
   - `coherent_trait` per local trait impl, then the inherent-impl validity and overlap checks;
   - per body owner, `eval_static_initializer` / `eval_to_const_value_raw` for statics and consts. **This is const
     eval, so it needs MIR and the interpreter.**
   - per body owner, `typeck` (`rustc_hir_typeck/src/lib.rs:108` `typeck_with_inspect`);
   - `coroutine_by_move_body_def_id`;
   - if `#![feature(rustc_attrs)]` is on, the `#[rustc_dump_*]` dumps (collect/dump.rs, variance/dump.rs,
     outlives/dump.rs). 127 tests/ui files use these.
5. **MIR_borrow_checking (:1163)**, per body owner: `check_unsafety` (THIR), `mir_borrowck`, `check_transmutes`,
   `check_liveness` (MIR-based: `rustc_mir_transform/src/liveness.rs`), and `has_ffi_unwind_calls`.

`analysis` then stops on errors (:1222). If there are none, it runs misc_checking_3 (:1226):

- `effective_visibilities`;
- `check_private_in_public` and `check_mod_privacy` (rustc_privacy);
- `check_mod_deathness` (rustc_passes/dead.rs);
- **the late lints**, `rustc_lint::check_crate` (late.rs:462): builtin, types, unused, nonstandard_style, …;
- `clashing_extern_declarations`, `check_expectations`.

So:

- the oracle prints no thir-tree before `mir_borrowck` has run;
- the late lints run only after borrowck and only when there are no errors;
- unused-variable warnings come from MIR liveness;
- a `let x = 1;` body needs the `copy` lang item (MIR). The oracle reports `requires copy lang_item` for a tiny
  no_core crate whose thir-tree would otherwise print.

A plain `--emit=metadata` check therefore needs M4. **M3 is gated through probes that stop after typeck (D1).**

### 1c. Trait solver at the pin

- `NextSolverConfig::default()` (config.rs:1051) is `Globally` when rustc was built with
  `CFG_DEFAULT_NEXT_SOLVER_GLOBALLY` ("FIXME(#160895): Using -Znext-solver as default on nightly").
  - The oracle was built that way. Without flags it reports E0277 for
    `tests/ui/mismatched_types/closure-arg-type-mismatch-issue-45727.rs` (the `.next.stderr` shape), and with
    `-Znext-solver=no` it reports E0631.
  - The port already hard-codes this (`src/rustc_session/config.ts:1192`).
- `next_trait_solver_globally()` (context.rs:2819) still turns the next solver off under `-Zhigher-ranked-assumptions`
  and `#![feature(generic_const_exprs)]`.
- **compiletest always passes `-Znext-solver=coherence`** (`src/tools/compiletest/src/runtest.rs:1937`; our
  `harness/compiletest.ts:459` copies it). That means the old solver in typeck and the new solver in coherence.
  The `//@[next] compile-flags: -Znext-solver` revisions switch to the new solver everywhere.
- `<dyn TraitEngine>::new` (rustc_trait_selection/src/traits/engine.rs:44) chooses
  `solve::FulfillmentCtxt` or the old `FulfillmentContext` from `infcx.next_trait_solver()`.

### 1d. THIR

`thir_tree` (`rustc_mir_build/src/thir/print.rs:9`) calls `thir::cx::thir_body` directly (cx/mod.rs:17). It returns
`"error"` if `typeck_results.tainted_by_errors`.

- It needs `typeck`, `region_scope_tree` (rustc_hir_analysis check/region.rs; `temp_scope_id` and `region_scope`
  are printed), thir/cx/{expr,block,mod}, thir/pattern (PatKind lowering; `const_to_pat` needs const eval) and
  thir/constant.
- `check_match` and exhaustiveness (rustc_pattern_analysis) run from `mir_built`, which is M4.
- Shape verified on the oracle: the output prints types with Display (`ty: u8`), plus `HirId(DefId(0:4 ~ c[2cf7]::f).1)`
  and `LocalVarId(..)`.

## 2. Inventory (upstream lines; ★ = new crate for the port)

| crate | lines | M3 subset |
|---|---|---|
| ★rustc_ast_lowering | 14,341 | all: lib 3401, expr 2383(+closure 380), item 2134, delegation/* 2064, diagnostics 641 (generated), path 611, pat 560, format 556, asm 515, index 463, contract 360, stability 154, block 119 |
| rustc_hir | 8,236 | hir.rs 5311 (types → codegen Debug + HashStable; ~1.5k of fns), intravisit 1673, pat_util 144, target_impls, stable_hash_impls (def.rs is done) |
| ★rustc_hir_pretty | 2,751 | all (for `-Zunpretty=hir` and for diagnostics: `ty_to_string`, `qpath_to_string`) |
| rustc_middle | 66,059 | **ty/ 29,460, of which ~24k is needed**: print/pretty 3601 + print/mod 439, context.rs 2959 (interners, mk_*; 40/202 fns done), ty/mod 2435, sty 2206, util 1740, typeck_results 943, context/impl_interner 836, structural_impls 768, diagnostics 762, adt 760, generic_args 756, predicate 658, generics 623 (part done), closure 523, trait_def 385, fold 372, codec 354, list 342, assoc 342, error 341, normalize_erasing_regions 270, adjustment 254, visit 222, consts/* (int 664, kind, valtree 248, lit), region 154, opaque_types 216, pattern 122, erase_regions 98, inhabitedness/* ~700 (late). **Skip until M4/M6**: layout 1548, instance 1024 (except try_resolve for method calls), vtable, offload_meta, typetree, significant_drop_order. **Also needed**: hir/map 1497 + hir/mod 505, thir.rs 1131 + thir/visit 304, traits/{mod 1027, select 282, specialization_graph 271, query 215, solve 126}, middle/{region 358, lang_items 121, resolve_bound_vars 67, codegen_fn_attrs 308}, infer/canonical 210. Query engine growth: cycle errors (`rustc_query_impl/src/handle_cycle_error.rs` 430), `ensure_result`, `ensure_done`, more feeding. |
| rustc_type_ir | 19,308 (0.1% done) | ~17k: search_graph/* 1.75k, ty_kind 1419 (+closure 667), binder 1307, region_constraint 1240, solve/mod 1137, interner 778, predicate 774, inherent 749, fold 732, infer_ctxt 723, relate 652 (+solver_relating 366, combine 289), visit 627, flags 563, fast_reject 546 (partly done), elaborate 442, term_kind 382, canonical 317, const_kind 291, outlives 285, region_kind 252, walk 185, universe 172, ir_print 150 |
| ★rustc_next_trait_solver | 12,489 | all except coherence-only bits: eval_ctxt/mod 2068, trait_goals 1787, assembly/mod 1515, normalizes_to 1133, assembly/structural_traits 1071, canonical/* 1255, effect_goals 498, solve/mod 493, coherence 475, placeholder 342, the rest ~1.8k |
| ★rustc_infer | 13,343 | nearly all: infer/mod 1962, lexical_region_resolve 994(+89), region_constraints 879 (+leak_check 435), relate/* ~1.6k, canonical/* ~1.8k, outlives/* ~1.4k, type_variable 419, opaque_types ~550, snapshot/* ~610, at 448, context 544, traits/* ~830 |
| ★rustc_trait_selection | 51,011 | shared traits/*.rs 12,295 (minus auto_trait 915, outlives_for_liveness 578, vtable 447); solve/ 2,602; specialize 1,029; opaque_types, infer.rs; **old solver** traits/select 6,124 + traits/query 1,644 + project/fulfill/evaluate (in traits/*.rs); **error_reporting 24,274** (traits 13,974: suggestions 7379, fulfillment_errors 4136, ambiguity 933, mod 880, on_unimplemented 271, overflow 195, call_kind 180; infer 10,300: mod 2753, region 1545, need_type_info 1534, note_and_explain 1056, suggest 1035, nice_region_error/*); diagnostics.rs 2,107 (generated) |
| ★rustc_hir_analysis | 40,627 | all except EII bits: hir_ty_lowering/* ~9.2k (mod 3915, errors 2095, dyn_trait 1111, bounds 988, generics 710), collect* ~8k (resolve_bound_vars 2859, collect.rs 1854, clauses_of 1225, type_of 588+288, item_bounds 569, generics_of 546, dump 241), check/* ~10.9k (compare_impl_item 2874+476, wfcheck 2806, check 2394, region 870, intrinsic 828, mod 728, always_applicable 433, compare_eii 567), coherence/* ~3.2k, variance ~0.7k, outlives ~0.6k, impl_wf_check ~0.7k, delegation 773, diagnostics 2159 (generated) + wrong_number_of_generic_args 1188 |
| ★rustc_hir_typeck | 49,767 | core ~33k: fn_ctxt/{checks 3710, _impl 1666, mod 491, arg_matrix 411, inspect_obligations 323}, expr 3957, pat 3388, upvar 2758, method/{probe 2758, confirm 816, mod 579}, coercion 2237, expr_use_visitor 1884, op 1354, cast 1320, callee 1278, writeback 1097, closure 1083, lib 728, inline_asm 663, fallback 652, _match 564, loops 465, place_op 434, opaque_types, check, intrinsicck, gather_locals, naked_functions, typeck_root_ctxt, expectation, diverges, autoderef. **Diagnostics ~13k**: method/suggest 5035, fn_ctxt/suggestions 3956, demand 1350, fn_ctxt/adjust_fulfillment_errors 1205, diagnostics 1396 (generated), method/prelude_edition_lints 512 |
| ★rustc_mir_build | 23,079 | THIR only (~5.2k): thir/cx/{expr 1764, mod 226, block 107}, thir/pattern/{mod 723, const_to_pat 698, migration 233}, thir/print 1008, thir/constant 117, thir/util 47; the related diagnostics. builder/* and check_unsafety are M4. |
| ★rustc_ty_utils | 5,392 | assoc 364, ty 410, representability 124, implied_bounds 187, opaque_types 387, needs_drop 562, nested_bodies, common_traits, structural_match (~2.3k); layout/abi/instance are M4+ |
| ★rustc_passes | 9,190 | the prefix of `run_required_analyses`: check_attr 1583, stability 1395, lang_items 332, entry 144, check_export 407, eii 162, diagnostic_items 99, lib_features 123, weak_lang_items 61, delegation 25, upvars 96, diagnostics 1081 (generated). dead.rs, reachable and input_stats are M4. |
| rustc_lint | 26,057 (47%) | HIR lint levels (levels.rs, rest of `shallow_lint_levels_on`), `emit_node_span_lint` from typeck. The late passes (late 477, builtin 3175, types 1182, unused 1425, …) and rustc_privacy (2,008) run after borrowck → wave M4-0. |
| rustc_metadata | — | type decoding: `cached_ty_for_shorthand` (decoder.ts:847, unported), ty/codec.rs 354, TyDecodable codegen, `provide_extern` for type_of/generics_of/predicates_of/fn_sig/adt_def/associated_items/trait_def/impl_trait_header/inherent_impls/implementations_of_trait/variances/lang_items/diagnostic_items (the M3 `unported(…)`s in rustc_metadata, e.g. `get_adt_def`, `get_associated_item`, `VariantData`) |
| rustc_data_structures + vendor | — | vendor `ena` 0.14.4 (union-find + snapshot_vec), `itertools` 0.15 / `either` 1.15 (as used); obligation_forest 832 (old solver), sso 797, snapshot_map 143, graph subset (lexical region graph, scc for coherence), unord 796, transitive_relation; rustc_index interval/bit_set rest |

Total ≈ 250k upstream lines (~85 lanes). For comparison, M2 was ≈ 100k.

## 3. Hard blockers and design decisions

**D1. Gate typeck through probes, not the real `--emit=metadata` / thir-tree (§1b).**
- Recommended: two rustc-dev probes, both built on the resdump pattern (`Callbacks::after_expansion` → `Stop`).
  - `tydump` runs `run_required_analyses` from passes.rs:1100 to :1155 verbatim (the probe header copies the
    lines), then `rustc_hir_analysis::check_crate`. It then prints per-item type facts (§6) sorted by DefPath, and
    the diagnostics go to stderr as usual.
  - `thirdump` runs the same prefix, then `abort_if_errors`, then prints exactly the pretty.rs:321 loop.
- The port mirrors them in `src/rust_ts/{tydump,thirdump}.ts`.
- Real `-Zunpretty=thir-tree` and `--emit=metadata` stderr become gates at M4.
- **D1a (const eval).** check_crate's static/const arm (lib.rs:166–184) needs CTFE. Recommended: both probes omit
  that arm, and the probe header documents it. Each side then runs the same defined sequence, as with resdump. Real
  diagnostics from const eval come back at M4/M6. Array lengths and const args that need evaluation stay
  `unported` (UNPORTED, not a DIFF).

**D2. Ty / Region / Const / interned lists are hash-consed objects, not numbers.**
- Recommended: an amendment to PORTING §5 "Interned handles".
  - `Ty`, `Region`, `Const`, `Predicate`/`Clause`, `List<T>` (`GenericArgs`, `&List<Ty>`, bound-var lists,
    `PolyExistentialPredicates`) and `ValTree` are frozen class instances, unique per value.
  - Equality is `===`. `Map`/`Set` key on the object. Methods live on the prototype (`ty.kind()`), so no companion
    functions are needed.
  - Each instance carries a sequential `id: number` that is used only for the intern keys.
- Interning is `Map<string, T>` per kind. The key is the variant tag plus the child ids and leaf numbers, e.g.
  `"Adt|<adtid>|<argsid>"`.
- `WithCachedTypeInfo` fields (`flags`, `outer_exclusive_binder`) are fields on the object. The stable hash is
  computed lazily, only when HashStable needs it.
- Upstream `Interned` has pointer Eq/Hash and **no Ord** (rustc_data_structures/src/intern.rs). So object identity is
  exactly as faithful as numbers, and `ty.kind()` reads better than `Ty_kind(tcx, ty)`.
- `CtxtInterners` hang off the GlobalCtxt (one per process). `CommonTypes`, `CommonLifetimes` and `CommonConsts`
  are prefilled.

**D3. `TyKind` and the other `rustc_type_ir` enums follow PORTING §5 enums.**
- `{ $: "Adt", _0, _1 }`. Unit variants (`Bool`, `Char`, `Str`, `Never`, `ReStatic`, `ReErased`) are frozen
  singletons.
- The types are generated from `rustc_type_ir` by the typedefs/codegen pipeline, with `I: Interner` erased.
- `GenericArg` is `Ty | Region | Const` (instanceof dispatch). `GenericArgKind` is built on demand by `.kind()`.
- `Binder<T>` is a plain `{ value, bound_vars }` object (not interned, as upstream). `DebruijnIndex`, `BoundVar`,
  `UniverseIndex` and `TyVid`/`IntVid`/`FloatVid`/`RegionVid` are `newtype_index` numbers.
- `I: Interner` / `D: SolverDelegate` become TS interfaces. TyCtxt implements `Interner` (impl_interner.rs). The
  inherent traits (type_ir/inherent.rs) become methods on the middle classes.

**D4. TypeFoldable / TypeVisitable / Lift / TyDecodable / HashStable come from codegen, and generic code takes
descriptors.**
- Generate `fold_<T>` / `visit_<T>` from `derive(TypeFoldable[_Generic], TypeVisitable[_Generic])`, honouring
  `#[type_foldable(identity)]` and `#[type_visitable(ignore)]`. Hand-port the `super_fold_with` impls
  (structural_impls.rs, sty.rs).
- Generic fns such as `resolve_vars_if_possible<T: TypeFoldable>` take a `Foldable<T>` descriptor parameter
  (PORTING: "pass function tables"), with a `// PORT:` note.
- Rejected: a runtime structural walker. It would visit ignored fields and depends on JS key order.
- `Lift` is skipped (PORTING §3). TyDecodable extends the M2 Decodable codegen.

**D5. DefId as a map key.** M3 keys thousands of maps on DefId (`DefIdMap`/`DefIdSet`, intern keys).
- Recommended: `DefIdMap<V>`/`DefIdSet` classes in rustc_span, keyed on `krate * 2^32 + index` (< 2^53). Keep the
  `DefId` class and `DefId_eq`, so M1/M2 code doesn't churn. Do the same for HirId (`owner`, `local_id`).
- Composite non-interned keys (`ParamEnvAnd<..>`, `CanonicalInput`, `(Ty, Ty)`) get generated `key_<T>(v): string`
  over the interned ids.

**D6. Hash-map order.**
- Upstream iterates interned-pointer-keyed maps only behind `#[allow(rustc::potential_query_instability)]`:
  - 0 sites in hir_analysis / hir_typeck;
  - 9 in type_ir (search_graph, generic_visit);
  - 2 in next_trait_solver (canonicalizer.rs:164, :184);
  - 2 in trait_selection;
  - 1 in infer (lexical_region_resolve:768);
  - 4 in middle.
- Those orders are nondeterministic in the oracle too, so insertion order is acceptable. Any output that depends on
  them is a flake candidate, and the fixer records it.
- FxHashMap/FxHashSet with deterministic keys (DefId, Symbol, HirId, integers) that are iterated keep the
  hashbrown-order emulation from M2. `UnordMap`/`ItemLocalMap` are only read through `items_in_stable_order` /
  `to_sorted`, so they need nothing.

**D7. Type printing is byte-exact and ported whole.**
- ty/print/pretty.rs and mod.rs, `FmtPrinter`, `def_path_str`, `type_length_limit` truncation, closure/coroutine
  `{closure@file:l:c: l:c}`, region highlighting, `-Zverbose-internals`.
- The thread-locals (pretty.rs:33–120: `NO_TRIMMED_PATH`, `FORCE_TRIMMED_PATH`, `REDUCED_QUERIES`,
  `FORCE_IMPL_FILENAME_LINE`, `SHOULD_PREFIX_WITH_CRATE[_NAME]`, …) become module-level `let`s, and the
  `with_*` guards restore them in `finally` (PORTING global state).
- `trimmed_def_paths` (pretty.rs:3528) is ported with `for_each_def` (:3448) over **all** crates' module children.
  `Session::record_trimmed_def_paths` (session.rs:675) is ported with the `must_produce_diag` ICE in rustc_errors.
- Ty Debug is Display under `with_no_trimmed_paths`. That puts the printer on the critical path of every dump, so
  it lands in wave 15, before typeck.

**D8. Region inference.**
- typeck does not solve regions (it erases them in writeback). Lexical region resolution
  (rustc_infer/lexical_region_resolve) and implied bounds are still needed: wfcheck and compare_impl_item run
  `resolve_regions_and_report_errors`.
- Recommended: port lexical_region_resolve, outlives/*, free_regions and leak_check in M3 (rustc_infer lanes). NLL
  is M4.

**D9. Both trait solvers, the next solver first.**
- Plain invocations (the hir/tydump/thirdump nocore and std corpora, cargo-style use, M5's core/std check) use the
  next solver globally.
- The ui suites with compiletest argv use the old solver in typeck.
- Recommended order:
  1. next solver, shared traits/ and solve/ (waves 16–17);
  2. old solver (select, project, fulfill, evaluate, query type-ops, obligation_forest; ~10k) in wave 20, needed
     only by gate M3.
- Keep compiletest's `-Znext-solver=coherence` in the ui suites. Then the blessed `.stderr` files mostly equal the
  oracle output, which is a free cross-check. The 490 tests/ui/traits files that mention `-Znext-solver` still
  exercise the next solver.

**D10. Error reporting is ported fully, but late.**
- That is about 24k lines in trait_selection, ~13k in hir_typeck and ~5k in hir_analysis.
- Until it is ported, the report entry points (`report_fulfillment_errors`, `TypeErrCtxt::report_*`,
  `FnCtxt::report_method_error`, the suggestion fns) are `unported(...)`, so error tests report UNPORTED.
- 230 of the 250 ui/typeck tests have a `.stderr`, so gate M3 needs all of it (wave 19). Diagnostics derive is
  already generated (codegen-diag).

**D11. Corpus for "std-free" typeck.**
- tests/ui compiled with `-Zcrate-attr=no_core` hits `requires \`sized\` lang_item` almost at once. That is
  `emit_fatal` in `require_lang_item` (rustc_middle/src/middle/lang_items.rs:20). Verified on the oracle:
  typeck/issue-10401.rs gives 1 fatal error.
- So the nocore corpus is only a broad smoke test (collect, lang items, check_attr, the error-recovery paths).
- Real no_core typeck coverage comes from:
  - (a) cg_clif `example/mini_core.rs` (845 lines) as a lib crate, and `mini_core_hello_world.rs` (631) with
    `--extern mini_core=<oracle-built rmeta>`. Verified: the oracle checks both cleanly, and mini_core's real
    thir-tree is 12,028 lines.
  - (b) the ~290 tests/ui files that are natively `#![no_core]`;
  - (c) the 182 `//@ add-minicore` tests. compiletest builds `tests/auxiliary/minicore.rs` as an rlib with
    `-Cpanic=abort` and passes `--extern minicore=` (runtest.rs:1341–1380).
- Recommended:
  - add `tests/auxiliary` to the sparse checkout (UPSTREAM.json `sparse`; this is a scripts batch);
  - build minicore and mini_core with the oracle into the per-run scratch dir, reusing M2 decision 5 (aux by the
    oracle);
  - `harness/compiletest.ts:409` stops rejecting `add-minicore`.
- Caveats: the 106 minicore tests that cross-compile need those targets' specs, and object formats other than ELF
  report UNPORTED.
- `-Zcrate-attr` cannot inject `use minicore::*`, so rewriting general tests/ui files against minicore is rejected.

**D12. Query system growth; the dep graph stays off.**
- Keep the hand-written engine from tyctxt-min and add:
  - `ensure_result`/`ensure_done`;
  - cycle detection with the real cycle diagnostics (handle_cycle_error.rs; cycles in `type_of`/`predicates_of`
    are common ui output);
  - feeding (`feed_anon_const_type`, `TyCtxtFeed` for synthetic DefIds);
  - `Steal`;
  - arena-cached query values.
- Still out of scope: no incremental, no on-disk cache, no dep-node hashing (except `hash_owner_nodes` for D13).
  Query declarations are regenerated (`bun tools/codegen/queries.ts`). The 195 unknown types and 161 value types
  without Debug get filled as the type lanes land.

**D13. HashStable for HIR (lib crates' `opt_hash`).** Generated by codegen (the M2 D2 mechanism), with
`StableHashingContext` span hashing and `hash_owner_nodes`. The probe check is hir-tree on lib crates itself.

## 4. Suites and gates

| suite | cases | oracle / subject | milestone |
|---|---|---|---|
| `hir-tree-nocore` | all tests/ui (`nocoreArgs`, same 3 skips) + `-Zunpretty=hir-tree` | rustc / main.ts | M3a |
| `hir-tree` | all tests/ui with std (`stdArgs`) + `-Zunpretty=hir-tree` | rustc / main.ts | M3a |
| `unpretty-hir` | as hir-tree with `-Zunpretty=hir` | rustc / main.ts | M3a (report) |
| `tydump-nocore` | as resdump-nocore, through `tydump` | probe / tydump.ts | M3b |
| `tydump-minicore` | mini_core.rs (lib), mini_core_hello_world.rs (`--extern`), native `#![no_core]` tests and `add-minicore` tests with compiletest flags (target, revisions, edition; aux by the oracle) | probe / tydump.ts | M3b |
| `thirdump-minicore` | the same cases through `thirdump` | probe / thirdump.ts | M3b |
| `tydump` | all tests/ui with std (smoke; most stop at errors that are not yet ported) | probe / tydump.ts | M3 (report) |
| `tydump-ui` | ui/typeck (250) + ui/traits (1277) + the 127 `#[rustc_dump_*]` tests, compiletest argv (`-Znext-solver=coherence`, revisions, aux by the oracle) | probe / tydump.ts | M3 |
| `thirdump-ui` | the same through `thirdump` + tests/ui/thir-print | probe / thirdump.ts | M3 |

Plausible shares:

- hir-tree-nocore ≥ 97%: expanded-nocore is already 99.76%, and lowering is deterministic.
- hir-tree with std ≥ 95%.
- tydump-nocore ≥ 95%: most cases end at the first fatal `require_lang_item`.
- tydump-minicore and thirdump-minicore 70–85%: limited by const eval, layout (`repr(transparent)`/packed checks),
  inline asm, non-ELF targets.
- tydump-ui 60–75% after wave 19 and ≥ 85% after wave 20. The ceiling is const eval (D1a).

Gates:

- **M3a**: hir-tree-nocore + hir-tree protected, ≥ 95%.
- **M3b**: tydump-nocore ≥ 95%; tydump-minicore + thirdump-minicore ≥ 80%, and mini_core.rs and
  mini_core_hello_world.rs MATCH on both.
- **M3**: tydump-ui + thirdump-ui ≥ 85% on ui/typeck + ui/traits, and the `rustc_dump_*` subset ≥ 90%.
- Report only: for tydump-ui cases where the oracle's tydump stderr equals its full compiletest stderr, also compare
  with the blessed `.stderr`.

## 5. Waves (lanes ≤ ~3k upstream lines; ✱ = contract-first lane that must merge before its dependants)

**Wave 13: foundations and contracts (parallel)**
- ✱`lowering-contract`: a `decls.ts` for `LoweringContext` (its methods span 12 files), as parser-core did.
- `hir-types`: codegen of hir.rs types + Debug (OwnerNodes by hand) + HashStable.
- `hir-visit`: intravisit, pat_util, the hir.rs fns.
- ✱`ty-contract`: D2–D5 skeleton. Interners, the `Ty`/`Region`/`Const`/`List`/`GenericArg` classes,
  `DefIdMap`/`HirIdMap`, the `Foldable` descriptor, the `Interner` interface. Records a PORTING §5 amendment for
  root.
- `codegen-tyir`: type_ir + middle ty types/Debug through typedefs, plus the TypeFoldable/TypeVisitable generator.
- `vendor-ena`: ena 0.14.4, snapshot_map, sso, undo_log, unify.
- `harness-w13`: the hir-tree-nocore, hir-tree and unpretty-hir suites; UPSTREAM sparse `tests/auxiliary`.
- `probe-tydump`: the tydump + thirdump probes and the suites from §4 (unprotected), plus the probe headers that
  document D1/D1a.

**Wave 14: lowering (→ gate M3a) + rustc_type_ir.**
- Lowering lanes:
  - lower-lib-a/-b (lib.rs split at ~1700);
  - lower-item;
  - lower-expr (+closure);
  - lower-pat-path-block;
  - lower-asm-format-contract;
  - lower-delegation;
  - lower-index-diag (index, stability, diagnostics generated);
  - middle-hir (hir/map, hir/mod);
  - hir-pretty-a/-b.
- Type-IR lanes:
  - tyir-kind (ty_kind + closure, flags, region_kind, const_kind, term_kind);
  - tyir-binder (binder, fold, visit, walk, generic_visit);
  - tyir-relate (relate, solver_relating, combine, elaborate, outlives);
  - tyir-misc (interner→interface, inherent, predicate(_kind), canonical, infer_ctxt, universe, ir_print, rest of
    fast_reject).
  - tyir-solve (solve/mod, solve/inspect, search_graph/* ~3k).

**Wave 15: rustc_middle::ty and metadata types.**
- ty-ctxt (context.rs interning/`mk_*` + impl_interner);
- ty-mod-a/-b;
- ty-sty;
- ty-args (generic_args, list, predicate, generics rest);
- ty-util;
- ty-adt-assoc (adt, assoc, trait_def, closure);
- ty-print-a/-b (pretty.rs split at ~1800, print/mod, trimmed paths, must_produce_diag);
- ty-results (typeck_results, adjustment, structural_impls, fold, visit, error, diagnostics, consts/*);
- middle-traits-thir (traits/*, thir.rs, thir/visit, middle/region, lang_items);
- rmeta-ty (codec.rs, `cached_ty_for_shorthand`, TyDecodable codegen, extern providers; `rmetatydump` probe);
- passes-a (lang_items, entry, diagnostic_items, lib/weak features, check_export, eii, delegation);
- passes-b (check_attr, stability);
- query-growth (D12).

**Wave 16: inference, next solver, collect.**
- rustc_infer:
  - ✱`infcx-contract` (InferCtxt + `InferCtxtExt` extension traits across infer and trait_selection);
  - infer-core (mod, context, at, resolve, freshen, type_variable, unify_key);
  - infer-relate;
  - infer-regions (region_constraints, leak_check, lexical_region_resolve);
  - infer-canonical-outlives;
  - infer-opaque-snapshot.
- rustc_next_trait_solver:
  - ✱`evalctxt-contract`;
  - nts-eval (eval_ctxt/*);
  - nts-assembly (assembly/*);
  - nts-trait-goals;
  - nts-normalizes (normalizes_to, project_goals/*, effect_goals);
  - nts-canonical (canonical/*, placeholder, coherence, delegate).
- rustc_hir_analysis collect:
  - ✱`hirtylowerer-contract`;
  - collect-a (collect.rs, generics_of, type_of(+opaque));
  - collect-b (clauses_of, item_bounds, dump);
  - collect-rbv (resolve_bound_vars);
  - hir-ty-lowering-a/-b (mod.rs split);
  - hir-ty-lowering-c (bounds, generics, dyn_trait).
- ty-utils.

**Wave 17: shared trait machinery and checking.**
- trait-sel-solve (solve/*, delegate, fulfill(+derive_errors), inspect/analyse);
- trait-sel-traits-a (mod, engine, normalize, util, misc, structural_normalize);
- trait-sel-traits-b (wf, dyn_compatibility, coherence, effects, specialize, const_evaluatable, implied_outlives_bounds);
- check-wf-a/-b (wfcheck split);
- check-check (check.rs, mod.rs);
- check-compare (compare_impl_item + refine);
- check-region-intrinsic (region.rs, intrinsic, always_applicable);
- coherence (coherence/*);
- variance-outlives-implwf (+delegation);
- lint-levels-hir.

**Wave 18: typeck and THIR (→ gate M3b).**
- ✱`fnctxt-contract` (FnCtxt and its methods across ~25 files);
- typeck-lib (lib, typeck_root_ctxt, check, gather_locals, writeback, fallback, diverges, expectation);
- typeck-checks (fn_ctxt/checks, arg_matrix, inspect_obligations);
- typeck-impl (fn_ctxt/_impl, mod);
- typeck-expr-a/-b;
- typeck-pat;
- typeck-coerce-callee (coercion, callee, autoderef, place_op);
- typeck-method (probe, confirm, mod);
- typeck-closure-upvar (closure, upvar);
- typeck-euv (expr_use_visitor, op, cast);
- typeck-misc (_match, loops, inline_asm, intrinsicck, naked_functions, opaque_types);
- thir-cx (cx/*, constant, util);
- thir-pattern;
- thir-print.

**Wave 19: error reporting.**
- ✱`errctxt-contract` (TypeErrCtxt across error_reporting/*);
- err-traits-a/-b/-c (fulfillment_errors, ambiguity, mod, on_unimplemented, overflow, call_kind);
- err-sugg-a/-b/-c (suggestions.rs split);
- err-infer-a (infer/mod);
- err-infer-b (need_type_info, note_and_explain, suggest);
- err-region (region, nice_region_error/*);
- typeck-diag-a/-b (method/suggest);
- typeck-diag-c/-d (fn_ctxt/suggestions);
- typeck-diag-e (demand, adjust_fulfillment_errors, prelude_edition_lints);
- hta-errors (hir_ty_lowering/errors, wrong_number_of_generic_args).

**Wave 20: old solver and ui (→ gate M3).**
- ✱`selcx-contract`;
- old-select-a/-b (select/mod split);
- old-candidates-confirm;
- old-project-fulfill (project, fulfill, obligation_forest, evaluate);
- old-query-typeops (traits/query/*);
- harness-w20 (tydump-ui and thirdump-ui with compiletest argv and aux);
- fixer lanes per failing file.

**About 8 waves (13–20) and about 95 lanes.**

- M3a can gate after wave 14, while the type lanes keep running.
- M3b gates after wave 18.
- M3 gates after wave 20.
- Wave 21 (M4-0, outside M3) is the late lints, rustc_privacy, dead.rs and MIR liveness.

## 6. Risks and probes

- **Probes** (rustc-dev, sorted and deterministic, comparable the way resdump is):
  - `tydump` (D1). For every local DefId in DefPath order it prints:
    - `def_kind`, `generics_of`, `type_of`, `fn_sig`, `predicates_of` / `explicit_predicates_of`,
      `explicit_item_bounds`, `impl_trait_header`, `variances_of`, `inferred_outlives_of`, adt variants/field
      types, `associated_items`;
    - per body: `typeck_results` (`node_types`, `node_args`, `adjustments`, `pat_binding_modes`,
      `closure_min_captures`, `coercion_casts`, `tainted_by_errors`) via `items_in_stable_order`.
    - Everything prints with `{:?}` under `with_no_trimmed_paths`, after the D1 prefix, with the diagnostics on
      stderr. `phase-diff` gains the stages lowering → collect → typeck by section.
  - `thirdump` (D1).
  - `rmetatydump`: for every DefIndex of the sysroot crates (core/alloc/std, chunked as the M2 `rmeta` suite), the
    decoded `type_of`/`fn_sig`/`generics_of`/`predicates_of`/`adt_def` printed Display and Debug. This tests the
    type decoder and the printer before typeck exists.
  - `printdump`: every local item's type through `FmtPrinter` with trimmed paths on and off. This checks the
    printer and `trimmed_def_paths` alone.
- **Risks**:
  - Size: 2.5x M2. hir_typeck and error reporting are about half of it.
  - Performance: interning cost; trimmed paths over all of std per diagnostic run (one `for_each_def` per process);
    a solver search graph without native speed. Measure on mini_core and on the 60 s per-case timeout.
  - Const eval reaches into typeck through array lengths, const generics and `const_to_pat`. These are UNPORTED
    until M4/M6, and that caps the shares above.
  - `generic_const_exprs` and `-Zhigher-ranked-assumptions` switch the solver (context.rs:2819). Tests with those
    features exercise both.
  - Layout queries reached from check.rs (`repr(transparent)`, packed, enum discriminants) need rustc_abi/ty
    layout (M4).
  - Cross-target minicore tests need more target specs, and non-ELF object reading.
  - Hash-order flakes (D6). The harness should run a flaky case twice before root records a DIFF.
  - Old and new solver both stay live, so they double the surface that has to stay byte-exact.

Critical files: rustc_interface/src/passes.rs (1083–1155), rustc_ast_lowering/src/lib.rs, rustc_middle/src/ty/{context,
print/pretty}.rs, rustc_hir_analysis/src/lib.rs, rustc_hir_typeck/src/lib.rs, rustc_trait_selection/src/traits/engine.rs,
rustc_next_trait_solver/src/solve/eval_ctxt/mod.rs, rustc_mir_build/src/thir/{cx/mod,print}.rs, harness/suites.ts.
