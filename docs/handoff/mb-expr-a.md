# Handoff: mb-expr-a (M4 wave 22, MIR build fill lane): builder/expr/{as_place, as_operand, as_temp, category, as_constant, stmt}.rs

Branch `lane/mb-expr-a` (from `7d76ddd0`, no merges). Commits: the port (42 stubs) → unit tests → this handoff.

## Result
- All 42 stubs of the lane are ported (`// rustc:` markers, upstream order, upstream comments kept). Coverage:
  as_place.rs 31/31, as_operand.rs 5/5, as_temp.rs 1/1, category.rs 1/1, as_constant.rs 3/3, stmt.rs 1/1.
- No `unported(...)` left in the lane's files. No signature of the contract changed.
- `src/rustc_mir_build/builder/contract.test.ts`: `mb-expr-a` removed from the per-lane table (0 stubs left), stubs
  263 → 221, markers 50 → 92. The `construct_fn` stop is unchanged (`scope::Builder::in_scope`, lane mb-scope): this lane
  is not on that path before `in_scope`.

## Files touched
- `src/rustc_mir_build/builder/expr/{as_place, as_operand, as_temp, category, as_constant, stmt}.ts` (filled).
- `src/rustc_mir_build/builder/expr/expr_a.test.ts` (new, unit tests).
- `src/rustc_mir_build/builder/contract.test.ts` (counts only, see above).

## `// PORT:` decisions
1. `**local_decl.local_info.as_mut().unwrap_crate_local() = local_info` (as_temp) and the read/overwrite in `as_operand`:
   the `Box<LocalInfo>` is the payload `_0` of the `Set` variant, written in place (`Clear` ICEs like `unwrap_crate_local`).
2. as_place.rs: the `PlaceBuilder` methods taking `self` by value (`field`, `deref`, `downcast`, `index`, `project`) push
   onto `this.projection` and return `this`; callers keeping the original must `clone_PlaceBuilder` first (upstream's
   `.clone()`). `base()` returns a copy (`clone_PlaceBase`). A `Place` used twice in the MIR built here is cloned for the
   second use (`clone_Place`: `slice_ptr`, `len` in `len_of_slice_or_array`, `lt` in `bounds_check`), per builder-contract
   decision 7 (MIR passes edit places in place). Fresh `Place_from_Local(..)` / `to_place` results are not cloned.
3. `strip_prefix` returns the remaining elements as an array (the lazy filtered iterator is the filtered array plus a
   cursor). `assert_matches!` failures panic with core's `assertion \`left matches right\` failed` text.
4. `ExprKind::StaticRef.alloc_id` is `unknown` in thir.gen.ts (the THIR set maps `mir::interpret::AllocId` to `unknown`,
   mir-contract "Stand-ins"); as_constant casts it to `AllocId`. Root: map it in middle_traits_thir.typemap.json when the
   THIR set is regenerated.
5. `user_ty.clone()` of the canonical user type (as_constant, `PlaceTypeAscription` / `ValueTypeAscription`) shares the
   value: no `clone_CanonicalUserType` exists and canonical values are not edited in place.
6. `IndexVec::push` results: `IndexVec.push(..)` (rustc_index/vec.ts) for `local_decls` / `canonical_user_type_annotations`
   (as_constant's closure computes the index by hand, same value).

## Stops reached (other lanes' stubs on these paths)
- mb-scope: `in_scope` (every `ExprKind::Scope`), `local_scope` (`local_temp_lifetime`), `schedule_drop_storage` /
  `schedule_drop_value` / `schedule_backwards_incompatible_drop` (as_temp), `assert` (bounds_check), `break_scope`,
  `break_const_continuable_scope`, `break_for_tail_call`, `record_operands_moved`, `build_drop_and_replace` (stmt_expr).
- mb-expr-b: `expr_into_dest` (as_temp), `as_local_rvalue`, `build_binary_op` (stmt_expr).
- mb-mod: `Builder::temp` (len_of_slice_or_array for slices, bounds_check), `push_coverage_point_for_expr` (inside the
  `in_scope` closures).

## Unit tests (`expr_a.test.ts`, 5 tests, 58 expects)
`Builder::new` over the THIR of `pub fn g(x: u8, y: bool) -> u8 { if y { x } else { 5 } }` (no_core, edition 2024), locals /
`var_indices` filled by hand where `args_and_body` (mb-mod) would:
- `Category::of`; `convert_to_hir_projections_and_truncate_for_capture` (Downcast variant carried to the next Field,
  PhantomDeref / OpaqueCast skipped, Index truncates); `is_ancestor_or_same_capture`.
- `PlaceBuilder` ops, `clone_project`, `to_place` (interned projection, `((*_1).0: u8)[_2]`), an unresolvable upvar
  (edition 2024 → `try_to_place` = None, `to_place` ICEs).
- `lit_to_mir_constant` (u8 truncation, negated i32, error type, invalid combination ICE); `as_operand` of the literal
  (constant, no temp, no statements); Scope → `in_scope` stop; `as_local_operand` → `local_scope` stop.
- `as_place` / `as_read_only_place` of a `VarRef` → `_1`; `as_temp` of the literal (immutable `Boring` temp,
  `StorageLive`, then the `expr_into_dest` stop); a literal in place context → `schedule_drop_storage` stop; `stmt_expr`
  without a statement scope → the upstream assertion.
- `len_of_slice_or_array` (array: `FakeRead(ForIndex, _n)` + the type's length constant; slice behind `&` → `temp` stop),
  `add_fake_borrows_of_base` (`_3 = &fake shallow _2` for `*_2: [u8]`, none for an array), `read_fake_borrows`.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (19037; vendor 4196).
- `bun test src/rustc_mir_build`: 12 pass, 0 fail.
- Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (`RUST_TS_AGENT=mb-expr-a`): **5783 pass, 0 fail**. Run one
  crate directory of `src/*/` at a time (all 48 directories; there are no top-level `src/*.test.ts`). Two whole-tree runs
  never finished. The first was killed by an outside signal (exit 144, no summary; root later warned that broad `pkill`s
  were killing lanes' runs). The second was stopped at the 1 h background limit under load average 60-75.

## Samples (lane vs root's base runs at `7d76ddd0`; both `RUST_TS_AGENT=root-ad4b`, same samples, compared per case: status and stop)
| suite | lane run | M / D / U / C | base run | per case |
|---|---|---|---|---|
| tydump-minicore | `20261022-105023-root-ad4b-l67v` | 45 / 0 / 1 / 0 | `20261022-101651-root-ad4b-9r7y` | 46 same |
| mirdump-minicore | `20261022-105101-root-ad4b-8azk` | 10 / 0 / 36 / 0 | `20261022-101711-root-ad4b-xljd` | 46 same |
| tydump-ui `--sample 300` | `20261022-105154-root-ad4b-oap9` | 263 / 0 / 36 / 0 (+1 unstable) | `20261022-101731-root-ad4b-hqwm` | 300 same |
| hir-tree `--sample 200` | `20261022-105513-root-ad4b-u170` | 200 / 0 / 0 / 0 | (base: 0 DIFF) | — |

No new DIFF; no case changed status or stop (MIR building is not reached end to end yet: mirdump stops before the
builder, see builder-contract "Not moved by this lane").
