# Handoff: wrong-num-args (wave 16, M3): rustc_hir_analysis diagnostics/wrong_number_of_generic_args.rs (E0107)

Branch `lane/wrong-num-args` (from `5171055`, the hirtylowerer-contract tip; no merges).

## Files touched
- `src/rustc_hir_analysis/diagnostics/wrong_number_of_generic_args.ts` (new): the whole upstream file. It has
  `class WrongNumberOfGenericArgs implements Diagnostic` (the 9 fields in declaration order, `static new`, the 34
  helpers, and the manual `impl Diagnostic` as the `into_diag` method), `AngleBrackets`, `GenericArgsInfo`,
  `debug_AngleBrackets` and `debug_GenericArgsInfo`.
- `src/rustc_hir_analysis/lib.ts`: one line, `export * as wrong_number_of_generic_args from "./diagnostics/wrong_number_of_generic_args.ts";`
  after `export * as diagnostics`. This is the only lib.ts edit.
- Tests (new):
  - `src/rustc_hir_analysis/diagnostics/wrong_number_of_generic_args.oracle.test.ts`;
  - `src/rustc_hir_analysis/diagnostics/wrong_num_oracle/`: `run.ts` plus 20 `<case>.rs` / `<case>.stderr` pairs.

No other file is touched. That includes decls.ts, diagnostics.ts, generics.ts, the `.gen.ts` files and tools/.

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs`:
  **36/36 ported**.
- `bun scripts/coverage.ts --check`: `markers ok (12297; vendor 3888)`.

## Tests
`wrong_number_of_generic_args.oracle.test.ts` follows the pattern of rustc_query_impl's cycle.oracle.test.ts:
- `wrong_num_oracle/run.ts` runs the **ported driver** on each `#![no_core]` program (`--target x86_64-unknown-linux-gnu
  --sysroot <oracle> --edition=2021 -Zui-testing`).
- In `after_expansion` it walks the HIR. For the last segment of every resolved path to a local
  struct/enum/union/alias/trait/fn/assoc fn, it runs a **stand-in `check_generic_arg_count`**.
- Its stderr and exit code are compared byte for byte with the pinned rustc's. The fixtures are checked against the oracle
  on every run, and `REGEN=1` rewrites them.
- Real: the diagnostic, the HIR and its accessors, `def_path_str` (trimmed paths, as in the real driver),
  `def_descr`, `def_ident_span` / `def_span`, `associated_items`, the source map and the emitter.
- Stand-ins (PORT(test), see run.ts's header):
  - `check_generic_arg_count`: upstream's counting logic and E0107 tail, without `prohibit_assoc_item_constraint` and
    the explicit-late-bound check;
  - the `generics_of` provider, built from the HIR (fn lifetimes are treated as late-bound);
  - `trait_def`: only `paren_sugar: false` is read.

**21/21 pass** (20 cases + the fixture check). The cases:

| group | cases |
|---|---|
| type args | `excess_ty`, `missing_ty`, `missing_ty_available`, `defaults` (at least / at most), `const_param` |
| lifetimes | `lifetimes_missing` (names from the definition), `lifetime_fn_arg` (an existing arg is replicated), `lifetime_const` (`'static`), `lifetimes_excess`, `mixed` (lifetimes + types: two errors, both removal suggestions) |
| traits | `trait_impl_excess`, `trait_impl_missing`, `trait_assoc_binding` ("turn the generic argument into an associated item binding"), `trait_impl_assoc` (`is_in_trait_impl`, so no suggestion), `missing_with_constraint` |
| value paths | `fn_value`, `synth` (the `impl Trait` note, "remove the unnecessary generics"), `assoc_fn_to_trait` (`Tr::<u8>::f()` multipart suggestion) |
| paths/descr | `enum_alias` (enum, type alias), `module_path` (`m::S` printed trimmed as `S`) |

Negative control: changing one word of the associated-item-binding message fails `trait_assoc_binding` only.

**PENDING** (not covered end to end; each needs an unmerged lane):
- Every real E0107 still stops in generics.ts. Lane c has `unported("rustc_hir_analysis::diagnostics::wrong_number_of_generic_args::WrongNumberOfGenericArgs::new (E0107, lifetimes)")`
  and `... (E0107, types/consts)`. The wiring below fixes this at merge. After that, suites need collect-a/-b
  (`type_of`, `generics_of`, `fn_sig`, `predicates_of`, ...) before they reach `check_generic_arg_count`.
- Method-call turbofish (`x.f::<u8>()`): `suggest_moving_args_from_assoc_fn_to_trait_for_method_call` and the
  `is_in_a_method_call` `_` suggestions need typeck's method resolution (wave 17+). They are ported but not exercised.
- The derive-expansion label ("this derive macro might not support items with generic parameters") needs a derive on a
  generic item (std / builtin derive), so it is not in a no_core reduction.
