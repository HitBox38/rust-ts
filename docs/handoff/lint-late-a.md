# Handoff: lint-late-a (wave 21, M4-0: late lint driver + builtin.rs late passes)

Branch `lane/lint-late-a`, based on 970d2365. (In progress: this section is committed early for lanes lint-late-b..e2.)

## Registration pattern for late lint passes (lanes lint-late-b..e2: read this first)

Nothing needs registering in lib.ts: every upstream late pass is already listed, in upstream order, in lib.ts's
`BuiltinCombinedLateLintModPass` / `InternalCombinedLateLintModPass` (`declare_combined_late_lint_pass` of passes.ts,
`p<L>(PassType, () => constructor)` entries). Do not edit lib.ts; if a constructor there is wrong for your pass (e.g.
the pass gets fields and upstream uses `Pass::new()` / `Pass::default()`), write it in your handoff for root.

In your file (as the early passes did, e.g. builtin.ts `WhileTrue`):
1. The pass type comes from `<file>.lints.gen.ts` (generated `declare_lint_pass!` / `impl_lint_pass!` expansion) or is a
   class in your file (`impl_lint_pass!` structs with fields). Give it the trait's method signatures:
   ```ts
   declare module "./foo.lints.gen.ts" {
     interface Foo extends LateLintPass {}
   }
   ```
2. Port each `impl LateLintPass for Foo` method as a prototype assignment with the marker on the line above:
   ```ts
   // rustc: compiler/rustc_lint/src/foo.rs:123 check_expr
   Foo.prototype.check_expr = function (this: Foo, cx: LateContext, e: hir.Expr): void { ... };
   ```
   `passes.ts`'s `LateLintPass` types the parameters as `unknown`; method parameters are bivariant, so declare the real
   HIR types (`hir.Expr`, `hir.Item`, ...; `import type * as hir from "../rustc_hir/hir.ts"`).
3. Delete the method's name from the file's `unported_methods(Foo.prototype, ..., [...])` placeholder list (delete the
   call when the list is empty). A method left in the list is an `unported` stub, so a combined pass that reaches it
   stops as UNPORTED (exit 70) instead of silently doing nothing.
4. Emit with `cx.emit_span_lint(LINT, span, Xxx_diagnostic({...}))` (diagnostics.gen.ts / diagnostics.ts) or
   `cx.opt_span_lint(..)`; `cx.tcx.emit_node_span_lint(..)` for lints at another node.

`LateContext` (context.ts) is ported (this lane): fields keep upstream names and are typed (`enclosing_body:
hir.BodyId | undefined`, `typeck_results: TypeckResults | undefined`, `param_env: ParamEnv`, `effective_visibilities:
EffectiveVisibilities`, `last_node_with_lint_attrs: HirId`, `generics: hir.Generics | undefined`, `only_module`).
Methods: `typeck_results_()` (the upstream `typeck_results()` method; ICEs outside bodies), `typing_mode()`,
`typing_env()`, `type_is_copy_modulo_regions(ty)`, `type_is_use_cloned_modulo_regions(ty)`, `qpath_res(qpath, id)`,
`get_def_path(def_id)`, `get_associated_type(self_ty, trait_id, name)`, `precedence(expr)`, `expr_or_init(expr)`,
`expr_or_init_with_outside_body(expr)`, `data_layout()`, `tcx_()` (`HasTyCtxt`), `typing_env_()` (`HasTypingEnv`),
`handle_layout_err`. For `cx.layout_of(ty)` use `cx.tcx.layout_of(cx.typing_env().as_query_input(ty))` as upstream's
`LayoutOf` provided method does (`LayoutOf` for `LateContext` is not a separate port).

late.ts is fully ported (`LateContextAndPass` visitor with `nested_filter::All`, `RuntimeCombinedLateLintPass`,
`late_lint_mod`, `late_lint_crate`, `check_crate`). `lint_mod` (lib.ts) runs `BuiltinCombinedLateLintModPass` per module.

### Testing late passes against the oracle
`analysis` (rustc_interface passes.rs) is not ported, so the real driver does not reach the late lints. Test driver:
`src/rustc_lint/late_oracle/run.ts` (see its header): `run_required_analyses_prefix` (tydump's, includes typeck of all
bodies), abort on non-lint errors, the late lints, `check_expectations`, stop.
- `bun src/rustc_lint/late_oracle/run.ts --late-pass=foo.ts:Foo [--late-pass=..] <rustc args>` runs only the listed
  passes (a combined pass in the given order) on every module with `late_lint_mod`.
- Without `--late-pass` it runs the real `rustc_lint::check_crate` (needs every pass in the combined pass ported).
Write your own `src/rustc_lint/<yourfile>.oracle.test.ts` (copy the harness part of
`src/rustc_lint/late_builtin.oracle.test.ts`): compile each case with the pinned rustc as a lib (`--crate-type=lib
--emit=metadata`, std) and with the driver, compare stderr and the exit code byte for byte. Cases must not trigger
diagnostics the driver does not run (borrowck, liveness `unused_*`, `dead_code`, other late lints): use `pub` items
and `#![allow(..)]` where needed.
