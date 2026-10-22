# Handoff: lint-late-c (wave 21, M4-0: late lints, part c of 6)

Branch `lane/lint-late-c`, based on 970d2365. No merges.

## Result
All functions of the assigned files are ported, in upstream order, with markers. The late passes are standalone
`LateLintPass`es on the generated pass classes. They follow lint-late-a's pattern (its handoff draft, not committed yet
when this lane ended): `declare module "./x.lints.gen.ts" { interface X extends LateLintPass {} }`, then
`X.prototype.check_* = function (this: X, cx: LateContext, node: hir.Node) {..}` with real HIR types, and the
`unported_methods` placeholders are removed.

**Registration:** nothing to do. lib.ts already lists all 8 passes in lib.rs order in `BuiltinCombinedLateLintModPass`.
`IfLetRescope` is built with `IfLetRescope.default()`, which this lane ports. The others are built with `new X()`.

## Files
- `src/rustc_lint/unused.ts`: `PathStatements::check_stmt`, `UnusedAllocation::check_expr`.
- `src/rustc_lint/unused/must_use.ts`: whole file (`IsTyMustUse`, `MustUsePath` + Debug, `is_ty_must_use`,
  `UnusedResults::check_stmt`, `check_fn_must_use`, `is_def_must_use`, `check_must_use_def`,
  `emit_must_use_untranslated`).
- `src/rustc_lint/nonstandard_style.ts`: NonSnakeCase (`to_snake_case`, `check_snake_case`/`is_snake_case`, 8 late
  methods), `NonUpperCaseGlobalGenerator` + `into_diag`, `check_upper_case` (incl. `UsageCollector`), 5 late methods.
  `is_upper_camel_case` / `to_upper_camel_case` are now exported (used by the test).
- `src/rustc_lint/nonstandard_style/tests.test.ts` (new): `camel_case`.
- `src/rustc_lint/impl_trait_overcaptures.ts`, `src/rustc_lint/lifetime_syntax.ts`, `src/rustc_lint/if_let_rescope.ts`:
  whole files.
- `src/rustc_lint/late_c.oracle.test.ts` (new): oracle tests, described below.

## Coverage (`bun scripts/coverage.ts --missing`)
| upstream file | ported |
|---|---|
| unused.rs | 40/40 |
| unused/must_use.rs | 7/7 |
| nonstandard_style.rs | 30/30 |
| nonstandard_style/tests.rs | 1/1 |
| impl_trait_overcaptures.rs | 16/16 |
| lifetime_syntax.rs | 19/19 |
| if_let_rescope.rs | 10/10 |

## Tests
`src/rustc_lint/late_c.oracle.test.ts` uses lint-late-a's driver `src/rustc_lint/late_oracle/run.ts`
(`--late-pass=<file>:<Pass>`). It compiles each case as a lib with std, both with the pinned rustc and with the driver,
and requires stderr and the exit code to be byte-identical. **On this branch the driver does not exist yet, so the file
skips visibly.** It runs once lint-late-a is merged.
- CASES (10, one or more per lint):
  - non_snake_case: all sorts, a reserved name, `--crate-name`, and `#![crate_name]`.
  - non_upper_case_globals: static, const with usages, assoc consts, const param, pattern, `no_mangle`.
  - path_statements: no effect, and drops value.
  - unused_allocation.
  - unused_must_use: unit-returning fn and method, with a reason, in a block tail.
  - Non-firing runs with the lint enabled: impl_trait_overcaptures/redundant_captures, mismatched_lifetime_syntaxes,
    if_let_rescope.
- BLOCKED (4): each case makes the lint fire. The test checks that the oracle emits the lint and that the port stops
  exactly at `blocked_by`. Once the blocker is ported, the case fails with "move this case into CASES".

Verification run with lint-late-a's uncommitted context.ts / late.ts / late_oracle/run.ts copied in temporarily
(reverted before commit):
- 13/14 tests pass. The 14th is the lifetime BLOCKED case, which failed only because the diagnostics.ts patch below was
  applied, so it no longer stopped at its blocker. With the patch it matched the oracle.
- All 8 passes on the 380 tests/ui files that mention one of these lints (`--crate-type=lib`,
  `-A dead_code -A unused_variables -A unused_assignments -A unused_mut`):
  - 143 identical to the oracle.
  - Every difference is one of: an `unported` outside this lane (145 `Ty::is_inhabited_from`, 40 `mir_borrowck` in the
    analysis prefix, 16 const eval, 4 `significant_drop_order`, 6 other prefix paths), a diagnostic from a pass the
    driver does not run, or `#![deny(warnings)]` overriding `-A`.
  - **No difference comes from these lints' own output.** There was no crash or ICE.
- The lifetime UI tests (`lifetimes/mismatched-lifetime-syntaxes-details/*`) matched 6/7 with the diagnostics.ts
  patch; the 7th needs `mir_borrowck`.

