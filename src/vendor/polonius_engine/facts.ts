// Port of polonius-engine =0.13.0 `src/facts.rs`.
//
// PORT: `T: FactTypes` is a type-level record of the five atom types (`T["Origin"]`, ...); every `Atom` is a
// number (rustc's are `newtype_index!` handles: `PoloniusRegionVid`, `BorrowIndex`, `LocationIndex`, `Local`,
// `MovePathIndex`), so `From<usize>` / `Into<usize>` / `Atom::index` are the identity and tuples of atoms are
// datafrog `Ord` tuples. Fact tuples are `readonly [..]` arrays.
// PORT: `#[derive(Clone, Debug)]` on `AllFacts` is not ported: rustc never clones or formats the facts
// (`-Znll-facts` writes them with its own `FactWriter`).

/** PORT: `trait Atom: From<usize> + Into<usize> + Copy + Clone + Debug + Eq + Ord + Hash + 'static` (see the header). */
export type Atom = number;
// trait Atom { fn index(self) -> usize; }
// PORT: `Atom::index` is required of the implementor; for every rustc atom it is `as_usize()`, i.e. the number.
// crate: polonius-engine-0.13.0/src/facts.rs:120 index

/** `trait FactTypes: Copy + Clone + Debug { type Origin: Atom; type Loan: Atom; ... }` */
export interface FactTypes {
  Origin: Atom;
  Loan: Atom;
  Point: Atom;
  Variable: Atom;
  Path: Atom;
}

/// The "facts" which are the basis of the NLL borrow analysis.
export interface AllFacts<T extends FactTypes> {
  /// `loan_issued_at(origin, loan, point)` indicates that the `loan` was "issued"
  /// at the given `point`, creating a reference with the `origin`.
  /// Effectively, `origin` may refer to data from `loan` starting at `point` (this is usually
  /// the point *after* a borrow rvalue).
  loan_issued_at: (readonly [T["Origin"], T["Loan"], T["Point"]])[];

  /// `universal_region(origin)` -- this is a "free region" within fn body
  universal_region: T["Origin"][];

  /// `cfg_edge(point1, point2)` for each edge `point1 -> point2` in the control flow
  cfg_edge: (readonly [T["Point"], T["Point"]])[];

  /// `loan_killed_at(loan, point)` when some prefix of the path borrowed at `loan`
  /// is assigned at `point`.
  /// Indicates that the path borrowed by the `loan` has changed in some way that the loan no
  /// longer needs to be tracked. (In particular, mutations to the path that was borrowed
  /// no longer invalidate the loan)
  loan_killed_at: (readonly [T["Loan"], T["Point"]])[];

  /// `subset_base(origin1, origin2, point)` when we require `origin1@point: origin2@point`.
  /// Indicates that `origin1 <= origin2` -- i.e., the set of loans in `origin1` are a subset
  /// of those in `origin2`.
  subset_base: (readonly [T["Origin"], T["Origin"], T["Point"]])[];

  /// `loan_invalidated_at(point, loan)` indicates that the `loan` is invalidated by some action
  /// taking place at `point`; if any origin that references this loan is live, this is an error.
  loan_invalidated_at: (readonly [T["Point"], T["Loan"]])[];

  /// `var_used_at(var, point)` when the variable `var` is used for anything
  /// but a drop at `point`
  var_used_at: (readonly [T["Variable"], T["Point"]])[];

  /// `var_defined_at(var, point)` when the variable `var` is overwritten at `point`
  var_defined_at: (readonly [T["Variable"], T["Point"]])[];

  /// `var_dropped_at(var, point)` when the variable `var` is used in a drop at `point`
  var_dropped_at: (readonly [T["Variable"], T["Point"]])[];

  /// `use_of_var_derefs_origin(variable, origin)`: References with the given
  /// `origin` may be dereferenced when the `variable` is used.
  ///
  /// In rustc, we generate this whenever the type of the variable includes the
  /// given origin.
  use_of_var_derefs_origin: (readonly [T["Variable"], T["Origin"]])[];

  /// `drop_of_var_derefs_origin(var, origin)` when the type of `var` includes
  /// the `origin` and uses it when dropping
  drop_of_var_derefs_origin: (readonly [T["Variable"], T["Origin"]])[];

  /// `child_path(child, parent)` when the path `child` is the direct child of
  /// `parent`, e.g. `child_path(x.y, x)`, but not `child_path(x.y.z, x)`.
  child_path: (readonly [T["Path"], T["Path"]])[];

  /// `path_is_var(path, var)` the root path `path` starting in variable `var`.
  path_is_var: (readonly [T["Path"], T["Variable"]])[];

  /// `path_assigned_at_base(path, point)` when the `path` was initialized at point
  /// `point`. This fact is only emitted for a prefix `path`, and not for the
  /// implicit initialization of all of `path`'s children. E.g. a statement like
  /// `x.y = 3` at `point` would give the fact `path_assigned_at_base(x.y, point)` (but
  /// neither `path_assigned_at_base(x.y.z, point)` nor `path_assigned_at_base(x, point)`).
  path_assigned_at_base: (readonly [T["Path"], T["Point"]])[];

  /// `path_moved_at_base(path, point)` when the `path` was moved at `point`. The
  /// same logic is applied as for `path_assigned_at_base` above.
  path_moved_at_base: (readonly [T["Path"], T["Point"]])[];

  /// `path_accessed_at_base(path, point)` when the `path` was accessed at point
  /// `point`. The same logic as for `path_assigned_at_base` and `path_moved_at_base` applies.
  path_accessed_at_base: (readonly [T["Path"], T["Point"]])[];

  /// These reflect the `'a: 'b` relations that are either declared by the user on function
  /// declarations or which are inferred via implied bounds.
  /// For example: `fn foo<'a, 'b: 'a, 'c>(x: &'c &'a u32)` would have two entries:
  /// - one for the user-supplied subset `'b: 'a`
  /// - and one for the `'a: 'c` implied bound from the `x` parameter,
  /// (note that the transitive relation `'b: 'c` is not necessarily included
  /// explicitly, but rather inferred by polonius).
  known_placeholder_subset: (readonly [T["Origin"], T["Origin"]])[];

  /// `placeholder(origin, loan)` describes a placeholder `origin`, with its associated
  ///  placeholder `loan`.
  placeholder: (readonly [T["Origin"], T["Loan"]])[];
}

export const AllFacts = {
  // impl<T: FactTypes> Default for AllFacts<T>
  // crate: polonius-engine-0.13.0/src/facts.rs:93 default
  default<T extends FactTypes>(): AllFacts<T> {
    return {
      loan_issued_at: [],
      universal_region: [],
      cfg_edge: [],
      loan_killed_at: [],
      subset_base: [],
      loan_invalidated_at: [],
      var_used_at: [],
      var_defined_at: [],
      var_dropped_at: [],
      use_of_var_derefs_origin: [],
      drop_of_var_derefs_origin: [],
      child_path: [],
      path_is_var: [],
      path_assigned_at_base: [],
      path_moved_at_base: [],
      path_accessed_at_base: [],
      known_placeholder_subset: [],
      placeholder: [],
    };
  },
};
