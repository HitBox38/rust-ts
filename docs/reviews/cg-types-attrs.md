PASS WITH NOTES

# Review: lane `cg-types-attrs` (M7 wave 41)

- **Reviewed:** `git diff 620acf48..f59a9c9a` on `t3/port-cg-types-attrs`: commits `2fcd3381` (the port, the tests and
  `skeleton.test.ts`) and `f59a9c9a` (the handoff).
- **Reviewer:** independent, read-only on code. Upstream was read at the pin under `$RUST_TS_DATA/rust`, in
  `compiler/rustc_codegen_llvm/src/{type_,type_of,declare,callee,attributes,mono_item,base}.rs`.
- **Result:** The port is faithful. I read all 126 fns in full against upstream and found no logic divergence, no guessed
  value and no wrong stop owner. The tests compare against live oracle output, and I regenerated it independently. The scope
  is clean. There are no must-fix findings. The six nits below concern test strength, the accuracy of the handoff and
  comments, and one pre-existing type mismatch outside the lane, which the lane's cast correctly works around.

## Evidence (run on the merge of `f59a9c9a`: AC power, `RUSTC_ICE=0`, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`)
- `bunx tsc --noEmit -p .`: clean (exit 0).
- `bun scripts/coverage.ts --check --offline`: `markers ok (26043, 43 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 744; llvm 354)`.
- `bun test ./src/rustc_codegen_llvm/ ./src/std/result.test.ts`: **47 pass, 0 fail**.
- `bun scripts/coverage.ts --missing compiler/rustc_codegen_llvm/src/<f>.rs` gives:
  - `type_`: 60/60;
  - `type_of`: 14/14;
  - `declare`: 10/10;
  - `callee`: 1/1;
  - `attributes`: 24/24;
  - `mono_item`: 8/8;
  - `base`: 9/9.
- No samples were run (the brief asked for none, because disk is tight).

## 1. Order and coverage
- Every marker I checked names the correct upstream line, and the fns appear in upstream order.
  - This includes the reordering of `LayoutTypeCodegenMethods`: the skeleton had `immediate_backend_type` and
    `scalar_pair_element_backend_type` last, and they now sit at type_.rs:304 and :307.
  - The fns the skeleton lacked are added in their upstream places: `eq`/`hash` (:22/:30), `type_scalable_vector` (:71),
    `add_func` (:75), `type_padding_filler` (:142) and `llvm_type_ptr*` (:289/:293).
- The hoisted `module_codegen` carries the marker base.rs:83, which is the nested fn's line. This is acceptable.
- The four `LayoutLlvmExt` declaration markers on the TS interface (type_of.rs:211-214) follow cg-contract's C2 form.

## 2. Logic fidelity (all 126 fns read)
- **type_of.rs**
  - **`uncached_llvm_type` (:15):**
    - The SIMD and scalable arms are correct, including the bool → `i1` element and the 1–8 tuple cases.
    - Names are used only for `Adt`, `Closure`, `CoroutineClosure`, `Foreign`, `Coroutine` and `Str`, and only when
      `!fewer_names()`. The name is `display_Ty` under `with_no_visible_paths(with_no_trimmed_paths(..))`.
    - The `::Variant` suffix is added only for an enum `Adt` with `Variants::Single`, and the coroutine `variant_name` suffix
      is added the same way.
    - `Primitive` and `Union` become a filler body with `packed = false`. `Array` becomes `type_array(field0, count)`.
    - `Arbitrary` becomes `struct_llfields` when unnamed, or a named struct with the body deferred.
    - Upstream has no special handling for `{{closure}}` or `<...>`: the pretty printer produces those names. I checked the
      `<...>` path with an extra oracle run (§4).
  - **`struct_llfields` (:132):**
    - `effective_field_align = min(layout.align, field.align).restrict_for_offset(target_offset)`.
    - `packed |= effective < field.align` (the comparison is on `pow2`, matching the derived `Ord`).
    - Padding before a field uses `min(prev_effective_align, effective_field_align)`. Trailing padding uses
      `prev_effective_align`, and only when the type is sized and `field_count > 0`. Both `assert_eq`s and the `bug!` are
      kept.
    - There is no `field_remapping` at this pin: upstream returns `(Vec<&Type>, bool)`, and so does the port.
  - **`llvm_type` (:234):**
    - The scalar cache is keyed on `ty`.
    - The `type_lowering` cache is keyed on `(ty, Option<VariantIdx>)`.
    - The escaping-bound-vars assert is kept.
    - It recurses through `erase_and_anonymize_regions` and applies `for_variant`.
    - The cache is inserted before the deferred `set_struct_body`, as upstream does. This order matters for recursive types,
      and it is kept.
  - **`immediate_llvm_type` (:287):** a bool scalar is `i1`, and a ScalarPair becomes an unpadded `{a, b}` with `immediate`
    set.
  - **`scalar_llvm_type_at` (:310):** `Pointer(as)` goes through `type_ptr_ext(as)` to `LLVMPointerTypeInContext(llcx, as)`,
    so the address space is passed through.
  - **`scalar_pair_element_llvm_type` (:318):** an immediate bool element is `i1`.
