//! Throughout the compiler tree, there are several places which want to have
//! access to state or queries while being inside crates that are dependencies
//! of `rustc_middle`. To facilitate this, we have the
//! `rustc_data_structures::AtomicRef` type, which allows us to setup a global
//! static which can then be set in this file at program startup.
//!
//! See `SPAN_TRACK` for an example of how to set things up.
//!
//! The functions in this file should fall back to the default set in their
//! origin crate when the `TyCtxt` is not present in TLS.
// Port of compiler/rustc_interface/src/callbacks.rs (partial).
//
// PORT: only the `DEF_ID_DEBUG`, `TRACK_FEATURE` and `EMIT_BUG_DIAGNOSTIC` hooks are ported. The other hooks' statics do not exist in rust-ts yet, so
// their callbacks are not ported and `setup_callbacks` leaves them at their defaults:
// - `track_span_parent` (`rustc_span::SPAN_TRACK`): HIR lowering's relative spans + dep tracking (M3, D3);
// - `track_diagnostic` (`rustc_errors::TRACK_DIAGNOSTIC`): `dep_graph.record_diagnostic` (incremental only);
// - `rustc_expand_queries::setup_callbacks()`: crate not ported.
import { DiagMessage, MultiSpan } from "../rustc_error_messages/lib.ts";
import { DiagInner, DiagLocation, Level } from "../rustc_errors/lib.ts";
import { EMIT_BUG_DIAGNOSTIC, type Location } from "../rustc_span/macros.ts";
import type { Span } from "../rustc_span/span_encoding.ts";
import { type DefId, DEF_ID_DEBUG, DefIndex, display_CrateNum } from "../rustc_span/def_id.ts";
import type { Fmt } from "../std/fmt.ts";
import * as tls from "../rustc_middle/ty/context/tls.ts";
import { TRACK_FEATURE } from "../rustc_feature/unstable.ts";
import type { Symbol } from "../rustc_span/symbol.ts";

// rustc: compiler/rustc_interface/src/callbacks.rs:57 track_feature
function track_feature(feature: Symbol): void {
  tls.with_context_opt((icx) => {
    if (icx === undefined) {
      return;
    }
    const tcx = icx.tcx;

    const dep_node_index = tcx.query_system.used_features.get(feature);
    if (dep_node_index !== undefined) {
      tcx.dep_graph.read_index(dep_node_index);
    } else {
      const dep_node_index = tcx.dep_graph.encode_side_effect(tcx, { $: "CheckFeature", symbol: feature });
      tcx.query_system.used_features.set(feature, dep_node_index);
      tcx.dep_graph.read_index(dep_node_index);
    }
  });
}

/// This is a callback from `rustc_hir` as it cannot access the implicit state
/// in `rustc_middle` otherwise.
// rustc: compiler/rustc_interface/src/callbacks.rs:78 def_id_debug
function def_id_debug(def_id: DefId, _f: Fmt): string {
  let s = `DefId(${display_CrateNum(def_id.krate)}:${DefIndex.index(def_id.index)}`;
  tls.with_opt((opt_tcx) => {
    if (opt_tcx !== undefined) {
      s += ` ~ ${opt_tcx.def_path_debug_str(def_id)}`;
    }
  });
  return `${s})`;
}

/// Returns true if it printed the diagnostic, which happens if a `tcx` is available.
// rustc: compiler/rustc_interface/src/callbacks.rs:90 emit_bug_diagnostic
function emit_bug_diagnostic(span: Span | undefined, args: string, location: Location | undefined): boolean {
  // PORT: `undefined` is a location track_caller.ts refused: nothing is printed, so `bug_impl` panics with the message
  // and the panic hook reports the refusal.
  if (location === undefined) return false;
  return tls.with_opt((tcx) => {
    if (tcx !== undefined) {
      const diag = DiagInner.new(Level.Bug, DiagMessage.from_str(`${location.file}:${location.line}:${location.col}: ${args}`));
      if (span !== undefined) {
        diag.span = MultiSpan.from_span(span);
      }
      diag.emitted_at = DiagLocation.from_location(location);
      // Emit the bug without aborting. We let `bug_impl` do the abort because it has
      // `#[track_caller]` which gives a better location. (`#[track_caller]` doesn't work
      // here because this function is called via a function pointer.)
      tcx.dcx().emit_diagnostic(diag);
      return true;
    } else {
      return false;
    }
  });
}

/// Sets up the callbacks in prior crates which we want to refer to the
/// TyCtxt in.
// rustc: compiler/rustc_interface/src/callbacks.rs:115 setup_callbacks
export function setup_callbacks(): void {
  // `rustc_span::SPAN_TRACK.swap(&(track_span_parent as fn(_)))`: not ported (module comment).
  DEF_ID_DEBUG.swap(def_id_debug);
  // `rustc_errors::TRACK_DIAGNOSTIC.swap(..)`: not ported (module comment).
  TRACK_FEATURE.swap(track_feature);
  EMIT_BUG_DIAGNOSTIC.f = emit_bug_diagnostic;
  // `rustc_expand_queries::setup_callbacks()`: not ported (module comment).
}
