// Port of compiler/rustc_mir_build/src/builder/matches/util.rs (lane mb-matches-c; declared by builder-contract).
// `impl Builder` methods go on its prototype, `FakeBorrowCollector` (generated class, util.gen.ts) gets its methods by
// prototype assignment (builder/mod.ts header).
import { type Mutability } from "../../../rustc_ast_ir/lib.ts";
import { IndexVec } from "../../../rustc_index/vec.ts";
import {
  type BasicBlock,
  BorrowKind,
  type FakeBorrowKind,
  FakeBorrowKind_discriminant,
  type Local,
  LocalDecl,
  LocalInfo,
  type Place,
  type SourceInfo,
} from "../../../rustc_middle/mir/mod.ts";
import { Ty } from "../../../rustc_middle/ty/mod.ts";
import { KeyedMap } from "../../../rust_ts/keyed.ts";
import { intern_key } from "../../../rust_ts/intern_key.ts";
import { type PlaceBase } from "../expr/as_place.gen.ts";
import { type Binding, type Candidate, type FlatPat, type MatchPairTree } from "./mod.gen.ts";
import { Builder } from "../mod.ts";
import { type Span } from "../../../rustc_span/lib.ts";
import { FakeBorrowCollector } from "./util.gen.ts";
export * from "./util.gen.ts";

declare module "../mod.ts" {
  interface Builder {
    // util.rs:17 (lane mb-matches-c)
    false_edges(from_block: BasicBlock, real_target: BasicBlock, imaginary_target: BasicBlock, source_info: SourceInfo): void;
  }
}

declare module "./util.gen.ts" {
  interface FakeBorrowCollector {
    // util.rs:117 (lane mb-matches-c)
    fake_borrow(place: Place, kind: FakeBorrowKind): void;
    // util.rs:127 (lane mb-matches-c)
    fake_borrow_deref_prefixes(place: Place, kind: FakeBorrowKind): void;
    // util.rs:141 (lane mb-matches-c)
    visit_candidate(candidate: Candidate): void;
    // util.rs:152 (lane mb-matches-c)
    visit_flat_pat(flat_pat: FlatPat): void;
    // util.rs:163 (lane mb-matches-c)
    visit_match_pair(match_pair: MatchPairTree): void;
    // util.rs:198 (lane mb-matches-c)
    visit_binding({ source }: Binding): void;
  }
}

/// Creates a false edge to `imaginary_target` and a real edge to
/// real_target. If `imaginary_target` is none, or is the same as the real
/// target, a Goto is generated instead to simplify the generated MIR.
// rustc: compiler/rustc_mir_build/src/builder/matches/util.rs:17 false_edges
Builder.prototype.false_edges = function (this: Builder, from_block: BasicBlock, real_target: BasicBlock, imaginary_target: BasicBlock, source_info: SourceInfo): void {
  if (imaginary_target !== real_target) {
    this.cfg.terminate(from_block, source_info, { $: "FalseEdge", real_target, imaginary_target });
  } else {
    this.cfg.goto(from_block, source_info, real_target);
  }
};

