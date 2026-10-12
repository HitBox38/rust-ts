// Port of compiler/rustc_ast/src/ast_traits.rs
//! A set of traits implemented for various AST nodes,
//! typically those used in AST fragments during macro expansion.
//
// Types and derived Debug impls are generated into ast_traits.gen.ts (tools/codegen/types.ts). The
// traits (`HasNodeId`, `HasTokens`, `HasAttrs`) and their impls are not ported yet.
import { type Debug, debug_struct, type Fmt } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import type { AstNodeWrapper } from "./ast_traits.gen.ts";

export * from "./ast_traits.gen.ts";

// rustc: compiler/rustc_ast/src/ast_traits.rs:365 fmt
// PORT: generic type: the Debug fns of the type parameters follow `(v, f)` (generator convention).
export function debug_AstNodeWrapper<Wrapped, Tag>(
  v: AstNodeWrapper<Wrapped, Tag>,
  f: Fmt,
  debug_Wrapped: Debug<Wrapped>,
  _debug_Tag: Debug<Tag>,
): string {
  return debug_struct(f, "AstNodeWrapper", [
    ["wrapped", debug_Wrapped(v.wrapped, f)],
    // PORT: `tag: PhantomData<Tag>`; its Debug prints `PhantomData<{core::any::type_name::<Tag>()}>`.
    ["tag", unported("Debug of PhantomData<Tag> (core::any::type_name)")],
  ]);
}
