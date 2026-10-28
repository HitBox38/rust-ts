//! This pass constructs a second coroutine body sufficient for return from
//! `FnOnce`/`AsyncFnOnce` implementations for coroutine-closures (e.g. async closures).
//!
//! Consider an async closure like:
//! ```rust
//! let x = vec![1, 2, 3];
//!
//! let closure = async move || {
//!     println!("{x:#?}");
//! };
//! ```
//!
//! This desugars to something like:
//! ```rust,ignore (invalid-borrowck)
//! let x = vec![1, 2, 3];
//!
//! let closure = move || {
//!     async {
//!         println!("{x:#?}");
//!     }
//! };
//! ```
//!
//! Important to note here is that while the outer closure *moves* `x: Vec<i32>`
//! into its upvars, the inner `async` coroutine simply captures a ref of `x`.
//! This is the "magic" of async closures -- the futures that they return are
//! allowed to borrow from their parent closure's upvars.
//!
//! However, what happens when we call `closure` with `AsyncFnOnce` (or `FnOnce`,
//! since all async closures implement that too)? Well, recall the signature:
//! ```
//! use std::future::Future;
//! pub trait AsyncFnOnce<Args>
//! {
//!     type CallOnceFuture: Future<Output = Self::Output>;
//!     type Output;
//!     fn async_call_once(
//!         self,
//!         args: Args
//!     ) -> Self::CallOnceFuture;
//! }
//! ```
//!
//! This signature *consumes* the async closure (`self`) and returns a `CallOnceFuture`.
//! How do we deal with the fact that the coroutine is supposed to take a reference
//! to the captured `x` from the parent closure, when that parent closure has been
//! destroyed?
//!
//! This is the second piece of magic of async closures. We can simply create a
//! *second* `async` coroutine body where that `x` that was previously captured
//! by reference is now captured by value. This means that we consume the outer
//! closure and return a new coroutine that will hold onto all of these captures,
//! and drop them when it is finished (i.e. after it has been `.await`ed).
//!
//! We do this with the analysis below, which detects the captures that come from
//! borrowing from the outer closure, and we simply peel off a `deref` projection
//! from them. This second body is stored alongside the first body, and optimized
//! with it in lockstep. When we need to resolve a body for `FnOnce` or `AsyncFnOnce`,
//! we use this "by-move" body instead.
//!
//! ## How does this work?
//!
//! This pass essentially remaps the body of the (child) closure of the coroutine-closure
//! to take the set of upvars of the parent closure by value. This at least requires
//! changing a by-ref upvar to be by-value in the case that the outer coroutine-closure
//! captures something by value; however, it may also require renumbering field indices
//! in case precise captures (edition 2021 closure capture rules) caused the inner coroutine
//! to split one field capture into two.
// Port of compiler/rustc_mir_transform/src/coroutine/by_move_body.rs (lane mt-coroutine-a, wave 24).
//
// PORT: `UnordMap<FieldIdx, (FieldIdx, Ty, bool, Vec<Projection>)>` is a `Map` of tuples (only `get` and `len` are
// used, so the order is unobservable). `MakeByMoveBody` `extends MutVisitor` (mir/visit.ts, D4).
// PORT: `body.clone()` is the generated `clone_Body`; `tcx.arena.alloc(Steal::new(..))` is the `Steal` itself
// (arenas are erased, PORTING §5) with `Steal`'s type name as `alloc_steal_mir` gives it.
// PORT: `.clone()` of query values fed back (`codegen_fn_attrs`, `generics_of`) shares the value: query values are
// never mutated (precedent rustc_const_eval interpret/intern.ts).
import { FieldIdx, VariantIdx } from "../../rustc_abi/layout.ts";
import { Steal } from "../../rustc_data_structures/steal.ts";
import type { CoroutineKind } from "../../rustc_hir/hir.ts";
import { DefKind } from "../../rustc_hir/def.ts";
import { PerParentDisambiguatorState } from "../../rustc_hir_id/definitions.ts";
import { type Projection, type ProjectionKind } from "../../rustc_middle/hir/place.ts";
import {
  clone_Body,
  debug_Local,
  debug_ProjectionElem,
  type Local,
  type LocalDecl,
  type Location,
  MirSource,
  Place,
  type PlaceElem,
  type Statement,
} from "../../rustc_middle/mir/mod.ts";
import { MirDumper } from "../../rustc_middle/mir/pretty.ts";
import { MutVisitor, type PlaceContext } from "../../rustc_middle/mir/visit.ts";
import {
  analyze_coroutine_closure_captures,
  BorrowKind as ty_BorrowKind,
  CAPTURE_STRUCT_LOCAL as ty_CAPTURE_STRUCT_LOCAL,
} from "../../rustc_middle/ty/closure.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { fold_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import { debug_Ty, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { type DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { bug } from "../../rustc_span/macros.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import {
  CoroutineClosureArgs,
  CoroutineArgs,
  CoroutineClosureSignature,
  type CoroutineClosureSignature as CoroutineClosureSignatureT,
  fold_with_CoroutineClosureSignature,
  try_fold_with_CoroutineClosureSignature,
  visit_with_CoroutineClosureSignature,
} from "../../rustc_type_ir/ty_kind/closure.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { ClosureKind } from "../../rustc_type_ir/lib.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { debug_list, PRETTY } from "../../std/fmt.ts";
import { assert, assert_eq, unreachable, unwrap } from "../../std/panic.ts";