- **type_.rs (60 fns):** each body is the FFI call upstream makes, with `count as c_uint` → `>>> 0`.
  - `type_padding_filler` is `Integer::approximate_align` with an exact division.
  - `type_kind`, `element_type` and `float_width` keep their match arms and `bug!` texts.
  - The `TypeMembershipCodegenMethods` bodies build the same metadata arrays.
- **attributes.rs**
  - **`llfn_attrs_from_instance` (:490), in upstream order:**
    1. the `optimize` arms;
    2. `inline_attr`, only when there is an instance;
    3. `uwtable`, when `must_emit_unwind_tables`;
    4. `use-sample-profile`;
    5. frame-pointer, function-return, instrument-function, no-jump-tables, probe-stack and stack-protector;
    6. `no-builtins`, `offload-kernel`, `cold`, `ffi_pure` / `ffi_const`;
    7. for naked fns, nothing. For non-naked fns, the sanitizers and then branch protection (`bti`, `gcs`, `pac_ret` with
       `pauth-lr`, `sign-return-address` and `-key`, after the AArch64 assert);
    8. the allocator, zeroed, reallocator and deallocator blocks, with their argument and return places and alloc-kind flags;
    9. `align` through `set_alignment`;
    10. `packed-stack`, then patchable-function-entry;
    11. `target-cpu`, `tune-cpu`;
    12. the function features: `+feat` from `to_llvm_features`, then the thumb-mode features;
    13. the wasm import attributes, then the ptrauth attributes;
    14. `target-features`, then `apply_to_llfn(Function)`.
  - **`inline_attr` (:51):** `DoNotOptimize` forces `Never`. `None` with `requires_inline` becomes `Hint`, and the guard is
    evaluated only on the `None` arm. `Never` gives `noinline`, except on AmdGpu.
  - **`probestack_attr` (:355):** it returns early on `ADDRESS | THREAD` (`intersects`) and on `profile_generate.enabled()`.
    `InlineOrCall` uses a lexicographic tuple `<` (`version_lt`, correct).
  - **Other helpers:** `sanitize_attrs` (`enabled & ~disabled` is the bitflags `Sub`; MTE uses `rfind`; the realtime check
    reads the *session* set, as upstream does), `frame_pointer` (two ratchets), `instrument_function_attr`, `xray`
    (threshold default 200), `packed_stack_attr` and `default_optimisation_attrs` all match upstream.
  - **`find_attr!(tcx, id, ..)`:** this is `find_attr(HasAttrs_DefId.get_attrs(id, tcx), ..)`, which matches the macro
    (rustc_attr_ir lib.rs:113) and the existing trait-selection precedent.
  - **`target_cpu_attr`:** it passes `sess.early_sess`, because `llvm_util::target_cpu` takes `&EarlySession`
    (llvm_util.rs:657). This is correct.
- **declare.rs**
  - **`declare_simple_fn` (:36):** `LLVMGetOrInsertFunction` with the UTF-8 length, then the call convention, `unnamed_addr`
    and visibility.
  - **`declare_raw_fn` (:58):**
    - `convergent` on GPU targets;
    - `noredzone` from `no_redzone ?? disable_redzone` (an explicit `false` is kept);
    - `nonlazybind` through `non_lazy_bind_attr`, that is `!needs_plt`.
  - **`declare_fn` (:165):** uses `llvm_cconv`, `UnnamedAddr::Global`, `Visibility::Default`, `llvm_type`, then
    `apply_attrs_llfn`. The CFI and KCFI branches stop only when those sanitizers are enabled.
  - **`declare_entry_fn`** uses `from_generic(default_visibility())`. **`get_defined_value`** keeps only a value that is not
    a declaration.
