// STUB for compiler/rustc_attr_parsing/src/attributes/cfg_select.rs (owned by lane attr-parse-b).
// Created by lane attr-parse-a so lib.rs's `pub use attributes::cfg_select::*` has a module to
// re-export; `parse_cfg_select` is an `unported` placeholder (no marker). attr-parse-b fills this
// file in place and adds `CfgSelectPredicate` / `CfgSelectBranches`.
import type { NodeId } from "../../rustc_ast/lib.ts";
import type { ErrorGuaranteed } from "../../rustc_errors/lib.ts";
import type { Features } from "../../rustc_feature/lib.ts";
import type { parser } from "../../rustc_parse/lib.ts";
import type { Session } from "../../rustc_session/lib.ts";
import type { Result } from "../../std/result.ts";
import { unported } from "../../std/panic.ts";

export function parse_cfg_select(
  _p: parser.Parser,
  _sess: Session,
  _features: Features | undefined,
  _lint_node_id: NodeId,
): Result<never, ErrorGuaranteed> {
  return unported("rustc_attr_parsing::attributes::cfg_select::parse_cfg_select");
}