// PORT: `ty::CAPTURE_STRUCT_LOCAL` (ty/closure.ts declares its own `Local` brand) as a mir `Local` (decision #15).
const CAPTURE_STRUCT_LOCAL = ty_CAPTURE_STRUCT_LOCAL as unknown as Local;

// rustc: compiler/rustc_mir_transform/src/coroutine/by_move_body.rs:83 coroutine_by_move_body_def_id
export function coroutine_by_move_body_def_id(tcx: TyCtxt, coroutine_def_id: LocalDefId): DefId {
  const body = tcx.mir_built(coroutine_def_id).borrow();

  // If the typeck results are tainted, no need to make a by-ref body.
  if (body.tainted_by_errors !== undefined) {
    return LocalDefId.to_def_id(coroutine_def_id);
  }

  const ck = tcx.coroutine_kind(LocalDefId.to_def_id(coroutine_def_id)) as CoroutineKind | undefined;
  if (!(ck !== undefined && ck.$ === "Desugared" && ck._1 === "Closure")) {
    return bug("should only be invoked on coroutine-closures");
  }

  // Also, let's skip processing any bodies with errors, since there's no guarantee
  // the MIR body will be constructed well.
  const coroutine_ty = body.local_decls[CAPTURE_STRUCT_LOCAL]!.ty;

  const coroutine_ty_kind = coroutine_ty.kind();
  if (coroutine_ty_kind.$ !== "Coroutine") {
    return bug("tried to create by-move body of non-coroutine receiver");
  }
  const args = coroutine_ty_kind._1.as_coroutine();

  const coroutine_kind = unwrap(CoroutineArgs.kind_ty(args).to_opt_closure_kind());

  const parent_def_id = tcx.local_parent(coroutine_def_id);
  const parent_ty_kind = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(LocalDefId.to_def_id(parent_def_id)) as EarlyBinder<Ty>)).kind();
  if (parent_ty_kind.$ !== "CoroutineClosure") {
    return bug("coroutine's parent was not a coroutine-closure");
  }
  const parent_args = parent_ty_kind._1;
  if (TypeVisitableExt.references_error(parent_args, fold_GenericArgs)) {
    return LocalDefId.to_def_id(coroutine_def_id);
  }

  const parent_closure_args = parent_args.as_coroutine_closure();
  const num_args = Binder.skip_binder(CoroutineClosureArgs.coroutine_closure_sig(parent_closure_args)).tupled_inputs_ty.tuple_fields().length;

  const field_remapping: Map<FieldIdx, [FieldIdx, Ty, boolean, Projection[]]> = new Map();
  for (const entry of analyze_coroutine_closure_captures(
    tcx.closure_captures(parent_def_id),
    tcx.closure_captures(coroutine_def_id).slice(num_args),
    ([parent_field_idx, parent_capture], [child_field_idx, child_capture]): [FieldIdx, [FieldIdx, Ty, boolean, Projection[]]] | undefined => {
      // Store this set of additional projections (fields and derefs).
      // We need to re-apply them later.
      const child_precise_captures: Projection[] = child_capture.place.projections.slice(parent_capture.place.projections.length);

      // If the parent capture is by-ref, then we need to apply an additional
      // deref before applying any further projections to this place.
      if (parent_capture.is_by_ref()) {
        child_precise_captures.splice(0, 0, { ty: parent_capture.place.ty(), kind: { $: "Deref" } });
      }
      // If the child capture is by-ref, then we need to apply a "ref"
      // projection (i.e. `&`) at the end. But wait! We don't have that
      // as a projection kind. So instead, we can apply its dual and
      // *peel* a deref off of the place when it shows up in the MIR body.
      // Luckily, by construction this is always possible.
      let peel_deref: boolean;
      if (child_capture.is_by_ref()) {
        assert(
          parent_capture.is_by_ref() || coroutine_kind !== ClosureKind.FnOnce,
          "`FnOnce` coroutine-closures return coroutines that capture from their body; it will always result in a borrowck error!",
        );
        peel_deref = true;
      } else {
        peel_deref = false;
      }

      // Regarding the behavior above, you may think that it's redundant to both
      // insert a deref and then peel a deref if the parent and child are both
      // captured by-ref. This would be correct, except for the case where we have
      // precise capturing projections, since the inserted deref is to the *beginning*
      // and the peeled deref is at the *end*. I cannot seem to actually find a
      // case where this happens, though, but let's keep this code flexible.

      // Finally, store the type of the parent's captured place. We need
      // this when building the field projection in the MIR body later on.
      let parent_capture_ty = parent_capture.place.ty();
      const capture_kind = parent_capture.info.capture_kind;
      switch (capture_kind.$) {
        case "ByValue":
        case "ByUse":
          break;
        case "ByRef":
          parent_capture_ty = Ty.new_ref(tcx, tcx.lifetimes.re_erased, parent_capture_ty, ty_BorrowKind.to_mutbl_lossy(capture_kind._0));
          break;
      }

      return [
        FieldIdx.from_usize(child_field_idx + num_args),
        [FieldIdx.from_usize(parent_field_idx + num_args), parent_capture_ty, peel_deref, child_precise_captures],
      ];
    },
  )) {
    // .flatten().collect()
    if (entry !== undefined) {
      field_remapping.set(entry[0], entry[1]);
    }
  }

  if (coroutine_kind === ClosureKind.FnOnce) {
    assert_eq(field_remapping.size, tcx.closure_captures(parent_def_id).length, String);
    // The by-move body is just the body :)
    return LocalDefId.to_def_id(coroutine_def_id);
  }

  const by_move_coroutine_ty = CoroutineClosureSignature.to_coroutine_given_kind_and_upvars(
    tcx.instantiate_bound_regions_with_erased(CoroutineClosureArgs.coroutine_closure_sig(parent_closure_args), fold_CoroutineClosureSignature),
    tcx,
    CoroutineClosureArgs.parent_args(parent_closure_args),
    LocalDefId.to_def_id(coroutine_def_id),
    ClosureKind.FnOnce,
    tcx.lifetimes.re_erased,
    CoroutineClosureArgs.tupled_upvars_ty(parent_closure_args),
    CoroutineClosureArgs.coroutine_captures_by_ref_ty(parent_closure_args),
  );

  const by_move_body = clone_Body(body);
  new MakeByMoveBody(tcx, field_remapping, by_move_coroutine_ty).visit_body(by_move_body);

  // This path is unique since we're in a query so we'll only be called once with `parent_def_id`
  // and this is the only location creating `SyntheticCoroutineBody`.
  const body_def = tcx.create_def(
    parent_def_id,
    undefined,
    DefKind.SyntheticCoroutineBody,
    undefined,
    PerParentDisambiguatorState.new(parent_def_id),
  );
  by_move_body.source = new MirSource({ $: "Item", _0: LocalDefId.to_def_id(body_def.def_id()) }, undefined);

  {
    const dumper = MirDumper.new(tcx, "built", by_move_body);
    if (dumper !== undefined) {
      dumper.set_disambiguator("after").dump_mir(by_move_body);
    }
  }

  // Feed HIR because we try to access this body's attrs in the inliner.
  body_def.feed_hir();
  // Inherited from the by-ref coroutine.
  body_def.codegen_fn_attrs(tcx.codegen_fn_attrs(LocalDefId.to_def_id(coroutine_def_id)));
  body_def.coverage_attr_on(tcx.coverage_attr_on(coroutine_def_id));
  body_def.constness(tcx.constness(LocalDefId.to_def_id(coroutine_def_id)));
  body_def.coroutine_kind(tcx.coroutine_kind(LocalDefId.to_def_id(coroutine_def_id)));
  body_def.def_ident_span(tcx.def_ident_span(LocalDefId.to_def_id(coroutine_def_id)));
  body_def.def_span(tcx.def_span(LocalDefId.to_def_id(coroutine_def_id)));
  body_def.explicit_clauses_of(tcx.explicit_clauses_of(LocalDefId.to_def_id(coroutine_def_id)));
  body_def.generics_of(tcx.generics_of(LocalDefId.to_def_id(coroutine_def_id)));
  body_def.param_env(tcx.param_env(LocalDefId.to_def_id(coroutine_def_id)));
  body_def.explicit_clauses_of(tcx.explicit_clauses_of(LocalDefId.to_def_id(coroutine_def_id)));

  // The type of the coroutine is the `by_move_coroutine_ty`.
  body_def.type_of(EarlyBinder.bind(tcx, by_move_coroutine_ty, fold_Ty));

  body_def.mir_built(Steal.new(by_move_body, "rustc_middle::mir::Body"));

  return LocalDefId.to_def_id(body_def.def_id());
}

