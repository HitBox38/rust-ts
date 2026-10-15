# Handoff: typeck-expr-b (M3 wave 18b, rustc_hir_typeck)

Branch `lane/typeck-expr-b` (from integ `a5910d3`, no merges). Commits: `43f27e6` (expr.rs region), `8d4c380`
(inline_asm.rs), `fe5e696` (unit tests; `PolyFnSig` type import aliased for the merge with expr-a).

## Result
- **expr.rs:1855..3957: 28/28** fns of the region (`check_expr_struct_fields` .. `check_expr_offset_of`), in upstream
  order, onto `FnCtxt.prototype`; the lane's `unported_methods` list is gone (the `// ==== lane typeck-expr-b` header
  line stays, so the expr-a region above merges as a separate hunk).
- **inline_asm.rs: 9/9** (`InlineAsmCtxt::new`, `tcx`, `expr_ty`, `is_thin_ptr_ty`, `get_asm_ty`,
  `check_asm_operand_type` with the fn-local `FormattingSubRegisterArg` + its `Diagnostic` impl + nested `format_size`,
  `check_asm`).
- Nothing on this branch reaches the new code through a real typeck yet: callers are `check_expr_kind` (typeck-expr-a)
  and `check_asms` (typeck-checks-a). Verified instead by unit tests on fake receivers and by a scratch merge of all
  lanes (below).

## Files
- `src/rustc_hir_typeck/expr.ts`: imports (top block) + the region code appended after the region header + local
  helpers at the end of the file.
