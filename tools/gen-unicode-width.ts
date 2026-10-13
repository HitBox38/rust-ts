// Generates src/vendor/unicode_width/tables.gen.ts from the crate's own `src/tables.rs`
// (unicode-width =0.2.2, the version rustc_span depends on), so the port uses exactly the table
// data upstream links against: the width trie *including* upstream's code-3 markers (ligature,
// emoji, variation-selector chars resolved by `lookup_width`'s match) and the string-width tables.
//   bun tools/gen-unicode-width.ts            write the file
//   bun tools/gen-unicode-width.ts --check    exit 1 if the file is not up to date
//
// `tables.rs` is itself generated (the crate's scripts/unicode.py). Its hand-shaped code part
// (WidthInfo, lookup_width, width_in_str, ...) is ported by hand in tables.ts; this tool only
// translates the data items after `struct Align128<T>(T);` up to `#[cfg(test)]`, which have a fixed
// shape that is parsed strictly (anything unexpected is an error, so a version bump cannot silently
// mistranslate):
//   /// doc lines                                     -> kept
//   #[cfg(feature = "cjk")] / #[rustfmt::skip]        -> item kept (the port has `cjk` enabled)
//   #[cfg(not(feature = "cjk"))]                       -> next item dropped
//   `    #[cfg(feature = "cjk")]` on a sub-table        -> sub-table kept
//   const NAME: usize = N;                             -> export const NAME = N;
//   static NAME: AlignN<[u8; N]> = AlignN([..]);       -> Uint8Array
//   static NAME: AlignN<[[u8; N]; M]> = AlignN([..]);  -> Uint8Array[]
//   static NAME: [([u8; 3], [u8; 3]); N] = [..];       -> [[b0,b1,b2],[b0,b1,b2]][]
//   static NAME: [(u8, u8); N] = [..];                 -> [lo, hi][]
// Every array length is checked against its declared type. The result is validated against the
// oracle by src/vendor/unicode_width/oracle.test.ts (the `uwidth` probe).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, die, parseArgs } from "../scripts/lib/common.ts";
import { crateSrc } from "../scripts/crate-src.ts";

const CRATE = "unicode-width";
// upstream's Cargo.lock has two unicode-width versions; rustc_span uses 0.2.2.
const VERSION = "0.2.2";
const OUT = "src/vendor/unicode_width/tables.gen.ts";

const args = parseArgs(process.argv.slice(2));
const src = readFileSync(join(await crateSrc(CRATE, VERSION, { offline: args.offline === true }), "src", "tables.rs"), "utf8");
const lines = src.split("\n");
const id = `${CRATE}-${VERSION}`;

const hex2 = (n: number): string => "0x" + n.toString(16).toUpperCase().padStart(2, "0");

const ver = [...src.matchAll(/^pub const UNICODE_VERSION: \(u8, u8, u8\) = \((\d+), (\d+), (\d+)\);$/gm)];
if (ver.length !== 1) die(`tables.rs: expected exactly one UNICODE_VERSION, found ${ver.length}`);
const [, vMaj, vMin, vMic] = ver[0]!;
const verLine = src.slice(0, ver[0]!.index).split("\n").length;

const start = lines.findIndex((l) => l === "struct Align128<T>(T);");
const end = lines.findIndex((l) => l === "#[cfg(test)]");
if (start < 0 || end < 0 || end < start) die("tables.rs: could not find the data section (struct Align128 .. #[cfg(test)])");

const consts = new Map<string, number>();
let out = "";
let doc: string[] = [];
let drop = false;
let nItems = 0;

/** Rust array/tuple initializer -> nested JS arrays of numbers. */
function parseInit(text: string, at: number): unknown {
  const json = text
    .replace(/\s+/g, "")
    .replaceAll("(", "[")
    .replaceAll(")", "]")
    .replace(/0x([0-9A-F]+)/g, (_, h: string) => String(parseInt(h, 16)))
    .replace(/,\]/g, "]");
  if (!/^[\[\]0-9,]*$/.test(json)) die(`tables.rs:${at}: unexpected initializer syntax`);
  try {
    return JSON.parse(json);
  } catch {
    return die(`tables.rs:${at}: unparsable initializer`);
  }
}
function dim(s: string, at: number): number {
  if (/^\d+$/.test(s)) return Number(s);
  const v = consts.get(s);
  if (v === undefined) die(`tables.rs:${at}: unknown length ${s}`);
  return v;
}
function bytes(v: unknown, n: number, what: string, at: number): number[] {
  if (!Array.isArray(v) || v.length !== n || !v.every((b) => typeof b === "number" && Number.isInteger(b) && b >= 0 && b <= 255)) {
    die(`tables.rs:${at}: ${what} is not ${n} bytes`);
  }
  return v as number[];
}
function byteRows(b: number[], indent: string): string {
  const rows: string[] = [];
  for (let i = 0; i < b.length; i += 16) rows.push(indent + b.slice(i, i + 16).map(hex2).join(", ") + ",");
  return rows.join("\n");
}
function emitDoc(): string {
  const d = doc.length ? doc.join("\n") + "\n" : "";
  doc = [];
  return d;
}