/** PORT (D4): the `TypeFoldable` descriptor of `CoroutineClosureSignature` over its derived impls (closure.gen.ts), for
 *  `instantiate_bound_regions_with_erased` (precedent: rustc_mir_build builder/mod.ts). */
const fold_CoroutineClosureSignature: TypeFoldable<CoroutineClosureSignatureT> = {
  visit_with: (self, visitor) => visit_with_CoroutineClosureSignature(self, visitor),
  try_fold_with: (self, folder) => try_fold_with_CoroutineClosureSignature(self, folder),
  fold_with: (self, folder) => fold_with_CoroutineClosureSignature(self, folder),
};

// rustc-type: compiler/rustc_mir_transform/src/coroutine/by_move_body.rs:257 MakeByMoveBody
class MakeByMoveBody extends MutVisitor {
  constructor(
    public tcx_: TyCtxt,
    public field_remapping: Map<FieldIdx, [FieldIdx, Ty, boolean, Projection[]]>,
    public by_move_coroutine_ty: Ty,
  ) {
    super();
  }

  // ---- impl MutVisitor for MakeByMoveBody ----

  // rustc: compiler/rustc_mir_transform/src/coroutine/by_move_body.rs:264 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/coroutine/by_move_body.rs:268 visit_place
  override visit_place(place: Place, context: PlaceContext, location: Location): void {
    // Initializing an upvar local always starts with `CAPTURE_STRUCT_LOCAL` and a
    // field projection. If this is in `field_remapping`, then it must not be an
    // arg from calling the closure, but instead an upvar.
    const first = place.projection[0];
    const remapped = first !== undefined && first.$ === "Field" ? this.field_remapping.get(first._0) : undefined;
    if (place.local === CAPTURE_STRUCT_LOCAL && first !== undefined && first.$ === "Field" && remapped !== undefined) {
      const projection = place.projection.slice(1);
      const [remapped_idx, remapped_ty, peel_deref, bridging_projections] = remapped;
      // As noted before, if the parent closure captures a field by value, and
      // the child captures a field by ref, then for the by-move body we're
      // generating, we also are taking that field by value. Peel off a deref,
      // since a layer of ref'ing has now become redundant.
      let final_projections: readonly PlaceElem[];
      if (peel_deref) {
        const head = projection[0];
        if (!(head !== undefined && head.$ === "Deref")) {
          return bug(
            `There should be at least a single deref for an upvar local initialization, found ${debug_list(PRETTY, projection.map((e) => debug_ProjectionElem(e, PRETTY, debug_Local, debug_Ty)))}`,
          );
        }
        // There may be more derefs, since we may also implicitly reborrow
        // a captured mut pointer.
        final_projections = projection.slice(1);
      } else {
        final_projections = projection;
      }

      // These projections are applied in order to "bridge" the local that we are
      // currently transforming *from* the old upvar that the by-ref coroutine used
      // to capture *to* the upvar of the parent coroutine-closure. For example, if
      // the parent captures `&s` but the child captures `&(s.field)`, then we will
      // apply a field projection.
      const bridging = bridging_projections.map((elem): PlaceElem => {
        const kind: ProjectionKind = elem.kind;
        if (kind.$ === "Deref") {
          return { $: "Deref" };
        } else if (kind.$ === "Field" && kind._1 === VariantIdx.ZERO) {
          return { $: "Field", _0: kind._0, _1: elem.ty };
        } else {
          return unreachable("internal error: entered unreachable code: precise captures only through fields and derefs");
        }
      });

      // We start out with an adjusted field index (and ty), representing the
      // upvar that we get from our parent closure. We apply any of the additional
      // projections to make sure that to the rest of the body of the closure, the
      // place looks the same, and then apply that final deref if necessary.
      const new_place = new Place(
        place.local,
        this.tcx_.mk_place_elems_from_iter([{ $: "Field", _0: remapped_idx, _1: remapped_ty } as PlaceElem, ...bridging, ...final_projections]),
      );
      place.local = new_place.local;
      place.projection = new_place.projection;
    }
    this.super_place(place, context, location);
  }

