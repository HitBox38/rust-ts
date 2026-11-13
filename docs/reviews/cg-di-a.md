# Review: lane `cg-di-a` (wave 40p)

Reviewer: independent, read-only on code. Branch `t3/port-cg-di-a-debuginfo`, commits `8e3a39ef` (port, tests, fixtures) and
`86e3b5cd` (handoff), against `main` at `7b71d658` (`git diff 7b71d658..86e3b5cd`). Merged into the review worktree with
`git merge --no-edit 86e3b5cd`. Upstream is the pin `6f5da406b56c`, under `$RUST_TS_DATA/rust`.

## Verdict: **PASS WITH NOTES**

No must-fix findings. The six files are ported whole, in upstream order, with correct markers. The four `metadata.rs` fns match
upstream and have real call sites at `-Cdebuginfo=0`. All 15 DWARF constants equal gimli 0.34.0's values. The headline IR
comparison is real: I diffed the port's full module text against the oracle, and the only differences are comment lines,
`; preds` tails, `!guid` attachments and their nodes, and metadata numbering. The notes below cover two test gaps, a missing drop
site (no effect on output), and three small documentation items.

## Commands
| command | result |
|---|---|
| `bunx tsc --noEmit -p .` | exit 0 |
| `bun scripts/coverage.ts --check --offline` | `markers ok (26804, 46 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 745; llvm 434)` |
| `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rustc_codegen_llvm/ ./src/rustc_codegen_ssa/ ./src/std/result.test.ts` | 278 pass, 0 fail (34 files) |
| `bun test ./scripts/lib/unit-steps.test.ts` | 10 pass, 0 fail |
| `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rustc_codegen_llvm/debuginfo/mod.test.ts` | 8 pass, 59 expects |

278 + 10 = 288, which matches the handoff.

## 1. Order and coverage
`bun scripts/coverage.ts --missing compiler/rustc_codegen_llvm/src/debuginfo/<f>.rs`: mod 24/24, utils 6/6, namespace 2/2,
di_builder 7/7, dwarf_const 0/0, gdb 3/3. metadata.rs is 4/47, and what is left is wave 44's. `coverage --check` validates every
marker's line and name. I also read each marker in file order next to the upstream `fn` lines while doing §2, and they appear
in upstream order. The nested
fns of `dbg_scope_fn` stay after the `return` with their own markers (mod.rs:233/287/322/332). The metadata.ts stubs sit at their
upstream positions (339, 446, 450, 564, 637, 876, 1534, 1804, 1833), and the ported fns fall between them in order (1473, 1685,
1697, 1762).

## 2. Logic fidelity
I read every fn against upstream:
- **`set_var_name`** (mod.ts:574, mod.rs:593): same order of checks as upstream:
  1. `fewer_names()` returns first;
  2. then it returns unless `LLVMIsAArgument || LLVMIsAInstruction`;
  3. then it renames only if `get_value_name(value)` (a `Uint8Array`) is empty.

  The name is `utf8(name)`, upstream's `name.as_bytes()`.
- **`dbg_scope_fn`**: same evaluation order as upstream. `get_containing_scope` runs before `def_span`, and
  `get_function_signature` runs before `create_subroutine_type`. Also checked:
  - `FlagNoReturn` / `SPFlagLocalToUnit` / `SPFlagOptimized` / `SPFlagMainSubprogram`;
  - the method `decl` gets `spflags & !SPFlagDefinition`;
  - `linkage_name` is omitted when it equals `name`.

  The nested fns follow upstream:
  - `get_template_parameters`: `zip` is truncated to the shorter list, and `filter_map(as_type)` gives `Vec<Option<_>>`;
  - `get_parameter_names` takes the parent first;
  - `get_containing_scope`: the inherent impl, then `!is_box`, then `Full && !has_param`, then the namespace fallback with
    `DefId { krate, index: parent }`.
- **`lookup_debug_loc`** (mod.ts:664, mod.rs:686): the line is `(line + 1) as u32`, and the column is
  `(relative_position(pos) - line_pos).to_u32() + 1`. `Err(file)` gives `UNKNOWN_*`. MSVC gets column `UNKNOWN_COLUMN_NUMBER`.
- **`dbg_loc`**: a dummy span gives `(0, 0)`; otherwise `lookup_debug_loc(span.lo())`, then
  `LLVMDIBuilderCreateDebugLocation(llcx, ..)`.
