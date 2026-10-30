# Handoff: lane encoder-c (plan-m5 wave 33)

Branch `lane/encoder-c`, made from main `adaa9d4a`. Scope: encoder.rs :1482–:2030, the 16 fns from `encode_def_ids` to
`encode_foreign_modules`. `encode_hygiene` (:2036) was already ported by encode-span-hygiene.

## What landed

### Ported in `src/rustc_metadata/rmeta/encoder.ts` (16 fns, all stubs before)

All 16 are in upstream order, each with a `// rustc:` marker, and each replaces its stub in place:
- **`encode_def_ids` (:1482).** The whole per-`DefId` loop:
  - the `AnonConst`-as-`ConstArg`/`Infer` skip and `default_fields`;
  - span, attrs, `expn_that_defined`, ident span, `codegen_fn_attrs` and visibility;
  - stability, variances, fn sig, generics with clauses, inferred outlives and const param defaults;
  - `const_conditions`, `type_of`, constness, asyncness and arg idents, intrinsics, object lifetime defaults;
  - trait / trait-alias data, associated items, coroutine kind, coroutine-for-closure and by-move body;
  - the static initializer (with the `delayed_bug` / `span_bug` arms);
  - ADT / mod / macro dispatch, type aliases, opaque types, assoc types, anon consts, `const_of_item`;
  - RPITIT tables, then `inherent_impls`, `doc_link_resolutions` and `doc_link_traits_in_scope`.
- **`encode_externally_implementable_items` (:1733).**
- **`encode_info_for_adt` (:1748).**
- **`encode_info_for_mod` (:1808).**
- **`encode_explicit_item_bounds` (:1839)** and **`encode_explicit_item_self_bounds` (:1845).**
- **`encode_info_for_assoc_item` (:1852)** and **`encode_precise_capturing_args` (:1884).**
- **`encode_mir` (:1892).** D5: both branches are ported as upstream. With `should_codegen()` false, `encode_opt` is false,
  so only `trivial_const` / `mir_for_ctfe`, `thir_abstract_const`, `mir_const_qualif` / `rendered_const` and
  `promoted_mir` are written. The `optimized_mir` branch and the `deduced_param_attrs` loop are ported too, but they are
  not reached.
- **`encode_stability` (:1976), `encode_const_stability` (:1987), `encode_default_body_stability` (:1998) and
  `encode_deprecation` (:2009).**
- **`encode_info_for_macro` (:2016).**
- **`encode_native_libraries` (:2024)** and **`encode_foreign_modules` (:2030).**

### Element encoders

These are private helpers at the bottom of encoder.ts, after `encode_SyntaxContextKey`. They are not markers.

Each is the `Encodable` fn that `lazy` / `lazy_array` take for one table, built from the generated or hand-ported
encoders. They mirror the decode side in rmeta/decoder/cstore_impl.ts. They cover:
- `Visibility<LocalDefId>`;
- `EarlyBinder` of `PolyFnSig`, `Ty` and `Const`, plus `Option<EarlyBinder<Const>>`;
- the tuples `(Clause, Span)`, `(PolyTraitRef, Span)`, `(Ty, Span)` and `(ConstValue, Ty)`;
- `Option<Ident>`, `Vec<(usize, DenseBitSet)>` and `IndexVec<_, Symbol>`;
- `OpaqueTyOrigin<DefId>` and `PreciseCapturingArgKind<Symbol, Symbol>`;
- `IndexVec<Promoted, Body>`;
- `DefIdMap<EarlyBinder<Ty>>` and `DefIdMap<Vec<DefId>>`;
- `DocLinkResMap`, `EiiMapEncodedKeyValue`, `ForeignModule` and `ExternAbi`.

### Out-of-file edit

`src/rustc_middle/middle/codegen_fn_attrs.ts` gains the `TyEncodable` halves of the hand-written decoders it already
had. Each sits next to its decoder:
- `encode_Visibility` (mono);
- `encode_CodegenFnAttrs`, `encode_TargetFeatureKind`, `encode_TargetFeature`;
- `encode_PatchableFunctionEntry`, `encode_CodegenFnAttrFlags`, `encode_SanitizerFnAttrs`.

`encode_def_ids` needs these for every fn (`codegen_fn_attrs`). The module comment says so. Field order was checked
against codegen_fn_attrs.rs:65–:300 and mono.rs:384.

### Tests

- **Contract test** (`encoder_contract.test.ts`):
  - `ported_by` now returns `encoder-c` for a `// rustc:` marker in :1482–:2063.
  - The per-lane counts don't change (`encoder-c: 16`; the count is by owner).
  - "Stubs stop with their lane" loses its `encode_mir` probe, because encoder-c has no stubs left.
