# Handoff: mb-expr-b (M4 wave 22, MIR build fill lane): builder/expr/{into, as_rvalue}.rs

Branch `lane/mb-expr-b` (from `7d76ddd0`, no merges).

## Result
- **All 11 stubs ported** (coverage `into.rs` 3/3, `as_rvalue.rs` 8/8): `expr_into_dest` (with its nested
  `is_supported_loop_match_type`, now inside the `LoopMatch` arm as upstream), `is_let`, `as_local_rvalue`, `as_rvalue`,
  `build_binary_op`, `check_constness`, `build_zero_repeat`, `limit_capture_mutability`, `neg_1_literal`, `minval_literal`.
- Signatures unchanged from the contract.
- `contract.test.ts`: markers 50 → 61, stubs 263 → 252, `mb-expr-b` removed from the per-lane table (0 left; commented).
- New unit tests `src/rustc_mir_build/builder/expr/into_as_rvalue.test.ts` (2 tests). They take the real `Builder` that
  `construct_fn` creates: the test swaps in a stand-in `in_scope` that throws to capture the builder, then restores it.
  - Real code only: `is_let` (also through `Scope`), the `Let` ICE, `as_rvalue(ThreadLocalRef)`, `build_binary_op`'s
    unchecked arm.
  - With test stand-ins for collaborators that are still stubs: `temp`, `assert`, and `literal_operand` / `zero_literal`
    (the last two use upstream's own bodies). The stand-ins are installed only for the test and restored after.
    Covered this way: the overflow-checked `Add`, signed `Div` (zero check, then the `MIN / -1` check, statements
    `Eq, Eq, BitAnd`), unsigned `Rem`, and the literal values `minval(i8) = 0x80` / `neg_1(i8) = 0xff`.
  - Stop pins: `expr_into_dest` / `as_rvalue` of a fn body stop at `scope::in_scope`; `as_local_rvalue` stops at
    `scope::local_scope`; `minval_literal` (without stand-ins) stops at `misc::literal_operand`. Move these pins as
    mb-scope / mb-mod land.

## Stops reached (end to end not reachable yet)
Every body stops at `scope::Builder::in_scope` (mb-scope) before reaching this lane's code. The next calls on these paths
belong to other lanes:
- mb-scope: `local_scope`, `in_breakable_scope`, `in_if_then_scope`, `in_const_continuable_scope`, `assert`,
  `diverge_from`, `record_operands_moved`, `schedule_drop_*`, `coroutine_drop_cleanup`
- mb-mod: `misc::temp`, `literal_operand`, `zero_literal`, `consume_by_copy_or_move`, `get_unit_temp`, `ast_block`
- mb-expr-a: `as_operand*`, `as_place*`, `as_temp`, `as_constant`, `stmt_expr`, `Category::of`
- mb-matches: `lower_if_condition`, `match_expr`, `lower_scrutinee`, `lower_match_tree`, `lower_match_arms`
- coverageinfo: `push_coverage_point_*`, `visit_coverage_standalone_condition`

## `unported(...)` left
None in this lane's files.

## `// PORT:` decisions
- `into.rs` `ExprKind::Adt`: `user_ty.clone()` shares the `CanonicalUserType`, which is immutable once built (precedent:
  thir/pattern/mod.ts's annotations).
- `into.rs` `InlineAsm` `Const`: thir's `InlineAsmOperand::Const::value` is generated as `unknown`, so it is cast to
  `mir::Const`. Worth typing it in the thir codegen (root / thir owner).
- `into.rs` `InlineAsm` `Label`: the arm's binding `block` (a `BlockId`) shadows the outer `block`, so the TS reads it as
  `op.block`.
- `itertools::zip_eq` (into.rs `Adt`, FRU / `DefaultFields` arms) is a module-local helper `zip_eq` in into.ts that panics
  with itertools' message. Move it to a shared vendor/std helper if one appears.
- `minval_literal`: `1 << (bits - 1)` is a `u128`, so it is a `bigint`.
- `match` arms with an `if let` guard (the `Call` intrinsic arm): the guard is evaluated in the `Call` case first, and the
  plain `Call` arm follows in the same case, so the arm order is kept.
- `unpack!` inside `.map(..)` closures (call args, `Adt` fields, `Array` / `Tuple` / closure upvars, asm operands) writes
  the captured `block`, as upstream does.

## Notes for root
- **Aliasing of `Copy` classes.** This lane follows `cfg.ts`: the same `Place` / `SourceInfo` object (`destination`,
  `source_info`, `state_place`, ...) is stored into several statements and terminators without cloning, while rustc
  copies it each time. If a later MIR pass changes a `Place` or `SourceInfo` in place (the `MutVisitor` writes leaves
  back through `field_mut`, and the inliner rewrites `source_info.scope`), this sharing becomes a bug. Decide whether
  `cfg.push*` / `terminate` should clone (one place) or whether passes must never mutate shared leaves.
- `contract.test.ts` count lines will conflict with the other fill lanes. Resolve by summing the deltas: this lane adds
  +11 markers and −11 stubs.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (19006; vendor 4196).
- `bun test src/rustc_mir_build`: 9 pass, 0 fail.
- Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (`RUST_TS_AGENT=mb-expr-b`, at `d48d4b8e`): 5780 pass,
  1 skip, 0 fail. Two earlier attempts did not finish: one was killed from outside mid-run (exit 144), one hit the 1 h
  background limit at load ~75.

## Samples (`RUST_TS_AGENT=root-ad4b`, compared case by case against root's base runs)
| suite | lane run | M / D / U | base run | case changes |
|---|---|---|---|---|
| mirdump-minicore | `20261022-103906-root-ad4b-gmj2` | 10 / 0 / 36 | `…-101711-root-ad4b-xljd` | none |
| tydump-minicore | `20261022-103942-root-ad4b-m6g0` | 45 / 0 / 1 | `…-101651-root-ad4b-9r7y` | none |
| tydump-ui `--sample 300` | `20261022-104017-root-ad4b-tblp` | 263 / 0 / 36 (+1 UNSTABLE) | `…-101731-root-ad4b-hqwm` | none |
| hir-tree `--sample 200` | `20261022-104358-root-ad4b-2y21` | 200 / 0 / 0 | — | 0 DIFF |

No change was expected: MIR building stops before this lane's code (see "Stops reached").