for (let i = start + 1; i < end; i++) {
  const l = lines[i]!;
  const at = i + 1;
  if (l === "") {
    if (doc.length) die(`tables.rs:${at}: doc comment not followed by an item`);
    continue;
  }
  if (l.startsWith("///")) {
    doc.push(l);
    continue;
  }
  if (l === '#[cfg(feature = "cjk")]' || l === "#[rustfmt::skip]") continue;
  if (l === '#[cfg(not(feature = "cjk"))]') {
    drop = true;
    continue;
  }
  let m = /^const ([A-Z_]+): usize = (\d+);$/.exec(l);
  if (m) {
    if (drop) {
      drop = false;
      doc = [];
      continue;
    }
    consts.set(m[1]!, Number(m[2]));
    out += emitDoc() + `export const ${m[1]} = ${m[2]};\n`;
    nItems++;
    continue;
  }
  m = /^static ([A-Z0-9_]+): (.+) = (Align\d+\(\[|\[)$/.exec(l);
  if (!m) die(`tables.rs:${at}: unexpected line ${JSON.stringify(l.slice(0, 80))}`);
  if (drop) die(`tables.rs:${at}: #[cfg(not(feature = "cjk"))] on a static is not expected`);
  const [, name, ty, open] = m as unknown as [string, string, string, string];
  const aligned = open !== "[";
  const close = aligned ? "]);" : "];";
  let j = i + 1;
  while (j < end && lines[j] !== close) j++;
  if (j >= end) die(`tables.rs:${at}: ${name} has no closing ${close}`);
  // `#[cfg(feature = "cjk")]` on a sub-table: kept (cjk is on). A `not(..)` one would need dropping.
  const body = lines.slice(i + 1, j).filter((x) => x !== '    #[cfg(feature = "cjk")]');
  if (body.some((x) => x.includes("#["))) die(`tables.rs:${at}: unexpected attribute inside ${name}`);
  const init = parseInit("[" + body.join("\n") + "]", at);
  i = j;
  const d = emitDoc();
  let t: RegExpExecArray | null;
  if (aligned && (t = /^Align\d+<\[u8; (\w+)\]>$/.exec(ty))) {
    const b = bytes(init, dim(t[1]!, at), name, at);
    out += d + `export const ${name} = new Uint8Array([\n${byteRows(b, "  ")}\n]);\n`;
  } else if (aligned && (t = /^Align\d+<\[\[u8; (\w+)\]; (\w+)\]>$/.exec(ty))) {
    const inner = dim(t[1]!, at);
    const outer = dim(t[2]!, at);
    if (!Array.isArray(init) || init.length !== outer) die(`tables.rs:${at}: ${name} does not have ${outer} sub-tables`);
    const rows = (init as unknown[]).map((r, k) => `  new Uint8Array([\n${byteRows(bytes(r, inner, `${name}[${k}]`, at), "    ")}\n  ]),`);
    out += d + `export const ${name}: readonly Uint8Array[] = [\n${rows.join("\n")}\n];\n`;
  } else if (!aligned && (t = /^\[\(\[u8; 3\], \[u8; 3\]\); (\d+)\]$/.exec(ty))) {
    const n = dim(t[1]!, at);
    if (!Array.isArray(init) || init.length !== n) die(`tables.rs:${at}: ${name} does not have ${n} entries`);
    const rows = (init as unknown[]).map((p, k) => {
      if (!Array.isArray(p) || p.length !== 2) die(`tables.rs:${at}: ${name}[${k}] is not a pair`);
      const lo = bytes(p[0], 3, `${name}[${k}].0`, at);
      const hi = bytes(p[1], 3, `${name}[${k}].1`, at);
      return `  [[${lo.map(hex2).join(", ")}], [${hi.map(hex2).join(", ")}]],`;
    });
    out += d + `export const ${name}: readonly (readonly [readonly [number, number, number], readonly [number, number, number]])[] = [\n${rows.join("\n")}\n];\n`;
  } else if (!aligned && (t = /^\[\(u8, u8\); (\d+)\]$/.exec(ty))) {
    const n = dim(t[1]!, at);
    if (!Array.isArray(init) || init.length !== n) die(`tables.rs:${at}: ${name} does not have ${n} entries`);
    const rows = (init as unknown[]).map((p, k) => `  [${bytes(p, 2, `${name}[${k}]`, at).map(hex2).join(", ")}],`);
    out += d + `export const ${name}: readonly (readonly [number, number])[] = [\n${rows.join("\n")}\n];\n`;
  } else {
    die(`tables.rs:${at}: unexpected type of ${name}: ${ty}`);
  }
  out += "\n";
  nItems++;
}
if (doc.length || drop) die("tables.rs: dangling doc comment or cfg at the end of the data section");

const text =
  `// GENERATED by tools/gen-unicode-width.ts from ${id}/src/tables.rs. Do not edit.\n` +
  `// Upstream's tables.rs is itself generated by the crate's scripts/unicode.py. Every data item\n` +
  `// (with the \`cjk\` feature on) is kept, in order, with its doc comment. The code part of\n` +
  `// tables.rs is ported by hand in tables.ts.\n` +
  `// PORT: the \`AlignN(..)\` wrappers only set alignment and are dropped (\`TABLE.0[i]\` -> \`TABLE[i]\`);\n` +
  `// \`[u8; N]\` -> Uint8Array, \`[[u8; N]; M]\` -> Uint8Array[], tuples -> arrays.\n\n` +
  `// const from ${id}/src/tables.rs:${verLine} UNICODE_VERSION (not a fn; no crate: marker)\n` +
  `/// The version of [Unicode](http://www.unicode.org/)\n` +
  `/// that this version of unicode-width is based on.\n` +
  `export const UNICODE_VERSION: readonly [number, number, number] = [${vMaj}, ${vMin}, ${vMic}];\n\n` +
  out.trimEnd() +
  "\n";

if (args.check) {
  let cur = "";
  try {
    cur = readFileSync(join(REPO, OUT), "utf8");
  } catch {}
  if (cur !== text) die(`${OUT} is out of date; run: bun tools/gen-unicode-width.ts`);
  console.log(`${OUT} up to date (${nItems} items from ${id})`);
} else {
  writeFileSync(join(REPO, OUT), text);
  console.log(`wrote ${OUT} (${nItems} items from ${id})`);
}