- **New `encoder_c.test.ts`**, one test. It compiles a no_core lib crate in process with the real driver config:
  - flags: `--crate-type lib --emit=metadata --target x86_64-unknown-linux-gnu -Zforce-unstable-if-unmarked`;
  - the crate has structs (named, tuple, unit), an `enum` with `repr(u8)` and an explicit discriminant, a `repr(C)`
    union, a trait with assoc type, const and default fn, and an impl;
  - it also has a mod with a `use` re-export, a `macro_rules!` with `#[macro_export]`, an `extern "C"` block, a
    `#[deprecated]` fn, a static, a type alias, an inherent impl, a const-param default, an opaque type, RPITIT trait
    and impl, a const fn and doc links.

  The test then runs the ported fns on an `EncodeContext` over a `MemEncoder` with the real `TyCtxt`. It reads the
  tables back from the `TableBuilder`s and decodes the lazy values with the port's own decoders (`MetadataDecodeContext`
  over a stand-in `CrateMetadata`). It pins:
  - module children and re-exports;
  - `ReprOptions` and `VariantData`;
  - field def ids, safety and `mut_restriction`;
  - assoc-item defaultness, container and item bounds;
  - RPITIT info and `assumed_wf`;
  - macros, stability and deprecation;
  - the foreign module's bytes: def ids, then ABI tag 0 (`C`), `unwind` false;
  - a `CodegenFnAttrs` round trip.

  It also checks that `encode_def_ids` / `encode_mir` never stop at an encoder-c stub.

  The `--target` is needed because aarch64's `compute_rust_abi_info` is unported (lane fn-abi), and this host is
  aarch64-apple-darwin.

## How far encoding gets (small lib crate, `--crate-type lib --emit=metadata`)

- **Through the driver** (`bun src/rust_ts/main.ts`, small no_core lib): analysis passes, then it exits 70 at
  `rustc_metadata::rmeta::encoder::encode_metadata (lanes encoder-a..d)`. That is encoder-d's entry, and nothing in my
  range is reached yet. The oracle writes the `.rmeta` (exit 0).
- **`encode_def_ids` / `encode_mir` called directly on a real `TyCtxt`** (the test above): both stop at encoder-b's
  stubs. `encode_def_ids` stops at `should_encode_span`, the first predicate in the loop; `encode_mir` stops at
  `should_encode_mir`.
- **With encoder-b's predicates filled in.** In a throwaway local edit, I wrote quick versions of `should_encode_*`
  from encoder.rs:974–:1458, with `encode_attrs` skipped and `rendered_const` stubbed. I reverted the edit and did not
  commit it. With it, **both fns ran to completion** on the test crate (4.5 kB of tables for `encode_def_ids`).
  - The run exercised every branch the crate has: 2-entry doc-link maps, inherent impls, RPITIT, const param default,
    static initializer, 7 `rendered_const`s and 23 `mir_for_ctfe` / promoted bodies.
  - The remaining stops are therefore other lanes' fns: encoder-b's `encode_attrs` and encoder-d's `rendered_const` /
    `encode_metadata`.

## Verification

- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok (23,080; vendor 4,680).
- Coverage, encoder.rs: **26/95 → 42/95** (+16). rustc_metadata 394/453; TOTAL 22,501 / 25,518 (+16 over base).
- `bun test src/rustc_metadata`: 115 pass, 0 fail.
- `bun test src/rustc_middle`: 356 pass, 0 fail. I ran it because of codegen_fn_attrs.ts.
- Samples (`RUST_TS_AGENT=root-f5de`). "Before" is a temporary worktree at base `adaa9d4a`; I removed it afterwards.

  | suite | before | after |
  |---|---|---|
  | `mir --sample 300` | 297 MATCH, 1 UNPORTED, 2 UNSTABLE (run 20261030-194401-root-f5de-rh3i) | 297 MATCH, 1 UNPORTED, 2 UNSTABLE (run 20261030-194648-root-f5de-c30x) |
  | `tydump-ui --sample 300` | 298 MATCH, 2 UNSTABLE, 15 skipped (run 20261030-194536-root-f5de-9os9) | same (run 20261030-194737-root-f5de-9a6f) |

  The per-case statuses are identical (0 differing ids). The UNPORTED case is the same before and after:
  `const-generics/transmute-fail.rs`. That is expected: encoder.ts is not loaded at startup (encoder-d wires it), and
  codegen_fn_attrs.ts only gained functions.
