// Scenario tests for lexer/unescape_error_reporting.rs and lexer/unicode_chars.rs (plus
// unicode-normalization through `MoreThanOneChar` and `nfc_normalize`), through the real lexer
// and the human emitter into a byte buffer.
//
// Every expectation in unescape_oracle.json is the stderr of the pinned nightly:
//   rustc +nightly -Zui-testing -Zparse-crate-root-only --edition 2024 t.rs
// with `t.rs` = the case's `src` (see the fixture's `_how`). The inputs are chosen so that the
// parser (not ported yet) adds no diagnostics of its own: escape errors turn the literal into an
// error token without failing the lex, and the confusables used map to tokens that keep the item
// well-formed (or to none). The driver path mirrors `run_cli` in lexer.test.ts: lex with
// `StripTokens::ShebangAndFrontmatter`, emit, then stashed diagnostics and the error count.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AnnotateSnippetEmitter } from "../../rustc_errors/annotate_snippet_emitter_writer.ts";
import { DiagCtxt, DiagCtxtFlags_default, FatalError, FatalErrorMarker } from "../../rustc_errors/lib.ts";
import { ParseSess } from "../../rustc_session/parse.ts";
import { create_session_globals_then, type FileName } from "../../rustc_span/lib.ts";
import { FilePathMapping, RealFileLoader, get_source_map } from "../../rustc_span/source_map.ts";
import { Str } from "../../std/str.ts";
import { AutoStream, ColorChoice } from "../../vendor/anstream/lib.ts";
import { VecU8, dyn_write } from "../../vendor/anstream/stream.ts";
import { lexer } from "../lib.ts";
import { escaped_char } from "./unescape_error_reporting.ts";

const oracle = JSON.parse(readFileSync(new URL("./unescape_oracle.json", import.meta.url), "utf8")) as {
  cases: Record<string, { src: string; stderr: string }>;
};

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

for (const [name, c] of Object.entries(oracle.cases)) {
  test(`rustc -Zparse-crate-root-only: ${name}`, () => {
    expect(run_cli(c.src)).toBe(c.stderr);
  });
}

// rustc: `escaped_char` leaves printable ASCII (including `\`, `'`, `"`) alone and uses
// `char::escape_default` otherwise.
test("escaped_char", () => {
  expect(escaped_char(0x5c)).toBe("\\");
  expect(escaped_char(0x27)).toBe("'");
  expect(escaped_char(0x09)).toBe("\\t");
  expect(escaped_char(0x0d)).toBe("\\r");
  expect(escaped_char(0xe9)).toBe("\\u{e9}");
  expect(escaped_char(0x1f600)).toBe("\\u{1f600}");
});
