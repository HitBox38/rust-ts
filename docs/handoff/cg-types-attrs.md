# Handoff: cg-types-attrs (M7, plan-m7 wave 41, fill lane)

Branch `t3/port-cg-types-attrs` (from `620acf48`; no merges). Commits: see the end.

## Summary
- **Ported in full, in upstream order, with markers:** `type_.rs`, `type_of.rs`, `declare.rs`, `callee.rs`, `attributes.rs`,
  `mono_item.rs` and `base.rs` of `compiler/rustc_codegen_llvm/src/`. That is 126 of 126 fns, about 2,400 upstream lines and
  2,716 TS lines.
- **All 80 cg-types-attrs stubs** that cg-contract left are replaced by ports. The fns that upstream has and the skeleton
  lacked are added in their upstream places, on the same augmentations:
  - type_.rs: `eq`, `hash`, `type_scalable_vector`, `add_func`, `type_padding_filler`, `llvm_type_ptr`,
    `llvm_type_ptr_in_address_space`;
  - type_of.rs: `uncached_llvm_type`, `struct_llfields`, `size_and_align_of`, `spanned_size_and_align_of`,
    `scalar_llvm_type_at`, and the trait's four declarations;
  - declare.rs: `get_defined_value`;
  - attributes.rs: the 16 private and helper fns;
  - mono_item.rs: `predefine_without_aliases`, `add_static_aliases`, `add_function_aliases`, `set_visibility`,
    `should_assume_dso_local`;
  - base.rs: `ValueIter::next`, `iter_globals`, `iter_global_aliases`, `module_codegen`, `visibility_to_llvm`.
- **Still not registered.** Nothing outside `src/rustc_codegen_llvm/` imports the crate. Both samples are unchanged, at
  200/200.
- **The oracle-fact tests pass:**
  - `type_of.test.ts` checks 18 `llvm_type`s, 6 immediate types and 10 named struct bodies;
  - `attributes.test.ts` checks 8 fns under 5 flag sets.
  - I checked that the tests bite. When I made `struct_llfields` never set `packed`, `type_of.test.ts` failed. I then reverted
    the change.

## Files touched
| file | what |
|---|---|
| `src/rustc_codegen_llvm/type_.ts`, `type_of.ts`, `declare.ts`, `callee.ts`, `attributes.ts`, `mono_item.ts`, `base.ts` | the port (my files) |
| `src/rustc_codegen_llvm/type_of.test.ts`, `attributes.test.ts` | new: oracle-fact tests |
| `src/rustc_codegen_llvm/cg_types_attrs_test/{types.rs, attrs.rs, run.ts, both.ts}` | new: fixtures, the port-side runner, and the oracle/port helper |
| `src/rustc_codegen_llvm/skeleton.test.ts` | cg-contract's file, edited as its handoff tells fill lanes to ("update its `stops(...)` line, the sketch's expectation and the lane's count"). Changed: the two cg-types-attrs `stops` lines, the Builder-forwarder check (now `bx.type_isize()`), the counts table, and the fill-lane sketch, which now runs over a real IR-model `SCx` and expects the ported results. **Merge note for root:** cg-context and cg-builder will edit the same table and sketch lines. |

