// Test harness shared by parser/pat.test.ts and parser/stmt.test.ts (lane parser-pat-stmt).
// Not a port: no `// rustc:` markers.
//
// Oracle: `pat_stmt_oracle.json` next to this file. Each case wraps a snippet into `t.rs`
// (`wrap` below, the same text the generator used), runs
//   rustc +nightly-2026-10-11 -Zunpretty=ast-tree -Zui-testing --edition 2024 t.rs
// and keeps (a) the subtree of the ast-tree dump for the node under test and (b) the stderr minus the
// driver trailer (`error: aborting due to ..`). The fixture's `_how` / `_gen` fields hold the exact
// extraction rule and the generator source.
//
// `run_case` parses the same `t.rs` with the TS parser, positioned exactly where rustc's parser calls
// the entry point under test (the leading tokens are bumped), and renders the node with `{:#?}` and
// every emitted diagnostic with the `-Zui-testing` human emitter.
//
// Two modes:
// - real: the parser as it is. A case either matches the oracle or throws exactly its PENDING
//   `Unported` (a path into another parser lane's unported code).
// - shimmed: a few other-lane methods are replaced by test-side copies of their upstream bodies,
//   restricted to the branches the cases take (any other branch throws `ShimMiss`). This checks the
//   pat.rs/stmt.rs logic against the oracle before those lanes land. The shims never run in real mode.
import { readFileSync } from "node:fs";

import { ast, token } from "../../../rustc_ast/lib.ts";
import type { AttrVec, Block, BlockCheckMode, Expr, ExprKind, Pat, Stmt } from "../../../rustc_ast/lib.ts";
import type { TokenKind } from "../../../rustc_ast/token.ts";
import { AnnotateSnippetEmitter } from "../../../rustc_errors/annotate_snippet_emitter_writer.ts";
import { DiagCtxt, FatalErrorMarker, type PResult } from "../../../rustc_errors/lib.ts";
import { ParseSess } from "../../../rustc_session/parse.ts";
import { type ErrorGuaranteed, type FileName, Span, create_session_globals_then } from "../../../rustc_span/lib.ts";
import { FilePathMapping, RealFileLoader, get_source_map } from "../../../rustc_span/source_map.ts";
import { kw } from "../../../rustc_span/symbol.ts";
import { PRETTY } from "../../../std/fmt.ts";
import { Ok } from "../../../std/result.ts";
import { AutoStream, ColorChoice } from "../../../vendor/anstream/lib.ts";
import { VecU8, dyn_write } from "../../../vendor/anstream/stream.ts";
import { new_parser_from_source_str, unwrap_or_emit_fatal } from "../../lib.ts";
import { AttemptLocalParseRecovery } from "../diagnostics.ts";
import { Parser } from "../mod.ts";
import { CommaRecoveryMode, Expected, PatternLocation, RecoverColon, RecoverComma } from "../pat.ts";
import { TokenType, exp } from "../token_type.ts";

const { TokenKind: TK } = token;

export type Kind = "let" | "for" | "closure" | "block" | "stmt";
export interface OracleCase {
  name: string;
  kind: Kind;
  src: string;
  tree: string | null;
  stderr: string;
  exit: number;
}

export const oracle = JSON.parse(readFileSync(new URL("./pat_stmt_oracle.json", import.meta.url), "utf8")) as {
  cases: OracleCase[];
};

/** Same as the generator's `wrap`. */
export function wrap(kind: Kind, src: string): string {
  switch (kind) {
    case "let":
      return `fn f() { let ${src}; }\n`;
    case "for":
      return `fn f() { for ${src} in x {} }\n`;
    case "closure":
      return `fn f() { |${src}| (); }\n`;
    case "block":
      return `fn f() {\n${src}\n}\n`;
    case "stmt":
      return `fn f() { ${src} }\n`;
  }
}

/** The tokens before the node under test: `fn f ( )` (+ `{`, + `let`/`for`/`|`). */
const BUMPS: Record<Kind, number> = { let: 6, for: 6, closure: 6, block: 4, stmt: 5 };

