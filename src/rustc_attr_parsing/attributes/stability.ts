// STUB for compiler/rustc_attr_parsing/src/attributes/stability.rs (owned by lane attr-parse-b).
// Created by lane attr-parse-a: the parser types that `ATTRIBUTE_PARSERS` (context.rs) names, as
// `unported_impl` trait tables (any use reaches `Unported`); no markers. attr-parse-b replaces each
// one with the real trait table under the same name (docs/handoff/attr-parse-a.md).
import { type ErasedAttributeParser, type ErasedCombineAttributeParser, type NoArgsAttributeParser, unported_impl } from "./mod.ts";

export const BodyStabilityParser: ErasedAttributeParser = unported_impl("rustc_attr_parsing::attributes::stability::BodyStabilityParser");
export const ConstStabilityParser: ErasedAttributeParser = unported_impl("rustc_attr_parsing::attributes::stability::ConstStabilityParser");
export const RustcConstStableIndirectParser: NoArgsAttributeParser = unported_impl("rustc_attr_parsing::attributes::stability::RustcConstStableIndirectParser");
export const StabilityParser: ErasedAttributeParser = unported_impl("rustc_attr_parsing::attributes::stability::StabilityParser");
export const UnstableRemovedParser: ErasedCombineAttributeParser = unported_impl("rustc_attr_parsing::attributes::stability::UnstableRemovedParser");
