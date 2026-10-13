// Partial port of compiler/rustc_query_impl/src/incremental.rs.
// PORT: no dep graph / on-disk cache (D3). `verify_query_key_hashes` is ported up to its option check
// (`-Z incremental-verify-ich`; `cfg!(debug_assertions)` is false); everything that reads or writes the
// on-disk cache is unported.
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { unported } from "../std/panic.ts";

// rustc: compiler/rustc_query_impl/src/incremental.rs:46 verify_query_key_hashes
export function verify_query_key_hashes(tcx: TyCtxt): null {
  if (tcx.sess.opts.unstable_opts.incremental_verify_ich /* || cfg!(debug_assertions) */) {
    return unported("rustc_query_impl::incremental::verify_query_key_hashes (-Z incremental-verify-ich)");
  }
  return null;
}

/** `encode_query_values` (incremental.rs:22): incremental only (D3). */
export function encode_query_values(_tcx: TyCtxt, _encoder: unknown): null {
  return unported("rustc_query_impl::incremental::encode_query_values (incremental; D3)");
}
