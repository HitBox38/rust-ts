// Stub module (lane mt-promote): compiler/rustc_const_eval/src/check_consts/mod.rs is not ported yet.
// Declared by lane const-check (check.ts / ops.ts use these items). On merge, mt-promote's port replaces this file
// whole; the names follow mt-promote's port (the method `const_kind()` is `const_kind_()`, the field keeps the name).
//! Check the bodies of `const`s, `static`s and `const fn`s for illegal operations.
import type { DiagCtxtHandle } from "../../rustc_errors/lib.ts";
import type { ConstContext } from "../../rustc_hir/hir.ts";
import type { Body } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { TypingEnv } from "../../rustc_middle/ty/mod.ts";
import type { PolyFnSig } from "../../rustc_middle/ty/sty.gen.ts";
import type { DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import { unported } from "../../std/panic.ts";

// pub use self::qualifs::Qualif;
export type { Qualif } from "./qualifs.ts";

// pub mod check;
export * as check from "./check.ts";
// mod ops;
export * as ops from "./ops.ts";
// pub mod post_drop_elaboration;
export * as post_drop_elaboration from "./post_drop_elaboration.ts";
// pub mod qualifs;
export * as qualifs from "./qualifs.ts";
// mod resolver;
export * as resolver from "./resolver.ts";

/// Information about the item currently being const-checked, as well as a reference to the global
/// context.
// rustc-type: compiler/rustc_const_eval/src/check_consts/mod.rs:25 ConstCx
export class ConstCx {
  constructor(
    public body: Body,
    public tcx: TyCtxt,
    public typing_env: TypingEnv,
    public const_kind: ConstContext | undefined,
  ) {}

  // stub: compiler/rustc_const_eval/src/check_consts/mod.rs:33 new (lane mt-promote)
  static new(_tcx: TyCtxt, _body: Body): ConstCx {
    return unported("rustc_const_eval::check_consts::ConstCx::new");
  }

  // stub: compiler/rustc_const_eval/src/check_consts/mod.rs:39 dcx (lane mt-promote)
  dcx(): DiagCtxtHandle {
    return unported("rustc_const_eval::check_consts::ConstCx::dcx");
  }

  // stub: compiler/rustc_const_eval/src/check_consts/mod.rs:43 def_id (lane mt-promote)
  def_id(): LocalDefId {
    return unported("rustc_const_eval::check_consts::ConstCx::def_id");
  }

  // stub: compiler/rustc_const_eval/src/check_consts/mod.rs:50 const_kind (lane mt-promote)
  const_kind_(): ConstContext {
    return unported("rustc_const_eval::check_consts::ConstCx::const_kind");
  }

  // stub: compiler/rustc_const_eval/src/check_consts/mod.rs:54 enforce_recursive_const_stability (lane mt-promote)
  enforce_recursive_const_stability(): boolean {
    return unported("rustc_const_eval::check_consts::ConstCx::enforce_recursive_const_stability");
  }

  // stub: compiler/rustc_const_eval/src/check_consts/mod.rs:63 is_async (lane mt-promote)
  is_async(): boolean {
    return unported("rustc_const_eval::check_consts::ConstCx::is_async");
  }

  // stub: compiler/rustc_const_eval/src/check_consts/mod.rs:67 fn_sig (lane mt-promote)
  fn_sig(): PolyFnSig {
    return unported("rustc_const_eval::check_consts::ConstCx::fn_sig");
  }
}

// stub: compiler/rustc_const_eval/src/check_consts/mod.rs:79 rustc_allow_const_fn_unstable (lane mt-promote)
export function rustc_allow_const_fn_unstable(_tcx: TyCtxt, _def_id: LocalDefId, _feature_gate: Symbol): boolean {
  return unported("rustc_const_eval::check_consts::rustc_allow_const_fn_unstable");
}

// stub: compiler/rustc_const_eval/src/check_consts/mod.rs:94 is_fn_or_trait_safe_to_expose_on_stable (lane mt-promote)
export function is_fn_or_trait_safe_to_expose_on_stable(_tcx: TyCtxt, _def_id: DefId): boolean {
  return unported("rustc_const_eval::check_consts::is_fn_or_trait_safe_to_expose_on_stable");
}
