# Review: lane `ssa-debuginfo` (M7, wave 40o)

Reviewer: independent, read-only on code. Branch `t3/port-ssa-debuginfo`, commits `1c510de5` (port, tests, fixtures),
`fb3f91db` and `ce0d66b8` (handoff), against `main` at `ba273e7f` (`git diff ba273e7f..ce0d66b8`). Upstream:
`$RUST_TS_DATA/rust` at the pin (`6f5da406b`), `compiler/rustc_codegen_ssa/src/{mir/debuginfo.rs,debuginfo/mod.rs,debuginfo/type_names.rs}`.

## Verdict: **PASS WITH NOTES**

There are no must-fix findings in the lane's code. I read every function against upstream, and each follows it in order
and logic. There are no guessed values. The branches the tests can't reach (inlined scopes and discriminators, statement
debuginfo, projections and composite fragments, msvc's individual allocas, coroutines, `{CONST#hash}`, vtable names) are
line-by-line ports. The three oracle `.ll` files regenerate byte for byte. The most important note is **N1**: the
handoff's merge-step list leaves out a unit test that breaks once root repoints `statement.ts`. I checked that.

## Commands (AC power, no gate running, `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0 RUSTC_ICE=0`)

| command | result |
|---|---|
| `bunx tsc --noEmit -p .` | clean (exit 0) |
| `bun scripts/coverage.ts --check --offline` | `markers ok (26635, 44 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 744; llvm 404)` |
| `bun test ./src/rustc_codegen_ssa/ ./src/std/result.test.ts` | **128 pass, 0 fail** (20 files, 1346 expects) |
| `bun test ./scripts/lib/unit-steps.test.ts` | 10 pass, 0 fail |

## 1. Order and coverage

| upstream file | `coverage.ts --missing` |
|---|---|
| `rustc_codegen_ssa/src/mir/debuginfo.rs` | 31/31 |
| `rustc_codegen_ssa/src/debuginfo/mod.rs` | 3/3 |
| `rustc_codegen_ssa/src/debuginfo/type_names.rs` | 20/20 |

I checked every `// rustc:` marker in the three files with a script. Each one names the upstream line holding `fn <name>`,
so there are no mismatches. The marker lines go up in upstream order, except `spill_operand_to_stack` (N3).

## 2. Logic fidelity

**`mir/debuginfo.rs`**
- `compute_per_local_var_debug_info` (debuginfo.ts:674, rs:554):
  - The early return is `!full_debug_info && fewer_names()`. `var_ty` comes from the composite type, then the `Place`
    and `Const` arms.
  - `ArgumentVariable` requires `argument_index`, no composite, a `Place` value and an empty projection. On msvc a
    `ScalarPair` argument is a `LocalVariable`.
  - `params_seen` is keyed on (scope, index). The map of maps behaves like the `Entry` API, because a `None` value is
    never stored.
  - The composite fragment does the ZST `continue`, returns `None` for a full-size fragment, and the range otherwise. The
    `indirect_offsets.is_empty()` assert is kept.
  - The `Const` arm `continue`s when there is no `dbg_loc`, before `eval_mir_constant_to_operand`, as upstream does.
- `debug_introduce_local` (debuginfo.ts:418, rs:310):
  - The closure-env hiding is kept (`arg_index == 0 && has_proj()`).
  - The fallback `ArgumentVariable(arg_index + 1)` is created only with full debuginfo.
  - The name is `whole_local_var` or else `fallback_var`. A `sym::empty` name falls back to `{local:?}`.
  - The `Place`/`UnsizedPlace`/`Operand` (`Ref`, `Immediate`, `Pair` with `.0`/`.1`, `ZeroSized`)/`PendingOperand` arms
    match upstream.
  - The early return is `!full || vars.is_empty() && fallback.is_none()`, with the same precedence.
  - Spilling has the naked-fn and AArch64 SVE (`count != 16`) early returns. `UnsizedPlace` returns. The vars are chained
    with the fallback last.
