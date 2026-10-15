# Handoff: typeck-pat-b (M3 wave 18b, rustc_hir_typeck): pat.rs:1780..3388

Branch `lane/typeck-pat-b` (from integ `a5910d3`, no merges). Commits: `78d140f` (port), `a9c73be` (unit tests), this handoff.

## Result
All 33 upstream fns of `compiler/rustc_hir_typeck/src/pat.rs:1780..3388` are ported, in upstream order, into
`src/rustc_hir_typeck/pat.ts` (region `// ==== lane typeck-pat-b ====`): the 31 FnCtxt methods of decls.ts plus the
two comment-only items `FieldsNotListed::into_diag` (pat.rs:2573) and the nested fn `joined_uncovered_patterns`
(pat.rs:2586), both inside `lint_non_exhaustive_omitted_patterns`. This lane's `unported_methods(..)` list is gone
(empty). No decls.ts signature was changed and no `PORT(decls)` augmentation was needed.

## Files
- `src/rustc_hir_typeck/pat.ts`: imports (top of file) + the lane region. pat-a's list/region and `is_number` untouched.
- `src/rustc_hir_typeck/pat_b.test.ts` (new): 10 unit tests on a fake `FnCtxt` receiver (see "Checks").
- `docs/handoff/typeck-pat-b.md` (this file).

Merge note for root: pat-a edits the same file. Expect a textual conflict in the import block (both lanes add imports;
take the union and drop duplicate names — this lane imports `hir` as a **runtime** namespace
`import * as hir from "../rustc_hir/lib.ts"` because it calls `hir.QPath.span` / `hir.DotDotPos`), and possibly
around the two `// ==== lane` headers. The bodies don't overlap.

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_hir_typeck/src/pat.rs`: 33/70; every missing entry is at a line
  < 1780 (lane typeck-pat-a). Region 1780..3388: 33/33.
- `bun scripts/coverage.ts --check`: `markers ok (15196; vendor 3888)`. Crate: 109/1041.

## PORT decisions (please record)
1. **`PatInfo` copies.** `PatInfo` is `Copy` and passed by value. A fn whose parameter is `mut pat_info` and assigns
   its fields clones it on entry (`clone_PatInfo`), so callers' values never change (check_pat_ref here). Callers pass
   the object as is. **pat-a should follow the same rule** for its `mut pat_info` fns (`check_pat_inner`,
   `adjust_pat_info`, ...), otherwise a shared `PatInfo` would be mutated across sibling subpatterns.
2. **pat-a's `MutblCap` methods.** `MutblCap::cap_to_weakly_not` / `MutblCap::as_mutbl` (pat.rs:229/:237, comment-only
   in decls.ts, lane typeck-pat-a) are called through `MutblCap_methods()`, which reads them off this module's own
   `MutblCap` export (`import * as pat_mod from "./pat.ts"`) at call time and stops
   `unported("rustc_hir_typeck::pat::MutblCap::{cap_to_weakly_not, as_mutbl}")` while absent. This assumes pat-a puts
   them on the companion (PORTING §8: `export const MutblCap = { ...gen.MutblCap, cap_to_weakly_not(self_, span),
   as_mutbl(self_) }` in pat.ts). After both lanes land, root may replace `MutblCap_methods().x(..)` with
   `MutblCap.x(..)` and delete the helper (and the self-import).
3. **`FxHashMap<Ident, _>`** (check_struct_pat_fields' `field_map` / `used_fields`) are `KeyedMap`s keyed by a local
   `Ident_key` (name + `SyntaxContext`, same as hir_analysis collect.ts / rustc_resolve).
4. **`str::parse::<usize>().is_err()`** (error_inexistent_fields) is the local `parse_usize_is_err` (optional `+`,
   ASCII digits, value < 2^64).
5. **`Vec::retain` on `&mut Vec`** (error_inexistent_fields' `unmentioned_fields`) edits the caller's array in place
   (`splice`).
6. `impl Diagnostic for FieldsNotListed` is a local factory returning a `Diagnostic` object (precedent: hir_analysis
   generics.ts `LifetimeArgsIssue`); `rustc_hir_pretty::qpath_to_string(self, ..)` / `pat_to_string(self, ..)` use
   `FnCtxt_as_PpAnn(this)`; `PinnednessCap::Pinned` is `"Pinned"`; `'&'`/`'t'` are `ch("&")`/`ch("t")`.

## `unported(...)` left
- In this region: only the `MutblCap_methods()` stop above (until pat-a lands).
- Placeholders reached from this region (other lanes, expected until merge):
  - typeck-pat-a: `check_pat`, `check_pin_projection`, `demand_eqtype_pat`, `demand_eqtype_pat_diag`,
    `borrow_pat_suggestion`, `check_dereferenceable`, `ref_pat_matches_mut_ref`, `ref_pat_matches_inherited_ref`,
    `report_unexpected_variant_res` (lib.rs:479), `is_number` (pat.rs:49), `MutblCap` methods;
  - typeck-impl: `resolve_ty_and_res_fully_qualified_call`, `instantiate_value_path`, `field_ty`, `write_field_index`,
    `normalize`, `register_bound`, `deeply_resolve_ignoring_regions_with_obligations`, `structurally_resolve_type`,
    `try_structurally_resolve_const`;
  - typeck-coerce: `may_coerce` (error path), `demand_eqtype` (slice/array patterns);
  - **wave 19 on a success path:** `FnCtxt::is_field_suggestable` (fn_ctxt/suggestions.rs). `check_struct_pat_fields`
    computes `accessible_unmentioned_fields` whenever a struct pattern leaves fields unmentioned, also for the valid
    `Foo { a, .. }` (it feeds the `non_exhaustive_omitted_patterns` lint). Every such pattern stops there until it is
    ported; suggest pulling it forward (it is small).

## Cross-lane needs / bugs found
1. **rustc_middle `TyCtxt.slice_intern` re-interns an interned list (root / rustc_middle owner).** `mk_type_list(v)` /
   `mk_args(v)` key `v` with `intern_key(v)`; when `v` is already an interned `List` (a frozen `RawList` with
   `[INTERNED]`), `push_key` emits `#<id>` instead of the elements, so the lookup misses and a **second** list with the
   same elements is created. Upstream passes `&List<T>` as `&[T]` all the time (e.g. pat.rs:2071
   `Ty::new_tup(tcx, element_tys)` with `element_tys = tcx.mk_type_list_from_iter(..)`), so the TS port yields two
   distinct `(u8, u16)` types that are not `===`. Repro: `Ty.new_tup(tcx, tcx.mk_type_list(f)) !== Ty.new_tup(tcx, f)`.
   Fix suggestion: in `slice_intern` key on the elements (`intern_key([...v])`, or return `v` itself when it is
   already a `RawList` of that set). Not changed here (outside this lane); pat_b.test.ts compares that tuple
   structurally with a `PORT(test)` note.
