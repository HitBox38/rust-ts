verdict: APPROVE-WITH-NOTES

Review of lane gaps-30c (`git diff main...lane/gaps-30c`, 13 commits, 42 files). Reviewed in a scratch worktree at
lane/gaps-30c (since removed).

## What I checked and ran

- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (22800; vendor 4483).
- Every `// std:` marker in `src/std/slice_sort.ts` resolves to the `fn <name>` line at the pin (scripted check, 0 bad).
- `RUST_TS_REQUIRE_PROBES=1 bun test src/std/slice_sort.test.ts`: 3 pass. This compares `sort_unstable_by` with the pinned
  std for 6 layouts × 33 lengths (up to 5000) × 5 shapes × 2 comparators.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_pattern_analysis/rustc.test.ts src/rustc_lint/late_c.oracle.test.ts`: 19 pass.
- difftest `--suite mir --filter`: lint-if-let-rescope 4/4, scalable-vector 27/27, method-on-never 1/1, clone-never 1/1,
  question-mark-type-inference-in-chain 1/1 MATCH. `--sample 60`: 59 MATCH, 1 UNPORTED, 0 DIFF.
- `bun tools/codegen/queries.ts --check`: queries.gen.ts is up to date.
- Nothing under `harness/`, `scripts/` or `harness/baseline/` changed. The `tools/codegen` changes are JSON config only;
  no generator code changed.

## Findings

1. `src/std/slice_sort.ts:84-433, 990-1270`: ipnsort port. **Non-blocking (no change needed).** I compared it line by line
   with unstable/mod.rs:114, quicksort.rs:21/93/139/154/245, heapsort.rs:10/37 and smallsort.rs:77-170/199/205/311/380/420/469/858.
   Control flow, thresholds (16/32/48/32, 4096, 96, unroll `size_of <= 16`), the `ancestor_pivot` / `!is_less(b, a)`
   equal-partition path, the heapsort loop bounds, and `swap_if_less`'s read/copy order all match. The sort9/sort13 tables
   match upstream's `swap_if_less` call sequences exactly (scripted comparison). Equal elements end up in the same order:
   in the Lomuto cyclic partition, `right_val` is read before the gap write. That gives the same values as upstream,
   because `gap.pos` never equals `state.right`. The `GAP_VALUE` sentinel becomes `0` after the last `right + 1`, but the
   loop breaks right after, so nothing reads it. The Hoare gap restore runs after `num_lt` is computed, as the drop does.
   Taking `pivot` / `ancestor_pivot` by value is sound: neither slot is moved while it is referenced. The oracle test
   covers the network, general and fallback small-sorts, both partitions, both unroll widths and the non-Freeze path.
   Equal-key ties under the non-transitive "arity" comparator also match the oracle.
2. `src/std/slice_sort.ts:24-28, 1046-1052`: `SortLayout.copy?` and its `unported`. **Non-blocking.** The `unported` is
   correct: no value is guessed, and it fires only for a Freeze element type over more than 20 elements with no `copy`.
   All 4 fixed unstable call sites set `copy` correctly: `Span` is Copy (builtin.ts:1825); `(Span, String, String)`,
   `(String, DefId)` and `(DefId, String)` are not Copy. `SortedMap::from_iter` (sorted_map.ts:347) takes the layout from
   its callers, and none exist today. Suggestion for root: make `copy` required, so tsc enforces it at every new layout
   instead of it failing at runtime only for long inputs.
3. `src/std/slice_sort.ts:990-1031`: `unstable_small_sort_threshold` / `unstable_small_sort` fold three specialization
   impls (smallsort.rs:77/82, :92/97 → :115/124 or :144/157) into one function. Each has one marker (:92 / :97) and
   comments naming the other arms. They are named `unstable_quicksort` / `unstable_small_sort*` to avoid clashing with the
   stable port. **Non-blocking.** This is a reasonable rendering of specialization. It deserves a `// PORT:` line on the
   rename (the handoff mentions it only implicitly).
4. `src/rustc_hir_typeck/method/probe.ts:261-281`: the hand-written `#[derive(Diagnostic)]` for `MissingTypeAnnot` /
   `MethodCallOnDivergingInferenceVariable`. **Non-blocking, needs a root decision.** The texts match probe.rs:404-411
   exactly ("type annotations needed"; "method call on a diverging inference variable" + help "consider providing a type
   annotation"). The shape is identical to the generated unit-struct derives (`Diag.new(.., Inline ..)`, `diag.help(..)`,
   `{ into_diag }`). The 3 affected mir cases MATCH. However, PORTING.md §5 says `#[derive(Diagnostic)]` is generated and
   "do not port these by hand". The lane marked it `// PORT:` but there is no recorded decision. Root should either
   record a decision allowing hand-written fn-local derives, or queue a tools/codegen follow-up to see fn-local
   `#[derive(Diagnostic)]` items and then replace these.
