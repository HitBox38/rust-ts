// Port of compiler/rustc_mir_transform/src/elaborate_box_derefs.rs (lane mt-cleanup).
//
// PORT: `ElaborateBoxDerefVisitor` `extends MutVisitor` (mir/visit.ts, D4); `place.local = ..` edits the visited
// `Place` in place. `local_decls: &'a mut LocalDecls` is the body's `local_decls` array.
//! This pass transforms derefs of Box into a deref of the pointer inside Box.
//!
//! Box is not actually a pointer so it is incorrect to dereference it directly.
import { FieldIdx } from "../rustc_abi/layout.ts";
import {
  type BasicBlock,
  type Body,
  CastKind,
  type LocalDecl,
  type Location,
  type Place,
  type PlaceElem,
  Place_from_Local,
  ProjectionElem,
} from "../rustc_middle/mir/mod.ts";
import { MutVisitor, type PlaceContext } from "../rustc_middle/mir/visit.ts";
import type { AdtDef } from "../rustc_middle/ty/adt.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { span_bug } from "../rustc_span/macros.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { PatternKind } from "../rustc_type_ir/pattern.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import { MirPatch } from "./patch.ts";

/// Constructs the types used when accessing a Box's pointer
// rustc: compiler/rustc_mir_transform/src/elaborate_box_derefs.rs:15 build_ptr_tys
function build_ptr_tys(tcx: TyCtxt, pointee: Ty, unique_def: AdtDef, nonnull_def: AdtDef): [Ty, Ty, Ty] {
  const args = tcx.mk_args([GenericArg.from_Ty(pointee)]);
  const unique_ty = Ty.new_adt(tcx, unique_def, args);
  const nonnull_ty = Ty.new_adt(tcx, nonnull_def, args);
  const ptr_ty = Ty.new_imm_ptr(tcx, pointee);

  return [unique_ty, nonnull_ty, ptr_ty];
}

// rustc-type: compiler/rustc_mir_transform/src/elaborate_box_derefs.rs:29 ElaborateBoxDerefVisitor
class ElaborateBoxDerefVisitor extends MutVisitor {
  constructor(
    /** PORT: the field `tcx` (the name of `MutVisitor::tcx`, which returns it). */
    public tcx_: TyCtxt,
    public local_decls: LocalDecl[],
    public patch: MirPatch,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_box_derefs.rs:36 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_box_derefs.rs:40 visit_place
  override visit_place(place: Place, context: PlaceContext, location: Location): void {
    const tcx = this.tcx_;

    const base_ty = this.local_decls[place.local]!.ty;

    // Derefer ensures that derefs are always the first projection
    const first = place.projection[0];
    const boxed_ty = first !== undefined && first.$ === "Deref" ? base_ty.boxed_ty() : undefined;
    if (first !== undefined && first.$ === "Deref" && boxed_ty !== undefined) {
      const source_info = this.local_decls[place.local]!.source_info;

      const ptr_ty = Ty.new_imm_ptr(tcx, boxed_ty);

      const ptr_local = this.patch.new_temp(ptr_ty, source_info.span);

      // Project to the first field (a `BoxRaw`), then transmute that. We could project one
      // further but in the end we'd hit a pattern type so we'd always have to transmute.
      const field_place = Place_from_Local(place.local).project_to_field(FieldIdx.ZERO, this.local_decls, tcx);
      this.patch.add_assign(location, Place_from_Local(ptr_local), {
        $: "Cast",
        _0: CastKind.BoxDerefTransmute,
        _1: { $: "Copy", _0: field_place },
        _2: ptr_ty,
      });

      place.local = ptr_local;
    }

    this.super_place(place, context, location);
  }
}

// rustc-type: compiler/rustc_mir_transform/src/elaborate_box_derefs.rs:77 ElaborateBoxDerefs
export class ElaborateBoxDerefs extends MirPass {
  readonly type_name = "rustc_mir_transform::elaborate_box_derefs::ElaborateBoxDerefs";

  // rustc: compiler/rustc_mir_transform/src/elaborate_box_derefs.rs:80 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // If box is not present, this pass doesn't need to do anything.
    const def_id = tcx.lang_items().owned_box();
    if (def_id === undefined) return;

    // PORT: the `adt_def` / `type_of` query values are `unknown` in queries.gen.ts.
    const unique_did = (tcx.adt_def(def_id) as AdtDef).non_enum_variant().fields[FieldIdx.ZERO]!.did;

    const unique_def = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(unique_did) as EarlyBinder<Ty>)).ty_adt_def();
    if (unique_def === undefined) {
      return span_bug(tcx.def_span(unique_did), "expected Box to contain Unique");
    }

    const nonnull_did = unique_def.non_enum_variant().fields[FieldIdx.ZERO]!.did;

    const nonnull_def = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(nonnull_did) as EarlyBinder<Ty>)).ty_adt_def();
    if (nonnull_def === undefined) {
      return span_bug(tcx.def_span(nonnull_did), "expected Unique to contain Nonnull");
    }

    const patch = MirPatch.new(body);

    const local_decls = body.local_decls;

    const visitor = new ElaborateBoxDerefVisitor(tcx, local_decls, patch);

    const blocks = body.basic_blocks.as_mut_preserves_cfg();
    for (let i = 0; i < blocks.length; i++) {
      visitor.visit_basic_block_data(i as BasicBlock, blocks[i]!);
    }

    visitor.patch.apply(body);

    for (const debug_info of body.var_debug_info) {
      const value = debug_info.value;
      if (value.$ === "Place") {
        const place = value._0;
        let new_projections: PlaceElem[] | undefined = undefined;

        for (const [base, elem] of place.iter_projections()) {
          const base_ty = base.ty(body.local_decls, tcx).ty;

          const boxed_ty = elem.$ === "Deref" ? base_ty.boxed_ty() : undefined;
          if (elem.$ === "Deref" && boxed_ty !== undefined) {
            // Clone the projections before us, since now we need to mutate them.
            new_projections ??= base.projection.slice();
            const np: PlaceElem[] = new_projections;

            const [unique_ty, nonnull_ty, ptr_ty] = build_ptr_tys(tcx, boxed_ty, unique_def, nonnull_def);

            np.push({ $: "Field", _0: FieldIdx.ZERO, _1: unique_ty }, { $: "Field", _0: FieldIdx.ZERO, _1: nonnull_ty });
            // While we can't project into a pattern type in a basic block,
            // this is debug info where it's fine.
            const pat_ty = Ty.new_pat(tcx, ptr_ty, tcx.mk_pat(PatternKind.NotNull));
            np.push({ $: "Field", _0: FieldIdx.ZERO, _1: pat_ty });
            np.push({ $: "Field", _0: FieldIdx.ZERO, _1: ptr_ty });
            np.push(ProjectionElem.Deref);
          } else if (new_projections !== undefined) {
            // Keep building up our projections list once we've started it.
            new_projections.push(elem);
          }
        }

        // Store the mutated projections if we actually changed something.
        if (new_projections !== undefined) {
          place.projection = tcx.mk_place_elems(new_projections);
        }
      }
    }
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_box_derefs.rs:153 policy
  policy(_ctx: PassCtx): PassPolicy {
    // Implements Box dereference semantics so backends and Miri do not have to handle them.
    return PassPolicy.Required;
  }
}
