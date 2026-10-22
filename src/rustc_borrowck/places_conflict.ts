//! The borrowck rules for proving disjointness are applied from the "root" of the
//! borrow forwards, iterating over "similar" projections in lockstep until
//! we can prove overlap one way or another. Essentially, we treat `Overlap` as
//! a monoid and report a conflict if the product ends up not being `Disjoint`.
//!
//! On each step, if we didn't run out of borrow or place, we know that our elements
//! have the same type, and that they only overlap if they are the identical.
//!
//! For example, if we are comparing these:
//! ```text
//! BORROW:  (*x1[2].y).z.a
//! ACCESS:  (*x1[i].y).w.b
//! ```
//!
//! Then our steps are:
//! ```text
//!       x1         |   x1          -- places are the same
//!       x1[2]      |   x1[i]       -- equal or disjoint (disjoint if indexes differ)
//!       x1[2].y    |   x1[i].y     -- equal or disjoint
//!      *x1[2].y    |  *x1[i].y     -- equal or disjoint
//!     (*x1[2].y).z | (*x1[i].y).w  -- we are disjoint and don't need to check more!
//! ```
//!
//! Because `zip` does potentially bad things to the iterator inside, this loop
//! also handles the case where the access might be a *prefix* of the borrow, e.g.
//!
//! ```text
//! BORROW:  (*x1[2].y).z.a
//! ACCESS:  x1[i].y
//! ```
//!
//! Then our steps are:
//! ```text
//!       x1         |   x1          -- places are the same
//!       x1[2]      |   x1[i]       -- equal or disjoint (disjoint if indexes differ)
//!       x1[2].y    |   x1[i].y     -- equal or disjoint
//! ```
//!
//! -- here we run out of access - the borrow can access a part of it. If this
//! is a full deep access, then we *know* the borrow conflicts with it. However,
//! if the access is shallow, then we can proceed:
//!
//! ```text
//!       x1[2].y    | (*x1[i].y)    -- a deref! the access can't get past this, so we
//!                                     are disjoint
//! ```
//!
//! Our invariant is, that at each step of the iteration:
//!  - If we didn't run out of access to match, our borrow and access are comparable
//!    and either equal or disjoint.
//!  - If we did run out of access, the borrow can access a part of it.
// Port of compiler/rustc_borrowck/src/places_conflict.rs (lane borrowck-contract: declarations; filled by lane bck-core, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: the tuple `match`es (`(elem, base_ty.kind(), access)`, `(pi1_elem, pi2_elem)`) are if-chains in upstream arm order.
import { type Body, type BorrowKind, debug_Local, debug_ProjectionElem, type Local, type Place, type PlaceElem, type PlaceRef } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { debug_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { bug } from "../rustc_span/macros.ts";
import { PLAIN } from "../std/fmt.ts";
import { assert_eq, panic } from "../std/panic.ts";
import type { AccessDepth, Overlap } from "./lib.gen.ts";
import type { PlaceConflictBias } from "./places_conflict.gen.ts";
export * from "./places_conflict.gen.ts";

/// Helper function for checking if places conflict with a mutable borrow and deep access depth.
/// This is used to check for places conflicting outside of the borrow checking code (such as in
/// dataflow).
// rustc: compiler/rustc_borrowck/src/places_conflict.rs:81 places_conflict
export function places_conflict(tcx: TyCtxt, body: Body, borrow_place: Place, access_place: Place, bias: PlaceConflictBias): boolean {
  return borrow_conflicts_with_place(
    tcx,
    body,
    borrow_place,
    { $: "Mut", kind: "TwoPhaseBorrow" },
    access_place.as_ref(),
    { $: "Deep" },
    bias,
  );
}

/// Checks whether the `borrow_place` conflicts with the `access_place` given a borrow kind and
/// access depth. The `bias` parameter is used to determine how the unknowable (comparing runtime
/// array indices, for example) should be interpreted - this depends on what the caller wants in
/// order to make the conservative choice and preserve soundness.
// #[inline]
// rustc: compiler/rustc_borrowck/src/places_conflict.rs:104 borrow_conflicts_with_place
export function borrow_conflicts_with_place(
  tcx: TyCtxt,
  body: Body,
  borrow_place: Place,
  borrow_kind: BorrowKind,
  access_place: PlaceRef,
  access: AccessDepth,
  bias: PlaceConflictBias,
): boolean {
  const borrow_local = borrow_place.local;
  const access_local = access_place.local;

  if (borrow_local !== access_local) {
    // We have proven the borrow disjoint - further projections will remain disjoint.
    return false;
  }

  // This Local/Local case is handled by the more general code below, but
  // it's so common that it's a speed win to check for it first.
  if (borrow_place.projection.length === 0 && access_place.projection.length === 0) {
    return true;
  }

  return place_components_conflict(tcx, body, borrow_place, borrow_kind, access_place, access, bias);
}

// #[instrument(level = "debug", skip(tcx, body))]
// rustc: compiler/rustc_borrowck/src/places_conflict.rs:131 place_components_conflict
function place_components_conflict(
  tcx: TyCtxt,
  body: Body,
  borrow_place: Place,
  borrow_kind: BorrowKind,
  access_place: PlaceRef,
  access: AccessDepth,
  bias: PlaceConflictBias,
): boolean {
  const borrow_local = borrow_place.local;
  const access_local = access_place.local;
  // borrow_conflicts_with_place should have checked that.
  assert_eq<Local>(borrow_local, access_local, (v) => debug_Local(v, PLAIN));

  // loop invariant: borrow_c is always either equal to access_c or disjoint from it.
  const borrow_projections = borrow_place.iter_projections();
  const zip_len = Math.min(borrow_projections.length, access_place.projection.length);
  for (let i = 0; i < zip_len; i++) {
    const [borrow_place, borrow_c] = borrow_projections[i]!;
    const access_c = access_place.projection[i]!;
    // debug!(?borrow_c, ?access_c);

    // Borrow and access path both have more components.
    //
    // Examples:
    //
    // - borrow of `a.(...)`, access to `a.(...)`
    // - borrow of `a.(...)`, access to `b.(...)`
    //
    // Here we only see the components we have checked so
    // far (in our examples, just the first component). We
    // check whether the components being borrowed vs
    // accessed are disjoint (as in the second example,
    // but not the first).
    switch (place_projection_conflict(tcx, body, borrow_place, borrow_c, access_c, bias)) {
      case "Arbitrary": {
        // We have encountered different fields of potentially
        // the same union - the borrow now partially overlaps.
        //
        // There is no *easy* way of comparing the fields
        // further on, because they might have different types
        // (e.g., borrows of `u.a.0` and `u.b.y` where `.0` and
        // `.y` come from different structs).
        //
        // We could try to do some things here - e.g., count
        // dereferences - but that's probably not a good
        // idea, at least for now, so just give up and
        // report a conflict. This is unsafe code anyway so
        // the user could always use raw pointers.
        // debug!("arbitrary -> conflict");
        return true;
      }
      case "EqualOrDisjoint": {
        // This is the recursive case - proceed to the next element.
        break;
      }
      case "Disjoint": {
        // We have proven the borrow disjoint - further
        // projections will remain disjoint.
        // debug!("disjoint");
        return false;
      }
    }
  }

  if (borrow_place.projection.length > access_place.projection.length) {
    for (const [base, elem] of borrow_projections.slice(access_place.projection.length)) {
      // Borrow path is longer than the access path. Examples:
      //
      // - borrow of `a.b.c`, access to `a.b`
      //
      // Here, we know that the borrow can access a part of
      // our place. This is a conflict if that is a part our
      // access cares about.

      const base_ty = base.ty(body, tcx).ty;
      const kind = base_ty.kind();

      if (access.$ === "Shallow" && (access._0 === "ArrayLength" || access._0 === "FakeBorrow")) {
        // The array length is like additional fields on the
        // type; it does not overlap any existing data there.
        // Furthermore, if cannot actually be a prefix of any
        // borrowed place (at least in MIR as it is currently.)
        //
        // e.g., a (mutable) borrow of `a[5]` while we read the
        // array length of `a`.
        // debug!("borrow_conflicts_with_place: implicit field");
        return false;
      } else if (elem.$ === "Deref" && access.$ === "Shallow" && access._0 === undefined) {
        // e.g., a borrow of `*x.y` while we shallowly access `x.y` or some
        // prefix thereof - the shallow access can't touch anything behind
        // the pointer.
        // debug!("borrow_conflicts_with_place: shallow access behind ptr");
        return false;
      } else if (elem.$ === "Deref" && kind.$ === "Ref" && kind._2 === "Not") {
        // Shouldn't be tracked
        return bug("Tracking borrow behind shared reference.");
      } else if (elem.$ === "Deref" && kind.$ === "Ref" && kind._2 === "Mut" && access.$ === "Drop") {
        // Values behind a mutable reference are not access either by dropping a
        // value, or by StorageDead
        // debug!("borrow_conflicts_with_place: drop access behind ptr");
        return false;
      } else if (elem.$ === "PhantomDeref" && access.$ === "Shallow" && access._0 === undefined) {
        // e.g., a reborrow of `x.y` while we shallowly access `x.y` or some prefix
        // thereof - the shallow access cannot invalidate the reborrowed copy.
        // debug!("borrow_conflicts_with_place: shallow access behind reborrow");
        return false;
      } else if (elem.$ === "Field" && kind.$ === "Adt" && access.$ === "Drop") {
        const def = kind._0;
        // Drop can read/write arbitrary projections, so places
        // conflict regardless of further projections.
        if (def.has_dtor(tcx)) {
          return true;
        }
      } else {
        // (ProjectionElem::Deref, _, Deep)
        // | (ProjectionElem::Deref, _, AccessDepth::Drop)
        // | (ProjectionElem::PhantomDeref, _, _)
        // | (ProjectionElem::Field { .. }, _, _)
        // | (ProjectionElem::Index { .. }, _, _)
        // | (ProjectionElem::ConstantIndex { .. }, _, _)
        // | (ProjectionElem::Subslice { .. }, _, _)
        // | (ProjectionElem::OpaqueCast { .. }, _, _)
        // | (ProjectionElem::Downcast { .. }, _, _)
        // | (ProjectionElem::UnwrapUnsafeBinder(_), _, _) => {
        // Recursive case. This can still be disjoint on a
        // further iteration if this a shallow access and
        // there's a deref later on, e.g., a borrow
        // of `*x.y` while accessing `x`.
      }
    }
  }

  // Borrow path ran out but access path may not
  // have. Examples:
  //
  // - borrow of `a.b`, access to `a.b.c`
  // - borrow of `a.b`, access to `a.b`
  //
  // In the first example, where we didn't run out of
  // access, the borrow can access all of our place, so we
  // have a conflict.
  //
  // If the second example, where we did, then we still know
  // that the borrow can access a *part* of our place that
  // our access cares about, so we still have a conflict.
  if (borrow_kind.$ === "Fake" && borrow_kind._0 === "Shallow" && borrow_place.projection.length < access_place.projection.length) {
    // debug!("borrow_conflicts_with_place: shallow borrow");
    return false;
  } else {
    // debug!("borrow_conflicts_with_place: full borrow, CONFLICT");
    return true;
  }
}

// Given that the bases of `elem1` and `elem2` are always either equal
// or disjoint (and have the same type!), return the overlap situation
// between `elem1` and `elem2`.
// rustc: compiler/rustc_borrowck/src/places_conflict.rs:298 place_projection_conflict
function place_projection_conflict(
  tcx: TyCtxt,
  body: Body,
  pi1: PlaceRef,
  pi1_elem: PlaceElem,
  pi2_elem: PlaceElem,
  bias: PlaceConflictBias,
): Overlap {
  const e1 = pi1_elem;
  const e2 = pi2_elem;
  if (e1.$ === "Deref" && e2.$ === "Deref") {
    // derefs (e.g., `*x` vs. `*x`) - recur.
    // debug!("place_element_conflict: DISJOINT-OR-EQ-DEREF");
    return "EqualOrDisjoint";
  } else if (e1.$ === "PhantomDeref" && e2.$ === "PhantomDeref") {
    // phantom derefs (e.g., `x` vs. `x`) - recur.
    // debug!("place_element_conflict: DISJOINT-OR-EQ-PHANTOM-DEREF");
    return "EqualOrDisjoint";
  } else if (e1.$ === "OpaqueCast" && e2.$ === "OpaqueCast") {
    // casts to other types may always conflict irrespective of the type being cast to.
    // debug!("place_element_conflict: DISJOINT-OR-EQ-OPAQUE");
    return "EqualOrDisjoint";
  } else if (e1.$ === "Field" && e2.$ === "Field") {
    const f1 = e1._0;
    const f2 = e2._0;
    if (f1 === f2) {
      // same field (e.g., `a.y` vs. `a.y`) - recur.
      // debug!("place_element_conflict: DISJOINT-OR-EQ-FIELD");
      return "EqualOrDisjoint";
    } else {
      const ty = pi1.ty(body, tcx).ty;
      if (ty.is_union()) {
        // Different fields of a union, we are basically stuck.
        // debug!("place_element_conflict: STUCK-UNION");
        return "Arbitrary";
      } else {
        // Different fields of a struct (`a.x` vs. `a.y`). Disjoint!
        // debug!("place_element_conflict: DISJOINT-FIELD");
        return "Disjoint";
      }
    }
  } else if (e1.$ === "Downcast" && e2.$ === "Downcast") {
    const v1 = e1._1;
    const v2 = e2._1;
    // different variants are treated as having disjoint fields,
    // even if they occupy the same "space", because it's
    // impossible for 2 variants of the same enum to exist
    // (and therefore, to be borrowed) at the same time.
    //
    // Note that this is different from unions - we *do* allow
    // this code to compile:
    //
    // ```
    // fn foo(x: &mut Result<i32, i32>) {
    //     let mut v = None;
    //     if let Ok(ref mut a) = *x {
    //         v = Some(a);
    //     }
    //     // here, you would *think* that the
    //     // *entirety* of `x` would be borrowed,
    //     // but in fact only the `Ok` variant is,
    //     // so the `Err` variant is *entirely free*:
    //     if let Err(ref mut a) = *x {
    //         v = Some(a);
    //     }
    //     drop(v);
    // }
    // ```
    if (v1 === v2) {
      // debug!("place_element_conflict: DISJOINT-OR-EQ-FIELD");
      return "EqualOrDisjoint";
    } else {
      // debug!("place_element_conflict: DISJOINT-FIELD");
      return "Disjoint";
    }
  } else if (
    (e1.$ === "Index" && (e2.$ === "Index" || e2.$ === "ConstantIndex" || e2.$ === "Subslice")) ||
    ((e1.$ === "ConstantIndex" || e1.$ === "Subslice") && e2.$ === "Index")
  ) {
    // Array indexes (`a[0]` vs. `a[i]`). These can either be disjoint
    // (if the indexes differ) or equal (if they are the same).
    switch (bias) {
      case "Overlap": {
        // If we are biased towards overlapping, then this is the recursive
        // case that gives "equal *or* disjoint" its meaning.
        // debug!("place_element_conflict: DISJOINT-OR-EQ-ARRAY-INDEX");
        return "EqualOrDisjoint";
      }
      case "NoOverlap": {
        // If we are biased towards no overlapping, then this is disjoint.
        // debug!("place_element_conflict: DISJOINT-ARRAY-INDEX");
        return "Disjoint";
      }
    }
  } else if (e1.$ === "ConstantIndex" && e2.$ === "ConstantIndex" && e1.from_end === e2.from_end) {
    // (ConstantIndex { offset: o1, from_end: false, .. }, ConstantIndex { offset: o2, from_end: false, .. })
    // | (ConstantIndex { offset: o1, from_end: true, .. }, ConstantIndex { offset: o2, from_end: true, .. })
    const o1 = e1.offset;
    const o2 = e2.offset;
    if (o1 === o2) {
      // debug!("place_element_conflict: DISJOINT-OR-EQ-ARRAY-CONSTANT-INDEX");
      return "EqualOrDisjoint";
    } else {
      // debug!("place_element_conflict: DISJOINT-ARRAY-CONSTANT-INDEX");
      return "Disjoint";
    }
  } else if (e1.$ === "ConstantIndex" && e2.$ === "ConstantIndex") {
    // (ConstantIndex { offset: offset_from_begin, min_length: min_length1, from_end: false },
    //  ConstantIndex { offset: offset_from_end, min_length: min_length2, from_end: true })
    // | (ConstantIndex { offset: offset_from_end, min_length: min_length1, from_end: true },
    //    ConstantIndex { offset: offset_from_begin, min_length: min_length2, from_end: false })
    const [offset_from_begin, offset_from_end] = !e1.from_end ? [e1.offset, e2.offset] : [e2.offset, e1.offset];
    const min_length1 = e1.min_length;
    const min_length2 = e2.min_length;
    // both patterns matched so it must be at least the greater of the two
    const min_length = Math.max(min_length1, min_length2);
    // `offset_from_end` can be in range `[1..min_length]`, 1 indicates the last
    // element (like -1 in Python) and `min_length` the first.
    // Therefore, `min_length - offset_from_end` gives the minimal possible
    // offset from the beginning
    if (offset_from_begin >= min_length - offset_from_end) {
      // debug!("place_element_conflict: DISJOINT-OR-EQ-ARRAY-CONSTANT-INDEX-FE");
      return "EqualOrDisjoint";
    } else {
      // debug!("place_element_conflict: DISJOINT-ARRAY-CONSTANT-INDEX-FE");
      return "Disjoint";
    }
  } else if (
    (e1.$ === "ConstantIndex" && !e1.from_end && e2.$ === "Subslice" && !e2.from_end) ||
    (e1.$ === "Subslice" && !e1.from_end && e2.$ === "ConstantIndex" && !e2.from_end)
  ) {
    const [offset, from, to] = e1.$ === "ConstantIndex" ? [e1.offset, (e2 as SubsliceElem).from, (e2 as SubsliceElem).to] : [(e2 as ConstantIndexElem).offset, (e1 as SubsliceElem).from, (e1 as SubsliceElem).to];
    if (from <= offset && offset < to) {
      // debug!("place_element_conflict: DISJOINT-OR-EQ-ARRAY-CONSTANT-INDEX-SUBSLICE");
      return "EqualOrDisjoint";
    } else {
      // debug!("place_element_conflict: DISJOINT-ARRAY-CONSTANT-INDEX-SUBSLICE");
      return "Disjoint";
    }
  } else if ((e1.$ === "ConstantIndex" && !e1.from_end && e2.$ === "Subslice") || (e1.$ === "Subslice" && e2.$ === "ConstantIndex" && !e2.from_end)) {
    const [offset, from] = e1.$ === "ConstantIndex" ? [e1.offset, (e2 as SubsliceElem).from] : [(e2 as ConstantIndexElem).offset, (e1 as SubsliceElem).from];
    if (offset >= from) {
      // debug!("place_element_conflict: DISJOINT-OR-EQ-SLICE-CONSTANT-INDEX-SUBSLICE");
      return "EqualOrDisjoint";
    } else {
      // debug!("place_element_conflict: DISJOINT-SLICE-CONSTANT-INDEX-SUBSLICE");
      return "Disjoint";
    }
  } else if (
    (e1.$ === "ConstantIndex" && e1.from_end && e2.$ === "Subslice" && e2.from_end) ||
    (e1.$ === "Subslice" && e1.from_end && e2.$ === "ConstantIndex" && e2.from_end)
  ) {
    const [offset, to] = e1.$ === "ConstantIndex" ? [e1.offset, (e2 as SubsliceElem).to] : [(e2 as ConstantIndexElem).offset, (e1 as SubsliceElem).to];
    if (offset > to) {
      // debug!("place_element_conflict: DISJOINT-OR-EQ-SLICE-CONSTANT-INDEX-SUBSLICE-FE");
      return "EqualOrDisjoint";
    } else {
      // debug!("place_element_conflict: DISJOINT-SLICE-CONSTANT-INDEX-SUBSLICE-FE");
      return "Disjoint";
    }
  } else if (e1.$ === "Subslice" && !e1.from_end && e2.$ === "Subslice" && !e2.from_end) {
    const f1 = e1.from;
    const t1 = e1.to;
    const f2 = e2.from;
    const t2 = e2.to;
    if (f2 >= t1 || f1 >= t2) {
      // debug!("place_element_conflict: DISJOINT-ARRAY-SUBSLICES");
      return "Disjoint";
    } else {
      // debug!("place_element_conflict: DISJOINT-OR-EQ-ARRAY-SUBSLICES");
      return "EqualOrDisjoint";
    }
  } else if (e1.$ === "Subslice" && e2.$ === "Subslice") {
    // debug!("place_element_conflict: DISJOINT-OR-EQ-SLICE-SUBSLICES");
    return "EqualOrDisjoint";
  } else if (
    e1.$ === "Deref" ||
    e1.$ === "PhantomDeref" ||
    e1.$ === "Field" ||
    e1.$ === "Index" ||
    e1.$ === "ConstantIndex" ||
    e1.$ === "OpaqueCast" ||
    e1.$ === "Subslice" ||
    e1.$ === "Downcast"
  ) {
    return bug(
      `mismatched projections in place_element_conflict: ${debug_ProjectionElem(pi1_elem, PLAIN, debug_Local, debug_Ty)} and ${debug_ProjectionElem(pi2_elem, PLAIN, debug_Local, debug_Ty)}`,
    );
  } else {
    // (ProjectionElem::UnwrapUnsafeBinder(_), _)
    return panic("not implemented");
  }
}

type ConstantIndexElem = Extract<PlaceElem, { $: "ConstantIndex" }>;
type SubsliceElem = Extract<PlaceElem, { $: "Subslice" }>;
