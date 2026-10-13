// Oracle scenarios for lane attr-parse-b: `parse_cfg` / `eval_config_entry` (attributes/cfg.rs),
// `parse_cfg_attr`, `parse_cfg_select` / `CfgSelectBranches::pop_first_match` (attributes/cfg_select.rs)
// and the `unexpected_cfgs` lints of check_cfg.rs, with a real `Session` (`run_compiler`, `--cfg` /
// `--check-cfg` per case).
//
// Expectations: attr_oracle/cfg_out.json, produced by the rustc-dev probe attr_oracle/cfg_gen.rs (pinned
// nightly; how to rebuild it is in its header) over attr_oracle/cfg_cases.txt. `run_case` below is the
// probe's per-case body ported to the TS API; every event string, the fatal flag and the full
// -Zui-testing stderr must match byte for byte.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type * as ast from "../rustc_ast/lib.ts";
import { debug_Path } from "../rustc_ast/lib.ts";
import { debug_CfgEntry } from "../rustc_ast/attr/data_structures.ts";
import { CRATE_NODE_ID } from "../rustc_ast/node_id.ts";
import { target } from "../rustc_attr_ir/lib.ts";
import { debug_MultiSpan } from "../rustc_error_messages/lib.gen.ts";
import { AnnotateSnippetEmitter } from "../rustc_errors/annotate_snippet_emitter_writer.ts";
import { FatalErrorMarker } from "../rustc_errors/lib.ts";
import { Features } from "../rustc_feature/lib.ts";
import { type Config, run_compiler } from "../rustc_interface/lib.ts";
import { new_parser_from_source_str, parser as rustc_parse_parser, unwrap_or_emit_fatal } from "../rustc_parse/lib.ts";
import { Options_default } from "../rustc_session/config.ts";
import { debug_Span, type FileName, type Span } from "../rustc_span/lib.ts";
import { sym } from "../rustc_span/symbol.ts";
import { debug_option, debug_str, PLAIN } from "../std/fmt.ts";
import { Panic } from "../std/panic.ts";
import { AutoStream, ColorChoice } from "../vendor/anstream/lib.ts";
import { dyn_write, VecU8 } from "../vendor/anstream/stream.ts";
import {
  AttributeParser,
  AttributeSafety,
  CFG_TEMPLATE,
  type EvalConfigResult,
  eval_config_entry,
  parse_cfg,
  parse_cfg_attr,
  parse_cfg_select,
  type ShouldEmit,
} from "./lib.ts";
import { AllowExprMetavar } from "./parser.ts";

interface Case {
  name: string;
  ops: string;
  cfg: string;
  check: string;
  src: string;
  events: string[];
  fatal: boolean;
  stderr: string;
}
const oracle = JSON.parse(readFileSync(join(import.meta.dir, "attr_oracle", "cfg_out.json"), "utf8")) as Case[];

function eval_(r: EvalConfigResult): string {
  switch (r.$) {
    case "True":
      return "True";
    case "False":
      return `False(${debug_CfgEntry(r.reason, PLAIN)})`;
  }
}

function specs(v: string): string[] {
  return v === "" ? [] : v.split(";").map((s) => s.trim());
}

