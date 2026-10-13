// Port of compiler/rustc_middle/src/ty/fast_reject.rs: rustc_middle's instantiation of rustc_type_ir's
// fast_reject (`pub use rustc_type_ir::fast_reject::*`) at `DefId` / `TyCtxt`. `DeepRejectCtxt` (M3) is not
// re-exported: the rustc_type_ir port skips it.
import { type DefId, debug_DefId } from "../../rustc_span/def_id.ts";
import { debug_SimplifiedType as debug_SimplifiedType_, SimplifiedType as SimplifiedType_, SimplifiedType_key as SimplifiedType_key_ } from "../../rustc_type_ir/fast_reject.ts";
import type { Fmt } from "../../std/fmt.ts";
import { DefId_hash_key } from "../query/caches.ts";

export { TreatParams, debug_TreatParams } from "../../rustc_type_ir/fast_reject.ts";

export type SimplifiedType = SimplifiedType_<DefId>;
export const SimplifiedType = SimplifiedType_;

/** `<SimplifiedType as Debug>::fmt` at `DefId`. */
export function debug_SimplifiedType(v: SimplifiedType, f: Fmt): string {
  return debug_SimplifiedType_(v, f, debug_DefId);
}

/** PORT: `SimplifiedType` as a `KeyedMap` key (`DefId` by `impl Hash for DefId`, query/caches.ts). */
export function SimplifiedType_key(v: SimplifiedType): string {
  return SimplifiedType_key_(v, DefId_hash_key);
}
