// STUB for compiler/rustc_attr_parsing/src/attributes/codegen_attrs.rs (owned by lane attr-parse-b).
// Created by lane attr-parse-a: the parser types that `ATTRIBUTE_PARSERS` (context.rs) names, as
// `unported_impl` trait tables (any use reaches `Unported`); no markers. attr-parse-b replaces each
// one with the real trait table under the same name (docs/handoff/attr-parse-a.md).
import { type ErasedAttributeParser, type ErasedCombineAttributeParser, type NoArgsAttributeParser, type SingleAttributeParser, unported_impl } from "./mod.ts";

export const ColdParser: NoArgsAttributeParser = unported_impl("rustc_attr_parsing::attributes::codegen_attrs::ColdParser");
export const CoverageParser: SingleAttributeParser = unported_impl("rustc_attr_parsing::attributes::codegen_attrs::CoverageParser");
export const ExportNameParser: SingleAttributeParser = unported_impl("rustc_attr_parsing::attributes::codegen_attrs::ExportNameParser");
export const ForceTargetFeatureParser: ErasedCombineAttributeParser = unported_impl("rustc_attr_parsing::attributes::codegen_attrs::ForceTargetFeatureParser");
export const InstrumentFnParser: SingleAttributeParser = unported_impl("rustc_attr_parsing::attributes::codegen_attrs::InstrumentFnParser");
export const NakedParser: ErasedAttributeParser = unported_impl("rustc_attr_parsing::attributes::codegen_attrs::NakedParser");
export const NoMangleParser: NoArgsAttributeParser = unported_impl("rustc_attr_parsing::attributes::codegen_attrs::NoMangleParser");
export const OptimizeParser: SingleAttributeParser = unported_impl("rustc_attr_parsing::attributes::codegen_attrs::OptimizeParser");
export const PatchableFunctionEntryParser: SingleAttributeParser = unported_impl("rustc_attr_parsing::attributes::codegen_attrs::PatchableFunctionEntryParser");
export const RustcEiiForeignItemParser: NoArgsAttributeParser = unported_impl("rustc_attr_parsing::attributes::codegen_attrs::RustcEiiForeignItemParser");
export const RustcObjcClassParser: SingleAttributeParser = unported_impl("rustc_attr_parsing::attributes::codegen_attrs::RustcObjcClassParser");
export const RustcObjcSelectorParser: SingleAttributeParser = unported_impl("rustc_attr_parsing::attributes::codegen_attrs::RustcObjcSelectorParser");
export const RustcPassIndirectlyInNonRusticAbisParser: NoArgsAttributeParser = unported_impl("rustc_attr_parsing::attributes::codegen_attrs::RustcPassIndirectlyInNonRusticAbisParser");
export const SanitizeParser: SingleAttributeParser = unported_impl("rustc_attr_parsing::attributes::codegen_attrs::SanitizeParser");
export const TargetFeatureParser: ErasedCombineAttributeParser = unported_impl("rustc_attr_parsing::attributes::codegen_attrs::TargetFeatureParser");
export const ThreadLocalParser: NoArgsAttributeParser = unported_impl("rustc_attr_parsing::attributes::codegen_attrs::ThreadLocalParser");
export const TrackCallerParser: NoArgsAttributeParser = unported_impl("rustc_attr_parsing::attributes::codegen_attrs::TrackCallerParser");
export const UsedParser: ErasedAttributeParser = unported_impl("rustc_attr_parsing::attributes::codegen_attrs::UsedParser");
