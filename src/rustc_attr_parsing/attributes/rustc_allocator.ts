// STUB for compiler/rustc_attr_parsing/src/attributes/rustc_allocator.rs (owned by lane attr-parse-b).
// Created by lane attr-parse-a: the parser types that `ATTRIBUTE_PARSERS` (context.rs) names, as
// `unported_impl` trait tables (any use reaches `Unported`); no markers. attr-parse-b replaces each
// one with the real trait table under the same name (docs/handoff/attr-parse-a.md).
import { type NoArgsAttributeParser, type SingleAttributeParser, unported_impl } from "./mod.ts";

export const RustcAllocatorParser: NoArgsAttributeParser = unported_impl("rustc_attr_parsing::attributes::rustc_allocator::RustcAllocatorParser");
export const RustcAllocatorZeroedParser: NoArgsAttributeParser = unported_impl("rustc_attr_parsing::attributes::rustc_allocator::RustcAllocatorZeroedParser");
export const RustcAllocatorZeroedVariantParser: SingleAttributeParser = unported_impl("rustc_attr_parsing::attributes::rustc_allocator::RustcAllocatorZeroedVariantParser");
export const RustcDeallocatorParser: NoArgsAttributeParser = unported_impl("rustc_attr_parsing::attributes::rustc_allocator::RustcDeallocatorParser");
export const RustcReallocatorParser: NoArgsAttributeParser = unported_impl("rustc_attr_parsing::attributes::rustc_allocator::RustcReallocatorParser");
