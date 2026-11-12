// Port of compiler/rustc_codegen_ssa/src/meth.rs (lane ssa-mir-rest, plan-m7 wave 41).
//
// Conventions (ssa-contract, docs/handoff/ssa-contract.md): `Bx: BuilderMethods<'a, 'tcx>` is `BuilderMethods<B>`,
// `Cx: CodegenMethods<'tcx>` is `CodegenMethods<B>`, `Bx::Value` is `B["Value"]`. `debug!` and
// `#[instrument(level = "debug")]` are compiled out of rustc (STATIC_MAX_LEVEL = INFO, rust_ts/tracing.ts) and stay comments.
import { GlobalAlloc } from "../rustc_middle/mir/interpret/mod.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Ty } from "../rustc_middle/ty/decls.ts";
import { debug_Ty } from "../rustc_middle/ty/structural_impls.ts";
import "../rustc_middle/ty/fold.ts";
import { bug } from "../rustc_span/macros.ts";
import { typeid_for_trait_ref } from "../rustc_symbol_mangling/lib.ts";
import type { FnAbi } from "../rustc_target/callconv/mod.ts";
import {
  type ExistentialTraitRef,
  fold_with_ExistentialTraitRef,
  try_fold_with_ExistentialTraitRef,
  visit_with_ExistentialTraitRef,
} from "../rustc_type_ir/predicate.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import { type Debug, debug_tuple, PLAIN } from "../std/fmt.ts";
import type { BackendTypes } from "./traits/backend.ts";
import type { BuilderMethods } from "./traits/builder.ts";
import type { CodegenMethods } from "./traits/mod.ts";

// #[derive(Copy, Clone, Debug)]
// PORT: the `u64` index is a `number` (a vtable slot index, far below 2^53; PORTING §5).
export class VirtualIndex {
  constructor(readonly _0: number) {}

  // ---- impl<'a, 'tcx> VirtualIndex ----

  // rustc: compiler/rustc_codegen_ssa/src/meth.rs:14 from_index
  static from_index(index: number): VirtualIndex {
    return new VirtualIndex(index);
  }

  // rustc: compiler/rustc_codegen_ssa/src/meth.rs:18 get_fn_inner
  private get_fn_inner<B extends BackendTypes>(
    bx: BuilderMethods<B>,
    llvtable: B["Value"],
    ty: Ty,
    fn_abi: FnAbi<Ty>,
    nonnull: boolean,
  ): B["Value"] {
    // Load the function pointer from the object.
    // debug!("get_fn({llvtable:?}, {ty:?}, {self:?})");

    const llty = bx.fn_ptr_backend_type(fn_abi);
    const ptr_size = bx.data_layout().pointer_size();
    const vtable_byte_offset = this._0 * ptr_size.bytes();

    return load_vtable(bx, llvtable, llty, vtable_byte_offset, ty, nonnull);
  }

  // rustc: compiler/rustc_codegen_ssa/src/meth.rs:36 get_optional_fn
  get_optional_fn<B extends BackendTypes>(bx: BuilderMethods<B>, llvtable: B["Value"], ty: Ty, fn_abi: FnAbi<Ty>): B["Value"] {
    return this.get_fn_inner(bx, llvtable, ty, fn_abi, false);
  }

  // rustc: compiler/rustc_codegen_ssa/src/meth.rs:46 get_fn
  get_fn<B extends BackendTypes>(bx: BuilderMethods<B>, llvtable: B["Value"], ty: Ty, fn_abi: FnAbi<Ty>): B["Value"] {
    return this.get_fn_inner(bx, llvtable, ty, fn_abi, true);
  }

  // rustc: compiler/rustc_codegen_ssa/src/meth.rs:56 get_usize
  get_usize<B extends BackendTypes>(bx: BuilderMethods<B>, llvtable: B["Value"], ty: Ty): B["Value"] {
    // Load the data pointer from the object.
    // debug!("get_int({:?}, {:?})", llvtable, self);

    const llty = bx.type_isize();
    const ptr_size = bx.data_layout().pointer_size();
    const vtable_byte_offset = this._0 * ptr_size.bytes();

    return load_vtable(bx, llvtable, llty, vtable_byte_offset, ty, false);
  }
}
/** `#[derive(Debug)]` */
export const debug_VirtualIndex: Debug<VirtualIndex> = (v, f) => debug_tuple(f, "VirtualIndex", [String(v._0)]);

