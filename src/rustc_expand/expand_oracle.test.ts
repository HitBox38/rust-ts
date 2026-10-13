// Oracle scenarios for lane expand-core: `MacroExpander::expand_crate` / `fully_expand_fragment` /
// `InvocationCollector` (expand.rs) driven by a mock `ResolverExpand`.
//
// Expectations: expand_oracle/out.json, produced by the rustc-dev probe expand_oracle/probe.rs (pinned
// nightly; how to rebuild it is in its header) over expand_oracle/cases.txt. The probe runs the real
// rustc `MacroExpander` with the same mock resolver as `MockResolver` below; per case, every resolver
// event (which includes the `{:?}` of each fragment with its placeholders, so the `LocalExpnId` /
// placeholder `NodeId` allocation order), the buffered early lints, the `{:#?}` of the expanded crate
// (the `NodeId`s assigned through `next_node_id`) and the -Zui-testing stderr must match byte for byte.
// Both sides run `run_compiler` with default options, edition 2024, target x86_64-unknown-linux-gnu.
//
// PENDING: cases that reach code owned by another lane must throw exactly the listed `Unported` until
// that lane lands; then they must match and root drops them from PENDING (the test fails otherwise).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import "./lib.ts";
import {
  CRATE_NODE_ID,
  debug_Arm,
  debug_AssocItemKind,
  debug_Crate,
  debug_Expr,
  debug_ExprField,
  debug_FieldDef,
  debug_ForeignItemKind,
  debug_GenericParam,
  debug_Item,
  debug_ItemKind,
  debug_Param,
  debug_Pat,
  debug_PatField,
  debug_Stmt,
  debug_Ty,
  debug_Variant,
  debug_WherePredicate,
  type MetaItem,
  type NodeId,
  node_id,
} from "../rustc_ast/lib.ts";
import { type CfgEntry, debug_CfgEntry } from "../rustc_ast/attr/data_structures.ts";
import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import { pprust } from "../rustc_ast_pretty/lib.ts";
import { debug_MultiSpan } from "../rustc_error_messages/lib.gen.ts";
import { AnnotateSnippetEmitter } from "../rustc_errors/annotate_snippet_emitter_writer.ts";
import type { ErrorGuaranteed } from "../rustc_errors/lib.ts";
import { Features } from "../rustc_feature/lib.ts";
import { type Config, run_compiler } from "../rustc_interface/lib.ts";
import { new_parser_from_source_str, unwrap_or_emit_fatal } from "../rustc_parse/lib.ts";
import { Options_default } from "../rustc_session/config.ts";
import { debug_LocalExpnId, type LocalExpnId } from "../rustc_span/hygiene.ts";
import { debug_Span, type FileName, type Span } from "../rustc_span/lib.ts";
import { get_source_map } from "../rustc_span/source_map.ts";
import { debug_Ident, debug_Symbol, type Ident, Symbol } from "../rustc_span/symbol.ts";
import { TargetTuple } from "../rustc_target/spec/tuple.ts";
import { debug_option, debug_vec, type Debug, PLAIN } from "../std/fmt.ts";
import { Panic, Unported } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { AutoStream, ColorChoice } from "../vendor/anstream/lib.ts";
import { dyn_write, VecU8 } from "../vendor/anstream/stream.ts";
import {
  type Annotatable,
  AttrProcMacro_from_fn,
  BangProcMacro_from_fn,
  ExtCtxt,
  Indeterminate,
  MultiItemModifier_from_fn,
  type ResolverExpand,
  SyntaxExtension,
  type SyntaxExtensionKind,
} from "./base.ts";
import { type AstFragment, debug_AstFragmentKind, ExpansionConfig, type Invocation } from "./expand.ts";

interface Case {
  name: string;
  src: string;
  events: string[];
  ast: string;
  stderr: string;
  panic: string | null;
}
const oracle = JSON.parse(readFileSync(join(import.meta.dir, "expand_oracle", "out.json"), "utf8")) as Case[];

/** case -> the `Unported` it must reach until the owning lane lands. */
const PENDING: Record<string, string> = {};

