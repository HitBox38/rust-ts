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
// every emitted diagnostic with the `-Zui-testing` human emitter. Every case must match the oracle
// byte for byte (tree and stderr).
import { readFileSync } from "node:fs";

import { ast } from "../../../rustc_ast/lib.ts";
import type { Block, Pat, Stmt } from "../../../rustc_ast/lib.ts";
import { AnnotateSnippetEmitter } from "../../../rustc_errors/annotate_snippet_emitter_writer.ts";
import { DiagCtxt, FatalErrorMarker, type PResult } from "../../../rustc_errors/lib.ts";
import { ParseSess } from "../../../rustc_session/parse.ts";
import { type FileName, create_session_globals_then } from "../../../rustc_span/lib.ts";
import { FilePathMapping, RealFileLoader, get_source_map } from "../../../rustc_span/source_map.ts";
import { PRETTY } from "../../../std/fmt.ts";
import { Ok } from "../../../std/result.ts";
import { AutoStream, ColorChoice } from "../../../vendor/anstream/lib.ts";
import { VecU8, dyn_write } from "../../../vendor/anstream/stream.ts";
import { new_parser_from_source_str, unwrap_or_emit_fatal } from "../../lib.ts";
import { AttemptLocalParseRecovery } from "../diagnostics.ts";
import type { Parser } from "../mod.ts";
import { CommaRecoveryMode, Expected, PatternLocation, RecoverColon, RecoverComma } from "../pat.ts";

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

/** Parses the case with the TS parser. */
export function run_case(c: OracleCase): Got {
  const inputs = {
    file_loader: new RealFileLoader(),
    path_mapping: FilePathMapping.empty(),
    hash_kind: "Md5" as const,
    checksum_hash_kind: undefined,
  };
  let got: Got = { tree: undefined, stderr: "", fatal: false };
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
  return got;
}