- `'_` suggestions in fn inputs and outputs: elided lifetimes are implied by AST lowering, so no reduction reached them.

## Wiring for root (at the merge with hir-ty-lowering-c)
In `hir_ty_lowering/generics.ts`, add `import { type GenericArgsInfo, WrongNumberOfGenericArgs } from
"../diagnostics/wrong_number_of_generic_args.ts";` (only read inside function bodies, so init order is fine). Then:
- `check_lifetime_args`: replace the PORT comment + `unported(..)` with
  ```ts
  let gen_args_info: GenericArgsInfo;
  if (provided_args > min_expected_args) {
    const num_redundant_args = provided_args - min_expected_args;
    gen_args_info = { $: "ExcessLifetimes", num_redundant_args };
  } else {
    const num_missing_args = min_expected_args - provided_args;
    gen_args_info = { $: "MissingLifetimes", num_missing_args };
  }
  const reported = cx.dcx().emit_err(WrongNumberOfGenericArgs.new(tcx, gen_args_info, seg, gen_params, has_self ? 1 : 0, gen_args, def_id, cx.item_def_id()));
  return Err(reported);
  ```
- `check_types_and_consts`: assign `gen_args_info = { $: "ExcessTypesOrConsts", num_redundant_args, num_default_params,
  args_offset, synth_provided }` and `{ $: "MissingTypesOrConsts", num_missing_args, num_default_params, args_offset }` in
  the two branches. Replace the `unported(..)` with
  `reported = cx.dcx().create_err(WrongNumberOfGenericArgs.new(tcx, gen_args_info, seg, gen_params, params_offset, gen_args, def_id, cx.item_def_id())).emit_err_unless_delay(all_params_are_binded || has_invalid_bound);`.
- Update lane c's two lowering_c.test.ts tests that expect those unported texts.

## `unported(...)` left
None in this file.

## PORT decisions (please record)
1. **Module placement.** Upstream declares the module in diagnostics.rs. diagnostics.ts belongs to other lanes, so lib.ts
   loads it (`wrong_number_of_generic_args` namespace re-export). It can move into diagnostics.ts later, as
   `export * as wrong_number_of_generic_args`.
2. **The struct is a class** implementing rustc_errors' `Diagnostic`. The manual `impl Diagnostic` is its `into_diag`
   method (marker :1161). `Self { .. }` in `new` is the constructor with all fields in declaration order.
3. **`AngleBrackets` / `GenericArgsInfo` and their `derive(Debug)` are hand-written** (PORTING §5 shapes). The codegen set
   `rustc_hir_analysis` does not list this file. Root may add the file to tools/codegen/types.sets.json and swap in the
   generated types. They are only read by `debug!` tracing.
4. **The lazy `filter` iterators** in `suggest_removing_args_or_generics` (`unbound_assoc_consts` / `_types`) are filtered
   arrays plus a cursor; `next()` is `xs[i++]`. `hir_parent_iter(..).skip(1).find_map(..)` is a loop with a skip flag.
   `iter().skip(a).take(n)` is `slice(a, a + n)`. `repeat_n(..).collect::<Vec<_>>()` is a local `repeat_n` helper.
5. **`usize` arithmetic** is plain `number` subtraction. Upstream's subtractions do not underflow for the inputs
   `check_generic_arg_count` builds. `saturating_sub` is `Math.max(0, ..)`.
6. **Query values typed `unknown`** are cast at the call: `associated_items` (`AssocItems`), `trait_def` (`TraitDef`),
   `generics_of` (`Generics`).
7. **Renamed accessors:** `GenericArgs::span_ext()` is `span_ext_()` and `PathSegment::args()` is `args_()` (rustc_hir's
   names, because the fields clash).
8. `assert!` messages use the Rust default text (`assertion failed: <expr>`).

## For root
- Do the wiring above when hir-ty-lowering-c merges.
- Optional: put this file in the `rustc_hir_analysis` codegen set (decision 3).
- `run.ts`'s stand-in `generics_of` / `check_generic_arg_count` can be removed once collect-a and lane c land. The test
  can then call the real `check_generic_arg_count` through an `ItemCtxt`.

## Samples
`RUST_TS_AGENT=wrong-num-args bun scripts/difftest.ts --suite hir-tree-nocore --sample 100`: 99 MATCH / 0 DIFF /
1 UNPORTED / 0 CRASH (run `20261014-150234-wrong-num-args-3sj4`). The UNPORTED case is pre-existing
(`tests/ui/typeck/issue-86721-return-expr-ice.rs`: `StableHash without a TS impl`).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: ok. `--missing` reports 0 left for the file.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src/rustc_hir_analysis`: 31 pass, 0 fail.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see "Test run".

## Test run
(pending)