## Coverage (`bun scripts/coverage.ts --missing compiler/rustc_codegen_llvm/src/<file>`)
| upstream file | ported |
|---|---|
| type_.rs | 60/60 |
| type_of.rs | 14/14 (the four `LayoutLlvmExt` declarations are markers on the `LayoutLlvmExt` interface's members) |
| declare.rs | 10/10 |
| callee.rs | 1/1 |
| attributes.rs | 24/24 |
| mono_item.rs | 8/8 |
| base.rs | 9/9 |

The marker check, `bun scripts/coverage.ts --check --offline`, reports `markers ok (26043, ...)`. `--order` reports no
`rustc_codegen_llvm` rows.

## Evidence
- `bunx tsc --noEmit -p .` is clean.
- `bun test ./src/rustc_codegen_llvm/ ./src/std/result.test.ts`: **47 pass, 0 fail.** It covers the crate's 6 test files
  plus result.test.ts.
- **`type_of.test.ts`** compiles `cg_types_attrs_test/types.rs` with the oracle for `x86_64-unknown-linux-gnu`
  (`--emit=llvm-ir -Copt-level=0`). It also runs our driver up to expansion, which builds a `CodegenCx` over an IR-model
  module and prints the types through the model (`debug_Type` = `LLVMRustWriteTypeToString`, `printModule`). It compares:
  - **`llvm_type`:** the `getelementptr` element type of `g_<Name>` (`x.add(i)` on a `*const Name`), for 18 shapes. All 18
    match:
    - a reordered struct `%Foo = type { i32, i16, i8, [1 x i8] }`;
    - `repr(C)` padding `%C3 = type { i8, [7 x i8], i64, i8, [7 x i8] }`;
    - packed `%P = type <{ i8, i32 }>`;
    - a union `%U = type { [2 x i32] }`;
    - a multi-variant enum `%E = type { i32, [3 x i32] }`;
    - a single-variant enum `%"One::Only"`;
    - a nested struct with a ZST, reordered, `%Nested = type { %E, %Pair, %Foo, %Zst }`, and `%Zst = type {}`;
    - fat pointers inside a struct, `%Wide = type { { ptr, i64 }, { ptr, i64 } }`;
    - `repr(transparent)` → `i64`;
    - a tuple `{ i16, i8, [5 x i8], i64 }` and an array `[3 x i32]`;
    - `&[u8]` → `{ ptr, i64 }`, `bool` → `i8`, `&u8` → `ptr`, `f32` → `float`, `u128` → `i128`;
    - `*const dyn Any` → `{ ptr, ptr }`.
    - The `&'static` fields go through the `erase_and_anonymize_regions` path.
  - **`immediate_llvm_type`:** the return type of `i_<Name>`, for 6 shapes. All match: `{ i32, i1 }`, `i64`, `{ ptr, i64 }`,
    `i1`, `ptr`, `{ ptr, ptr }`.
  - **Named struct definitions:** the 10 `%Name = type ...` lines are identical, as sets.
- **`attributes.test.ts`** uses `cg_types_attrs_test/attrs.rs`: 8 fns with `#[inline]`, `#[inline(never)]`,
  `#[inline(always)]`, `#[optimize(size)]`, `#[optimize(none)]`, `#[optimize(speed)]`, `#[cold]` and no attribute.
  - It runs 5 flag sets: `-Copt-level=0`; `-Zinline-llvm=no`; `-Cforce-frame-pointers=yes`;
    `-Copt-level=s -Cno-prepopulate-passes`; `-Copt-level=z -Cno-prepopulate-passes`.
  - The port applies what `llfn_attrs_from_instance` computes before its first stop: the `optimize` arms,
    `default_optimisation_attrs` and `inline_attr`. It adds `frame_pointer_type_attr`, then `apply_to_llfn`.
  - The oracle's attribute group, less `nonlazybind`, `uwtable`, `cold`, `"probe-stack"` and `"target-cpu"` (added only by
    the code past the stops below), equals ours in all 40 cases.
  - One divergence of the IR model (below) makes it compare as sets.
- **Sample difftests** (`RUST_TS_AGENT=cg-types-attrs`, `--sample 200 --jobs 6`, AC power, load about 20):
  - `mono-ui`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261112-053635-cg-types-attrs-vavr`.
  - `mir-o2`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261112-053729-cg-types-attrs-bz9d`.
- **C API call sequence against `record.ts`: not done.** Every path that would produce a comparable sequence stops first:
  - `declare_raw_fn` stops on `Session::needs_plt`;
  - `declare_fn` stops on cg-abi-consts' `FnAbi` stubs;
  - `compile_codegen_unit` stops on `CodegenUnit::codegen_dep_node`.
  - The attribute sets, which the recorder sees as `?attrs`, are checked against the oracle's printed IR instead.

## Stops this lane's code reaches

### Cross-lane typed stubs I call as is (owner: callers)
- **cg-context:**
  - `sess` (type_of, declare, base);
  - `tcx_` / `typing_env_` (callee, mono_item);
  - `data_layout` (through `Integer::approximate_align` in `type_padding_filler`);
  - `handle_layout_err`;
  - `val_ty` (common.rs);
  - `get_dllimport`;
  - `const_usize` / `const_u32`;
  - `create_metadata`, `global_add_metadata_node`, `global_set_metadata_node`;
  - `get_type_of_global`;
  - `CodegenCx::new`;
  - `objc_abi_version`, `add_objc_module_flags`, the three `add_ptrauth_*` fns;
  - `create_used_variable_impl`.
  - `type_of.test.ts` gives `sess`, `tcx`, `typing_env`, `data_layout` and `handle_layout_err` their one-line bodies on the
    test's instance (marked `SHIM` in run.ts) until cg-context ports them.
- **cg-abi-consts:**
  - `FnAbiLlvmExt::{llvm_type, ptr_to_llvm_type, llvm_cconv, apply_attrs_llfn}`;
  - `LlvmType::llvm_type` for `Reg` / `CastTarget`;
  - `define_objc_module_info`.
- **cg-builder:** `GenericBuilder::{append_block_inherent, build_inherent, ret_void_inherent, ret_inherent}`, and
  `BuilderMethods::call` (in `add_function_aliases`).
- **cg-write:** `llvm_util::{target_cpu, tune_cpu, to_llvm_features, get_version}`, and `LLVMFeature::into_iter`.
- **cg-di:** `debuginfo_finalize`.
- **excluded (D18):** `OffloadGlobals::declare`, `coverageinfo_finalize`.

