# Handoff: small-gaps-19 (M3, wave 19): non-error-reporting stops on the tydump path

Branch `lane/small-gaps-19`, based on integ 5602fa2b. No baselines, oracle outputs, suites, `harness/`, `scripts/` or
`UPSTREAM.json` touched; nothing in `rustc_trait_selection/src/error_reporting/**` / `TypeErrCtxt` / `err_ctxt`.
**Root: this lane changed tools/codegen configs (no generator code); see "tools/ changes".**

## Results (`RUST_TS_AGENT=small-gaps-19`; MATCH / DIFF / UNPORTED, no CRASH / TIMEOUT)
| suite | before | after | run (after) |
|---|---|---|---|
| tydump-minicore (46) | 21 / 0 / 25 | 21 / 0 / 25 (stops moved, see below) | 20261015-132155-small-gaps-19-7ek5 |
| thirdump-minicore (46) | 21 / 0 / 25 | 21 / 0 / 25 | 20261015-132206-small-gaps-19-e8ii |
| tydump-nocore `--sample 300 --seed m17` | 287 / 0 / 13 | **289 / 0 / 11** | 20261015-132217-small-gaps-19-wulq |
| tydump-nocore `--sample 2000 --seed sg19` | (before run invalid: sources edited mid-run) | 1933 / 0 / 67 | 20261015-132615-small-gaps-19-ucv5 |
| tydump-nocore `--filter tests/ui/proc-macro` (379) | 282 / 0 / 97 | 284 / 0 / 95 | 20261015-124127-small-gaps-19-hlyz |
| hir-tree-nocore `--sample 300 --seed m17` | 300 / 0 / 0 | 300 / 0 / 0 | 20261015-132313-small-gaps-19-f8p4 |
| expanded `--sample 300 --seed sg19` | 300 / 0 / 0 | 300 / 0 / 0 | 20261015-132408-small-gaps-19-z1us |
| unpretty-hir `--sample 300 --seed sg19` | 300 / 0 / 0 | 300 / 0 / 0 | 20261015-132507-small-gaps-19-pcde |