function run_case(c: Case): { events: string[]; fatal: boolean; stderr: string } {
  const events: string[] = [];
  let fatal = false;
  const buf = new VecU8();
  const ops = c.ops.split(/\s+/).filter((s) => s !== "");
  const opts = Options_default();
  opts.edition = "Edition2024";
  const config: Config = {
    opts,
    crate_cfg: specs(c.cfg),
    crate_check_cfg: specs(c.check),
    input: { $: "Str", name: { $: "Custom", _0: "unused" }, input: "" },
    output_dir: undefined,
    output_file: undefined,
    ice_file: undefined,
    file_loader: undefined,
    lint_caps: new Map(),
    psess_created: undefined,
    track_state: undefined,
    register_lints: undefined,
    override_queries: undefined,
    extra_symbols: [],
    make_codegen_backend: undefined,
    using_internal_features: { value: false },
  };
  run_compiler(config, (compiler) => {
    const sess = compiler.sess;
    const sm = sess.psess.clone_source_map();
    let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
    em = AnnotateSnippetEmitter.sm(em, sm);
    em = AnnotateSnippetEmitter.ui_testing(em, true);
    sess.dcx().set_emitter(em);
    const fname: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), "t.rs") };
    try {
      const p = unwrap_or_emit_fatal(new_parser_from_source_str(sess.psess, fname, c.src, "Nothing"));
      const kr = p.parse_crate_mod();
      if (kr.$ === "Err") {
        kr._0.emit();
        events.push("parse_crate_mod => Err");
      } else {
        const krate = kr._0;
        const lists: [readonly ast.Attribute[], target.Target, Span, ast.Item | undefined][] = [
          [krate.attrs, target.Target.Crate, krate.spans.inner_span, undefined],
        ];
        for (const item of krate.items) lists.push([item.attrs, target.Target.from_ast_item(item), item.span, item]);
        const features = Features.default();
        const emit: ShouldEmit = { $: "ErrorsAndLints", recovery: "Allowed" };
        lists.forEach(([attrs, t, target_span, item], idx) => {
          for (const op of ops) {
            switch (op) {
              case "cfg":
                attrs.forEach((attr, j) => {
                  if (!attr.has_name(sym.cfg)) return;
                  const r = AttributeParser.parse_single(
                    sess,
                    attr,
                    target_span,
                    CRATE_NODE_ID,
                    t,
                    features,
                    emit,
                    parse_cfg,
                    CFG_TEMPLATE,
                    AllowExprMetavar.No,
                    AttributeSafety.Normal,
                  );
                  events.push(`#${idx} cfg@${j} => ${debug_option(r, PLAIN, debug_CfgEntry)}`);
                  if (r !== undefined) events.push(`#${idx} eval@${j} => ${eval_(eval_config_entry(sess, r))}`);
                });
                break;
              case "cfg_attr":
                attrs.forEach((attr, j) => {
                  if (!attr.has_name(sym.cfg_attr)) return;
                  const r = parse_cfg_attr(attr, sess, features, CRATE_NODE_ID);
                  if (r === undefined) {
                    events.push(`#${idx} cfg_attr@${j} => None`);
                  } else {
                    const [cfg, items] = r;
                    const is = items.map(([i, s]) => `(${debug_Path(i.node.path, PLAIN)}, ${debug_Span(s, PLAIN)})`);
                    events.push(`#${idx} cfg_attr@${j} => Some(${debug_CfgEntry(cfg, PLAIN)}, [${is.join(", ")}])`);
                    events.push(`#${idx} eval@${j} => ${eval_(eval_config_entry(sess, cfg))}`);
                  }
                });
                break;
              case "select": {
                if (item === undefined || item.kind.$ !== "MacCall") break;
                const mac = item.kind._0;
                if (!(mac.path.segments.length === 1 && mac.path.segments[0]!.ident.name === sym.cfg_select)) break;
                const p = rustc_parse_parser.Parser.new(sess.psess, mac.args.tokens, undefined);
                const r = parse_cfg_select(p, sess, features, CRATE_NODE_ID);
                if (r.$ === "Err") {
                  events.push(`#${idx} select => Err`);
                } else {
                  const b = r._0;
                  for (const [cfg, , s] of b.reachable) {
                    events.push(`#${idx} select reachable ${debug_CfgEntry(cfg, PLAIN)} ${debug_Span(s, PLAIN)}`);
                  }
                  if (b.wildcard !== undefined) {
                    const [tok, , s] = b.wildcard;
                    events.push(`#${idx} select wildcard ${debug_Span(tok.span, PLAIN)} ${debug_Span(s, PLAIN)}`);
                  }
                  for (const [pr, , s] of b.unreachable) {
                    const prs = pr.$ === "Cfg" ? `Cfg(${debug_CfgEntry(pr._0, PLAIN)})` : `Wildcard(${debug_Span(pr._0.span, PLAIN)})`;
                    events.push(`#${idx} select unreachable ${prs} ${debug_Span(s, PLAIN)}`);
                  }
                  const m = b.pop_first_match((cfg) => eval_config_entry(sess, cfg));
                  const ms = m === undefined ? "None" : `Some(${debug_str(`${debug_CfgEntry(m[0], PLAIN)} ${debug_Span(m[2], PLAIN)}`)})`;
                  events.push(`#${idx} select match => ${ms}`);
                }
                break;
              }
              default:
                throw new Error(`op ${op}`);
            }
          }
        });
        const lints = sess.psess.buffered_lints.splice(0);
        for (const l of lints) {
          events.push(`buffered ${l.lint_id.lint.name} ${debug_option(l.span, PLAIN, debug_MultiSpan)}`);
        }
        for (const l of lints) {
          const d = l.diagnostic._0(sess.dcx(), { $: "Warning", _0: undefined }, sess);
          if (l.span !== undefined) d.span(l.span);
          d.emit();
        }
      }
    } catch (e) {
      if (!(e instanceof FatalErrorMarker || e instanceof Panic)) throw e;
      fatal = true;
    }
    sess.dcx().reset_err_count();
  });
  return { events, fatal, stderr: new TextDecoder().decode(buf.bytes()) };
}

for (const c of oracle) {
  test(`attr-parse-b cfg oracle: ${c.name}`, () => {
    const got = run_case(c);
    expect(got.events).toEqual(c.events);
    expect(got.fatal).toBe(c.fatal);
    expect(got.stderr).toBe(c.stderr);
  });
}