### Callees of other lanes with no stub yet (I stop at the call site, naming the owner)
- `ssa-mir-core: compiler/rustc_codegen_ssa/src/mono_item.rs predefine` / `define`, for `MonoItemExt` (base.ts
  `MonoItemExt_predefine` / `MonoItemExt_define`).
- `ssa-base: compiler/rustc_codegen_ssa/src/base.rs maybe_create_entry_wrapper`.
- `ssa-base: compiler/rustc_codegen_ssa/src/lib.rs ModuleCodegen::new_regular`. ssa-contract "left" it.
- **Root:** when those lanes port them, replace the four local fns in base.ts with the real calls.

### rustc_session fns that session.ts lacks (`SESSION_STOPS` in attributes.ts)
- `Session::needs_plt` (session.rs:863), reached on **every** `declare_raw_fn`.
- `Session::must_emit_unwind_tables` (:1144), reached on every `llfn_attrs_from_instance`.
- `Session::branch_protection` (:1125), reached for every non-naked fn.
- `Session::direct_access_external_data` (:1092), reached in `should_assume_dso_local` only past the exe, Darwin, PIE and
  TLS early returns.
- `PointerAuthConfig::calculate_pauth_abi_version` (:186) and `PointerAuthConfig::fn_attrs` (:301). These are unreachable
  today, because the port's `pointer_auth_config` is always `None`.
- **For root:** port these into `src/rustc_session/session.ts`, as `Session::fewer_names` was (an exception to PORTING §1).
  Then replace the `SESSION_STOPS.x(sess)` call sites with `sess.x()` and delete `SESSION_STOPS`. They block wave 41's
  "IR for hello" target.

### rustc_middle
- **`CodegenUnit::codegen_dep_node` (mono.ts:753) returns `never`.** It stops with
  `rustc_middle::dep_graph::dep_node::make_compile_codegen_unit (incremental)`.
  - `compile_codegen_unit`'s first step calls it, so the function always stops there today.
  - Under D3 the graph is disabled, and `DepGraph::with_task` takes `dep_node: undefined` and never reads it.
  - **For root:** this needs a rustc_middle decision. One option is for `codegen_dep_node` to return `undefined` under D3, as
    `with_feed_task` does.
- **`CodegenFnAttrs::foreign_item_symbol_aliases`** is typed with codegen_fn_attrs.ts's own `Visibility`. That type has a
  fourth variant, `Interposable`, which `rustc_middle::mono::Visibility` does not have at the pin. mono_item.ts reads the
  field as mono.ts's type, through one cast in `foreign_item_symbol_aliases(attrs)`.
  - **For root / rustc_middle's owner:** use mono.ts's `Visibility` in codegen_fn_attrs.ts.

### Out of scope (rustc_sanitizers)
- `declare_fn`'s `-Zsanitizer=cfi` branches stop with `rustc_sanitizers::cfi::typeid_for_instance` and
  `rustc_sanitizers::cfi::typeid_for_fnabi`.
- Its `kcfi` branch stops with `rustc_sanitizers::kcfi::TypeIdOptions`.
- `sanitize_attrs` stops with `rustc_sanitizers::ignorelist::SanitizerIgnoreList::filter_instance_sanitizers`. This is
  unreachable: a `SanitizerIgnoreList` is never constructed.

### IR-model stops (`llvm::*` → `llir: ...`), left as is
- `LLVMRustCreateMemoryEffectsAttr`, through `MemoryEffects_impl.create_attr`, for `#[ffi_pure]` / `#[ffi_const]`.
- `LLVMRustSetNoSanitizeAddress` and `LLVMRustSetNoSanitizeHWAddress` (`set_variable_sanitizer_attrs`, under
  `#[sanitize(address = "off")]`).
- `LLVMRustHasFnAttribute` and `LLVMRustRemoveFnAttribute`, through `llvm::HasStringAttribute` / `RemoveStringAttrFromFn`
  (`has_string_attr`, `remove_string_attr_from_llfn`). This is cg-contract's known gap.
- Every other FFI fn these files call is implemented in the model: I checked each `llvm.LLVM*` call and each `llvm/mod.ts`
  helper I use against `ffi.ts`'s stub list.

### Every `unported(...)` in my files
- attributes.ts:
  - `rustc_session: compiler/rustc_session/src/session.rs Session::needs_plt`;
  - `... Session::direct_access_external_data`;
  - `... Session::branch_protection`;
  - `... Session::must_emit_unwind_tables`;
  - `... PointerAuthConfig::calculate_pauth_abi_version`;
  - `... PointerAuthConfig::fn_attrs`;
  - `rustc_sanitizers::ignorelist::SanitizerIgnoreList::filter_instance_sanitizers (rustc_sanitizers out of scope)`.
