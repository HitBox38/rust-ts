# Handoff: cg-context (M7, plan-m7 wave 41): `context.rs` and `common.rs` of rustc_codegen_llvm

Branch `t3/port-cg-context` (from `620acf48`; no merges). Commits: see the end.

## Summary
- **Ported in full, in upstream order, with markers:** `compiler/rustc_codegen_llvm/src/context.rs` (**54/54**) and
  `compiler/rustc_codegen_llvm/src/common.rs` (**43/43**). Every `cg-context` stub that cg-contract left is replaced. No
  `unported("cg-context: ...")` is left in the crate.
- This covers `create_module` (the data layout check, triple, PIC/PIE, code model, every module flag, `llvm.ident`),
  `CodegenCx::new`, `SimpleCx::new`, the `MiscCodegenMethods` impl (`eh_personality`, `get_fn_addr`, `declare_c_main`, ...),
  `HasDataLayout` / `HasTargetSpec` / `HasTyCtxt` / `HasTypingEnv` / `LayoutOfHelpers` / `FnAbiOfHelpers`, `get_intrinsic` /
  `declare_intrinsic`, `create_used_variable_impl` (the `llvm.used` / `llvm.compiler.used` arrays), the ptrauth and
  Objective-C module flags, the metadata helpers and symbol-name generators. In common.rs it covers `maybe_sign_fn_ptr`,
  `Funclet::new`, the inherent `GenericCx` / `CodegenCx` impls (incl. `alloc_to_backend`, `const_get_elt`), all of
  `ConstCodegenMethods`, and the free fns.
- **Checked against the oracle:** for an empty `#![no_core]` lib, both on x86_64-unknown-linux-gnu and on the host, the port's
  C API calls for `ModuleLlvm::new` + `create_module` + `CodegenCx::new` are the pinned rustc's (`record.ts`), in the same
  order and with the same arguments. The printed module is the oracle's `--emit=llvm-ir` text byte for byte. Details under
  Evidence.
- The backend is still not registered. Samples on `mono-ui` and `mir-o2`: 200/200 MATCH each.

## Files touched
| file | what |
|---|---|
| `src/rustc_codegen_llvm/context.ts` | context.rs, ported (was the skeleton) |
| `src/rustc_codegen_llvm/common.ts` | common.rs, ported (was the skeleton) |
| `src/rustc_codegen_llvm/context.test.ts` | new: tests (Evidence) |
| `src/rustc_codegen_llvm/context_oracle/` | new: `empty.rs`, and per target the oracle's `.ll` and recorded `.script` |
| `src/rustc_codegen_llvm/skeleton.test.ts` | cg-contract's test. As its handoff asks, I updated the cg-context lines: `stops(..)` targets of ported fns, the stub-count table (`cg-context` gone, new owners below), and the three sketch steps that now run (`const_bytes`, `get_intrinsic`, `common::val_ty`) |

`.env.local` was copied for setup (gitignored).

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_codegen_llvm/src/context.rs`: **54/54 ported**.
- `bun scripts/coverage.ts --missing compiler/rustc_codegen_llvm/src/common.rs`: **43/43 ported**.
- `bun scripts/coverage.ts --check --offline`: `markers ok (26010, 43 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311;
  library 744; llvm 354)`.
- `--order` (report only): context.ts has 18 of 54 markers out of order, in 2 descents. This is the class layout PORTING §8
  allows: `GenericCx` (context.rs:888-1252) and `SimpleCx` (:869-886) must be declared before `CodegenCx` extends them.
  common.ts has no rows.

## Evidence
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rustc_codegen_llvm/ ./src/std/result.test.ts ./src/rust_ts/llvm/`: **121 pass,
  0 fail**. `bun test ./src/std/result.test.ts` alone passes.