const C = (f: string): string => f;

/** The probe's `frag`: `{:?}` of the fragment's payload, under the variant name. */
function frag(f: AstFragment): string {
  const d = <T>(name: string, v: T, dbg: Debug<T>): string => `${name}(${dbg(v, PLAIN)})`;
  switch (f.$) {
    case "OptExpr":
      return d("OptExpr", f._0, (v, fm) => debug_option(v, fm, debug_Expr));
    case "MethodReceiverExpr":
      return d("MethodReceiverExpr", f._0, debug_Expr);
    case "Expr":
      return d("Expr", f._0, debug_Expr);
    case "Pat":
      return d("Pat", f._0, debug_Pat);
    case "Ty":
      return d("Ty", f._0, debug_Ty);
    case "Stmts":
      return d("Stmts", f._0, (v, fm) => debug_vec(v, fm, debug_Stmt));
    case "Items":
      return d("Items", f._0, (v, fm) => debug_vec(v, fm, (x, fm) => debug_Item(x, fm, debug_ItemKind)));
    case "TraitItems":
    case "ImplItems":
    case "TraitImplItems":
      return d(f.$, f._0, (v, fm) => debug_vec(v, fm, (x, fm) => debug_Item(x, fm, debug_AssocItemKind)));
    case "ForeignItems":
      return d("ForeignItems", f._0, (v, fm) => debug_vec(v, fm, (x, fm) => debug_Item(x, fm, debug_ForeignItemKind)));
    case "Arms":
      return d("Arms", f._0, (v, fm) => debug_vec(v, fm, debug_Arm));
    case "ExprFields":
      return d("ExprFields", f._0, (v, fm) => debug_vec(v, fm, debug_ExprField));
    case "PatFields":
      return d("PatFields", f._0, (v, fm) => debug_vec(v, fm, debug_PatField));
    case "GenericParams":
      return d("GenericParams", f._0, (v, fm) => debug_vec(v, fm, debug_GenericParam));
    case "Params":
      return d("Params", f._0, (v, fm) => debug_vec(v, fm, debug_Param));
    case "FieldDefs":
      return d("FieldDefs", f._0, (v, fm) => debug_vec(v, fm, debug_FieldDef));
    case "Variants":
      return d("Variants", f._0, (v, fm) => debug_vec(v, fm, debug_Variant));
    case "WherePredicates":
      return d("WherePredicates", f._0, (v, fm) => debug_vec(v, fm, debug_WherePredicate));
    case "Crate":
      return d("Crate", f._0, debug_Crate);
  }
}

function invoc_path(invoc: Invocation): [string, string] {
  const k = invoc.kind;
  switch (k.$) {
    case "Bang":
      return ["Bang", pprust.path_to_string(k.mac.path)];
    case "Attr":
      return ["Attr", pprust.path_to_string(k.attr.get_normal_item().path)];
    case "Derive":
      return ["Derive", pprust.path_to_string(k.path)];
    case "GlobDelegation":
      return ["GlobDelegation", debug_Span(k.item.span, PLAIN)];
  }
}

const ext = (kind: SyntaxExtensionKind): SyntaxExtension => SyntaxExtension.default(kind, "Edition2024");
const echo = BangProcMacro_from_fn((_cx, _sp, ts) => Ok(ts));
const bad = BangProcMacro_from_fn((cx, sp, _ts) => Err(cx.dcx().span_err(sp, "mock: bad macro")));
const echo_attr = AttrProcMacro_from_fn((_annotation: TokenStream, annotated: TokenStream) => annotated);
const keep = MultiItemModifier_from_fn((_cx, _sp, _meta: MetaItem, item: Annotatable) => [item]);
const drop_it = MultiItemModifier_from_fn((_cx, _sp, _meta: MetaItem, _item: Annotatable) => []);

const unreachable_ = (what: string): never => {
  throw new Error(`MockResolver: unexpected call ${what}`);
};

