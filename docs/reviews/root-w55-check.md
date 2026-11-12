# Independent check of root's integration commits on `integ-w55` (wave 40o)

Reviewer: independent, read-only on code. Tree: this worktree merged with `1abfdf09` (`git merge --no-edit 1abfdf09`).
Scope: root's own changes only. Those are `ae4e2b7d` (wire ssa-debuginfo), `7565c468` (wire ssa-write), the `155d6af4` merge
(cg-write wired to ssa-write), the `c2aa527c` merge (llir-folder, `abi_consts.test.ts` conflict) and `1abfdf09` (LLVM
manifest). The merges were read with `git show --remerge-diff`. Upstream was read under `$RUST_TS_DATA/rust`.

## Verdict: **APPROVE WITH NITS**

Every repointed site resolves to the same upstream function, with the same receiver and arguments. The `join` panic text is
exact. The `.deref()` is right. No `ssa-write`, `ssa-debuginfo` or `rustc_middle` stop is left in either crate. Load order is
clean. The binaries' startup set is unchanged. The test edits derive from upstream. All seven manifest hashes check out
independently. tsc, the coverage check and the unit tests pass. The findings are stale comments, one wrong line citation and
dead imports. None of them changes behaviour.

## Findings

1. **nit: wrong upstream line in the new test comment** (`src/rustc_codegen_ssa/mir/mir_rest.test.ts:374`). The comment says
   `StorageLive` of `_4` "emits nothing (statement.rs:62)". The `StorageLive` arm is at statement.rs:73. Line 62 is the
   projection-place `codegen_place` that the comment at `:319` cites, so `:374` looks copied from there. The same test cites
   `:73-86` at `:302`. The assertion itself is right (Q3).
2. **nit: stale "stub" wording and unused `unported` imports now that the last stubs are gone.** After `ae4e2b7d`, none of
   `mod.ts`'s `xlane`, `block.ts`'s `block_xlane` or `statement.ts`'s `stmt_xlane` stops any more:
   - `src/rustc_codegen_ssa/mir/mod.ts:893` and `src/rustc_codegen_ssa/mir/block.ts:2697` still say each entry "stops with
     `unported`";
   - `src/rustc_codegen_ssa/mir/block.ts:19-20` (header) still says the table holds typed stubs that stop;
   - `src/rustc_codegen_ssa/mir/statement.ts:56` still says "The stubs and forwarders above".

   `unported` is imported but never called in `mod.ts:65`, `block.ts:87` and `statement.ts:18` (the only remaining mentions
   are comments). The section titles "Cross-lane stubs" (`mod.ts:892`, `block.ts:2696`) are stale too.
3. **nit: dead type imports left when the views were removed.**
   - `src/rustc_codegen_ssa/back/lto.ts:11` `import type { Lto }`: it was used only by the deleted `CodegenContext_lto_fields`.
   - `src/rustc_codegen_llvm/back/write.ts:25` `type AutoDiff`: it was used only by the deleted `ModuleConfigFields`.

   tsc does not flag either (no `noUnusedLocals`).
4. **info: debuginfo.ts still describes the placeholders root removed** (`src/rustc_codegen_ssa/mir/debuginfo.ts:10-13`, `:285-299`).
   - The header and the PORT above the `declare module` aliases say mod.ts holds opaque placeholders "until root replaces them".
   - `dctx` and `per_local` now cast a type to itself.

   The ssa-debuginfo handoff (§"Stub sites" 1) says these are harmless and can stay, and they are. The comments are wrong now,
   though, so they are worth a follow-up line in a fixer lane.
5. **info: `src/rustc_codegen_ssa/mir/place.ts:45` `unported("ssa-operand-place: ...")`** is the only `unported("ssa-...")` left
   in `rustc_codegen_ssa`. It is not a cross-lane stub. ssa-operand-place has landed, and this is a deliberate stop for a
   caller that passed no backend `Debug` impl. It is outside this check and needs no action from root.
6. **info: `cgcx_` / `config_` kept as identities** (`src/rustc_codegen_llvm/back/write.ts:1374`ff), as are the exported
   forwarders (`ModuleConfig_bitcode_needed`, `SharedEmitter_*`, `OutputFilenames_*`). The PORT block documents them, and
   `write.test.ts` still spies on the forwarders. Harmless. Inlining them is a possible later cleanup, not a fidelity issue.

## Q1: are the repointed sites faithful?