- `context.test.ts` (12 tests):
  - **create_module + CodegenCx::new against the oracle** (one test per target, x86_64-unknown-linux-gnu and
    aarch64-apple-darwin):
    - The test builds a real `TyCtxt` from the port's front end for `context_oracle/empty.rs`, with the oracle's flags
      (`--crate-type lib --target <t> --emit=llvm-ir -Cno-prepopulate-passes`). It runs `ModuleLlvm::new(tcx, <oracle's
      ModuleID>)` and then `CodegenCx::new`.
    - **Call order:** every ffi.ts function is wrapped to write the port's calls in record.ts's script form. Handles are
      numbered on first sight, strings are written as bytes, and out-parameters as `&n`. The `LLVMRust*` wrappers are
      written as the effects the recorder infers (`?datalayout`, `?triple`, `?flag`), read from the model's state after the
      call.
    - The result must equal `context_oracle/<target>.script`: the pinned rustc's building thread for the same compile,
      recorded with `src/rust_ts/llvm/record.ts`, from `LLVMContextCreate` on. These are 18 lines per target: context, module,
      isize type, `LLVMGetVersion`, data layout set, compared and set, `LLVMDisposeTargetMachine`, triple, the module flags
      (x86_64: PIC Level, RtLibUseGOT, uwtable; host: PIC Level, uwtable, frame-pointer), `llvm.ident`, and `CodegenCx::new`'s
      `LLVMIntTypeInContext`.
    - **Module text:** `printModule` of the module must equal the oracle's `.ll` byte for byte.
    - I checked that the test bites. With `RtLibUseGOT` given `Override` instead of `Warning`, it fails with
      `?flag %2 4 "RtLibUseGOT"` against `?flag %2 2 ...`. I reverted the change.
  - **The oracle fixtures are current** (two tests; they skip without the toolchain unless `RUST_TS_REQUIRE_PROBES=1`):
    - the pinned rustc is re-run, and its `.ll` must equal the fixture;
    - the compile is re-recorded with record.ts, and its building-thread lines from `LLVMContextCreate` on must equal the
      fixture script.
  - **Helpers on the IR model** (8 tests), printed through the model:
    - `SimpleCx::new`'s isize type, and the `SCx` reached through `Borrow`;
    - `create_metadata` + `module_add_named_metadata_node`;
    - `get_md_kind_id` against FixedMetadataKinds.def;
    - `generate_local_symbol_name`'s base-62 counter;
    - `get_functions`' stop;
    - `intrinsic_call_expects_place_always`;
    - constants: int, uint, bytes, null-terminated bytes, struct (packed and not), array, `const_get_elt`, null, undef and
      poison;
    - `const_to_opt_uint` / `const_to_opt_u128`, signed and unsigned;
    - `const_uint_big`'s two words.
- **Test doubles.** `create_module` calls functions that are still typed stubs, in other fill lanes and other crates. For the
  duration of the oracle tests, `spyOn` replaces each one with a **line-by-line copy of its upstream body**:
  - `llvm_util::get_version` (llvm_util.rs:469);
  - `back::write::to_llvm_code_model` (back/write.rs:160);
  - `attributes::frame_pointer` (attributes.rs:217);
  - `Session::needs_plt` (session.rs:863), `Session::must_emit_unwind_tables` (session.rs:1144) and
    `Session::branch_protection` (session.rs:1125);
  - `OwnedTargetMachine`'s `Drop`, which calls `LLVMDisposeTargetMachine`.

  Three are not copies:
  - `back::write::{create_informational_target_machine, create_target_machine}` return an opaque target machine. Its creation
    is a hidden wrapper, so the recorder sees no call.
  - The model's stub `LLVMRustSetDataLayoutFromTargetMachine` applies the effect the oracle shows (`?datalayout`).
  - The model's stub `LLVMDisposeTargetMachine` is recorded as a no-op.

  Every double is restored after the test.
- **Sample difftests**, `RUST_TS_AGENT=cg-context`, `--sample 200 --jobs 6`, on AC power (load 22-33 from the other lanes):
  - `mono-ui`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261112-053406-cg-context-cfqw`.
  - `mir-o2`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261112-053508-cg-context-tu5q`.
  - The backend is not registered, so nothing changes. As expected.

## Every `unported(...)` this lane left, by owner
- **rustc_session** (typed stubs at the end of context.ts; they are reached by every `create_module` once the backend runs):
  - `Session_needs_plt`: `rustc_session: compiler/rustc_session/src/session.rs Session::needs_plt`;
  - `Session_must_emit_unwind_tables`: `... Session::must_emit_unwind_tables`;
  - `Session_branch_protection`: `... Session::branch_protection`.
- **ssa-base**: `wants_msvc_seh` (typed stub in context.ts, `ssa-base: compiler/rustc_codegen_ssa/src/base.rs wants_msvc_seh`),
  reached by `eh_personality`.
- **excluded (plan-m7 D18)**: `CguCoverageContext::new` in `CodegenCx::new` under `-Cinstrument-coverage`. It is inline,
  because coverageinfo/mod.ts has no stub for it (review cg-contract-recheck N1).
