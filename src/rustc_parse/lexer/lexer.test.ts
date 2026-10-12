// rust-ts scenario tests for compiler/rustc_parse/src/lexer/{mod,diagnostics,tokentrees}.rs (no
// `#[cfg(test)]` tests exist in those files at the pin; the string-reader tests in
// parser/tests.rs belong to the parser lane).
//
// Each case lexes a small input through `lex_token_trees(psess, src, start_pos, None,
// StripTokens::Shebang)`, i.e. what `rustc_parse::source_str_to_stream` does, and compares
//  - stdout: `OK {TokenStream:?}` / `ERR <n>` / `FATAL`, the number of buffered lints, the gated
//    spans per feature and the number of raw identifier spans, and
//  - stderr: every diagnostic, rendered by the real human emitter with `-Zui-testing` (emitted
//    during lexing, then the returned `Vec<Diag>`, then the stashed diagnostics)
// against the oracle in lexer_oracle.json. That file was produced by a rustc_private probe linked
// against the pinned nightly's rustc-dev (`rustc_parse::source_str_to_stream`, source in the
// fixture's `_probe` field; `_how` says how it was run).
//
// Cases listed in PENDING reach code that is still an `unported(...)` shim (lexer-aux:
// unicode_chars / unescape_error_reporting / unicode-normalization; pprust-state: `State`). They
// must either throw that `Unported` or, once the dependency lands, match the oracle exactly; root
// should then drop them from PENDING.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { tokenstream } from "../../rustc_ast/lib.ts";
import { AnnotateSnippetEmitter } from "../../rustc_errors/annotate_snippet_emitter_writer.ts";
import { DiagCtxt, DiagCtxtFlags_default, FatalError, FatalErrorMarker } from "../../rustc_errors/lib.ts";
import { ParseSess } from "../../rustc_session/parse.ts";
import type { Edition } from "../../rustc_span/edition.ts";
import { create_session_globals_then, type FileName } from "../../rustc_span/lib.ts";
import { FilePathMapping, RealFileLoader, get_source_map } from "../../rustc_span/source_map.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { debug_str, PLAIN } from "../../std/fmt.ts";
import { Unported } from "../../std/panic.ts";
import { Str } from "../../std/str.ts";
import { AutoStream, ColorChoice } from "../../vendor/anstream/lib.ts";
import { VecU8, dyn_write } from "../../vendor/anstream/stream.ts";
import { lexer } from "../lib.ts";

interface Case {
  edition: string;
  src: string;
  stdout: string;
  stderr: string;
}
const oracle = JSON.parse(readFileSync(new URL("./lexer_oracle.json", import.meta.url), "utf8")) as {
  cases: Record<string, Case>;
  cli: Record<string, { src: string; stderr: string }>;
};

/** Cases that hit a pending `unported(...)` dependency, with the shim each one reaches. */
const PENDING: Record<string, string> = {
  ws: "pending lexer-aux", // escaped_char / check_for_substitution
  unknown_tok: "pending lexer-aux",
  bad_escape: "pending lexer-aux", // emit_unescape_error
  non_ascii_ident: "pending lexer-aux", // unicode_normalization::is_nfc_quick
  invalid_ident: "pending lexer-aux", // UNICODE_ARRAY
  close_unexpected: "pending pprust-state", // pprust::token_to_string
  missing_open: "pending pprust-state",
  mismatched: "pending pprust-state", // pprust::token_kind_to_string
};

const EDITIONS: Record<string, Edition> = {
  "2015": "Edition2015",
  "2018": "Edition2018",
  "2021": "Edition2021",
  "2024": "Edition2024",
};