**`ae4e2b7d` (ssa-debuginfo).**
- **mod.ts.** `install_FunctionCx_debuginfo(FunctionCx)` is called last, after `install_FunctionCx_retag`, as the handoff asked.
  The placeholders become `export type { ConstDebugInfo, FunctionDebugContext, PerLocalVarDebugInfo } from "./debuginfo.ts"`,
  with the same type parameters.
- **mod.ts `xlane`.** `fill_function_debug_context(bx)`, `compute_per_local_var_debug_info(bx)` and
  `debug_introduce_locals(bx, consts)` match upstream mod.rs:278, :281 and :366 (callers at mod.ts:437, :439, :532,
  `consts_debug_info ?? []` = `unwrap_or_default()`). Signatures match debuginfo.rs:736, :554 and :531.
- **block.ts `block_xlane`.** `set_debug_loc(bx, source_info)` (debuginfo.rs:221), `debug_introduce_local(bx, local)` (:310)
  and `codegen_stmt_debuginfos(bx, debuginfos)` (:722) forward with the same receiver and arguments. block.ts already passes
  a slice.
- **statement.ts.** Upstream statement.rs:13 is `self.codegen_stmt_debuginfos(bx, &statement.debuginfos)`. That auto-derefs
  `&StmtDebugInfos` to `&[StmtDebugInfo]` through `impl Deref for StmtDebugInfos` (rustc_middle mir/statement.rs:1133, `self.as_slice()`).
  The TS `debuginfos.deref()` calls that ported impl (`rustc_middle/mir/statement.ts:1550`), so the forwarder is faithful.
  The other two forwarders pass `source_info` / `local` unchanged.

**`7565c468` (ssa-write).**
- **base.ts `ssa_write`.** All nine entries match upstream base.rs:767-915 and write.ts's ports:
  - `ModuleConfig.new(kind, tcx, no_builtins)`;
  - `self.bitcode_needed()`;
  - `start_async_codegen(backend, tcx, regular, allocator, allocator_module)`;
  - `wait_for_signal_to_codegen_item()`, `check_for_errors(sess)` and `codegen_finished(tcx)` on the `OngoingCodegen`;
  - `submit_codegened_module_to_llvm(coordinator, module, cost)`, `submit_pre_lto_module_to_llvm(tcx, coordinator, module)`
    and `submit_post_lto_module_to_llvm(coordinator, module)`, in write.rs:2199, :2216 and :2208's argument orders.

  The placeholders are gone, and `codegen_crate` returns `OngoingCodegen<W>`. `lazy_write` follows the existing `lazy_meth`
  pattern (a `var` cache plus a literal `require`).
- **lib.ts `into_compiled_module`.** It calls `outputs.temp_path_for_cgu(Object|Bitcode|Assembly|LlvmAssembly, name)` and
  `outputs.temp_path_dwo_for_cgu(name)`, matching rustc_codegen_ssa lib.rs:100-106.
- **lto.ts `check_lto_allowed`.** It now reads `CodegenContext`'s `lto`, `crate_types`, `dylib_lto` and `prefer_dynamic`
  directly. The body is unchanged.
- **llvm_backend.ts.**
  - `optimize_and_codegen_fat_lto`: `DiagCtxt.new(shared_emitter.clone())` + `.handle()` = rs:114-115, and
    `write.codegen(..., cgcx.module_config)` = rs:118.
  - `ModuleLlvm::parse`: `LLVMContextSetDiscardValueNames(llcx, to_llvm_bool(cgcx.fewer_names))` = rs:471, and
    `tm_factory(dcx, TargetMachineFactoryConfig.new(cgcx, name))` = rs:473 (`name.to_str().unwrap()`; `name` is already a
    `string`).
- **The `join` downcast.** rs:368-371 is
  `ongoing_codegen.downcast::<OngoingCodegen<LlvmCodegenBackend>>().expect("Expected LlvmCodegenBackend's OngoingCodegen, found Box<Any>").join(sess, incr_comp_session, crate_info)`.
  - `Result::expect` calls `unwrap_failed(msg, &e)`, which is `panic!("{msg}: {error:?}")` (library/core/src/result.rs:1184, :1865).
  - The `Err` value is the `Box<dyn Any>`. Its Debug delegates to `impl Debug for dyn Any`, which is
    `debug_struct("Any").finish_non_exhaustive()` = `Any { .. }` (library/core/src/any.rs:153).
  - So the text is `Expected LlvmCodegenBackend's OngoingCodegen, found Box<Any>: Any { .. }`, which is exactly the TS
    `panic(...)` string.

  `instanceof OngoingCodegen` cannot check the type argument; that is unavoidable, and the comment states the upstream form.
  `join`'s arguments match.