- **rustc_sanitizers** (out of scope):
  - `SanitizerIgnoreList::new` in `CodegenCx::new` under `-Zsanitizer-ignorelist`, after the `load_file` loop;
  - `typename_for_ignore_list` in `is_sanitizer_type_ignored`, reached only with a list.
- **rustc_middle**: `StableHash for Allocation` in `alloc_to_backend`. That is the `alloc_<hash>` value name, without
  `fewer_names`, i.e. under `--emit=llvm-ir`. tools/codegen generates no `stable_hash_Allocation`.
- **llir**: `LLVMGetFirstFunction` / `LLVMGetNextFunction` in `get_functions`. They are declared in `llvm/enzyme_ffi.rs`, so
  the contract lacks them, like `LLVMRustHasFnAttribute`.

## Model stops reached (`unported("llir: ...")` in ffi.ts)
- `LLVMRustSetDataLayoutFromTargetMachine`: `create_module`, every compile (a driver lane's; llir-core-a's handoff).
- `LLVMLookupIntrinsicID`, and then `LLVMGetIntrinsicDeclaration`: `declare_intrinsic`'s default arm, through
  `llvm::Intrinsic::{lookup, get_declaration}`. `memcmp` and the two retag intrinsics do not go through them.
- `LLVMRustConstPtrAuth`: `maybe_sign_fn_ptr`, through `llvm::const_ptr_auth`. Only with pointer authentication (a Pauthtest
  target), which `build_session` stops before.
- `LLVMDisposeTargetMachine`: reached only through cg-write's `OwnedTargetMachine::drop`, which stops first.

## Cross-lane stubs this lane calls (as is)
- **cg-types-attrs**:
  - type_.rs: `type_i1`, `type_i8`, `type_i16`, `type_i32`, `type_i64`, `type_i128`, `type_isize`, `type_ix`, `type_ptr`,
    `type_ptr_ext`, `type_func`, `type_variadic_func`, `type_void`, `BaseTypeCodegenMethods::val_ty`;
  - declare.rs: `declare_cfn`, `declare_entry_fn`, `get_declared_value`, `define_global`;
  - attributes.rs: `frame_pointer`, `frame_pointer_type_attr`, `target_cpu_attr`, `tune_cpu_attr`, `target_features_attr`,
    `apply_to_llfn`;
  - callee.rs: `get_fn`.
- **cg-abi-consts**:
  - abi.rs: `to_llvm_calling_convention`;
  - consts.rs: `const_alloc_to_llvm`, `static_addr_of_mut`, `static_addr_of_impl`, `get_static`, `const_bitcast`,
    `const_pointercast`.
- **cg-write**: `llvm_util::get_version`, `back::write::{create_informational_target_machine, to_llvm_code_model}`,
  `OwnedTargetMachine::drop`.
- **cg-di-a/b**: `CodegenUnitDebugContext::new`, `debuginfo::metadata::{build_compile_unit_di_node,
  apply_vcall_visibility_metadata}`.
- `ConstCodegenMethods_provided.scalar_to_backend` and the ssa `_provided` forwarders are unchanged.

So today a real `create_module` stops first in `llvm_util::get_version` (cg-write). Then, in order, it would stop in
`create_informational_target_machine`, `LLVMRustSetDataLayoutFromTargetMachine`, `OwnedTargetMachine::drop`,
`to_llvm_code_model`, `Session::needs_plt`, `Session::must_emit_unwind_tables`, `Session::branch_protection` and
`attributes::frame_pointer`.

## `// PORT:` decisions (for root to record)
1. **context.ts reads its sibling modules lazily.** context.ts defines `CodegenCx` / `GenericCx`, which the extension modules
   (common.ts, declare.ts, debuginfo/mod.ts, ...) attach methods to at load. An eager value import of any of them, or of a
   module that imports one, would run that module before the classes exist. So `crate::{abi, attributes, back::write,
   callee, common, debuginfo, debuginfo::metadata, llvm_util}` and rustc_interface's `CFG_VERSION` are required on first use
   by memoized accessors at the end of context.ts. This is the rustc_trait_selection "read lazily (init order)" pattern.
   `crate::llvm` (the IR model), `value.ts` and `diagnostics.gen.ts` are leaves and are imported eagerly. common.ts is an
   extension module itself and imports consts.ts eagerly, which is safe.
