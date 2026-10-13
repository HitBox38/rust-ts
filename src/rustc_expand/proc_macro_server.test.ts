// Oracle test for proc_macro_server.rs (and the bridge types in src/proc_macro/): replays
// proc_macro_oracle/expected.json, produced by gen.ts from the pinned rustc running the proc-macro crate
// proc_macro_oracle/pm_probe.rs on every `proc_macro_oracle/cases/<name>/t.rs`.
//
// The probe's macros run in the real `proc_macro_server::Rustc` and print, as `@@ ` lines on stderr, what the
// bridge hands them (`ts_into_trees`, `ts_to_string`, the span queries, `literal_from_str`, `ts_from_str`,
// `ts_concat_trees` / `ts_concat_streams` with gluing, `ts_expand_expr`), interleaved with the diagnostics the
// server emits (`emit_diagnostic`, lexer errors). Here every `pm_probe::<macro>!(..)` item of t.rs gets a fresh
// expansion (`ExpnData` as rustc_resolve gives a proc macro: `Macro(Bang, "pm_probe::<macro>")`, call site =
// `mac.span()`), a TS `Rustc::new(cx)`, and a mirror of the macro's client-side code (`Client` below: the
// `proc_macro` API calls it makes, their `Debug`/`Display` impls from library/proc_macro/src/lib.rs, and the
// `@@` masking of the call-site span) writing into the same buffer as the -Zui-testing emitter. The buffer,
// the exit status and any ICE message must equal the oracle's.
import "./lib.ts";

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ast, type token, tokenstream } from "../rustc_ast/lib.ts";
import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import { Fingerprint } from "../rustc_data_structures/fingerprint.ts";
import type { StableHashCtxt } from "../rustc_data_structures/stable_hash.ts";
import { AnnotateSnippetEmitter } from "../rustc_errors/annotate_snippet_emitter_writer.ts";
import { Features } from "../rustc_feature/lib.ts";
import { type Config, run_compiler } from "../rustc_interface/lib.ts";
import { new_parser_from_source_str, unwrap_or_emit_fatal } from "../rustc_parse/lib.ts";
import { Options_default } from "../rustc_session/config.ts";
import { CrateNum, DefId, DefIndex } from "../rustc_span/def_id.ts";
import { ExpnData, LocalExpnId, MacroKind } from "../rustc_span/hygiene.ts";
import { type FileName, Span } from "../rustc_span/lib.ts";
import { get_source_map } from "../rustc_span/source_map.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { debug_char, debug_list, debug_option, debug_str, debug_struct, type Fmt, PLAIN, PRETTY } from "../std/fmt.ts";
import { Panic, panic, Unported } from "../std/panic.ts";
import { AutoStream, ColorChoice } from "../vendor/anstream/lib.ts";
import { dyn_write, VecU8 } from "../vendor/anstream/stream.ts";
import { debug_Delimiter, type Delimiter } from "../proc_macro/lib.ts";
import { DelimSpan, type Diagnostic, debug_LitKind, IdentKind, type Literal, type TokenTree } from "../proc_macro/bridge/mod.ts";
import type { Bound } from "../proc_macro/bridge/server.ts";
import type { Level } from "../proc_macro/diagnostic.ts";
import { ExtCtxt, type ResolverExpand } from "./base.ts";
import { ExpansionConfig } from "./expand.ts";
import type { Expected } from "./proc_macro_oracle/gen.ts";
import { Rustc } from "./proc_macro_server.ts";

const HERE = join(import.meta.dir, "proc_macro_oracle");
const expected: Record<string, Expected> = JSON.parse(readFileSync(join(HERE, "expected.json"), "utf8"));

/** Cases that need a later lane (each must fail with exactly this `Unported`); none today. */
const PENDING: Record<string, string> = {};

type Tree = TokenTree<TokenStream, Span, Symbol>;
/** A client-side `proc_macro::TokenStream`: `Option<handle>` (`None` for an empty stream built on the client). */
type CTs = TokenStream | undefined;

const NoSpanHcx: StableHashCtxt = {
  stable_hash_span: () => {},
  def_path_hash: () => Fingerprint.ZERO,
  stable_hash_controls: () => ({ hash_spans: false }),
  assert_default_stable_hash_controls: () => {},
};

