verdict: APPROVE-WITH-NOTES

Reviewer: independent review of `lane/symbol-export-metadata`, own commit 9ac50bb6 only (after merge 2888921d),
against upstream `compiler/rustc_codegen_ssa/src/back/symbol_export.rs` and `base.rs:695` at the pin.

## What was checked
- Every fn in symbol_export.ts against upstream, in order, line by line. All 29 markers point at the right `fn` lines.
  `coverage.ts --missing` gives 29/29 and `coverage.ts --check` reports "markers ok". No `unported(...)` is left in the
  file.
- New in this commit, all faithful to upstream:
  - `reachable_non_generics_helper`: FFI/static-lib filter, the `DefKind` arms with the const-always guard first,
    `requires_monomorphization`, `requires_inline`, `cross_crate_inlinable`, the export level/kind/used/
    rustc_std_internal_symbol flags, and the proc-macro decls static;
  - `exported_non_generic_symbols_helper`: DefPathHash-sorted, then TLS shims, foreign-item aliases, the entry name,
    offload kernels, and a stable cached-key sort;
  - the mono-item loop of `exported_generic_symbols_provider_local`: linkage/visibility/share-generics/inline(never)
    gates, and the Item / DropGlue(Some) / AsyncDropGlueCtor / AsyncDropGlue arms;
  - `allocator_shim_symbols`, `symbol_export_level` (the emscripten static case);
  - `symbol_name_for_instance_in_crate` (all 7 variants);
  - `calling_convention_for_symbol`: the static guard arm comes first, and the bug text is the same;
  - `linking_symbol_name_for_instance_in_crate`: the X86/X86_64/Arm64EC-if-Text prefix; Fastcall/Stdcall/Vectorcall
    decoration; the `_` arm inserts the prefix; args rounded up with `next_multiple_of(pointer_width/8)`;
  - `exporting_symbol_name_for_instance_in_crate`, `strip_numeric_suffix`, `coff_machine_for_arch`,
    `undecorate_coff_symbol` (every machine arm, including the ARM64EC kind guard falling to `_`),
    `extend_exported_symbols`, `maybe_emutls_symbol_name`, `escape_symbol_name`.
- The TS types these depend on:
  - `CanonAbi::X86(X86Call)`, `TargetSpecOther` `Arch`/`Os` (`$` tags `X86`, `X86_64`, `Arm64EC`, `Nvptx64`, `AmdHsa`),
    and `Constness { $: "Const", always }`;
  - mono `Visibility` (declared in codegen_fn_attrs.ts), `Linkage` and `InlineAttr`;
  - `ShimKind` field positions;
  - `DefPathHash` is a bigint, so `<` is the Fingerprint order, the same as the existing writeback.ts helper;
  - `str_cmp` compares code points, which is the same as byte order for `SymbolName`'s `&str` `Ord`;
  - `span_fatal` returns `never`.
- `parse_u32_is_ok` matches `u32::from_str`: an optional `+`, at least one digit, no `-`, and an overflow check.
  `rsplit_once` / `strip_prefix` match Rust.
- `allocator_shim_contents` (base.ts) against base.rs:695: the `Default` kind extends with `ALLOCATOR_METHODS`; it
  does `unwrap()` on `alloc_error_handler_kind` with core's `Option::unwrap` text; the handler method has
  `special: None`, input `layout: Layout` and output `Never`. Correct.
- `object::pe` constants checked against `~/.cargo/registry/.../object-0.39.1/src/pe.rs`:
  - `IMAGE_FILE_MACHINE_I386 = 0x014c` (:310);
  - `IMAGE_FILE_MACHINE_AMD64 = 0x8664` (:359);
  - `IMAGE_FILE_MACHINE_ARM64EC = 0xA641` (:365).

  All three match, and so do the cited lines. rustc_codegen_ssa's Cargo.toml pins object 0.39.1, so this is the right
  version.
- `tls_model` workaround: upstream `Session` derefs to `EarlySession` (session.rs:563), and `EarlySession::tls_model`
  (session.ts:150, marker :370) is ported. `Target.tls_model` is a real field (spec/mod.ts:3104), so
  `tcx.sess.early_sess.tls_model()` is behaviourally identical to upstream.
- Nothing under `harness/`, `scripts/`, `tools/` or `harness/baseline` changed.
- The only edit outside the assigned files is `compare_impl_item.oracle.test.ts`, which re-pins refine_rpitit's
  PENDING stop. The handoff justifies it. The new stop string exists verbatim at encoder.ts:2946, and the test passes.