/** The probe's `MockResolver` (see probe.rs). */
class MockResolver implements ResolverExpand {
  next_node_id_: NodeId = CRATE_NODE_ID;
  events: string[] = [];
  attempts = new Map<LocalExpnId, number>();
  tools = new Set<Ident>();
  constructor(public cx_err: (invoc: Invocation, msg: string) => ErrorGuaranteed) {}

  next_node_id(): NodeId {
    const start = this.next_node_id_;
    this.next_node_id_ = node_id.NodeId.from_u32(node_id.NodeId.as_u32(start) + 1);
    return start;
  }
  invocation_parent(): never {
    return unreachable_("invocation_parent");
  }
  resolve_dollar_crates(): void {}
  visit_ast_fragment_with_placeholders(expn_id: LocalExpnId, fragment: AstFragment): void {
    this.events.push(`visit_ast_fragment_with_placeholders ${debug_LocalExpnId(expn_id, PLAIN)} ${frag(fragment)}`);
  }
  register_builtin_macro(): never {
    return unreachable_("register_builtin_macro");
  }
  expansion_for_ast_pass(): never {
    return unreachable_("expansion_for_ast_pass");
  }
  resolve_imports(): void {
    this.events.push("resolve_imports");
  }
  resolve_macro_invocation(invoc: Invocation, eager_expansion_root: LocalExpnId, force: boolean): Result<SyntaxExtension, Indeterminate> {
    const [kind, path] = invoc_path(invoc);
    const id = invoc.expansion_data.id;
    const attempt = (this.attempts.get(id) ?? 0) + 1;
    this.attempts.set(id, attempt);
    const ed = invoc.expansion_data;
    this.events.push(
      `resolve_macro_invocation ${debug_LocalExpnId(id, PLAIN)} ${kind} ${path} fragment=${debug_AstFragmentKind(invoc.fragment_kind)} ` +
        `depth=${ed.depth} root=${debug_LocalExpnId(eager_expansion_root, PLAIN)} force=${force} ` +
        `lint_node_id=${node_id.debug_NodeId(ed.lint_node_id, PLAIN)} trailing=${ed.is_trailing_mac}`,
    );
    const name = path.split("::").pop()!;
    let r: Result<SyntaxExtension, Indeterminate>;
    if (name === "echo") r = Ok(ext({ $: "Bang", _0: echo }));
    else if (name === "bad") r = Ok(ext({ $: "Bang", _0: bad }));
    else if (name === "echo_attr") r = Ok(ext({ $: "Attr", _0: echo_attr }));
    else if (name === "keep") r = Ok(ext({ $: "LegacyAttr", _0: keep }));
    else if (name === "drop_it") r = Ok(ext({ $: "LegacyAttr", _0: drop_it }));
    else if (name === "inert") r = Ok(ext({ $: "NonMacroAttr" }));
    else if (name === "later" && attempt === 1) r = Err(Indeterminate);
    else if (name === "later") r = Ok(ext({ $: "Bang", _0: echo }));
    else if (!force) r = Err(Indeterminate);
    else {
      const guar = this.cx_err(invoc, `mock: cannot find macro \`${name}\``);
      r = Ok(ext({ $: "Bang", _0: BangProcMacro_from_fn(() => Err(guar)) }));
    }
    this.events.push(`  => ${r.$ === "Ok" ? "Ok" : "Indeterminate"}`);
    return r;
  }
  record_macro_rule_usage(): never {
    return unreachable_("record_macro_rule_usage");
  }
  check_unused_macros(): never {
    return unreachable_("check_unused_macros");
  }
  has_derive_copy(): never {
    return unreachable_("has_derive_copy");
  }
  has_derive_ord(): never {
    return unreachable_("has_derive_ord");
  }
  resolve_derives(): never {
    return unreachable_("resolve_derives");
  }
  take_derive_resolutions(expn_id: LocalExpnId): undefined {
    this.events.push(`take_derive_resolutions ${debug_LocalExpnId(expn_id, PLAIN)}`);
    return undefined;
  }
  cfg_accessible(): never {
    return unreachable_("cfg_accessible");
  }
  macro_accessible(): never {
    return unreachable_("macro_accessible");
  }
  get_proc_macro_quoted_span(): never {
    return unreachable_("get_proc_macro_quoted_span");
  }
  declare_proc_macro(): never {
    return unreachable_("declare_proc_macro");
  }
  append_stripped_cfg_item(parent_node: NodeId, ident: Ident, cfg: CfgEntry, cfg_span: Span): void {
    this.events.push(
      `append_stripped_cfg_item ${node_id.debug_NodeId(parent_node, PLAIN)} ${debug_Ident(ident, PLAIN)} ` +
        `${debug_CfgEntry(cfg, PLAIN)} ${debug_Span(cfg_span, PLAIN)}`,
    );
  }
  registered_attr_tools(): Set<Ident> {
    return this.tools;
  }
  registered_lint_tools(): Set<Ident> {
    return this.tools;
  }
  register_glob_delegation(invoc_id: LocalExpnId): void {
    this.events.push(`register_glob_delegation ${debug_LocalExpnId(invoc_id, PLAIN)}`);
  }
  glob_delegation_suffixes(): never {
    return unreachable_("glob_delegation_suffixes");
  }
  insert_impl_trait_name(id: NodeId, name: Symbol): void {
    this.events.push(`insert_impl_trait_name ${node_id.debug_NodeId(id, PLAIN)} ${debug_Symbol(name, PLAIN)}`);
  }
  mark_scope_with_compile_error(): never {
    return unreachable_("mark_scope_with_compile_error");
  }
}