- `src/rustc_hir_typeck/inline_asm.ts`: rewritten from the stub.
- `src/rustc_hir_typeck/expr_b.test.ts` (new, 9 tests).
- No file outside these was edited (decls.ts, .gen.ts, other crates untouched).

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_hir_typeck/src/expr.rs`: 28/67 (the 39 missing are expr-a's
  region, expr.rs:59..1818).
- `bun scripts/coverage.ts --missing compiler/rustc_hir_typeck/src/inline_asm.rs`: 9/9.
- `bun scripts/coverage.ts --check`: `markers ok (15200; vendor 3888)`.

## `unported(...)` left
- `rustc_session::Session::relocation_model` (inline_asm.ts helper `Session_relocation_model`): `Session` has no
  `relocation_model()` in the TS port (only `EarlySession` has it, session.ts:138). Reached by `check_asm` only for
  explicit-register operands (`in("eax") x`). **Root:** add `Session.relocation_model` (session.rs:362) to
  rustc_session and replace the helper with `this.tcx().sess.relocation_model()`.
- No other new `unported`. Calls that stop at other lanes' placeholders / wave 19 (all on error paths except where
  marked):
  - `FnCtxt::err_ctxt` (wave 19) via the local `TypeErrCtxtView` (`type_error_struct_with_diag` in
    `report_unknown_field`, `report_fulfillment_errors` in `find_and_report_unsatisfied_index_impl`);
  - `diagnostics.ts` manual-impl stubs (wave 19): `TypeMismatchFruTypo` `add_to_diag` (`suggest_fru_from_range_and_emit`),
    `HelpUseLatestEdition::new` (`ban_nonexisting_field` on `.await`);
  - fn_ctxt/suggestions.rs (wave 19): `suggest_fn_call` (`ban_nonexisting_field`), `is_field_suggestable`
    (`available_field_names`, `get_field_candidates_considering_privacy_for_diag`);
  - method/mod.rs (typeck-method): `method_exists_for_diagnostic`, `suggest_method_call` (field-access errors).
  - Success path depends on: typeck-impl (`write_field_index`, `field_ty`, `register_wf_obligation`, `normalize`,
    `structurally_resolve_type`, `apply_adjustments`, `require_type_is_sized`, `require_type_has_static_alignment`,
    `lower_ty`, `try_structurally_resolve_const`, `select_obligations_where_possible`, `lookup_indexing`
    (place_op.rs), `expr_in_place`), typeck-coerce (`demand_coerce(_diag)`, `demand_eqtype`, `demand_suptype`),
    typeck-expr-a (`check_expr*`), typeck-checks-a (`check_expr_block`).

## PORT decisions
1. **Struct-keyed maps.** `UnordMap<Ident, (FieldIdx, &FieldDef)>` / `FxHashMap<Ident, Span>` in
   `check_expr_struct_fields` are `KeyedMap<Ident, ..>(Ident_key)` (a file-local `Ident_key`, the same `Eq` as
   rustc_resolve lib.ts / hir_analysis collect.ts); `remove` is the local `remove_keyed` (get + delete).
   `report_missing_fields` takes it as decls.ts's `Map<Ident, [FieldIdx, FieldDef]>` (KeyedMap extends Map).
   `FxHashSet<PredicateKind>` (`point_at_index`) is `KeyedSet<PredicateKind>(intern_key)`.
2. **Sorting.** `into_sorted_stable_ord()` of `&str` and `Vec<String>::sort()` use `str_cmp` (rustc_session options.ts,
   `Ord for str`); `sort_by_key` is `Array.prototype.sort` (stable); `missing_required_features.sort_unstable()` sorts
   `Symbol`s by index (derived `Ord`), `dedup()` drops consecutive duplicates.
3. **`point_at_index`** overwrites `error.obligation.cause.span`: the cause is cloned (`clone_ObligationCause`) before
   the write, since in Rust each obligation owns its cause and TS obligations may share the object.
4. **`TypeErrCtxtView`** (expr.ts end): the two `TypeErrCtxt` methods this region calls, as a view over
   `this.err_ctxt()` (precedent: rustc_hir_analysis check/entry.ts). Drop it when wave 19 types `TypeErrCtxt`.
5. **Local helpers** (expr.ts end): `parse_usize` / `parse_u64` (`str::parse`, `bigint`, as hir_ty_lowering's private
   copy), `FieldIdx_from_usize`, `FIRST_VARIANT` (rustc_abi, as rustc_middle adt.ts), `Option_DefId_eq`,
   `str_from_byte` (`&s[1..]`), `fold_TraitRef` / `fold_TraitClause` descriptors (as rustc_infer traits/util.ts),
   `NO_SOLUTION`. Candidates for shared homes when root dedupes.
6. **Iterator shapes.** `fields.into_iter()` + `fields.next()` inside the loop (`check_expr_offset_of`) is an index
   cursor; the lazy `.filter(..).take(100).map(..)` of `get_field_candidates_considering_privacy_for_diag` is a loop
   that stops once 100 fields are taken (so `is_field_suggestable` runs exactly as often as upstream); let-chains
   (`suggest_fru_from_range_and_emit`, the raw-pointer arm of `ban_take_value_of_method`) keep upstream's evaluation
   order.
7. **`InlineAsmCtxt`** (generated class): its methods are declared in inline_asm.ts by augmenting
   `./inline_asm.gen.ts` (decls.ts only has comment declarations) and `InlineAsmCtxt.new` is a namespace member
   (`new_ as new`, contract "Statics"). typeck-checks-a's `check_asms` already calls
   `(InlineAsmCtxt as unknown as {new..}).new(this, enclosing_id).check_asm(asm)` from `../inline_asm.gen.ts`: it works
   unchanged (lib.ts loads inline_asm.ts); after the merge the cast can go.
8. **`FormattingSubRegisterArg`** (fn-local struct + `impl Diagnostic`): module-level interface +
   `FormattingSubRegisterArg_into_diag` (marker inline_asm.rs:211, nested `format_size` with marker :223) +
   `FormattingSubRegisterArg_diagnostic`, the generated-diagnostic shape.
9. **`self.diverges.get()/.set()`** is the field `this.diverges`; `FnCtxt::new(self, ..)` passes `this.root_ctxt`;
   `ObligationCtxt::new(self)` passes `this.infcx`.
10. **Merge aid:** the decls.ts type `PolyFnSig` is imported as `PolyFnSigT` (expr-a imports the value companion
    `PolyFnSig` from ty_kind.ts under that name).

## Merge notes (scratch merge, then discarded)
Merging integ `372b3d8` + every typeck lane branch as of 08:25 (expr-b, expr-a, impl, lib-wb, checks-a, coerce,
callee-cast, method, probe, pat-a, euv, upvar): textual conflicts only in **expr.ts's import block** (expr-a; expr-a's
block also holds its `err_ctxt_methods` / `ret_coercion_of` / `d_Ty_Ty_visitable` helpers, keep them) and in
pat.ts's imports (pat-a vs pat-b, not this lane). After a union of the import statements (plus dropping pat.ts's
duplicate `DeclOrigin` / `MutblCap` imports): `tsc` clean. With that tree: tydump-nocore `--sample 300 --seed
typeck-expr-b` 245 MATCH / 0 DIFF / 55 UNPORTED, tydump-minicore 9 / 0 / 37, and `--filter` tests/ui/{structs,
offset-of,union,indexing} 0 DIFF. A hand-written no_core crate with struct literals / field access / FRU stops before
typeck at `QueryKey for (CanonicalImpliedOutlivesBoundsGoal, bool)` (wfcheck, rustc_middle query keys), so no real
body reaches this region yet.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_hir_typeck --timeout=60000`: 21 pass / 0 fail (contract.test.ts 12, expr_b.test.ts 9).
- expr_b.test.ts: `name_series_display`; `report_missing_fields` (sorted names, truncation, E0063 + label);
  `check_struct_fields_on_error`; `check_expr_yield` (both arms, E0627); `check_expr_asm_operand` (needs, sizedness,
  "invalid asm output", `&u8` -> `*const u8` coercion); `check_expr_offset_of` on a tuple; `get_asm_ty` (integer /
  isize / float / invalid); `check_expr_field` (struct field through autoderef: index, adjustments, obligations,
  stability; tuple field `1`); `check_expr_struct_fields` (field order of effects, missing field -> report, duplicate
  field E0062 suppresses the missing-field report).