// PORT(test): the only resolver method a probe macro reaches is `resolve_dollar_crates` (`collect_invocations`
// of `expand_expr`'s non-monotonic expander); the cases have no `$crate`, so rustc_resolve's
// `update_dollar_crate_names` has nothing to rename and the mock does nothing. Everything else panics.
const NoResolver = new Proxy({} as ResolverExpand, {
  get(_t, p) {
    if (p === "resolve_dollar_crates") return () => {};
    return () => panic(`not implemented: ResolverExpand::${String(p)}`);
  },
});

/** `str::lines` */
function str_lines(s: string): string[] {
  const out = s.split("\n");
  if (out[out.length - 1] === "") out.pop();
  return out.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
}

/** The client side of pm_probe.rs, calling the TS server where the real client calls the bridge. */
class Client {
  lines: string[] = [];
  readonly call_site: Span;
  readonly cs: string;
  readonly cs_ctxt: string;

  constructor(
    readonly s: Rustc,
    readonly buf: VecU8,
  ) {
    // `ExpnGlobals` are sent with the input; `Span::call_site()` is `globals.call_site`.
    this.call_site = s.globals().call_site;
    this.cs = this.span(this.call_site);
    this.cs_ctxt = `${this.cs.split(" ")[0]!} `;
  }

  // ---- pm_probe.rs `Out` ----
  push(s: string): void {
    s = s.replaceAll(this.cs, "CALL_SITE").replaceAll(this.cs_ctxt, "#CS ");
    for (const l of str_lines(s)) this.lines.push(l);
  }
  flush(): void {
    for (const l of this.lines) this.buf.write_all(new TextEncoder().encode(`@@ ${l}\n`));
    this.lines = [];
  }

  // ---- library/proc_macro/src/lib.rs (client side) ----
  /** `impl Debug for Span` -> `span_debug` */
  span(sp: Span): string {
    return this.s.span_debug(sp);
  }
  /** `TokenStream::into_iter` (`self.clone()` in `Debug` is a `ts_clone`) */
  trees(ts: CTs): Tree[] {
    return ts === undefined ? [] : this.s.ts_into_trees(this.s.ts_clone(ts));
  }
  /** `impl Display for TokenStream` */
  to_string(ts: CTs): string {
    return ts === undefined ? "" : this.s.ts_to_string(ts);
  }
  /** `TokenStream::is_empty` */
  is_empty(ts: CTs): boolean {
    return ts === undefined ? true : this.s.ts_is_empty(ts);
  }
  /** `impl FromIterator<TokenTree> for TokenStream` (`ConcatTreesHelper::build`) */
  collect_trees(trees: Tree[]): CTs {
    return trees.length === 0 ? undefined : this.s.ts_concat_trees(undefined, trees);
  }
  /** `impl FromIterator<TokenStream> for TokenStream` (`ConcatStreamsHelper::build`) */
  collect_streams(streams: CTs[]): CTs {
    const v = streams.filter((s): s is TokenStream => s !== undefined);
    return v.length <= 1 ? v.pop() : this.s.ts_concat_streams(undefined, v);
  }
  /** `impl Extend<TokenStream> for TokenStream` (`ConcatStreamsHelper::append_to`) */
  extend_streams(base: CTs, streams: CTs[]): CTs {
    const v = streams.filter((s): s is TokenStream => s !== undefined);
    if (v.length === 0) return base;
    if (base === undefined && v.length === 1) return v.pop();
    return this.s.ts_concat_streams(base, v);
  }
  /** `TokenStream::clone` */
  clone(ts: CTs): CTs {
    return ts === undefined ? undefined : this.s.ts_clone(ts);
  }
  /** `TokenTree::span` */
  tree_span(t: Tree): Span {
    return t.$ === "Group" ? t._0.span.entire : t._0.span;
  }
  /** `impl Display for Ident` */
  ident_to_string(sym: Symbol, kind: IdentKind): string {
    return (IdentKind.prefix(kind) ?? "") + Symbol.as_str(sym);
  }
  /** `impl Display for Literal` (`with_stringify_parts`) */
  literal_to_string(l: Literal<Span, Symbol>): string {
    const symbol = Symbol.as_str(l.symbol);
    const suffix = l.suffix === undefined ? "" : Symbol.as_str(l.suffix);
    const k = l.kind;
    switch (k.$) {
      case "Byte":
        return `b'${symbol}'${suffix}`;
      case "Char":
        return `'${symbol}'${suffix}`;
      case "Str":
        return `"${symbol}"${suffix}`;
      case "StrRaw":
        return `r${"#".repeat(k._0)}"${symbol}"${"#".repeat(k._0)}${suffix}`;
      case "ByteStr":
        return `b"${symbol}"${suffix}`;
      case "ByteStrRaw":
        return `br${"#".repeat(k._0)}"${symbol}"${"#".repeat(k._0)}${suffix}`;
      case "CStr":
        return `c"${symbol}"${suffix}`;
      case "CStrRaw":
        return `cr${"#".repeat(k._0)}"${symbol}"${"#".repeat(k._0)}${suffix}`;
      case "Integer":
      case "Float":
      case "ErrWithGuar":
        return symbol + suffix;
    }
  }
  /** `impl Debug for Literal` */
  debug_literal(l: Literal<Span, Symbol>, f: Fmt): string {
    return debug_struct(f, "Literal", [
      ["kind", debug_LitKind(l.kind, PLAIN)],
      ["symbol", debug_str(Symbol.as_str(l.symbol))],
      ["suffix", debug_option(l.suffix, PLAIN, (s) => debug_str(Symbol.as_str(s)))],
      ["span", this.span(l.span)],
    ]);
  }
  /** `impl Debug for TokenTree` (and `Group`, `Ident`, `Punct`) */
  debug_tree(t: Tree, f: Fmt): string {
    switch (t.$) {
      case "Group": {
        const g = t._0;
        return debug_struct(f, "Group", [
          ["delimiter", debug_Delimiter(g.delimiter, f)],
          ["stream", this.debug_ts(this.clone(g.stream), f)],
          ["span", this.span(g.span.entire)],
        ]);
      }
      case "Ident":
        return debug_struct(f, "Ident", [
          ["ident", debug_str(this.ident_to_string(t._0.sym, t._0.kind))],
          ["span", this.span(t._0.span)],
        ]);
      case "Punct":
        return debug_struct(f, "Punct", [
          ["ch", debug_char(t._0.ch)],
          ["spacing", t._0.joint ? "Joint" : "Alone"],
          ["span", this.span(t._0.span)],
        ]);
      case "Literal":
        return this.debug_literal(t._0, f);
    }
  }
  /** `impl Debug for TokenStream` */
  debug_ts(ts: CTs, f: Fmt): string {
    return `TokenStream ${debug_list(
      f,
      this.trees(ts).map((t) => this.debug_tree(t, f)),
    )}`;
  }
  debug_opt_span(sp: Span | undefined): string {
    return debug_option(sp, PLAIN, (s) => this.span(s));
  }

