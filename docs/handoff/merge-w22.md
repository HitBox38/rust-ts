# Handoff: merge-w22 (fixer on `integ-w19` after the wave-22 merges)

Branch `integ-w19`, from `977a7e7c`. Commits (oldest first): `fe6ebee8` repoint + codegen, `c134969a` aliasing +
static_pattern_match + contract test vs oracle, `0e83af98` builder tests on real code, `6d92bebb` impossible_clauses,
`b65aecab` merge of `integ-pat` (pat-a + pat-b + pat-c, per root's message), `d9bf2593` post-merge tests,
`4b9adca2` Inline policy, `e5510c45` metadata `Option<Option>` fix, then this handoff.

## 1. Contract test (`src/rustc_mir_build/builder/contract.test.ts`)
- **Why `FatalErrorMarker`**: the test's crate had no `Copy` lang item. The pinned rustc fails the same way on it
  (`error: requires \`copy\` lang_item`). That's the test's minimal crate, not a port bug.
- The runtime test now compiles a no_core crate with the lang items MIR building needs (`copy`, `add`, `eq`, `not`,
  `legacy_receiver`). It has 12 bodies: args, `if`, `let` / destructuring, overflow-checked `+`, tuple and field, call,
  `loop`/`break`, `&&`/`||`/`!`, a tuple `match` with int ranges, an enum, `if let` chains, guards (with `@`, an
  or-pattern, an `if let` guard), `let .. else`, and the operator-trait impl bodies.
  - It runs **`tcx.build_mir_inner_impl`** (check_match with the real rustc_pattern_analysis, check_tail_calls,
    construct_fn) on every body owner, then `dump_mir_for_phase_change`.
  - It compares the `-Zdump-mir=built` files with the pinned rustc's: **12/12 byte-identical**.
  - `construct_error` checks kept. The oracle part skips without rustc and fails under `RUST_TS_REQUIRE_PROBES=1`.
- Per-lane table: **0 stubs left** (`{}`): markers 313, stubs 0. mb-matches-b's last two stubs
  (`static_pattern_match[_inner]`) are ported against pat-b's declarations. scope.rs's `#[const_continue]` path now
  builds the real `RustcPatCtxt`.

## 2. Aliasing (decision 2026-10-22 "MIR build aliasing")
`CFG::push` stores `clone_Statement(stmt)`, and `CFG::terminate` stores `clone_SourceInfo` + `clone_TerminatorKind`.
These are where every statement and terminator enters the MIR, so every `Place` / `SourceInfo` / operand inside is
copied once, as upstream copies it into the statement (cfg.ts header; builder/mod.ts header updated).
- The explicit `clone_Place` calls of mb-expr-a / mb-matches-a/-b are now redundant but harmless; I kept them, since
  they mark upstream's copy points.
- `LocalDecl` / `VarDebugInfo` sites already cloned (mb-mod, mb-matches-b).
- Only test change: mb_mod.test's `toBe(place)` became `toEqual` + `not.toBe`.

## 3. Repoints
- check_match.ts: the `PORT(contract): pending pat-*` block is gone. It imports rustc_pattern_analysis
  (`rustc.ts`, `diagnostics.ts`).
  - `RevealedTy` is pat-b's branded `Ty`: upstream `.inner()` is `RevealedTy.inner(ty)`, and Deref/Display use the value.
  - `RustcPatCtxtState.default()`.
  - `FxIndexSet<RevealedTy>` is a `Set`.
- `PatternNotCovered`: the codegen skip is dropped (types.sets.json), and `mir_build.typemap.json` maps `RustcPatCtxt`
  and `Uncovered` (subdiagnostic). diagnostics.gen.ts is regenerated, and diagnostics.ts's `RustcPatCtxtView` stand-in is gone.
- THIR typemap (`middle_traits_thir.typemap.json`) maps `mir::interpret::AllocId` and `mir::Const` (as `MirConst`).
  - thir.gen.ts is regenerated. Only it changed among the 15 sets using that typemap; checked by regenerating all.
  - The casts are dropped: as_constant (StaticRef), custom/parse/instruction (StaticRef), into.ts (inline-asm `Const`).
  - thir/print.ts's `debug_mir_Const` is no longer `unported`.
- **mb-unsafety's `mir_built` stand-in is kept** (decision below). The real provider now runs MIR building and then
  stops at `LintAndRemoveUninhabited` (mt-built-lints) for every body, so switching would turn all 24 oracle cases
  UNPORTED. Instead, a new test pins the `--real-mir-built` stop (check_unsafety.oracle.test.ts) and the driver header
  explains it. Drop both when mt-built-lints lands.
- Test stand-ins removed, so the tests run real code:
  - into_as_rvalue.test: no `in_scope` capture and no temp/assert/literal stand-ins; it uses `Builder::new` and real
    scopes via `in_scope`.
  - matches_b.test: no `in_scope` capture; `merge_trivial_subcandidates` / `pick_test` are checked against the real
    results.
  - mod_a.test: the two Builder tests that replaced collaborators were dropped. Their paths (`lower_if_condition`,
    `declare_guard_bindings`) are covered by the contract test's oracle comparison. `visit_primary_bindings` stays, on a
    bare Builder.
  - expr_a.test / mb_mod.test: stop pins became real results. Where a hand-built Builder has no scope, upstream's own
    `expect`/`span_bug!` text is pinned.
  - custom_mir.test: `custom_const` moved from PENDING to the matching cases.
  - check_match.oracle.test: lower_pat pins became `Ok`. It adds E0004 / E0005 / unreachable-pattern / int-range cases
    (14/14). The oracle now writes its rmeta into the scratch dir: on macOS `-o /dev/null` makes rustc fail creating a
    temp dir under `/dev`.

## 4. Early pieces (mt-skeleton's layout, stub modules replaced in place)
- `impossible_clauses.ts`: whole file, 5/5. pass_manager.test's stub-module count is 70 → 69; the trivial_const test
  now checks that a const asks `has_impossible_clauses`.
- `inline.ts` (still a stub module for mt-inline): `Inline::policy`, `ForceInline::should_run_pass_for_callee` and
  `ForceInline::policy` are ported, with unit tests. The inliner (`run_pass`) stays stubbed.

## 5. End-to-end MIR (`RUST_TS_AGENT=root-ad4b`)
| suite | run | MATCH / DIFF / UNPORTED / CRASH |
|---|---|---|
| mirdump-minicore (46) | `20261022-134935-root-ad4b-p9g8` | 16 / 0 / 30 / 0 (vs mt-skeleton's `rqyj`: no status change; 29 stops moved later) |
| mirdump-ui `--sample 300` | `20261022-135009-root-ad4b-cwve` | 0 / 0 / 298 / 1 (+1 UNSTABLE); the CRASH is fixed (below) |

Top stops, mirdump-ui sample:
| count | stop |
|---|---|
| 226 | `LintAndRemoveUninhabited (pass not ported)`: the first pass of `mir_built`, after building |
| 41 | `TyCtxt::mk_const_alloc` (string literals; rustc_middle M4 stub) |
| 17 | `mir_borrowck provider` |
| 7 | `eval_to_valtree` |
| 4 | `has_ffi_unwind_calls` |
| 2 | `eval_to_const_value_raw_provider` |
| 1 | `analysis` |

minicore: 26 `LintAndRemoveUninhabited`, 2 `has_ffi_unwind_calls`, 1 `mk_const_alloc`, 1 `eval_to_const_value_raw`.
No pattern-analysis stops are left.

**The mirdump suites can't show built MIR yet** (every body stops at the pass list), so I checked it directly:
- **Method.** `mir_built` writes its `-Zdump-mir=built` file before the pass list. A scratch driver (not committed;
  `$RUST_TS_DATA/tmp/merge-w22/{zz_builtdump_scratch.ts,builtcheck.ts}`) runs the tydump prefix, then
  `build_mir_inner_impl` + `dump_mir_for_phase_change` per `mir_keys` body. Its files are compared with the oracle
  probe's for the same argv + `-Zdump-mir=built`.
- **mirdump-ui sample (300 cases).** The oracle built 1295 bodies; we wrote 1061.
  - 404 are byte-identical.
  - 657 are identical up to the line where the MIR printer stops at unported const-eval: 654 at a `const ()` operand
    (`rustc_const_eval::const_eval::try_destructure_mir_constant_for_user_output`), and 3 in `write_allocations` of a
    static (`Decodable for ConstAllocation` / `mk_const_alloc`).
  - The 234 bodies not written stop at `mk_const_alloc` etc. **0 real divergences.**
- **minicore.** mini_core.rs: 71 of 84 bodies, 67 identical, 4 `const ()`; 13 stop at `mk_const_alloc`.
- **Next unlocks for MIR output**: mt-built-lints (`LintAndRemoveUninhabited`), `TyCtxt::mk_const_alloc` (rustc_middle
  interning; needs an intern key for `Allocation`, whose `SortedMap` carries a `cmp` function), and const-eval's
  `try_destructure_mir_constant_for_user_output` (printing `const ()`).
- **Port bug fixed** (`e5510c45`, rustc_metadata cstore_impl.ts): the `table` arm collapsed `Option<Option<T>>`. A
  present `const_of_item` entry holding `None` looked missing, so `tcx.const_of_item(<extern assoc const>)` panicked
  ("does not have a const_of_item") while building MIR for `u32::MAX`. Case
  `tests/ui/mir/enum/with_niche_int_break.rs` went CRASH → UNPORTED (pass list). No unit test: the table arm decodes a
  real `LazyValue`, so it is covered by that mirdump-ui case.

## 6. Tests and samples
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok.
- Coverage: rustc_mir_build 458/458, rustc_pattern_analysis 223/223, rustc_mir_transform 113/1101; TOTAL 19164/25518.
- `bun test src/rustc_mir_build src/rustc_pattern_analysis src/rustc_mir_transform` (`RUST_TS_REQUIRE_PROBES=1`): 0 fail.
- Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (`RUST_TS_AGENT=merge-w22`, at `e5510c45`, detached): **6005 pass, 1 skip, 0 fail** (6006 tests, 421 files, 2173 s).
- tydump-minicore `20261022-135635-root-ad4b-1xd4`: 45 / 0 / 1 / 0, 0 cases changed vs `9r7y`.
- tydump-ui `--sample 300` `20261022-135738-root-ad4b-vuf3`: 263 / 0 / 36 / 0 (+1 UNSTABLE), 0 cases changed vs `hqwm`.
- hir-tree `--sample 300` `20261022-135943-root-ad4b-r1n6`: 300 / 0 / 0 / 0.
- thirdump-minicore `20261022-135653-root-ad4b-tgnf`: 45 / 0 / 1 / 0; thirdump-ui `--sample 300` `20261022-140640-root-ad4b-9u1q`: 261 / 0 / 38 / 0 (+1 UNSTABLE) (no earlier root-ad4b run of this sample to compare; 0 DIFF).

## 7. Shared files edited (review)
- `tools/codegen/{types.sets.json, mir_build.typemap.json, middle_traits_thir.typemap.json}` and the regenerated
  `src/rustc_middle/thir.gen.ts`, `src/rustc_mir_build/diagnostics.gen.ts`.
- `src/rustc_metadata/rmeta/decoder/cstore_impl.ts` (the table arm).
- `src/rustc_mir_build/thir/print.ts` (`debug_mir_Const` / `debug_AllocId`).
- No harness/ or scripts/ edits.
- Incident: a scratch script with a relative output dir wrote `bc-mc/` / `bc-one/` into the upstream checkout
  (`$RUST_TS_DATA/rust`) for a few minutes. I removed them; `git status` there is clean. The mirdump-ui difftest
  running at the time was unaffected (no DIFF/cache errors).

## `unported(...)` left in files I touched
- `inline.ts`: `Inline::run_pass`, `ForceInline::run_pass` (lane mt-inline).
- None in check_match.ts, scope.ts, matches/mod.ts, cfg.ts or impossible_clauses.ts.

## PORT decisions not yet in docs/state/history.jsonl (phrased for `bun scripts/state.ts record decision`)
merge-w22 (this lane):
1. (merge-w22) MIR build aliasing, refined: `CFG::push` stores `clone_Statement(stmt)` and `CFG::terminate` stores `clone_SourceInfo(si)` + `clone_TerminatorKind(kind)`, so every Place / SourceInfo / operand entering a statement or terminator is copied once there; builder code may reuse its values after pushing.
2. (merge-w22) check_unsafety's test driver keeps its `mir_built` stand-in (thir_body only) until mt-built-lints lands: the real `mir_built` stops at `LintAndRemoveUninhabited` for every body; check_unsafety.oracle.test.ts pins that stop.
3. (merge-w22) rustc_metadata `table` arm: a present entry whose decoded value is `None` is `Some(None)` (PORTING §5 Option<Option<T>>), returned as `None` by `ProcessQueryValue_Option_T` instead of calling `err` (`const_of_item`).
4. (merge-w22) The THIR codegen typemap maps `mir::interpret::AllocId` (mir/interpret/mod.ts) and `mir::Const` (`MirConst`, mir/consts.ts); rustc_mir_build's set maps `RustcPatCtxt` and `Uncovered` and no longer skips `PatternNotCovered`.
5. (merge-w22) `impossible_clauses.rs` and the `Inline` / `ForceInline` policy fns are ported ahead of mt-cleanup / mt-inline, in their stub modules (mt-skeleton's layout); `Vec<Clause>::references_error()` is any element's.

mt-skeleton:
6. (mt-skeleton) `MirPass` / `MirLint` are abstract classes; provided methods are base-class methods; `std::any::type_name::<Self>()` is the abstract `type_name` property (the upstream path; adapters compose it).
7. (mt-skeleton) Pass enums (`SimplifyCfg`, `SimplifyLocals`, `AddCallGuards`, `DeadStoreElimination`, `InstSimplify`, `SimplifyConstCondition`) are classes with one frozen instance per variant tagged `$`; `pub use Enum::*` re-exports are consts (`CriticalCallEdges = AddCallGuards.CriticalCallEdges`).
8. (mt-skeleton) `declare_passes!` / `pass_names!` are expanded by hand: lib.ts `declared_passes()` lists the macro arguments in order; `PASS_NAMES()` is the LazyLock (insertion-ordered Set).
9. (mt-skeleton) An inherent `name` and the `MirPass::name` forwarding to it are one method carrying both markers.
10. (mt-skeleton) `MirPatch` methods clashing with fields get a trailing `_` (`resume_block_()`, ...); `source_info_for_index` returns a copy; `apply` copies a queued `Location` before shifting it.
11. (mt-skeleton) `take_array::<T, N>` takes `N` as a parameter; `&mut Box<[T]>` is `MutRef<T[]>`.
12. (mt-skeleton) `tcx.sess.prof.enabled()` is `prof.profiler !== undefined`; with `-Z self-profile` the pass manager stops UNPORTED.
13. (mt-skeleton) Capacity-only calls (`shrink_to_fit`, `reserve`) are comments; `#[cfg(debug_assertions)]` checks are comments.
14. (mt-skeleton) Pass modules import `./pass_manager.ts`, never lib.ts; pass_manager.ts `require`s `crate::PASS_NAMES` / `validate` / `lint` lazily (init order).

builder lanes:
15. (mb-mod) `ty/closure.ts`'s `CAPTURE_STRUCT_LOCAL` stand-in `Local` brand is cast to mir `Local`; `zip_eq(..).enumerate().map().collect()` is an element loop panicking with itertools' message; `as_done`'s `to_owned()` clones each `BranchSpan`.
16. (mb-scope) `T: DropTreeBuilder` is an impl table passed as `T_` (`DropTreeBuilder_ExitScopes` / `_CoroutineDrop` / `_Unwind`); `assign_blocks`'s local enum is a function-local union; `IndexVec::from_elem` is a filled array; `get_or_insert_with` is `??=`.
17. (mb-scope, mb-matches-c) `mir::Place`'s derived `PartialEq` is a module-local `place_eq` (`local` by value, interned `projection` by identity); `ty::Value ==` compares `ty` / `valtree` by identity. (A shared helper belongs in mir/statement.ts.)
18. (mb-scope) `DropData` (Copy, never mutated) copies share the object; `SourceInfo { span: DUMMY_SP, ..x }` is `new SourceInfo(DUMMY_SP, x.scope)`.
19. (mb-expr-a) `PlaceBuilder` methods taking `self` by value push onto `this.projection` and return `this`; callers that keep the original `clone_PlaceBuilder` first; `base()` returns a copy.
20. (mb-expr-a) `local_info.as_mut().unwrap_crate_local()` writes the `Set` payload `_0` in place (a `Clear` ICEs).
21. (mb-expr-a, mb-expr-b, mb-matches-a) `user_ty.clone()` / `annotation.clone()` of canonical user types share the value (immutable once built); `CanonicalUserTypeAnnotation` clones are field copies.
22. (mb-expr-b) `itertools::zip_eq` is a module-local `zip_eq` in into.ts panicking with itertools' message; `minval_literal`'s `1 << (bits - 1)` is a bigint.
23. (mb-expr-b) A `match` arm with an `if let` guard is evaluated first inside the shared `case`, followed by the plain arm (arm order kept); `unpack!` inside `.map(..)` closures writes the captured `block`.
24. (mb-matches-a) `.into_iter().rev().with_position()` + `is_last()` is a reverse index loop with `is_last = (i === 0)`; `sort_by_key(bool)` is the stable `Array.sort` on false<true; `iter_mut().rev()` is a small reverse generator.
25. (mb-matches-a) `traverse_candidate<C extends Candidate, T, I extends Iterable<C>>`; `push_sub_branch_bindings` takes one shared `Iterator` (upstream `&mut impl Iterator`).
26. (mb-matches-b) `&mut [&mut Candidate]` is a `Candidate[]` of shared objects; sub-slices are `slice()` copies; `Vec::remove(0)` is `splice(0, 1)[0]`, `retain_mut` is `filter`.
27. (mb-matches-b, mb-matches-c) `FxIndexMap<TestBranch, _>` / `FxIndexMap<Place, _>` are `KeyedMap`s keyed by `intern_key`; `perform_test`'s `target_blocks` must be such a KeyedMap.
28. (mb-matches-b) `let [x] = v.try_into().unwrap()` checks the length and panics with rustc's unwrap text; a `try { a?; (..) }` block is an explicit `undefined` check.
29. (mb-matches-c) `assert!(cond, fmt..)` with a formatted message is `if (!cond) panic(msg)` (message built only on failure); `Arc::clone(range)` shares the `PatRange`; `ProjectedUserTypesNode.iter_ops_reversed` returns a `Generator`.
30. (mb-custom-tail) `parse_by_kind!` is expanded at each use (preparse, then an if-chain over the arms in macro order, ending in `Err(expr_error(..))`); its arm guards are local helpers without markers; macro hygiene is kept.
31. (mb-custom-tail) `.collect::<PResult<_>>()` over operands is a local helper stopping at the first `Err`; `ParseCtxt.local_map` / `block_map` are `KeyedMap(key_LocalVarId)`; `as u32` of a u128 literal is `Number(BigInt.asUintN(32, v))`.
32. (mb-check-match) rustc_arena is erased: arena fields hold `null`, `alloc(x)` is `x`; `err = err.and(f())` evaluates `f()` first and keeps it only while `err` is `Ok`; `sort_unstable_by_key(lo_hi)` is a lexicographic comparator.
33. (mb-unsafety) `UnsafetyVisitor` is a class extending thir `Visitor` (field `thir_`); `warnings: &mut Vec` is the shared array; `SafetyContext::UnsafeBlock` is a mutable object (unit variants frozen); `DiagArgValue::StrListSepByAnd(..)` is the local helper `str_list_sep_by_and`.
34. (mb-unsafety, mb-check-match, symbol-mangling) Query values typed `unknown` in queries.gen.ts (`thir_body`, `typeck`, `codegen_fn_attrs`, `type_of`, `fn_sig`, `generics_of`, ...) are cast at the use site with a `PORT:` comment (follow-up: type them in queries.config.json).

symbol-mangling:
35. (symbol-mangling) `trait AbiStableHash` is one fn per type (`abi_stable_hash_<T>(self, tcx, hasher)`), the `[T]` impl takes the element fn; `BaseNString` is a class (`start`, `buf`); `[GenericArg]: TypeVisitable` flag checks are `any` over the elements.
36. (symbol-mangling) `ShimKind` / `InstanceKind` / `Instance` query keys use the `intern_key` of their interned children and DefIds; legacy.ts's `stable_hash_unported` is a `void` `unported(..)` so the following hashing steps keep upstream's control flow.

rustc_pattern_analysis (pat-b conventions, then pat-a / pat-c):
37. (pat-b) `Cx: PatCx` generics are a types bundle: `Cx extends PatCxTypes` (`Ty`, `Error`, `VariantIdx`, `StrLit`, `ArmData`, `PatData`), used as `Cx["Ty"]`; the context is `PatCx<Cx>`; rustc's bundle is `RustcPatCtxtTypes`, and rustc.ts re-exports the instantiations under upstream's alias names.
38. (pat-b) The static side of `PatCx` (`write_variant_name`, the associated types' Debug / PartialEq) is `PatCxStatic<Cx>` on the implementor's prototype; Debug fns of generic types take it (`debug_Constructor(cx)` returns a `Debug`); `Clone` of `Ty` / `StrLit` / `PatData` is the identity.
39. (pat-b) The generic types and their Debug are hand-written (no codegen set); derived Eq/Ord where used are `MaybeInfiniteInt_eq` / `_cmp`, `SliceKind_eq`; diagnostics.rs is generated (set rustc_pattern_analysis).
40. (pat-b) Copy values (`IntRange`, `Slice`, `Constructor`, `PatOrWild`, `MatchArm`, ...) are immutable and shared; `WitnessPat.fields` is the only field written in place. `OpaqueId` / `PatId` are branded numbers from module counters; `FxHashSet<&DeconstructedPat>` keys on the object.
41. (pat-b) `u128` (`MaybeInfiniteInt::Finite`) is bigint; `usize::MAX` compared with slice arities is `Number.MAX_SAFE_INTEGER`.
42. (pat-b) Field/method clashes: `DeconstructedPat`'s `ctor_` / `arity_` / `ty_` / `data_` with getters; `WitnessPat`'s `ctor_` / `ty_`; `Slice`'s `array_len_()` / `kind_()`; `Matrix::rows()` is `rows_()`.
43. (pat-b) `RevealedTy` is a branded `Ty`: `RevealedTy(ty)` casts, `.inner()` / deref are the identity; the `PatCx` impl's `ctor_arity` / `ctor_sub_tys` / `ctors_for_ty` are the inherent methods.
44. (pat-b) Iterators returned by upstream fns are arrays; `fmt` impls return the text; print.rs's `&mut impl fmt::Write` is `MutRef<string>`; nested fns are module-level fns next to their parent; `DroplessArena` is an opaque field.
45. (pat-a) Values consumed by `self` (`WitnessStack::apply_constructor(mut self)`, `single_pattern(self)`) are mutated in place; `PatStack::clone` copies the array only; `head_ty()` returns `Cx::Ty | undefined` (`undefined` = no patterns).
46. (pat-a) `Matrix` Debug: column widths are `utf8_len` (bytes), padding counts chars (as Rust's `{:1$}`).
47. (pat-c) `fmt::Arguments` given to `bug` / `delayed_bug` is the formatted string; `mod print;` is a namespace import; shadowed locals get `_` suffixes; `lower_pat`'s `Binding { subpattern: Some }` / `Guard` and `Binding { None }` share one case; print.ts writes into a `String` whose `fmt::Write` never fails (`PRINT_OK`).
48. (pat-c) `Ty::numeric_max_val` (declared returning `ty::Const`, upstream `mir::Const`) is cast to `mir::Const` in rustc.ts; its body (`mir::Const::from_bits`) is unported (rustc_middle ty/util.ts).