/** The probe's `main` body for one file, ported to the TS API. */
function run_case(c: Case): { stdout: string; stderr: string } {
  const inputs = {
    file_loader: new RealFileLoader(),
    path_mapping: FilePathMapping.empty(),
    hash_kind: "Md5" as const,
    checksum_hash_kind: undefined,
  };
  return create_session_globals_then(EDITIONS[c.edition]!, [], inputs, () => {
    const sm = get_source_map()!;
    const buf = new VecU8();
    let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
    em = AnnotateSnippetEmitter.sm(em, sm);
    em = AnnotateSnippetEmitter.ui_testing(em, true);
    const dcx = DiagCtxt.new(em).with_flags({ ...DiagCtxtFlags_default(), can_emit_warnings: true });
    const psess = ParseSess.with_dcx(dcx, sm);
    const fname: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), "t.rs") };
    let out = "=== t.rs\n";
    try {
      // source_str_to_stream -> source_file_to_stream(.., StripTokens::Shebang)
      const sf = sm.new_source_file(fname, Str.from(c.src));
      const res = lexer.lex_token_trees(psess, sf.src!, sf.start_pos, undefined, "Shebang");
      if (res.$ === "Ok") {
        out += `OK ${tokenstream.debug_TokenStream(res._0, PLAIN)}\n`;
      } else {
        out += `ERR ${res._0.length}\n`;
        for (const e of res._0) e.emit();
      }
    } catch (e) {
      if (!(e instanceof FatalErrorMarker)) throw e;
      out += "FATAL\n";
    }
    out += `lints ${psess.buffered_lints.length}\n`;
    const gated = [...psess.gated_spans.spans].map(([k, v]): [string, number] => [Symbol.as_str(k), v.length]).sort();
    out += `gated [${gated.map(([k, n]) => `(${debug_str(k)}, ${n})`).join(", ")}]\n`;
    out += `raw ${psess.raw_identifier_spans.length}\n`;
    psess.dcx().emit_stashed_diagnostics();
    psess.dcx().reset_err_count();
    return { stdout: out, stderr: new TextDecoder().decode(buf.bytes()) };
  });
}

for (const [name, c] of Object.entries(oracle.cases)) {
  test(`lex ${name} (edition ${c.edition})`, () => {
    const pending = PENDING[name];
    if (pending !== undefined) {
      let r: { stdout: string; stderr: string };
      try {
        r = run_case(c);
      } catch (e) {
        expect(e).toBeInstanceOf(Unported);
        expect((e as Unported).what).toContain(pending);
        return;
      }
      expect(r).toEqual({ stdout: c.stdout, stderr: c.stderr });
      return;
    }
    expect(run_case(c)).toEqual({ stdout: c.stdout, stderr: c.stderr });
  });
}

/**
 * The rustc driver path for the `cli` cases (`rustc -Zui-testing -Zparse-crate-root-only --edition
 * 2024 t.rs`): `new_parser_from_file(.., StripTokens::ShebangAndFrontmatter)` lexes the file;
 * `unwrap_or_emit_fatal` emits the returned diagnostics and raises `FatalError`; the driver then
 * emits stashed diagnostics and prints the error count. PORT: the inputs are chosen so that the
 * parser (not ported yet) adds no diagnostics of its own; that is visible in the oracle output.
 */
function run_cli(src: string): string {
  const inputs = {
    file_loader: new RealFileLoader(),
    path_mapping: FilePathMapping.empty(),
    hash_kind: "Md5" as const,
    checksum_hash_kind: undefined,
  };
  return create_session_globals_then("Edition2024", [], inputs, () => {
    const sm = get_source_map()!;
    const buf = new VecU8();
    let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
    em = AnnotateSnippetEmitter.sm(em, sm);
    em = AnnotateSnippetEmitter.ui_testing(em, true);
    const dcx = DiagCtxt.new(em).with_flags({ ...DiagCtxtFlags_default(), can_emit_warnings: true });
    const psess = ParseSess.with_dcx(dcx, sm);
    const fname: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), "t.rs") };
    try {
      const sf = sm.new_source_file(fname, Str.from(src));
      const res = lexer.lex_token_trees(psess, sf.src!, sf.start_pos, undefined, "ShebangAndFrontmatter");
      if (res.$ === "Err") {
        for (const e of res._0) e.emit();
        new FatalError().raise();
      }
    } catch (e) {
      if (!(e instanceof FatalErrorMarker)) throw e;
    }
    psess.dcx().emit_stashed_diagnostics();
    psess.dcx().print_error_count();
    return new TextDecoder().decode(buf.bytes());
  });
}

for (const [name, c] of Object.entries(oracle.cli)) {
  test(`rustc -Zparse-crate-root-only: ${name}`, () => {
    expect(run_cli(c.src)).toBe(c.stderr);
  });
}

test("every PENDING entry names an oracle case", () => {
  for (const name of Object.keys(PENDING)) expect(oracle.cases[name]).toBeDefined();
});
