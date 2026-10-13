// STUB for compiler/rustc_attr_parsing/src/attributes/diagnostic/mod.rs (owned by lane attr-parse-b).
// Created by lane attr-parse-a: `impl AttributeParser { fn unknown_diagnostic_attr }` (called by
// interface.rs `parse_attribute_list`) as an `unported_methods` placeholder; no markers.
// attr-parse-b ports it by assigning `AttributeParser.prototype.unknown_diagnostic_attr` (with its
// marker) and deleting the placeholder call. rustc_attr_parsing/lib.ts imports this module after
// interface.ts (extension-module load order).
import type { PathSegment } from "../../../rustc_ast/lib.ts";
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { AttributeParser, type EmitLintFn } from "../../interface.ts";

declare module "../../interface.ts" {
  interface AttributeParser {
    unknown_diagnostic_attr(segment: PathSegment, emit_lint: EmitLintFn): void;
  }
}

unported_methods(AttributeParser.prototype, "rustc_attr_parsing::attributes::diagnostic::AttributeParser", ["unknown_diagnostic_attr"]);