**`155d6af4` (cg-write merged and wired to ssa-write).**
- The views and local copies (`EmitObj`, `EmitObj_eq`, `ModuleConfigFields`, `CodegenContextFields`, `InlineAsmError`) are
  removed in favour of ssa-write's exports.
- The eight exported stubs forward:
  - `config.bitcode_needed()`, `config.embed_bitcode()`, `shared_emitter.clone()` (a `SharedEmitter` is an `Emitter`) and
    `shared_emitter.inline_asm_error(err)`;
  - the rustc_session `temp_path_for_cgu`, `temp_path_dwo_for_cgu`, `temp_path_ext_for_cgu` and `split_dwarf_path`, with
    unchanged argument orders (config.rs:1315, :1321, :1334, :1374).

**Remaining stops.** Searching `src/rustc_codegen_ssa/` and `src/rustc_codegen_llvm/` (non-test) for `unported("ssa-`,
`unported("ssa-write`, `unported("ssa-debuginfo` and `unported("rustc_middle` finds only `place.ts:45` (finding 5). I also
checked the template-literal stops (`` unported(` ``): none names ssa-write, ssa-debuginfo or rustc_middle.

## Q2: load order

**Fresh `bun -e`, each module loaded first, then mod.ts.** The modules were `mir/mod.ts`, `mir/debuginfo.ts`, `mir/statement.ts`,
`mir/block.ts`, `base.ts`, `back/write.ts` and `lib.ts`. Each loads without error. All 69 `FunctionCx.prototype.<m> =`
methods from the `install_FunctionCx_*` functions under `mir/` are functions every time (`missing 0`).

**rustc_codegen_llvm.** `lib.ts`, `base.ts`, `context.ts`, `back/llvm_backend.ts` and `back/write.ts`, each loaded first in a
fresh process, all load.

**Startup set.** I ran `subjectBinKey(buildSpec(entry))` from `scripts/lib/subject-bin.ts` on this tree for both binary
entries:

| Entry | Inputs | Same as the w40n gate's build? | Notable files |
|---|---|---|---|
| `main.ts` | 2114 | yes, path for path (`meta.json` of 2026-11-12T15:06Z): nothing added, nothing removed | not inputs: `rustc_codegen_ssa/back/write.ts`, `mir/mod.ts`, `mir/debuginfo.ts`, `rustc_codegen_llvm/back/llvm_backend.ts` |
| `miri.ts` | 2301 | yes, path for path: nothing added, nothing removed | not inputs: the same four files |

So the lazy `require("./back/write.ts")` in base.ts sits only behind the not-yet-live `codegen_crate` path and is
tree-shaken, as w40n-audit N5 found for `lazy_mir*` / `lazy_meth`. Root's commit message says lib.ts is in both startup
sets, and leaving out the debuginfo re-export keeps the set unchanged.

## Q3: test edits

**`mir_rest.test.ts`.** The run is `codegen_statement(stmts[0] = StorageLive(_4))` with the real debuginfo.rs and
`fx.debug_context === undefined`:
- statement.rs:13 `codegen_stmt_debuginfos(&statement.debuginfos)` loops over the slice (debuginfo.rs:722). It emits no
  builder call: `mir_built` has no stmt debuginfos, and with no debug context the per-local paths return early anyway.
- statement.rs:14 `set_debug_loc` calls `bx.set_span(span)`. Then `dbg_loc` returns `None`, because
  `adjusted_span_and_dbg_scope` does `self.debug_context.as_ref()?` (debuginfo.rs:221-240), so there is no `set_dbg_loc`.
- `StorageLive(_4)` (statement.rs:73) acts only on `Place` / `UnsizedPlace`. `_4` is `PendingOperand` in the test's locals,
  or `Operand` after `run(1)`, so the arm emits nothing.

Expected log: exactly one `set_span(...)` entry, which is what the test asserts. Correct, apart from the citation (finding 1).

**`write.test.ts`.** Upstream `codegen` ends with `module.into_compiled_module(config.emit_obj != EmitObj::None, dwarf_object_emitted, config.emit_bc, config.emit_asm, config.emit_ir, &cgcx.output_filenames)`
(rustc_codegen_llvm back/write.rs:1145). The test config has `emit_obj: None`, `emit_bc: false`, `emit_asm: false` and
`emit_ir: true`. `into_compiled_module` (rustc_codegen_ssa lib.rs:91-117) therefore gives:
- `object`, `bytecode` and `assembly` = `None`;
- `llvm_ir` = `outputs.temp_path_for_cgu(LlvmAssembly, name)`.

`out_path` comes from the test's own line-by-line copy of `temp_path_for_cgu`, while the port goes through rustc_session's
method (not the spied forwarder). So `compiled.llvm_ir === out_path` really compares the two. `stop` is `undefined` because
nothing stops any more. The test passes.

**`abi_consts.test.ts` (c2aa527c).** The resolution keeps llir-folder's `expect(stops).toEqual([])`
(`LLVMRustGetElementTypeArgIndex` is real now). It also keeps fixers-55's `const port_groups = attr_groups(text)`, which the
`canon_sig(..., port_groups)` loop below uses. Both intents are kept, and the test passes.

**`skeleton.test.ts`.** I counted `unported("<lane>:` in the non-test `.ts` files under `src/rustc_codegen_llvm/` myself:

| Lane | Count |
|---|---|
| cg-asm | 4 |
| cg-di-a | 21 |
| cg-intrinsic-b | 2 |
| cg-lto-diag | 12 |
| excluded (plan-m7 D18) | 17 |
| llir | 5 |
| rustc_codegen_llvm | 8 |
| rustc_data_structures | 4 |
| rustc_fs_util | 1 |
| rustc_sanitizers | 5 |
| rustc_session | 1 |

That equals `EXPECTED`. There is no `ssa-write` or `rustc_middle` entry, matching the remerge resolution (ssa-write 13 → 0
once cg-write's eight stubs forward; rustc_middle dropped by stable-hash-alloc). The three template-literal stops the count
skips are `rustc_sanitizers` ×2 and the `assert_matches!` message, as the table comment says.

## Q4: manifest

`bun scripts/llvm-src.ts check` gives `llvm-src ok: 75 files at aab11ee0ea5e (the checkout's gitlink)`.
`git -C $RUST_TS_DATA/rust ls-tree HEAD src/llvm-project` = `aab11ee0ea5ea9a1d462ad0bc1fae9d9bb643019`.

I checked the seven new paths independently: `shasum -a 256` of the cached files, and of the same paths fetched fresh from
`raw.githubusercontent.com/rust-lang/llvm-project/aab11ee0ea5e…/` (public LLVM sources only). Both match the manifest:

| Path | SHA-256 prefix |
|---|---|
| `ADT/APInt.h` | `b774dec5…` |
| `IR/Attributes.h` | `3ce44b4d…` |
| `IR/CallingConv.h` | `6c6ffa10…` |
| `IR/DataLayout.h` | `7bb32391…` |
| `IR/IntrinsicsARM.td` | `5c9d58bc…` |
| `IR/Operator.h` | `cf03b2cf…` |
| `lib/IR/ConstantRange.cpp` | `7e1a386e…` |

`coverage.ts --check` accepts all 429 `// llvm:` markers.

## Q5: no `debuginfo` re-export in lib.ts

Faithful enough. Upstream lib.rs:44-56 declares 13 `pub mod`s. The TS lib.ts re-exports only `codegen_attrs` and
`target_features`. `back`, `base`, `mir`, `traits`, `common` and the rest are imported by path, as everywhere in the port. So
leaving out `debuginfo` follows the existing convention; it is not a new gap.

Nothing needs the re-export. No file outside `src/rustc_codegen_ssa/debuginfo/` imports `rustc_codegen_ssa/debuginfo/*`
(only `mir/debuginfo.test.ts` and type_names.ts itself reference them). cg_llvm's `debuginfo/mod.ts` imports are its own
crate's. When a cg-di lane needs `type_names`, a direct path import is enough.

## Q6: commands

The machine was **on battery** (`pmset`: "Battery Power", 99%). That is fine for these unit runs, which are not a gate.

| Command | Result |
|---|---|
| `bunx tsc --noEmit -p .` | exit 0, no output |
| `bun scripts/coverage.ts --check --offline` | `markers ok (26758, 46 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 745; llvm 429)` |
| `bun test ./src/rustc_codegen_ssa/ ./src/rustc_codegen_llvm/ ./src/rust_ts/llvm/ ./src/rustc_session/ ./src/rustc_middle/ ./scripts/lib/unit-steps.test.ts` (`RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`) | `872 pass, 0 fail, 72275 expect() calls, 89 files, 106.29s`, no skips |
| `bun scripts/llvm-src.ts check` | ok, 75 files |
