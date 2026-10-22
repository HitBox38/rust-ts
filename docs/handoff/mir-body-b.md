# Handoff: mir-body-b (M4 wave 21, MIR fill lane 2 of 6)

Branch `lane/mir-body-b`, based on `aae2f3fc`. No merges.

## Result
All 181 stubs of the lane (row 2 of the split table in `docs/handoff/mir-contract.md`) are ported in place, in upstream
order, with `// rustc:` markers: statement.rs 83/83, terminator.rs 43/43, consts.rs 39/39, pretty.rs:874..1437 16/16
(pretty.rs as a whole: 16/59; the other 43 are lane mir-pretty's). Signatures are the contract's except where noted
under "PORT decisions". No `unported(...)` is left in the lane's code. Paths that call into other lanes' stubs stop
there (see "Stops in other lanes").

Priorities from the brief:
- `TerminatorKind::successors` / `mk_successors` (the `Successors` class of the contract), `successors_mut` (writes go
  back through `field_mut` `MutRef`s), `unwind` / `unwind_mut`, `edges`: done, so the `BasicBlocks` caches and graph
  impls work.
- `Place` / `PlaceRef` / `Operand` / `Rvalue` / `ProjectionElem` helpers, `PlaceTy::{field_ty, projection_ty_core}`:
  done.
- `mir::Const` (incl. `display_Const`, the harness seam): done. `Const::Val` prints through mir-pretty's
  `pretty_print_const_value` (still a stub). `Const::Ty` and `Const::Unevaluated` print fully.
- `span_as_caller_location` is inside `install_TyCtxt_methods()` (consts.ts).
- Debug / Display of statements, terminators, rvalues, operands, places, `fmt_head`, `fmt_successor_labels`,
  `pre/post_fmt_projection`: done, byte-exact against the oracle (tests below).

## Files
- `src/rustc_middle/mir/statement.ts`: the stubs' bodies. Imports changed. Lazy accessors `sty()` (ty/sty.ts) and
  `print_pretty()` (ty/print/pretty.ts). Helpers (not upstream fns): `iter_nth`, `eq_PlaceElem` / `slice_eq_PlaceElem`
  (derived `PartialEq` of `PlaceElem`, for `PlaceRef::is_prefix_of`).
- `src/rustc_middle/mir/terminator.ts`: the stubs' bodies, incl. `SwitchTargetsIter::{next, size_hint}` in the class body.
  Imports changed.
- `src/rustc_middle/mir/consts.ts`: the stubs' bodies and `span_as_caller_location`. Imports changed. New exported
  helper `fold_Const` (the D4 `TypeFoldable` descriptor of `mir::Const` over consts.gen.ts's derives, for
  `EarlyBinder<mir::Const>`), `u64_to_number`, and lazy accessors (R4: no other mir / interpret / ty module is read at load).
- `src/rustc_middle/mir/pretty.ts`: only the region :874..:1437 (my stubs) and **the top import block** (values I need:
  `VariantIdx`, `InlineAsmTemplatePiece`, `debug_InlineAsmOptions`, `Mutability`, `Namespace`, `debug_DefId`,
  `debug_Span`, `Symbol` / `display_Symbol`, `InlineAsmRegOrRegClass`, `display_Region`, `debug_Variance`, fmt builders,
  `with_`, `debug_Ty`, `display_Ty` / `FmtPrinter` / `pretty_print_const` / `with_no_trimmed_paths`, `display_Const`,
  `debug_CoverageKind`, `debug_BasicBlock` / `debug_Local` / `debug_UserTypeProjection`, syntax.ts debug fns and
  companions). Expect a textual conflict with lane mir-pretty in that block: take the union. Two helpers at the end of
  my region: exported `StringFmtWrite` (a `String` as `fmt::Write`; mir-pretty may reuse it) and `fmt_ok`.
- `src/rustc_middle/mir/contract.test.ts`: the `mir-body-b: 181` entry of the stubs-per-lane table is gone (0 stubs).
  Two lines of "stubs stop as UNPORTED" that used my stubs (`Operand::is_move`, `TerminatorKind::successors`) are
  removed, with their imports. No other assertion changed.
- `src/rustc_middle/mir/debug.oracle.test.ts` (new): see Tests.

## PORT decisions
- `ConstValue::from_u64` / `from_target_usize` take `number` (the contract's declarations), and pass `BigInt(i)` to
  `Scalar::from_u64` / `from_target_usize` (bigint per D8). `ConstValue::try_to_target_usize` and
  `Const::try_eval_target_usize` / `eval_target_usize` return `number`, converting `ScalarInt::to_target_usize`'s bigint
  with an ICE above 2^53 (precedent ty/consts.ts `Const::try_to_target_usize`). Root may retype them to `bigint`.
- `ConstValue::try_get_slice_bytes_for_diagnostics` returns a `number[]` copy of the bytes (the declaration's
  `readonly number[]`). Size arithmetic uses the `Size` class (`add`, `mul`, `bytes()`).
- `Const::try_to_scalar` / `try_eval_scalar` of a `Const::Ty`: ty/decls.ts still types `ty::Const::try_to_scalar` with
  its `Pending<"Scalar">` stand-in, so the result is cast to mir's `Scalar`.
- `span_as_caller_location`: the `const_caller_location` hook is typed `unknown` in hooks.ts. Its value is cast to
  `ConstValue`.
- `Operand::place`, `to_copy` (Move), `CallReturnPlaces::for_each`, `TerminatorKind::edges` (`Yield` / `Call` places) and
  `StatementKind::as_debuginfo` copy a `Place` with `clone_Place` (PORTING §8: MutVisitors edit places in place).
  `StmtDebugInfos::extend` clones (`extend_from_slice`).
- `TerminatorKind::unwind` returns the `UnwindAction` itself (`Option<&UnwindAction>`). `unwind_mut` returns
  `field_mut(kind, "unwind")`.
- `ProjectionElem::kind` maps `()` to `null` (`ProjectionKind = ProjectionElem<null, null>`, codegen's choice); the
  `try_map` `v` closure's `None` is `undefined`.
- `fmt_assert_args` / `fmt_head`: each `write!` is one `write_str` of the formatted text. Nested `{x:?}` is
  `debug_x(x, PLAIN)` (a fresh `Formatter`). The `Formatter`'s own flags reach only `debug_tuple` / `debug_struct` of
  `Rvalue::Aggregate` and `pretty_print_const` (as upstream).
- `Display for AssertKind` (`display_AssertKind`): `{x:#?}` is `format_debug(x, debug_O, PRETTY)`; `unimplemented!()`
  is `panic("not implemented")`.
- `Debug for Rvalue::Aggregate(Adt)`: `FmtPrinter::print_string(..)?` failing panics with std's
  `to_string` message (precedent ty/print/pretty.ts `pretty_print_const`).

## Stops in other lanes (not left in mine)
- `display_Const` of `Const::Val` -> `pretty_print_const_value` (mir-pretty). So does `Debug` of any operand holding
  a value constant (`const 1_i32`, fn items, `const ()`).
- `Debug for StatementKind::Coverage` -> `debug_CoverageKind` (mir-body-a).
- `ConstOperand::check_static_ptr`, `ConstValue::{try_to_scalar_int, try_to_bits, try_to_bool, ...}`, `Const::eval`,
  `from_bits`, `from_bool`, `try_get_slice_bytes_for_diagnostics`, `all_bytes_uninit` -> interpret stubs (`Scalar::*`,
  `GlobalAlloc::unwrap_memory`, `Allocation::*`, `InterpResult::discard_err`, `ErrorHandled_from_ReportedErrorInfo`,
  `ReportedErrorInfo::non_const_eval_error`, `TyCtxt::{global_alloc, const_eval_resolve}`) (mir-interp-a / -b).

## Tests
`src/rustc_middle/mir/debug.oracle.test.ts`: a no_core fixture (`fx.rs`, edition 2024) is compiled by the oracle with
`-Zdump-mir=built -Zmir-include-spans=false`. The port compiles the same file into a `TyCtxt`. 52 cases build one MIR
node each by hand and compare the port's `{:?}` with a line of the oracle's dump. One test checks that every expected
line is in the oracle output (skipped without the pinned rustc, a failure under RUST_TS_REQUIRE_PROBES=1). Forms covered:
- Statements: StorageLive/Dead, FakeRead (ForLet, ForMatchedPlace), PlaceMention, AscribeUserType, Assign.
- Places: Deref, Field, Index, ConstantIndex (from start and from end), Subslice (`[1:-1]`), Downcast with a name, and
  nested `(*((*_1).0: &i32))`.
- Rvalues: Use (copy/move), UnaryOp (PtrMetadata, Not), BinaryOp (Ge, Lt, AddWithOverflow), Discriminant, Ref (shared,
  mut), RawPtr, Cast, ThreadLocalRef, Repeat, and Aggregate (tuple, 1-tuple, array, tuple struct, struct, unit / struct /
  tuple enum variants, closure with captures).
- Operands: `Const::Ty` (`const N`) and `Const::Unevaluated` (`const <T as Tr>::C`).
- Terminators: return, resume, unreachable, goto, switchInt, falseEdge, falseUnwind, drop (`unwind: bbN`), drop
  (`unwind terminate(cleanup)`), call, assert (bounds check), assert (`!` + overflow).

Further unit checks: `Const::Val` display stops at `pretty_print_const_value`; successors / labels / edges /
`successors_mut` write-back / `SwitchTargets` helpers / `identical_successor`; `make_nop` + `StmtDebugInfos` + Place
helpers. Not testable against oracle text from built MIR of a small crate: Yield, CoroutineDrop, TailCall, InlineAsm,
Coverage, Intrinsic, SetDiscriminant, ConstEvalCounter, Nop, Reborrow, CopyForDeref, WrapUnsafeBinder,
`Aggregate(RawPtr)`, opaque casts, `PhantomDeref`. Those follow upstream's format strings and are unchecked.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (18182; vendor 3888).
- Coverage (`--missing`): mir/statement.rs 83/83, terminator.rs 43/43, consts.rs 39/39, pretty.rs 16/59 (the 43 missing
  are mir-pretty's; my range :874..:1437 is complete).
- `src/rustc_middle/mir/contract.test.ts`: 6 pass. `debug.oracle.test.ts`: 5 pass (with RUST_TS_REQUIRE_PROBES=1).
  `bun test src/rustc_middle`: 274 pass, 0 fail.
- `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (once, at the end): 5561 pass, 1 skip, 2 fail. Both failures
  are in `src/rustc_lint/types.oracle.test.ts` ("PENDING TypeLimits: fn pointer `==` suggestion stops at
  utils::std_or_core", "PENDING TypeLimits: ambiguous_wide_pointer_comparisons stops at utils::std_or_core"). They fail
  on base `aae2f3fc` too (base fallout, per root), and are not caused by this lane.

## Samples (lane vs base `aae2f3fc`; a temporary detached worktree, now removed; both `RUST_TS_AGENT=mir-body-b`)
| suite | lane run | M / D / U / T | base run | M / D / U / T |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-195652-mir-body-b-j5d3` | 45 / 0 / 1 / 0 | `20261021-195716-mir-body-b-cwsa` | 45 / 0 / 1 / 0 |
| tydump-ui `--sample 200` | `20261021-195743-mir-body-b-pmj5` | 173 / 0 / 26 / 1 | `20261021-195954-mir-body-b-tnli` | 173 / 0 / 26 / 1 |
| hir-tree `--sample 200` | `20261021-200204-mir-body-b-830w` | 199 / 0 / 1 / 0 | `20261021-200326-mir-body-b-05lw` | 199 / 0 / 1 / 0 |
| mirdump-minicore (46) | `20261021-200442-mir-body-b-8c31` | 10 / 0 / 36 / 0 | `20261021-200510-mir-body-b-kxw5` | 10 / 0 / 36 / 0 |

No new DIFF. Compared case by case, every case has the same status and the same stop as on base. The one tydump-ui
TIMEOUT is the same case on both sides (the machine was loaded). No suite reaches this lane's code yet: mirdump stops
earlier, at `mir_keys` / `check_unsafety` / `const_eval_poly`. The last commit (`project_deeper` clones its result) came
after the samples. It only touches MIR code, which no suite reaches.