  // ---- pm_probe.rs ----
  rebuild(ts: CTs): CTs {
    return this.collect_trees(
      this.trees(ts).map((tt): Tree => {
        if (tt.$ !== "Group") return tt;
        const g = tt._0;
        // `Group::new(g.delimiter(), rebuild(g.stream()))` then `set_span(g.span())`.
        const ng = { delimiter: g.delimiter, stream: this.rebuild(this.clone(g.stream)), span: DelimSpan.from_single(this.call_site) };
        ng.span = DelimSpan.from_single(g.span.entire);
        return { $: "Group", _0: ng };
      }),
    );
  }

  span_info(what: string, sp: Span): void {
    const s = this.s;
    const r = s.span_byte_range(sp);
    this.push(
      `${what} ${this.span(sp)} line=${s.span_line(sp)} col=${s.span_column(sp)} range=${r.start}..${r.end} ` +
        `start=${this.span(s.span_start(sp))} end=${this.span(s.span_end(sp))} ` +
        `text=${debug_option(s.span_source_text(sp), PLAIN, debug_str)} file=${debug_str(s.span_file(sp))} ` +
        `local=${debug_option(s.span_local_file(sp), PLAIN, debug_str)} parent=${this.debug_opt_span(s.span_parent(sp))} ` +
        `source=${this.span(s.span_source(sp))}`,
    );
  }

