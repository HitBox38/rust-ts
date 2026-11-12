# Handoff: ssa-debuginfo (M7, wave 40o): rustc_codegen_ssa `mir/debuginfo.rs`, `debuginfo/{mod,type_names}.rs`

Branch `t3/7b70f718`, from `ba273e7f`. No merges.

## Summary
- All three files are ported in upstream order with markers: **54/54 fns**.
  - `mir/debuginfo.rs` 31/31: `FunctionDebugContext`, `VariableKind` (ssa-contract's surface, unchanged), `PerLocalVarDebugInfo`,
    `ConstDebugInfo`, `DebugScope` (+ `adjust_dbg_scope_for_span`), `DebugInfoOffsetLocation` with its two impls, `DebugInfoOffset`,
    `calculate_debuginfo_offset`, and the `impl FunctionCx` block (`set_debug_loc` … `make_mir_scope`) in
    `install_FunctionCx_debuginfo(FunctionCx)`.
  - `debuginfo/mod.rs` 3/3: `wants_c_like_enum_debuginfo`, `tag_base_type`, `tag_base_type_opt`.
  - `debuginfo/type_names.rs` 20/20: `compute_debuginfo_type_name` and its helpers (gnu and `cpp_like_debuginfo` forms),
    `compute_debuginfo_vtable_name`, `push_item_name`, `push_generic_args`, `cpp_like_debuginfo`.
- Nothing in the port printed these names before: rustc_symbol_mangling's printers give other forms (`{{closure}}`, no `{impl#N}`),
  so `type_names.rs` is ported as is (PORT note in its header). No partial `type_names` existed.
- Nothing protected reaches this code (the backend is not registered). Sample difftests are unchanged (below).

## Files touched
- `src/rustc_codegen_ssa/mir/debuginfo.ts`: replaces ssa-contract's stub (keeps `VariableKind` and its companion as they were).
- `src/rustc_codegen_ssa/debuginfo/mod.ts`, `src/rustc_codegen_ssa/debuginfo/type_names.ts`: new.
- Tests, new: `src/rustc_codegen_ssa/mir/debuginfo.test.ts`; fixture dir `src/rustc_codegen_ssa/mir/debuginfo_oracle/`
  (`debuginfo.rs`, `README.md`, and the oracle's `gnu.ll`, `gnu-g.ll`, `msvc-g.ll`, made from inside that directory with
  `--remap-path-prefix=$PWD=.`; none holds an absolute path).
- No other file is edited.

## Coverage (`bun scripts/coverage.ts --missing <file>`)
| upstream file | ported |
|---|---|
| compiler/rustc_codegen_ssa/src/mir/debuginfo.rs | 31/31 |
| compiler/rustc_codegen_ssa/src/debuginfo/mod.rs | 3/3 |
| compiler/rustc_codegen_ssa/src/debuginfo/type_names.rs | 20/20 |

`bun scripts/coverage.ts --check --offline`: `markers ok (26635, …)`.

## Evidence
- `bunx tsc --noEmit -p .`: clean.
- `bun test ./src/std/result.test.ts ./scripts/lib/unit-steps.test.ts`: 13 pass.
- `bun test ./src/rustc_codegen_ssa/mir/ ./src/rustc_codegen_ssa/common.test.ts ./src/rustc_codegen_llvm/skeleton.test.ts`: 86 pass, 0 fail
  (includes analyze, block, mir_rest, operand_place, rvalue_intrinsic and the new tests).
- Each new module loads alone (`bun -e "await import(...)"`).
- **`bun test ./src/rustc_codegen_ssa/mir/debuginfo.test.ts`: 5 pass, 0 fail, 167 expects, about 1 s.** It runs no rustc and reads no
  environment variable.
  - How it runs: the fixture is compiled in-process to `analysis` (with `--emit=llvm-ir`, as the oracle, because that is what turns
    `Session::fewer_names` off). For each `#[no_mangle]` fn the real `codegen_mir` runs, with every ported `impl FunctionCx` block and
    this lane's installed, over a Proxy mock backend. The `xlane`/`block_xlane`/`stmt_xlane` debuginfo entries forward to this lane's
    methods for the run. The mock follows cg_llvm where the IR depends on it:
    - `set_var_name`: arguments and instructions only, first name wins (builder.rs);
    - `store_fn_arg`: reads one parameter, two for `Pair` (abi.rs:299);
    - allocas are listed in reverse creation order (builder.rs:667, `position_at_start`);
    - `dbg_var_addr`'s `DIExpression` is built from the offsets (debuginfo/mod.rs:494).
  - Checked against the pinned nightly's IR, per fn (11 fns):
    1. **Names without `-g`** (`x86_64-unknown-linux-gnu`): every parameter name in the `define` line (`%self`, `%x`, `%p.0`/`%p.1`,
       `%self.0`, `%_1`, `%b` for an indirect argument, `%0` for an argument stored to an alloca) and every named alloca (`%x`, `%arr`,
       `%_2`).
    2. **With `-Cdebuginfo=2`, on gnu and on msvc**: the same, plus every `.dbg.spill` alloca in order, and every `#dbg_declare` record
       in order: the address operand's name, the variable's `name:`/`arg:` and the `DIExpression`. That covers:
       - `ArgumentVariable` vs `LocalVariable`, including msvc's `LocalVariable` for `ScalarPair` arguments (`t`, `o`, `s`, `d`);
       - unnamed arguments (`sym::empty`, `arg: N`);
       - the `params_seen` dedup;
       - the constant debuginfo path (`ConstDebugInfo`, ZST variables: `c`, `w`, `unit`, `cu`…);
       - copy-propagated locals that share the argument's spill (`locals`: `a`, `b`, `x` all point at `%x.dbg.spill`).
    3. **`compute_debuginfo_type_name`** of 30 user variables' types, each with the `qualified` flag cg_llvm's metadata.rs passes
       (`true` for pointers/references/`dyn`, `false` otherwise), equals a table read off the IR **and** is one of the IR's `name:` fields.
       That is checked for both the gnu and the msvc forms. Covered: generics, nested generics, `&`/`&mut`/`*const`/`*mut`, `dyn Tr`,
       `dyn Tr + Send`, `dyn WithAssoc<Out=u32>` (`assoc$<…>`), tuples and `()`, C-like and data enums (`enum2$<…>`), fn pointers incl.
       `unsafe extern "C"` (`bool (*)(u32)`, `void (*)()`), arrays (`array$<u8,4>`), slices, `str`, closures (`{closure_env#0}`,
       `closure_env$0`), `{impl#15}`/`impl$15`, const generics `4`, `-3` (i8 sign extension), `true`, and msvc's `> >` spacing.
  - **Mutation checks** (each reverted):

    | mutation | tests failing |
    |---|---|
    | drop msvc's ScalarPair → `LocalVariable` rule | 1 |
    | drop the `.0` suffix of pair names | 3 |
    | drop the `> >` space in `push_close_angle_bracket` | 1 |
    | drop `.dbg.spill` | 2 |
    | always hide arg 0 (`arg_index == 0 && has_proj()` → `true`) | 2 |
    | drop the auto-trait sort | **0** (the fixture has one auto trait; see "Not covered") |
- Sample difftests, `RUST_TS_AGENT=ssa-debuginfo`, `--sample 200 --jobs 6`, AC power:
  - `mono-ui`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261112-212551-ssa-debuginfo-2zd3`.
  - `mir-o2`: **200/200 MATCH**, run `20261112-212642-ssa-debuginfo-ffho`.
  - `mir`: **200/200 MATCH**, run `20261112-212729-ssa-debuginfo-ck0x`.

### Not covered by the tests
- `make_mir_scope`'s inlined arm and the `discriminators` logic: no inlining at `-O0`.
- `codegen_stmt_debuginfo(s)`, `debug_new_val_to_local`, `debug_poison_to_local`: MIR has no `StmtDebugInfo` at `-O0`.
- Projections in `calculate_debuginfo_offset`: closure bodies (env fields) are not `#[no_mangle]` fns, so the driver does not reach them.
  The same goes for composite fragments and msvc's `should_create_individual_allocas`.
- The naked-fn and SVE early returns of `debug_introduce_local`.
- In type_names:
  - `compute_debuginfo_vtable_name` (no vtable in the fixture's DI);
  - the `{CONST#hash}` fallback;
  - coroutines;
  - `Pat`/`UnsafeBinder`;
  - the auto-trait sort with more than one auto trait;
  - the 128-bit enum rule.

## Stub sites root must repoint (all forwarders to the installed methods)
1. `mir/mod.ts`:
   - call `install_FunctionCx_debuginfo(FunctionCx);` with the other installers (after `install_FunctionCx_retag`);
   - replace the three placeholders (`FunctionDebugContext<_S,_L>`, `PerLocalVarDebugInfo<_D>`, `ConstDebugInfo<_B>`, lines 102–108) with
     `export type { ConstDebugInfo, FunctionDebugContext, PerLocalVarDebugInfo } from "./debuginfo.ts";`. The type parameters match.
     After that, the casts in debuginfo.ts's `dctx`/`per_local` helpers and the `PerLocalVarDebugInfo_` aliases are harmless and can stay.
   - `xlane` entries:
     - `fill_function_debug_context` → `fx.fill_function_debug_context(bx)`;
     - `compute_per_local_var_debug_info` → `fx.compute_per_local_var_debug_info(bx)`;
     - `debug_introduce_locals` → `fx.debug_introduce_locals(bx, consts)`.
2. `mir/block.ts` `block_xlane` entries:
   - `set_debug_loc` → `fx.set_debug_loc(bx, source_info)`;
   - `debug_introduce_local` → `fx.debug_introduce_local(bx, local)`;
   - `codegen_stmt_debuginfos` → `fx.codegen_stmt_debuginfos(bx, debuginfos)`. block.ts already passes the slice.
3. `mir/statement.ts` stubs (fixers-55's file this wave):
   - `FunctionCx_set_debug_loc` → `fx.set_debug_loc(bx, source_info)`;
   - `FunctionCx_debug_introduce_local` → `fx.debug_introduce_local(bx, local)`;
   - **`FunctionCx_codegen_stmt_debuginfos` → `fx.codegen_stmt_debuginfos(bx, debuginfos.deref())`**. statement.ts passes
     `statement.debuginfos`, a `StmtDebugInfos`, which upstream derefs to `&[StmtDebugInfo]`. Passing it without `.deref()` throws
     `TypeError: {} is not iterable`; the test found this.
4. `lib.ts` (ssa-base's file): upstream `pub mod debuginfo;` → `export * as debuginfo from "./debuginfo/mod.ts";`. Nothing imports
   `debuginfo/mod.ts` yet.

**What stops next once repointed.** With names kept (`--emit=llvm-ir`), `debug_introduce_locals` calls the backend's `set_var_name`. That
is cg_llvm's `cg-di-a` stub (rustc_codegen_llvm/debuginfo/mod.ts:150, `unported("cg-di-a: … set_var_name")`). So an IR-emitting run that
stopped at `ssa-debuginfo: … fill_function_debug_context` will stop there instead. `set_var_name` (cg_llvm debuginfo/mod.rs) is needed
even without `-g`, so it should come before the rest of cg-di-a. With `-g`, `dbg_scope_fn` is the first stop.

## Every `unported(...)` left
None in this lane's files.

## `// PORT:` decisions
1. **`impl FunctionCx` as an installer.** It is `install_FunctionCx_debuginfo(FunctionCx)`, the convention of constant.ts, block.ts and
   others. This file imports mod.ts for types only.
2. **The placeholder types in mod.ts.** debuginfo.ts reads and writes `fx.debug_context` / `fx.per_local_var_debug_info` through two
   casting helpers (`dctx`, `per_local`) until root swaps the placeholders. Inside `declare module "./mod.ts"`, names resolve in mod.ts's
   scope first, so the augmentation uses local aliases (`PerLocalVarDebugInfo_`, `ConstDebugInfo_`, `DebugScope_`).
3. **`Range<Size>` is `readonly [Size, Size]`**, as traits/debuginfo.ts's `dbg_var_addr` takes it.
4. **`DebugInfoOffsetLocation`** is an interface of functions taking `self`. The two impls are a `PlaceRef` table (a function of `B`)
   and a `TyAndLayout` table. `calculate_debuginfo_offset` takes the table first (PORTING §5, trait dispatch by tables).
   - The trait's required methods carry markers on the interface members, as ssa-contract's traits do.
   - `indirect_offsets.last_mut().unwrap_or(&mut direct_offset)` writes the chosen slot.
   - The `ConstantIndex { from_end: true }` case falls through to the `_` arm, a helper `unsupported_projection`.
5. **`spill_operand_to_stack`** (an associated fn without `self`) is the exported free function `FunctionCx_spill_operand_to_stack`.
6. **Map keys.**
   - `params_seen: FxHashMap<(DIScope, usize), DIVariable>` is a map of maps (backend objects are unique per value), only looked up.
   - `inlined_function_scopes` is a `KeyedMap<Instance, S>(intern_key)`, as cg_llvm's `instances`.
   - `discriminators` is a `Map<BytePos, number>`.
7. **type_names.rs.**
   - `output: &mut String` is a `MutRef<string>`. Only ASCII separators are pushed, popped or truncated, so JS indices equal byte indices.
   - `FxHashSet<Ty>` is a `Set<Ty>`.
   - The nested `NON_CPP_AUTO_TRAIT_SEPARATOR` const is module-level, because of the TDZ: the nested fns run before the body would reach
     the const.
   - The nested fns `msvc_enum_fallback`, `push_auto_trait_separator` and `pop_auto_trait_separator` stay nested, with markers.
   - `sort_unstable` on `String`s compares code points (= UTF-8 byte order), not UTF-16 units.
   - `{hash:x}` of `Hash64` is `Hash64.as_u64(h).toString(16)`.
8. **`Integer::from_size(..).unwrap()`** (debuginfo/mod.rs) is `unwrap_result(.., debug_str)`; result.test.ts forbids the one-argument form.
