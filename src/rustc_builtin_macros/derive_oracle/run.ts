// The port side of derive_oracle/probe.rs (see its header): the same steps, in the same order, on
// the ported crates. `bun src/rustc_builtin_macros/derive_oracle/run.ts cases.txt`; stdout/stderr are
// compared case by case with out.stdout/out.stderr by derive.test.ts. A case that reaches an
// `unported` path prints `UNPORTED: <what>` instead of its result.
//
// `builtin` cases for Copy, Hash and Eq use the test fixtures of fixtures.ts (wrapped in the ported
// `BuiltinDerive`) instead of the registered expanders, whose modules are lane bm-derive-b's stubs.
import "../lib.ts";

import { readFileSync, writeSync } from "node:fs";

import { ast } from "../../rustc_ast/lib.ts";
import { Fingerprint } from "../../rustc_data_structures/fingerprint.ts";
import { type StableHashCtxt } from "../../rustc_data_structures/stable_hash.ts";
import {
  type Annotatable,
  debug_Annotatable,
  type ExpandResult,
  ExtCtxt,
  ModuleData,
  type MultiItemModifier,
  type ResolverExpand,
  type SyntaxExtensionKind,
} from "../../rustc_expand/base.ts";
import { ExpansionConfig } from "../../rustc_expand/expand.ts";
import { Features } from "../../rustc_feature/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { AllowConstBlockItems, ForceCollect } from "../../rustc_parse/parser/mod.gen.ts";
import { new_parser_from_source_str, unwrap_or_emit_fatal } from "../../rustc_parse/lib.ts";
import { Options_default } from "../../rustc_session/config.ts";
import { Edition } from "../../rustc_span/edition.ts";
import { ExpnData, LocalExpnId, MacroKind } from "../../rustc_span/hygiene.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { Ident, Symbol, sym } from "../../rustc_span/symbol.ts";
import { FatalErrorMarker } from "../../rustc_span/fatal_error.ts";
import { Limit } from "../../rustc_structures/lib.ts";
import { format_debug, PLAIN, PRETTY } from "../../std/fmt.ts";
import { panic, Unported, unwrap } from "../../std/panic.ts";
import { BuiltinDerive, type BuiltinDeriveFn } from "../deriving/mod.ts";
import { register_builtin_macros } from "../lib.ts";
import { expand_deriving_copy, expand_deriving_eq, expand_deriving_hash } from "./fixtures.ts";

function out(fd: 1 | 2, s: string): void {
  const buf = Buffer.from(s, "utf8");
  let off = 0;
  while (off < buf.length) off += writeSync(fd, buf, off);
}
const println = (s: string): void => out(1, `${s}\n`);
const eprintln = (s: string): void => out(2, `${s}\n`);

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
      for (let i = 0; i < 5; i++) {
        const k = rest.indexOf(" | ");
        f.push(rest.slice(0, k));
        rest = rest.slice(k + 3);
      }
      f.push(rest);
      const edition = ({ "2015": Edition.Edition2015, "2018": Edition.Edition2018, "2021": Edition.Edition2021, "2024": Edition.Edition2024 } as const)[
        f[2] as "2015"
      ];
      return {
        name: f[0]!,
        kind: f[1]!,
        edition,
        features: f[3] === "-" ? [] : f[3]!.split(","),
        pending: f[4] !== "-",
        src: f[5]!.replaceAll("\\n", "\n"),
      };
    });
}

/** Test fixtures standing in for lane bm-derive-b's derives (see fixtures.ts). */
const FIXTURES = new Map<Symbol, BuiltinDeriveFn>([
  [sym.Copy, expand_deriving_copy],
  [sym.Hash, expand_deriving_hash],
  [sym.Eq, expand_deriving_eq],
]);