/// Determine the set of places that have to be stable across match guards.
///
/// Returns a list of places that need a fake borrow along with a local to store it.
///
/// Match exhaustiveness checking is not able to handle the case where the place being matched on is
/// mutated in the guards. We add "fake borrows" to the guards that prevent any mutation of the
/// place being matched. There are a some subtleties:
///
/// 1. Borrowing `*x` doesn't prevent assigning to `x`. If `x` is a shared reference, the borrow
///    isn't even tracked. As such we have to add fake borrows of any prefixes of a place.
/// 2. We don't want `match x { (Some(_), _) => (), .. }` to conflict with mutable borrows of `x.1`, so we
///    only add fake borrows for places which are bound or tested by the match.
/// 3. We don't want `match x { Some(_) => (), .. }` to conflict with mutable borrows of `(x as
///    Some).0`, so the borrows are a special shallow borrow that only affects the place and not its
///    projections.
///    ```rust
///    let mut x = (Some(0), true);
///    match x {
///        (Some(_), false) => {}
///        _ if { if let Some(ref mut y) = x.0 { *y += 1 }; true } => {}
///        _ => {}
///    }
///    ```
/// 4. The fake borrows may be of places in inactive variants, e.g. here we need to fake borrow `x`
///    and `(x as Some).0`, but when we reach the guard `x` may not be `Some`.
///    ```rust
///    let mut x = (Some(Some(0)), true);
///    match x {
///        (Some(Some(_)), false) => {}
///        _ if { if let Some(Some(ref mut y)) = x.0 { *y += 1 }; true } => {}
///        _ => {}
///    }
///    ```
///    So it would be UB to generate code for the fake borrows. They therefore have to be removed by
///    a MIR pass run after borrow checking.
// rustc: compiler/rustc_mir_build/src/builder/matches/util.rs:71 collect_fake_borrows
export function collect_fake_borrows(cx: Builder, candidates: readonly Candidate[], temp_span: Span, scrutinee_base: PlaceBase): [Place, Local, FakeBorrowKind][] {
  if (candidates.every((candidate) => !candidate.has_guard)) {
    // Fake borrows are only used when there is a guard.
    return [];
  }
  // PORT: `FxIndexMap<Place, FakeBorrowKind>`: a `KeyedMap` keyed by `intern_key` (`Place`'s derived `Eq`).
  const collector = new FakeBorrowCollector(cx, scrutinee_base, new KeyedMap<Place, FakeBorrowKind>(intern_key));
  for (const candidate of candidates) {
    collector.visit_candidate(candidate);
  }
  const fake_borrows = collector.fake_borrows;
  // debug!("add_fake_borrows fake_borrows = {:?}", fake_borrows);
  const tcx = cx.tcx;
  const out: [Place, Local, FakeBorrowKind][] = [];
  for (const [matched_place, borrow_kind] of fake_borrows) {
    const fake_borrow_deref_ty = matched_place.ty(cx.local_decls, tcx).ty;
    const fake_borrow_ty = Ty.new_imm_ref(tcx, tcx.lifetimes.re_erased, fake_borrow_deref_ty);
    const fake_borrow_temp_decl = LocalDecl.new(fake_borrow_ty, temp_span);
    fake_borrow_temp_decl.local_info = { $: "Set", _0: LocalInfo.FakeBorrow };
    const fake_borrow_temp = IndexVec.push<Local, LocalDecl>(cx.local_decls, fake_borrow_temp_decl);
    out.push([matched_place, fake_borrow_temp, borrow_kind]);
  }
  return out;
}

// Fake borrow this place and its dereference prefixes.
// rustc: compiler/rustc_mir_build/src/builder/matches/util.rs:117 fake_borrow
FakeBorrowCollector.prototype.fake_borrow = function (this: FakeBorrowCollector, place: Place, kind: FakeBorrowKind): void {
  const k = this.fake_borrows.get(place);
  if (k !== undefined && FakeBorrowKind_discriminant[k] >= FakeBorrowKind_discriminant[kind]) {
    return;
  }
  this.fake_borrows.set(place, kind);
  // Also fake borrow the prefixes of any fake borrow.
  this.fake_borrow_deref_prefixes(place, kind);
};

// Fake borrow the prefixes of this place that are dereferences.
// rustc: compiler/rustc_mir_build/src/builder/matches/util.rs:127 fake_borrow_deref_prefixes
FakeBorrowCollector.prototype.fake_borrow_deref_prefixes = function (this: FakeBorrowCollector, place: Place, kind: FakeBorrowKind): void {
  const projections = place.as_ref().iter_projections();
  for (let i = projections.length - 1; i >= 0; i--) {
    const [place_ref, elem] = projections[i]!;
    if (elem.$ === "Deref") {
      // Insert a shallow borrow after a deref. For other projections the borrow of
      // `place_ref` will conflict with any mutation of `place.base`.
      const place = place_ref.to_place(this.cx.tcx);
      const k = this.fake_borrows.get(place);
      if (k !== undefined && FakeBorrowKind_discriminant[k] >= FakeBorrowKind_discriminant[kind]) {
        return;
      }
      this.fake_borrows.set(place, kind);
    }
  }
};

