# Handoff: builder-contract (M4 wave 22, contract-first): the `Builder` contract of rustc_mir_build builder/*

Branch `lane/builder-contract` (from `382156b7`, no merges). One commit: codegen set + hand modules with stubs + wiring +
contract test + this handoff.

## Result
- **Codegen set `rustc_mir_build_builder`** (types.sets.json): every type of the 24 builder/** files and
  check_tail_calls.rs → 12 `*.gen.ts` (`src/rustc_mir_build/builder/**/*.gen.ts`, `src/rustc_mir_build/check_tail_calls.gen.ts`),
  71 types with derived Debug / Clone (`auto_class`, `derive_clone`). Report: 0 unknown types, 0 missing Debug / Clone,
  0 manual impls. Set-local `tools/codegen/mir_build_builder.typemap.json` (builder/* reaches mir through the glob
  `use rustc_middle::mir::*;`, which the generator does not follow, so the bare mir / thir / region / ty names are mapped
  for this set only).
  - Hand types (`hand` in the set): `Builder` (class with all fields, builder/mod.ts), `BlockAnd` (the tuple
    `[BasicBlock, T]`, builder/mod.ts), `TailCallCkVisitor` (extends rustc_middle thir/visit.ts's `Visitor`; its field
    `thir` is `thir_` because `Visitor::thir()` has the same name, precedent check_match's `MatchVisitor`).
  - `import_gen: ["rustc_mir_build/builder/matches/mod.ts"]` (new set option, tools/codegen/types.ts): the set's generated
    modules import matches/mod.rs's types from `matches/mod.gen.ts`, not the hand module. Without it scope.gen.ts imported
    `debug_BuiltMatchTree` from matches/mod.ts, an extension module, and builder/mod.ts (which needs `Scopes` from
    scope.gen.ts) evaluated `Builder.prototype.<..> = ..` while `Builder` was still in its TDZ. Regenerating changes
    only three import lines (scope.gen.ts, matches/buckets.gen.ts, matches/match_pair.gen.ts); no other set uses the
    option.
- **Every fn of the scope files is declared** (25 files, 313 upstream fns; `src/rustc_mir_build/builder/contract.test.ts`,
  scan = coverage): 50 ported (`// rustc:`), 263 `// stub: <path>:<line> <name> (lane <lane>)` directly over the final
  signature with body `unported("rustc_mir_build::<module>::<Type>::<name>")` (the test checks that the path names the fn's
  own module).
