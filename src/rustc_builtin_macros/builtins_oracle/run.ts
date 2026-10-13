// The port side of builtins_oracle/gen.rs (see its header): the same steps, in the same order, on
// the ported crates. `bun src/rustc_builtin_macros/builtins_oracle/run.ts cases.txt`; stdout/stderr
// are compared case by case with out.stdout/out.stderr by builtins.test.ts. A case that reaches an
// `unported` path prints `UNPORTED: <what>` instead of its result.
import "../lib.ts";

import { readFileSync, writeSync } from "node:fs";

import { ast } from "../../rustc_ast/lib.ts";
import { Fingerprint } from "../../rustc_data_structures/fingerprint.ts";
import { type StableHashCtxt } from "../../rustc_data_structures/stable_hash.ts";
import {
  Annotatable,
  debug_Annotatable,
  ExtCtxt,
  ModuleData,
  type ResolverExpand,
  SyntaxExtensionKind,
} from "../../rustc_expand/base.ts";
import { ExpansionConfig } from "../../rustc_expand/expand.ts";
import { Features } from "../../rustc_feature/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { AllowConstBlockItems, ForceCollect } from "../../rustc_parse/parser/mod.gen.ts";
import { new_parser_from_source_str, unwrap_or_emit_fatal } from "../../rustc_parse/lib.ts";
import { Options_default } from "../../rustc_session/config.ts";
import { Edition } from "../../rustc_span/edition.ts";
import { ExpnData, LocalExpnId, MacroKind } from "../../rustc_span/hygiene.ts";
import { DUMMY_SP, debug_Span, type Span } from "../../rustc_span/lib.ts";
import { debug_Ident, Ident, display_Symbol, Symbol, sym } from "../../rustc_span/symbol.ts";
import { debug_CfgEntry } from "../../rustc_ast/attr/data_structures.ts";
import { debug_NodeId } from "../../rustc_ast/node_id.gen.ts";
import { FatalErrorMarker } from "../../rustc_span/fatal_error.ts";
import { Limit } from "../../rustc_structures/lib.ts";
import { type Debug, debug_option, debug_vec, format_debug, PLAIN, PRETTY } from "../../std/fmt.ts";
import { panic, Unported, unwrap } from "../../std/panic.ts";
import { register_builtin_macros } from "../lib.ts";

function out(fd: 1 | 2, s: string): void {
  const buf = Buffer.from(s, "utf8");
  let off = 0;
  while (off < buf.length) off += writeSync(fd, buf, off);
}
const println = (s: string): void => out(1, `${s}\n`);
const eprintln = (s: string): void => out(2, `${s}\n`);
const pretty = <T>(v: T, d: Debug<T>): string => format_debug(v, d, PRETTY);

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
  frag: string;
  edition: Edition;
  features: string[];
  pending: boolean;
  src: string;
}

function parse_cases(text: string): Case[] {
  return text
    .split("\n")
    .filter((l) => !l.startsWith("#") && l.trim() !== "")
    .map((l) => {
      const f: string[] = [];
      let rest = l;
      for (let i = 0; i < 6; i++) {
        const k = rest.indexOf(" | ");
        f.push(rest.slice(0, k));
        rest = rest.slice(k + 3);
      }
      f.push(rest);
      const edition = ({ "2015": Edition.Edition2015, "2018": Edition.Edition2018, "2021": Edition.Edition2021, "2024": Edition.Edition2024 } as const)[
        f[3] as "2015"
      ];
      return {
        name: f[0]!,
        kind: f[1]!,
        frag: f[2]!,
        edition,
        features: f[4] === "-" ? [] : f[4]!.split(","),
        pending: f[5] !== "-",
        src: f[6]!.replaceAll("\\n", "\n"),
      };
    });
}

const KIND_NAME: Record<SyntaxExtensionKind["$"], string> = {
  MacroRules: "MacroRules",
  Bang: "Bang",
  LegacyBang: "LegacyBang",
  Attr: "Attr",
  LegacyAttr: "LegacyAttr",
  NonMacroAttr: "NonMacroAttr",
  Derive: "Derive",
  LegacyDerive: "LegacyDerive",
  GlobDelegation: "GlobDelegation",
};

