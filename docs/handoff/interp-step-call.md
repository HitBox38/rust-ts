# Handoff: interp-step-call (M4 wave 23c, CTFE fill lane)

Branch `lane/interp-step-call` (from `43e37d73`, no merges). Commits: the port (`0a1d2ae1`), then this handoff.

## Result
- rustc_const_eval `interpret/{step, call, stack}.rs` fully ported: **60 stubs → 0** (`coverage.ts --missing`:
  step.rs 8/8, call.rs 17/17, stack.rs 35/35). Files: `src/rustc_const_eval/interpret/{step,call,stack}.ts`.
- The statement / terminator loop (`step`, `eval_statement`, `eval_rvalue_into_place`, `write_aggregate`, `write_repeat`,
  `eval_terminator`), argument evaluation (`eval_fn_call_argument`, `eval_callee_and_args`), calls (`init_fn_call`
  incl. intrinsics / untupling / `Virtual` dispatch, `init_fn_tail_call`, `init_drop_in_place_call`,
  `init_stack_frame`, `pass_argument`, the ABI-compat checks `has_trivial_abi` / `unfold_transparent` / `unfold_npo` /
  `identical_c_types` / `layout_compat` / `check_argument_compat`), returns (`return_from_current_stack_frame`) and the
  stack (`push_stack_frame_raw` / `_done`, `pop_stack_frame_raw`, `cleanup_stack_frame`, `storage_live(_dyn)` /
  `storage_dead`, `deallocate_local`, `layout_of_local`, varargs, `Frame::current_span` / `lint_root` /
  `generate_stacktrace_from_stack`, `FrameInfo::as_note` / Display, `LocalState` Debug / `print`, `SpanGuard`).
- `contract.test.ts` re-pinned: markers 176 → 236, stubs 481 → 421, `interp-step-call` gone from the per-lane table
  (the runtime stop is unchanged: `eval_queries::eval_in_interpreter`, ctfe-a). 4/4 pass.

## Where it stops: `FnAbi` (lane fn-abi)
`FnAbi` / `ArgAbi` are `Pending1` placeholders. call.ts gives the upstream fields / methods the interpreter reads one
accessor each, which stops with an exact `unported` until lane fn-abi:
- `fn_abi_(fn_abi)` → `{ args, ret, c_variadic, fixed_count, conv, can_unwind }`: `unported("rustc_target::callconv::FnAbi (lane fn-abi)")`
  (exported; step.ts uses it for `fn_abi.can_unwind` in `Call`)
- `arg_abi_(arg_abi)` → `{ layout }`: `unported("rustc_target::callconv::ArgAbi (lane fn-abi)")`
- `ArgAbi_eq_abi`, `ArgAbi_is_ignore`, `clone_FnAbi`: `unported("rustc_target::callconv::ArgAbi::eq_abi (lane fn-abi)")`,
  `..::ArgAbi::is_ignore (lane fn-abi)`, `..::FnAbi::clone (lane fn-abi)`.
In practice every call stops earlier, at the `fn_abi_of_*` queries (no provider yet). Lane fn-abi: make the accessors
the identity (or the real methods) and drop them; the `Virtual` patch-up writes `arg_abi_(..).layout = new TyAndLayout(receiver_ty, ..)`
on a clone, as upstream.
- Also reached only through ctfe-util: `FrameInfo::as_note` calls `util::context_spans` (stub, ctfe-util), so CTFE
  error notes for non-closure frames stop there until ctfe-util lands. `display_CanonAbi` (rustc_abi) is unported too
  (only in the calling-convention-mismatch UB message).

## `// PORT:` decisions / signature changes (declarations are mine; please review)
- `allocate_varargs(caller_args: Iterator<[FnArg, ArgAbi]>, callee_abis: Iterator<[number, ArgAbi]>)` and
  `pass_argument(..)` take JS `Iterator`s (were `<I, J>` / `IterableIterator`); upstream's `&mut impl Iterator` is the
  shared iterator object (`zip` / `enumerate` generators in call.ts).