/** `TypeFoldable` of `ExistentialTraitRef`, for `instantiate_bound_regions_with_erased` (rustc_codegen_llvm common.ts's form). */
const d_ExistentialTraitRef: TypeFoldable<ExistentialTraitRef> = {
  visit_with: visit_with_ExistentialTraitRef,
  try_fold_with: try_fold_with_ExistentialTraitRef,
  fold_with: fold_with_ExistentialTraitRef,
};

/// This takes a valid `self` receiver type and extracts the principal trait
/// ref of the type. Return `None` if there is no principal trait.
// rustc: compiler/rustc_codegen_ssa/src/meth.rs:75 dyn_trait_in_self
function dyn_trait_in_self(tcx: TyCtxt, ty: Ty): ExistentialTraitRef | undefined {
  for (const arg of ty.peel_refs().walk()) {
    const k = GenericArg.kind(arg);
    if (k.$ === "Type") {
      const kind = k._0.kind();
      if (kind.$ === "Dynamic") {
        const data = kind._0;
        // FIXME(arbitrary_self_types): This is likely broken for receivers which
        // have a "non-self" trait objects as a generic argument.
        const principal = data.principal();
        return principal !== undefined ? tcx.instantiate_bound_regions_with_erased(principal, d_ExistentialTraitRef) : undefined;
      }
    }
  }

  return bug(`expected a \`dyn Trait\` ty, found ${debug_Ty(ty, PLAIN)}`);
}

/// Creates a dynamic vtable for the given type and vtable origin.
/// This is used only for objects.
///
/// The vtables are cached instead of created on every call.
///
/// The `trait_ref` encodes the erased self type. Hence if we are
/// making an object `Foo<dyn Trait>` from a value of type `Foo<T>`, then
/// `trait_ref` would map `T: Trait`.
// #[instrument(level = "debug", skip(cx))]
// rustc: compiler/rustc_codegen_ssa/src/meth.rs:103 get_vtable
export function get_vtable<B extends BackendTypes>(cx: CodegenMethods<B>, ty: Ty, trait_ref: ExistentialTraitRef | undefined): B["Value"] {
  const tcx = cx.tcx_();

  // Check the cache.
  const val = cx.vtables().get([ty, trait_ref]);
  if (val !== undefined) {
    return val;
  }

  const vtable_alloc_id = tcx.vtable_allocation([ty, trait_ref]);
  const vtable_allocation = GlobalAlloc.unwrap_memory(tcx.global_alloc(vtable_alloc_id));
  const vtable = cx.static_addr_of(vtable_allocation, "vtable");

  cx.apply_vcall_visibility_metadata(ty, trait_ref, vtable);
  cx.create_vtable_debuginfo(ty, trait_ref, vtable);
  cx.vtables().set([ty, trait_ref], vtable);
  return vtable;
}

/// Call this function whenever you need to load a vtable.
// rustc: compiler/rustc_codegen_ssa/src/meth.rs:126 load_vtable
export function load_vtable<B extends BackendTypes>(
  bx: BuilderMethods<B>,
  llvtable: B["Value"],
  llty: B["Type"],
  vtable_byte_offset: number,
  ty: Ty,
  nonnull: boolean,
): B["Value"] {
  const ptr_align = bx.data_layout().pointer_align().abi;

  if (bx.cx().sess().opts.unstable_opts.virtual_function_elimination && bx.cx().sess().lto() === "Fat") {
    const trait_ref = dyn_trait_in_self(bx.tcx_(), ty);
    if (trait_ref !== undefined) {
      const typeid = typeid_for_trait_ref(bx.tcx_(), trait_ref);
      // PORT: `typeid.as_bytes()` of the `String` is its UTF-8 bytes.
      const func = bx.type_checked_load(llvtable, vtable_byte_offset, new TextEncoder().encode(typeid));
      return func;
    } else if (nonnull) {
      bug("load nonnull value from a vtable without a principal trait");
    }
  }

  const gep = bx.inbounds_ptradd(llvtable, bx.const_usize(BigInt(vtable_byte_offset)));
  const ptr = bx.load(llty, gep, ptr_align);
  // VTable loads are invariant.
  bx.set_invariant_load(ptr);
  if (nonnull) {
    bx.nonnull_metadata(ptr);
  }
  return ptr;
}
