REQUEST CHANGES

# Review: cg-contract (M7 wave 40, contract lane), independent reviewer

Branch `t3/llvm-codegen-contract`, commits `72e43136`, `7bec77d8`, `b5c3e429`. Reviewed
`git diff $(git merge-base main t3/llvm-codegen-contract)...t3/llvm-codegen-contract` (merge base `b3772ebb`) against the
pinned `compiler/rustc_codegen_llvm/src/` (`6f5da406`). I also read plan-m7 §2 and §8, the ssa-contract handoff, review and
decision, and the llir-core-a handoff.

**Summary.** The ported files are faithful: `llvm/mod.rs`, `conversions.rs`, `metadata_kind.rs`, `value.rs`, `macros.rs`
and `back/llvm_backend.rs`. Every fn is in upstream order, with correct markers and no guessed values. `print` matches the
oracle byte for byte, and I reproduced that. The skeleton typechecks without casts, and a fill-lane sketch works for `bx.tcx`,
`self.cx_.type_i8()`, `self.cx().type_i8()`, the deref'd `bx.type_i8()`, `llvm::LLVMBuild*`, generic code over
`BuilderMethods<B>` and the static side.

Two contract-level problems must be settled before the five wave-41 fill lanes start:
- **F1:** the subclass layout reverses Rust's inherent-before-trait method precedence on `Builder`, and for `load`/`store`
  the bodies differ;
- **F2:** the cross-lane surface those lanes call into does not exist. It starts with `cx.llcx()`, the very form the handoff
  tells them to write.

Both are cheap to fix.

## Evidence (reproduced on this worktree, AC power, Bun 1.4.4)
I checked out the branch's crate untracked in my worktree, ran everything below, and removed it afterwards.
- `bunx tsc --noEmit -p .`: clean (exit 0).
- `bun scripts/coverage.ts --check --offline`: `markers ok (25897, 32 of them in compiler/rustc_llvm/llvm-wrapper; vendor
  5311; library 735; llvm 174)`.
- `bun test ./src/std/result.test.ts ./src/rustc_codegen_llvm/`: **38 pass, 0 fail**, 715 expects, 5 files.
- **`print`, reproduced independently.** For each of `relocation-models`, `code-models`, `tls-models` and
  `stack-protector-strategies`:
  - I captured `rustc +nightly-2026-10-11 --print <kind>` stdout myself;
  - I called `new LlvmCodegenBackend().print({kind}, out, _)` through `lib.ts` from a scratch script.
  - Result: all four **MATCH** (120, 75, 105 and 769 bytes). The stack-protector text ends in `.\n\n` (raw string plus
    `writeln!`), as upstream's does.
- **Run-time deref check** (scratch script, real classes over a fake `FullCx`):
  - `bx.tcx` reads `FullCx.tcx`, and a write goes through to it;
  - `bx.type_i8()` stops with the `cg-types-attrs` message, `bx.const_usize()` and `bx.sess()` with the `cg-context` one, and
    `bx.get_static()` and `bx.load()` with `cg-builder`'s own;
  - `FullCx.borrow()` returns `scx._0`.
- **Sample difftests**, `RUST_TS_AGENT=review-cg-contract`, `--sample 200 --jobs 6`:
  - `mono-ui`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261111-213626-review-cg-contract-mp8c`;
  - `mir-o2`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261111-213719-review-cg-contract-efw9`.
  - As expected: nothing outside the crate imports it. `git diff main...t3/llvm-codegen-contract` outside
    `src/rustc_codegen_llvm/` and the handoff is empty.

## Findings (must fix)

### F1. `Builder`'s inherent `load`/`store` lose to the trait methods. Rust does the opposite, and the bodies differ.
- **Upstream.** `impl<CX> GenericBuilder<CX>` has inherent methods with the same names as `BuilderMethods` methods:
  - builder.rs: `build` :130, `append_block` :101, `trunc` :112, `bitcast` :116, `ret_void` :120, `ret` :124,
    `inbounds_gep` :156, `store` :175, `load` :185, `va_arg` :1875;
  - the trait impl for `Builder` has `build` :292, `append_block` :312, `trunc` :1012, `bitcast` :1127, `ret_void` :327,
    `ret` :331, `inbounds_gep` :973, `store` :872, `load` :691, `va_arg` :1260.