2. pat-a: decisions 1 and 2 above (`mut pat_info` clones; `MutblCap` companion methods).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_hir_typeck --timeout=60000`: 22 pass / 0 fail (contract.test.ts 12, pat_b.test.ts 10). No
  pre-existing test pinned a stop in this region; nothing re-pinned.
- pat_b.test.ts covers: the three array-length errors (message, code, label, pluralization); `check_array_pat_len`
  (exact match, E0527, E0528, E0730); `check_pat_tuple` with `..` (arity from the expected tuple, gap skipped via
  `enumerate_and_adjust`, error path propagates the `ErrorGuaranteed`); `check_pat_ref` matching `&p` against `&u8`
  (inner type, `MutblCap::Not` cap, caller's `PatInfo` unchanged); `pat_is_irrefutable`;
  `try_resolve_slice_ty_to_array_ty`; `is_slice_or_array_or_vector`; `error_unmentioned_fields` message/label (the
  suggestion arm needs pat-a's `is_number`); `add_rust_2024_migration_desugared_pat` labels/flags;
  `lint_non_exhaustive_omitted_patterns` (FieldsNotListed message/label/help/note, joined list for 1/2/3/4/5 fields).

## Samples (no new DIFF)
| suite | run | MATCH | DIFF | UNPORTED | CRASH |
|---|---|---|---|---|---|
| tydump-minicore (46, full) | `20261015-080753-typeck-pat-b-vxdz` | 5 | 0 | 41 | 0 |
| tydump-nocore `--sample 100 --seed typeck-pat-b` | `20261015-080809-typeck-pat-b-cjcc` | 76 | 0 | 24 | 0 |
| hir-tree-nocore `--sample 100 --seed typeck-pat-b` | `20261015-080836-typeck-pat-b-vnpm` | 100 | 0 | 0 | 0 |

tydump-minicore matches the fnctxt-contract numbers (5/0/41/0). Top stops: minicore — old solver
`FulfillmentContext::new` (34, selcx-contract), `check_unused_traits provider` (3), `StableHash without a TS impl` (2);
nocore — `LateParamRegionKind::from_bound` (3), `QueryKey for (CanonicalImpliedOutlivesBoundsGoal, bool)` /
`LitToConstInput` (3 each), `EarlyParamRegion: RegionName::is_named` (3), `IntegerExt::from_int_ty` (3). None reaches
pattern checking yet (typeck bodies stop at other lanes' placeholders first), hence the unit tests.