- **callee.rs `get_fn` (:19)**
  - The two asserts and the instance cache are kept.
  - `get_dllimport` is evaluated only on X86, as upstream's let-chain does. There, the i686 decorated name is used and the
    dllimport storage class is set.
  - `ExternalLinkage` is set.
  - `is_generic` is `non_erasable_generics().next().is_some()`.
  - The hidden decision:
    - when not sharing generics and the instance is not `#[inline(never)]`, the result is `true`;
    - for a local def, it is `unreachable_local_definition || !local_crate_exports_generics`;
    - for an upstream def, it is `upstream_monomorphization.is_none() && !exports_generics`;
    - for a non-generic fn, it is `is_codegened_item && (!local || !reachable_non_generic)`.
  - The MinGW dllimport check excludes `Gnu` and `Uclibc`. `assume_dso_local(llfn, true)` and the cache insert follow.
- **mono_item.rs**
  - **`predefine_static` (:27):** `Static { nested }` gives a unit type or `instance.ty`. It then calls `define_global`, or
    `emit_fatal(SymbolAlreadyDefined)` if that fails. Linkage, visibility, `assume_dso_local(g, false)`, the static aliases
    and the cache insert follow.
  - **`predefine_fn` and `predefine_without_aliases`:** a unique comdat is set only for `LinkOnceODR`/`WeakODR` when
    `supports_comdat`.
  - **`add_function_aliases`:** the sret split uses `ReturnSlot::Indirect`, and the `ret_void`/`ret` arms follow the
    `PassMode`.
  - **`set_visibility`:** compiler-builtins gets `Hidden` unless the linkage is `Internal`.
  - **`should_assume_dso_local` (:253), checks in upstream order:**
    1. `Internal`/`Private` linkage → `true`;
    2. a non-default visibility that is not `ExternalWeak` → `true`;
    3. an all-exe crate where the item is not a declaration for the linker → `true`;
    4. PowerPC64 → `false`;
    5. Darwin → `false`;
    6. PIE and not a declaration → `true`;
    7. a TLS global → `false`;
    8. `direct_access_external_data`;
    9. otherwise, `Static`.
- **base.rs**
  - **`compile_codegen_unit` (:63) and `module_codegen` (:83):**
    - offload globals are set only for the host and not on GPU targets;
    - predefine, then define, over `items_in_deterministic_order`;
    - the entry wrapper gets `sanitize_attrs(default)` plus the ptrauth attributes;
    - the objc module info is defined only when `objc_abi_version() == 1`, and the module flags are added whenever there
      are objc refs;
    - then the ptrauth flags, coverage, `llvm.used`, `llvm.compiler.used`, the RAUW-and-delete loop, and debuginfo when
      `debuginfo != None`.
  - **`set_link_section`, `linkage_to_llvm` (all 8 arms), `visibility_to_llvm` (3 arms) and
    `set_variable_sanitizer_attrs`** (`ADDRESS|KERNELADDRESS` and `HWADDRESS|KERNELHWADDRESS`) all match upstream.

## 3. No guessed values
- **`SESSION_STOPS`** (attributes.ts:43): all six stop with `unported("rustc_session: compiler/rustc_session/src/session.rs ...")`.
  - The lines are right: `needs_plt` :863, `direct_access_external_data` :1092, `branch_protection` :1125,
    `must_emit_unwind_tables` :1144, `calculate_pauth_abi_version` :186 and `fn_attrs` :301.
  - I confirmed that `src/rustc_session/session.ts` lacks all six. Its header notes that `calculate_pauth_abi_version` is
    unported.
- **The call-site stops in base.ts name the right owners:**
  - `MonoItemExt::{define, predefine}` is in rustc_codegen_ssa/src/mono_item.rs, which is the "MIR core" group in plan-m7
    §2: **ssa-mir-core**.
  - `maybe_create_entry_wrapper` is at rustc_codegen_ssa/src/base.rs:501, and `ModuleCodegen::new_regular` at lib.rs:73.
    Both are in the "Crate driver" group (`base.rs`, `lib.rs`): **ssa-base**.
