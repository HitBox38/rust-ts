// Port of compiler/rustc_const_eval/src/util/alignment.rs (lane mt-built-lints, ahead of ctfe-util: check_packed_ref
// needs `place_unalignment` for every borrow in `mir_built`). util/mod.rs (`pub use self::alignment::{..}`) is not
// ported yet; callers import this module directly.
//
// PORT: `L: HasLocalDecls` is the `HasLocalDecls` union (`LocalDecls | Body`). `Align`'s derived `Ord` compares
// `pow2`; `min_by_key` keeps the first minimum.
import type { Align } from "../../rustc_abi/lib.ts";
import { type HasLocalDecls, type Place } from "../../rustc_middle/mir/mod.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { TypingEnv } from "../../rustc_middle/ty/mod.ts";

/// If the place may be less aligned than its type requires
/// (because it is in a packed type), returns the AdtDef
/// and packed alignment of its most-unaligned projection.
// rustc: compiler/rustc_const_eval/src/util/alignment.rs:9 place_unalignment
export function place_unalignment(
  tcx: TyCtxt,
  local_decls: HasLocalDecls,
  typing_env: TypingEnv,
  place: Place,
): [AdtDef, Align] | undefined {
  // debug!("unalignment({:?})", place);
  const found = most_packed_projection(tcx, local_decls, place);
  if (found === undefined) {
    // debug!("unalignment({:?}) - not within packed", place);
    return undefined;
  }
  const [descr, pack] = found;

  const ty = place.ty(local_decls, tcx).ty;
  const unsized_tail = () => tcx.struct_tail_for_codegen(ty, typing_env);
  const layout = tcx.layout_of(typing_env.as_query_input(ty));
  if (
    layout.$ === "Ok" &&
    layout._0.align.abi.pow2 <= pack.pow2 &&
    (layout._0.is_sized() || unsized_tail().kind().$ === "Slice" || unsized_tail().kind().$ === "Str")
  ) {
    // If the packed alignment is greater or equal to the field alignment, the type won't be
    // further unaligned.
    // However we need to ensure the field is sized; for unsized fields, `layout.align` is
    // just an approximation -- except when the unsized tail is a slice, where the alignment
    // is fully determined by the type.
    // debug!(
    //     "unalignment({:?}) - align = {}, packed = {}; not unaligned",
    //     place,
    //     layout.align.bytes(),
    //     pack.bytes()
    // );
    return undefined;
  } else {
    // We cannot figure out the layout. Conservatively assume that this is unaligned.
    // debug!("unalignment({:?}) - unaligned", place);
    return [descr, pack];
  }
}

/// If the place includes a projection from a packed struct,
/// returns the AdtDef and packed alignment of the projection
/// with the lowest pack
// rustc: compiler/rustc_const_eval/src/util/alignment.rs:56 most_packed_projection
export function most_packed_projection(tcx: TyCtxt, local_decls: HasLocalDecls, place: Place): [AdtDef, Align] | undefined {
  let min: [AdtDef, Align] | undefined;
  const projections = place.iter_projections();
  for (let i = projections.length - 1; i >= 0; i--) {
    const [base, elem] = projections[i]!;
    // Stop at `Deref`; standard ABI alignment applies there.
    if (elem.$ === "Deref") break;
    // Consider the packed alignments at play here...
    const adt = base.ty(local_decls, tcx).ty.ty_adt_def();
    if (adt === undefined) continue;
    const pack = adt.repr().pack;
    if (pack === undefined) continue;
    // ... and compute their minimum.
    // The overall smallest alignment is what matters.
    if (min === undefined || pack.pow2 < min[1].pow2) {
      min = [adt, pack];
    }
  }
  return min;
}
