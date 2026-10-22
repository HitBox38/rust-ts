// Port of compiler/rustc_const_eval/src/lib.rs (lanes small-gaps-17, interp-contract): the crate root with `provide`.
// check_consts/ (lanes mt-promote / const-check) and const_eval/fn_queries.rs are ported; the interpreter (interpret/*,
// const_eval/*, util/*) is the contract of lane interp-contract (plan-m4 wave 23b, docs/handoff/interp-contract.md):
// every fn is ported or a `// stub:` whose body stops UNPORTED naming its fill lane.
// PORT (init order, interpret/eval_context.ts header): the modules are loaded in upstream order; `interpret/mod.ts`
// loads `InterpCx` (eval_context.ts) before the extension modules that assign to its prototype, and `const_eval/mod.ts`
// the `impl InterpCx<CompileTimeMachine>` extension modules (dyn_trait.ts, type_info.ts, type_info/adt.ts).

// pub mod check_consts;   (lane mt-promote: mod, qualifs, resolver, post_drop_elaboration; lane const-check: check, ops)
import * as check_consts from "./check_consts/mod.ts";
export { check_consts };
// pub mod const_eval;
import * as const_eval from "./const_eval/mod.ts";
export { const_eval };
// mod diagnostics;
import "./diagnostics.ts";
// pub mod interpret;
import * as interpret from "./interpret/mod.ts";
export { interpret };
// pub mod util;
import * as util from "./util/mod.ts";
export { util };

import type { TypingMode } from "../rustc_middle/ty/sty.gen.ts";
import type { VariantIdx } from "../rustc_abi/lib.ts";
import type { ConstValue } from "../rustc_middle/mir/mod.ts";
import type { ScalarInt } from "../rustc_middle/ty/consts/int.ts";
import type { Value } from "../rustc_middle/ty/consts/valtree.ts";
import type { PseudoCanonicalInput, Ty } from "../rustc_middle/ty/mod.ts";
import type { Providers } from "../rustc_middle/util/mod.ts";
import { TypingEnv } from "../rustc_middle/ty/mod.ts";

/// Const eval always happens in post analysis mode in order to be able to use the hidden types of
/// opaque types. This is needed for trivial things like `size_of`, but also for using associated
/// types that are not specified in the opaque type. We also use MIR bodies whose opaque types have
/// already been revealed, so we'd be able to at least partially observe the hidden types anyways.
// rustc: compiler/rustc_const_eval/src/lib.rs:28 assert_typing_mode
export function assert_typing_mode(typing_mode: TypingMode): void {
  // PORT: `if cfg!(debug_assertions) { .. }` (a `bug!` unless `PostAnalysis` / `Codegen`) is skipped: rustc ships without
  // debug assertions.
  void typing_mode;
}

// rustc: compiler/rustc_const_eval/src/lib.rs:45 provide
export function provide(providers: Providers): void {
  const_eval.provide(providers.queries);
  // PORT: queries.gen.ts / hooks.ts type some of these keys and values `unknown` (types not generated there).
  providers.queries.tag_for_variant = (tcx, key) => const_eval.tag_for_variant_provider(tcx, key as PseudoCanonicalInput<[Ty, VariantIdx]>);
  providers.queries.eval_to_const_value_raw = const_eval.eval_to_const_value_raw_provider;
  providers.queries.eval_to_allocation_raw = const_eval.eval_to_allocation_raw_provider;
  providers.queries.eval_static_initializer = const_eval.eval_static_initializer_provider;
  providers.hooks.const_caller_location = util.caller_location.const_caller_location_provider;
  providers.queries.eval_to_valtree = (tcx, { typing_env, value }) => const_eval.eval_to_valtree(tcx, typing_env, value);
  providers.hooks.try_destructure_mir_constant_for_user_output = (tcx, val, ty) =>
    const_eval.try_destructure_mir_constant_for_user_output(tcx, val as ConstValue, ty as Ty);
  providers.queries.valtree_to_const_val = (tcx, cv) => const_eval.valtree_to_const_value(tcx, TypingEnv.fully_monomorphized(), cv as Value);
  providers.queries.check_validity_requirement = (tcx, [init_kind, param_env_and_ty]) =>
    util.check_validity_requirement(tcx, init_kind, param_env_and_ty);
  providers.hooks.validate_scalar_in_layout = (tcx, scalar, layout) => util.validate_scalar_in_layout(tcx, scalar as ScalarInt, layout as Ty);
}

/// `rustc_driver::main` installs a handler that will set this to `true` if
/// the compiler has been sent a request to shut down, such as by a Ctrl-C.
/// This static lives here because it is only read by the interpreter.
// PORT: `AtomicBool` is a mutable holder (`CTRL_C_RECEIVED.value`); nothing sets it (no Ctrl-C handler).
export const CTRL_C_RECEIVED: { value: boolean } = { value: false };
