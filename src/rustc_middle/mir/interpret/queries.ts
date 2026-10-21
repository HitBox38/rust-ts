// Port of compiler/rustc_middle/src/mir/interpret/queries.rs (lane mir-contract, plan-m4 D8): the `impl TyCtxt` const-eval
// entry points, stubs for lane mir-interp-b installed by `install_TyCtxt_methods` (init order, see mir/consts.ts).
// docs/handoff/mir-contract.md "How to fill a stub".
import "../mod.ts";
import type { DefId } from "../../../rustc_span/def_id.ts";
import type { Span } from "../../../rustc_span/lib.ts";
import { unported } from "../../../std/panic.ts";
import { TyCtxt } from "../../ty/context.ts";
import type { AliasConst } from "../../ty/consts.ts";
import type { ConstToValTreeResult } from "../../ty/consts/valtree.ts";
import type { Instance, TypingEnv } from "../../ty/decls.ts";
import type { UnevaluatedConst } from "../consts.ts";
import type { EvalToAllocationRawResult, EvalToConstValueResult } from "./error.ts";
import type { GlobalId } from "./mod.gen.ts";

declare module "../../ty/context.ts" {
  interface TyCtxt {
    // interpret/queries.rs:19 (lane mir-interp-b)
    const_eval_poly(def_id: DefId): EvalToConstValueResult;
    // interpret/queries.rs:35 (lane mir-interp-b)
    const_eval_poly_to_alloc(def_id: DefId): EvalToAllocationRawResult;
    // interpret/queries.rs:58 (lane mir-interp-b)
    const_eval_resolve(typing_env: TypingEnv, ct: UnevaluatedConst, span: Span): EvalToConstValueResult;
    // interpret/queries.rs:90 (lane mir-interp-b)
    const_eval_resolve_for_typeck(typing_env: TypingEnv, ct: AliasConst, span: Span): ConstToValTreeResult;
    // interpret/queries.rs:167 (lane mir-interp-b)
    const_eval_instance(typing_env: TypingEnv, instance: Instance, span: Span): EvalToConstValueResult;
    // interpret/queries.rs:178 (lane mir-interp-b)
    const_eval_global_id(typing_env: TypingEnv, cid: GlobalId, span: Span): EvalToConstValueResult;
    // interpret/queries.rs:199 (lane mir-interp-b)
    const_eval_global_id_for_typeck(typing_env: TypingEnv, cid: GlobalId, span: Span): ConstToValTreeResult;
  }
}

/** PORT (init order, see mir/consts.ts): puts this file's `impl TyCtxt` methods on `TyCtxt.prototype` (rustc_middle/lib.ts). */
export function install_TyCtxt_methods(): void {
  // stub: compiler/rustc_middle/src/mir/interpret/queries.rs:19 const_eval_poly (lane mir-interp-b)
  TyCtxt.prototype.const_eval_poly = function (this: TyCtxt, def_id: DefId): EvalToConstValueResult {
    return unported("rustc_middle::mir::interpret::queries::TyCtxt::const_eval_poly");
  };


  // stub: compiler/rustc_middle/src/mir/interpret/queries.rs:35 const_eval_poly_to_alloc (lane mir-interp-b)
  TyCtxt.prototype.const_eval_poly_to_alloc = function (this: TyCtxt, def_id: DefId): EvalToAllocationRawResult {
    return unported("rustc_middle::mir::interpret::queries::TyCtxt::const_eval_poly_to_alloc");
  };


  // stub: compiler/rustc_middle/src/mir/interpret/queries.rs:58 const_eval_resolve (lane mir-interp-b)
  TyCtxt.prototype.const_eval_resolve = function (this: TyCtxt, typing_env: TypingEnv, ct: UnevaluatedConst, span: Span): EvalToConstValueResult {
    return unported("rustc_middle::mir::interpret::queries::TyCtxt::const_eval_resolve");
  };


  // stub: compiler/rustc_middle/src/mir/interpret/queries.rs:90 const_eval_resolve_for_typeck (lane mir-interp-b)
  TyCtxt.prototype.const_eval_resolve_for_typeck = function (this: TyCtxt, typing_env: TypingEnv, ct: AliasConst, span: Span): ConstToValTreeResult {
    return unported("rustc_middle::mir::interpret::queries::TyCtxt::const_eval_resolve_for_typeck");
  };


  // stub: compiler/rustc_middle/src/mir/interpret/queries.rs:167 const_eval_instance (lane mir-interp-b)
  TyCtxt.prototype.const_eval_instance = function (this: TyCtxt, typing_env: TypingEnv, instance: Instance, span: Span): EvalToConstValueResult {
    return unported("rustc_middle::mir::interpret::queries::TyCtxt::const_eval_instance");
  };


  // stub: compiler/rustc_middle/src/mir/interpret/queries.rs:178 const_eval_global_id (lane mir-interp-b)
  TyCtxt.prototype.const_eval_global_id = function (this: TyCtxt, typing_env: TypingEnv, cid: GlobalId, span: Span): EvalToConstValueResult {
    return unported("rustc_middle::mir::interpret::queries::TyCtxt::const_eval_global_id");
  };


  // stub: compiler/rustc_middle/src/mir/interpret/queries.rs:199 const_eval_global_id_for_typeck (lane mir-interp-b)
  TyCtxt.prototype.const_eval_global_id_for_typeck = function (this: TyCtxt, typing_env: TypingEnv, cid: GlobalId, span: Span): ConstToValTreeResult {
    return unported("rustc_middle::mir::interpret::queries::TyCtxt::const_eval_global_id_for_typeck");
  };
}