- `ArgAbi<T>` placeholder is now exported from call.ts (stack.ts imports it as a type).
- `Frame::with_extra` returns `Frame<Extra>`; `extra: ()` of the pre-frame is `null` (CTFE `FrameExtra`, contract decision 2).
- `SpanGuard::enter(span: unknown)` (a `tracing::Span`); `enter` / `drop` are no-ops (no tracing subscriber is ported);
  `info_span!("frame", ..)` is a disabled span (`undefined`) under the default WARN filter.
- `LocalState::access_mut` keeps the contract's `InterpResult<Operand>` (no `MutRef`): a write through `&mut Operand` is
  `locals[local].value = { $: "Live", _0: new_op }` (decision 4). **interp-place-operand**: `as_mplace_or_mutable_local` /
  `write_immediate` should write that way.
- `Frame::locals_addr`: TS arrays have no address; each `locals` array gets a unique number on first use (WeakMap),
  only compared for equality, like upstream.
- `IndexVec::from_elem(dead_local, ..)`: one fresh `LocalState` per local (they are mutable).
- `step`: `loc.statement_index += 1` builds a new `Location` (they are shared, e.g. `Location::START`).
- `cont` in `init_stack_frame` / `unwind` in `init_fn_call` are reassigned values instead of `&mut` writes.
- `va_list_key_field` (intrinsics.ts) is declared over `unknown`; its result is cast to `MPlaceTy` (upstream `P = MPlaceTy`).
  interp-intrinsics may want to type it `<P extends Projectable<P>>(va_list: P): InterpResult<P>`.
- Derived `PartialEq` of `Either<Location, Span>` / `TyAndLayout` / `Instance` written as local helpers / `intern_key_eq`.

## Samples (`RUST_TS_AGENT=root-f5de`, at `0a1d2ae1`) vs interp-contract's runs (at `e99b4cde`)
| suite | run | M / D / U | vs interp-contract |
|---|---|---|---|
| mirdump-minicore (46) | `20261022-202822-root-f5de-pyuc` | 45 / 0 / 1 | +2 UNPORTED → MATCH, 0 lost |
| mirdump-ui `--sample 300` | `20261022-202849-root-f5de-9gvc` | 266 / 0 / 34 | +44 UNPORTED → MATCH, 0 lost |
| tydump-minicore (46) | `20261022-203130-root-f5de-pa86` | 45 / 0 / 1 | same |
| tydump-ui `--sample 300` | `20261022-203158-root-f5de-0ztz` | 258 / 0 / 40 (+2 UNSTABLE) | same |

0 DIFF, 0 CRASH, no case lost. The gains come from the integ-w19 base (mt-validate), not this lane: const evaluation still
stops before the interpreter loop at `eval_queries::eval_in_interpreter` (ctfe-a; mirdump-ui 16), then `mir_borrowck` 16,
`try_to_bits_for_ty (M4)` 2.

## Checks
- `bunx tsc --noEmit -p .` clean; `bun scripts/coverage.ts --check` markers ok (20438; vendor 4330).
- `contract.test.ts` 4 pass.
- Full `RUST_TS_AGENT=interp-step-call RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`: **6101 pass, 1 skip (the existing one), 0 fail** (6102 tests, 435 files, 5843 s under load ~100-200 from parallel lanes)
  (log `$RUST_TS_DATA/scratch/interp-step-call/fulltest.log`).

## `unported(...)` left (all in call.ts, lane fn-abi)
`rustc_target::callconv::FnAbi (lane fn-abi)`, `rustc_target::callconv::ArgAbi (lane fn-abi)`,
`rustc_target::callconv::ArgAbi::eq_abi (lane fn-abi)`, `rustc_target::callconv::ArgAbi::is_ignore (lane fn-abi)`,
`rustc_target::callconv::FnAbi::clone (lane fn-abi)`.

## Shared files edited
Only `src/rustc_const_eval/interpret/contract.test.ts` (counts). No harness/ or scripts/ edits.
