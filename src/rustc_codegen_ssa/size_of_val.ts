//! Computing the size and alignment of a value.
//
// Port of compiler/rustc_codegen_ssa/src/size_of_val.rs (lane ssa-mir-rest, plan-m7 wave 41). Conventions as meth.ts's
// header; `trace!` and `debug!` are compiled out of rustc and stay comments.
import { Align, FieldsShape, Integer, WrappingRange } from "../rustc_abi/lib.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.gen.ts";
import type { Ty } from "../rustc_middle/ty/decls.ts";
import { display_Ty, with_no_trimmed_paths, with_no_visible_paths } from "../rustc_middle/ty/print/pretty.ts";
import { COMMON_VTABLE_ENTRIES_ALIGN, COMMON_VTABLE_ENTRIES_SIZE } from "../rustc_middle/ty/vtable.ts";
import { DUMMY_SP, type Span } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { assert, unwrap } from "../std/panic.ts";
import * as common from "./common.ts";
import { IntPredicate } from "./common.ts";
import * as meth from "./meth.ts";
import type { BackendTypes } from "./traits/backend.ts";
import { type BuilderMethods, ReturnSlot } from "./traits/builder.ts";

// rustc: compiler/rustc_codegen_ssa/src/size_of_val.rs:14 size_and_align_of_dst
export function size_and_align_of_dst<B extends BackendTypes>(
  bx: BuilderMethods<B>,
  t: Ty,
  info: B["Value"] | undefined,
  span: Span,
): [B["Value"], B["Value"]] {
  const layout = bx.spanned_layout_of(t, span);
  // trace!("size_and_align_of_dst(ty={}, info={:?}): layout: {:?}", t, info, layout);
  if (layout.is_sized()) {
    const size = bx.const_usize(layout.size.bytes_u64());
    const align = bx.const_usize(BigInt(layout.align.abi.bytes()));
    return [size, align];
  }
  const kind = t.kind();
  switch (kind.$) {
    case "Dynamic": {
      // Load size/align from vtable.
      const vtable = unwrap(info);
      const size = meth.VirtualIndex.from_index(COMMON_VTABLE_ENTRIES_SIZE).get_usize(bx, vtable, t);
      const align = meth.VirtualIndex.from_index(COMMON_VTABLE_ENTRIES_ALIGN).get_usize(bx, vtable, t);

      // Size is always <= isize::MAX.
      const size_bound = Integer.signed_max(bx.data_layout().ptr_sized_integer());
      bx.range_metadata(size, new WrappingRange(0n, size_bound));
      // Alignment is always a power of two, thus 1..=0x800…000,
      // but also bounded by the maximum we support in type layout.
      const align_bound = BigInt(Align.max_for_target(bx.data_layout()).bytes());
      bx.range_metadata(align, new WrappingRange(1n, align_bound));

      return [size, align];
    }
    case "Slice":
    case "Str": {
      const unit = layout.field(bx, 0);
      // The info in this case is the length of the str, so the size is that
      // times the unit size.
      return [
        // All slice sizes must fit into `isize`, so this multiplication cannot
        // wrap -- neither signed nor unsigned.
        bx.unchecked_sumul(unwrap(info), bx.const_usize(unit.size.bytes_u64())),
        bx.const_usize(BigInt(unit.align.abi.bytes())),
      ];
    }
    case "Foreign": {
      // `extern` type. We cannot compute the size, so panic.
      const msg_str = with_no_visible_paths(() =>
        with_no_trimmed_paths(() => `attempted to compute the size or alignment of extern type \`${display_Ty(t)}\``),
      );
      const msg = bx.const_str(msg_str);

      // Obtain the panic entry point.
      const [fn_abi, llfn, _instance] = common.build_langcall(bx, DUMMY_SP, LangItem.PanicNounwind);

      // Generate the call. Cannot use `do_call` since we don't have a MIR terminator so we
      // can't create a `TerminationCodegenHelper`. (But we are in good company, this code is
      // duplicated plenty of times.)
      const fn_ty = bx.fn_decl_backend_type(fn_abi);

      bx.call(
        fn_ty,
        /* fn_attrs */ undefined,
        fn_abi,
        llfn,
        ReturnSlot.Direct, // we know the ABI here
        [msg[0], msg[1]],
        undefined,
        undefined,
      );

      // This function does not return so we can now return whatever we want.
      const size = bx.const_usize(layout.size.bytes_u64());
      const align = bx.const_usize(BigInt(layout.align.abi.bytes()));
      return [size, align];
    }
    case "Adt":
    case "Tuple": {
      // First get the size of all statically known fields.
      // Don't use size_of because it also rounds up to alignment, which we
      // want to avoid, as the unsized field's alignment could be smaller.
      assert(!t.is_simd(), "assertion failed: !t.is_simd()");
      // debug!("DST {} layout: {:?}", t, layout);

      const i = FieldsShape.count(layout.fields) - 1;
      const unsized_offset_unadjusted_ = FieldsShape.offset(layout.fields, i).bytes_u64();
      const sized_align_ = BigInt(layout.align.abi.bytes());
      // debug!(
      //     "DST {} offset of dyn field: {}, statically sized align: {}",
      //     t, unsized_offset_unadjusted, sized_align
      // );
      const unsized_offset_unadjusted = bx.const_usize(unsized_offset_unadjusted_);
      const sized_align = bx.const_usize(sized_align_);

      // Recurse to get the size of the dynamically sized field (must be
      // the last field).
      const field_ty = layout.field(bx, i).ty;
      let [unsized_size, unsized_align] = size_and_align_of_dst(bx, field_ty, info, span);

      // # First compute the dynamic alignment

      // For packed types, we need to cap the alignment.
      if (kind.$ === "Adt") {
        const packed = kind._0.repr().pack;
        if (packed !== undefined) {
          if (packed.bytes() === 1) {
            // We know this will be capped to 1.
            unsized_align = bx.const_usize(1n);
          } else {
            // We have to dynamically compute `min(unsized_align, packed)`.
            const packed_ = bx.const_usize(BigInt(packed.bytes()));
            const cmp = bx.icmp(IntPredicate.IntULT, unsized_align, packed_);
            unsized_align = bx.select(cmp, unsized_align, packed_);
          }
        }
      }

      // Choose max of two known alignments (combined value must
      // be aligned according to more restrictive of the two).
      let full_align: B["Value"];
      const sized_align_c = bx.const_to_opt_u128(sized_align, false);
      const unsized_align_c = bx.const_to_opt_u128(unsized_align, false);
      if (sized_align_c !== undefined && unsized_align_c !== undefined) {
        // If both alignments are constant, (the sized_align should always be), then
        // pick the correct alignment statically.
        // PORT: `std::cmp::max(a, b) as u64` of the two `u128`s.
        full_align = bx.const_usize(BigInt.asUintN(64, sized_align_c > unsized_align_c ? sized_align_c : unsized_align_c));
      } else {
        const cmp = bx.icmp(IntPredicate.IntUGT, sized_align, unsized_align);
        full_align = bx.select(cmp, sized_align, unsized_align);
      }

      // # Then compute the dynamic size

      // The full formula for the size would be:
      // let unsized_offset_adjusted = unsized_offset_unadjusted.align_to(unsized_align);
      // let full_size = (unsized_offset_adjusted + unsized_size).align_to(full_align);
      // However, `unsized_size` is a multiple of `unsized_align`. Therefore, we can
      // equivalently do the `align_to(unsized_align)` *after* adding `unsized_size`:
      //
      // let full_size =
      //     (unsized_offset_unadjusted + unsized_size)
      //     .align_to(unsized_align)
      //     .align_to(full_align);
      //
      // Furthermore, `align >= unsized_align`, and therefore we only need to do:
      // let full_size = (unsized_offset_unadjusted + unsized_size).align_to(full_align);

      let full_size = bx.add(unsized_offset_unadjusted, unsized_size);

      // Issue #27023: must add any necessary padding to `size`
      // (to make it a multiple of `align`) before returning it.
      //
      // Namely, the returned size should be, in C notation:
      //
      //   `size + ((size & (align-1)) ? align : 0)`
      //
      // emulated via the semi-standard fast bit trick:
      //
      //   `(size + (align-1)) & -align`
      const one = bx.const_usize(1n);
      const addend = bx.sub(full_align, one);
      const add = bx.add(full_size, addend);
      const neg = bx.neg(full_align);
      full_size = bx.and(add, neg);

      return [full_size, full_align];
    }
    default:
      return bug(`size_and_align_of_dst: ${display_Ty(t)} not supported`);
  }
}