## `unported(...)` left / blockers (not in this lane's files)
1. **`Ty::is_inhabited_from`** (rustc_middle ty/inhabitedness/mod.rs, 0/12 ported). `UnusedResults::check_stmt` reaches
   it for every `expr;` statement whose type is not `()`. In the full combined pass this is the main blocker: nearly any
   crate with such a statement stops there.
2. **`MismatchedLifetimeSyntaxes::into_diag`** (diagnostics.ts, rustc_lint diagnostics.rs:2970) is still `unported`. It
   was waiting on this lane's `LifetimeSyntaxCategories`. A verified port is below; it matches the oracle on 6 UI tests.
   Root: apply it to diagnostics.ts, then move the lifetime case from BLOCKED to CASES.
3. **if_let_rescope.ts:**
   - `IfLetRescopeLint`'s `#[derive(Diagnostic)]` (and `DestructorLabel`'s `#[derive(Subdiagnostic)]`) is `unported`.
     tools/codegen's `rustc_lint` set covers only diagnostics.rs. Root: add `compiler/rustc_lint/src/if_let_rescope.rs`
     to `tools/codegen/types.sets.json` and regenerate.
   - Local `unported` stubs for `rustc_middle::ty::significant_drop_order::{extract_component_with_significant_dtor,
     ty_dtor_span}`. That file (160 lines) is not ported and is unassigned. Every non-place `if let` scrutinee reaches it
     when the lint is enabled. It is allow-by-default.
4. **impl_trait_overcaptures.ts:** `ImplTraitRedundantCapturesLint::into_diag` is a `#[derive(Diagnostic)]` in that file
   and is `unported` for the same codegen reason. Root: add impl_trait_overcaptures.rs to the set. The overcaptures lint
   itself is ported, but every RPIT with a body stops earlier, at `mir_borrowck` in the analysis prefix (`check_opaque`
   → `type_of`).
5. `TyCtxt::ty_is_opaque_future` (must_use.rs `.await` path) is `unported` where it is defined.
6. `MismatchedLifetimeSyntaxes.inputs/outputs` are typed `unknown` in diagnostics.gen.ts; they should be
   `LifetimeSyntaxCategories<Span[]>`. This is a generator fix and not urgent; the patch casts.

## `// PORT:` decisions
- must_use.rs:
  - `MustUsePath::Array` length is a `number`, and `saturating_add` is `+` (both stay below 2^53).
  - `elem_exprs.iter().chain(iter::repeat(expr))` is an index lookup that falls back to `expr`.
  - `find_attr!(.., MustUse { reason, .. } => reason)` wraps `{ reason }`, so a bare `#[must_use]` is not read as "not
    found".
- nonstandard_style.rs:
  - `NonSnakeCase::to_snake_case` and `NonUpperCaseGlobals::check_upper_case` are module functions.
  - `NonUpperCaseGlobalGenerator` is a local `Diagnostic` class.
  - `str::to_lowercase`/`to_uppercase` use std/unicode/str_case.ts (final sigma).
  - `char::to_titlecase` is not in src/std (see the comment at nonstandard_style.ts:49).
- impl_trait_overcaptures.rs:
  - `FxIndexMap<DefId,_>` / `FxIndexSet<DefId>` are `DefIdMap`/`DefIdSet`, and `shift_remove` is `delete`.
  - `LazyCell` is a small `Lazy<T>`.
  - The opaque let-chain in `visit_ty` is a helper (`owned_opaque`) with the same check order.
  - The file imports `../rustc_trait_selection/lib.ts` for the `OutlivesEnvironment.new` extension.
- lifetime_syntax.rs:
  - `FxIndexMap<LifetimeKind,_>` and `path_counts` are `KeyedMap`s.
  - `LifetimeSyntaxCategories::select` (returns `&mut T`) returns the field name instead.
  - Methods live on companion consts.
- if_let_rescope.rs: `struct AltHead(Span)` is a `Span`; derive handling as in blocker 3.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok (17359; vendor 3888).
- `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`: 5397 pass, 15 skip, 0 fail. `late_c.oracle.test.ts` skips
  because lint-late-a's driver is not on this branch.
- `--suite tydump-minicore`: 45 MATCH / 1 UNPORTED of 46 (run 20261021-184220-lint-late-c-42fn). Base 970d2365 is the
  same, 45 / 1.
- `--suite hir-tree --sample 300`: 300/300 MATCH (run 20261021-184252-lint-late-c-u0qj). Base is the same, 300/300.

