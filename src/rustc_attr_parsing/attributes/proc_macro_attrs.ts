// STUB for compiler/rustc_attr_parsing/src/attributes/proc_macro_attrs.rs (owned by lane attr-parse-b).
// Created by lane attr-parse-a: the parser types that `ATTRIBUTE_PARSERS` (context.rs) names, as
// `unported_impl` trait tables (any use reaches `Unported`); no markers. attr-parse-b replaces each
// one with the real trait table under the same name (docs/handoff/attr-parse-a.md).
import { type NoArgsAttributeParser, type SingleAttributeParser, unported_impl } from "./mod.ts";

export const ProcMacroAttributeParser: NoArgsAttributeParser = unported_impl("rustc_attr_parsing::attributes::proc_macro_attrs::ProcMacroAttributeParser");
export const ProcMacroDeriveParser: SingleAttributeParser = unported_impl("rustc_attr_parsing::attributes::proc_macro_attrs::ProcMacroDeriveParser");
export const ProcMacroParser: NoArgsAttributeParser = unported_impl("rustc_attr_parsing::attributes::proc_macro_attrs::ProcMacroParser");
export const RustcBuiltinMacroParser: SingleAttributeParser = unported_impl("rustc_attr_parsing::attributes::proc_macro_attrs::RustcBuiltinMacroParser");
