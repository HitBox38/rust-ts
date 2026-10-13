// Port of compiler/rustc_middle/src/ty/context/tls.rs.
//
// PORT: the Rayon `TLV` thread-local is a module-level `let` (PORTING §5 "Global state");
// `enter_context` restores it in `finally` (upstream's `defer` guard). No dep graph (D3): the
// `task_deps` field is not ported.
import { panic } from "../../../std/panic.ts";
import type { QueryJobId } from "../../query/job.ts";
import { type GlobalCtxt, TyCtxt } from "../context.ts";

/// This is the implicit state of rustc. It contains the current
/// `TyCtxt` and query. It is updated when creating a local interner or
/// executing a new query. Whenever there's a `TyCtxt` value available
/// you should also have access to an `ImplicitCtxt` through the functions
/// in this module.
export class ImplicitCtxt {
  constructor(
    /// The current `TyCtxt`.
    readonly tcx: TyCtxt,

    /// The current query job, if any.
    readonly query: QueryJobId | undefined,

    /// Used to prevent queries from calling too deeply.
    readonly query_depth: number,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/context/tls.rs:28 new
  static new(gcx: GlobalCtxt): ImplicitCtxt {
    const tcx = new TyCtxt(gcx);
    return new ImplicitCtxt(tcx, undefined, 0);
  }
}

// Import the thread-local variable from Rayon, which is preserved for Rayon jobs.
let TLV: ImplicitCtxt | undefined = undefined;

// rustc: compiler/rustc_middle/src/ty/context/tls.rs:38 erase
function erase(context: ImplicitCtxt): ImplicitCtxt {
  // PORT: `*const ()` erasure of the reference is the object itself.
  return context;
}

// rustc: compiler/rustc_middle/src/ty/context/tls.rs:43 downcast
function downcast(context: ImplicitCtxt): ImplicitCtxt {
  return context;
}

/// Sets `context` as the new current `ImplicitCtxt` for the duration of the function `f`.
// rustc: compiler/rustc_middle/src/ty/context/tls.rs:49 enter_context
export function enter_context<R>(context: ImplicitCtxt, f: () => R): R {
  const old = TLV;
  TLV = erase(context);
  try {
    return f();
  } finally {
    TLV = old;
  }
}

/// Allows access to the current `ImplicitCtxt` in a closure if one is available.
// rustc: compiler/rustc_middle/src/ty/context/tls.rs:63 with_context_opt
export function with_context_opt<R>(f: (icx: ImplicitCtxt | undefined) => R): R {
  const context = TLV;
  if (context === undefined) {
    return f(undefined);
  } else {
    // We could get an `ImplicitCtxt` pointer from another thread.
    // Ensure that `ImplicitCtxt` is `DynSync`.
    return f(downcast(context));
  }
}

/// Allows access to the current `ImplicitCtxt`.
/// Panics if there is no `ImplicitCtxt` available.
// rustc: compiler/rustc_middle/src/ty/context/tls.rs:82 with_context
export function with_context<R>(f: (icx: ImplicitCtxt) => R): R {
  return with_context_opt((opt_context) => {
    if (opt_context === undefined) panic("no ImplicitCtxt stored in tls");
    return f(opt_context);
  });
}

/// Allows access to the `TyCtxt` in the current `ImplicitCtxt`.
/// Panics if there is no `ImplicitCtxt` available.
// rustc: compiler/rustc_middle/src/ty/context/tls.rs:92 with
export function with_<R>(f: (tcx: TyCtxt) => R): R {
  return with_context((context) => f(context.tcx));
}

/// Allows access to the `TyCtxt` in the current `ImplicitCtxt`.
/// The closure is passed None if there is no `ImplicitCtxt` available.
// rustc: compiler/rustc_middle/src/ty/context/tls.rs:103 with_opt
export function with_opt<R>(f: (tcx: TyCtxt | undefined) => R): R {
  return with_context_opt((opt_context) => f(opt_context?.tcx));
}
