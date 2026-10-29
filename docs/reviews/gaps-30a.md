verdict: APPROVE-WITH-NOTES

Reviewer: independent review of lane gaps-30a (`git diff main...lane/gaps-30a`, head 38609692, base bbbe6dd3).

## What I checked

- **Upstream fidelity**, against `.data/rust` at the pin:
  - `ty_is_opaque_future` (context.rs:2099), `get_impl_future_output_ty` (context.rs:2851), `impl Relate for ty::Expr`
    `relate` (rustc_middle ty/relate.rs:102) and `select_inherent_assoc_candidates` (fn_ctxt/mod.rs:319): each one follows
    upstream's control flow, arm order and values.
  - `ExprKind` payloads (`BinOp`, `UnOp`, `abstract_const::CastKind`) are all string-literal enums, so `===` is the
    derived `PartialEq`.
  - `Option<Option<Ty>>::flatten` through `no_bound_vars(.., fold_Option(fold_Ty))` matches upstream (both `None`s
    continue the `find_map`).
  - `predicates_for_generics` is lazy (a generator) like upstream's iterator, so normalization still happens inside
    `register_obligations`.
- **No invented behaviour:** each stop replaces an `unported(...)` with the upstream body, and no guessed values are
  added. The `partial_descriptor` fallback still calls `unported` for callers that cannot pass the visit impl.
- **Markers:** `bun scripts/coverage.ts --check` reports `markers ok (22799; vendor 4483)`. Coverage is context.rs 202/202,
  fn_ctxt/mod.rs 26/26 and rustc_middle relate.rs 3/7. The 4 missing in relate.rs are older unmarked stand-ins
  (:12, :92, :127, :148), as the handoff says. The new `relate.rs:102 relate` marker points at the `fn` line.
- **Generator:** I regenerated all 15 `derive_type_fold` sets in a scratch worktree. The output is byte-identical to the
  branch (clean `git status`), so the 5 committed `.gen.ts` files are what the generator produces. Their only change is
  the extra `visit_with_*` argument (14 lines), with no import changes. All 19 generated `(try_)fold_with_Binder` calls
  now pass a visit impl.
- **Protected files:** nothing under `harness/`, `scripts/` or `harness/baseline` changed.
- **Type check:** `bunx tsc --noEmit -p .` is clean on the branch.
- **No-loss argument:** every behavioural change in this batch replaces a path that used to end in `unported(...)`.
  - That covers the 4 stops, and also the Binder visit fallback, which `relate_Binder` and the generated callers now
    pass.
  - A case that was MATCH before could not have reached any of those paths, so structurally no MATCH can be lost.
- **Spot difftests** (`RUST_TS_AGENT=rev-gaps-30a`, `--filter`):

| suite | filter | result |
|---|---|---|
| mir | unsafe-binders | 18/18 MATCH |
| mir | generic_const_exprs | 142/147 MATCH |
| mir | associated-inherent-types | 68/68 MATCH (stop 4) |
| borrowck-ui-report | async-await | 498/504 MATCH |
| thirdump-ui | 6 stop cases (7 ids) | 7/7 MATCH |
| tydump-nocore | collapse-debuginfo-invalid | 1/1 MATCH |

  - generic_const_exprs: 3 CRASH and 2 UNPORTED, and 0 of the 105 protected generic_const_exprs cases fail to match.
    The 5 failures are the 4 the handoff lists in that directory, plus `post-analysis-user-facing-param-env.rs`, which
    is UNPORTED on an unrelated stop ("Debug without a TS impl").
  - async-await: the 6 UNPORTED cases hit unrelated stops (`layout_of` query desc, and `deeply_resolve_via_region_graph`).

## Findings

1. **tools/codegen/types.ts:2810-2815 (`tfVisitFn`)**, non-blocking.
   - The out-of-scope check scans only `sc.params` of the scope it is called in. Inside an alias scope (`aliasScope`,
     where every alias param is in `subst`), an unsubstituted param of the *enclosing* item is reached through
     `s.scope`. It is emitted as `visit_with_<P>` but not detected.
   - Example: `type PolyFoo<T> = Binder<Foo<T>>`, used as a field of a generic `S<T>`. S's fold fn would then reference
     a `visit_with_T` that is not in its parameter list.
   - The failure is loud (a tsc "cannot find name" error after generation), not silent, and no current set hits it.
   - A sturdier check would test the emitted identifiers against the fold fn's actual parameters (or carry the
     enclosing scope).

2. **tools/codegen/types.ts:2790 (`tfFn` ext shortcut)**, non-blocking.
   - `!/\$\d/.test(fn)` does not recognise the new `$vN` placeholder.
   - A future `type_fold.json` entry whose `try_fold`/`fold` used only `$vN` (no `$N`) would take the bare-name shortcut
     and drop the visit argument. Today the only `$v0` entry (Binder) also has `$0`, so nothing is wrong now.
   - Suggest `/\$v?\d/`.

3. **tools/codegen/types.ts:2745-2749 and 2683-2687**, non-blocking.
   - `tfVisitFn` calls `tfFn("visit", ..)`, which can register imports (`tfItemName` → `imp`) and report entries even
     when the result is then discarded (`undefined`).
   - This is harmless today: regeneration showed no import changes, and tsconfig has no `noUnusedLocals`. But a
     discarded visit fn can leave a dead import in a generated file.

4. **docs/handoff/gaps-30a.md, "The stops' cases"**, non-blocking (accounting).
   - The handoff counts the stop cases in only 4 suites (mir, borrowck-ui-report, thir-tree, tydump-ui). The gate run
     `gate-20261029-001428-root-june` also has these stops in thirdump-ui (7 cases) and tydump-nocore (1 case), both
     protected suites.
   - I ran all 8: they now MATCH, so they are extra wins, not losses.
   - Root should expect them in the next gate's growth.

5. **src/rustc_hir_typeck/fn_ctxt/mod.ts:314**, non-blocking (style).
   - `candidates_ as InherentAssocCandidate[]` casts the result of `with_replaced_escaping_bound_vars(.., fold_Vec(..))`.
     The cast looks unneeded (or only drops `readonly`).
   - `ObligationCtxt.new_with_diagnostics(this.infcx)` stands in for upstream's `new_with_diagnostics(self)`. That is
     the `Deref` to `InferCtxt`, the same as `rustc_trait_selection/infer.ts:134`. Fine.

6. **src/rustc_type_ir/region_constraint.ts:1266-1268 and src/rustc_middle/traits/mod.ts:528-546**, non-blocking
   (follow-up, outside the lane).
   - These hand callers of the Binder fold impls still pass only the same-kind impl. A folder whose `fold_binder` visits
     the value would still stop at the `partial_descriptor` UNPORTED there.
   - The handoff flags this correctly for root.

7. **Unit tests**, informational.
   - The lane's test command gave 705 pass, 1 fail in my scratch worktree. The failure is
     `tools/codegen/serialize.test.ts` "derive(Decodable)/(Encodable) of hand types".
   - It expects an import path containing `/tmp/codegen-serialize-`. Because the worktree sits under `.data/tmp/`, the
     generated relative path is `../../../codegen-serialize-…` instead.
   - The same file passes 6/6 in the main checkout, and the lane does not touch the serialize code. This is an artifact
     of where my worktree was, not a lane regression.