  walk_spans(ts: CTs): void {
    const s = this.s;
    for (const tt of this.trees(ts)) {
      switch (tt.$) {
        case "Group": {
          const g = tt._0;
          this.span_info(`group ${debug_Delimiter(g.delimiter, PLAIN)}`, g.span.entire);
          this.span_info("  open", g.span.open);
          this.span_info("  close", g.span.close);
          this.push(`  join(open, close)=${this.debug_opt_span(s.span_join(g.span.open, g.span.close))}`);
          this.walk_spans(this.clone(g.stream));
          break;
        }
        case "Ident":
          this.span_info(`ident ${this.ident_to_string(tt._0.sym, tt._0.kind)}`, tt._0.span);
          break;
        case "Punct":
          this.span_info(`punct ${String.fromCharCode(tt._0.ch)}`, tt._0.span);
          break;
        case "Literal": {
          const l = tt._0;
          this.span_info(`literal ${this.literal_to_string(l)}`, l.span);
          const sub = (a: Bound, b: Bound): string => this.debug_opt_span(s.span_subspan(l.span, a, b));
          const I = (n: number): Bound => ({ $: "Included", _0: n });
          const E = (n: number): Bound => ({ $: "Excluded", _0: n });
          const U: Bound = { $: "Unbounded" };
          this.push(
            `  subspan(1..2)=${sub(I(1), E(2))} subspan(..)=${sub(U, U)} subspan(1..=1)=${sub(I(1), I(1))} ` +
              `subspan(0..0)=${sub(I(0), E(0))} subspan(..100)=${sub(U, E(100))}`,
          );
          this.push(`  resolved_at(call_site)=${this.span(s.span_resolved_at(l.span, this.call_site))}`);
          break;
        }
      }
    }
  }

  probe(input: CTs): void {
    this.push(`input ${this.debug_ts(input, PRETTY)}`);
    this.push(`input.to_string() ${debug_str(this.to_string(input))}`);
    this.push(`is_empty ${this.is_empty(input)}`);
    const rebuilt = this.rebuild(this.clone(input));
    this.push(`rebuilt.to_string() ${debug_str(this.to_string(rebuilt))}`);
    this.push(`rebuilt ${this.debug_ts(rebuilt, PRETTY)}`);
    this.flush();
  }

  spans(input: CTs): void {
    this.walk_spans(this.clone(input));
    const it = this.trees(input);
    if (it.length >= 2) {
      const a = this.tree_span(it[0]!);
      const b = this.tree_span(it[it.length - 1]!);
      this.push(`join(first, last)=${this.debug_opt_span(this.s.span_join(a, b))}`);
      this.push(`join(last, first)=${this.debug_opt_span(this.s.span_join(b, a))}`);
      this.push(`join(first, call_site)=${this.debug_opt_span(this.s.span_join(a, this.call_site))}`);
    }
    this.flush();
  }

  lit(s: string): void {
    const r = this.s.literal_from_str(s);
    if (r.$ === "Ok") {
      const l = r._0;
      this.push(`lit ${debug_str(s)} -> ${this.debug_literal(l, PLAIN)}`);
      const ts = this.s.ts_from_token_tree({ $: "Literal", _0: l });
      this.push(`  stream ${debug_str(this.to_string(ts))} ${this.debug_ts(ts, PLAIN)}`);
    } else {
      this.push(`lit ${debug_str(s)} -> Err(LexError(${debug_str(r._0)}))`);
    }
    this.flush();
  }

  stream(s: string): void {
    const r = this.s.ts_from_str(s);
    if (r.$ === "Ok") {
      this.push(`stream ${debug_str(s)} -> ${debug_str(this.to_string(r._0))} ${this.debug_ts(r._0, PRETTY)}`);
    } else {
      this.push(`stream ${debug_str(s)} -> Err(LexError(${debug_str(r._0)}))`);
    }
    this.flush();
  }

  /** `Symbol::new_ident(string, is_raw)` (bridge/symbol.rs): the ASCII fast path or the server. */
  new_ident(string: string, _is_raw: boolean): Symbol {
    if (/^[_a-zA-Z][_a-zA-Z0-9]*$/.test(string) || string === "$crate") return Rustc.intern_symbol(string);
    if (/^[\x00-\x7f]*$/.test(string)) return panic(`\`${debug_str(string)}\` is not a valid identifier`);
    const r = this.s.symbol_normalize_and_validate_ident(string);
    if (r.$ === "Err") return panic(`\`${debug_str(string)}\` is not a valid identifier`);
    return r._0;
  }

