# Handoff: cg-di-a (M7, wave 40p): rustc_codegen_llvm `debuginfo/{mod,utils,namespace,di_builder,dwarf_const,gdb}.rs`

Branch `t3/port-cg-di-a-debuginfo`, from `7b71d658`. No merges.

## Summary
- The six assigned files are ported whole, in upstream order, with markers: **42/42 fns** (mod.rs 24, utils.rs 6, namespace.rs 2,
  di_builder.rs 7, gdb.rs 3; dwarf_const.rs has no fns, its 15 consts are ported with gimli 0.34.0's values, each line cited).
  `set_var_name` (the `DebugInfoBuilderMethods` impl) is among them.
- **metadata.rs: 4/47.** A compile without `-g` reaches three of its fns, so they are ported whole, with
  `find_vtable_behind_cast`, which two of them call (decision 1 below):
  - `build_global_var_di_node`: consts.rs `codegen_static` calls it for every `static`;
  - `apply_vcall_visibility_metadata` and `create_vtable_di_node`: ssa meth.rs `get_vtable` calls them for every vtable.
  - All three return early without `-g` (or without `-Zvirtual-function-elimination` and fat LTO).
  - Every other metadata.rs fn that these or mod.rs call stays a typed stop (wave 44, D9).
- **Result:** the port's real `compile_codegen_unit` codegens the fixture crates at `-Cdebuginfo=0` end to end. That includes
  rustc_codegen_ssa's `codegen_mir` and `debug_introduce_local` → `set_var_name`. Every function body, global and module flag
  equals the pinned rustc's IR, up to the normal form's renumbering. With `-Cdebuginfo>0`, `CodegenCx::new` adds the oracle's
  two debuginfo module flags and then stops by name at the IR model's `LLVMCreateDIBuilder` (llir-di).
- Nothing protected reaches this code, because the backend is not registered. The sample difftests are unchanged.

## Files touched
- `src/rustc_codegen_llvm/debuginfo/mod.ts`: replaces cg-contract's skeleton (18 stubs → ports; adds `lookup_debug_loc`,
  `create_template_type_parameter`, `DebugLoc`, the `CodegenUnitDebugContext` fields, the `pub(crate) use` re-exports).
- `src/rustc_codegen_llvm/debuginfo/{utils,namespace,di_builder,dwarf_const,gdb}.ts`: new.
- `src/rustc_codegen_llvm/debuginfo/metadata.ts`: the 3 ported fns above plus `find_vtable_behind_cast`, the consts
  `UNKNOWN_LINE_NUMBER` / `UNKNOWN_COLUMN_NUMBER` / `NO_SCOPE_METADATA`, and typed stops for its other fns that are called
  (list below). `build_compile_unit_di_node` stays cg-contract's stub.
- `src/rustc_codegen_llvm/skeleton.test.ts`:
  - the count table: `cg-di-a` 21 → 9, new `cg-di-b` 1;
  - the "one stub per owning file" line now checks `metadata::type_di_node`, because `clear_dbg_loc` is ported.
- Tests, new: `src/rustc_codegen_llvm/debuginfo/mod.test.ts`. The fixture directory is `src/rustc_codegen_llvm/debuginfo/di_oracle/`:
  `names.rs`, `gdb.rs`, `README.md`, and the oracle's `x86_64-unknown-linux-gnu.ll`, `.gdb.ll` and `.gdb-g.ll`. They were made
  from inside that directory with `--remap-path-prefix=$PWD=.`, and none holds an absolute path (a test checks this).
- No other file is edited.

## Coverage (`bun scripts/coverage.ts --missing <file>`)
| upstream file | ported |
|---|---|
| compiler/rustc_codegen_llvm/src/debuginfo/mod.rs | 24/24 |
| compiler/rustc_codegen_llvm/src/debuginfo/utils.rs | 6/6 |
| compiler/rustc_codegen_llvm/src/debuginfo/namespace.rs | 2/2 |
| compiler/rustc_codegen_llvm/src/debuginfo/di_builder.rs | 7/7 |
| compiler/rustc_codegen_llvm/src/debuginfo/dwarf_const.rs | 0/0 (15 consts ported) |
| compiler/rustc_codegen_llvm/src/debuginfo/gdb.rs | 3/3 |
| compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs | 4/47 (wave 44 for the rest) |

`bun scripts/coverage.ts --check --offline`: `markers ok (26804, 46 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 745; llvm 434)`.