- **Ported here (contract glue)**:
  - builder/mod.rs 27/31: `build_mir_inner_impl` (the hook), `construct_fn`, `construct_const`, `construct_error`,
    `Builder::new`, `finish`, `dump_for_debugging`, `BlockAnd` + `and` / `unit` / `into_block`, the small helpers,
    `closure_saved_names_of_captured_variables` (provider), `parse_float_into_scalar` / `parse_float_into_constval`
    (moved from thir/constant.ts's stand-in, where they had no marker, to their upstream home with markers).
    `construct_error` is ported here, not in mb-mod as plan-m4 has it.
  - builder/cfg.rs 13/13.
  - scope.rs 6/60: `DropTree::new`, `Scopes::new`, `new_source_scope`, `source_info` (what `Builder::new` needs).
  - coverageinfo.rs 1/15: `CoverageInfoBuilder::new_if_enabled`.
  - check_tail_calls.rs 3/20: the `check_tail_calls` provider and its visitor's `thir` / `visit_expr`.
- **Wiring** (`rustc_mir_build/lib.ts`): builder/mod.ts first, then every extension module in upstream module order, then
  check_tail_calls.ts. `provide` sets `providers.hooks.build_mir_inner_impl` and the `check_tail_calls` /
  `closure_saved_names_of_captured_variables` providers.
- **Where MIR building stops now** (contract test, `pub fn f(x: u8, y: bool) -> u8 { x }` on no_core):
  `tcx.build_mir_inner_impl(f)` stops at `check_match` (lane thir-pattern / mb-check-match), before the builder.
  `tcx.check_tail_calls(f)` returns `Ok(())`. `thir_body` → `construct_fn` runs `Builder::new` and stops at the first stub,
  `scope::Builder::in_scope` (mb-scope). `construct_error` builds rustc's error body: locals `[return, args..]`, one block
  terminated by `Unreachable`, one source scope, `tainted_by_errors` set.

## Representation decisions (please record)
1. `BlockAnd<T>` is the tuple `[BasicBlock, T]`. `unpack!(block = e)` is `[block, x] = e` (with `let x: T;` declared
   first when the macro's value is bound by `let`), and `[block] = e` for `BlockAnd<()>`. `e.into_block()` is
   `BlockAnd.into_block(e)`, and `block.and(v)` / `block.unit()` are `and(block, v)` / `unit(block)`.
2. `()` as a type argument is `null` (codegen's mapping): `BlockAnd<()>` is `BlockAnd<null>`, `PResult<()>` is `PResult<null>`.
3. `impl Builder` is split over every builder file (PORTING §5). Each file declares its methods in
   `declare module "<..>/mod.ts" { interface Builder { .. } }` and assigns `Builder.prototype.<name>`; mod.rs's methods
   are in the class body. Methods of the generated builder classes (`CFG`, `Scopes`, `DropTree`, `PlaceBuilder`,
   `Candidate`, ...) augment their `.gen.ts` module (`interface X` / `namespace X` for associated fns). `new` is `new_`,
   exported as `new`. Enum methods go on the companion (`<Enum>_methods`, PORTING §8).
4. `let this = self;` (LET_THIS_SELF) is `this`. The closures `|this| ..` / `|builder| ..` that methods hand the builder to
   take it as a parameter (`(this_) => ..`; PORTING §4: `this` is reserved).
5. `&mut BasicBlock` / `&mut Option<BasicBlock>` out-parameters are `MutRef<..>` (PORTING §8).
6. Struct-keyed maps (`FxHashMap<LocalVarId, _>`, `FxHashMap<DropNodeKey, _>`, `FxIndexMap<TestBranch, _>`,
   `FxIndexMap<Place, _>`, ...) are `KeyedMap`s (rust_ts/keyed.ts) with their module's key fns (`key_LocalVarId`, ...).
   A `KeyedMap` is a `Map`, so the generated field types hold them.
7. `SourceInfo`, `Place`, `region::Scope` are `Copy` classes: clone them (`clone_SourceInfo`, ...) where rustc copies one
   into a place that is later mutated in place (e.g. `LocalDecl.source_info`).
8. `construct_fn` is exported (private upstream) so the contract test can call it while the hook stops at `check_match`.

## Init order (TDZ-free; checked by contract.test.ts loading the crate)
- builder/mod.ts (defining `Builder`) imports only `*.gen.ts` modules of builder/ (and other crates), never an extension
  module. Every other builder module imports `Builder` from it, so it is evaluated first. Free fns of other builder
  modules that mod.ts calls (`custom::build_custom_mir`) are read lazily (`require`) inside the calling function.
- A `.gen.ts` that builder/mod.ts imports must not value-import an extension module. For matches/mod.rs this is the
  set's `import_gen`; add a hand module there if a new generated import would break the rule.
- thir/constant.ts imports `parse_float_into_scalar` from builder/mod.ts, so builder/mod.ts may be entered from the THIR
  half too (fine while the rule above holds).
- A new extension file must be added to `rustc_mir_build/lib.ts`.

## Split table (fill lanes, wave 22; upstream lines)
| lane | upstream (compiler/rustc_mir_build/src/) | lines | stubs | notes |
|---|---|---|---|---|
| mb-mod | builder/mod.rs (rest: `insert_upvar_arg`, `args_and_body`, `set_correct_source_scope_for_arg`, `get_unit_temp`), block.rs, coverageinfo.rs (rest), misc.rs | ~1.1k left | 25 | `construct_fn` reaches `args_and_body` inside `in_scope` → `in_breakable_scope` → `in_scope` (mb-scope) |
| mb-scope | builder/scope.rs (rest) | 2186 | 54 | `in_scope`, then `in_breakable_scope`: the first stubs every fn body hits |
| mb-expr-a | builder/expr/{as_place, as_operand, as_temp, category, as_constant, stmt}.rs | 1690 | 42 | |
| mb-expr-b | builder/expr/{into, as_rvalue}.rs | 1704 | 11 | |
| mb-matches-a | builder/matches/mod.rs lines 1-1499 | ~1500 | 28 | |
| mb-matches-b | builder/matches/mod.rs lines 1500-3010 | ~1510 | 21 | |
| mb-matches-c | builder/matches/{test, match_pair, buckets, user_ty, util}.rs | 1739 | 31 | |
| mb-custom-tail | builder/custom/{mod, parse, parse/instruction}.rs, check_tail_calls.rs (rest) | 1473 | 51 | |

## How to fill a stub
1. `grep -rn "// stub: compiler/rustc_mir_build/src/<file>:<line> <name>" src` (or `bun scripts/coverage.ts --missing
   <path>`). Keep the signature. If it is wrong, say so in your handoff, or fix it and say so (declarations are
   root-owned after integration).
2. Replace the body in place (prototype assignment, `.gen.ts` augmentation, companion assignment or free fn) and turn the
   comment into `// rustc: <path>:<line> <name>`.
3. Conventions: "Representation decisions" above; builder/mod.ts's header repeats them.
4. Init order: the rules above. No new cross-module reads at load.
5. `src/rustc_mir_build/builder/contract.test.ts`: lower your lane's stub count (and the total) as you port. The
   `construct_fn` stop moves to the next stub on the path (re-pin it to the new stop; do not drop the check).

## Not moved by this lane (samples)
mirdump-minicore's UNPORTED cases stop before MIR building: `check_unsafety provider (not ported)` (29, mb-unsafety),
`mir_keys provider (not ported)` (6, mt-skeleton), `PseudoCanonicalInput<GlobalId>` (1). `mir_built` itself is in
rustc_mir_transform (lib.rs:393, mt-skeleton); `mir_promoted` also needs mt-promote. So MIR build output needs mb-* plus
mb-unsafety, mb-check-match and mt-skeleton.

## Shared files edited (review)
`src/rustc_mir_build/lib.ts` (builder imports, `provide`), `src/rustc_mir_build/thir/constant.ts` (stand-in
`parse_float_into_scalar` removed, imported from builder/mod.ts), `tools/codegen/types.sets.json` (new set),
`tools/codegen/types.ts` (`import_gen` option), `tools/codegen/mir_build_builder.typemap.json` (new).

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (18896; vendor 4196).
- Coverage of the scope files: builder/cfg.rs 13/13, builder/mod.rs 27/31, scope.rs 6/60, coverageinfo.rs 1/15,
  check_tail_calls.rs 3/20; the rest 0 (stubs).
- `src/rustc_mir_build/builder/contract.test.ts`: 3 tests pass (scan = coverage, stubs per lane, runtime).
- `bun test src` (full, `RUST_TS_AGENT=builder-contract`): 5764 pass, 1 skip, 3 fail. None is this lane's:
  - rustc_middle `mir/pretty.test.ts` "whole bodies ... write_mir_pretty" and `mir/debug.oracle.test.ts` "display_Const of a
    `Const::Val` stops at pretty_print_const_value" (now stops at `rustc_const_eval::const_eval::try_destructure_mir_constant_for_user_output`):
    both fail the same way at base `382156b7` (rerun in a temporary base worktree, then removed).
  - vendor `odht/odht.oracle.test.ts` "build: insert results ...": hit the 5 s default timeout (machine loaded by
    other sessions' test runs). Rerun with `--timeout=120000`: passes.

## Samples (lane vs base; both `RUST_TS_AGENT=builder-contract`, same samples)
| suite | lane run | M / D / U / C | base (at `382156b7`) M / D / U / C |
|---|---|---|---|
| mirdump-minicore | `20261022-101240-builder-contract-b9ws` | 10 / 0 / 36 / 0 | 10 / 0 / 36 / 0 |
| tydump-minicore | `20261022-101254-builder-contract-9ml2` | 45 / 0 / 1 / 0 | 45 / 0 / 1 / 0 |
| tydump-ui `--sample 200` | `20261022-101314-builder-contract-suyq` | 172 / 0 / 28 / 0 | 172 / 0 / 28 / 0 |
| hir-tree `--sample 200` | `20261022-101429-builder-contract-whdk` | 200 / 0 / 0 / 0 | 200 / 0 / 0 / 0 |

No change, as expected: mirdump stops before MIR building (see "Not moved by this lane"). Base runs were taken before
any change (runs `20261022-0854*`, removed worktree `lanes/builder-contract-base`).