- **`create_dbg_var`**: the order is `lookup_debug_loc`, `file_metadata`, `spanned_type_di_node`, `align_of`. Parameter
  variables vs auto variables use `arg_index as c_uint` and `align.bits() as u32`, written as `>>> 0`.
- **`dbg_var_addr` / `dbg_var_value`**: the ops match upstream, including `DW_OP_stack_value` only after a direct offset in
  `dbg_var_value`. The port also keeps upstream's asymmetry: `dbg_var_addr` goes through `DIBuilderExt::create_expression`,
  while `dbg_var_value` calls `LLVMDIBuilderCreateExpression` directly.
- **`CodegenUnitDebugContext::new` / `finalize`**:
  - flags: Dwarf → `Max "Dwarf Version"`; Pdb → `Warning "CodeView" 1`; then `Warning "Debug Info Version"`;
  - then `DIBuilderBox::new`;
  - then the fields in declaration order, so the stops come in the order `LLVMCreateDIBuilder`, then `TypeMap::default`.
- **gdb.rs**:
  - `insert_reference_to_gdb_debug_scripts_section_global` loads only when `needs_…` holds (`volatile_load(i8, g, Align::ONE)`);
  - `get_or_insert_…` builds the contents in upstream order (`\x01…py\0`, then each visualizer as `\x04`,
    `pretty-printer-{crate}-{index}\n`, src, `\0`). `collect_debugger_visualizers_transitive` returns a sorted array, so
    `entries()` gives `(index, v)` as upstream's `enumerate()` does. The setters run in upstream order and end with
    `LLVMSetAlignment(.., 1)`;
  - `needs_…` checks all seven crate types, then `debuginfo != None && emit_debug_gdb_scripts && embed`.
- **`debuginfo_finalize`**: when `dbg_cx` is present: `needs_…` → `get_or_insert_…`, then `dbg_cx.finalize()`.
- **metadata.rs**:
  - `build_global_var_di_node` returns on `dbg_cx.is_none()`, then on `debuginfo != Full`. Past that it calls, in order:
    `get_namespace_for_item`, `file_metadata_from_def_id`, `is_node_local_to_unit`, `DefKind::Static` (else `bug!()` with the
    default "impossible case reached"), returns if `nested`, then `type_di_node` and the `no_mangle` linkage-name rule, then
    `create_static_variable(Some(scope), …, None, Some(align))`.
  - `find_vtable_behind_cast` is exact.
  - `apply_vcall_visibility_metadata` returns early on `!vfe || lto != Fat`. The `match (lto, vis, single_cgu)` if-chain is in
    arm order, and I checked it exhaustive (`(No|ThinLocal, Restricted, true)` falls to `TranslationUnit`). It uses the
    unwrapped `trait_ref` for `typeid_for_trait_ref`, as upstream does (not `trait_ref_self`), and has `MD_type` then
    `MD_vcall_visibility`.
  - `create_vtable_di_node` has the same two early returns, then `set_unnamed_address(No)`,
    `compute_debuginfo_vtable_name` before `build_vtable_type_di_node`, and `create_static_variable(NO_SCOPE_METADATA, …, "",
    unknown_file_metadata, UNKNOWN_LINE_NUMBER, …, true, …, None, None)`.
