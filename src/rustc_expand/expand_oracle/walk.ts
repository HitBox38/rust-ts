// Test driver for lane expand-base (not a port; no markers): runs the parts of expansion that
// rustc_expand's base/config/module files own, on a real `Session` built from rustc's command line.
//
//   bun src/rustc_expand/expand_oracle/walk.ts <rustc args without -Zunpretty / -Zcrate-attr>
//
// It parses the crate root (`passes::parse`), runs `config::pre_configure_attrs` and
// `config::features` like `create_and_enter_global_ctxt`, then walks the items the way
// `InvocationCollector` does for cfg-stripping and out-of-line module loading (expand.rs
// `flat_map_node` -> `cfg.configure(node)` and `<Box<ast::Item> as InvocationCollectorNode>::
// wrap_flat_map_node_walk_flat_map`, `visit_block`): `#[cfg]`/`#[cfg_attr]` processing,
// `mod_dir_path`, `parse_external_mod`, the re-collect after new inner attributes. Macro calls and
// `#[cfg(true)]` (`expand_cfg_true`, expand-core) are outside its scope: test inputs avoid them.
// Finally it pretty-prints the crate like `-Zunpretty=normal` (no comments in test inputs), so the
// output can be compared with the oracle's `-Zunpretty=expanded` (minus the injected no_core attrs).
import "../lib.ts";