- **Rust picks the inherent method.** Rust tries inherent methods before trait methods at the same autoderef step. So
  every direct call on a concrete `Builder` inside this crate calls the **inherent** one. Examples:
  - va_arg.rs:55/66/182/236/251/260, with `bx: &mut Builder` (va_arg.rs:43);
  - intrinsic.rs:389/621/622/978, `self` in `impl IntrinsicCallBuilderMethods for Builder`.
  - A grep finds about 49 `self|bx.load(` and 24 `.store(` sites in the crate.
  - Only generic `rustc_codegen_ssa` code (`Bx: BuilderMethods`) reaches the trait methods.
- **For `load` and `store` the bodies differ:**
  - the trait `load` clamps the alignment to `tcx.sess.target.max_reliable_alignment()` (:694); the inherent one does not
    (:188);
  - the trait `store` goes through `store_with_flags`, which clamps the same way (:887); the inherent `store` does not
    (:179).
  - `max_reliable_alignment()` is 4 on `is_like_windows && arch == X86` (rustc_target spec/mod.rs:3105). So the IR differs
    on i686-pc-windows-msvc-like targets.
  - The other eight pairs have identical bodies, so either choice is harmless for them.
- **What the port does.** `Builder extends GenericBuilder<FullCx>`, so `Builder.prototype.load` (the trait stub) shadows
  `GenericBuilder.prototype.load` (the inherent one, once cg-builder ports it). That is the reverse of Rust.
  - A fill lane that writes `bx.load(..)` as upstream does gets the trait body.
  - No M7 suite runs an x86 Windows target, so nothing would ever catch it. That is why it belongs in the contract now.
- **What the handoff says.** Its notes cover only the `CodegenCx` analog, `const_null`/`const_struct` (inherent common.rs:168
  and :172 against the trait :266 and :378; the bodies are identical). The builder.ts header and the cg-builder notes say
  nothing.
- My scan of every `impl` block finds no other inherent/trait name pair on `Builder`, `GenericBuilder`, `CodegenCx`,
  `GenericCx` or `SimpleCx`.
  - `SBuilder::call` (:62) is on `SBuilder` only.
  - `val_ty` is inherent on `SimpleCx` (context.rs:873) and a trait method on `GenericCx` (type_.rs:280). For a `CodegenCx`,
  Rust picks the trait method before the deref, and the port does too.
- **Fix:**
  1. Record a decision and state it in builder.ts's header and the cg-builder/cg-intrinsic notes. Inside
     `rustc_codegen_llvm`, a direct call of one of the ten names above on a concrete `Builder` resolves to `GenericBuilder`'s
     inherent method. Fill lanes write it as an explicit inherent call, for example
     `GenericBuilder.prototype.load.call(bx, ..)`, or a helper cg-builder exports. At least `load` and `store` must be
     written this way. For the identical eight it may be waived, with a comment saying so.
  2. List the `CodegenCx` pair `const_null`/`const_struct` under the same rule. The handoff already covers it.

### F2. The cross-lane surface of wave 41 is missing, starting with `cx.llcx()`, which the handoff tells lanes to write
- **The accessor problem.** context.ts:22-24 and the handoff, decision 3, say upstream's field reads `cx.llcx` / `cx.llmod`
  are written `cx.llcx()` / `cx.llmod()`. These are type_.rs:152-162's inherent methods on `GenericCx`. But nothing declares
  them.
  - A fill-lane sketch (`this.cx_.llcx()` inside a `Builder` method) fails tsc with
    `TS2339: Property 'llcx' does not exist on type 'CodegenCx'`.
  - Upstream reads those fields about 160 times, in files that four different wave-41 lanes own: attributes.rs 75, abi.rs
    28, context.rs 14, intrinsic.rs 8, declare.rs 5, builder.rs 4, allocator.rs 4, type_.rs 3. back/write.rs and asm.rs
    read them too.
