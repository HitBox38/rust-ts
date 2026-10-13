// Subject side of the `tokens` suite: lexes each file into token trees with the ported
// rustc_parse lexer and prints what tools/probes/tokdump/main.rs prints (its header documents the
// setup and the output format; this file mirrors it step by step).
//   bun src/rust_ts/tokdump.ts [--edition=<e>] [--strip=<crate|str>] <file> [--edition=<e>] <file> ...
// `--strip=crate` (default): `new_parser_from_source_str(.., ShebangAndFrontmatter)` +
// `parse_tokens()` in the probe; here `lex_token_trees(.., "ShebangAndFrontmatter")` (the parser is
// not ported; `parse_tokens` rebuilds the stream `source_file_to_stream` returned).
// `--strip=str`: `source_str_to_stream`, i.e. `lex_token_trees(.., "Shebang")`.
// Exit codes as src/rust_ts/main.ts: 70 = reached unported code, 101 = ICE.
import { readFileSync } from "node:fs";
import { tokenstream } from "../rustc_ast/lib.ts";
import { debug_NodeId } from "../rustc_ast/node_id.gen.ts";
import { AnnotateSnippetEmitter } from "../rustc_errors/annotate_snippet_emitter_writer.ts";
import { OutputTheme } from "../rustc_errors/emitter.ts";
import { DiagCtxt, type DiagCtxtFlags, FatalErrorMarker } from "../rustc_errors/lib.ts";
import { lexer } from "../rustc_parse/lib.ts";
import { ParseSess } from "../rustc_session/parse.ts";
import { type Edition, Edition as EditionC, debug_Edition } from "../rustc_span/edition.ts";
import { type FileName, type Span, create_session_globals_then, debug_Span } from "../rustc_span/lib.ts";
import { FilePathMapping, RealFileLoader, get_source_map } from "../rustc_span/source_map.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { PLAIN, debug_list } from "../std/fmt.ts";
import { Panic, Unported } from "../std/panic.ts";
import { Str } from "../std/str.ts";
import { AutoStream, ColorChoice } from "../vendor/anstream/lib.ts";
import { VecU8, dyn_write } from "../vendor/anstream/stream.ts";

const encoder = new TextEncoder();
// Validation only (`String::from_utf8`); the source is passed on as the file's own bytes, BOM included.
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const debug_spans = (spans: readonly Span[]): string => debug_list(PLAIN, spans.map((s) => debug_Span(s, PLAIN)));