- No pre-existing test's pinned stop moved (nothing re-pinned).

## Samples (no new DIFF vs base)
Base = integ `a5910d3` in a temporary worktree (`RUST_TS_AGENT=typeck-expr-b-base`), lane = this branch
(`RUST_TS_AGENT=typeck-expr-b`), same `--seed`. Identical statuses.

| suite | lane run | MATCH | DIFF | UNPORTED | CRASH | base run |
|---|---|---|---|---|---|---|
| tydump-minicore (46, full) | `20261015-081627-typeck-expr-b-vaz4` | 5 | 0 | 41 | 0 | `20261015-081647-typeck-expr-b-base-asb9`: 5/0/41/0 |
| tydump-nocore `--sample 100 --seed typeck-expr-b` | `20261015-081657-typeck-expr-b-6oe7` | 72 | 0 | 28 | 0 | `20261015-081719-typeck-expr-b-base-zfyt`: 72/0/28/0 |
| hir-tree-nocore `--sample 100 --seed typeck-expr-b` | `20261015-081804-typeck-expr-b-qs1m` | 100 | 0 | 0 | 0 | `20261015-081829-typeck-expr-b-base-2art`: 100/0/0/0 |

Top stops (lane): tydump-minicore `FulfillmentContext::new` (old solver, wave 20) 34, `check_unused_traits provider` 3;
tydump-nocore `IntegerExt::from_int_ty` (M4) 7, `LateParamRegionKind::from_bound` 4, `QueryKey for LitToConstInput`
4, `check_unused_traits provider` 3, `EarlyParamRegion: RegionName::is_named` 3.

## For root
1. `Session.relocation_model` missing on `Session` (see "unported"): rustc_session.
2. Record PORT decisions 1-10.
3. When typeck-checks-a merges: `check_asms` may drop its cast on `InlineAsmCtxt.new` (the augmentation declares it).
4. When wave 19 lands `TypeErrCtxt` and the diagnostics.ts manual impls: drop `TypeErrCtxtView` / `err_ctxt_view`.
