// The port side of rest_oracle/probe.rs (see its header): the same steps, in the same order, on the
// ported crates. `bun src/rustc_builtin_macros/rest_oracle/run.ts cases.txt`; stdout/stderr are compared
// case by case with out.stdout/out.stderr by rest.test.ts. A case that reaches an `unported` path prints
// `UNPORTED: <what>` instead of the rest of its output.
import "../lib.ts";

import { readFileSync, writeSync } from "node:fs";

import { ast } from "../../rustc_ast/lib.ts";
import { debug_NodeId, type NodeId } from "../../rustc_ast/node_id.gen.ts";
import { debug_TokenStream } from "../../rustc_ast/tokenstream.gen.ts";
import { Fingerprint } from "../../rustc_data_structures/fingerprint.ts";
import { type StableHashCtxt } from "../../rustc_data_structures/stable_hash.ts";
import { debug_MultiSpan } from "../../rustc_error_messages/lib.ts";
import {
  Annotatable,
  debug_Annotatable,
  type ExpandResult,
  ExtCtxt,
  ModuleData,
  type ResolverExpand,
  SyntaxExtension,
  SyntaxExtensionKind,
} from "../../rustc_expand/base.ts";
import { ExpansionConfig } from "../../rustc_expand/expand.ts";
import { Features } from "../../rustc_feature/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { AllowConstBlockItems, ForceCollect } from "../../rustc_parse/parser/mod.gen.ts";
import { new_parser_from_source_str, unwrap_or_emit_fatal } from "../../rustc_parse/lib.ts";
import { Options_default } from "../../rustc_session/config.ts";
import type { Session } from "../../rustc_session/session.ts";
import { Edition } from "../../rustc_span/edition.ts";
import { FatalErrorMarker } from "../../rustc_span/fatal_error.ts";
import { debug_LocalExpnId, ExpnData, LocalExpnId, MacroKind } from "../../rustc_span/hygiene.ts";
import { debug_Span, DUMMY_SP } from "../../rustc_span/lib.ts";
import { debug_Symbol, display_Symbol, Ident, Symbol, sym } from "../../rustc_span/symbol.ts";
import { debug_InlineAsmArch } from "../../rustc_target/asm/mod.ts";
import { TargetTuple } from "../../rustc_target/spec/tuple.ts";
import { type Debug, debug_option, debug_vec, format_debug, PLAIN, PRETTY } from "../../std/fmt.ts";
import { assert_eq, panic, Unported, unwrap } from "../../std/panic.ts";
import { register_builtin_macros } from "../lib.ts";
import * as proc_macro_harness from "../proc_macro_harness.ts";
import * as test_harness from "../test_harness.ts";

function out(fd: 1 | 2, s: string): void {
  const buf = Buffer.from(s, "utf8");
  let off = 0;
  while (off < buf.length) off += writeSync(fd, buf, off);
}
const println = (s: string): void => out(1, `${s}\n`);
const eprintln = (s: string): void => out(2, `${s}\n`);
const pretty = <T>(v: T, d: Debug<T>): string => format_debug(v, d, PRETTY);
const plain = <T>(v: T, d: Debug<T>): string => format_debug(v, d, PLAIN);

/** `unimplemented!()` for every method not listed. */
function resolver(impls: Partial<ResolverExpand>): ResolverExpand {
  return new Proxy(impls as ResolverExpand, {
    get(t, p) {
      const m = (t as unknown as Record<string | symbol, unknown>)[p];
      if (m !== undefined) return m;
      return () => panic("not implemented");
    },
  });
}

const NoSpanHcx: StableHashCtxt = {
  stable_hash_span: () => {},
  def_path_hash: () => Fingerprint.ZERO,
  stable_hash_controls: () => ({ hash_spans: false }),
  assert_default_stable_hash_controls: () => {},
};

interface Case {
  name: string;
  kind: string;
  edition: Edition;
  features: string[];
  opts: Map<string, string>;
  src: string;
}