- Ran in a scratch worktree (now removed):
  - `bunx tsc --noEmit -p .`: clean;
  - `RUST_TS_REQUIRE_PROBES=1 bun test symbol_export.oracle.test.ts`: 1 pass;
  - `compare_impl_item.oracle.test.ts`: 43 pass;
  - `difftest --suite borrowck-ui --sample 40` (agent rev-sem): MATCH 40/40.

  The handoff's six run directories exist.
- Sample claims are plausible, and there is a structural reason no MATCH can be lost:
  - every code path added here replaced an `unported(...)` body, so no protected (MATCH) case could have reached it
    before;
  - the `--emit=metadata` providers still return before the helpers;
  - the new value imports (`../base.ts`, `../lib.ts`) are used only inside fn bodies, so the import cycle with
    linker.ts → symbol_export.ts is safe at module load.

## Findings

1. src/rustc_codegen_ssa/back/symbol_export.ts:364 (`is_instantiable_downstream`), **non-blocking**.
   - **Upstream:** `generic_args.types().chain(did.map(|did| tcx.type_of(did).skip_binder())).all(..)` is lazy. It
     calls `type_of(did)` only if every generic type argument passed, and `all` stops at the first local type.
   - **Port:** builds the array eagerly, so `tcx.type_of(did)` is always called when `did` is `Some`, and every
     `walk()` is materialized before checking.
   - **Effect:** `type_of` is a cached query, and on a mono item's fn `DefId` it normally emits nothing, so outputs
     should be unaffected. It is still an evaluation-order divergence in query calls (upstream's own comment treats
     the `type_of` call as something to avoid).
   - **Suggested fix (when convenient):** a short-circuiting loop: types first, then `type_of` only if all passed.

2. src/rustc_codegen_ssa/back/symbol_export.ts:1007 (`assert_first_non_erasable_is_type`), **non-blocking**.
   - The `assert_eq!` panic message omits core's `left: ..` / `right: ..` lines because `Option<GenericArgKind>` has no
     Debug here.
   - This is ICE-only text on a sanity check, and it is documented as a `// PORT:`.
   - Someone should fix it once a Debug for `GenericArgKind` exists, so the ICE text matches.

3. src/rustc_codegen_ssa/back/symbol_export.oracle.test.ts:122-127, **non-blocking** (test strength, not
   correctness). The oracle is sound for what it checks. The names in the linker version script are exactly the
   non-generic exports for this `#![no_core]` crate, because no generics are instantiated and there are no upstream
   crates. The guard counts (9 / 2) stop it passing vacuously. But:
   - (a) Both sides are sorted, so the test does not check the `sort_by_cached_key` order of
     `exported_non_generic_symbols`. That order is what the metadata encoder will serialize, so byte-identity of rmeta
     is still unverified.
   - (b) The port-side filter is `is_below_threshold` only. linker.rs:1787 also admits `|| info.used` (and excludes
     compiler_builtins). That is harmless for this crate, which has no `#[used]`, but it is not a full mirror.
   - (c) Only the `NonGeneric` / local-crate naming path is exercised. The generic loop, the upstream-crate naming
     branch and the Windows decoration path have no oracle coverage. They are unreachable until rustc_monomorphize
     (M7), so this is acceptable for now.

   A follow-up should compare the unsorted order against an oracle rmeta dump once
   `encode_ExportedSymbol_SymbolExportInfo` is ported.

4. src/rustc_codegen_ssa/back/symbol_export.ts:908 (`maybe_emutls_symbol_name`), **non-blocking**.
   `tcx.sess.early_sess.tls_model()` is correct; see above. As the handoff suggests, root should add a
   `Session.tls_model()` forward in session.ts, next to the existing `relocation_model` / `code_model` forwards. Then
   the call site can read `tcx.sess.tls_model()` as upstream does.

5. src/rustc_codegen_ssa/back/symbol_export.ts:986 (`to_sorted_by_def_path_hash`), **non-blocking**.
   - The local helper duplicates rustc_hir_typeck/writeback.ts's helper of the same name; this one is keyed by `DefId`
     instead of `LocalDefId`.
   - It is consistent with the recorded precedent and fine for a port lane that may not edit shared files.
   - Root may want to hoist a shared `UnordMap::to_sorted` over `DefId` keys later.