- Load order: `import encoder.ts` alone, and after `rustc_metadata/lib.ts`, both evaluate cleanly. Encoder-d should
  re-check when it wires encoder.ts into lib.ts, since encoder.ts now imports many more modules.

## `unported(...)` left

- **`encode_NativeLib`** (encoder.ts helper): "Encodable for rustc_crate_store::NativeLib (derive(Encodable) not
  generated)".
  - `NativeLib.cfg` / `DllImport.import_name_type` are `unknown` in cstore.gen.ts, so this would need rustc_crate_store
    as a tools/codegen serialize set.
  - It is reached only by a crate with `#[link]` / native libs. core and alloc have none; std does. An empty list never
    calls it.
  - The decode side (`decode_NativeLib`) is unported too.
- **No other `unported` in my range.** Two fns can still stop through `encode_HashMap`'s guard:
  `collect_return_position_impl_trait_in_trait_tys` and `associated_types_for_impl_traits_in_trait_or_impl`. Their
  values are `DefIdMap` (upstream `UnordMap`, which encodes as its `FxHashMap`: hashbrown order). The port builds them
  as `KeyedMap`s, so a map with more than one entry stops UNPORTED, as the recorded hash-map rule requires. See below.

## For root to decide / record

1. **Hash maps in encode_def_ids (contradicts plan-m5 §1d "nothing in the encoder iterates hash maps").** Two tables
   encode `DefIdMap`s:
   - `collect_return_position_impl_trait_in_trait_tys`: one entry per RPITIT of an impl method;
   - `associated_types_for_impl_traits_in_trait_or_impl`: one entry per fn with RPITITs in a trait or impl.

   Their construction sites must become `FxKeyedMap` (FxHashMap order) with upstream's construction history, or a
   trait/impl with 2+ RPITIT fns stops UNPORTED at encode. The sites are rustc_hir_analysis
   check/compare_impl_item.ts `collect_return_position_impl_trait_in_trait_tys` and rustc_ty_utils assoc.ts
   `associated_types_for_impl_traits_in_trait_or_impl`. This is a follow-up lane (needs `FxKeyedMap<DefId, _>` with
   `DefId`'s `Hash`, like `Generics.param_def_id_to_index`).

   The other maps my fns iterate are fine:
   - `crate_inherent_impls().inherent_impls`, `doc_link_resolutions`, `doc_link_traits_in_scope`, `DocLinkResMap`,
     the EII map and `foreign_modules` are all `FxIndexMap` upstream (insertion order, JS `Map` / `KeyedMap`);
   - `ambig_module_children` and `reachable_set` are only looked up.
2. **Hand-expanded derives in encoder.ts.**
   - `encode_ForeignModule` and `encode_ExternAbi`: rustc_crate_store is not a serialize set, and tools/codegen does not
     generate rustc_abi's `#[cfg_attr(feature = "nightly", derive(Encodable))]` on `ExternAbi`. The variant order is
     copied from extern_abi.rs:19–:127.
   - `encode_DocLinkResMap`: `IndexMap`'s impl over the TS `[key, value]` map.

   These should move to generated code when those crates get serialize sets. Their decoders (`decode_ForeignModule`,
   `decode_DocLinkResMap` in decoder.ts) are still unported, so the port cannot load its own foreign-module or doc-link
   tables yet.
3. **Contract test:** `ported_by` now has an encoder-c clause. Lanes a/b/d edit the same function, so expect a trivial
   merge there.

## PORT decisions (in the code)

- **Table macros.** `record_some_lazy!` / `record_some!` / `record_value!` / `record_array!` / `record_defaulted_array!`
  are expanded in place, in their evaluation order (value, then `lazy` / `lazy_array`, then the table write). The block
  comment sits above `encode_def_ids`.
- **`encode_mir`'s `filter_map`** is a generator, so `should_encode_mir` runs per key just before that key's bodies, as
  upstream's lazy iterator does.
- **`Res::def_id` on `ModChild.res: Res<!>`** takes `debug_never` for its panic message.
- **`.clone()` / `.cloned()`** of the EII decl and the foreign modules are dropped, because the encoder only reads
  them.
- **Casts of `unknown` query values.** Several query value types are `unknown` in queries.gen.ts and are cast to their
  upstream types: `codegen_fn_attrs`, `generics_of`, `adt_def`, `associated_item`, `opaque_ty_origin`,
  `externally_implementable_items` (`EiiMap`), and so on.
- **`hir::Constness` / `CoroutineKind` / `Asyncness`** use table.ts's stand-in types, the ones the `TableBuilder`s are
  typed with.
