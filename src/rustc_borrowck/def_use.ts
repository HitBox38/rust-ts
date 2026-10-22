// Port of compiler/rustc_borrowck/src/def_use.rs (lane borrowck-contract: declarations; filled by lane bck-core, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
import type { MutatingUseContext, NonMutatingUseContext, NonUseContext, PlaceContext } from "../rustc_middle/mir/visit.ts";
import { bug } from "../rustc_span/macros.ts";
import { unreachable } from "../std/panic.ts";
import type { DefUse } from "./def_use.gen.ts";
export * from "./def_use.gen.ts";

// PORT: `PlaceContext::MutatingUse(MutatingUseContext::<k>)` / `NonMutatingUse(..)` / `NonUse(NonUseContext::<k>)` patterns.
function mu(c: PlaceContext, k: MutatingUseContext): boolean {
  return c.$ === "MutatingUse" && c._0 === k;
}
function nmu(c: PlaceContext, k: NonMutatingUseContext): boolean {
  return c.$ === "NonMutatingUse" && c._0 === k;
}
function nu(c: PlaceContext, k: NonUseContext["$"]): boolean {
  return c.$ === "NonUse" && c._0.$ === k;
}

// rustc: compiler/rustc_borrowck/src/def_use.rs:13 categorize
export function categorize(context: PlaceContext): DefUse | undefined {
  // PORT: the `match` is an if-chain in upstream arm order (`mu` / `nmu` / `nu` test one `PlaceContext` variant).
  if (
    ///////////////////////////////////////////////////////////////////////////
    // DEFS

    mu(context, "Store") ||
    // We let Call define the result in both the success and
    // unwind cases. This is not really correct, however it
    // does not seem to be observable due to the way that we
    // generate MIR. To do things properly, we would apply
    // the def in call only to the input from the success
    // path and not the unwind path. -nmatsakis
    mu(context, "Call") ||
    mu(context, "AsmOutput") ||
    mu(context, "Yield") ||
    // Storage live and storage dead aren't proper defines, but we can ignore
    // values that come before them.
    nu(context, "StorageLive") ||
    nu(context, "StorageDead")
  ) {
    return "Def";
  }

  if (
    ///////////////////////////////////////////////////////////////////////////
    // REGULAR USES
    //
    // These are uses that occur *outside* of a drop. For the
    // purposes of NLL, these are special in that **all** the
    // lifetimes appearing in the variable must be live for each regular use.

    nmu(context, "Projection") ||
    mu(context, "Projection") ||
    // Borrows only consider their local used at the point of the borrow.
    // This won't affect the results since we use this analysis for coroutines
    // and we only care about the result at suspension points. Borrows cannot
    // cross suspension points so this behavior is unproblematic.
    mu(context, "Borrow") ||
    nmu(context, "SharedBorrow") ||
    nmu(context, "FakeBorrow") ||
    // `PlaceMention` and `AscribeUserType` both evaluate the place, which must not
    // contain dangling references.
    nmu(context, "PlaceMention") ||
    nu(context, "AscribeUserTy") ||
    mu(context, "RawBorrow") ||
    nmu(context, "RawBorrow") ||
    nmu(context, "Inspect") ||
    nmu(context, "Copy") ||
    nmu(context, "Move")
  ) {
    return "Use";
  }

  ///////////////////////////////////////////////////////////////////////////
  // DROP USES
  //
  // These are uses that occur in a DROP (a MIR drop, not a
  // call to `std::mem::drop()`). For the purposes of NLL,
  // uses in drop are special because `#[may_dangle]`
  // attributes can affect whether lifetimes must be live.
  if (mu(context, "Drop")) {
    return "Drop";
  }

  // Debug info is neither def nor use.
  if (nu(context, "VarDebugInfo")) {
    return undefined;
  }

  // Backwards incompatible drop hint is not a use, just a marker for linting.
  if (nu(context, "BackwardIncompatibleDropHint")) {
    return undefined;
  }

  if (mu(context, "SetDiscriminant")) {
    return bug("These statements are not allowed in this MIR phase");
  }
  return unreachable();
}