- `spill_operand_to_stack` appends the `.dbg.spill` suffix only when there is a name.
- `debug_introduce_local_as_var` (rs:470): `should_create_individual_allocas` is a faithful rendering of
  `!matches!(&indirect_offsets[..], [Size::ZERO] | [])`. The pointer alloca is named `<var>.dbg.spill`.
- `calculate_debuginfo_offset` (rs:168):
  - `Deref` pushes `ZERO`.
  - `Field` and `ConstantIndex { from_end: false }` add to the last indirect offset, or else to the direct offset.
  - `ConstantIndex` checks for the `Array` shape before `bug!`.
  - The `_` arm keeps `assert!(!elem.can_use_in_debuginfo())` with its message. `from_end: true` falls through to it,
    as in Rust.
- The two `DebugInfoOffsetLocation` impls match rs:107–157.
- `set_debug_loc`, `dbg_loc` and `adjusted_span_and_dbg_scope` (with `walk_chain_collapsed` against `mir.span`) match.
- `codegen_stmt_debuginfo` (rs:683):
  - The `Place` arm passes the full projection.
  - An `Operand` with an indirect first projection uses `deref(cx)` and `projection[1..]`.
  - The other arms give `None`, then the `can_use_in_debuginfo` filter, then poison.
- `fill_function_debug_context` and `make_mir_scope` (rs:736, :772):
  - The root scope uses `dbg_scope_fn(instance, fn_abi, Some(llfn))`.
  - Scopes with no variables that aren't inlined return the parent.
  - `inlined_function_scopes` behaves as `entry().or_insert_with`, using `fn_abi_of_instance(callee, List::empty())`.
  - The discriminator map stores 0 on first sight and increments afterwards, with `clone_with_discriminator`, falling
    back to `DUMMY_SP`.
  - `inlined_at` is `.or(parent.inlined_at)`.

**`debuginfo/mod.rs`**: `wants_c_like_enum_debuginfo`, `tag_base_type` and `tag_base_type_opt` are faithful. The niche
`Float` arm uses `from_size().unwrap()`. `Pointer` uses `ptr_sized_integer`. `Direct` uses `to_ty`. See also N5.

**`debuginfo/type_names.rs`**: I compared every `TyKind` arm in both forms.
- `str`/`str$`, `!`/`never$`.
- `*const `/`ptr_const$<`, `*mut `/`ptr_mut$<`, `&`+`prefix_str`/`ref$<`/`ref_mut$<`.
- `[T; N]`/`array$<T,N>`, with the `Param` name or `try_to_target_usize`.
- `pat$<..,{:?}>`/`{:?}`, `[T]`/`slice2$<T>`, `(..)`/`tuple$<..>`.
- Adt with `enum2$<>` from `msvc_enum_fallback` when the type is not a C-like enum. A layout error is fatal.
- `dyn`/`dyn$<`:
  - The `(dyn ` parens appear only when `len() > 1` and there are auto traits.
  - The principal is normalized, then `pop_close_angle_bracket` + separator, or `<`, for projection bounds.
  - Bounds are `assoc$<Name,T>` or `Name=T`.
  - Auto-trait names are fully qualified and sorted. `cmp_str` is code-point order, which equals `String`'s byte order.
- fn pointers:
  - The `visited` recursion guard prints `recursive_type$`/`<recursive_type>`.
  - The gnu form is `unsafe `/`extern "abi" `/`fn(..) -> R`. The msvc form is `R (*)(..)`/`void (*)(..)`.
  - The `...` for c-variadic is kept.
- Closures and coroutines use `push_closure_or_coroutine_name`. The parent comes from `def_key.parent.unwrap()`, then
  `{label_env#N}` or `label_env$N`, then the args truncated to the typeck root's generics. On msvc, coroutines (only)
  get `enum2$<>`.
- `unsafe `/`unsafe$<`, and `bug!` for the rest.
- `push_generic_args_internal` returns `false` with no output when there are no non-erasable args. Its separator,
  `pop_arg_separator` and close match upstream.
