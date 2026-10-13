# Handoff: res-late-a (wave 10, M2: rustc_resolve late.rs lines 1–2890)

Branch `lane/res-late-a` (from main 00f8a7b, no merges). Commits: the port; the PENDING-table updates in two
existing tests; late_a.test.ts with its fixtures; this handoff.

## Files
- `src/rustc_resolve/late.ts`: late.rs 1–2890, in upstream order.
  - **Companions:** `PatternSource::descr` and its `IntoDiagArg`, `ConstantHasGenerics::force_yes_if`,
    `ConstantItemKind::as_str`, `RibKind::{contains_params, is_label_barrier}`, `Rib::new`, `LifetimeRibKind::elided`,
    `LifetimeBinderKind::descr`, `LifetimeRib::new`, the six `PathSource` methods, `MaybeExported::eval`.
  - **`AsRef` / `AsMut`** for `LateResolutionVisitor`.
  - **The `Visitor` impl:** all 30 overrides, late.rs:895–1565.
  - **The inherent impl** from `new` (late.rs:1581) through `future_proof_import` (late.rs:2848).
  - **Nested items:** the fn-local visitor structs `AnonRefFinder`, `FindReferenceVisitor` and `SelfVisitor` are
    local classes inside their fns; each of their methods carries its own marker.
  - **Layout:**
    - My code is one block, delimited by `// ---- res-late-a: ... ----` and `// ---- end res-late-a ----`. It
      replaces the stub region from `export type PatternSource` to `LifetimeRib.new`.
    - New imports are one block headed `// res-late-a imports`.
    - Outside these, I made only two edits:
      1. The `./decls.ts` import no longer names `LateResolutionVisitor`.
      2. `export { LateResolutionVisitor };` became a companion (PORT 7 below).
- `src/rustc_resolve/late_a.test.ts` (new) and `src/rustc_resolve/late_a_oracle/` (new; 3 crates and their fixtures,
  76 KB). The names avoid colliding with whatever res-late-b adds.
- **PENDING tables in other lanes' tests.** These entries now run through, so I updated them to keep `bun test`
  green:
  - `ident.test.ts`: removed "resolve_path crate::m::mac through a child module" and "resolve_ident_in_lexical_scope
    finds a rib binding". Both now pass their full expectations.
  - `build_reduced_graph.test.ts`:
    - removed `p_vis_restricted`, which now matches the probe on all 4 sections;
    - `use_trees` now stops at `test: module_children of a module with imports (res-imports)`.

## Coverage and checks
- `bun scripts/coverage.ts --missing compiler/rustc_resolve/src/late.rs`: **every fn at lines < 2891 is ported**.
  The first missing fn is `2891 resolve_item` (res-late-b). Overall the file is 77/142; the remainder is res-late-b's.
- `bun scripts/coverage.ts --check`: `markers ok (6741; vendor 2603)`.
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3416 pass, 1 skip (pre-existing), 0 fail.
- `RUST_TS_AGENT=res-late-a bun scripts/difftest.ts --suite parse --sample 200`: 200/200 MATCH
  (run `20261013-132912-res-late-a-tlyo`). The parse suite does not reach late.rs, so this only shows there is no
  regression.

## Tests (`late_a.test.ts`, 37 tests)
### 1. End-to-end oracle cases (`late_a_oracle/`)
These are `#![no_core]` crates run with the resdump-nocore arguments at edition 2021. Each case has fixtures from
`tools/probes/resdump` (stdout/stderr) and its exit code.
- **lifetimes.rs:**
  - elided, named, `'static` and `'_` lifetimes; elision in paths (`Brackets`, plus the ELIDED_LIFETIMES_IN_PATHS
    lint);
  - two-parameter elision failure; fn pointers with and without `for<>`; closures;
  - `&self` and `self: &'a Self` elision.
- **labels.rs:** label resolution, E0767 (unreachable label) and E0426 (undeclared label).
- **generics.rs:** E0128 (forward default), E0735 (`Self` in a default), E0637 (`'_` in a bound), E0261 and E0106.

All three cases are **PENDING**:
- The subject (`src/rust_ts/resdump.ts`) must still exit 70. Today the driver stops at the lint store (lint-early-a).
- After that it needs res-late-b (`resolve_item`, `late_resolve_crate`, ...), late/diagnostics.rs,
  `Resolver::dcx` (res-diag) and CStore.
- Supporting tests:
  - a freshness test re-runs the probe;
  - a guard test checks that each fixture still contains what it is named for.
- Regenerate with `REGEN=1 bun test src/rustc_resolve/late_a.test.ts`.

### 2. Unit checks
**Companions (pure):**
- every `PathSource` method across all 15 variants, including the `descr_expected` arm order and the
  `TraitItem(MacroNS)` bug;
- `RibKind` contains_params / is_label_barrier, including the bug arm;
- descr / as_str / force_yes_if / elided;
- `Rib::new` and `LifetimeRib::new` build `KeyedMap`s;
- `MaybeExported::eval` for the variants that do not need an owner.