import { type Block, CRATE_NODE_ID, HasAttrs, HasTokens, type Item, Stmt } from "../../rustc_ast/lib.ts";
import { print as pretty_print } from "../../rustc_driver_impl/pretty.ts";
import { catch_with_exit_code, compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { parse } from "../../rustc_interface/passes.ts";
import type { Session } from "../../rustc_session/session.ts";
import { Ident, Symbol, sym } from "../../rustc_span/symbol.ts";
import { target } from "../../rustc_attr_ir/lib.ts";
import { AttributeSafety } from "../../rustc_attr_parsing/attributes/mod.ts";
import { CFG_TEMPLATE, EvalConfigResult, eval_config_entry, parse_cfg } from "../../rustc_attr_parsing/attributes/cfg.ts";
import { AttributeParser } from "../../rustc_attr_parsing/lib.ts";
import { Unported } from "../../std/panic.ts";
import { path_parent } from "../../std/path.ts";
import { ModuleData } from "../base.ts";
import { StripUnconfigured, features, pre_configure_attrs } from "../config.ts";
import { DirOwnership, mod_dir_path, mod_file_path_from_attr, parse_external_mod } from "../module.ts";

class CaptureConfig extends Error {}

function config_from_args(args: string[]): Config {
  let config: Config | undefined;
  try {
    compiler_entrypoint(["rustc", ...args], {
      config(c: Config) {
        config = c;
        throw new CaptureConfig();
      },
    });
  } catch (e) {
    if (!(e instanceof CaptureConfig)) throw e;
  }
  if (config === undefined) throw new Error("no config");
  return config;
}

interface Cx {
  sess: Session;
  cfg: StripUnconfigured;
  module: ModuleData;
  dir_ownership: DirOwnership;
}

function walk_items(cx: Cx, items: Item[]): void {
  const out: Item[] = [];
  for (const item of items) {
    out.push(...flat_map_item(cx, item));
  }
  items.length = 0;
  items.push(...out);
}

// expand.rs `InvocationCollector::flat_map_node` for items, restricted to `cfg`/`cfg_attr` (test inputs
// carry no other non-builtin attributes and no macro calls): `take_first_attr` -> `expand_cfg_true` /
// `expand_cfg_attr(attr, false)`, then `wrap_flat_map_node_walk_flat_map` (`Err(node)` loops again).
function flat_map_item(cx: Cx, node: Item): Item[] {
  for (;;) {
    const pos = node.attrs.findIndex((a) => a.kind.$ === "Normal" && (a.name() === sym.cfg || a.name() === sym.cfg_attr));
    if (pos !== -1) {
      const attr = node.attrs.splice(pos, 1)[0]!;
      if (attr.name() === sym.cfg) {
        // `expand_cfg_true`
        const cfg = AttributeParser.parse_single(
          cx.sess,
          attr,
          attr.span,
          cx.cfg.lint_node_id,
          target.Target.from_ast_item(node),
          cx.cfg.features,
          { $: "ErrorsAndLints", recovery: "Allowed" },
          parse_cfg,
          CFG_TEMPLATE,
          "Yes",
          AttributeSafety.Normal,
        );
        if (cfg === undefined) continue;
        const res = eval_config_entry(cx.sess, cfg);
        if (EvalConfigResult.as_bool(res)) {
          node.attrs.splice(pos, 0, attr.convert_normal_to_synthetic({ $: "CfgTrace", _0: cfg }));
          continue;
        }
        return [];
      }
      // `expand_cfg_attr`
      node.attrs.splice(pos, 0, ...cx.cfg.expand_cfg_attr(attr, false));
      continue;
    }
    const r = wrap_flat_map_node_walk_flat_map(cx, node);
    if (r === undefined) continue;
    return r;
  }
}

function wrap_flat_map_node_walk_flat_map(cx: Cx, node: Item): Item[] | undefined {
  if (node.kind.$ !== "Mod") {
    walk_item(cx, node);
    return [node];
  }
  const ident = node.kind._1;
  const mod_kind = node.kind._2;
  let file_path: string | undefined;
  let dir_path: string;
  let dir_ownership: DirOwnership;
  if (mod_kind.$ === "Loaded") {
    [dir_path, dir_ownership] = mod_dir_path(cx.sess, ident, node.attrs, cx.module, cx.dir_ownership, mod_kind._1);
    file_path = mod_kind._1.$ === "Yes" ? undefined : mod_file_path_from_attr(cx.sess, node.attrs, cx.module.dir_path);
  } else {
    const old_attrs_len = node.attrs.length;
    const parsed = parse_external_mod(cx.sess, ident, node.span, cx.module, cx.dir_ownership, node.attrs);
    node.kind._2 = {
      $: "Loaded",
      _0: parsed.items,
      _1: { $: "No", had_parse_error: parsed.had_parse_error.$ === "Ok" ? { $: "Ok", _0: null } : parsed.had_parse_error },
      _2: parsed.spans,
    };
    if (node.attrs.length > old_attrs_len) {
      // If we loaded an out-of-line module and added some inner attributes,
      // then we need to re-configure it and re-collect attributes for
      // resolution and expansion.
      return undefined;
    }
    [file_path, dir_path, dir_ownership] = [parsed.file_path, parsed.dir_path, parsed.dir_ownership];
  }
  const module = cx.module.with_dir_path(dir_path);
  module.mod_path.push(ident);
  if (file_path !== undefined) module.file_path_stack.push(file_path);
  const inner: Cx = { ...cx, module, dir_ownership };
  const kind = node.kind._2;
  if (kind.$ === "Loaded") walk_items(inner, kind._0);
  return [node];
}

function walk_item(cx: Cx, item: Item): void {
  if (item.kind.$ === "Fn" && item.kind._0.body !== undefined) walk_block(cx, item.kind._0.body);
}

function walk_block(cx: Cx, block: Block): void {
  const inner: Cx = { ...cx, dir_ownership: DirOwnership.UnownedViaBlock };
  const stmts = [];
  for (const stmt of block.stmts) {
    if (stmt.kind.$ === "Item") {
      for (const it of flat_map_item(inner, stmt.kind._0)) {
        stmts.push(new Stmt(stmt.id, { $: "Item", _0: it }, stmt.span));
      }
    } else {
      stmts.push(stmt);
    }
  }
  block.stmts = stmts;
}

const args = process.argv.slice(2);
const config = config_from_args(args);
try {
process.exitCode = catch_with_exit_code(() => run_compiler(config, (compiler) => {
  const sess = compiler.sess;
  const krate = parse(sess);
  {
    const attrs = pre_configure_attrs(sess, krate.attrs);
    const crate_name = Symbol.intern("main");
    const feats = features(sess, attrs, crate_name);
    const cfg = new StripUnconfigured(sess, feats, false, CRATE_NODE_ID);
    // The crate root: `cfg.process_cfg_attrs` + `in_cfg` (InvocationCollector's crate node).
    cfg.process_cfg_attrs(krate, HasAttrs.Crate);
    if (!cfg.in_cfg(krate.attrs)) krate.items = [];
    const input = sess.io.input;
    const file_path = input.$ === "File" ? input._0 : "";
    const dir_path = path_parent(file_path) ?? file_path;
    const module = new ModuleData([Ident.with_dummy_span(crate_name)], [file_path], dir_path);
    walk_items({ sess, cfg, module, dir_ownership: { $: "Owned", relative: undefined } }, krate.items);
  }
  pretty_print(sess, { $: "Source", _0: "Normal" }, { $: "AfterParsing", krate });
}));
} catch (e) {
  // As src/rust_ts/main.ts: unported code exits 70.
  if (!(e instanceof Unported)) throw e;
  process.stderr.write(`unported: ${e.what}\n`);
  process.exitCode = 70;
}
