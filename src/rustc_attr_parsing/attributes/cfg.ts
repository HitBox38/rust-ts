// STUB for compiler/rustc_attr_parsing/src/attributes/cfg.rs (owned by lane attr-parse-b).
// Created by lane attr-parse-a: the public items that lib.rs re-exports, with `unported` bodies and
// no markers (`CFG_TEMPLATE` is upstream's value). attr-parse-b fills this file in place.
import type { AttrItem, Attribute, NodeId } from "../../rustc_ast/lib.ts";
import type { CfgEntry } from "../../rustc_ast/attr/data_structures.ts";
import type { WithTokens } from "../../rustc_ast/tokenstream.ts";
import type { ErrorGuaranteed } from "../../rustc_errors/lib.ts";
import type { Features } from "../../rustc_feature/lib.ts";
import type { Session } from "../../rustc_session/lib.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { Result } from "../../std/result.ts";
import { unported } from "../../std/panic.ts";
import type { AcceptContext } from "../context.ts";
import type { ArgParser, MetaItemOrLitParser } from "../parser.ts";
import { template } from "../template.ts";

const P = "rustc_attr_parsing::attributes::cfg";

export const CFG_TEMPLATE = template(
  { List: ["predicate"] },
  "https://doc.rust-lang.org/reference/conditional-compilation.html#the-cfg-attribute",
);

export function parse_cfg(_cx: AcceptContext, _args: ArgParser): CfgEntry | undefined {
  return unported(`${P}::parse_cfg`);
}

export function parse_cfg_entry(_cx: AcceptContext, _item: MetaItemOrLitParser): Result<CfgEntry, ErrorGuaranteed> {
  return unported(`${P}::parse_cfg_entry`);
}

export function eval_config_entry(_sess: Session, _cfg_entry: CfgEntry): EvalConfigResult {
  return unported(`${P}::eval_config_entry`);
}

export type EvalConfigResult = { readonly $: "True" } | { readonly $: "False"; reason: CfgEntry };

export function parse_cfg_attr(
  _cfg_attr: Attribute,
  _sess: Session,
  _features: Features | undefined,
  _lint_node_id: NodeId,
): [CfgEntry, [WithTokens<AttrItem>, Span][]] | undefined {
  return unported(`${P}::parse_cfg_attr`);
}