## Evidence
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rustc_codegen_llvm/ ./src/rustc_codegen_ssa/ ./src/std/result.test.ts ./scripts/lib/unit-steps.test.ts`:
  **288 pass, 0 fail** (35 files, about 25 s).
- **`bun test ./src/rustc_codegen_llvm/debuginfo/mod.test.ts`: 8 pass, 59 expects, about 1 s.** All of it runs on
  x86_64-unknown-linux-gnu at `-Copt-level=0 -Cno-prepopulate-passes -Ccodegen-units=1`, with the port's front end and the real
  backend.
  1. **names.rs, `-Cdebuginfo=0`.** The port's `compile_codegen_unit` on the crate's one CGU. The printed module equals the
     oracle's in the normal form: comment lines, `; preds` tails, `!guid` attachments and metadata numbers dropped; every
     instruction, name, attribute group and global is compared. The module flags are equal too: no `Dwarf Version` or
     `Debug Info Version`, and no `!llvm.dbg.cu`. The names from `set_var_name` + ssa `debug_introduce_local`:
     - scalar arguments `%x` and `%_unused`;
     - a `ScalarPair` argument `%p.0`/`%p.1`, and `&dyn` arguments `%t.0`/`%t.1`;
     - an indirect argument `%b`, and `%self`;
     - an argument stored to an alloca because it is borrowed (`%0` + `%x = alloca`);
     - the allocas `%arr` and `%acc`;
     - the temporaries `%first`, `%last` and `%_0`.

     The `static` (`build_global_var_di_node`) and the vtable (`apply_vcall_visibility_metadata`, `create_vtable_debuginfo`) go
     through the ported early returns.
  2. **gdb.rs (a bin), `-Cdebuginfo=0`.** The same comparison, for the entry wrapper: `insert_reference_to_gdb_debug_scripts_section_global`
     loads nothing, and no `.debug_gdb_scripts` global is emitted.
  3. **gdb.rs, `-Cdebuginfo=2`.** `CodegenCx::new` → `CodegenUnitDebugContext::new` adds `!{i32 7, !"Dwarf Version", i32 4}` and
     `!{i32 2, !"Debug Info Version", i32 3}`. The module's whole flag list equals the oracle's, in order. Then it stops with
     `llir: LLVMCreateDIBuilder`.
  4. **gdb.rs, `-Cdebuginfo=2`, with a placeholder debug context** (the two doubles in the test header):
     - `needs_gdb_debug_scripts_section` is true;
     - `get_or_insert_gdb_debug_scripts_section_global`'s global equals the oracle's line (`linkonce_odr unnamed_addr constant [34 x i8] c"\01gdb_load_rust_pretty_printers.py\00", section ".debug_gdb_scripts", align 1`),
       and a second call finds the same value;
     - the real ssa `maybe_create_entry_wrapper` gives a `main` whose body equals the oracle's, including
       `load volatile i8, ptr @__rustc_debug_gdb_scripts_section__, align 1`;
     - `debuginfo_finalize` finds the global (one definition) and calls `dbg_cx.finalize()`.

     `needs_gdb_debug_scripts_section` is false at `-Cdebuginfo=0` and for a lib.
  5. **Helpers against the `-g` IR's facts:**
     - `lookup_debug_loc` of `start`'s four argument spans equals `!DILocation(line: 17, column: 13|31|45|70)`;
     - the `def_span` lines equal the `DISubprogram` lines (17, 21);
     - `is_node_local_to_unit` agrees with `DISPFlagLocalToUnit`;
     - `mangled_name_of_instance` equals `linkageName`.
  - With the pinned toolchain present, the test re-makes all three `.ll` fixtures and requires them unchanged.
    `RUST_TS_REQUIRE_PROBES=1` makes the toolchain mandatory. The test reads `RUST_TS_REQUIRE_PROBES` and `RUST_TS_AGENT`, the
    variables its sibling tests already read; `scripts/lib/unit-steps.test.ts` passes. **The port's files read no environment
    variable.**
- **Mutation checks** (each reverted; the count is failing tests out of 8):

  | mutation | failing |
  |---|---|
  | `set_var_name` returns at once | 2 |
  | `set_var_name` overwrites an existing name | 1 |
  | `set_var_name` with `fewer_names` inverted | 2 |
  | `lookup_debug_loc` column without `+ 1` | 1 |
  | `Dwarf Version` merge behaviour `Warning` instead of `Max` | 1 |
  | gdb global without `LLVMSetAlignment(.., 1)` | 1 |
  | entry wrapper without the volatile load | 1 |
  | `needs_gdb_debug_scripts_section` ignores the debuginfo level | 2 |
  | `debuginfo_finalize` without `dbg_cx.finalize()` | 1 |
- **Sample difftests** (`RUST_TS_AGENT=cg-di-a`, `--sample 200 --jobs 6`, AC power):
  - `mono-ui`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261113-220328-cg-di-a-pifq`;
  - `mir-o2`: **200/200 MATCH**, run `20261113-220512-cg-di-a-2c1q`.