// rustc: compiler/rustc_mir_build/src/builder/matches/util.rs:141 visit_candidate
FakeBorrowCollector.prototype.visit_candidate = function (this: FakeBorrowCollector, candidate: Candidate): void {
  for (const binding of candidate.extra_data.bindings) {
    if (binding.$ === "One") {
      this.visit_binding(binding._0);
    }
  }
  for (const match_pair of candidate.match_pairs) {
    this.visit_match_pair(match_pair);
  }
};

// rustc: compiler/rustc_mir_build/src/builder/matches/util.rs:152 visit_flat_pat
FakeBorrowCollector.prototype.visit_flat_pat = function (this: FakeBorrowCollector, flat_pat: FlatPat): void {
  for (const binding of flat_pat.extra_data.bindings) {
    if (binding.$ === "One") {
      this.visit_binding(binding._0);
    }
  }
  for (const match_pair of flat_pat.match_pairs) {
    this.visit_match_pair(match_pair);
  }
};

// rustc: compiler/rustc_mir_build/src/builder/matches/util.rs:163 visit_match_pair
FakeBorrowCollector.prototype.visit_match_pair = function (this: FakeBorrowCollector, match_pair: MatchPairTree): void {
  const kind = match_pair.kind;
  switch (kind.$) {
    case "Or": {
      for (const flat_pat of kind.or_subpats) {
        this.visit_flat_pat(flat_pat);
      }
      break;
    }
    case "Testable": {
      const { place, testable_case, subpairs } = kind;
      if (testable_case.$ === "Deref") {
        // The subpairs of a deref pattern are all places relative to the deref temporary, so we
        // don't fake borrow them. Problem is, if we only shallowly fake-borrowed
        // `match_pair.place`, this would allow:
        // ```
        // let mut b = Box::new(false);
        // match b {
        //     deref!(true) => {} // not reached because `*b == false`
        //     _ if { *b = true; false } => {} // not reached because the guard is `false`
        //     deref!(false) => {} // not reached because the guard changed it
        //     // UB because we reached the unreachable.
        // }
        // ```
        // Hence we fake borrow using a deep borrow.
        this.fake_borrow(place, "Deep");
      } else {
        // Insert a Shallow borrow of any place that is switched on.
        this.fake_borrow(place, "Shallow");

        for (const subpair of subpairs) {
          this.visit_match_pair(subpair);
        }
      }
      break;
    }
  }
};

// rustc: compiler/rustc_mir_build/src/builder/matches/util.rs:198 visit_binding
FakeBorrowCollector.prototype.visit_binding = function (this: FakeBorrowCollector, { source }: Binding): void {
  if (this.scrutinee_base.$ === "Local" && this.scrutinee_base._0 !== source.local) {
    // The base of this place is a temporary created for deref patterns. We don't emit fake
    // borrows for these as they are not initialized in all branches.
    return;
  }

  // Insert a borrows of prefixes of places that are bound and are
  // behind a dereference projection.
  //
  // These borrows are taken to avoid situations like the following:
  //
  // match x[10] {
  //     _ if { x = &[0]; false } => (),
  //     y => (), // Out of bounds array access!
  // }
  //
  // match *x {
  //     // y is bound by reference in the guard and then by copy in the
  //     // arm, so y is 2 in the arm!
  //     y if { y == 1 && (x = &2) == () } => y,
  //     _ => 3,
  // }
  //
  // We don't just fake borrow the whole place because this is allowed:
  // match u {
  //     _ if { u = true; false } => (),
  //     x => (),
  // }
  this.fake_borrow_deref_prefixes(source, "Shallow");
};

// #[must_use]
// rustc: compiler/rustc_mir_build/src/builder/matches/util.rs:234 ref_pat_borrow_kind
export function ref_pat_borrow_kind(ref_mutability: Mutability): BorrowKind {
  switch (ref_mutability) {
    case "Mut":
      return { $: "Mut", kind: "Default" };
    case "Not":
      return BorrowKind.Shared;
  }
}