## Verified port of `MismatchedLifetimeSyntaxes::into_diag` (for root, src/rustc_lint/diagnostics.ts)
```diff
diff --git a/src/rustc_lint/diagnostics.ts b/src/rustc_lint/diagnostics.ts
index bce0083d..505529b4 100644
--- a/src/rustc_lint/diagnostics.ts
+++ b/src/rustc_lint/diagnostics.ts
@@ -21,7 +21,8 @@ import type { Applicability } from "../rustc_lint_defs/lib.ts";
 import { add_feature_diagnostics } from "../rustc_session/diagnostics.ts";
 import { Span } from "../rustc_span/lib.ts";
 import { display_Ident, Symbol, sym } from "../rustc_span/symbol.ts";
-import { unported } from "../std/panic.ts";
+import { panic, unported } from "../std/panic.ts";
+import { LifetimeSyntaxCategories } from "./lifetime_syntax.ts";
 import type {
   AsyncFnInTraitDiag,
   BuiltinClashingExternSub,
@@ -436,9 +437,67 @@ export function AsyncFnInTraitDiag_diagnostic(self: AsyncFnInTraitDiag): Diagnos
 /** `impl<'a> Diagnostic<'a> for MismatchedLifetimeSyntaxes` */
 // rustc: compiler/rustc_lint/src/diagnostics.rs:2970 into_diag
 export function MismatchedLifetimeSyntaxes_into_diag(self: MismatchedLifetimeSyntaxes, dcx: DiagCtxtHandle, level: Level): Diag {
-  void [self, dcx, level];
-  // `self.inputs.len() + self.outputs.len()` (`LifetimeSyntaxCategories`, lifetime_syntax.rs)
-  return unported("rustc_lint::diagnostics::MismatchedLifetimeSyntaxes::into_diag (lifetime_syntax::LifetimeSyntaxCategories, M3)");
+  const inputs = self.inputs as LifetimeSyntaxCategories<Span[]>;
+  const outputs = self.outputs as LifetimeSyntaxCategories<Span[]>;
+  const counts = LifetimeSyntaxCategories.add(LifetimeSyntaxCategories.len(inputs), LifetimeSyntaxCategories.len(outputs));
+  let message;
+  if (counts.hidden === 0 && counts.elided === 0 && counts.named === 0) {
+    return panic("No lifetime mismatch detected");
+  } else if (counts.named === 0) {
+    message = msg("hiding a lifetime that's elided elsewhere is confusing");
+  } else if (counts.elided === 0) {
+    message = msg("hiding a lifetime that's named elsewhere is confusing");
+  } else if (counts.hidden === 0) {
+    message = msg("eliding a lifetime that's named elsewhere is confusing");
+  } else {
+    message = msg("hiding or eliding a lifetime that's named elsewhere is confusing");
+  }
+  const diag = Diag.new(dcx, level, message);
+
+  for (const s of inputs.hidden) {
+    diag.span_label(s, msg("the lifetime is hidden here"));
+  }
+  for (const s of inputs.elided) {
+    diag.span_label(s, msg("the lifetime is elided here"));
+  }
+  for (const s of inputs.named) {
+    diag.span_label(s, msg("the lifetime is named here"));
+  }
+
+  const hidden_output_counts = new Map<Span, number>();
+  for (const s of outputs.hidden) {
+    hidden_output_counts.set(s, (hidden_output_counts.get(s) ?? 0) + 1);
+  }
+  for (const [span, count] of hidden_output_counts) {
+    const label = DiagMessage_arg(
+      msg(
+        "the same {$count ->\n                    [one] lifetime\n                    *[other] lifetimes\n                } {$count ->\n                    [one] is\n                    *[other] are\n                } hidden here",
+      ),
+      "count",
+      IntoDiagArg.of(count, number_into_diag_arg),
+    ).format();
+    diag.span_label(span, label);
+  }
+  for (const s of outputs.elided) {
+    diag.span_label(s, msg("the same lifetime is elided here"));
+  }
+  for (const s of outputs.named) {
+    diag.span_label(s, msg("the same lifetime is named here"));
+  }
+
+  diag.help(msg("the same lifetime is referred to in inconsistent ways, making the signature confusing"));
+
+  // `let mut suggestions = self.suggestions.into_iter(); if let Some(s) = suggestions.next() { .. }`
+  if (self.suggestions.length > 0) {
+    const s = self.suggestions[0]!;
+    diag.subdiagnostic(MismatchedLifetimeSyntaxesSuggestion_subdiagnostic(s));
+
+    for (const s of self.suggestions.slice(1)) {
+      MismatchedLifetimeSyntaxesSuggestion.make_optional_alternative(s);
+      diag.subdiagnostic(MismatchedLifetimeSyntaxesSuggestion_subdiagnostic(s));
+    }
+  }
+  return diag;
 }
 export function MismatchedLifetimeSyntaxes_diagnostic(self: MismatchedLifetimeSyntaxes): Diagnostic {
   return { into_diag: (dcx, level) => MismatchedLifetimeSyntaxes_into_diag(self, dcx, level) };
```
