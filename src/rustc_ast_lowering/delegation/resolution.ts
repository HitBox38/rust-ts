// Port of compiler/rustc_ast_lowering/src/delegation/resolution.rs (STUB, lane lower-delegation: see docs/handoff/lowering-contract.md
// "How to fill a stub").
//
// The `impl LoweringContext` / `impl DelegationResolver` methods of this file are declared in ../decls.ts (the
// contract) and assigned onto the prototype here, in upstream order, each with its `// rustc:` marker; until
// then the `unported_methods(..)` calls below install an `unported(..)` placeholder for each.
// Init order: top-level code here may touch only `../decls.ts`, this file's `.gen.ts` and other crates;
// every other rustc_ast_lowering export (lib.ts, ...) is read inside function bodies only.
import type { TypeRelativeDelegationRes } from "../../rustc_middle/middle/resolve.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import { unported } from "../../std/panic.ts";
import { DelegationResolver, type LoweringContext } from "../decls.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";

// Types of this file (PORT: `unknown` until codegen set rustc_ast_lowering generates
// delegation/resolution.gen.ts).
/** resolution.rs:144 `pub(super) struct ParamInfo` */
export type ParamInfo = unknown;
/** resolution.rs:156 `pub(super) struct SigMapping` */
export type SigMapping = unknown;
/** resolution.rs:161 `pub(super) struct DelegationResolution` */
export type DelegationResolution = unknown;

// resolution.rs:34 (stub; final signature: decls.ts `FreeFns`)
export function resolve_type_relative_delegations(_tcx: TyCtxt, _: null): Map<LocalDefId, TypeRelativeDelegationRes> {
  return unported("rustc_ast_lowering::delegation::resolution::resolve_type_relative_delegations");
}

// pub(super) mod resolver { pub(crate) struct DelegationResolver .. }: the class is in ../decls.ts.
export const resolver = { DelegationResolver };

// resolution.rs:186 (static; final signature: decls.ts `DelegationResolver.new`)
DelegationResolver.new = function (_ctx: LoweringContext): DelegationResolver {
  return unported("rustc_ast_lowering::delegation::resolution::resolver::DelegationResolver::new");
};

unported_methods(DelegationResolver.prototype, "rustc_ast_lowering::delegation::resolution::DelegationResolver", [
  "tcx", "owner_id", "is_definition", "get_resolution_id", "resolve_delegation", "get_call_path_res",
  "resolve_delegation_sig", "create_unresolved_error", "resolve_type_relative_delegation_sig",
  "check_for_cycles", "check_block_soundness", "create_sig_mapping", "can_perform_self_mapping",
]);