- **The `Visibility` cast in mono_item.ts:45 is safe, and it restores upstream's type.**
  - Upstream's field is `Vec<(DefId, Linkage, mono::Visibility)>` (codegen_fn_attrs.rs:12, :89), and `mono::Visibility` has
    three variants (mono.rs:385).
  - The mismatch is in the existing `src/rustc_middle/middle/codegen_fn_attrs.ts:73`. That file declares its own
    `Visibility` with an extra `Interposable` variant, and its decoder accepts tag 3 (`expected 0..4`, :77-89). Both are
    absent upstream. See N4.
- **`rustc_sanitizers` stops:** declare.ts has three, and attributes.ts has one, which is unreachable. They are out of scope
  per `harness/scope.json`. `Hash for Type` stops (`unported`). `HashStable for ModuleCodegen` stops under D3. Both PORT
  decisions are documented.

## 4. Tests
- **The expectations are genuine.** Neither test hard-codes IR: `both.ts` runs the pinned rustc
  (`+nightly`, `nightly-2026-10-11`, `--target x86_64-unknown-linux-gnu --emit=llvm-ir`) on every run, and it compares
  that output against the port's printout. Only the counts (18, 6, 10, 8) are fixed.
- **I regenerated the outputs by hand:**
  - `types.rs -Copt-level=0` gives exactly the 10 `%Name` definitions the handoff lists, the 18 GEP element types and the 6
    return types. Examples: `%Foo = type { i32, i16, i8, [1 x i8] }`, `%P = type <{ i8, i32 }>`, `%"One::Only"`, and
    `{ i32, i1 } @i_Pair`.
  - `attrs.rs -Copt-level=z -Cno-prepopulate-passes` gives
    `#4 = { noinline nonlazybind optnone uwtable "probe-stack"=.. "target-cpu"=.. }` for `a_none`, and `minsize .. optsize`
    elsewhere.
  - Running the port's `run.ts attrs` on the same flags gives the same sets once `NOT_YET` is removed.
- **Extra check, beyond the fixture:** a `Probe` of `core::ops::Range<u64>`, `Result<u32, u8>`, `Option<(u8, u32)>`,
  `Cell<(u16, u8, u32)>`, `ManuallyDrop<(u8, u64)>`, `(bool, bool)` and `[bool; 2]`.
  - The port's `llvm_type` matches the oracle's GEP types in all 5 named cases, for example
    `%"core::ops::range::Range<u64>"` and `%"core::mem::manually_drop::ManuallyDrop<(u8, u64)>"`. This confirms the
    no-trimmed and no-visible path naming on generic ADTs.
  - The port's `immediate_llvm_type` for `(bool, bool)` is `{ i1, i1 }`, which matches `@i5`.
- **The `SHIM` is confined to the test instance.** run.ts:58-66 assigns the five members on the `cx` object, not on the
  prototype, in a test-only file. Upstream's bodies:
  - `sess`, `tcx`, `typing_env` and `data_layout` match context.rs:1042, :1270, :1276 and :1256.
  - `handle_layout_err` does not match: see N2.
- **The set comparison hides only ordering.** Sorting keeps duplicates, so a duplicated attribute would still fail. LLVM
  stores an `AttributeSet` sorted (enum, then int, type and string attributes), while the model prints insertion order: an
  IR-model gap, correctly handed to the llir lanes. The named-struct definitions are compared as sorted lines as well.
  Their order in LLVM's output comes from the printer's TypeFinder walk, which is the IR model's concern, not this lane's.
- **`NOT_YET`** filters `nonlazybind`, `uwtable`, `cold`, `"probe-stack"` and `"target-cpu"`, which are exactly the
  attributes added past the stops. It hides nothing that the port computes.

## 5. Scope
- The diff touches the seven lane files, the two new tests, the `cg_types_attrs_test/` fixtures and helpers,
  `skeleton.test.ts` and the handoff.
- It changes no file of cg-context (`context.ts`, `common.ts`) or cg-builder (`builder.ts`), and no IR-model file
  (`llvm/mod.ts`, `src/rust_ts/llvm/*`).
