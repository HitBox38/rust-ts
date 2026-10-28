//! This module contains `StableHash` implementations for various data types
//! from `rustc_middle::ty` in no particular order.
// Port of compiler/rustc_middle/src/ty/impls_ty.rs (lane misc-blockers).
// PORT: the impls are `stable_hash_<T>` fns (PORTING §5 "pass function tables"); the generated derives of the type-system
// types (tools/codegen sets rustc_ty / rustc_middle) call them through tools/codegen/stable_hash.json.
import { Fingerprint } from "../../rustc_data_structures/fingerprint.ts";
import {
  type StableHash,
  type StableHashCtxt,
  StableHasher,
  stable_hash_bool,
  stable_hash_Fingerprint,
  stable_hash_slice,
  stable_hash_tuple3,
} from "../../rustc_data_structures/stable_hash.ts";
import { stable_hash_GenericArgKind } from "../../rustc_type_ir/ty_stable_hash.gen.ts";
import { unported } from "../../std/panic.ts";
import type { AllocId } from "../mir/interpret/mod.ts";
import { CtfeProvenance } from "../mir/interpret/pointer.ts";
import { with_opt } from "./context/tls.ts";
import { GenericArg } from "./generic_args.ts";
import type { RawList } from "./list.ts";

// Note: this cache makes an *enormous* performance difference on certain benchmarks. E.g.
// without it, compiling `diesel-2.2.10` can be 74% slower, and compiling
// `deeply-nested-multi` can be ~4,000x slower(!)
// PORT: `thread_local! static CACHE: RefCell<FxHashMap<(*const (), StableHashControls), Fingerprint>>`: keyed by the
// interned list object (its address), then by `StableHashControls` (its one field, `hash_spans`).
const RawList_CACHE = new Map<object, Map<boolean, Fingerprint>>();

// rustc: compiler/rustc_middle/src/ty/impls_ty.rs:20 stable_hash
/** `impl<'tcx, H, T: StableHash> StableHash for &'tcx ty::list::RawList<H, T>` */
export function stable_hash_RawList<H, T>(self: RawList<H, T>, hcx: StableHashCtxt, hasher: StableHasher, stable_hash_T: StableHash<T>): void {
  const hash = ((): Fingerprint => {
    const key = hcx.stable_hash_controls().hash_spans;
    let by_controls = RawList_CACHE.get(self);
    const cached = by_controls?.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const hasher = StableHasher.new();
    // `self[..]`: the elements as a slice
    stable_hash_slice(self, hcx, hasher, stable_hash_T);

    const hash: Fingerprint = hasher.finish(Fingerprint);
    if (by_controls === undefined) {
      by_controls = new Map();
      RawList_CACHE.set(self, by_controls);
    }
    by_controls.set(key, hash);
    return hash;
  })();

  stable_hash_Fingerprint(hash, hcx, hasher);
}

// rustc: compiler/rustc_middle/src/ty/impls_ty.rs:48 stable_hash
/** `impl<'tcx> StableHash for ty::GenericArg<'tcx>` */
export function stable_hash_GenericArg(self: GenericArg, hcx: StableHashCtxt, hasher: StableHasher): void {
  stable_hash_GenericArgKind(GenericArg.kind(self), hcx, hasher);
}

// AllocIds get resolved to whatever they point to (to be stable)
// rustc: compiler/rustc_middle/src/ty/impls_ty.rs:55 stable_hash
export function stable_hash_AllocId(self: AllocId, hcx: StableHashCtxt, hasher: StableHasher): void {
  with_opt((tcx) => {
    // trace!("hashing {:?}", *self);
    if (tcx === undefined) unported("can't hash AllocIds during hir lowering"); // `tcx.expect(..)`
    const global_alloc = tcx.try_get_global_alloc(self);
    // PORT: `Option<GlobalAlloc>: StableHash` (the derive on mir::interpret::GlobalAlloc) is not generated.
    void global_alloc;
    void hcx;
    void hasher;
    unported("rustc_middle::mir::interpret::GlobalAlloc: StableHash (derive not generated)");
  });
}

// rustc: compiler/rustc_middle/src/ty/impls_ty.rs:65 stable_hash
export function stable_hash_CtfeProvenance(self: CtfeProvenance, hcx: StableHashCtxt, hasher: StableHasher): void {
  stable_hash_tuple3(CtfeProvenance.into_parts(self), hcx, hasher, stable_hash_AllocId, stable_hash_bool, stable_hash_bool);
}
