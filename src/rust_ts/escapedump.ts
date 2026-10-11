// Subject side of the `escape` suite; output format must match tools/probes/escapes/main.rs.
//   bun src/rust_ts/escapedump.ts <file>...
import { readFileSync } from "node:fs";
import { FrontmatterAllowed, strip_shebang, tokenize } from "../rustc_lexer/lib.ts";
import { debug_bool, debug_char, debug_int, debug_str, PLAIN, type Debug } from "../std/fmt.ts";
import { debug_result, type Result } from "../std/result.ts";
import { Str } from "../std/str.ts";
import {
  check_for_errors,
  check_raw_byte_str,
  check_raw_c_str,
  check_raw_str,
  debug_EscapeError,
  debug_Mode,
  debug_MixedUnit,
  EscapeError_is_fatal,
  Mode,
  Mode_in_double_quotes,
  Mode_prefix_noraw,
  unescape_byte,
  unescape_byte_str,
  unescape_c_str,
  unescape_char,
  unescape_str,
  type EscapeError,
} from "../vendor/rustc_literal_escaper/lib.ts";

const decoder = new TextDecoder("utf-8", { fatal: true });
const dchar: Debug<number> = (c) => debug_char(c);

function res<T>(r: Result<T, EscapeError>, ok: Debug<T>): string {
  return debug_result(r, PLAIN, ok, debug_EscapeError);
}

function dump(start: number, mode: Mode, content: Str): string {
  let out = `L ${start} ${debug_Mode(mode, PLAIN)} ${debug_str(Mode_prefix_noraw(mode))} ${debug_bool(Mode_in_double_quotes(mode), PLAIN)}\nU`;
  const item =
    <T>(ok: Debug<T>) =>
    (lo: number, hi: number, r: Result<T, EscapeError>) => {
      out += ` ${lo}..${hi} ${res(r, ok)}`;
    };
  switch (mode) {
    case "Char":
      out += ` ${res(unescape_char(content), dchar)}`;
      break;
    case "Byte":
      out += ` ${res(unescape_byte(content), debug_int)}`;
      break;
    case "Str":
      unescape_str(content, item(dchar));
      break;
    case "ByteStr":
      unescape_byte_str(content, item(debug_int));
      break;
    case "CStr":
      unescape_c_str(content, item(debug_MixedUnit));
      break;
    case "RawStr":
      check_raw_str(content, item(dchar));
      break;
    case "RawByteStr":
      check_raw_byte_str(content, item(debug_int));
      break;
    case "RawCStr":
      check_raw_c_str(content, item(dchar));
      break;
  }
  out += "\n";
  check_for_errors(content, mode, (lo, hi, err) => {
    out += `E ${lo}..${hi} ${debug_EscapeError(err, PLAIN)} ${debug_bool(EscapeError_is_fatal(err), PLAIN)}\n`;
  });
  return out;
}

let out = "";
for (const path of process.argv.slice(2)) {
  const bytes = readFileSync(path);
  try {
    decoder.decode(bytes);
  } catch {
    out += `file: ${path}\nnot utf-8\n`;
    continue;
  }
  out += `file: ${path}\n`;
  const full = Str.of_bytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const src = full.slice(strip_shebang(full) ?? 0);
  let pos = 0;
  for (const tok of tokenize(src, FrontmatterAllowed.Yes)) {
    const start = pos;
    pos += tok.len;
    if (tok.kind.$ !== "Literal") continue;
    const kind = tok.kind.kind;
    // Same prefix/postfix lengths as rustc_parse::lexer::StringReader::cook_lexer_literal.
    let mode: Mode;
    let prefix_len: number;
    let postfix_len: number;
    if (kind.$ === "Char" && kind.terminated) [mode, prefix_len, postfix_len] = [Mode.Char, 1, 1];
    else if (kind.$ === "Byte" && kind.terminated) [mode, prefix_len, postfix_len] = [Mode.Byte, 2, 1];
    else if (kind.$ === "Str" && kind.terminated) [mode, prefix_len, postfix_len] = [Mode.Str, 1, 1];
    else if (kind.$ === "ByteStr" && kind.terminated) [mode, prefix_len, postfix_len] = [Mode.ByteStr, 2, 1];
    else if (kind.$ === "CStr" && kind.terminated) [mode, prefix_len, postfix_len] = [Mode.CStr, 2, 1];
    else if (kind.$ === "RawStr" && kind.n_hashes !== undefined) [mode, prefix_len, postfix_len] = [Mode.RawStr, 2 + kind.n_hashes, 1 + kind.n_hashes];
    else if (kind.$ === "RawByteStr" && kind.n_hashes !== undefined)
      [mode, prefix_len, postfix_len] = [Mode.RawByteStr, 3 + kind.n_hashes, 1 + kind.n_hashes];
    else if (kind.$ === "RawCStr" && kind.n_hashes !== undefined) [mode, prefix_len, postfix_len] = [Mode.RawCStr, 3 + kind.n_hashes, 1 + kind.n_hashes];
    else continue;
    const end = start + tok.kind.suffix_start;
    out += dump(start, mode, src.slice(start + prefix_len, end - postfix_len));
    if (out.length > 1 << 20) {
      process.stdout.write(out);
      out = "";
    }
  }
}
process.stdout.write(out);