### Not covered by the tests
- Everything past `LLVMCreateDIBuilder` under `-g`: `dbg_scope_fn`, `dbg_create_lexical_block`, `dbg_loc`, `create_dbg_var`,
  `dbg_var_addr`/`dbg_var_value` (DIExpression ops), `item_namespace`, `create_template_type_parameter`, `create_static_variable`,
  `with_move_annotation` (`-Zannotate-moves`). They need llir-di's `LLVMDI*` and wave 44's metadata.rs.
- `wide_pointer_kind` and `get_namespace_for_item`: only metadata.rs calls them.
- `DIBuilderBox::drop`: upstream drops the box implicitly when `cx` leaves scope at the end of `module_codegen`'s block
  (base.rs:216). base.ts has no call yet; it belongs with llir-di (review cg-di-a N3; corrected by fixers-57).
- MSVC's `col: UNKNOWN_COLUMN_NUMBER` in `lookup_debug_loc`, and `DebuginfoKind::Pdb`'s `CodeView` flag: Windows targets are out
  of M7 (D18).
- `#[debugger_visualizer]` gdb printers: the fixture has none.

## IR-model stops (`LLVMDI*` / `LLVMRustDI*` the model lacks; llir-di's)
Reached from ported code only under `-Cdebuginfo>0`. The first one is `LLVMCreateDIBuilder`, in `CodegenCx::new`.
- `LLVMCreateDIBuilder`, `LLVMDisposeDIBuilder`, `LLVMDIBuilderFinalize` (di_builder.ts, mod.ts)
- `LLVMDIBuilderCreateNameSpace` (namespace.ts `item_namespace`)
- `LLVMDIBuilderCreateLexicalBlock`, `LLVMDIBuilderCreateDebugLocation`, `LLVMRustDILocationCloneWithBaseDiscriminator`
- `LLVMDIBuilderCreateParameterVariable`, `LLVMDIBuilderCreateAutoVariable` (`create_dbg_var`)
- `LLVMDIBuilderCreateExpression`, `LLVMDIBuilderInsertDeclareRecordAtEnd`, `LLVMDIBuilderInsertDbgValueRecordAtEnd`
- `LLVMDIBuilderGetOrCreateArray` (utils.ts `create_DIArray`)
- `LLVMDIBuilderCreateGlobalVariableExpression` (di_builder.ts `create_static_variable`)
- `LLVMRustDIBuilderCreateFunction`, `LLVMRustDIBuilderCreateMethod` (`dbg_scope_fn`)
- `LLVMRustDIBuilderCreateTemplateTypeParameter` (`create_template_type_parameter`)

The model already implements the other C API these files call:
- `LLVMGetCurrentDebugLocation2` / `LLVMSetCurrentDebugLocation2`, `LLVMRustDebugMetadataVersion`;
- `LLVMIsAArgument`, `LLVMIsAInstruction`, `LLVMGetValueName2` / `LLVMSetValueName2`;
- `LLVMGetNamedGlobal`, `LLVMSetGlobalConstant`, `LLVMSetAlignment`, `LLVMGlobalSetMetadata`;
- `LLVMIsAConstantExpr`, `LLVMGetConstOpcode`, `LLVMGetOperand`.