function print_result(res: ExpandResult<Annotatable[], Annotatable>): void {
  if (res.$ === "Retry") {
    println(`Retry ${format_debug(res._0, debug_Annotatable, PRETTY)}`);
  } else {
    println(`Ready ${res._0.length}`);
    for (const a of res._0) println(format_debug(a, debug_Annotatable, PRETTY));
  }
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

// PORT(test): probe.rs ends by unwinding out of `run_compiler` with `FatalError` (errors were
// emitted), which prints nothing; catch the same marker here.
try {
  run_compiler(config, (compiler) => {
    const sess = compiler.sess;

    const recorded: [Symbol, SyntaxExtensionKind][] = [];
    register_builtin_macros(resolver({ register_builtin_macro: (name, ext) => void recorded.push([name, ext]) }));

    const mock = resolver({
      has_derive_copy: () => {
        println("has_derive_copy -> false");
        return false;
      },
      has_derive_ord: () => {
        println("has_derive_ord -> false");
        return false;
      },
      resolve_derives: (_expn_id, force, derive_paths) => {
        println(`resolve_derives(force = ${force})`);
        const resolutions = derive_paths();
        let indeterminate = false;
        for (const r of resolutions) {
          println(`resolution ${format_debug(r.path, ast.debug_Path, PLAIN)} is_const=${r.is_const} exts=${r.exts !== undefined}`);
          println(format_debug(r.item, debug_Annotatable, PRETTY));
          if (Symbol.as_str(unwrap(r.path.segments[r.path.segments.length - 1]).ident.name) === "later") {
            indeterminate = true;
          }
        }
        if (indeterminate && !force) return { $: "Err", _0: { $: "Indeterminate" } };
        return { $: "Ok", _0: undefined };
      },
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
  // `ExpansionConfig::default(sym::main, &features)` written out, as in builtins_oracle/run.ts.
  const ecfg = new ExpansionConfig(sym.main, features, Limit.new(1024), false, false, false, false);
  const cx = ExtCtxt.new(sess, ecfg, mock, undefined);
  cx.current_expansion.module = new ModuleData([Ident.with_dummy_span(sym.main)], [], "");
  const p = unwrap_or_emit_fatal(new_parser_from_source_str(sess.psess, { $: "Custom", _0: c.name }, c.src, "Nothing"));
  const ir = p.parse_item(ForceCollect.No, AllowConstBlockItems.Yes);
  if (ir.$ === "Err") return panic("parse");
  const item = unwrap(ir._0);
  const attr = item.attrs.splice(0, 1)[0]!;
  const attr_name = unwrap(attr.name());
  const meta = unwrap(attr.meta());
  let stmt: boolean;
  let kind: "attr" | "builtin";
  switch (c.kind) {
    case "attr":
      [stmt, kind] = [false, "attr"];
      break;
    case "attr_stmt":
      [stmt, kind] = [true, "attr"];
      break;
    case "builtin":
      [stmt, kind] = [false, "builtin"];
      break;
    case "builtin_stmt":
      [stmt, kind] = [true, "builtin"];
      break;
    default:
      return panic(`kind ${c.kind}`);
  }
  const annotatable: Annotatable = stmt
    ? { $: "Stmt", _0: new ast.Stmt(ast.DUMMY_NODE_ID, { $: "Item", _0: item }, item.span) }
    : { $: "Item", _0: item };
  const find = (name: Symbol): SyntaxExtensionKind => unwrap(recorded.find(([n]) => n === name))[1];
  if (kind === "attr") {
    const expn_data = ExpnData.default({ $: "Macro", _0: MacroKind.Attr, _1: attr_name }, attr.span, c.edition, undefined, undefined);
    cx.current_expansion.id = LocalExpnId.fresh(expn_data, NoSpanHcx);
    const ext = find(attr_name);
    if (ext.$ !== "LegacyAttr") return panic("LegacyAttr");
    print_result(ext._0.expand(cx, attr.span, meta, annotatable, false));
  } else {
    const is_const = attr_name === sym.derive_const;
    if (meta.kind.$ !== "List") return panic("derive list");
    const derive_meta = ast.clone_MetaItem(unwrap(ast.MetaItemInner.meta_item(meta.kind._0[0]!)));
    const name = unwrap(derive_meta.path.segments[derive_meta.path.segments.length - 1]).ident.name;
    const span = derive_meta.path.span;
    const expn_data = ExpnData.default({ $: "Macro", _0: MacroKind.Derive, _1: name }, span, c.edition, undefined, undefined);
    cx.current_expansion.id = LocalExpnId.fresh(expn_data, NoSpanHcx);
    const ext = find(name);
    if (ext.$ !== "LegacyDerive") return panic("LegacyDerive");
    const fixture = FIXTURES.get(name);
    const expander: MultiItemModifier = fixture !== undefined ? new BuiltinDerive(fixture) : ext._0;
    print_result(expander.expand(cx, span, derive_meta, annotatable, is_const));
  }
}
