// Port of compiler/rustc_ast_lowering/src/format.rs (STUB, lane lower-asm-format-contract: see docs/handoff/lowering-contract.md
// "How to fill a stub").
//
// The `impl LoweringContext` methods of this file are declared in ./decls.ts (the contract) and assigned
// onto `LoweringContext.prototype` here, in upstream order, each with its `// rustc:` marker; until then the
// `unported_methods(..)` call below installs an `unported(..)` placeholder for each.
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other crates;
// every other rustc_ast_lowering export (lib.ts, ...) is read inside function bodies only.
import { LoweringContext } from "./decls.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import type { format } from "../rustc_ast/lib.ts";
import type { Span } from "../rustc_span/lib.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { unported } from "../std/panic.ts";
import type * as hir from "./hir_shim.ts";

// Types of this file (PORT: `unknown` until codegen set rustc_ast_lowering generates format.gen.ts).
/** format.rs:221 `enum ArgumentType` */
export type ArgumentType = unknown;

/**
 * PORT: `std::borrow::Cow<'_, FormatArgs>` (format.rs `inline_literals` / `flatten_format_args`). The AST must
 * not be mutated through a borrowed value, so `Cow::to_mut` on `Borrowed` clones (`clone_FormatArgs`) and
 * yields `Owned`. Contract choice of lane lowering-contract; the format lane may move it to std.
 */
export type Cow<T> = { readonly $: "Borrowed"; readonly _0: T } | { readonly $: "Owned"; readonly _0: T };

// Free fns of this file (stubs; final signatures: decls.ts `FreeFns`).
// format.rs:152
export function flatten_format_args(_fmt: Cow<format.FormatArgs>): Cow<format.FormatArgs> {
  return unported("rustc_ast_lowering::format::flatten_format_args");
}
// format.rs:233
export function make_argument(_ctx: LoweringContext, _sp: Span, _arg: hir.Expr, _ty: ArgumentType): hir.Expr {
  return unported("rustc_ast_lowering::format::make_argument");
}
// format.rs:266
export function make_count(_count: format.FormatCount, _argmap: Map<[number, ArgumentType], Span | undefined>): [boolean, number] {
  return unported("rustc_ast_lowering::format::make_count");
}
// format.rs:280
export function expand_format_args(_ctx: LoweringContext, _macsp: Span, _fmt: format.FormatArgs, _allow_const: boolean): hir.ExprKind {
  return unported("rustc_ast_lowering::format::expand_format_args");
}
// format.rs:539
export function for_all_argument_indexes(_template: format.FormatArgsPiece[], _f: (_1: MutRef<number>) => void): void {
  return unported("rustc_ast_lowering::format::for_all_argument_indexes");
}

unported_methods(LoweringContext.prototype, "rustc_ast_lowering::format::LoweringContext", [
  "lower_format_args", "try_inline_lit", "int_ty_max", "uint_ty_max", "inline_literals",
]);