const cases = parse_cases(readFileSync(unwrap(process.argv[2]), "utf8"));
const config: Config = {
  opts: Options_default(),
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

// PORT(test): gen.rs ends by unwinding out of `run_compiler` with `FatalError` (errors were emitted),
// which prints nothing; catch the same marker here.
try {
  run_compiler(config, (compiler) => {
    const sess = compiler.sess;

    const recorded: [Symbol, SyntaxExtensionKind][] = [];
    register_builtin_macros(resolver({ register_builtin_macro: (name, ext) => void recorded.push([name, ext]) }));
    println("== register_builtin_macros");
    eprintln("== register_builtin_macros");
    for (const [name, kind] of recorded) {
      println(`${display_Symbol(name)} ${KIND_NAME[kind.$]}`);
    }

    const mock = resolver({
      cfg_accessible: (_id, path) => {
        switch (Symbol.as_str(path.segments[path.segments.length - 1]!.ident.name)) {
          case "yes":
            return { $: "Ok", _0: true };
          case "no":
            return { $: "Ok", _0: false };
          default:
            return { $: "Err", _0: { $: "Indeterminate" } };
        }
      },
      mark_scope_with_compile_error: (node) => println(`mark_scope_with_compile_error(${debug_NodeId(node, PLAIN)})`),
      append_stripped_cfg_item: (node, name, cfg, span) =>
        println(
          `append_stripped_cfg_item(${debug_NodeId(node, PLAIN)}, ${debug_Ident(name, PLAIN)}, ${debug_CfgEntry(cfg, PLAIN)}, ${debug_Span(span, PLAIN)})`,
        ),
    });

    for (const c of cases) {
      println(`== ${c.name}`);
      eprintln(`== ${c.name}`);
      try {
        run_case(c, sess, recorded, mock);
      } catch (e) {
        if (!(e instanceof Unported)) throw e;
        println(`UNPORTED: ${e.message}`);
      }
    }
    println("== end");
    eprintln("== end");
  });
} catch (e) {
  if (!(e instanceof FatalErrorMarker)) throw e;
}

function run_case(c: Case, sess: Parameters<typeof ExtCtxt.new>[0], recorded: [Symbol, SyntaxExtensionKind][], mock: ResolverExpand): void {
  const features = Features.default();
  for (const f of c.features) {
    features.set_enabled_lang_feature({ gate_name: Symbol.intern(f), attr_sp: DUMMY_SP, stable_since: undefined });
  }
  // `ExpansionConfig::default(sym::main, &features)` written out (expand.rs is lane expand-core's).
  const ecfg = new ExpansionConfig(sym.main, features, Limit.new(1024), false, false, false, false);
  const cx = ExtCtxt.new(sess, ecfg, mock, undefined);
  cx.current_expansion.module = new ModuleData([Ident.with_dummy_span(sym.main)], [], "");
  const p = unwrap_or_emit_fatal(new_parser_from_source_str(sess.psess, { $: "Custom", _0: c.name }, c.src, "Nothing"));
  const find = (name: Symbol): SyntaxExtensionKind => unwrap(recorded.find(([n]) => n === name))[1];
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
      if (c.pending) {
        println("PENDING");
        return;
      }
      const res = expander.expand(cx, span, mac.args.tokens);
      if (res.$ === "Retry") {
        println("Retry");
        return;
      }
      const r = res._0;
      switch (c.frag) {
        case "expr":
          println(pretty(r.make_expr(), (v, f) => debug_option(v, f, ast.debug_Expr)));
          break;
        case "ty":
          println(pretty(r.make_ty(), (v, f) => debug_option(v, f, ast.debug_Ty)));
          break;
        case "items":
          println(pretty(r.make_items(), (v, f) => debug_option(v, f, (v, f) => debug_vec(v, f, (v, f) => ast.debug_Item(v, f, ast.debug_ItemKind)))));
          break;
        case "stmts":
          println(pretty(r.make_stmts(), (v, f) => debug_option(v, f, (v, f) => debug_vec(v, f, ast.debug_Stmt))));
          break;
        case "pat":
          println(pretty(r.make_pat(), (v, f) => debug_option(v, f, ast.debug_Pat)));
          break;
        default:
          panic(`fragment ${c.frag}`);
      }
      return;
    }
    case "attr": {
      const ir = p.parse_item(ForceCollect.No, AllowConstBlockItems.Yes);
      if (ir.$ === "Err") return panic("parse");
      const item = unwrap(ir._0);
      const attr = item.attrs.splice(0, 1)[0]!;
      const name = unwrap(attr.name());
      const meta = unwrap(attr.meta());
      const expn_data = ExpnData.default({ $: "Macro", _0: MacroKind.Attr, _1: name }, attr.span, c.edition, undefined, undefined);
      cx.current_expansion.id = LocalExpnId.fresh(expn_data, NoSpanHcx);
      const ext = find(name);
      if (ext.$ !== "LegacyAttr") return panic("LegacyAttr");
      const expander = ext._0;
      if (c.pending) {
        println("PENDING");
        return;
      }
      const res = expander.expand(cx, attr.span, meta, { $: "Item", _0: item }, false);
      if (res.$ === "Retry") {
        println(`Retry ${pretty(res._0, debug_Annotatable)}`);
      } else {
        println(`Ready ${res._0.length}`);
        for (const a of res._0) println(pretty(a, debug_Annotatable));
      }
      return;
    }
    default:
      panic(`kind ${c.kind}`);
  }
}

void Annotatable;
void (null as unknown as Span);