- `push_debuginfo_const_name`:
  - `Int` is `sign_extend`. `BigInt.asIntN(128, ..)` changes nothing because `Size::sign_extend` already returns i128
    at the pin (rustc_abi lib.rs:958).
  - `Uint` and `Bool` are printed as is.
  - The fallback is `{CONST#hex}`/`CONST$hex` over `Hash64`'s u64, with spans not hashed.
- `push_close_angle_bracket` adds msvc's `> >` space.
- `coroutine_kind_label` covers all 11 cases.
- `push_disambiguated_special_name` gives `{label#N}`/`label$N`.
- `push_unqualified_item_name` handles `CrateRoot`, `Closure` and `Named`, and `Anon` through the namespace.
- `compute_debuginfo_vtable_name` gives `impl$<T, Trait>`/`<T as Trait>` or `_`. `visited.clear()` is kept, and so are
  the four suffixes.

## 3. No guessed values

There is no `unported(...)` in the three files, and I found no invented value. The untested paths above are direct
transcriptions with upstream's constants (`"::vtable$"`, `"recursive_type$"`, the discriminator fallback,
`".dbg.spill"`). The only casts are the documented `dctx`/`per_local` placeholders and the `tcx.coroutine_kind(..) as
CoroutineKind | undefined` cast, which `rustc_middle/ty/context.ts` already uses.

## 4. Tests

- **Oracle files.** I regenerated all three in the scratchpad from a copy of `debuginfo.rs`, using the README's commands
  (`rustc +nightly-2026-10-11`, which reports `1.101.0-nightly (6f5da406b 2026-10-10)`, the pin). `gnu.ll`,
  `gnu-g.ll` and `msvc-g.ll` are all **byte-identical** to the committed files. No fixture file holds `/Users`,
  `/private` or `/tmp`. The commands use a relative input with `--remap-path-prefix=$PWD=.`.
- **Type names.** `TYPE_NAMES` has 30 entries (21 from `types`, 3 from `closure`, 4 from `pair_closure`, `pair.p`,
  `big.b`). The test requires the port's output to equal the table and each entry to be one of the IR's `name:` fields,
  for both gnu and msvc. I grepped a sample in the oracle and found it there: `&(dyn debuginfo::Tr + debuginfo::Send)`,
  `ConstI<-3>`, `Wrap<debuginfo::{impl#15}::pair_closure::{closure_env#0}>`, `enum2$<debuginfo::Opt<u32> >`,
  `ref$<dyn$<debuginfo::WithAssoc<assoc$<Out,u32> > > >`, `ref$<dyn$<debuginfo::Tr,debuginfo::Send> >`.
- **Auto-trait sort gap.** See N2.
- The test runs no rustc and reads no environment variable. `unit-steps.test.ts` passes.

## 5. The integration note and the merge-step list

- **`.deref()` is right.** Upstream calls `self.codegen_stmt_debuginfos(bx, &statement.debuginfos)` (statement.rs:13),
  and `StmtDebugInfos` derefs to `[StmtDebugInfo]`. The port's `StmtDebugInfos` has `deref(): readonly StmtDebugInfo[]`
  (rustc_middle/mir/statement.ts:320), and `block.ts:1708` already passes `after_last_stmt_debuginfos.deref()`. The
  `statement.ts` stub takes the `StmtDebugInfos` itself, so its forwarder needs `.deref()`.
- **Call sites.** Every upstream caller outside the lane is covered by the list: mod.rs:278, :281 and :366, block.rs (10
  `set_debug_loc` sites, 3 `debug_introduce_local` sites and `codegen_stmt_debuginfos`), and statement.rs:13, :14 and
  :42. They all go through `xlane`, `block_xlane` or `stmt_xlane`. No file in `rustc_codegen_llvm` references
  `type_names` or `debuginfo/mod.rs` yet, so step 4 (`lib.ts`) is enough.
- **The list is not complete.** See N1.

## 6. Scope

`git diff --stat ba273e7f..ce0d66b8` touches only `docs/handoff/ssa-debuginfo.md`, `src/rustc_codegen_ssa/mir/debuginfo.ts`,
`src/rustc_codegen_ssa/debuginfo/{mod,type_names}.ts`, `src/rustc_codegen_ssa/mir/debuginfo.test.ts` and
`src/rustc_codegen_ssa/mir/debuginfo_oracle/*`. These are all the lane's files.

