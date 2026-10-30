verdict: APPROVE-WITH-NOTES

Lane **encoder-c** (wave 33), branch `lane/encoder-c` (head a41fd649, base adaa9d4a), plus its merge into integ-w33 (0747b6f1).
Line numbers are from `lane/encoder-c`.

## What I checked

- **16 fns.** I compared all 16 fns, encoder.rs :1482–:2030, line by line with upstream at the pin.
  - The fn order and markers are correct. `coverage.ts --check` reports "markers ok (23080; vendor 4680)". `--missing` lists nothing in :1482–:2030.
  - **`encode_def_ids`:** every table, in upstream order, under the same predicate:
    - the AnonConst `ConstArg`/`Infer(Const)` skip, then `default_fields`;
    - span, attrs, expn, ident span, `has_codegen_attrs`, visibility;
    - the stability quad, variances, fn_sig;
    - generics, explicit_clauses, inferred_outlives (defaulted), then the const param defaults;
    - `is_conditionally_const`, type_of, constness, Fn/AssocFn asyncness and arg idents, intrinsic, object_lifetime_default;
    - Trait, then TraitAlias, then Trait/Impl assoc items;
    - coroutine_kind, coroutine_for_closure / by-move body;
    - Static, with the `Reported` and `TooGeneric` arms;
    - ADT/Mod/Macro, TyAlias (checked twice, as upstream), OpaqueTy, AssocTy by container, AnonConst, Const/AssocConst;
    - the RPITIT tables;
    - then the inherent_impls, doc_link_resolutions and doc_link_traits_in_scope loops.
  - The macro expansions map to the right TableBuilder calls:
    - `record_some_lazy!` / `record_array!` → `set_some`;
    - `record_value!` / `record_defaulted_array!` → `set`;
    - `record_value!(coroutine_kind <- Some(ck))` is `set(i, ck)` on a `CoroutineKind | undefined` table, which is correct for an optional table.
  - The three trailing loops iterate `FxIndexMap`s upstream: `CrateInherentImpls.inherent_impls` (ty/mod.rs:2402) and `ResolverGlobalCtxt.doc_link_*` (resolve.rs:191-192). JS `Map` insertion order is therefore correct.
  - **`encode_mir` (D5):**
    - the `encode_opt` branch (optimized_mir, cross_crate_inlinable, closure names, witnesses) and the `encode_const` branch (trivial_const / mir_for_ctfe, thir_abstract_const, should_encode_const → mir_const_qualif + rendered_const) are both faithful;
    - so are `!is_trivial` → promoted_mir and the second witnesses write, which upstream also duplicates;
    - the `deduced_param_attrs` guard (`should_codegen && optimize != No && incremental none`) is faithful too;
    - the lazy `filter_map` is kept lazy with a generator, so `should_encode_mir` runs per key, interleaved with that key's encoding, as upstream.
  - `empty_proc_macro!` → `return LazyArray.default()` is correct. `encode_info_for_mod` is correct: the proc-macro branch, the non-reexport / reexport split and `ambig_module_children` via `map_or_default`. `encode_info_for_adt` is correct: enum children, `VariantData`, field safety / mut_restriction, the `CtorKind::Fn` fn_sig, and both destructors. `encode_info_for_assoc_item` is correct, and so are the stability ×3 (the `staged_api || force_unstable_if_unmarked` guard), deprecation, macro, native libs and foreign modules.
- **CodegenFnAttrs encoders** (codegen_fn_attrs.ts).
  - `encode_CodegenFnAttrs` (:314) follows upstream field order, codegen_fn_attrs.rs :65–:85. It mirrors `decode_CodegenFnAttrs` exactly. `Align` is `pow2: u8`, per `Encodable_NoContext` on rustc_abi `Align`.
  - These also check out against upstream:
    - `TargetFeature`: name, kind;
    - `TargetFeatureKind`: Implied 0, Enabled 1, Forced 2;
    - `PatchableFunctionEntry`: prefix, entry, section;
    - `SanitizerFnAttrs`: disabled, rtsan_setting;
    - `CodegenFnAttrFlags`: u32;
    - mono `Visibility` (mono.rs:385): Default, Hidden, Protected, Interposable.
  - Enum tags are `emit_u8`, matching rustc_macros serialize.rs:240 (fewer than 256 variants).