function parse_cases(text: string): Case[] {
  return text
    .split("\n")
    .filter((l) => !l.startsWith("#") && l.trim() !== "")
    .map((l) => {
      const f: string[] = [];
      let rest = l;
      for (let i = 0; i < 5; i++) {
        const k = rest.indexOf(" | ");
        f.push(rest.slice(0, k));
        rest = rest.slice(k + 3);
      }
      f.push(rest);
      const edition = ({ "2015": Edition.Edition2015, "2018": Edition.Edition2018, "2021": Edition.Edition2021, "2024": Edition.Edition2024 } as const)[
        f[2] as "2015"
      ];
      const list = f[3] === "-" ? [] : f[3]!.split(",");
      const opts = new Map<string, string>();
      for (const o of list.filter((x) => x.startsWith("@"))) {
        const k = o.indexOf("=");
        if (k < 0) opts.set(o.slice(1), "");
        else opts.set(o.slice(1, k), o.slice(k + 1));
      }
      return {
        name: f[0]!,
        kind: f[1]!,
        edition,
        features: list.filter((x) => !x.startsWith("@")),
        opts,
        src: f[5]!.replaceAll("\\n", "\n"),
      };
    });
}

function print_result(res: ExpandResult<Annotatable[], Annotatable>): void {
  if (res.$ === "Retry") {
    println(`Retry ${pretty(res._0, debug_Annotatable)}`);
  } else {
    println(`Ready ${res._0.length}`);
    for (const a of res._0) println(pretty(a, debug_Annotatable));
  }
}

const cases = parse_cases(readFileSync(unwrap(process.argv[2]), "utf8"));
for (const c of cases) {
  println(`== ${c.name}`);
  eprintln(`== ${c.name}`);
  try {
    run_case(c);
  } catch (e) {
    if (e instanceof Unported) {
      println(`UNPORTED: ${e.message}`);
    } else if (!(e instanceof FatalErrorMarker)) {
      throw e;
    }
  }
}
println("== end");
eprintln("== end");

function run_case(c: Case): void {
  const opts = Options_default();
  opts.edition = c.edition;
  if (c.opts.has("test")) {
    opts.test = true;
  }
  const p = c.opts.get("panic");
  if (p === "abort") opts.cg.panic = "Abort";
  else if (p === "immediate-abort") opts.cg.panic = "ImmediateAbort";
  else if (p !== undefined) panic(`panic=${p}`);
  if (c.opts.has("panic_abort_tests")) {
    opts.unstable_opts.panic_abort_tests = true;
  }
  const t = c.opts.get("target");
  if (t !== undefined) {
    opts.target_triple = TargetTuple.from_tuple(t);
  }
  const config: Config = {
    opts,
    crate_cfg: [],
    crate_check_cfg: [],
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
    const a = c.opts.get("asm_arch");
    if (a !== undefined) {
      // As the probe: `assert_eq!(format!("{:?}", sess.asm_arch), a, "@asm_arch")`.
      assert_eq(debug_option(sess.asm_arch, PLAIN, debug_InlineAsmArch), a, (v) => v);
    }
    try {
      run_in_session(c, sess);
    } finally {
      sess.dcx().reset_err_count();
    }
  });
}

