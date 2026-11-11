// Port of compiler/rustc_codegen_llvm/src/llvm/metadata_kind.rs (lane cg-contract).
//
// PORT (cg-contract): `#[repr(transparent)] struct MetadataKindId(c_uint)` is the contract's branded number
// (src/rust_ts/llvm/support.ts `MetadataKindId`, which ffi.ts's signatures use), so it is not declared again here.
// `declare_fixed_metadata_kinds!` expands to one `pub(crate) const` per kind, written out below in the macro's order.
import type { MetadataKindId } from "../../rust_ts/llvm/ffi.ts";

// pub(crate) use self::fixed_kinds::*;

const id = (value: number): MetadataKindId => value as MetadataKindId;

// Must be kept in sync with the corresponding static assertions in `RustWrapper.cpp`.
// declare_fixed_metadata_kinds! {
export const MD_dbg: MetadataKindId = id(0);
export const MD_tbaa: MetadataKindId = id(1);
export const MD_prof: MetadataKindId = id(2);
export const MD_fpmath: MetadataKindId = id(3);
export const MD_range: MetadataKindId = id(4);
export const MD_tbaa_struct: MetadataKindId = id(5);
export const MD_invariant_load: MetadataKindId = id(6);
export const MD_alias_scope: MetadataKindId = id(7);
export const MD_noalias: MetadataKindId = id(8);
export const MD_nontemporal: MetadataKindId = id(9);
export const MD_mem_parallel_loop_access: MetadataKindId = id(10);
export const MD_nonnull: MetadataKindId = id(11);
export const MD_dereferenceable: MetadataKindId = id(12);
export const MD_dereferenceable_or_null: MetadataKindId = id(13);
export const MD_make_implicit: MetadataKindId = id(14);
export const MD_unpredictable: MetadataKindId = id(15);
export const MD_invariant_group: MetadataKindId = id(16);
export const MD_align: MetadataKindId = id(17);
export const MD_loop: MetadataKindId = id(18);
export const MD_type: MetadataKindId = id(19);
export const MD_section_prefix: MetadataKindId = id(20);
export const MD_absolute_symbol: MetadataKindId = id(21);
export const MD_associated: MetadataKindId = id(22);
export const MD_callees: MetadataKindId = id(23);
export const MD_irr_loop: MetadataKindId = id(24);
export const MD_access_group: MetadataKindId = id(25);
export const MD_callback: MetadataKindId = id(26);
export const MD_preserve_access_index: MetadataKindId = id(27);
export const MD_vcall_visibility: MetadataKindId = id(28);
export const MD_noundef: MetadataKindId = id(29);
export const MD_annotation: MetadataKindId = id(30);
export const MD_nosanitize: MetadataKindId = id(31);
export const MD_func_sanitize: MetadataKindId = id(32);
export const MD_exclude: MetadataKindId = id(33);
export const MD_memprof: MetadataKindId = id(34);
export const MD_callsite: MetadataKindId = id(35);
export const MD_kcfi_type: MetadataKindId = id(36);
export const MD_pcsections: MetadataKindId = id(37);
export const MD_DIAssignID: MetadataKindId = id(38);
export const MD_coro_outside_frame: MetadataKindId = id(39);
export const MD_mmra: MetadataKindId = id(40);
export const MD_noalias_addrspace: MetadataKindId = id(41);
// }
