# Handoff: pat-b (M4 wave 22, rustc_pattern_analysis 1/3): the crate's foundation

Branch `lane/pat-b` (from `7d76ddd0`, no merges). Commits: `a04ddc42` (declarations first, for mb-check-match: crate
skeleton, `PatCx` contract, constructor.rs / pat.rs / lib.rs / diagnostics.rs ported, stubs of the other files,
`RustcPatCtxt` + `analyze_match`), `f3fe4dee` (crate tests + contract test), then this handoff.

## Result
- **New crate `src/rustc_pattern_analysis/`** (upstream `compiler/rustc_pattern_analysis/src/**`, 10 files, 188 fns):
  - ported (pat-b): `lib.ts` 14/14 (`PrivateUninhabitedField`, `PatCx` + `PatCx_provided`, `MatchArm`),
    `constructor.ts` 34/34 (`MaybeInfiniteInt`, `IntRange` + `split`, `SliceKind`, `Slice` + `split`, `OpaqueId`,
    `Constructor` + `is_covered_by` / `fmt_fields`, `VariantVisibility`, `ConstructorSet` + `split` / `all_empty`,
    `SplitConstructorSet`), `pat.ts` 31/31 (`PatId`, `IndexedPat`, `DeconstructedPat`, `PatOrWild`, `WitnessPat`, their
    Debug), `diagnostics.ts` 1/1 (`Uncovered_new`; the 9 diagnostic types are generated, `diagnostics.gen.ts`).
  - declared (types with all fields + stub fns): `usefulness.ts` 0/56, `pat_column.ts` 0/6, `lints.ts` 0/2,
    `checks.ts` 0/2 (lane pat-a); `rustc.ts` 9/38, `rustc/print.ts` 0/4 (lane pat-c). Ported glue in rustc.ts:
    `RevealedTy` Display / Debug / Deref / `inner`, `RustcPatCtxt` Debug, the three trait methods that are the
    inherent ones (rustc.rs:902/905/912, see conventions), and `analyze_match` (rustc.rs:1067).
  - Markers 89, stubs 99 (`// stub: <path>:<line> <name> (lane <lane>)` over the final signature, body
    `unported("rustc_pattern_analysis::<module>::<Type>::<name>")`).
- **Crate tests** (upstream `tests/`, all 35 fns ported): `tests/common/mod.ts` (the tests' own `PatCx` `Cx`, `Ty`,
  `pats` / `pat` builders), `tests/exhaustiveness.test.ts`, `tests/intersection.test.ts`, `tests/complexity.test.ts`.
  The 8 upstream tests need `compute_match_usefulness` (pat-a) and are `test.skipIf(!USEFULNESS_PORTED)` until then
  (`USEFULNESS_PORTED` probes the stub). **pat-a: drop `USEFULNESS_PORTED` and the `skipIf`s** when usefulness.rs is
  ported, so they can never be skipped silently later.
- **Contract test** `src/rustc_pattern_analysis/contract.test.ts` (10 tests): scan = coverage (every fn ported or a
  stub, never both; stub bodies name their own module; per-lane counts = the split table), constructor splitting on the
  upstream doc examples (constructor.rs:21 ranges, :517 slices), `ConstructorSet::split` cases, `is_covered_by`,
  `DeconstructedPat` (pats!, Debug, specialize incl. the `VarLen` suffix shift, walk, or-patterns), `WitnessPat` Debug on
  the witnesses tests/exhaustiveness.rs expects, `analyze_match` stopping at `RustcPatCtxt::reveal_opaque_ty`.

## Split table (fill lanes; upstream lines)
| lane | upstream (compiler/rustc_pattern_analysis/src/) | stubs | notes |
|---|---|---|---|
| pat-a | usefulness.rs (56), pat_column.rs (6), lints.rs (2), checks.rs (2) | 66 | module doc of usefulness.rs (1-709) comes with the port |
| pat-c | rustc.rs (29), rustc/print.rs (4) | 33 | `analyze_match` already ported; first stop `reveal_opaque_ty` |

How to fill a stub: replace the `unported(..)` body in place, turn `// stub:` into `// rustc:`, lower the counts in
contract.test.ts (`markers` / `stubs` / per lane). Keep the signatures; a wrong one goes in your handoff (or fix it and
say so). usefulness.ts and rustc.ts headers repeat this.