**The visitor, on a real `Resolver`** (the `with_tcx` template, empty no_core crate):
- **Setup and ribs:** `new`, `as_ref` / `as_mut`; `with_rib` / `with_lifetime_rib` push, pop and restore candidates.
- **`resolve_lifetime`:** `'static` and named lifetimes, with the `lifetime_uses` One/Many logic.
- **`resolve_elided_lifetime` / `create_fresh_lifetime`:** the numbering matches the probe's for `fn elided(x: &u8)`,
  i.e. `ElidedAnchor{n,n+1}` plus `Fresh{param: n+1, Ampersand}`, and `extra_lifetime_params`.
- **`resolve_anonymous_lifetime`:** under Elided, ElisionFailure (`Left`) and the transparent ribs.
- **`record_lifetime_def`:** the double-resolution panic text.
- **`resolve_elided_lifetimes_in_path`:**
  - inferred (Expr), fresh `Brackets` with candidate grouping and the buffered lint;
  - `Comma` with the opening-bracket span under ElisionFailure (`Right(range)`);
  - skipped segments.
- **`find_lifetime_for_self`:** `&Self`, `&'a Self`, `&u8`, and `&'a &Self` (= Many).
- **Labels:** `resolve_label` (found) and `is_label_valid_from_rib` (barrier, and the bug when `all` reaches a
  non-label rib).
- **Lexical scope:** `maybe_resolve_ident_in_lexical_scope` and `resolve_ident_in_lexical_scope` find a rib binding.
- **`visit_generic_params`:** the forward-ban rib contents while each default is visited. The test checks
  `IndexMap::swap_remove` order, `[T,U,Self]` → `[Self,U]`. Negative control: an order-keeping delete fails it.
- **`visit_ty`:** an elided `&`, `impl Trait` candidate save/restore, and `ImplicitSelf` →
  `record_partial_res(SelfTyAlias)`.
- **Small visitor methods:** `visit_attribute`, the `visit_anon_const` bug text, `visit_ty_pat(NotNull)`.
- **`future_proof_import`:** the 2015 early return and nested recursion.

**UNIT_PENDING** (exact `unported` text asserted):

| case | stops at |
|---|---|
| undeclared lifetime | `late::diagnostics::LateResolutionVisitor::emit_undeclared_lifetime_error` |
| lifetime under a const param type rib | `late::diagnostics::...::emit_non_static_lt_in_const_param_ty_error` |
| explicit `'_` under AnonymousReportError | `diagnostics::impls::Resolver::dcx` |
| `'_` behind an Item barrier | `late::diagnostics::...::report_missing_lifetime_specifiers` |
| unreachable label in an outer rib | `late::diagnostics::...::suggestion_for_label_in_rib` |
| `resolve_fn_signature` | `late::LateResolutionVisitor::apply_pattern_bindings` (res-late-b) |
| 2018 `use x;` with a local `x` | `late::LateResolutionVisitor::should_report_errs` (res-late-b) |
| `visit_ty` of a path | `late::LateResolutionVisitor::smart_resolve_path` (res-late-b) |

## `unported(...)` left in my code
- `rustc_middle::ty::AssocItems::find_by_ident_and_kind (tcx.associated_items of an extern trait, M3)`, in
  `resolve_anonymous_lifetime`. It is reached only by the non-GAT associated-type error for an impl of an
  **extern** trait (`tcx.associated_items` returns `unknown`).

**Calls into other lanes' stubs:**
- **res-late-b:**
  - items and ribs: `resolve_item`, `with_generic_param_rib`, `with_label_rib`, `with_static_rib`,
    `with_current_self_item`, `with_self_rib`;
  - bodies: `resolve_arm`, `resolve_block`, `resolve_expr`, `resolve_local`, `resolve_anon_const(_manual)`;
  - paths and patterns: `smart_resolve_path`, `resolve_params`, `resolve_pattern`, `apply_pattern_bindings`,
    `resolve_restriction_path`;
  - other: `resolve_doc_links`, `resolve_eii`, `should_report_errs`, `def_id_matches_path`.
- **late/diagnostics.rs:**
  - lifetime errors: `emit_undeclared_lifetime_error`, `emit_non_static_lt_in_const_param_ty_error`,
    `emit_forbidden_non_static_lifetime_error`, `report_missing_lifetime_specifiers`,
    `suggest_introducing_lifetime_for_assoc_ty_binding`;
  - labels: `suggestion_for_label_in_rib`.
- **res-diag:** `Resolver::dcx`.
- **rustc_middle:** `debug_LifetimeRes` of `Fresh` is unported
  (`Debug of rustc_hir::MissingLifetimeKind (LifetimeRes::Fresh; hir.rs, M3)`).
  - resdump's `owners` section prints `Fresh { param: .., kind: Ampersand }` for every elided lifetime, so it hits
    this.
  - With PORT 1 below, `kind` is the variant-name string, so resolve.ts can print it directly. See "For root".

## PORT decisions (please record)
1. **`rustc_hir::MissingLifetimeKind`** (hir.rs:812, M3) gets an exported stand-in in late.ts.
   - It is a string union with a same-named const: `Underscore | Ampersand | Comma | Brackets`.
   - It has no marker. These strings are what `LifetimeRes::Fresh.kind`, `MissingLifetime.kind` and
     `extra_lifetime_params_map` carry.
   - **late/diagnostics lanes:** compare against these strings.
