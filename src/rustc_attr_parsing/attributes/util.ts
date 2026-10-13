// STUB for compiler/rustc_attr_parsing/src/attributes/util.rs (owned by lane attr-parse-b).
// Created by lane attr-parse-a: the public fns that lib.rs re-exports, with `unported` bodies and
// no markers. attr-parse-b fills this file in place.
import type { AttrItem } from "../../rustc_ast/lib.ts";
import type { RustcVersion } from "../../rustc_ast/attr/version.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import { unported } from "../../std/panic.ts";

export function parse_version(_s: Symbol): RustcVersion | undefined {
  return unported("rustc_attr_parsing::attributes::util::parse_version");
}

export function is_builtin_attr(_attr: AttrItem): boolean {
  return unported("rustc_attr_parsing::attributes::util::is_builtin_attr");
}
