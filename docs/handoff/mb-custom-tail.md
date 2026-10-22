# Handoff: mb-custom-tail (M4 wave 22, MIR build fill lane)

Branch `lane/mb-custom-tail` (base `7d76ddd0`, no merges). Commits: check_tail_calls.rs + its oracle test; builder/custom
+ its oracle test; macro-hygiene fix + this handoff.

## Result
All 51 stubs of the lane are ported (no `unported(..)` left in the lane's files):
- `compiler/rustc_mir_build/src/check_tail_calls.rs`: 20/20 (17 here: `check_tail_call`, `caller_needs_location`, every
  `report_*`, `op_trait_as_method_name`).
- `builder/custom/mod.rs` 4/4 (`build_custom_mir`, `parse_attribute`, `expr_error`, `stmt_error`), `builder/custom/parse.rs`
  11/11, `builder/custom/parse/instruction.rs` 19/19.

`bun scripts/coverage.ts --missing` for the four files: 4/4, 11/11, 19/19, 20/20 ported. `--check`: markers ok.

## Files touched
- `src/rustc_mir_build/check_tail_calls.ts`, `src/rustc_mir_build/builder/custom/{mod, parse, parse/instruction}.ts` (the stubs).
- `src/rustc_mir_build/builder/contract.test.ts`: counts only (markers 50 -> 101, stubs 263 -> 212, the `mb-custom-tail`
  row removed from the per-lane table). Parallel fill lanes change the same three lines: root reconciles at integration.
- New tests (lane-owned): `src/rustc_mir_build/check_tail_calls.test.ts` + `check_tail_calls_test/` (runner `run.ts`, 15
  cases with `.stderr` / `.exit` fixtures); `src/rustc_mir_build/builder/custom/custom_mir.test.ts` + `custom_mir_test/`
  (runner `run.ts`, 3 cases with `.stderr` / `.exit` / `.mir` fixtures). `REGEN=1` rewrites fixtures from the pinned rustc.

## Tests (end-to-end is not reachable: `mir_built` needs check_match / check_unsafety / mir_keys first)
Both tests follow rustc_hir_typeck/loops.test.ts: a runner drives the ported driver (`--target x86_64-unknown-linux-gnu
--sysroot <oracle sysroot> -Zui-testing`, real `std`), then calls the lane's code directly; stdout / stderr / exit must
equal the pinned rustc's.
- check_tail_calls: the `check_tail_calls` query on every body owner. Cases = tests/ui/explicit-tail-calls copied
  unchanged: become-operator, become-uncallable, c-variadic, callee_is_ref, callee_is_weird, caller-lifetime-presence,
  caller_is_track_caller, closure, in-closure, intrinsics, ret-ty-hr-mismatch, return-mismatches, rust-call (from
  unsupported-abi/), signature-mismatch, plus unsized-argument.rs (no-unsized-arguments.rs without minicore). Every
  `report_*` but `report_c_variadic_caller` is exercised. **15/15 match.**
- custom MIR: `construct_fn` (-> `build_custom_mir`) on every `#[custom_mir]` body owner, printed with
  `MirWriter::write_mir_fn`, against the oracle's `-Zdump-mir=built` files (header lines dropped). custom_basic (all
  dialect/phase pairs, block/local/debuginfo decls, cleanup blocks, StorageLive/Dead, Ref/RawPtr/BinaryOp/Checked/Offset/
  UnaryOp/Cast/aggregates/Discriminant, Copy/Move, field/deref/index places, Goto/Return/Unreachable/UnwindResume/Drop/
  SwitchInt) and custom_error (`span_fatal` "Could not parse local, found: \"Cast { source: e5 }\"") **match**;
  custom_const is PENDING, pinned to its stop `as_constant_inner` (lane mb-expr-a).

## Stops reached
- `rustc_mir_build::builder::expr::as_constant::as_constant_inner` (mb-expr-a): every custom-MIR constant operand, integer
  literal (`Field`, `Variant`, `SetDiscriminant`) and function operand of `Call` / `TailCall` goes through it.
- `check_match` (thir-pattern / mb-check-match) runs before both in `build_mir_inner_impl`, so `mir_built` itself stops
  there today; the runners call `check_tail_calls` / `construct_fn` directly (PORT (test) notes in each runner).
- `trivial_const provider (not ported)`: the check_tail_calls runner does not skip `is_trivial_const` bodies as rustc's
  analysis loop does (a const body has no `become`, so the output is the same).

## PORT decisions
- check_tail_calls: `caller_sig.inputs_and_output != callee_sig.inputs_and_output` is identity on the interned `Tys`;
  `{caller_sig}` / `{callee_sig}` is rustc_type_ir ir_print `display_FnSig`; `op_trait_as_method_name`'s match is a
  `switch` over `LangItem`.
- `parse_by_kind!` (parse.rs) is expanded at each use: preparse, then an if-chain over the arms in the macro's order
  (`@call`, `@variant`, patterns), ending in the macro's `return Err(expr_error(..))`. The two arm guards are the helpers
  `parse_by_kind_call` / `parse_by_kind_variant` in parse.ts (not upstream fns: no marker). Macro hygiene is kept: an
  `expr_id` written inside an arm is the fn parameter, not the macro's preparsed one (matters for the
  "No WithOverflow form of this operator" error of `mir_checked`).
- `.collect::<PResult<Box<[_]>>>()` / `collect::<Result<_, _>>()` over operands: local helpers `parse_spanned_operands` /
  `parse_operands` (instruction.ts) that stop at the first `Err`.
- `ParseCtxt.local_map` / `block_map` (`FxHashMap<LocalVarId, _>`) are `KeyedMap(key_LocalVarId)` (contract decision 6);
  `self.local_map[id]` is `unwrap(get(id))` (panics on a missing key, as `HashMap` indexing).
- `Body { .. }` in `build_custom_mir` is `new Body(..)` with every field in declaration order (comments name them).
- `try { a?; b?; }` in `build_custom_mir`: the first `Err`.
- `as u32` of the `u128` integer literals: `Number(BigInt.asUintN(32, v))`.
- thir.gen.ts types `ExprKind::StaticRef.alloc_id` as `unknown`: cast to `AllocId` in `parse_static` (codegen could type
  it; root's call).

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (19046; vendor 4196).
- `bun test src/rustc_mir_build`: 27 pass, 0 fail.
- Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`: see the last section.

## Samples (`RUST_TS_AGENT=root-ad4b`, case by case vs root's base runs: no status changed)
| suite | lane run | M / D / U | base run | M / D / U |
|---|---|---|---|---|
| tydump-minicore | `20261022-105805-root-ad4b-yyoa` | 45 / 0 / 1 | `20261022-101651-root-ad4b-9r7y` | 45 / 0 / 1 |
| mirdump-minicore | `20261022-105827-root-ad4b-cfff` | 10 / 0 / 36 | `20261022-101711-root-ad4b-xljd` | 10 / 0 / 36 |
| tydump-ui `--sample 300` | `20261022-105853-root-ad4b-hik6` | 263 / 0 / 36 (+1 UNSTABLE) | `20261022-101731-root-ad4b-hqwm` | 263 / 0 / 36 (+1 UNSTABLE) |
| hir-tree `--sample 200` | `20261022-110131-root-ad4b-txls` | 200 / 0 / 0 | — | (0 DIFF) |
