// STUB for compiler/rustc_attr_parsing/src/attributes/macro_attrs.rs (owned by lane attr-parse-b).
// Created by lane attr-parse-a: the parser types that `ATTRIBUTE_PARSERS` (context.rs) names, as
// `unported_impl` trait tables (any use reaches `Unported`); no markers. attr-parse-b replaces each
// one with the real trait table under the same name (docs/handoff/attr-parse-a.md).
import { type ErasedAttributeParser, type NoArgsAttributeParser, type SingleAttributeParser, unported_impl } from "./mod.ts";

export const AllowInternalUnsafeParser: NoArgsAttributeParser = unported_impl("rustc_attr_parsing::attributes::macro_attrs::AllowInternalUnsafeParser");
export const CollapseDebugInfoParser: SingleAttributeParser = unported_impl("rustc_attr_parsing::attributes::macro_attrs::CollapseDebugInfoParser");
export const MacroEscapeParser: NoArgsAttributeParser = unported_impl("rustc_attr_parsing::attributes::macro_attrs::MacroEscapeParser");
export const MacroExportParser: SingleAttributeParser = unported_impl("rustc_attr_parsing::attributes::macro_attrs::MacroExportParser");
export const MacroUseParser: ErasedAttributeParser = unported_impl("rustc_attr_parsing::attributes::macro_attrs::MacroUseParser");
export const RustcProcMacroDeclsParser: NoArgsAttributeParser = unported_impl("rustc_attr_parsing::attributes::macro_attrs::RustcProcMacroDeclsParser");