  construct(input: CTs): void {
    const first = this.trees(input)[0];
    const sp = first === undefined ? this.call_site : this.tree_span(first);
    const p = (c: string, joint: boolean): Tree => ({ $: "Punct", _0: { ch: c.charCodeAt(0), joint, span: this.call_site } });
    const i = (s: string): Tree => ({ $: "Ident", _0: { sym: this.new_ident(s, false), kind: "Normal", span: sp } });
    const show = (name: string, ts: CTs): void => {
      this.push(`${name} ${debug_str(this.to_string(ts))} ${this.debug_ts(ts, PRETTY)}`);
    };
    const J = true;
    const A = false;
    show("glue +=", this.collect_trees([p("+", J), p("=", A), i("a")]));
    show("glue <<=>", this.collect_trees([p("<", J), p("<", J), p("=", J), p(">", A)]));
    show("glue ....", this.collect_trees([p(".", J), p(".", J), p(".", J), p(".", A)]));
    show("quote ident, ::, #!", this.collect_trees([p("'", J), i("a"), p(":", J), p(":", A), p("#", J), p("!", A)]));
    show(
      "idents",
      this.collect_trees([
        { $: "Ident", _0: { sym: this.new_ident("fn", true), kind: "Raw", span: sp } },
        i("cafe\u{301}"),
        i("\u{212b}ngstr\u{f6}m"),
        i("_x9"),
        i("$crate"),
      ]),
    );
    // `Literal::new(kind, &n.to_string(), suffix)` with `Span::call_site()`, then `set_span(sp)`.
    const lit = (kind: Literal<Span, Symbol>["kind"], symbol: string, suffix: string | undefined): Tree => ({
      $: "Literal",
      _0: { kind, symbol: Symbol.intern(symbol), suffix: suffix === undefined ? undefined : Symbol.intern(suffix), span: sp },
    });
    const Int = { $: "Integer" } as const;
    const Float = { $: "Float" } as const;
    show(
      "literals",
      this.collect_trees([
        lit(Int, "-5", "i32"),
        lit(Int, "-7", undefined),
        lit(Int, "7", "u8"),
        lit(Float, "-1.5", undefined),
        lit(Float, "-2", "f32"),
        lit(Float, "3.0", undefined),
        lit(Int, "0", undefined),
      ]),
    );
    const inner = this.collect_trees([i("x"), p("*", A), i("y")]);
    const group = (delimiter: Delimiter, stream: CTs): Tree => ({ $: "Group", _0: { delimiter, stream, span: DelimSpan.from_single(sp) } });
    show(
      "groups",
      this.collect_trees([
        group("None", this.clone(inner)),
        group("Parenthesis", this.clone(inner)),
        group("Bracket", undefined),
        group("Brace", inner),
      ]),
    );
    const a = this.collect_trees([i("a"), p("-", J)]);
    const b = this.collect_trees([p(">", A), i("b"), p("&", J)]);
    const c = this.collect_trees([p("&", A)]);
    show("concat_streams", this.collect_streams([this.clone(a), undefined, this.clone(b), this.clone(c)]));
    show("extend", this.extend_streams(a, [b, c]));
    show("concat one", this.collect_streams([this.s.ts_from_token_tree(p("?", A))]));
    this.flush();
  }

  expand(input: CTs): void {
    if (input === undefined) {
      this.push(`expand_expr ${debug_str(this.to_string(input))} -> Err(ExpandError)`);
    } else {
      const r = this.s.ts_expand_expr(input);
      if (r.$ === "Ok") {
        this.push(`expand_expr ${debug_str(this.to_string(input))} -> ${debug_str(this.to_string(r._0))} ${this.debug_ts(r._0, PRETTY)}`);
      } else {
        this.push(`expand_expr ${debug_str(this.to_string(input))} -> Err(ExpandError)`);
      }
    }
    this.flush();
  }

  diag(input: CTs): void {
    const toks = this.trees(input);
    const a = this.tree_span(toks[0]!);
    const b = this.tree_span(toks[toks.length - 1]!);
    const d = (level: Level, message: string, spans: Span[], children: Diagnostic<Span>[] = []): Diagnostic<Span> => ({
      level,
      message,
      spans,
      children,
    });
    this.s.emit_diagnostic(d("Warning", "a warning", [a], [d("Note", "a note on the last token", [b])]));
    this.s.emit_diagnostic(d("Note", "a note", [a], [d("Help", "some help", [])]));
    this.s.emit_diagnostic(d("Help", "top-level help", [a]));
    this.s.emit_diagnostic(
      d("Error", "an error with children", [b], [
        d("Error", "child error", [a]),
        d("Warning", "child warning on two spans", [a, b]),
        d("Note", "child note without span", []),
        d("Help", "child help", [b]),
      ]),
    );
    this.s.emit_diagnostic(d("Error", "multi-span error", [a, b]));
  }
}

