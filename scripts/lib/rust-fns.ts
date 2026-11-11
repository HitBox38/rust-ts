// Every `fn` of a Rust source file, found with our own rustc_lexer port, so `fn` inside comments and strings is never counted
// (scripts/coverage.ts `upstreamFns`, which defaults the root to the pinned checkout). No import of common.ts, so the runner
// unit tests can use it without fixing RUST_TS_DATA (scripts/lib/upstream-root.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FrontmatterAllowed, strip_shebang, tokenize } from "../../src/rustc_lexer/lib.ts";
import { Str } from "../../src/std/str.ts";

export interface UpstreamFn {
  path: string;
  line: number;
  name: string;
}

/** Every `fn <name>` in `<root>/<relPath>`; `path` of each result is `relPath`. */
export function rustFns(relPath: string, root: string): UpstreamFn[] {
  const bytes = readFileSync(join(root, relPath));
  const src = Str.of_bytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const fns: UpstreamFn[] = [];
  let pos = strip_shebang(src) ?? 0;
  let line = 1;
  for (let i = 0; i < pos; i++) if (src.byte(i) === 0x0a) line++;
  const sig: { kind: string; text: string; line: number }[] = [];
  for (const tok of tokenize(src.slice(pos), FrontmatterAllowed.Yes)) {
    const k = tok.kind.$;
    if (k !== "Whitespace" && k !== "LineComment" && k !== "BlockComment") {
      const text = k === "Ident" || k === "RawIdent" ? src.slice(pos, pos + tok.len).toString() : "";
      sig.push({ kind: k, text, line });
      const n = sig.length;
      if (n >= 2 && sig[n - 2]!.kind === "Ident" && sig[n - 2]!.text === "fn" && (k === "Ident" || k === "RawIdent")) {
        fns.push({ path: relPath, line: sig[n - 2]!.line, name: text });
      }
      if (n > 4) sig.shift();
    }
    for (let i = pos; i < pos + tok.len; i++) if (src.byte(i) === 0x0a) line++;
    pos += tok.len;
  }
  return fns;
}