/** The entry point rustc's parser uses at that position (with upstream's arguments):
 *  let     -> stmt.rs:330  `parse_pat_before_ty(None, RecoverComma::Yes, PatternLocation::LetBinding)`
 *  for     -> expr.rs:2766 `parse_pat_allow_top_guard(None, Yes, Yes, CommaRecoveryMode::LikelyTuple)`
 *  closure -> expr.rs:2428 `parse_pat_no_top_alt(Some(Expected::ParameterName), None)`
 *  block   -> `parse_block()` on the fn body (`{ .. }` without inner attributes, so the same as
 *             function.rs:265's `parse_block_common(.., BlockCheckMode::Default, None)`)
 *  stmt    -> `parse_full_stmt(AttemptLocalParseRecovery::Yes)` on the first statement of the body. */
function entry(p: Parser, kind: Kind): string | undefined {
  let r: PResult<Pat | Block | Stmt>;
  let debug: (v: never) => string;
  switch (kind) {
    case "let": {
      const r0 = p.parse_pat_before_ty(undefined, RecoverComma.Yes, PatternLocation.LetBinding);
      r = r0.$ === "Ok" ? Ok(r0._0[0]) : r0;
      debug = (v: Pat) => ast.debug_Pat(v, PRETTY);
      break;
    }
    case "for":
      r = p.parse_pat_allow_top_guard(undefined, RecoverComma.Yes, RecoverColon.Yes, CommaRecoveryMode.LikelyTuple);
      debug = (v: Pat) => ast.debug_Pat(v, PRETTY);
      break;
    case "closure":
      r = p.parse_pat_no_top_alt(Expected.ParameterName, undefined);
      debug = (v: Pat) => ast.debug_Pat(v, PRETTY);
      break;
    case "block":
      r = p.parse_block();
      debug = (v: Block) => ast.debug_Block(v, PRETTY);
      break;
    case "stmt":
      r = p.parse_full_stmt(AttemptLocalParseRecovery.Yes);
      debug = (v: Stmt) => ast.debug_Stmt(v, PRETTY);
      break;
  }
  if (r.$ === "Err") {
    r._0.emit();
    return undefined;
  }
  return debug(r._0 as never);
}

export interface Got {
  tree: string | undefined;
  stderr: string;
  fatal: boolean;
}

/** Parses the case with the TS parser. Throws `Unported` (real mode) / `ShimMiss` (shimmed mode). */
export function run_case(c: OracleCase, shimmed: boolean): Got {
  const inputs = {
    file_loader: new RealFileLoader(),
    path_mapping: FilePathMapping.empty(),
    hash_kind: "Md5" as const,
    checksum_hash_kind: undefined,
  };
  let got: Got = { tree: undefined, stderr: "", fatal: false };
  const restore = shimmed ? install_shims() : () => {};
  try {
    create_session_globals_then("Edition2024", [], inputs, () => {
      const sm = get_source_map()!;
      const buf = new VecU8();
      let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
      em = AnnotateSnippetEmitter.sm(em, sm);
      em = AnnotateSnippetEmitter.ui_testing(em, true);
      const psess = ParseSess.with_dcx(DiagCtxt.new(em), sm);
      const fname: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), "t.rs") };
      let tree: string | undefined;
      let fatal = false;
      try {
        const p = unwrap_or_emit_fatal(new_parser_from_source_str(psess, fname, wrap(c.kind, c.src), "Nothing"));
        for (let i = 0; i < BUMPS[c.kind]; i++) p.bump();
        tree = entry(p, c.kind);
        // The driver emits what is still stashed after parsing (rustc_interface `parse`).
        psess.dcx().emit_stashed_diagnostics();
      } catch (e) {
        if (!(e instanceof FatalErrorMarker)) throw e;
        fatal = true;
      }
      psess.dcx().reset_err_count();
      got = { tree, stderr: new TextDecoder().decode(buf.bytes()), fatal };
    });
  } finally {
    restore();
  }
  return got;
}

// ---------------------------------------------------------------------------------------------
// Shims (test-side copies of other lanes' upstream fns; only the branches the cases exercise).

export class ShimMiss extends Error {
  constructor(readonly what: string) {
    super(`shim: branch not covered: ${what}`);
    this.name = "ShimMiss";
  }
}

