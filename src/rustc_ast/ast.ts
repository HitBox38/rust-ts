// Port of compiler/rustc_ast/src/ast.rs
// Types and derived Debug impls are generated into ast.gen.ts (tools/codegen/types.ts). This module
// holds the manual `impl Debug`s (and the `Display` impls they use); the other functions of ast.rs
// are not ported yet.
import { debug_Ident, display_Symbol } from "../rustc_span/symbol.ts";
import { type Debug, debug_str, PLAIN } from "../std/fmt.ts";
import { to_writer } from "../vendor/bitflags/parser.ts";
import { type ImplPolarity, InlineAsmOptions, type Label, type Lifetime } from "./ast.gen.ts";

export * from "./ast.gen.ts";

// PORT: `write!(f, ..)` formats its arguments with a fresh `Formatter` (no `{:#?}` flag), hence `PLAIN`.

// rustc: compiler/rustc_ast/src/ast.rs:61 fmt
export const debug_Label: Debug<Label> = (v, _f) => `label(${debug_Ident(v.ident, PLAIN)})`;

// rustc: compiler/rustc_ast/src/ast.rs:75 fmt
export const debug_Lifetime: Debug<Lifetime> = (v, _f) => `lifetime(${String(v.id)}: ${display_Lifetime(v)})`;

// rustc: compiler/rustc_ast/src/ast.rs:81 fmt
// PORT: `Display` impls are `display_<Type>(v): string` (as in rustc_span).
export function display_Lifetime(v: Lifetime): string {
  return display_Symbol(v.ident.name);
}

// rustc: compiler/rustc_ast/src/ast.rs:2768 fmt
export const debug_InlineAsmOptions: Debug<InlineAsmOptions> = (v, _f) => to_writer(InlineAsmOptions.FLAGS_DESC, v);

// rustc: compiler/rustc_ast/src/ast.rs:3158 fmt
export const debug_ImplPolarity: Debug<ImplPolarity> = (v, _f) => {
  switch (v.$) {
    case "Positive":
      return debug_str("positive");
    case "Negative":
      return debug_str("negative");
  }
};