2. **Local derive helpers for `LifetimeRes`:** `LifetimeRes_eq` (derived `PartialEq`; `ErrorGuaranteed` compares
   always equal) and `LifetimeRes_key` (the `Eq`/`Hash` key for the `UnordSet` in `resolve_fn_params`, a `KeyedSet`).
   resolve.ts has neither.
3. **`Set1::insert`** (resolve_bound_vars.rs:32, not ported) is a faithful local copy, `Set1_insert`, without a
   marker. It returns the new value instead of taking `&mut self`.
4. **`IndexMap::swap_remove` on a `KeyedMap`** goes through `keyed_map_swap_remove`. It looks up the stored key, then
   calls rustc_errors' `index_map_swap_remove`, which compares keys by identity.
5. **Small helpers:**
   - `node_id_range` iterates a `Range<NodeId>`;
   - `DiagMetadata_default` is `#[derive(Default)]`;
   - `finalize_late` is `Finalize { stage: Late, ..f }`;
   - `LIFETIME_RES_INFER` / `LIFETIME_RES_STATIC` are unit-variant constants;
   - `LifetimeElisionCandidate_Ignore()` reads late/diagnostics.ts inside a body (init-order rule).
6. **`Rib::new`** builds `bindings` as `KeyedMap(Ident_key)` and `patterns_with_skipped_bindings` as
   `KeyedMap(DefId_key)`. `LifetimeRib::new` builds `bindings` as `KeyedMap(Ident_key)`. `get_key_value` is
   `stored_key` + `get`.
7. **`LateResolutionVisitor::new`** is a static. late.ts now exports a companion,
   `export const LateResolutionVisitor = decls.LateResolutionVisitor as typeof decls.LateResolutionVisitor & { new }`,
   plus the same-named type; this is res-lib rule 4's pattern.
   - The assignment mutates the decls class itself, so `lib.ts`'s re-export sees `.new` too.
   - **res-late-b** should call `LateResolutionVisitor.new(r)`.
8. **`PatternBindings` codegen bug.** Upstream it is `SmallVec<[(PatBoundCtx, FxIndexMap<Ident, Res>); 1]>`, a
   **list of pairs**. late.gen.ts emits `T[][]`, because typemap.json maps `smallvec::SmallVec` to `$0[]` of the
   array type `[T; 1]`.
   - `resolve_fn_params` builds the pair list and casts it to the generated type, marked `PORT(decls)`.
   - **res-late-b** will hit the same thing in `resolve_pattern*` / `apply_pattern_bindings`.
   - **Root:** fix the typemap so `SmallVec<[T; N]>` maps to `T[]`, then regenerate.
9. **The `unported_methods(LateResolutionVisitor.prototype, ...)` line is unchanged**, to keep the merge with
   res-late-b clean: both lanes would otherwise edit the same line.
   - It is harmless: `unported_methods` skips names that are already own properties.
   - **Root:** after both merges, drop the names or the whole call.
10. **`resolve_fn_params`** materializes `inputs`, because upstream iterates it twice (`inputs.clone()`, then
    `inputs`). Every caller passes an array.
11. **`resolve_label`'s `mut label: Ident`** is a fresh `Ident`, edited through `field_mut(label, "span")`.
    `resolve_lifetime`'s `lifetime_rib_iter` is an index, so after the `Item` break the `find_map` continues below it.
12. **`descr_expected`** is an if-chain in upstream arm order, because `TraitItem(ValueNS, TupleStruct(..))` comes
    before `TraitItem(ns, _)`. `ident.to_string()` is `display_Ident`, and `char::is_uppercase` is
    `std/char.ts is_uppercase` of the first code point.

## decls.ts notes (root)
- `visit_ty_pat` is listed with the comment `Result<undefined, FmtError>`. Upstream returns `Self::Result`, i.e. `()`.
  It is only a comment, but it is wrong.
- `LateResolutionVisitor.new` is not declared on the class. PORT 7 covers it without touching decls.ts. Declaring it
  there (`declare static new: (resolver: Resolver) => LateResolutionVisitor;`) would let both late lanes drop the
  companion.

## For root
1. Record the PORT decisions above. Fix the `SmallVec<[T; N]>` typemap (PORT 8) and regenerate late.gen.ts.
2. **`debug_LifetimeRes` of `Fresh`** (rustc_middle/middle/resolve.ts) can print `kind` as the variant name. The
   strings are exactly hir's `MissingLifetimeKind` Debug, and the probe prints `kind: Ampersand`. Until then the
   resdump `owners` dump of any crate with an elided lifetime stops there.
3. When the driver reaches late resolution and res-late-b lands, take the `late_a_oracle` cases off PENDING one by
   one.
4. After merging both late lanes, clean up the `unported_methods` line (PORT 9).
5. The PENDING-table edits in `ident.test.ts` and `build_reduced_graph.test.ts` are listed under "Files".