5. `src/rustc_pattern_analysis/rustc.test.ts:252`: `usize_max_plus_one` moved from the pinned `<unported: ...from_bits>`
   to `usize::MAX.. (wildcard: false)`. **Non-blocking (correct, and stronger).** The old expectation pinned a gap. The new
   one is upstream's documented rendering (rustc.rs comment "We show this to the user as `usize::MAX..`") and the oracle's
   own wording (tests/ui/feature-gates/feature-gate-precise_pointer_size_matching.stderr: "`usize::MAX..` not covered").
   The `(wildcard: false)` suffix follows the same format as the neighbouring Finite-range lines. The line is not checked
   live against the oracle, as before (the live check covers only `w1..w14`).
6. `src/rustc_lint/late_c.oracle.test.ts:231-245`: "if_let_rescope fires" moved from BLOCKED to CASES. **Non-blocking
   (correct).** CASES compile each source with the oracle and with rust-ts and compare them, so this adds a live oracle
   check rather than weakening one. The test passes with probes required, and the `expect` text is unchanged.
   `BLOCKED` is now an empty array.
7. `tools/codegen/*.json`. **Non-blocking (correct in general).**
   - `type_fold.json`: the 5 new alias entries are written over the generic derived impls (`OutlivesClause<A>` at
     `Region` / `Ty`, `Binder` over `ExistentialTraitRef` / `ExistentialProjection`, and `Alias<AliasTermKind>`). They
     match the predicate.rs:12-33 type aliases, so they are right for any field of these types, not only for
     WithWhereClauses and ValuePairs.
   - `tyir.typemap.json`: `I::LocalDefIds` Debug is `debug_RawList(.., debug_LocalDefId)` (list.rs:192 over the
     element). This is general.
   - `infer.typemap.json`: `RegionConstraint` Debug uses the generated derive_where Debug (rustc_type_ir predicate.rs:47).
   - `types.sets.json` + `stable_hash.json`: DiffMode / DiffActivity are generated with discriminants in upstream variant
     order (autodiff_attrs.rs:24/:46), and RustcAutodiff now hashes them.
   - `queries.config.json`: one key mapping, and the regenerated file is up to date.
   As with gaps-30b, the hand-copied query key table must be rechecked on a re-pin.
8. `src/rustc_infer/infer/mod.ts:1261-1278` and its 4 callers: optional `debug_T`. **Non-blocking.** The message texts
   match mod.rs:1517/1520 (`bug!` and `delayed_bug` "`{value:?}` is not fully resolved"). The Debug of each caller is the
   right derived impl: `Ty`, `GenericArgs`, `Vec<Clause>`, and `(Vec<Clause>, Vec<(Clause, Span)>)` (refine.rs:192).
   Without `debug_T` it stays `unported`. All callers pass one, so a follow-up could make it required.
9. `src/rustc_target/callconv/x86_win64.ts`: a faithful port of x86_win64.rs:8. **Non-blocking (no change needed).** The
   arm order is correct: `Memory{sized:false}` before `ScalarPair | Memory{sized:true}`. The sizes match, the i128 return
   rule matches including the `RustcAbi::Softfloat` exemption, and so do the ZST `is_repr_c` handling and
   `pass_indirectly_in_non_rustic_abis`. `Size.bits()` returns `number`, so the `switch` cases are sound. Both the Win64 and
   `is_like_windows` arms are wired (callconv/mod.ts:863-867).
10. `src/rustc_resolve/lib.ts:199-206`, `late/diagnostics.ts:884`, `rustc_middle/ty/{util,sty,predicate,print/pretty}.ts`,
    `query/keys.ts`, `rustc_lint/if_let_rescope.ts`. **Non-blocking (no change needed).** Each replaces a stand-in with
    the ported upstream fn:
    - `HasAttrs for DefId`, mod.rs:2349, with the local branch going to `hir_attrs`.
    - `get_diagnostic_name`, diagnostics.rs:859-860.
    - `mir::Const::from_bits`, with `numeric_{max,min}_val` returning `mir::Const` as util.rs:1152/1160.
    - `NumScalableVectors`.
    - `Display for Binder<TypeOutlivesClause>`, through ir_print.rs:85 → the generic `IrPrint` → `Print for Binder` /
      `OutlivesClause` (pretty.rs:2956/2965), the same pattern as `display_PolyFnSig`.
    - the `(ValidityRequirement, PseudoCanonicalInput<Ty>)` key: `default_span` DUMMY_SP (keys.rs:412) and the tuple
      Debug.
    - the significant_drop_order fns.

    The lazy `require`s (util.ts, keys.ts, pretty.ts) have documented init-order reasons.
11. Handoff note for root: regenerating all type sets writes an untracked `src/rustc_lexer/lib.gen.ts`. The lane deleted
    it. **Non-blocking.** This is worth a look in tools/codegen, which is outside this lane.

Sample claims are plausible: my own filter runs reproduce MATCH on the lane's cases, and my 60-case mir sample shows no
DIFF and no lost MATCH.