- declare.ts: the three `rustc_sanitizers::{cfi,kcfi}` stops above.
- type_.ts: `rustc_codegen_llvm::type_::<Type as Hash>::hash (pointer address)`. This mirrors value.ts's `Hash for Value`;
  nothing calls it.
- base.ts:
  - `rustc_codegen_llvm::base: HashStable for ModuleCodegen<ModuleLlvm> (dep_graph::hash_result; D3)`. The disabled graph
    never calls it;
  - the four ssa-* stops above.
- Stub counts in skeleton.test.ts:
  - `cg-types-attrs` goes from 80 to 0;
  - new keys: `rustc_session` 6, `rustc_sanitizers` 3, `ssa-mir-core` 2;
  - `ssa-base` goes from 1 to 3;
  - `rustc_codegen_llvm` goes from 3 to 5.

## For the llir lanes
- **Attribute order.** The IR model prints a function's attributes in insertion order. LLVM's `AttributeSet` sorts them
  (enum attributes by kind, then int, type and string attributes).
  - Example: rustc adds `minsize optsize noinline`. The oracle prints `minsize noinline ... optsize`, and the model prints
    `minsize optsize noinline`.
  - Every function whose attributes rustc adds out of LLVM's order will diff once the backend runs.
  - `attributes.test.ts` compares as sets for that reason. It should compare in order once the model sorts.

## `// PORT:` decisions (for root to record)
1. **`SESSION_STOPS`** (attributes.ts): typed stops for the six rustc_session fns that session.ts lacks (above).
2. **`LayoutLlvmExt`'s declarations** (type_of.rs:211-214) carry their markers on a TS `interface LayoutLlvmExt`.
   `TyAndLayout` gets it by augmentation: `interface TyAndLayout<Ty> extends LayoutLlvmExt {}`. The methods are prototype
   assignments, cg-contract's C2 form.
3. **Private upstream methods** of `impl CodegenCx` / `impl GenericCx` are members of the class augmentations, as cg-contract
   did for the public ones. Examples: `predefine_without_aliases`, `set_visibility`, `should_assume_dso_local`,
   `get_defined_value`.
4. **Missing callee stubs** of ssa-mir-core and ssa-base are local fns in base.ts that stop with the owner's message (above).
5. **`Hash for Type`** is `unported`. It is a pointer address, as in value.ts, and maps key on the object.
6. **Field-name deref:**
   - `cx.llcx` / `cx.llmod` / `(**self).borrow().llmod` are the accessors `llcx()` / `llmod()` (type_.rs:152-158), as
     cg-contract decided.
   - `cx.tcx()` / `cx.typing_env()` are `tcx_()` / `typing_env_()`.
   - A `&SimpleCx` parameter given a `CodegenCx` is passed `cx.scx`.
7. **F1 inherents** in mono_item.rs: `Builder::append_block` / `Builder::build` / `ret_void` / `ret` on a concrete `Builder`
   are the `_inherent` names. `call` stays the trait method, since `Builder` has no inherent `call`.
8. **`instances.borrow_mut().insert(..)`'s return value** (`add_static_aliases`) is `KeyedMap.replace`.
9. **`Instant::elapsed()`** is `Instant::now().duration_since(start)`, because src/std/time.ts has no `elapsed`. The cost is
   `as_nanos() as u64` as a `number`.
10. **`generic_activity_with_arg_recorder`** is `generic_activity(name)`, with the recorder closure as a comment. This is
    rustc_expand/proc_macro.ts's precedent; the closure runs only under `-Z self-profile`, which stops anyway.
11. **`Some(dep_graph::hash_result)`** is a function that stops, because `HashStable for ModuleCodegen` is not ported. The
    disabled graph (D3) never calls it.
12. **`CString::new(symbol_name.name).unwrap()`** passes the name as is, because a mangled symbol name has no NUL.
    **`SmallCStr::new(..)`** is the string. **`c"llvm.used"`** is `"llvm.used"`.
13. **Bitflags on the `SanitizerSet` stand-in:**
    - `sanitizers() - disabled` is `enabled & ~disabled`;
    - `intersects` is `(a & b) !== 0`;
    - the stand-in has neither operation.
14. **`(u32, u32, u32) < (u32, u32, u32)`** (`probestack_attr`) is the local `version_lt`, the derived lexicographic
    `PartialOrd`.
15. **`tracing::debug!` lines** are comments.
16. **`Vec::with_capacity(n)` + `LLVMGetParamTypes` / `LLVMGetStructElementTypes` + `set_len(n)`** is an empty array the
    model fills, then `length = n`.

## Commits
- `2fcd3381` cg-types-attrs: the port, the tests, and skeleton.test.ts.
- The commit of this handoff.