- **The wider gap.** The contract stubs trait methods only, plus the inherent fns `back/llvm_backend.ts` calls (`SimpleCx::new`,
  `create_module`, `Funclet`). But the wave-41 lanes mostly call each other through inherent fns and crate-internal
  extension traits.
  - A scan of upstream finds about 150 such names called across the five lanes' files. Approximate, from a regex:
    - **cg-types-attrs ← others:**
      - type_.rs: `type_void`, `type_ix`, `type_i1`, `type_struct`, `type_vector`, `type_named_struct`, `set_struct_body`,
        `func_params_types`, `type_int_from_ty`, …;
      - declare.rs: `declare_fn`, `declare_cfn`, `declare_global`, `define_global`, `get_declared_value`, `declare_entry_fn`;
      - attributes.rs: `apply_to_llfn`, `apply_to_callsite`, `frame_pointer_type_attr`, `target_features_attr`, …;
      - type_of.rs: `LayoutLlvmExt`, `scalar_pair_element_llvm_type`, …;
    - **cg-context ← others:**
      - context.rs: `get_intrinsic`, `create_metadata`, `get_md_kind_id`, `get_metadata_value`, `get_const_i32`,
        `set_metadata`, `generate_local_symbol_name`, `get_type_of_global`, …;
      - common.rs: `const_bytes`, `const_get_elt`, `named_struct`, …;
    - **cg-abi-consts ← others:**
      - abi.rs: `FnAbiLlvmExt::{llvm_type, ptr_to_llvm_type, llvm_cconv, apply_attrs_llfn, apply_attrs_callsite}`, `ArgAbiExt`;
      - consts.rs: `const_bitcast`, `const_pointercast`, `get_static`, `static_addr_of_impl`, …;
    - **cg-builder ← cg-intrinsic-a and cg-types-attrs:** `GenericBuilder`'s inherent `build`, `call`, `load`, `llfn`,
      `set_unpredictable`, …
  - No file declares any of these. type_of.rs, declare.rs, callee.rs and attributes.rs do not exist yet.
  - plan-m7 §8 runs the five lanes in parallel. Each lane then either blocks on the others' merges, or adds stubs to files
    it does not own (PORTING §1), which means merge conflicts in context.ts, type_.ts and common.ts.
- **Fix (the recommended option):**
  1. Port `llcx()`, `llmod()` and `isize_ty()` in the contract. Each is one line: `(**self).borrow().llcx`.
  2. Add typed stubs in the owner's file, with the existing message form, for every crate-internal inherent fn and
     extension-trait method called from another lane's file.
  3. Extend skeleton.test.ts's per-lane counts to cover them.
- **Alternative:** root records that wave 41 is staged instead: cg-types-attrs and cg-context first, the rest after them.
  That costs a wave of calendar time.

## Nits
- **N1:** handoff, "Forwarders to `_provided` helpers": "The other **17** defaults are overridden upstream". There are
  **16**. ssa-contract's `BuilderMethods` has 29 `(provided)` members: 13 forward and 16 are stubs. The names listed in the
  handoff are the 16; only the number is wrong. The code is right: I checked each of the 29 against builder.rs's impl.
- **N2:** the handoff's cg-context notes and context.ts:25-28 give `val_ty` as an `impl SimpleCx` method that `CodegenCx`
  reaches through the deref, to add to `SimpleCxDeref`.
  - That is wrong: `CodegenCx` has `val_ty` from `BaseTypeCodegenMethods for GenericCx` (type_.rs:280), which Rust picks
    before the deref. `install_deref_methods` correctly skips it.
  - `get_type_of_global` (context.rs:870) is a correct example; use it instead.
- **N3:** llvm/mod.ts:69-71 `str_len` uses `Buffer.byteLength(s, "utf8")`. PORTING §5 says `utf8_len(s)` (src/std/str.ts:18).
- **N4:** type_.ts imports `GenericCx` twice: as `GenericCx` and as `GenericCx as GenericCx_`, which is only used for the two
  `defineProperty` calls. One import is enough.
- **N5:** `get_value_name` (llvm/mod.ts:373-381) re-encodes the IR model's decoded string.
  - A name that is not UTF-8 would trip a `length mismatch` assertion that upstream does not have.
  - rustc only names values with Rust strings, so this cannot happen today.
  - It is a limit of the IR model's `LLVMGetValueName2` returning `string`. Note it for the llir lanes; nothing to change
    here.
- **N6, for the later registration lane:**
  - `LlvmCodegenBackend.new()` returns `CodegenBackend`, and `print`, `has_zstd` and `has_mnemonic` are not
    `CodegenBackend` members (ssa-contract decision 9).
  - So rustc_driver_impl, which holds a `dyn CodegenBackend`, cannot reach LLVM's `print` override without a downcast.
    Today rustc_driver_impl/lib.ts:846-857 calls `unported`.
  - Registering needs a decision: optional interface members, or an `instanceof LlvmCodegenBackend` arm.
  - Not this lane's to fix.

