// STUB for compiler/rustc_attr_parsing/src/attributes/test_attrs.rs (owned by lane attr-parse-b).
// Created by lane attr-parse-a: the parser types that `ATTRIBUTE_PARSERS` (context.rs) names, as
// `unported_impl` trait tables (any use reaches `Unported`); no markers. attr-parse-b replaces each
// one with the real trait table under the same name (docs/handoff/attr-parse-a.md).
import { type NoArgsAttributeParser, type SingleAttributeParser, unported_impl } from "./mod.ts";

export const IgnoreParser: SingleAttributeParser = unported_impl("rustc_attr_parsing::attributes::test_attrs::IgnoreParser");
export const ReexportTestHarnessMainParser: SingleAttributeParser = unported_impl("rustc_attr_parsing::attributes::test_attrs::ReexportTestHarnessMainParser");
export const RustcAbiParser: SingleAttributeParser = unported_impl("rustc_attr_parsing::attributes::test_attrs::RustcAbiParser");
export const RustcDelayedBugFromInsideQueryParser: NoArgsAttributeParser = unported_impl("rustc_attr_parsing::attributes::test_attrs::RustcDelayedBugFromInsideQueryParser");
export const RustcEvaluateWhereClausesParser: NoArgsAttributeParser = unported_impl("rustc_attr_parsing::attributes::test_attrs::RustcEvaluateWhereClausesParser");
export const RustcTestMarkerParser: SingleAttributeParser = unported_impl("rustc_attr_parsing::attributes::test_attrs::RustcTestMarkerParser");
export const ShouldPanicParser: SingleAttributeParser = unported_impl("rustc_attr_parsing::attributes::test_attrs::ShouldPanicParser");
export const TestRunnerParser: SingleAttributeParser = unported_impl("rustc_attr_parsing::attributes::test_attrs::TestRunnerParser");
