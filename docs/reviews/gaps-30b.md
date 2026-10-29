verdict: APPROVE-WITH-NOTES

Reviewer: independent read-only review of `lane/gaps-30b` (head ae0b5c3e, 5 commits over main; `git diff main...lane/gaps-30b`).

## What was checked

- **asm `const` operand** (`src/rustc_mir_build/thir/cx/expr.ts:1019-1022`) against `rustc_mir_build/src/thir/cx/expr.rs:856-870`:
  the same statements in the same order (`UnevaluatedConst::new(did.to_def_id(), args)`, `mir::Const::Unevaluated(uneval, ty)`,
  `InlineAsmOperand::Const { value, span: tcx.def_span(did) }`). The TS `Const` shape `{ $: "Unevaluated", _0, _1 }` matches
  `mir/consts.gen.ts:140`. The enclosing fn's marker is unchanged, and the `unported` import was removed correctly.
- **Query descs**: every newly generated desc in `src/rustc_middle/queries.gen.ts` was compared with
  `rustc_middle/src/queries.rs`. That covers layout_of, fn_abi_* (`key.value.0`), eval_to_*_raw (`GlobalId::display`),
  is_*_raw/needs_*_drop_raw, normalize_canonicalized_*, try_normalize_generic_arg_after_erasing_regions,
  implied_outlives_bounds (`key.0...ty`, `{:?}` of the bool), dropck_outlives, evaluate_obligation, type_op_normalize_ty/clause
  (`{}` and `{:?}` plus `skip_normalization()`), method_autoderef_steps, analysis (`LOCAL_CRATE`) and codegen_select_candidate.
  Texts, field paths and Display/Debug choices all match.
- **`queries.config.json` `structs`**: checked against upstream. PseudoCanonicalInput/ParamEnvAnd (`ty/mod.rs:1088,1247`),
  CanonicalQueryInput/Canonical (`rustc_type_ir/src/canonical.rs:22,38`), Normalize/ImpliedOutlivesBounds/DropckOutlives/
  MethodAutoderefSteps (`traits/query.rs:47-73`) and all eight `Canonical*Goal` aliases (`traits/query.rs:62-92`) are exact.
  The `GlobalId::display` (mir/interpret/mod.rs:66) and `Unnormalized::skip_normalization` (unnormalized.rs:63) targets exist and
  carry markers.
- **IntoDiagArg**: `Instance_into_diag_arg` matches `ty/diagnostics.rs:31` (short_string_namespace, ValueNS), and `std::io::Error`
  uses `into_diag_arg_using_display` as in `rustc_error_messages/src/diagnostic_impls.rs:70`. The remaining descs that cannot be
  translated still produce `unported(...)` with accurate reasons. Nothing is guessed: an unknown struct, field, method or arity
  goes to `unsupported`.
- **Generator correctness in general**:
  - `fieldTy`/`substParams`/the `rust_methods` branch fall back to `unsupported` for anything they do not cover.
  - The `diag_args_lazy` rewrite is guarded by `(?<![\w.])name\b`, so it cannot match inside `acc().name` or a longer identifier.
  - An accessor is emitted only when the generated text uses it.
  - `diag_args_skip` is still checked first.
  - I regenerated `rustc_middle_diagnostics` and `rustc_interface` into a scratch dir. Apart from absolute-vs-relative import
    specifiers, the output is byte-identical to the committed files. `bun tools/codegen/queries.ts --check` reports up to date
    (22 unported descs, as the handoff says).
- **Harness/scripts/baselines**: `git diff main...lane/gaps-30b -- harness scripts` is empty.
- **Build/tests (scratch worktree, since removed)**: `bunx tsc --noEmit -p .` exits 0. `bun test tools/codegen/queries.test.ts
  tools/codegen/diagnostics.test.ts`: 12 pass, 0 fail.
- **Difftest spot checks** (`--filter`, mir): `asm/const-error` (stop 3), `typeck/bad-recursive-type-sig-infer` (stop 1) and
  `solver-cycles/129541-recursive-struct` (stop 2) are all MATCH.
- **Sample claims**: the lane's runs `…-03dz` (mir 291/7/2), `…-92s9` (thir-tree 295/3/2) and `…-axbx` (tydump-ui 298/0/2) exist
  with those totals. Per id against gate-20261029-001428-root-june, no case went from MATCH to anything else in any of the three
  suites (0 lost MATCH).

## Findings

1. `src/rustc_passes/debugger_visualizer.ts:44`: **non-blocking**. This file is outside the lane's assigned files. The handoff
   discloses the edit. It only drops an `as unknown as Error` cast and its PORT note, which the `io::Error -> IoError` typemap
   change made obsolete. It is correct and now matches upstream's `error` field type. Root should acknowledge the edit when
   integrating.
2. `tools/codegen/types.ts:3217-3224, 3766-3777` (`diag_args_lazy`): **non-blocking**. This adds a new generator mechanism that
   emits a lazy CommonJS `require` inside a generated `.gen.ts`, and it needs a recorded decision (the handoff asks for one).
   - It follows the existing hand pattern (`region_kind()` in rustc_type_ir sty/mod.ts) and carries a `// PORT (init order, ...)`
     comment. It is currently used only by `rustc_middle_diagnostics`.
   - Theoretical nit: accessor names come from `rel.replace(/\W+/g, "_")`, so two different modules could collide (e.g.
     `a/b_c.ts` and `a_b/c.ts`). There is no collision today.
3. `tools/codegen/queries.config.json` `structs`/`rust_methods`/`consts`/`types`: **non-blocking**.
   - These are hand-maintained mirrors of upstream struct layouts and aliases. All are verified exact at the pin (see above), but
     they will not follow a re-pin automatically. A note in the re-pin checklist would help.
   - `rust_methods[*].ret` is resolved in `queries.rs`'s scope, and the config comment only states the "paths are absolute" rule
     for `structs`. Today only `String` and a type parameter are used, so nothing is affected.
4. `tools/codegen/types.sets.json` `rustc_middle_diagnostics.typemap_extra: ["mir.typemap.json"]`: **non-blocking**. This adds
   `import { type Instance } from "./ty/instance.ts"` to a module on the init-order-sensitive path. It is a type-only import, so it
   is erased. The spot runs and tsc confirm loading is unaffected.
5. Stop 4 (`rustc_abi::Size` beyond 2^53, 32 mir cases): **non-blocking**. It is correctly left unfixed, still stops through
   `unported`, and nothing rounds. The proposed `big: bigint` / `bytes_u64()` design is a representation change, so under plan-m5
   D10 it needs a root decision before any lane starts it.
