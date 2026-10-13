// The port side of format_oracle/gen.rs (see its header): the same steps, in the same order, on the
// ported crates. `bun src/rustc_builtin_macros/format_oracle/run.ts cases.txt`; stdout/stderr are
// compared case by case with out.stdout/out.stderr by format.test.ts. A case that reaches an
// `unported` path prints `UNPORTED: <what>` instead of its result.
import "../lib.ts";

import { readFileSync, writeSync } from "node:fs";

import { ast } from "../../rustc_ast/lib.ts";
import { debug_NodeId } from "../../rustc_ast/node_id.gen.ts";
import { Fingerprint } from "../../rustc_data_structures/fingerprint.ts";
import { type StableHashCtxt } from "../../rustc_data_structures/stable_hash.ts";
import { debug_MultiSpan } from "../../rustc_error_messages/lib.ts";
import { ExtCtxt, ModuleData, type ResolverExpand, SyntaxExtension, SyntaxExtensionKind } from "../../rustc_expand/base.ts";
import { ExpansionConfig } from "../../rustc_expand/expand.ts";
import { Features } from "../../rustc_feature/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { new_parser_from_source_str, unwrap_or_emit_fatal } from "../../rustc_parse/lib.ts";
import { Options_default } from "../../rustc_session/config.ts";
import { Edition } from "../../rustc_span/edition.ts";
import { FatalErrorMarker } from "../../rustc_span/fatal_error.ts";
import { ExpnData, LocalExpnId, MacroKind } from "../../rustc_span/hygiene.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { display_Symbol, Ident, Symbol, sym } from "../../rustc_span/symbol.ts";
import { type Debug, debug_option, format_debug, PLAIN, PRETTY } from "../../std/fmt.ts";
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
      for (let i = 0; i < 4; i++) {
        const k = rest.indexOf(" | ");
        f.push(rest.slice(0, k));
        rest = rest.slice(k + 3);
      }
      f.push(rest);
      const edition = ({ "2015": Edition.Edition2015, "2018": Edition.Edition2018, "2021": Edition.Edition2021, "2024": Edition.Edition2024 } as const)[
        f[1] as "2015"
      ];
      return {
        name: f[0]!,
        edition,
        features: f[2] === "-" ? [] : f[2]!.split(","),
        pending: f[3] !== "-",
        src: f[4]!.replaceAll("\\n", "\n"),
      };
    });
}

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

    const builtins: [Symbol, SyntaxExtensionKind][] = [];
    register_builtin_macros(resolver({ register_builtin_macro: (name, ext) => void builtins.push([name, ext]) }));

    for (const c of cases) {
      println(`== ${c.name}`);
      eprintln(`== ${c.name}`);
      try {
        run_case(c, sess, builtins);
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

function run_case(c: Case, sess: Parameters<typeof ExtCtxt.new>[0], builtins: [Symbol, SyntaxExtensionKind][]): void {
  const features = Features.default();
  for (const f of c.features) {
    features.set_enabled_lang_feature({ gate_name: Symbol.intern(f), attr_sp: DUMMY_SP, stable_since: undefined });
  }
  const ecfg = ExpansionConfig.default(sym.main, features);
  const find = (name: Symbol): SyntaxExtensionKind => unwrap(builtins.find(([n]) => n === name))[1];
  const mock = resolver({
    resolve_dollar_crates: () => {},
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
  });
  const cx = ExtCtxt.new(sess, ecfg, mock, undefined);
  cx.current_expansion.module = new ModuleData([Ident.with_dummy_span(sym.main)], [], "");
  const p = unwrap_or_emit_fatal(new_parser_from_source_str(sess.psess, { $: "Custom", _0: c.name }, c.src, "Nothing"));
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
  } else {
    println(pretty(res._0.make_expr(), (v, f) => debug_option(v, f, ast.debug_Expr)));
  }
  const lints = cx.buffered_early_lint.splice(0);
  for (const lint of lints) {
    println(
      `lint ${lint.lint_id.lint.name} ${debug_option(lint.span, PLAIN, debug_MultiSpan)} ${debug_NodeId(lint.node_id, PLAIN)}`,
    );
    const diag = lint.diagnostic._0(sess.dcx(), { $: "Warning", _0: undefined }, sess);
    diag.span(unwrap(lint.span));
    diag.emit();
  }
}