2. **Callees in other crates that are not ported** are exported typed stubs at the end of context.ts: `Session_needs_plt`,
   `Session_must_emit_unwind_tables`, `Session_branch_protection` and `wants_msvc_seh`. They use the cross-lane message form.
   **For root:** port the three `Session` methods into rustc_session/session.ts (a few lines each; root's exception, as
   with `fewer_names`). `wants_msvc_seh` goes into rustc_codegen_ssa/base.ts (1 line). Then replace the four stubs with calls
   to the real ones. Without this, the registered backend stops in rustc_session on every compile.
3. **`tm`'s `Drop` is an explicit `tm.drop()`** at the end of `create_module`'s block. That is where Rust drops it, and the
   oracle's `LLVMDisposeTargetMachine` sits exactly there in the recording (between `LLVMGetDataLayoutStr` and
   `LLVMSetDataLayout`). Without it the C API order would differ. cg-contract's decision 12 ("nothing calls `drop()` at
   scope end") did not cover a drop whose effect is a call the oracle makes. ModuleLlvm's own drop already does the same.
4. **`FullCx.intrinsics`' key** (`(Cow<str>, SmallVec<[&Type; 2]>)`, by value with `&Type` by pointer) is the quoted name
   plus per-`CodegenCx` numbers of the types (`intrinsics_key_fn`). Model types are uniqued but opaque to ported code.
   `instances`, `intrinsic_instances`, `vtables` and `type_lowering` are `KeyedMap`s on `intern_key`.
5. `llvm_version < (23, 0, 0)` / `>= (24, 0, 0)` on tuples are `version_lt` / `version_ge`, which compare lexicographically.
6. `LLVMGetDataLayoutStr` is typed nullable (ffi.ts, review llir F2). LLVM never returns null there, so the
   `str::from_utf8(..).expect(..)` becomes an `assert` with upstream's message.
7. `create_module` passes `&Session` to `versioned_llvm_target(&EarlySession)` as `sess.early_sess` (deref coercion).
8. Integer widths: `get_const_int`/`_i8`.._i64`, `const_u64`, `const_usize`, `const_int`'s `i64` are `bigint`; `alloc_to_backend`'s
   `Err(u64)` base address is `bigint`; `const_get_elt(v, idx: u64)` takes a `number` (an element index; its `c_uint`
   conversion check is kept). `const_int`'s `i as u64` is `BigInt.asUintN(64, i)`.
9. `c_uint::try_from(elts.len()).expect(..)` cannot fail on a JS array, so the conversions stay as comments.
10. `CodegenCx::coverage_cx()` reads `this._0.coverage_cx` (the field is not forwarded, decision 3 of cg-contract), and
    `vtables()` / `eh_personality()` read `this._0.vtables` / `this._0.eh_personality`, as cg-contract's notes said.
11. `declare_intrinsic` (private upstream) is a class method. `SimpleCxDeref` is unchanged: no other `impl SimpleCx` method is
    reached from a `CodegenCx`.

## For other lanes and root
- **cg-contract's stub table** (docs/handoff/cg-contract.md, skeleton.test.ts): `cg-context` 73 → 0. New owners in the count:
  - `rustc_session` 3, `rustc_sanitizers` 2, `rustc_middle` 1;
  - `ssa-base` 1 → 2, `llir` 2 → 4, `excluded (plan-m7 D18)` 10 → 11.
  - The other fill lanes edit the same table, so expect a merge conflict in skeleton.test.ts's `EXPECTED`. Take each lane's
    own line.
- **For the llir lanes:**
  - `LLVMGetFirstFunction` / `LLVMGetNextFunction` (enzyme_ffi.rs) join `LLVMRustHasFnAttribute` /
    `LLVMRustRemoveFnAttribute` as callers the contract lacks. back/write.rs (cg-write) calls `get_functions`.
  - `LLVMLookupIntrinsicID` / `LLVMGetIntrinsicDeclaration` stop every `get_intrinsic` of a real LLVM intrinsic
    (`llvm.trap`, `llvm.memcpy`, ...). That is llir-folder's "intrinsic names".
- **coverageinfo/mod.ts** still says `FullCx.coverage_cx` "is always `None`". It is `None` unless `-Cinstrument-coverage`, which
  now stops in `CodegenCx::new` (recheck N1).
- **cg-write:** context.test.ts's doubles of `get_version` / `to_llvm_code_model` are copies of upstream. When you port
  them, the test keeps passing with or without the spies.

## Commits
- `0827133b` cg-context: port context.rs and common.rs (rustc_codegen_llvm).
- `d3ccb2ff` cg-context: tests against the oracle (create_module call order and module text, helpers).
- The commit of this handoff.