- **`skeleton.test.ts` changes only what cg-contract's handoff allows:**
  - the two `cg-types-attrs` `stops` lines;
  - the Builder-forwarder check;
  - the counts table: `cg-types-attrs` 80 → 0, plus the new keys `rustc_session` 6, `rustc_sanitizers` 3 and
    `ssa-mir-core` 2, and the changes `ssa-base` 1 → 3 and `rustc_codegen_llvm` 3 → 5, all checked against the
    `unported(` sites;
  - the fill-lane sketch.

## Findings

No F (must-fix) findings.

**N1. The attribute test copies the port's `optimize` switch rather than calling it, and the handoff overstates what it
covers.**
- run.ts:105-119 has its own copy of `llfn_attrs_from_instance`'s `match codegen_fn_attrs.optimize` (attributes.rs:501-514).
  The port's copy is attributes.ts:583-595, and the test never runs it.
- So the test covers `default_optimisation_attrs`, `inline_attr` and `frame_pointer_type_attr`, but not the port's switch.
  A broken arm in attributes.ts:583 would still pass.
- The handoff says "The port applies what `llfn_attrs_from_instance` computes" (docs/handoff/cg-types-attrs.md:79).
- **Suggestion:** say "the test mirrors the arms", or call `llfn_attrs_from_instance` once `must_emit_unwind_tables` is
  ported. That needs root's `SESSION_STOPS` port anyway.

**N2. The `handle_layout_err` shim is not upstream's body.**
- run.ts:63 throws a plain `Error`. Upstream (context.rs:1283) does `span_fatal` for
  `SizeOverflow`/`ReferencesError`/`InvalidSimd` and `emit_fatal(FailedToGetLayout)` otherwise.
- run.ts:13 and handoff :109 call all five shims "upstream one-line bodies".
- This is harmless, because the fixtures never hit a layout error. **Suggestion:** describe it as a test-only throw, or make
  it `unported(..)`.

**N3. A wrong upstream line in the base.ts doc comments.**
- base.ts:216 and :221 cite "`MonoItemExt` (rustc_codegen_ssa mono_item.rs:20)".
- The trait is at mono_item.rs:11, with `define` at :12 and `predefine` at :18. The impl's `define` is at :29 and its
  `predefine` at :57.

**N4. An out-of-lane type mismatch that the cast in mono_item.ts:45 correctly works around (for root, or for rustc_middle's
owner).**
- `src/rustc_middle/middle/codegen_fn_attrs.ts:73` declares a four-variant `Visibility` with `Interposable`. Its
  `decode_Visibility` (:77-89) accepts tag 3, and its message says "expected 0..4".
- Upstream uses `mono::Visibility`, with three variants (mono.rs:385; codegen_fn_attrs.rs:12).
- The cast is safe today: valid metadata never carries tag 3. But if an `Interposable` value ever reached
  `visibility_to_llvm` (base.ts:270), the switch would return `undefined` silently.
- **Suggestion:** have codegen_fn_attrs.ts import mono.ts's `Visibility`, and decode with `expected 0..3`, as the handoff
  proposes. Then drop the cast.

**N5. The sketch's `expect.any(TypeError)` is brittle.**
- skeleton.test.ts:239 expects a JS `TypeError` from `llvm_type` on a field-less `Object.create` layout. Any change in what
  first dereferences `undefined` would change or remove that error without meaning anything.
- **Suggestion:** a `toThrow()` check, or drop the step and point to `type_of.test.ts`.

**N6. A stale count in the handoff document.**
- The test at skeleton.test.ts:135 is titled "matches the table in docs/handoff/cg-contract.md", but it reads only its
  in-file table.
- docs/handoff/cg-contract.md:227 still says **cg-types-attrs 80**, and it lacks the new keys.
- The lane may not edit that file. **For root:** update it on integration, or retitle the test.

## For root (from the handoff, endorsed)
- **`SESSION_STOPS` blocks the "IR for hello" target:** `needs_plt` is reached on every declaration. Port the six fns into
  `rustc_session/session.ts`, following the `fewer_names` precedent.
- **`CodegenUnit::codegen_dep_node` returns `never`, so `compile_codegen_unit` always stops at its first line.** It needs a
  rustc_middle decision. Returning `undefined` under D3 is consistent with `with_feed_task`.
- **Replace the four local stops in base.ts** once ssa-mir-core and ssa-base land.
- **The `skeleton.test.ts` counts table and sketch will conflict** with cg-context and cg-builder. Merge by recomputing the
  counts.
