// Port of compiler/rustc_hir_analysis/src/check/mod.rs (lane check-check, wave 17).
/*!

# typeck: check phase

Within the check phase of type check, we check each item one at a time
(bodies of function expressions are checked as part of the containing
function). Inference is used to supply types wherever they are unknown.

By far the most complex case is checking the body of a function. This
can be broken down into several distinct phases:

- gather: creates type variables to represent the type of each local
  variable and pattern binding.

- main: the main pass does the lion's share of the work: it
  determines the types of all expressions, resolves
  methods, checks for most invalid conditions, and so forth. In
  some cases, where a type is unknown, it may create a type or region
  variable and use that as the type of an expression.

  In the process of checking, various constraints will be placed on
  these type variables through the subtyping relationships requested
  through the `demand` module. The `infer` module is in charge
  of resolving those constraints.

- regionck: after main is complete, the regionck pass goes over all
  types looking for regions and making sure that they did not escape
  into places where they are not in scope. This may also influence the
  final assignments of the various region variables if there is some
  flexibility.

- writeback: writes the final types within a function body, replacing
  type variables with their final inferred types. These final types
  are written into the `tcx.node_types` table, which should *never* contain
  any reference to a type variable.

## Intermediate types

While type checking a function, the intermediate types for the
expressions, blocks, and so forth contained within the function are
stored in `fcx.node_types` and `fcx.node_args`. These types
may contain unresolved type variables. After type checking is
complete, the functions in the writeback module are used to take the
types from this table, resolve them, and then write them into their
permanent home in the type context `tcx`.

This means that during inferencing you should use `fcx.write_ty()`
and `fcx.expr_ty()` / `fcx.node_ty()` to write/obtain the types of
nodes within the function.

The types of top-level items, which never contain unbound type
variables, are stored directly into the `tcx` typeck_results.

N.B., a type variable is not the same thing as a type parameter. A
type variable is an instance of a type parameter. That is,
given a generic function `fn foo<T>(t: T)`, while checking the
function `foo`, the type `ty_param(0)` refers to the type `T`, which
is treated in abstract. However, when `foo()` is called, `T` will be
instantiated with a fresh type variable `N`. This variable will
eventually be resolved to some concrete type (which might itself be
a type parameter).

*/
//
// Init order: top-level code here touches only other crates; ./check.ts and the other rustc_hir_analysis modules are
// read inside function bodies only.

// pub mod always_applicable;   (wave 17: check-region-intrinsic)
// mod check;
// mod compare_eii;             (wave 17: check-compare)
// mod compare_impl_item;       (wave 17: check-compare)
// mod entry;                   (wave 17)
// pub mod intrinsic;           (wave 17: check-region-intrinsic)
// mod region;                  (wave 17: check-region-intrinsic)
// pub mod wfcheck;             (wave 17: check-wf-a/-b)

// pub use check::check_abi;
export { check_abi } from "./check.ts";