## Findings

### F (must fix)

None.

### N (notes)

- **N1. The merge-step list leaves out `mir_rest.test.ts`**
  - **Where:** `docs/handoff/ssa-debuginfo.md`, "Stub sites root must repoint". The test is
    `src/rustc_codegen_ssa/mir/mir_rest.test.ts:373` (upstream statement.rs:13).
  - **The problem:** that test asserts the `statement.ts` stub's stop:
    `expect(() => fx.codegen_statement(bx, stmts[0]!)).toThrow("ssa-debuginfo: … codegen_stmt_debuginfos")`.
  - **How I checked:** in a throwaway worktree (since removed), I applied steps 1 to 3 exactly as written: the installer
    call, the `xlane`, `block_xlane` and `stmt_xlane` forwarders, and `.deref()`. Then
    `bun test ./src/rustc_codegen_ssa/ ./src/rustc_codegen_llvm/` gave **234 pass, 1 fail**, and the failure was this
    assertion ("Received function did not throw").
  - **What to add:** the list needs a step 5: update or drop that assertion. Once the stubs are replaced, the statement
    runs through, because `debug_context` is `None` without `-g`. Nothing else in the repo expects an
    `ssa-debuginfo: compiler/…` stop, apart from `docs/handoff/ssa-mir-rest.md` (text only).
  - **Who acts:** this is a handoff omission, not a code defect. Root (or whoever owns `mir_rest.test.ts` at
    integration) must make the change in the merge commit, or the gate's unit tests fail.
- **N2. The auto-trait sort is not tested**
  - **Where:** `type_names.ts:389` (`auto_trait_names.sort(cmp_str)`), upstream type_names.rs:317
    (`auto_traits.sort_unstable()`).
  - **Why it matters:** the port reads correctly, and `cmp_str` gives `String`'s order. But `auto_traits()` comes out in
    `stable_cmp` (DefPathHash) order, not name order. `dyn Any + Send + Sync` is common in std, so the sort matters as
    soon as IR suites reach std types.
  - **Suggested follow-up:** the fixture already declares a second auto trait (`Freeze`, debuginfo_oracle/debuginfo.rs:24)
    next to `Send`. Adding a variable such as `&(dyn Tr + Send + Freeze)` (or a third auto trait whose name order
    differs from its DefPathHash order) to `types`, and regenerating, would close the mutation gap. This is worth doing
    in a later batch, not blocking.
- **N3. `spill_operand_to_stack` is out of upstream order**
  - **Where:** `debuginfo.ts:326` (upstream rs:243) is placed before `set_debug_loc` (rs:221), `dbg_loc` (rs:228) and
    `adjusted_span_and_dbg_scope` (rs:233). These three live inside the installer.
  - **Why it is fine:** the move follows from PORT decision 5 (an associated fn without `self` becomes an exported free
    function) and is documented. Moving it below the installer wouldn't restore the order either, so it can stay.
- **N4. The `TYPE_NAMES` table is read off the IR by hand**
  - **Where:** `debuginfo.test.ts:387`.
  - **The gap:** the test checks that each name exists among the IR's `name:` fields. It doesn't follow the variable's
    `DILocalVariable type:` link, so a name present in the IR for a different variable would pass the oracle half of the
    check.
  - **Why it is fine:** the equality with the table makes this unlikely. I spot-checked six entries by hand. A
    non-blocking test improvement.
- **N5. `wants_c_like_enum_debuginfo` computes `tag_ty` before the test**
  - **Where:** `debuginfo/mod.ts:32` (upstream mod.rs:25–28).
  - **What changed:** the `&&` chain is split into a precomputed `tag_ty`, guarded by `cpp_like_debuginfo(tcx)`, so
    `tag_base_type_opt` (with its assert) still runs only for cpp-like targets.
  - **Why it is fine:** the semantics are unchanged. `cpp_like_debuginfo` is called twice, which is harmless. No change
    needed.
