// STUB for compiler/rustc_attr_parsing/src/attributes/link_attrs.rs (owned by lane attr-parse-b).
// Created by lane attr-parse-a: the parser types that `ATTRIBUTE_PARSERS` (context.rs) names, as
// `unported_impl` trait tables (any use reaches `Unported`); no markers. attr-parse-b replaces each
// one with the real trait table under the same name (docs/handoff/attr-parse-a.md).
import { type ErasedCombineAttributeParser, type NoArgsAttributeParser, type SingleAttributeParser, unported_impl } from "./mod.ts";

export const CompilerBuiltinsParser: NoArgsAttributeParser = unported_impl("rustc_attr_parsing::attributes::link_attrs::CompilerBuiltinsParser");
export const ExportStableParser: NoArgsAttributeParser = unported_impl("rustc_attr_parsing::attributes::link_attrs::ExportStableParser");
export const FfiConstParser: NoArgsAttributeParser = unported_impl("rustc_attr_parsing::attributes::link_attrs::FfiConstParser");
export const FfiPureParser: NoArgsAttributeParser = unported_impl("rustc_attr_parsing::attributes::link_attrs::FfiPureParser");
export const LinkNameParser: SingleAttributeParser = unported_impl("rustc_attr_parsing::attributes::link_attrs::LinkNameParser");
export const LinkOrdinalParser: SingleAttributeParser = unported_impl("rustc_attr_parsing::attributes::link_attrs::LinkOrdinalParser");
export const LinkParser: ErasedCombineAttributeParser = unported_impl("rustc_attr_parsing::attributes::link_attrs::LinkParser");
export const LinkSectionParser: SingleAttributeParser = unported_impl("rustc_attr_parsing::attributes::link_attrs::LinkSectionParser");
export const LinkageParser: SingleAttributeParser = unported_impl("rustc_attr_parsing::attributes::link_attrs::LinkageParser");
export const NeedsAllocatorParser: NoArgsAttributeParser = unported_impl("rustc_attr_parsing::attributes::link_attrs::NeedsAllocatorParser");
export const RustcStdInternalSymbolParser: NoArgsAttributeParser = unported_impl("rustc_attr_parsing::attributes::link_attrs::RustcStdInternalSymbolParser");