## Conventions (lib.ts header; please record as decisions)
1. **`Cx: PatCx` generics are a types bundle.** `Cx extends PatCxTypes` (`{ Ty, Error, VariantIdx: number, StrLit,
   ArmData, PatData }`), used as `Cx["Ty"]`; the context object is `PatCx<Cx>` (an interface). `fn f<Cx: PatCx>(cx: &Cx)`
   is `function f<Cx extends PatCxTypes>(cx: PatCx<Cx>)`. rustc's bundle is `RustcPatCtxtTypes` (rustc.ts), the tests'
   `CxTypes`. rustc.ts re-exports the rustc instantiations under the upstream alias names (`Constructor`,
   `DeconstructedPat`, `MatchArm`, `WitnessPat`, `UsefulnessReport`, ..) with the companion values (`Constructor.Ref`).
2. **The static side of `PatCx`** (what Rust reaches through the type: `Cx::write_variant_name` and the `Debug` /
   `PartialEq` bounds of the associated types) is `PatCxStatic<Cx>` (`write_variant_name`, `debug_Ty`,
   `debug_VariantIdx`, `debug_StrLit`, `debug_ArmData`, `StrLit_eq`). `PatCx` extends it; implementors define it on the
   prototype, so `RustcPatCtxt.prototype` / `CX_STATIC` serve where only the type is known. Debug fns of generic types
   take it: `debug_Constructor(cx)`, `debug_DeconstructedPat(cx)`, `debug_WitnessPat(cx)`, `debug_PatOrWild(cx)`,
   `debug_MatchArm(cx)`, `debug_SplitConstructorSet(cx)` return a `Debug<..>`. `Clone` of `Ty` / `StrLit` / `PatData` is
   the identity (all implementors' values are `Copy` or references).
3. **Provided methods** are `PatCx_provided.<m>(self, ..)` (PORTING §8); implementors that keep a default forward to it
   (`exhaustive_witnesses() { return PatCx_provided.exhaustive_witnesses(this); }`).
4. **Hand-written types and Debug, no codegen set** for the generic types (codegen does not instantiate `Cx`); derived
   `PartialEq` / `Ord` where used are `MaybeInfiniteInt_eq` / `MaybeInfiniteInt_cmp` / `Option_MaybeInfiniteInt_eq` /
   `SliceKind_eq`. diagnostics.rs is generated (codegen set `rustc_pattern_analysis`).
5. **Enums** are `$`-tagged unions with companion consts (unit singletons + methods: `Constructor.is_covered_by(self, cx,
   other)`, `ConstructorSet.split(self, ctors)`, `PatOrWild.specialize(self, ..)`, `MaybeInfiniteInt.plus_one(self)`,
   `SliceKind.arity(self)`); `RangeEnd`, `VariantVisibility`, `PlaceValidity`, `Presence` are string unions. Copy values
   (`IntRange`, `Slice`, `SliceKind`, `MaybeInfiniteInt`, `Constructor`, `PatOrWild`, `MatchArm`) are immutable, so a
   Rust copy may share the object; `WitnessPat.fields` is the only field written in place.
6. **Ids**: `OpaqueId` / `PatId` are branded numbers from module-level counters (upstream `static AtomicU32`); `PatId`
   keys `Map`s directly; `FxHashSet<&DeconstructedPat>` keys on the object (one object per `uid`, = its `Eq`/`Hash`).
7. **Numbers**: `u128` (`MaybeInfiniteInt::Finite`) is `bigint`; `usize::MAX` (only compared with slice arities) is
   `Number.MAX_SAFE_INTEGER`.
8. **Field / method name clashes**: `DeconstructedPat`'s private fields are `ctor_` / `fields` / `arity_` / `ty_` /
   `data_` (getters `ctor()` / `arity()` / `ty()` / `data()`), `WitnessPat`'s `ctor_` / `fields` / `ty_`; `Slice`'s
   rust-analyzer getters are `array_len_()` / `kind_()` (fields `array_len` / `kind`); `Matrix::rows()` is `rows_()`;
   the tests' `Cx.exhaustive_witnesses` field is `exhaustive_witnesses_`.
9. **`RevealedTy`** is a branded `Ty` (`#[repr(transparent)]` + `Deref`): `RevealedTy(ty)` casts, `inner()` / deref
   are the identity, `Ty` methods apply directly. The `PatCx` impl's `ctor_arity` / `ctor_sub_tys` / `ctors_for_ty`
   (`self.ctor_arity(ctor, *ty)` ..) are the inherent methods (same TS method); their markers sit in the class body.
10. **Iterators** returned by upstream fns are arrays; `fmt::Formatter` is `Fmt` and `fmt` impls return the text;
    `fmt::Arguments` given to `bug` / `delayed_bug` is the formatted string; print.rs's `&mut impl fmt::Write` is a
    `MutRef<string>` and `fmt::Result` is rustc_middle's `PrintResult`.
11. `DroplessArena` (rustc_arena) is erased: `RustcPatCtxt.dropless_arena: unknown` stays as a field (check_match
    passes its own); `alloc_from_iter` is the array. Nested fns (`reveal_inner`, `reveal_and_alloc`, `expand`) are
    module-level fns next to their parent.
12. `pats!` / `pat!` (tests) take the macro input as a string parsed with the macro's grammar (`pats(ty, "(true, _)")`).

## For mb-check-match (uses these now)
`import { analyze_match, RustcPatCtxt, RustcPatCtxtState, type DeconstructedPat, type MatchArm, type WitnessPat,
type RedundancyExplanation, type Usefulness, type UsefulnessReport, type RevealedTy, Constructor } from
"../../../rustc_pattern_analysis/rustc.ts"` and `Uncovered_new` / `type Uncovered` from `rustc_pattern_analysis/diagnostics.ts`.
`new RustcPatCtxt(tcx, typeck_results, module, typing_env, dropless_arena, match_lint_level, whole_match_span,
scrut_span, refutable, known_valid_scrutinee, RustcPatCtxtState.default())` (`internal_state: Default::default()`).
`cx.lower_pat(pat)`, `cx.print_witness_pat(w)`, `cx.is_uninhabited(ty)`, `cx.is_foreign_non_exhaustive_enum(ty)` are
pat-c stubs. rustc_mir_build's codegen set can now drop the `PatternNotCovered` skip (type-map
`rustc_pattern_analysis::diagnostics::Uncovered` → `rustc_pattern_analysis/diagnostics.gen.ts`) and map
`RustcPatCtxt` (tools/codegen/mir_build.typemap.json, now `unknown`) to rustc.ts; that is their set, not edited here.

