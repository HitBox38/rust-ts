// Port of compiler/rustc_hir_typeck/src/intrinsicck.rs (STUB, lane typeck-euv): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// intrinsicck.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/intrinsicck.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
import { unported } from "../std/panic.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { LayoutError } from "../rustc_middle/ty/decls.ts";
import type { Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../rustc_span/lib.ts";
import type { Unnormalized } from "../rustc_type_ir/decls.ts";
import type { Result } from "../std/result.ts";
import type { SizeSkeleton } from "./decls.ts";

// intrinsicck.rs:16 (stub; final signature: decls.ts `Fns_intrinsicck`)
export function unpack_option_like(tcx: TyCtxt, ty: Ty): Ty {
  return unported("rustc_hir_typeck::intrinsicck::unpack_option_like");
}

// intrinsicck.rs:42 (stub; final signature: decls.ts `Fns_intrinsicck`)
export function skeleton_string(ty: Ty, sk: Result<SizeSkeleton, LayoutError>): string {
  return unported("rustc_hir_typeck::intrinsicck::skeleton_string");
}

// intrinsicck.rs:69 (stub; final signature: decls.ts `Fns_intrinsicck`)
export function check_transmute(tcx: TyCtxt, typing_env: TypingEnv, from: Unnormalized<Ty>, to: Unnormalized<Ty>, hir_id: HirId): Result<undefined, ErrorGuaranteed> {
  return unported("rustc_hir_typeck::intrinsicck::check_transmute");
}

// intrinsicck.rs:137 (stub; final signature: decls.ts `Fns_intrinsicck`)
export function check_offload(tcx: TyCtxt, typing_env: TypingEnv, kernel_ty: Ty, args_ty: Ty, ret_ty: Ty, hir_id: HirId): Result<undefined, ErrorGuaranteed> {
  return unported("rustc_hir_typeck::intrinsicck::check_offload");
}

// intrinsicck.rs:240 (stub; final signature: decls.ts `Fns_intrinsicck`)
export function check_transmutes(tcx: TyCtxt, owner: LocalDefId): Result<null, ErrorGuaranteed> {
  return unported("rustc_hir_typeck::intrinsicck::check_transmutes");
}

// intrinsicck.rs:256 (stub; final signature: decls.ts `Fns_intrinsicck`)
export function check_offloads(tcx: TyCtxt, owner: LocalDefId): Result<null, ErrorGuaranteed> {
  return unported("rustc_hir_typeck::intrinsicck::check_offloads");
}