/** The probe's `lex_file`: everything it prints for one UTF-8 file after the `edition:` line. */
function lex_file(out: Uint8Array[], path: string, edition: Edition, strip: lexer.StripTokens, src: Str): void {
  const print = (s: string) => out.push(encoder.encode(s));
  const inputs = {
    file_loader: new RealFileLoader(),
    path_mapping: FilePathMapping.empty(),
    hash_kind: "Md5" as const,
    checksum_hash_kind: undefined,
  };
  const buf = new VecU8();
  create_session_globals_then(edition, [], inputs, () => {
    const sm = get_source_map()!;
    let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
    em = AnnotateSnippetEmitter.sm(em, sm);
    em = AnnotateSnippetEmitter.short_message(em, false);
    em = AnnotateSnippetEmitter.diagnostic_width(em, undefined);
    em = AnnotateSnippetEmitter.macro_backtrace(em, false);
    em = AnnotateSnippetEmitter.track_diagnostics(em, false);
    em = AnnotateSnippetEmitter.terminal_url(em, "No");
    em = AnnotateSnippetEmitter.theme(em, OutputTheme.Ascii);
    em = AnnotateSnippetEmitter.ignored_directories_in_source_blocks(em, []);
    em = AnnotateSnippetEmitter.ui_testing(em, true);
    const flags: DiagCtxtFlags = {
      can_emit_warnings: true,
      treat_err_as_bug: undefined,
      eagerly_emit_delayed_bugs: false,
      macro_backtrace: false,
      deduplicate_diagnostics: true,
      track_diagnostics: false,
    };
    const dcx = DiagCtxt.new(em).with_flags(flags);
    const psess = ParseSess.with_dcx(dcx, sm);
    const fname: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), path) };
    try {
      // new_source_file, then source_file_to_stream(.., strip) (`new_parser_from_source_str` /
      // `source_str_to_stream`).
      const sf = sm.new_source_file(fname, src);
      const res = lexer.lex_token_trees(psess, sf.src!, sf.start_pos, undefined, strip);
      if (res.$ === "Ok") {
        print(`OK ${tokenstream.debug_TokenStream(res._0, PLAIN)}\n`);
      } else {
        print(`ERR ${res._0.length}\n`);
        for (const e of res._0) e.emit();
      }
    } catch (e) {
      if (!(e instanceof FatalErrorMarker)) throw e;
      print("FATAL\n");
    }
    for (const lint of psess.buffered_lints) {
      const spans = lint.span === undefined ? [] : lint.span.primary_spans_();
      print(`lint ${lint.lint_id.lint.name} ${debug_NodeId(lint.node_id, PLAIN)} ${debug_spans(spans)}\n`);
    }
    const gated = [...psess.gated_spans.spans].map(([k, v]): [string, Span[]] => [Symbol.as_str(k), v]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [feature, spans] of gated) print(`gated ${feature} ${debug_spans(spans)}\n`);
    print(`raw ${debug_spans(psess.raw_identifier_spans)}\n`);
    psess.dcx().emit_stashed_diagnostics();
    // `drop(psess)`: `impl Drop for DiagCtxtInner` (emits stashed diagnostics, flushes delayed bugs).
    psess.dcx_.inner.drop();
  });
  const bytes = buf.bytes().slice();
  print(`diagnostics: ${bytes.length} bytes\n`);
  out.push(bytes);
  if (bytes.length !== 0 && bytes[bytes.length - 1] !== 0x0a) print("\n= no newline at end of output\n");
}

function main(): void {
  const out: Uint8Array[] = [];
  let size = 0;
  const flush = () => {
    process.stdout.write(Buffer.concat(out));
    out.length = 0;
    size = 0;
  };
  try {
    let edition: Edition = "Edition2015";
    let strip: lexer.StripTokens = "ShebangAndFrontmatter";
    for (const arg of process.argv.slice(2)) {
      if (arg.startsWith("--strip=")) {
        const s = arg.slice("--strip=".length);
        if (s === "crate") strip = "ShebangAndFrontmatter";
        else if (s === "str") strip = "Shebang";
        else throw new Panic(`tokdump: bad --strip ${JSON.stringify(s)}`);
        continue;
      }
      if (arg.startsWith("--edition=")) {
        const e = arg.slice("--edition=".length);
        const r = EditionC.from_str(e);
        if (r.$ === "Err") throw new Panic(`tokdump: bad edition ${JSON.stringify(e)}`);
        edition = r._0;
        continue;
      }
      out.push(encoder.encode(`file: ${arg}\nedition: ${debug_Edition(edition, PLAIN)}\n`));
      const bytes = readFileSync(arg);
      try {
        decoder.decode(bytes);
      } catch {
        out.push(encoder.encode("not utf-8\n"));
        continue;
      }
      const before = out.length;
      lex_file(out, arg, edition, strip, Str.of_bytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)));
      for (let i = before; i < out.length; i++) size += out[i]!.length;
      if (size > 1 << 24) flush();
    }
    flush();
  } catch (e) {
    flush();
    if (e instanceof Unported) {
      process.stderr.write(`rust-ts: unported: ${e.what}\n`);
      process.exitCode = 70;
    } else {
      const msg = e instanceof Panic ? e.message : String(e);
      process.stderr.write(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
      process.exitCode = 101;
    }
  }
}

main();