## unported(...) left
Only the 99 stubs of the split table (pat-a 66, pat-c 33); none in pat-b's files.

## PORT decisions (in code)
- constructor.ts: `Presence` / `RangeEnd` / `MaybeInfiniteInt` representations; `USIZE_MAX`; `IntRange::split` builds
  the output array (sort comparator = the tuple `Ord`); `Slice::split`'s `&mut` bindings into `max_slice` are locals
  written back before `max_slice` is read again; the four float arms of `is_covered_by` share one branch
  (`PartialOrd::ge` is the local `ge`); `fmt_fields` takes the fields' `Debug` and the static side, and writes fields
  with a fresh `Fmt` (`{:?}`); `ConstructorSet` keeps an unused `Cx` parameter for the signatures.
- pat.ts: field renames (convention 8); `PatOrWild::clone` returns the value (never written in place);
  `DeconstructedPat::hash` writes the `uid` (`Map`/`Set` key on the object).
- lib.ts: `PrivateUninhabitedField(skip)` returns shared frozen values; `IndexVec` re-export is moot.
- rustc.ts: `analyze_match`'s shadowing `scrut_ty` is `scrut_ty_`; convention 9/11.
- diagnostics.ts: `Uncovered::new` is `Uncovered_new` (generated interface).

## Shared files edited (review)
`tools/codegen/types.sets.json`: new set `rustc_pattern_analysis` (diagnostics.rs; 9 diagnostic derives, 0 unknown
types). Regenerate with `bun tools/codegen/types.ts rustc_pattern_analysis`. Scope: nothing to change; harness/scope.json
lists only excluded crates, so the crate is counted as soon as it exists (`coverage.ts --missing` works).

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (19119; vendor 4196).
- Coverage: lib.rs 14/14, constructor.rs 34/34, pat.rs 31/31, diagnostics.rs 1/1, rustc.rs 9/38, usefulness.rs 0/56,
  pat_column.rs 0/6, lints.rs 0/2, checks.rs 0/2, rustc/print.rs 0/4; tests/common/mod.rs 15/15, exhaustiveness.rs 9/9,
  intersection.rs 4/4, complexity.rs 7/7.
- `bun test src/rustc_pattern_analysis`: 10 pass, 8 skip (the upstream tests, until pat-a), 0 fail.
- Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (`RUST_TS_AGENT=pat-b`): 5788 pass, 9 skip (8 of them the crate tests above), 0 fail, 401 files (3981 s, machine load ~80; a first run was killed from outside, exit 144, and rerun).

## Samples (`RUST_TS_AGENT=root-ad4b`, vs root's base runs)
| suite | lane run | M / D / U / C | base |
|---|---|---|---|
| tydump-minicore | `20261022-105940-root-ad4b-nqbr` | 45 / 0 / 1 / 0 | `20261022-101651-root-ad4b-9r7y`: 45 / 0 / 1 / 0 |
| hir-tree `--sample 200` | `20261022-110016-root-ad4b-y0p9` | 200 / 0 / 0 / 0 | 0 DIFF (root) |

No change, as expected: nothing reaches the crate until mb-check-match and pat-c land.