/** `Literal::str_value` of the single string-literal argument (client side; here through `ast::LitKind`). */
function str_arg(tokens: TokenStream): string {
  const t = tokens.get(0);
  if (t === undefined || t.$ !== "Token" || t._0.kind.$ !== "Literal") return panic("expected a string literal");
  const r = ast.LitKind.from_token_lit(t._0.kind._0 as token.Lit);
  if (r.$ !== "Ok" || r._0.$ !== "Str") return panic("expected a string literal");
  return Symbol.as_str(r._0._0);
}

function run_case(name: string): { stderr: string; exit: number; panic: string | null } {
  const src = readFileSync(join(HERE, "cases", name, "t.rs"), "utf8");
  let stderr = "";
  let panic_: string | null = null;
  let exit = 0;
  const opts = Options_default();
  opts.edition = "Edition2021";
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
    const p = unwrap_or_emit_fatal(new_parser_from_source_str(sess.psess, fname, src, "Nothing"));
    const kr = p.parse_crate_mod();
    if (kr.$ === "Err") throw new Error("parse t.rs");
    const cx = ExtCtxt.new(sess, ExpansionConfig.default(Symbol.intern("t"), Features.default()), NoResolver, undefined);
    try {
      for (const item of kr._0.items) {
        if (item.kind.$ !== "MacCall") throw new Error("expected only macro calls");
        const mac = item.kind._0;
        const segs = mac.path.segments;
        const macro = Symbol.as_str(segs[segs.length - 1]!.ident.name);
        const path = segs.map((s) => Symbol.as_str(s.ident.name)).join("::");
        // `MacCall::span` and the `ExpnData` rustc_resolve sets for a proc macro (`SyntaxExtension::expn_data`).
        const span = Span.to(mac.path.span, mac.args.dspan.entire());
        // PORT(test): `macro_def_id` names some item of an external crate; only its `krate` is read
        // (`span_recover_proc_macro_span`, not exercised).
        const macro_def_id = new DefId(DefIndex.from_u32(1), CrateNum.from_u32(1));
        const expn_data = ExpnData.default({ $: "Macro", _0: MacroKind.Bang, _1: Symbol.intern(path) }, span, "Edition2024", macro_def_id, undefined);
        cx.current_expansion.id = LocalExpnId.fresh(expn_data, NoSpanHcx);
        const client = new Client(Rustc.new(cx), buf);
        const input: CTs = tokenstream.clone_TokenStream(mac.args.tokens);
        switch (macro) {
          case "probe":
            client.probe(input);
            break;
          case "spans":
            client.spans(input);
            break;
          case "lit":
            client.lit(str_arg(mac.args.tokens));
            break;
          case "stream":
            client.stream(str_arg(mac.args.tokens));
            break;
          case "construct":
            client.construct(input);
            break;
          case "expand":
            client.expand(input);
            break;
          case "diag":
            client.diag(input);
            break;
          default:
            throw new Error(`unknown probe macro ${macro}`);
        }
      }
      if (sess.dcx().has_errors() !== undefined) exit = 1;
      sess.dcx().print_error_count();
    } catch (e) {
      if (e instanceof Unported) throw e;
      if (!(e instanceof Panic)) throw e;
      panic_ = e.message;
      exit = 101;
    }
    sess.dcx().reset_err_count();
    stderr = new TextDecoder().decode(buf.bytes());
  });
  return { stderr, exit, panic: panic_ };
}

for (const name of Object.keys(expected).sort()) {
  test(`proc_macro_server oracle: ${name}`, () => {
    const pending = PENDING[name];
    if (pending !== undefined) {
      expect(() => run_case(name)).toThrow(pending);
      return;
    }
    const want = expected[name]!;
    const got = run_case(name);
    expect(got.panic).toBe(want.panic);
    expect(got.stderr).toBe(want.stderr);
    if (want.panic === null) expect(got.exit).toBe(want.exit);
  });
}