**Protected-suite gain:** `tests/ui/suggestions/multi-suggestion.rs` now MATCHes in `expanded` and `unpretty-hir` (was
UNPORTED at `Decodable for VariantData`, then at the `SimplifiedType` filter of rustc_resolve's `Default` suggestion).

Minicore: `mini_core.rs` passes `mk_pat` and `expand_abstract_consts` and now stops at the **`layout_of` provider (M4)**,
reached from `coherence::builtin::visit_implementation_of_dispatch_from_dyn` (the 1-ZST field check). So mini_core.rs cannot
MATCH before M4's `layout_of`. `mini_core_hello_world.rs` stops at `const_eval_poly` (M4).

## Fixes (one commit each, in order)
1. `CrateMetadata::get_variant` / `get_adt_def` (decoder.rs:1135/1179) ported; `Decodable VariantData` generated (set
   `rustc_metadata_rmeta`), `VariantIdx` newtype helpers on the decls.ts stand-in (`VariantIdx.from_u32`), rmeta `VariantData`
   / `repr_options` typed. rustc_resolve late/diagnostics.ts: the `SimplifiedType::Adt(did)` filter of the Default
   suggestion (was `unported`); `implementations_of_trait` / `incoherent_impls` / `crate_incoherent_impls` now typed with
   `SimplifiedType` (typemap.middle.json; queries.gen.ts regenerated, `incoherent_impls` desc now generated).
2. `QueryKey for PseudoCanonicalInput<T>` (keys.rs:306) as `pseudo_canonical_input_key(KEY_T)`; instances for `Ty`,
   `GenericArg`, `TraitRef` (queries.config.json keys; typemap entry for `PseudoCanonicalInput<$0>`). `layout_of` / `is_*_raw` /
   `needs_drop_raw` / ... now reach their providers.
3. `Relate for &List<PolyExistentialPredicate>` (rustc_middle relate.rs:56; kept beside the other rustc_middle relate
   stand-ins in rustc_type_ir/relate.ts, now with a marker). coercion.test.ts `ref_to_dyn` now `true` (= oracle).
4. (iteration) rustc_ty_utils `common_traits.rs` 9/9 (`is_copy_raw` ... `is_async_drop_raw`, wired in lib.ts `provide`).
   coherence.test.ts `orphan_local_auto.rs` now prints the oracle's stderr (moved to NOW_EXACT).
5. rustc_middle `ty/pattern.rs` 7/7 (new `src/rustc_middle/ty/pattern.ts`): interned `Pattern` class (Flags, Debug,
   `IrPrint<PatternKind>` registered in `IR_PRINT`, IntoKind), `TyCtxt::mk_pat`, `Relate for Pattern` (relate.rs:23). Removed
   the stand-ins in structural_impls.ts, rustc_type_ir flags.ts (`add_ty_pat`), walk.ts, ty_kind.ts (TyKind Debug `Pat`),
   print/pretty.ts, hir_analysis variance/constraints.ts, coherence/builtin.ts (`display_Pattern`), trait_selection wf.ts.
6. `LateContext::data_layout` (rustc_lint context.rs:941) returns `tcx.gcx.data_layout`.
7. (iteration) `TyCtxt::expand_abstract_consts` (ty/abstract_const.rs:37, the `Expander` folder).
8. (iteration) crate-metadata `ConstKind::Value`: `derive(TyDecodable) for ty::Value` generated (valtree.rs joins the
   `rustc_middle` derive set), `ScalarInt` / `Value` / `ValTree` serialize.json entries; codec.ts `decode_Value` reaches the
   generated decoder lazily (init order: decodable.gen.ts imports the extension module ty/trait_def.ts — a direct import from
   const_kind.gen.ts crashed every case with "Cannot access 'TyCtxt' before initialization").
9. (iteration) `IntoDiagArg for check_attr::ProcMacroKind` in `ProcMacroBadSig` (diag_args.json + typemap.passes.json).
10. (iteration) `Decodable IntrinsicDef` generated (intrinsic.rs joins the `rustc_middle` set) for `intrinsic_raw`.
11. (iteration) upvar.ts `fold_Place` uses the generated `hir::place::Place` folds (hir/place.gen.ts) instead of `unported`.

## Not done
- **Item 6, `CapturedPlace` TypeFoldable/TypeVisitable: blocked.** `compiler/rustc_middle/src/ty/closure.rs` cannot be
  parsed by the typedefs probe (syn): `gen move { .. }` block at closure.rs:460 (`analyze_coroutine_closure_captures`). A
  codegen set for closure.rs fails (`typedefs probe failed`); I added one by mistake in commit 50e57468 and removed it in
  65d64e3c. Needs a root decision: e.g. make tools/probes/typedefs tolerate `gen` blocks (strip fn bodies before
  `syn::parse_file`), or a recorded exception to hand-write this one derive. writeback.ts's stand-in stays; 1/2000 nocore
  case reaches it (`contracts/contract-const-fn.rs`), more with std/closures.
- Item 7, `thir_abstract_const` provider (rustc_ty_utils consts.rs, 403 lines: `recurse_build` over THIR, the
  `IsThirPolymorphic` visitor, `GenericConstantTooComplex` diagnostics): not small; only `generic_const_exprs` reaches it
  (3/2000). Left.
- `Decodable for DenseBitSet<u32>` (`params_in_repr`, 1/2000): rustc_index has no codegen set, and the derive's
  `Box<[Word]>` (`u64` -> `bigint` words in bit_set.ts) would need a `u64`-as-bigint decode entry. Left.

## Remaining stops (tydump-nocore `--sample 2000 --seed sg19`, ranked)
1. 19 `const_eval_poly` (M4), 18 `const_eval_resolve_for_typeck` (M4)
2. 10 `InferCtxt::err_ctxt` (errctxt-contract / wave 19), 2 `NextTypeParamName::next_type_param_name` (error reporting)
3. 4 `suggest_assoc_method_call`, 4 `method::suggest::all_traits` (suggest.rs, wave 19 lane; `all_traits` is reached from
   probe.rs `assemble_extension_candidates_for_all_traits` when a method is not found, i.e. an error path; 41 of the 379
   proc-macro tests stop there)
4. 3 `thir_abstract_const` provider (above), 3 `layout_of` provider (M4), 2 `BangProcMacro::expand` (M6)
5. 1 `CapturedPlace` TypeVisitable (blocked, above), 1 `DenseBitSet<u32>` decode (above)
Minicore (25): 13 `err_ctxt`, 4 `adjust_fulfillment_error_for_expr_obligation`, 2 `suggest_assoc_method_call`, 2 + 1
`layout_of` (M4; incl. mini_core.rs), 1 `const_eval_poly` (M4), 1 `TypeErrCtxt (FnCtxt::err_ctxt)`, 1 `all_traits`.
**Only owned (wave 19 error reporting / suggest.rs), M4, M6 or the two blocked/large items remain.**

## tools/ changes (root: please review)
- `types.sets.json`: `rustc_metadata_rmeta` decodes `VariantData`; `rustc_middle` gains files `ty/consts/valtree.rs`,
  `ty/intrinsic.rs` and decodable types `Value`, `IntrinsicDef`.
- `serialize.json`: `rustc_abi::VariantIdx` (`VariantIdx.from_u32($D.read_u32())`, decls.ts stand-in), `rustc_middle::ty::VariantDiscr`,
  `ScalarInt`, `Value` (via codec.ts), `consts::valtree::ValTree` path added to the `I::ValTree` entry.
- `typemap.middle.json`: `rustc_middle::ty::fast_reject::SimplifiedType`, `rustc_middle::ty::PseudoCanonicalInput`.
- `queries.config.json`: keys `PseudoCanonicalInput_{Ty,GenericArg,TraitRef}`.
- `diag_args.json`: `rustc_passes::check_attr::ProcMacroKind`; `typemap.passes.json`: its TS type (was `unknown`).
- Every type set regenerates with no diff beyond the committed files; `queries.ts --check` up to date.

## Edits outside the ported files (small, noted)
- `rustc_middle/ty/decls.ts`: `VariantIdx` companion (`newtype_index`), `Pattern` re-exported from pattern.ts.
- `rustc_middle/ty/codec.ts`: lazy `decode_Value` adapter. `rustc_metadata/rmeta/mod.ts`: `VariantData`, `repr_options`,
  `intrinsic` field types.
- `rustc_hir_analysis/coherence/builtin.ts`: only `display_Pattern` now imported from pattern.ts (its header comment line
  "`ty::Pattern` is pending ... `Display` is a stand-in too" is now stale; left to avoid a conflict with errctxt-contract,
  which edits that header's `TypeErrCtxt` sentence).
- Tests re-pinned (no matching assertion weakened): coercion.test.ts `ref_to_dyn` -> `true` (oracle-checked);
  check.oracle.test.ts `abi_cmse_fn_ptr` -> `layout_of provider (not ported)`; coherence.test.ts `orphan_local_auto.rs` ->
  NOW_EXACT (its PENDING text removed); upvar.test.ts InferBorrowKind now asserts the recorded upvar capture and that
  `normalize` gets the generated Place fold descriptor (was: the stop); ty/contract.test.ts drops the
  `expand_abstract_consts` stub assertion (no `TyCtxt` stub is left; the `inhabited_predicate` stub assertion remains);
  tools/codegen/type_fold.test.ts `missing_decodable` loses `I::ScalarInt` / `I::ValueConst` (now provided).

## Checks
- `bunx tsc --noEmit -p .` clean; `bun scripts/coverage.ts --check`: markers ok (16396; vendor 3888).
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools --timeout=120000` (at 8865869c): 5274 pass / 3 fail — the three re-pins
  above (upvar, contract, type_fold), fixed in the last commit; the three files re-run: 25 pass / 0 fail. **0 failing tests.**
- Coverage: ty/pattern.rs 7/7, ty_utils common_traits.rs 9/9, rmeta decoder.rs 156/156, rustc_lint context.rs 58/58,
  ty/abstract_const.rs 4/5 (the `From<ErrorGuaranteed> for NotConstEvaluatable` impl stays: the type is pending),
  ty/relate.rs 2/7 (the other impls remain stand-ins in rustc_type_ir/relate.ts), query/keys.rs 47/63.

## unported(...) left / added
- None added. Removed: `get_adt_def`, `get_variant`, `decode_VariantData`, the resolve `SimplifiedType` filter,
  `PseudoCanonicalInput` key_unported (3 keys), `Relate for &List<PolyExistentialPredicate>`, `Relate for Pattern`,
  `mk_pat`, 7 Pattern stand-ins, `LateContext::data_layout`, `expand_abstract_consts`, the ConstKind `Value` / ValTree
  `Leaf` decodes, `ProcMacroKind` IntoDiagArg, `decode_IntrinsicDef`, upvar.ts `fold_Place`.

## PORT decisions to record
1. `impl<T: QueryKey> QueryKey for PseudoCanonicalInput<T>` is the factory `pseudo_canonical_input_key(KEY_T)`; one `KEY_*`
   per instantiated key type.
2. `Pattern`'s `Deref` is `pat.kind()` / `Pattern_deref(pat)` (`Interned` owns `deref`); `<Pattern as Display>` (auto-deref
   to `PatternKind`) is `display_Pattern`.
3. rustc_middle relate.rs impls stay in rustc_type_ir/relate.ts beside the other stand-ins; ported ones carry markers.
4. Generated rustc_middle decoders needed by rustc_type_ir `.gen.ts` files go through a lazy adapter in ty/codec.ts
   (init order), as `decode_AdtDef` does.