function run_in_session(c: Case, sess: Session): void {
  const recorded: [Symbol, SyntaxExtensionKind][] = [];
  register_builtin_macros(resolver({ register_builtin_macro: (name, ext) => void recorded.push([name, ext]) }));
  const find = (name: Symbol): SyntaxExtensionKind => unwrap(recorded.find(([n]) => n === name))[1];

  const features = Features.default();
  for (const f of c.features) {
    features.set_enabled_lang_feature({ gate_name: Symbol.intern(f), attr_sp: DUMMY_SP, stable_since: undefined });
  }
  let next_node_id = 1;
  const mock = resolver({
    next_node_id: () => next_node_id++ as NodeId,
    resolve_dollar_crates: () => {},
    visit_ast_fragment_with_placeholders: (expn_id) => println(`visit_ast_fragment_with_placeholders(${plain(expn_id, debug_LocalExpnId)})`),
    expansion_for_ast_pass: (call_site, pass, features, parent_module_id) => {
      const expn_id = LocalExpnId.fresh(
        ExpnData.allow_unstable({ $: "AstPass", _0: pass }, call_site, c.edition, features.slice(), undefined, undefined),
        NoSpanHcx,
      );
      println(
        `expansion_for_ast_pass(${plain(call_site, debug_Span)}, ${pass}, ${plain(features, (v, f) => debug_vec(v, f, debug_Symbol))}, ${plain(
          parent_module_id,
          (v, f) => debug_option(v, f, debug_NodeId),
        )}) -> ${plain(expn_id, debug_LocalExpnId)}`,
      );
      return expn_id;
    },
    resolve_imports: () => println("resolve_imports"),
    resolve_macro_invocation: (invoc, root, force) => {
      const kind = invoc.kind;
      if (kind.$ !== "Bang") return panic("not implemented");
      const segs = kind.mac.path.segments;
      const name = segs[segs.length - 1]!.ident.name;
      println(`resolve_macro_invocation(${display_Symbol(name)}, force=${force})`);
      const ext = SyntaxExtension.default(find(name), c.edition);
      LocalExpnId.set_expn_data(invoc.expansion_data.id, ext.expn_data(root, invoc.span(), name, MacroKind.Bang, undefined, undefined), NoSpanHcx);
      return { $: "Ok", _0: ext };
    },
    take_derive_resolutions: () => undefined,
    macro_accessible: () => ({ $: "Ok", _0: true }),
    declare_proc_macro: (id) => println(`declare_proc_macro(${plain(id, debug_NodeId)})`),
  });

  const p = unwrap_or_emit_fatal(new_parser_from_source_str(sess.psess, { $: "Custom", _0: c.name }, c.src, "Nothing"));
  let early_lints: ExtCtxt["buffered_early_lint"] = [];
  if (c.kind === "test_harness" || c.kind === "proc_macro_harness") {
    const kr = p.parse_crate_mod();
    if (kr.$ === "Err") return panic("parse");
    const krate = kr._0;
    if (c.kind === "test_harness") {
      test_harness.inject(krate, sess, features, mock);
    } else {
      proc_macro_harness.inject(
        krate,
        sess,
        features,
        mock,
        c.opts.has("proc_macro_crate"),
        c.opts.has("has_proc_macro_decls"),
        sess.is_test_crate(),
        sess.dcx(),
      );
    }
    println(pretty(krate, ast.debug_Crate));
  } else {
    const ecfg = ExpansionConfig.default(sym.main, features);
    ecfg.should_test = c.opts.has("test");
    const cx = ExtCtxt.new(sess, ecfg, mock, undefined);
    const mod_path = [Ident.with_dummy_span(sym.main)];
    const m = c.opts.get("mod");
    if (m !== undefined) {
      mod_path.push(...m.split("::").map((s) => Ident.from_str(s)));
    }
    cx.current_expansion.module = new ModuleData(mod_path, [], "");
    const r = c.opts.get("root");
    if (r !== undefined) {
      cx.root_path = r;
    }
    switch (c.kind) {
      case "bang": {
        const er = p.parse_expr();
        if (er.$ === "Err") return panic("parse");
        const e = er._0;
        if (e.kind.$ !== "MacCall") return panic("not a macro call");
        const mac = e.kind._0;
        const name = mac.path.segments[0]!.ident.name;
        const span = e.span;
        const expn_data = ExpnData.default({ $: "Macro", _0: MacroKind.Bang, _1: name }, span, c.edition, undefined, undefined);
        cx.current_expansion.id = LocalExpnId.fresh(expn_data, NoSpanHcx);
        const expander = unwrap(SyntaxExtensionKind.as_legacy_bang(find(name)));
        const res = expander.expand(cx, span, mac.args.tokens);
        if (res.$ === "Retry") {
          println("Retry");
        } else if (name === sym.global_asm) {
          println(pretty(res._0.make_items(), (v, f) => debug_option(v, f, (v, f) => debug_vec(v, f, (x, f) => ast.debug_Item(x, f, ast.debug_ItemKind)))));
        } else {
          println(pretty(res._0.make_expr(), (v, f) => debug_option(v, f, ast.debug_Expr)));
        }
        break;
      }
      case "attr_ts": {
        const ir = p.parse_item(ForceCollect.Yes, AllowConstBlockItems.Yes);
        if (ir.$ === "Err") return panic("parse");
        const item = unwrap(ir._0);
        const attr = item.attrs.splice(0, 1)[0]!;
        const name = unwrap(attr.name());
        const expn_data = ExpnData.default({ $: "Macro", _0: MacroKind.Attr, _1: name }, attr.span, c.edition, undefined, undefined);
        cx.current_expansion.id = LocalExpnId.fresh(expn_data, NoSpanHcx);
        const ext = find(name);
        if (ext.$ !== "Attr") return panic("Attr");
        const annotation = ast.AttrArgs.inner_tokens(attr.get_normal_item().args);
        const annotated = Annotatable.to_tokens({ $: "Item", _0: item });
        const res = ext._0.expand(cx, attr.span, annotation, annotated);
        if (res.$ === "Ok") {
          println(`Ok ${pretty(res._0, debug_TokenStream)}`);
        } else {
          println("Err");
        }
        break;
      }
      case "attr_expr": {
        const er = p.parse_expr();
        if (er.$ === "Err") return panic("parse");
        const e = er._0;
        const attr = e.attrs.splice(0, 1)[0]!;
        const name = unwrap(attr.name());
        const meta = unwrap(attr.meta());
        const expn_data = ExpnData.default({ $: "Macro", _0: MacroKind.Attr, _1: name }, attr.span, c.edition, undefined, undefined);
        cx.current_expansion.id = LocalExpnId.fresh(expn_data, NoSpanHcx);
        const en = c.opts.get("ext");
        const ext = find(en === undefined ? name : Symbol.intern(en));
        if (ext.$ !== "LegacyAttr") return panic("LegacyAttr");
        print_result(ext._0.expand(cx, attr.span, meta, { $: "Expr", _0: e }, false));
        break;
      }
      case "attr":
      case "attr_stmt": {
        const ir = p.parse_item(ForceCollect.No, AllowConstBlockItems.Yes);
        if (ir.$ === "Err") return panic("parse");
        const item = unwrap(ir._0);
        const attr = item.attrs.splice(0, 1)[0]!;
        const name = unwrap(attr.name());
        const meta = unwrap(attr.meta());
        const annotatable: Annotatable =
          c.kind === "attr_stmt" ? { $: "Stmt", _0: new ast.Stmt(ast.DUMMY_NODE_ID, { $: "Item", _0: item }, item.span) } : { $: "Item", _0: item };
        const expn_data = ExpnData.default({ $: "Macro", _0: MacroKind.Attr, _1: name }, attr.span, c.edition, undefined, undefined);
        cx.current_expansion.id = LocalExpnId.fresh(expn_data, NoSpanHcx);
        const e = c.opts.get("ext");
        const ext_name = e === undefined ? name : Symbol.intern(e);
        const ext = find(ext_name);
        if (ext.$ !== "LegacyAttr") return panic("LegacyAttr");
        print_result(ext._0.expand(cx, attr.span, meta, annotatable, false));
        break;
      }
      default:
        return panic(`kind ${c.kind}`);
    }
    early_lints = cx.buffered_early_lint.splice(0);
  }
  const lints = sess.psess.buffered_lints.splice(0);
  for (const lint of [...lints, ...early_lints]) {
    println(`lint ${lint.lint_id.lint.name} ${debug_option(lint.span, PLAIN, debug_MultiSpan)} ${debug_NodeId(lint.node_id, PLAIN)}`);
    const diag = lint.diagnostic._0(sess.dcx(), { $: "Warning", _0: undefined }, sess);
    diag.span(unwrap(lint.span));
    diag.emit();
  }
}
