// Subject side of the `lex` suite; output format must match tools/probes/lexdump/main.rs.
//   bun src/rust_ts/lexdump.ts <file>...
import { readFileSync } from "node:fs";
import { debug_Token, FrontmatterAllowed, strip_shebang, tokenize } from "../rustc_lexer/lib.ts";
import { PLAIN, debug_option, debug_int } from "../std/fmt.ts";
import { Str } from "../std/str.ts";

const decoder = new TextDecoder("utf-8", { fatal: true });

let out = "";
for (const path of process.argv.slice(2)) {
  const bytes = readFileSync(path);
  try {
    decoder.decode(bytes);
  } catch {
    out += `file: ${path}\nnot utf-8\n`;
    continue;
  }
  const src = Str.of_bytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const shebang = strip_shebang(src);
  out += `file: ${path}\nshebang: ${debug_option(shebang, PLAIN, debug_int)}\n`;
  for (const tok of tokenize(src.slice(shebang ?? 0), FrontmatterAllowed.Yes)) out += debug_Token(tok, PLAIN) + "\n";
  if (out.length > 1 << 20) {
    process.stdout.write(out);
    out = "";
  }
}
process.stdout.write(out);