- **Hand-written encoders.**
  - `encode_ExternAbi`: the 30-variant order matches extern_abi.rs:19–:96 exactly. The `unwind` field is present for exactly C, System, Aapcs, Cdecl, Stdcall, Fastcall, Thiscall, Vectorcall, SysV64 and Win64. The tag is `emit_u8`.
  - `encode_ForeignModule`: foreign_items, def_id, abi, matching cstore.rs:138.
  - `encode_DocLinkResMap`: the length, then each `(Symbol, Namespace)` key and `Option<Res<NodeId>>` value in insertion order. That is `impl Encodable for IndexMap`.
- **Harness, scripts, tools:** `git diff main...lane/encoder-c -- harness scripts tools` is empty. No baseline or suite changes.
- **Build and tests:** `bunx tsc --noEmit -p .` is clean on lane/encoder-c and on integ-w33. `encoder_c.test.ts` and `encoder_contract.test.ts` give 9 pass, 0 fail on both.
- **Sample:** `difftest --suite mir --sample 40` (agent rev-encoder-c) gave 40 MATCH, 0 DIFF/UNPORTED (run 20261030-200220-rev-encoder-c-n0ff). This fits the handoff's claim of identical per-case statuses. encoder.ts is not loaded at startup on this branch, and codegen_fn_attrs.ts only gained functions.
- **integ-w33 merge (0747b6f1).**
  - I compared the import names and top-level declarations of encoder.ts in lane/encoder-c, in its integ parent b3e227f9 and in the merge result. Nothing from either side is missing, and nothing new appeared.
  - The encoder-c range (:1482 → :2036 markers) is byte-identical between the lane and the merge.
  - Two duplicates were resolved toward encoder-c's versions:
    - `encode_Visibility_LocalDefId`: same behaviour;
    - `encode_DocLinkResMap`: the real impl replaces encoder-d's `unported` stub, which is the right choice.
  - The contract test's dropped `encode_mir` / `encode_metadata` stub probes are justified, since both are ported now.

## Findings

1. **encoder.ts:1439 and :1443 (`encode_DefIdMap_EarlyBinder_Ty` / `encode_DefIdMap_Vec_DefId`), reached from :828 and the next table write. Non-blocking.**
   - I confirm the lane's finding. Upstream `DefIdMap` = `UnordMap`, which derives `Encodable_NoContext` over its inner `FxHashMap` (unord.rs:452). Those two tables are therefore written in hashbrown order. That contradicts plan-m5 §1d ("nothing in the encoder iterates hash maps").
   - The port routes through `encode_HashMap`, which stops UNPORTED for a non-`FxHashMap` with more than one entry (serialize.ts:803). No order is guessed, so this is correctly handled for now.
   - The follow-up root queued is needed. The two producer sites need `FxKeyedMap` with upstream insertion history. Until then, any trait/impl with 2+ RPITIT fns, or any impl method with 2+ RPITITs, stops UNPORTED at encode.
2. **encoder.ts:1461 / :1478 / :1486 (hand-expanded `DocLinkResMap` / `ForeignModule` / `ExternAbi` encoders). Non-blocking.**
   - Verified correct (see above).
   - They are hand-written derive expansions, which PORTING §5 says tools/codegen should generate. They carry `// PORT:` reasons and are listed for root.
   - Their decoders are still unported. Only the test's byte pin covers the foreign-module bytes, and no round trip covers the doc-link map. They should move to generated code when rustc_crate_store / rustc_abi get serialize sets.
3. **encoder.ts:1473 (`encode_NativeLib` is `unported`). Non-blocking.**
   - This is a correct gap, not a guess. It is reached by any crate with `#[link]` / native libs; std has them.
   - Record it as a known stop for M5 std metadata.
4. **encoder.ts:626 and others: `as CodegenFnAttrs` / `as Generics` / `as AdtDef` / `as EiiMap` / ... casts of query values typed `unknown` in queries.gen.ts. Non-blocking.**
   - These match upstream types, and the lane declared them as a PORT decision.
   - However, tsc cannot catch a provider whose real value shape differs. It would be better to type those query values in the generator over time.
5. **codegen_fn_attrs.ts:314 and others (out-of-file edit in rustc_middle). Non-blocking.**
   - The lane edited a file outside encoder.ts, adding only encode functions next to the existing decoders. The handoff declares it, and the module comment documents it.
   - It is verified correct and additive. Root should treat it as accepted ownership drift.
6. **encoder_contract.test.ts:91 (`ported_by` range `1482 <= line < 2064` also covers `encode_hygiene` :2036). Non-blocking, cosmetic.**
   - It is harmless, because the `SPAN_HYGIENE` check runs first, so :2036 still reports `encode-span-hygiene`.
   - The comment says `:1482-:2030`, but the range is wider than the lane's fns.