  // rustc: compiler/rustc_mir_transform/src/coroutine/by_move_body.rs:331 visit_statement
  override visit_statement(statement: Statement, location: Location): void {
    // Remove fake borrows of closure captures if that capture has been
    // replaced with a by-move version of that capture.
    //
    // For example, imagine we capture `Foo` in the parent and `&Foo`
    // in the child. We will emit two fake borrows like:
    //
    // ```
    //    _2 = &fake shallow (*(_1.0: &Foo));
    //    _3 = &fake shallow (_1.0: &Foo);
    // ```
    //
    // However, since this transform is responsible for replacing
    // `_1.0: &Foo` with `_1.0: Foo`, that makes the second fake borrow
    // obsolete, and we should replace it with a nop.
    //
    // As a side-note, we don't actually even care about fake borrows
    // here at all since they're fully a MIR borrowck artifact, and we
    // don't need to borrowck by-move MIR bodies. But it's best to preserve
    // as much as we can between these two bodies :)
    const kind = statement.kind;
    if (kind.$ === "Assign") {
      const rvalue = kind._0[1];
      if (rvalue.$ === "Ref" && rvalue._1.$ === "Fake" && rvalue._1._0 === "Shallow") {
        const place = rvalue._2;
        const elem = place.projection[0];
        if (place.local === CAPTURE_STRUCT_LOCAL && place.projection.length === 1 && elem !== undefined && elem.$ === "Field") {
          const remapped = this.field_remapping.get(elem._0);
          if (remapped !== undefined && remapped[2] === true) {
            statement.kind = { $: "Nop" };
          }
        }
      }
    }

    this.super_statement(statement, location);
  }

  // rustc: compiler/rustc_mir_transform/src/coroutine/by_move_body.rs:366 visit_local_decl
  override visit_local_decl(local: Local, local_decl: LocalDecl): void {
    // Replace the type of the self arg.
    if (local === CAPTURE_STRUCT_LOCAL) {
      local_decl.ty = this.by_move_coroutine_ty;
    }
    this.super_local_decl(local, local_decl);
  }
}