## Cross-lane typed stops left (every `unported(...)` in this lane's files)
- `cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs <fn>` (wave 44), 9 in total:
  - `create_subroutine_type` :339, `type_di_node` :446, `spanned_type_di_node` :450, `file_metadata` :564,
    `unknown_file_metadata` :637;
  - `build_compile_unit_di_node` :876 (cg-contract's);
  - `build_vtable_type_di_node` :1534, `extend_scope_to_file` :1804, `file_metadata_from_def_id` :1832.
- `cg-di-b: compiler/rustc_codegen_llvm/src/debuginfo/metadata/type_map.rs TypeMap::default`, 1: the `#[derive(Default)]` of
  `CodegenUnitDebugContext.type_map`.
- **Order of stops under `-g`:**
  1. `llir: LLVMCreateDIBuilder`;
  2. once llir-di provides it, `cg-di-b: … TypeMap::default`;
  3. then `cg-di-a: … build_compile_unit_di_node`.

## `// PORT:` decisions
1. **metadata.rs is partly ported, against the lane brief's "do not port metadata.rs" (decision for root to record).** The brief also
   asks for "everything a compile with `-Cdebuginfo=0` reaches". Without `-g`, three metadata.rs fns are reached by every
   program with a `static` or a vtable. As typed stops, they would stop those compiles. So `build_global_var_di_node`,
   `apply_vcall_visibility_metadata` and `create_vtable_di_node` are ported whole, with `find_vtable_behind_cast` and three consts.
   - The 43 other fns stay for wave 44.
   - The stubs keep cg-contract's label `cg-di-a` (plan-m7 §8 gives metadata.rs to `cg-di-a`); `TypeMap` is `cg-di-b`'s.
2. **`DIBuilderExt`**, a trait on the foreign handle `&DIBuilder`, is an interface taking `self` with one impl table
   (`DIBuilderExt_for_DIBuilder`). Its provided methods are in `DIBuilderExt_provided` (PORTING §8). The required member's
   marker sits on the interface, as ssa-contract's traits do. `DIBuilderBox`'s `Drop` is a `drop()` method.
3. **Deref coercion:** free fns taking `&CodegenCx`, called with a `Builder`, get `bx.cx_` / `this.cx_`.
   `self.typing_env()` is `typing_env_()`, and `self.llcx` is `llcx()` (context.ts header).
4. **`dbg_scope_fn`'s nested fns** stay nested after the `return`, with markers (ssa-debuginfo's convention).
   `args.terms().next().is_none()` asks the iterator for its first item through `globalThis.Symbol`.
5. **Bitflags:** `|` is `union`; `a & !b` is `intersection(a, complement(b))`.
6. **`CodegenUnitDebugContext`'s fields:**
   - `created_files` is a `KeyedMap` keyed by the derived `Eq` of `Option<(StableSourceFileId, SourceFileHash)>`: the id's
     `Hash128` and the hash's kind and bytes (`key_created_files`). Only metadata.rs's `file_metadata` uses it (wave 44 should
     check the key);
   - `namespace_map` is a `DefIdMap`, and `adt_stack` an array;
   - `recursion_marker_type` (`OnceCell`) is `DIType | undefined`;
   - `type_map` is metadata/type_map.rs's opaque `TypeMap`.
7. **Address operations** (`SmallVec<[u64; 8]>`) are `bigint[]`, as ffi.ts types `LLVMDIBuilderCreateExpression`. The `u64`
   DWARF consts are `bigint`, the `c_uint` ones `number`. `Size::bytes()` / `bits()` are converted with `BigInt`.
8. **`apply_vcall_visibility_metadata`'s `match (lto, trait_vis, single_cgu)`** is an if-chain in arm order. The third arm,
   `(_, Restricted, true)`, is the `else`, because the match is exhaustive. The local `enum VCallVisibility` is its `u64`
   discriminants.
9. **gdb.rs:** `c"…"` literals are JS strings, and `section_contents: Vec<u8>` is a `number[]` made a `Uint8Array`. The
   `unwrap_or_else` closure is an early return of the found global.
10. **`let DefKind::Static { nested, .. } = .. else { bug!() }`** is a tag check, then `bug()`, whose default message is
    `bug!()`'s "impossible case reached".

## Notes for root
- **The backend path works on these fixtures:** at `-Cdebuginfo=0`, `compile_codegen_unit` runs end to end over a lib and a bin
  and gives the oracle's IR. This may help with "register the backend".
- **`abi_consts.test.ts`'s double of `build_global_var_di_node` is now redundant.** It copied the early return of the real fn,
  which is ported. Its owner can drop it; it is harmless as it is.
- **`docs/handoff/cg-contract.md`'s stub table** still says 21 for cg-di-a; skeleton.test.ts has the new counts (cg-di-a 9,
  cg-di-b 1).
- **The oracle's `-Cno-prepopulate-passes` IR carries `!guid` attachments.** The test drops them, as the N1 normal form's
  assign-guid handling does.