- **DWARF constants**: checked against `~/.cargo/registry/src/index.crates.io-*/gimli-0.34.0/src/constants.rs` (`Cargo.lock`
  locks gimli at 0.31.1 and 0.34.0; rustc_codegen_llvm's `Cargo.toml` asks for `gimli = "0.34"`):

  | constant | value | line |
  |---|---|---|
  | `DW_TAG_const_type` | 0x26 | :252 |
  | `DW_LANG_Rust` | 0x1c | :896 |
  | `DW_ATE_boolean` | 0x02 | :767 |
  | `DW_ATE_float` | 0x04 | :769 |
  | `DW_ATE_signed` | 0x05 | :770 |
  | `DW_ATE_unsigned` | 0x07 | :772 |
  | `DW_ATE_UTF` | 0x10 | :785 |
  | `DW_OP_deref` | 0x06 | :1153 |
  | `DW_OP_plus_uconst` | 0x23 | :1181 |

  All nine match, and every cited line is right. Upstream writes the other six by hand, and the port keeps them:
  - `DW_OP_LLVM_fragment` 0x1000 (RustWrapper.cpp:75 asserts it);
  - `DW_OP_constu` 0x10, `DW_OP_minus` 0x1c, `DW_OP_mul` 0x1e, `DW_OP_bregx` 0x92 and `DW_OP_stack_value` 0x9f, which also
    equal gimli's values (:1162, :1174, :1176, :1292, :1305).

## 3. No guessed values
- **IR-model stops**: the 17 `LLVMDI*` / `LLVMRustDI*` fns the handoff lists are each `export const <name> = stub("<name>")` in
  `src/rust_ts/llvm/ffi.ts` (for example :960 `LLVMCreateDIBuilder`; I checked all 17). `trace.ts:18` `stub` is
  `unported(\`llir: ${name}\`)`, so they stop as `llir: <name>`. Test 3 confirms the first one is `llir: LLVMCreateDIBuilder`.
- **Cross-lane stops**: exactly 10 `unported(` in the lane's files:
  - 9 are `cg-di-a: …/debuginfo/metadata.rs <fn>`;
  - 1 is `cg-di-b: …/metadata/type_map.rs TypeMap::default`.

  These match the handoff and the plan-m7 §8 owners: wave 44 metadata.rs is `cg-di-a`'s, and metadata/* is `cg-di-b`'s.
  No ported fn returns a placeholder.
- **The decision to port four metadata.rs fns is justified**:
  - consts.ts:609 (`codegen_static`) calls `build_global_var_di_node` for every `static`;
  - ssa meth.ts:133-134 (`get_vtable`) calls `apply_vcall_visibility_metadata` and `create_vtable_debuginfo` for every vtable.

  As stubs, all three would stop every `-Cdebuginfo=0` compile with a static or a vtable. All three return before any wave-44
  callee, unless `-g` is on, or `-Zvirtual-function-elimination` with fat LTO. `find_vtable_behind_cast` is their shared
  helper. (See N5 on recording the decision.)

## 4. The headline result
- **Oracle regenerated.** I copied `names.rs` and `gdb.rs` into a scratch directory and ran the README's three commands there,
  from relative paths with `--remap-path-prefix=$PWD=.`, using `rustc +nightly-2026-10-11`
  (`6f5da406b56c2db6607202b63daee73aa8c61297`). All three outputs are **byte-identical** (`cmp`) to the committed
  `x86_64-unknown-linux-gnu{,.gdb,.gdb-g}.ll`. None holds an absolute path.
- **The comparison is real.** I made a temporary, reverted edit so test 1/2 wrote the port's printed module to scratch, then
  ran a full `diff` against the oracle for both fixtures. Every difference is one of:
  - comment lines (`; ModuleID`, `; Function Attrs:`, `; <demangled name>`, `; call …`) and `; preds` tails;
  - `!guid !N` on each define/global, and the `!{i64 …}` guid nodes. The oracle's `-Cno-prepopulate-passes` still runs
    assign-guid; this is the N1 normal form's handling;
  - metadata numbering (the port's `!0..!4` vs the oracle's `!2..!5, !11`).

  The module flags, `!llvm.ident` and the `!{}` behind `!invariant.load` / `!nonnull` have equal contents. Every instruction,
  value name, attribute group, global and declaration is equal. The test's `normal()` excuses exactly these, and the separate
  `module_flags()` check covers the flags. N2 is about what `normal()` drops without checking.
- **gdb global and volatile load:** test 4 compares the port's line, less `, !guid !N`, to the oracle's `.gdb-g.ll:6`
  (`linkonce_odr unnamed_addr constant [34 x i8] c"\01gdb_load_rust_pretty_printers.py\00", section ".debug_gdb_scripts",
  align 1`). It also compares the real `maybe_create_entry_wrapper` body of `@main` to the oracle's body, whose first
  instruction is `%2 = load volatile i8, ptr @__rustc_debug_gdb_scripts_section__, align 1`. Both match. The `-g` case uses a
  placeholder debug context, documented in the test header. At `-Cdebuginfo=0`, the full diff confirms that `@main` has no
  load and the module has no gdb global.

## 5. Tests
- **Mutation claims**: I re-ran three. Each reproduces the handoff's count, and each was reverted with `git checkout`:
  - `set_var_name` overwrites an existing name: 1 failing (names.rs module);
  - `lookup_debug_loc` without `+ 1`: 1 failing (the helpers test);
  - `fewer_names` inverted: 2 failing (both modules).
- **One guard is untested** (N1).
- `scripts/lib/unit-steps.test.ts`: 10 pass. The test reads only `RUST_TS_REQUIRE_PROBES` and `RUST_TS_AGENT`, and the port
  files read no environment variable.

## 6. Scope
`git diff --name-only 7b71d658..86e3b5cd` lists only:
- `src/rustc_codegen_llvm/debuginfo/**`, which includes the new `di_oracle/` fixtures;
- `src/rustc_codegen_llvm/skeleton.test.ts`;
- `docs/handoff/cg-di-a.md`.

The skeleton.test.ts change makes three edits:
- `cg-di-a` 21 → 9;
- a new `cg-di-b: 1`;
- the per-lane stop probe moves from `clear_dbg_loc` (now ported) to `metadata.type_di_node`.

These agree with the 9 + 1 stubs above.

## Findings

### F (must fix)
None.

### N (nits)
- **N1: `set_var_name`'s argument-or-instruction guard is untested.**
  - Where: `src/rustc_codegen_llvm/debuginfo/mod.ts:582-585`; upstream `mod.rs:601-606`.
  - What I saw: with `if (!param_or_inst) return;` deleted, mod.test.ts still passes 8/8. Dropping only the `LLVMIsAArgument`
    half does fail 2 tests.
  - Why it matters: upstream's point is to leave globals unrenamed. No fixture reaches `set_var_name` with a non-local value
    whose name is empty.
  - Fix: add a case to names.rs, such as a local bound to a constant or to an unnamed global, or a direct unit check that
    `set_var_name` leaves a global's empty name alone.
- **N2: the test's normal form drops all metadata except the module flags without comparing it.**
  - Where: `src/rustc_codegen_llvm/debuginfo/mod.test.ts:164-182` (`normal()` stops at the first `!` line).
  - What I saw: `!llvm.ident` and the contents of instruction-attached nodes are never compared. In these fixtures that means
    `!{}` behind `!invariant.load` / `!nonnull`. I checked by full diff that both are equal today.
  - Fix: compare the named metadata and the non-guid nodes after renumbering, so that a future `!range` or `!noundef` regression
    is caught.
- **N3: `DIBuilderBox::drop` has no call site, and the handoff misdescribes it.**
  - Where: `src/rustc_codegen_llvm/debuginfo/di_builder.ts:41`; upstream `di_builder.rs:31`.
  - Upstream: the drop is implicit when `cx` leaves scope at the end of `module_codegen`'s block (`base.rs:216`, right after
    `debuginfo_finalize`). `base.ts:112-211` never calls it. The handoff says "only metadata.rs calls" it (handoff:113), which
    is wrong.
  - Effect: none on output. `LLVMDisposeDIBuilder` changes no IR, and today it is unreachable behind `LLVMCreateDIBuilder`.
  - Fix: when llir-di lands, base.ts (another lane's file) should call `cx.dbg_cx?.builder.drop()` at the end of the block that
    matches base.rs:216, or carry a `PORT:` note saying why it doesn't. Root should queue this.
- **N4: an off-by-one line in a stub comment.**
  - Where: `src/rustc_codegen_llvm/debuginfo/metadata.ts:273` and handoff:141 both say `metadata.rs:1832` for
    `file_metadata_from_def_id`.
  - Upstream: the `fn` is at **1833**; line 1832 is blank. It is a comment, not a marker, so `coverage --check` cannot catch it.
- **N5: decision 1 (the partial port of metadata.rs) is not recorded.**
  - Where: `docs/state/history.jsonl` at `7b71d658` with `86e3b5cd` merged has no entry for it. The handoff asks root to record
    it.
  - Fix: root should record it at integration, if that hasn't already happened on root's branch.
- **N6: very large visualizer sources would overflow the call stack.**
  - Where: `src/rustc_codegen_llvm/debuginfo/gdb.ts:64`, `section_contents.push(...visualizer.src)`; upstream `gdb.rs:56`
    `extend_from_slice`.
  - What I saw: the line spreads a whole `#[debugger_visualizer(gdb_script_file = …)]` source as call arguments. In Bun, a
    1,000,000-byte spread throws `RangeError: Maximum call stack size exceeded`; 200,000 bytes still works.
  - Effect: an ICE where upstream succeeds, but only with `-g` and a script of about 1 MB. No fixture or suite comes close.
  - Fix: a loop or `for…of` push, or build a `Uint8Array` directly.