function run_case(c: Case): { events: string[]; ast: string; stderr: string; panic: string | null } {
  const events: string[] = [];
  let ast = "";
  let panic: string | null = null;
  let stderr = "";
  const opts = Options_default();
  opts.edition = "Edition2024";
  opts.target_triple = TargetTuple.from_tuple("x86_64-unknown-linux-gnu");
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
    const sm = get_source_map()!;
    const buf = new VecU8();
    let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
    em = AnnotateSnippetEmitter.sm(em, sm);
    em = AnnotateSnippetEmitter.ui_testing(em, true);
    sess.dcx().set_emitter(em);
    const fname: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), "t.rs") };
    const resolver = new MockResolver((invoc, msg) => sess.dcx().span_err(invoc.span(), msg));
    try {
      const p = unwrap_or_emit_fatal(new_parser_from_source_str(sess.psess, fname, c.src, "Nothing"));
      const kr = p.parse_crate_mod();
      if (kr.$ === "Err") {
        kr._0.emit();
      } else {
        const features = Features.default();
        const ecfg = ExpansionConfig.default(Symbol.intern("t"), features);
        const cx = ExtCtxt.new(sess, ecfg, resolver, undefined);
        const krate = cx.monotonic_expander().expand_crate(kr._0);
        ast = debug_Crate(krate, { alternate: true });
      }
    } catch (e) {
      if (e instanceof Unported) throw e;
      if (!(e instanceof Panic)) throw e;
      panic = e.message;
    }
    events.push(...resolver.events);
    for (const l of sess.psess.buffered_lints) {
      events.push(`buffered ${l.lint_id.lint.name} ${debug_option(l.span, PLAIN, debug_MultiSpan)}`);
    }
    sess.dcx().reset_err_count();
    stderr = new TextDecoder().decode(buf.bytes());
  });
  return { events, ast, stderr, panic };
}

for (const c of oracle) {
  test(`expand oracle: ${C(c.name)}`, () => {
    const pending = PENDING[c.name];
    if (pending !== undefined) {
      expect(() => run_case(c)).toThrow(new Unported(pending));
      return;
    }
    const got = run_case(c);
    expect(got.events).toEqual(c.events);
    expect(got.ast).toBe(c.ast);
    expect(got.stderr).toBe(c.stderr);
    expect(got.panic).toBe(c.panic);
  });
}

test("expand oracle: every PENDING case exists", () => {
  const names = new Set(oracle.map((c) => c.name));
  for (const k of Object.keys(PENDING)) expect(names.has(k)).toBe(true);
});