type Proto = Record<string, unknown>;

function install_shims(): () => void {
  const proto = Parser.prototype as unknown as Proto;
  const saved = new Map<string, unknown>();
  const set = (name: string, f: unknown) => {
    saved.set(name, proto[name]);
    proto[name] = f;
  };
  const alpr = AttemptLocalParseRecovery as unknown as Proto;
  const saved_alpr = { yes: alpr.yes, no: alpr.no };

  // diagnostics.rs:129 AttemptLocalParseRecovery::yes / :136 no
  alpr.yes = (self: string) => self === "Yes";
  alpr.no = (self: string) => self === "No";

  // diagnostics.rs:178 dcx (whole fn)
  set("dcx", function (this: Parser) {
    return this.psess.dcx();
  });

  // diagnostics.rs:2729 maybe_recover_unexpected_comma (the `recover_unexpected_comma` branch is a miss)
  set("maybe_recover_unexpected_comma", function (this: Parser, _lo: Span, _rt: CommaRecoveryMode): PResult<undefined> {
    if (!this.token.eq(TK.Comma)) {
      return Ok(undefined);
    }
    throw new ShimMiss("maybe_recover_unexpected_comma: recover_unexpected_comma");
  });

  // diagnostics.rs:330 is_lit_bad_ident (a suffixed int/float literal is a miss)
  set("is_lit_bad_ident", function (this: Parser): undefined {
    const k = this.token.kind;
    if (k.$ === "Literal" && (k._0.kind.$ === "Integer" || k._0.kind.$ === "Float") && k._0.suffix !== undefined) {
      throw new ShimMiss("is_lit_bad_ident: suffixed literal");
    }
    return undefined;
  });

  // diagnostics.rs:1584 maybe_recover_from_bad_qpath (the `recover_from_bad_qpath` branch is a miss)
  set("maybe_recover_from_bad_qpath", function <T>(this: Parser, base: T): PResult<T> {
    // Do not add `::` to expected tokens.
    if (this.may_recover() && this.token.eq(TK.PathSep)) {
      throw new ShimMiss("maybe_recover_from_bad_qpath: recover_from_bad_qpath");
    }
    return Ok(base);
  });

  // diagnostics.rs:2688 maybe_recover_unexpected_block_label (the label branch is a miss)
  set("maybe_recover_unexpected_block_label", function (this: Parser, _loop_header: Span | undefined): boolean {
    // Check for `'a : {`
    // (`check_lifetime`, ty.rs:1635: `expected_token_types.insert(TokenType::Lifetime); token.is_lifetime()`)
    const check_lifetime = () => {
      this.expected_token_types.insert(TokenType.Lifetime);
      return this.token.is_lifetime();
    };
    if (!(check_lifetime() && this.look_ahead(1, (t) => t.eq(TK.Colon)) && this.look_ahead(2, (t) => t.eq(TK.OpenBrace)))) {
      return false;
    }
    throw new ShimMiss("maybe_recover_unexpected_block_label: label");
  });

  // diagnostics.rs:867 maybe_suggest_struct_literal (the struct-literal branch is a miss)
  set("maybe_suggest_struct_literal", function (this: Parser, _lo: Span, _s: BlockCheckMode): undefined {
    if (this.token.is_ident() && this.look_ahead(1, (t) => t.eq(TK.Colon))) {
      throw new ShimMiss("maybe_suggest_struct_literal: struct literal");
    }
    return undefined;
  });

  // diagnostics.rs:2821 is_vcs_conflict_marker (whole fn)
  set("is_vcs_conflict_marker", function (this: Parser, long_kind: TokenKind, short_kind: TokenKind): boolean {
    if (token.TokenKind_eq(long_kind, short_kind)) {
      // For conflict marker chars like `%` and `\`.
      for (let i = 0; i < 7; i++) if (!this.look_ahead(i, (tok) => tok.eq(long_kind))) return false;
      return true;
    } else {
      // For conflict marker chars like `<` and `|`.
      for (let i = 0; i < 3; i++) if (!this.look_ahead(i, (tok) => tok.eq(long_kind))) return false;
      return this.look_ahead(3, (tok) => tok.eq(short_kind) || tok.eq(long_kind));
    }
  });

  // diagnostics.rs:1691 expect_semi (only `self.eat(exp!(Semi))`; `recover_colon_as_semi` is a miss)
  set("expect_semi", function (this: Parser): PResult<undefined> {
    if (this.eat(exp.Semi)) {
      return Ok(undefined);
    }
    throw new ShimMiss("expect_semi: recover_colon_as_semi / expect");
  });

  // expr.rs:3460 is_builtin (whole fn)
  set("is_builtin", function (this: Parser): boolean {
    return this.token.is_keyword(kw.Builtin) && this.look_ahead(1, (t) => t.eq(TK.Pound));
  });

  // expr.rs:4006 mk_expr_with_attrs, :4015 mk_expr, :4019 mk_expr_err (whole fns)
  set("mk_expr_with_attrs", function (this: Parser, span: Span, kind: ExprKind, attrs: AttrVec): Expr {
    return new ast.Expr(ast.DUMMY_NODE_ID, kind, span, attrs, undefined);
  });
  set("mk_expr", function (this: Parser, span: Span, kind: ExprKind): Expr {
    return this.mk_expr_with_attrs(span, kind, []);
  });
  set("mk_expr_err", function (this: Parser, span: Span, guar: ErrorGuaranteed): Expr {
    return this.mk_expr(span, { $: "Err", _0: guar });
  });

  // expr.rs:2113 parse_literal_maybe_minus, with parse_token_lit (:1991) -> parse_opt_token_lit (:2083)
  // -> recover_after_dot (:2003) + eat_token_lit (:2040) inlined. Misses: a `.` before the literal
  // (`recover_after_dot`'s recovery), a reparsed metavar literal, and a missing literal
  // (`handle_missing_lit`).
  set("parse_literal_maybe_minus", function (this: Parser): PResult<Expr> {
    const e1 = this.eat_metavar_seq_with_matcher(
      (mv_kind) => mv_kind.$ === "Expr",
      (this_) => this_.parse_expr(),
    );
    if (e1 !== undefined) {
      return Ok(e1);
    }
    const e2 = this.eat_metavar_seq(token.MetaVarKind.Literal, (this_) => this_.parse_literal_maybe_minus());
    if (e2 !== undefined) {
      return Ok(e2);
    }

    const lo = this.token.span;
    const minus_present = this.eat(exp.Minus);
    // parse_token_lit -> parse_opt_token_lit
    if (this.token.eq(TK.Dot)) throw new ShimMiss("recover_after_dot");
    const span = this.token.span;
    // eat_token_lit
    let token_lit: token.Lit;
    const k = this.token.uninterpolate().kind;
    if (k.$ === "Ident" && (k._1 === "Normal" || k._1 === "ForcedKeyword") && k._0 === kw.True) {
      this.bump();
      token_lit = token.Lit.new({ $: "Bool" }, k._0, undefined);
    } else if (k.$ === "Ident" && (k._1 === "Normal" || k._1 === "ForcedKeyword") && k._0 === kw.False) {
      this.bump();
      token_lit = token.Lit.new({ $: "Bool" }, k._0, undefined);
    } else if (k.$ === "Literal") {
      this.bump();
      token_lit = k._0;
    } else {
      throw new ShimMiss("eat_token_lit: metavar literal / handle_missing_lit");
    }
    const expr = this.mk_expr(span, { $: "Lit", _0: token_lit });

    if (minus_present) {
      return Ok(this.mk_expr(Span.to(lo, this.prev_token.span), { $: "Unary", _0: "Neg", _1: expr }));
    } else {
      return Ok(expr);
    }
  });

  // ty.rs:784 parse_pin_and_mut (the `pin` branch is a miss)
  set("parse_pin_and_mut", function (this: Parser) {
    if (this.token.is_keyword(kw.Pin) && this.look_ahead(1, (t) => t.is_mutability())) {
      throw new ShimMiss("parse_pin_and_mut: pin");
    }
    return ["Not", this.parse_mutability()];
  });

  return () => {
    for (const [name, f] of saved) proto[name] = f;
    alpr.yes = saved_alpr.yes;
    alpr.no = saved_alpr.no;
  };
}
