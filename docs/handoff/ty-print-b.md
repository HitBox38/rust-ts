# Handoff: ty-print-b (wave 15, M3): rustc_middle ty/print/pretty.rs 1705..end

Branch `lane/ty-print-b` (from main a62a248, no merges). Commits: 7751006 (port), bedce3b (oracle tests), e608c44
(display section), 74bfdc4 (aligned with ty-print-a's conventions), a3a21af (merge-friendliness), this handoff.

## Files touched
- `src/rustc_middle/ty/print/pretty.ts`: only the `// ==== lane ty-print-b: pretty.rs:1705..end ====` region (lane a's
  region is empty on this branch). ty-contract's `unported_methods(TyCtxt.prototype, ..)` stub for
  `def_path_str_with_args` / `value_path_str_with_args` is gone (both ported).
- New tests: `src/rustc_middle/ty/print/pretty_b.test.ts` (6 oracle cases) and `src/rustc_middle/ty/print/pretty_oracle/`
  (`probe.rs` throwaway rustc-dev oracle source, `run.ts` subject side on the ported driver, `expected.json` the probe's
  output).
- No other file edited.

## Coverage (`bun scripts/coverage.ts --missing compiler/rustc_middle/src/ty/print/pretty.rs`)
- 1705..end: **0 missing** (78 fns, every one with its marker; the whole file is 78/125 on this branch, the other 47 are
  ty-print-a's). `define_print!` expansions all carry `:3127 print`, `forward_display_to_print!`'s body `:3110 fmt`.
- `bun scripts/coverage.ts --check`: `markers ok (9547; vendor 3888)`.

## What is ported (upstream order)
- `PrettyPrinter` provided methods 1705..2055 (`pretty_print_const_scalar{,_ptr,_int}`, `pretty_print_const_pointer`,
  `pretty_print_byte_str`, `pretty_print_const_valtree`, `pretty_print_closure_as_impl`, `pretty_print_bound_constness`,
  `should_print_verbose`) as `PrettyPrinter.prototype` assignments + a `declare module "./pretty.ts"` interface merge.
- `pretty_print_const` (free fn), `FmtPrinterData`, `FmtPrinter extends PrettyPrinter` with every impl block in the
  class body (Deref/DerefMut, `new`/`print_string`/`new_with_limit`/`into_buffer`, `fmt::Write`, `Printer`,
  `PrettyPrinter`, `pretty_print_region`, `name_all_regions` (+ nested `name_by_region_index`), `prepare_region_info`
  (+ local `RegionNameCollector`)), `guess_def_namespace`, `TyCtxt::{def_path_str, def_path_str_with_args,
  value_path_str_with_args}` (prototype assignments), `RegionFolder`, the `Print` impls for `Binder` / `OutlivesClause`,
  the five wrapper structs with `into_diag_arg` / `Debug`, the four `#[extension]` traits (`TraitRef_print_*`,
  `PolyTraitRef_print_*`, `TraitClause_print_modifiers_and_trait_path`, `PolyTraitClause_print_*`),
  `PrintClosureAsImpl`, `forward_display_to_print!` (`display_Ty`, `display_List_PolyExistentialPredicate`),
  `define_print!` (`print_FnSig` .. `print_PlaceholderType`), `define_print_and_forward_display!` (`print_List_Ty` ..
  `print_GenericArg` + their `display_*`), `for_each_def`, `trimmed_def_paths`, `provide`, `OpaqueFnEntry`.

## Checks
- `bunx tsc --noEmit -p .`: clean (also no `--noUnusedLocals` findings in ty/print).
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: **4113 pass, 1 skip, 0 fail**.
- Sample difftests (`RUST_TS_AGENT=ty-print-b --sample 100`): expanded 100/100 MATCH (`20261014-055046-ty-print-b-fiaj`),
  resdump-nocore 100/100 (`-itjp`), hir-tree-nocore 100/100 (`-y8jv`); parse 100/100 earlier (`20261014-052029-ty-print-b-17j7`).
- **Scratch merge with `lane/ty-print-a` (as of 7a47f95), deleted afterwards:** take a's region, delete a's
  `-- lane ty-print-b's items .. DELETE AT MERGE` block, take my region, delete my `==== DELETE AT MERGE ====` block,
  drop the names my import block shares with a's: **4 tsc errors left**, all "`DefKind` / `DefPathData` imported with
  `import type`" in a's import block (make them value imports). Then tsc is clean and
  `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_middle/ty/print` passes (24 tests, both lanes').

## Tests (`pretty_b.test.ts`)
`pretty_oracle/probe.rs` is a throwaway rustc-dev program (lanes may not edit tools/; root may adopt it). It runs the
oracle on a fixture and prints, in `after_expansion`; `run.ts` prints the same with the ported printer on the ported
driver; stdout, stderr and exit code must be identical. Cases: a no_core lib (`local`, also with `-Zidentify-regions`,
`-Zverbose-internals`, `--edition 2021`) and a no_core lib with `extern crate pa` (an rlib built by the oracle in the
test; `ext`, also verbose). Sections:
- region Display (`'static`, `'_` for erased / vars / anonymous bound, placeholder and late-param regions, `'a`, `'x`,
  `'p`, `'q`, `'?3` under `-Zidentify-regions`) and `should_print_optional_region` for each;
- region highlights (`highlighting_region` `'7`, `highlighting_bound_region` `'4`);
- `print_crate_name` (plain, `with_crate_prefix!`, `with_resolve_crate_name!`, both; every extern crate);
- `print_path_with_simple` for every free item's `DefKey` (raw `r#match` / `r#async` per edition, `{use#0}`, `{impl#0}`,
  the skipped `extern` block), plain and under `with_crate_prefix!`;
- `print_path_with_generic_args` with lifetime args in the type and value namespaces, `typed_value` (`in_value`);
- Display of `ParamTy`, `ParamConst`, an empty `&List<Ty>`, a lifetime `GenericArg`, `ClauseKind::UnstableFeature`,
  `PredicateKind::Ambiguous`, a region `OutlivesClause`;
- `pretty_print_byte_str` (every escape class), `pretty_print_bound_constness`, `should_print_verbose`;
- `trimmed_def_paths` (14 local entries; 19 with the extern crate: glob/duplicate/`pub use .. as` tie-break,
  `#[doc(hidden)]`, type aliases, trait methods via module-like traits, ctors).
`-Zprint-type-sizes` is passed so `record_trimmed_def_paths` does not set `must_produce_diag` (both compilers would ICE
at exit). Regenerate: `TYPRINT_PROBE=<built probe> TYPRINT_WRITE=1 bun test src/rustc_middle/ty/print/pretty_b.test.ts`.

**Why types and consts are thin in the tests:** Display of a `Ty`/`Const` goes through lane a's `pretty_print_type` /
`pretty_print_const` (stand-ins here). In the scratch merge, lane a's own type oracle run through my `FmtPrinter` stops
at `TypeVisitable for Binder` (binder.rs:74, tyir-binder): `FmtPrinter::pretty_print_in_binder` names regions
(`prepare_region_info` visits the binder). Fn-pointer / `dyn` / binder printing waits for tyir-binder
(`visit_with_Binder`, `fold_with_Binder`) and ty-results (`Ty` super fold/visit). Const printing waits for ty-results
(`ScalarInt`, `ConstInt`, `ValTree`, `Value`).

`run.ts` differs from the probe in two forced ways (documented in its header): regions are interned with
`tcx.intern_region` (the `Region::new_*` statics are stubs), and printers are made with `new_with_limit(.., 2^24)`
because `FmtPrinter::new` reads the `limits` query, which stops at rustc_interface/limits.ts's `hir_krate_attrs`
stand-in (a merge-w14 root item). **Root: once limits.ts uses the real `tcx.hir_krate_attrs()`, switch run.ts to
`FmtPrinter.new` / `print_string`.**

## `unported(...)` left (all stand-ins at the end of my region, `<Owner>_<method>`)
- **DELETE AT MERGE block** (mirrors lane ty-print-a, same names/signatures): `Printer` / `PrettyPrinter` provided
  methods not reached by my tests, `Binder_no_bound_vars`, `EarlyBinder_iter_instantiated_copied`,
  `ExistentialTraitRef_with_self_ty`, `AssocItem_name`, `AdtDef_did`, `debug_Pattern`.
- tyir-binder: `TypeVisitableExt::has_bound_vars` on `Clause`.
- ty-results: `Ty` `super_fold_with` / `super_visit_with`; `ValTree` deref / `is_zst` / Debug; `Value::try_to_raw_bytes` /
  `destructure_adt_const`; `ScalarInt` eq / `FALSE` / `TRUE` / `size` / `to_bits` / LowerHex / `char::try_from`;
  `ConstInt::new` + Debug.
- ty-adt-assoc: `AdtDef::variants` / `variant`, `VariantDef::ctor_kind`.
- rustc_apfloat (not ported): `IeeeFloat::try_from(ScalarInt)`, `is_finite`, Display.
- rustc_const_eval (not ported): `validate_scalar_in_layout`. Target data layout: `pointer_size` (`tcx.data_layout` is
  pending).
- M4 mir::interpret: `Pointer::prov_and_relative_offset` + Debug, `CtfeProvenance::alloc_id`, `try_get_global_alloc`,
  `ConstAllocation::inner`, `Allocation::get_bytes_strip_provenance`, `Instance::{def_id, args}`.
- Reached through declared stubs (other lanes): `Region::get_name` / `Region::new_bound` (rustc_type_ir sty),
  `visit_with_Binder` (binder.ts), `debug_Region`, `debug_Placeholder`, `debug_BoundTy`, `debug_Ty`, the `Ty` / `List`
  methods of ty/sty.rs (`tuple_fields`, `is_unit`, `to_opt_closure_kind`, `consts`/`types`/`terms`, `type_at`),
  `Const::try_to_target_usize`, `TyCtxt::is_impl_trait_in_trait` (merge-w14 placeholder), `TyCtxt::short_string`.

Stand-ins with **upstream bodies** (field reads / one-liners over ported API): `BoundRegionKind::{is_named, get_name}`
+ its derived `PartialEq`, `Binder::super_fold_with` (`map_bound`), `TypeVisitableExt::{has_type_flags, has_placeholders,
has_vars_bound_at_or_above}` on a `Ty` (the visitor's `visit_ty` reduces to a flags / `outer_exclusive_binder` test),
`EarlyParamRegion::is_named`, `LateParamRegionKind::{is_named, get_name}`, `TraitDef::paren_sugar` (field read),
`ClosureKind`'s Display (`as_str`), `TraitRef::self_ty`, `Unnormalized::skip_norm_wip`.

## PORT decisions (please record)
1. **Lane ty-print-a's conventions** (its handoff decisions 1-4) are used as-is: `PrintResult` / `PRINT_OK`, `?` as
   `if ((r = ..).$ === "Err") return r;`, `Printer` / `PrettyPrinter` abstract classes, `print_X(self, p)` with
   descriptors last (`print_Binder(value, p, print_T, d_T)`, `print_OutlivesClause(value, p, print_T)`), overloaded
   `with_*()` getter / `with_*(() => e)` macro, `write!` as one `write_str`.
2. **b's provided methods** (pretty.rs:1705..2055) are `PrettyPrinter.prototype.<name> = function (this: PrettyPrinter, ..)`
   with a `declare module "./pretty.ts" { interface PrettyPrinter { .. } }` (lane a's decision 2); `FmtPrinter` overrides
   `pretty_print_const_pointer` by subclassing.
3. **`FmtPrinter(Box<FmtPrinterData>)`** keeps its tuple field `_0` (`p._0.print_alloc_ids = true`,
   `p._0.region_highlight_mode`); Deref/DerefMut are realised as the field (PORTING §8). Every impl block of
   `FmtPrinter` is in the class body (§8), markers at the upstream lines.
4. **Display** impls are `display_X(self): string`; `forward_display_to_print!` is one helper (`:3110 fmt` marker) that
   panics on `fmt::Error` like lane a's `IrPrint_print`. `pretty_print_const(c, fmt, print_types)` returns the text
   (Debug convention).
5. **`print_string(..).unwrap()`** in `def_path_str*` is `unwrap_result(r, debug_PrintError)` (`Error`).
6. **Extension traits** (`#[extension(pub trait PrintTraitRefExt)]` ..) are free fns `<SelfType>_<method>`
   (`TraitRef_print_only_trait_path`, `PolyTraitRef_print_trait_sugared`, `PolyTraitClause_print_with_bound_constness`).
7. **Wrapper structs** (`TraitRefPrintOnlyTraitPath` ..) are interfaces `{ _0 }`; their `derive(TypeFoldable,
   TypeVisitable)` is **not hand-written** (PORTING: codegen) — see "For root".
8. **`UnordMap<BoundRegion, Region>`** is `KeyedMap(intern_key)`; `FxIndexMap<(Namespace, Symbol), Option<DefId>>` is a
   `KeyedMap` keyed `ns:symbol` with `undefined` for `None` (occupied entries via `has`); the trimmed map is a
   `DefIdMap`. `SsoHashSet<Ty>` in `RegionNameCollector` is a `Set<Ty>` (insert only, interned keys).
9. **`('a'..='z').rev()`** is interned eagerly in the same order (z first) before filtering; same interning order.
10. **`let highlight = self.region_highlight_mode;`** (a `Copy`) is `.clone()` (lane a's `RegionHighlightMode.clone`).
11. **Pending type shapes** read here are local views in PORTING §5 shape: `ScalarShape` (mir/interpret value.rs:25),
    `GlobalAlloc`, `AllocRange`, `ValueShape` (`{ valtree, ty }`), `VariantDefShape`, `UserTypeKind` / `UserArgs` /
    `UserSelfTy`; `Scalar` / `Value` stay decls.ts's `Pending` in signatures and are cast at the function entry.
12. **Query values typed `unknown`** (`explicit_item_bounds`, `associated_item`, `generics_of`, `trait_def`,
    `extern_crate`) are cast at the call with a PORT note.
13. **`<[u8]>::escape_ascii`** and **`String::from_utf8_lossy`** are local helpers (TextDecoder's replacement of maximal
    invalid subparts matches std); candidates for src/std.
14. `TyCtxt::def_path_str` is assigned on `TyCtxt.prototype`, replacing context.ts's class-body placeholder.

## For root
- **Merge with ty-print-a** (both regions are in pretty.ts): keep a's region, delete a's `-- lane ty-print-b's items ..
  DELETE AT MERGE` block and my `==== DELETE AT MERGE ==== .. ==== end of DELETE AT MERGE ====` block, dedupe the two
  import blocks, and turn a's `type DefKind` / `type DefPathData` imports into value imports. Lane a's region must stay
  first (my region needs `PrettyPrinter` at load). Verified in a scratch merge (above).
- At merge, lane a's tests should use the real `FmtPrinter` (a's `print_oracle/test_printer.ts`): its `fn_*` / binder
  rows then stop at `visit_with_Binder` until tyir-binder lands (FmtPrinter names regions in binders).
- Wire `print::provide` (pretty.rs:3594, `trimmed_def_paths`): `ty::provide` (ty/mod.rs:2377) is not ported, and
  rustc_interface/passes.ts calls the ty sub-providers directly; add `ty_print_provide(providers.queries)` there (and
  drop it into `ty::provide` when that lands). Until then the `trimmed_def_paths` query keeps the default ICE.
- Delete the `def_path_str` placeholder method in the `TyCtxt` class body (context.ts "ty/print/pretty.rs"); the
  prototype assignment here replaces it.
- ty/decls.ts: replace the pending `Print<T>` with lane a's `Print` (both lanes cast at `short_string`); declare
  `TyCtxt.is_impl_trait_in_trait` (my `declare module "../context.ts"` is marked `PORT(decls): pending root`).
- Codegen: add pretty.rs's five wrapper structs (`TraitRefPrintOnlyTraitPath`, `TraitRefPrintSugared`,
  `TraitRefPrintOnlyTraitName`, `TraitClausePrintModifiersAndPath`, `TraitClausePrintWithBoundConstness`) to a
  TypeFoldable/TypeVisitable codegen set; `Binder<wrapper>` printing (`PolyTraitRef_print_*` results) needs their
  descriptors.
- run.ts: switch to `FmtPrinter.new` once rustc_interface/limits.ts uses the real `hir_krate_attrs` (see Tests).
- Consider adopting `pretty_oracle/probe.rs` (together with ty-print-a's) as a tools/probes probe.