## The skeleton (point 2 of the brief)
- **Fields.**
  - `SCx`, `FullCx` (all 30 fields, in context.rs:94-172's order) and `GenericBuilder` (`llbuilder`, `cx`, `span`) match
    the pin.
  - The types are the IR model's handles.
  - The caches are `Map` where the key is an object or an interned handle (`Value`, `Ty`, `Symbol`), `KeyedMap` for
    composite keys (`Instance`, `(Ty, Option<ExistentialTraitRef>)`, `(Ty, Option<VariantIdx>)`, the intrinsics key) and
    `DefIdMap`.
  - `Cell`/`RefCell` are erased.
  - The out-of-M7 types are `never` or opaque placeholders.
- **Deref.** The design is faithful:
  - field accessors for `CodegenCx` → `FullCx`;
  - run-time forwarders for `FullCx` → `SimpleCx` and `Builder` → `CodegenCx`, installed by lib.ts after every extension
    import, where a class's own members win;
  - declaration merging on the type side.
- **What a fill lane writes:**
  - upstream `bx.tcx` → `bx.tcx`;
  - upstream `self.cx.tcx.sess` → `this.cx_.tcx.sess`;
  - upstream `self.cx.type_i8()` → `this.cx_.type_i8()`;
  - upstream `self.cx().type_i8()` → unchanged;
  - upstream `bx.type_i8()` → unchanged;
  - generic code: `BuilderMethods_provided`-style signatures (`self: BuilderMethods<B>`) infer `B = LlvmTypes` from
    `Builder`;
  - `BuilderMethodsStatic<LlvmTypes, CodegenCx, Builder>` takes `Builder` without a cast.
- **The `cx_` rename** is necessary: an instance field `cx` would shadow the prototype method `BuilderMethods::cx()`. Its
  cost to fill lanes is mechanical: upstream `self.cx` / `bx.cx` → `this.cx_` / `bx.cx_` at about 190 sites across the crate (66 of them in builder.rs). Record it, along with
  `cleanuppad_` and `data_`.
- **Precedence.** Rust's rule holds that `Builder`'s own members win over `CodegenCx`'s, except for the inherent/trait split
  inside one type (F1).

## Stubs (point 3)
- Every trait method of the impls in this crate has a typed stub naming its lane and upstream fn, in that lane's file.
  `implements` checks this, and skeleton.test.ts checks the counts by lane name.
- **Defaults left to `_provided`:**
  - all 29 `BuilderMethods` defaults are classified correctly: 13 forward, 16 are stubs;
  - `CodegenCx`'s eight `DerivedTypeCodegenMethods` and `scalar_to_backend`, and the `LayoutOf`/`FnAbiOf` blankets,
    forward;
  - `CodegenBackend`'s `supported_crate_types`/`metadata_loader` and `WriteBackendMethods::supports_parallel` forward.
- **The per-lane table is consistent with plan-m7 §8:**
  - wave 41: cg-context, cg-types-attrs, cg-builder, cg-abi-consts, cg-intrinsic-a;
  - waves 42-44: cg-write, cg-lto-diag, cg-asm, cg-di;
  - `coverageinfo` is excluded;
  - the one change is that `back/llvm_backend.rs` moves to this lane; see decision 5.
- What it does not cover is the non-trait cross-lane surface (F2).

## The three gaps (point 4): advice to root
1. **`LLVMRustHasFnAttribute` / `LLVMRustRemoveFnAttribute`** (enzyme_ffi.rs:48 and :53).
   - **Callers.** In M7 scope: `llvm::HasStringAttribute`, which builder.rs:2019 and :2153 call. Both are only under
     `-Zsanitizer=cfi` / `kcfi` on an indirect call. Out of M7 (`-Zoffload`): `attributes::{has_string_attr,
     remove_string_attr_from_llfn}`, which back/write.rs:731 and :734 call.
   - **Advice.** Make the exclusion partial for exactly these two declarations. ffi_gen reads them from enzyme_ffi.rs by an
     allowlist, in a tools batch for an llir lane, recorded.
   - **Why.** llvm/mod.ts then calls `ffi.LLVMRustHasFnAttribute` like every other helper. The IR model can keep them as
     `stub` until a CFI/KCFI case enters a suite; tests/codegen-llvm/sanitizer is in the sparse checkout, so `ir-codegen`
     will reach it.
   - **Not a blocker.** Until then, the current `unported("llir: …")` is correct.
2. **`RustString`.**
   - Upstream llvm/mod.rs:10 imports it from `rustc_llvm` (`use rustc_llvm::RustString`), not from `ffi`.
   - support.ts is the TS home of rustc_llvm's Rust side; `src/rustc_llvm/` does not exist.
   - So importing the class from support.ts is the faithful mapping, not a workaround. ffi.ts's type-only re-export is
     right for ffi.rs, which uses the type only in signatures.
   - **Advice:** no generator change. Record that rustc_llvm's Rust items come from `src/rust_ts/llvm/support.ts`, and
     reword the comment at llvm/mod.ts:46-48 accordingly.
3. **`Session::fewer_names`** (rustc_session session.rs:1060; 10 lines).
   - It is on the hello-world path: `base::compile_codegen_unit` → `ModuleLlvm::new`, and `codegen_allocator` →
     `new_metadata`.
   - What it needs already exists: `Session::sanitizers()` (session.ts:1000), `unstable_opts.fewer_names`
     (options.gen.ts:1623) and `opts.output_types`. Its neighbour at :1072 is ported.
   - **Advice:** port it into session.ts before cg-types-attrs needs it. Assign it to whoever owns rustc_session in wave
     41, or give cg-types-attrs a named exception to PORTING §1 for that one fn.
   - Then replace the local stub in back/llvm_backend.ts:64-67 with `tcx.sess.fewer_names()`.
   - `cgcx.fewer_names` stays ssa-write's.

## PORT decisions root should record
1. **`back/llvm_backend.rs` belongs to cg-contract.** `lib.rs` is only `mod` items at the pin. Take it off cg-write's list
   in plan-m7 §2b and §8.
2. **`GenericCx<T>` / `GenericBuilder<CX>` are classes with field `_0` / `cx_`.** The aliases are subclasses:
   `SimpleCx`, `CodegenCx`, `SBuilder`, `Builder`. `impl<CX> GenericCx<CX>` goes on the base class.
3. **Auto-deref:**
   - `CodegenCx` → `FullCx` fields are prototype accessors (`FULL_CX_DEREF_FIELDS`);
   - `FullCx` → `SimpleCx` and `Builder` → `CodegenCx` methods are run-time forwarders, which `install_deref_methods`
     installs in lib.ts after all extension imports. A new extension file must be imported in lib.ts before those calls;
   - on the type side, declaration merging (`FullCxDeref`, `SimpleCxDeref`, `BuilderDeref`). A lane extends the `Pick` /
     `Omit` lists when it adds a member.
4. **Fields renamed where a method has the same name:**
   - `GenericBuilder.cx` → `cx_` (upstream `self.cx` → `this.cx_`, `self.cx()` unchanged);
   - `Funclet.cleanuppad` → `cleanuppad_`;
   - `ModuleBuffer.data` → `data_`.
   - The `SCx` fields are read through `llcx()` / `llmod()` / `isize_ty()` (upstream `cx.llcx` → `cx.llcx()`).
   - The four `FullCx` fields that collide with methods (`vtables`, `statics_to_rauw`, `coverage_cx`, `eh_personality`)
     are read as `this._0.<field>`.
5. **Inherent before trait (F1).**
   - Direct calls inside `rustc_codegen_llvm` on a concrete `Builder` of `load`/`store` call `GenericBuilder`'s inherent
     method explicitly. The same holds for `build`, `append_block`, `trunc`, `bitcast`, `ret`, `ret_void`, `inbounds_gep`
     and `va_arg`, whose bodies are equal.
   - On `CodegenCx`, `const_null` / `const_struct` follow the same rule.
6. **The cross-lane surface (F2):** the contract declares typed stubs for crate-internal inherent fns and extension traits
   called across lanes, or root stages wave 41 instead. Record which.
7. **Representations:**
   - `FromGeneric`/`ToGeneric` impls are consts `<Trait>_for_<Type>`;
   - inherent impls on generated ffi enums are `<Enum>_impl` consts;
   - `#[derive(TryFromU32)]` is `TryFromU32(<Enum>_discriminant)`;
   - `pub(crate) use CallConv::*` is written `CallConv.X`;
   - `Drop` is a `drop()` method that nothing calls;
   - `Value`'s `Hash` is `unported`, and maps key on the object.
8. **The gaps:**
   - the enzyme_ffi.rs exclusion becomes partial for `LLVMRustHasFnAttribute` / `LLVMRustRemoveFnAttribute` (gap 1);
   - `RustString` comes from support.ts (gap 2);
   - `Session::fewer_names` gets an owner (gap 3).
9. **Not registered** until root decides. Registration needs the N6 decision.
