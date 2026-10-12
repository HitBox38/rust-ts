// Generates src/vendor/unicode_normalization/tables.ts from the crate's own `src/tables.rs`
// (unicode-normalization at the version locked in upstream's Cargo.lock), so the port uses exactly
// the data and Unicode version rustc_parse links against.
//   bun tools/gen-unicode-normalization.ts            write the file
//   bun tools/gen-unicode-normalization.ts --check    exit 1 if the file is not up to date
//
// `tables.rs` is itself generated (scripts/unicode.py) and has a fixed shape, which this parses
// strictly (anything unexpected is an error, so a version bump cannot silently mistranslate):
//   pub const UNICODE_VERSION: (u8, u8, u8) = (..);
//   pub(crate) const NAME: &[u16] | &[u32] | &[char] | &[(u32, char)] | &[(u32, (u16, u16))] = &[..];
//   [pub(crate)|pub] fn name(c: char) -> T { match c { <arms> } }        (one-arg lookups)
//   pub(crate) fn composition_table_astral(c1: char, c2: char) -> Option<char> { match (c1, c2) { .. } }
// Arms are translated 1:1, in order, into `if (<pattern>) return <value>;`, the `_` arm into the
// final `return`. Each fn gets its `// crate:` marker at the line of the upstream `fn`.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, die, parseArgs } from "../scripts/lib/common.ts";
import { crateSrc, lockedVersion } from "../scripts/crate-src.ts";

const CRATE = "unicode-normalization";
const OUT = "src/vendor/unicode_normalization/tables.ts";

const args = parseArgs(process.argv.slice(2));
const version = lockedVersion(CRATE);
const src = readFileSync(join(await crateSrc(CRATE, version), "src", "tables.rs"), "utf8");
const lines = src.split("\n");
const id = `${CRATE}-${version}`;

/** `'\u{XXXX}'` -> code point. */
function charLit(s: string): number {
  const m = /^'\\u\{([0-9A-Fa-f]+)\}'$/.exec(s.trim());
  if (!m) die(`unexpected char literal ${JSON.stringify(s)}`);
  return parseInt(m[1]!, 16);
}
function hex(n: number): string {
  return "0x" + n.toString(16).toUpperCase();
}
/** Rust integer literal (`0x..` or decimal). */
function intLit(s: string): number {
  const t = s.trim();
  if (/^0x[0-9A-Fa-f]+$/.test(t)) return parseInt(t.slice(2), 16);
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  return die(`unexpected integer literal ${JSON.stringify(s)}`);
}

/** Wraps `items` (already rendered) at ~100 columns with `indent`. */
function wrap(items: string[], indent: string): string {
  const out: string[] = [];
  let cur = "";
  for (const it of items) {
    if (cur.length + it.length + 2 > 100 - indent.length && cur) {
      out.push(indent + cur.trimEnd());
      cur = "";
    }
    cur += it + ", ";
  }
  if (cur) out.push(indent + cur.trimEnd());
  return out.join("\n");
}

/** Pattern of one match arm (on one char): `'\u{A}'` or `'\u{A}'..='\u{B}'`. */
function charPat(p: string, v: string): string {
  const r = p.split("..=");
  if (r.length === 1) return `${v} === ${hex(charLit(r[0]!))}`;
  if (r.length === 2) return `(${v} >= ${hex(charLit(r[0]!))} && ${v} <= ${hex(charLit(r[1]!))})`;
  return die(`unexpected pattern ${p}`);
}

/** Value expression of an arm. */
function value(e: string, ret: string): string {
  const t = e.trim();
  if (ret === "IsNormalized") {
    if (t === "Yes" || t === "No" || t === "Maybe") return `"${t}"`;
  } else if (ret === "bool") {
    if (t === "true" || t === "false") return t;
  } else if (ret === "usize" || ret === "u8") {
    return String(intLit(t));
  } else if (ret === "Option<char>") {
    if (t === "None") return "undefined";
    const m = /^Some\((.*)\)$/.exec(t);
    if (m) return hex(charLit(m[1]!));
  }
  return die(`unexpected arm value ${JSON.stringify(t)} for ${ret}`);
}
const TS_RET: Record<string, string> = { IsNormalized: "IsNormalized", bool: "boolean", usize: "number", u8: "number", "Option<char>": "number | undefined" };

let out = "";
let i = 0;
let nItems = 0;
const header = (l: string) => /^(#|\/\/|$)/.test(l);
while (i < lines.length) {
  const l = lines[i]!;
  if (header(l) || /^use crate::quick_check::IsNormalized/.test(l)) {
    i++;
    continue;
  }
  let m: RegExpExecArray | null;
  if ((m = /^pub const UNICODE_VERSION: \(u8, u8, u8\) = \((\d+), (\d+), (\d+)\);$/.exec(l))) {
    out += `// const from ${id}/src/tables.rs:${i + 1} UNICODE_VERSION (not a fn; no crate: marker)\nexport const UNICODE_VERSION: readonly [number, number, number] = [${m[1]}, ${m[2]}, ${m[3]}];\n\n`;
    i++;
    nItems++;
    continue;
  }
  if ((m = /^pub\(crate\) const ([A-Z_]+): &\[(u16|u32|char|\(u32, char\)|\(u32, \(u16, u16\)\))\] = &\[$/.exec(l))) {
    const [, name, ty] = m;
    const body: string[] = [];
    i++;
    while (lines[i] !== "];") {
      if (i >= lines.length) die(`unterminated ${name}`);
      body.push(lines[i]!.trim());
      i++;
    }
    i++;
    const text = body.join(" ");
    const decl = `// const from ${id}/src/tables.rs:${i - body.length - 1} ${name}\n`;
    if (ty === "u16" || ty === "u32") {
      const items = text.split(",").map((s) => s.trim()).filter((s) => s !== "").map((s) => hex(intLit(s)));
      out += `${decl}export const ${name} = new Uint${ty.slice(1)}Array([\n${wrap(items, "  ")}\n]);\n\n`;
    } else if (ty === "char") {
      const items = text.split(",").map((s) => s.trim()).filter((s) => s !== "").map((s) => hex(charLit(s)));
      out += `${decl}export const ${name} = new Uint32Array([\n${wrap(items, "  ")}\n]);\n\n`;
    } else if (ty === "(u32, char)") {
      const items = [...text.matchAll(/\((0x[0-9A-Fa-f]+), ('\\u\{[0-9A-Fa-f]+\}')\),?/g)].map((p) => `[${hex(intLit(p[1]!))}, ${hex(charLit(p[2]!))}]`);
      if (items.length !== body.length) die(`${name}: parsed ${items.length} of ${body.length} entries`);
      out += `${decl}export const ${name}: readonly (readonly [number, number])[] = [\n${wrap(items, "  ")}\n];\n\n`;
    } else {
      const items = [...text.matchAll(/\((0x[0-9A-Fa-f]+), \((0x[0-9A-Fa-f]+), (0x[0-9A-Fa-f]+)\)\),?/g)].map(
        (p) => `[${hex(intLit(p[1]!))}, [${hex(intLit(p[2]!))}, ${hex(intLit(p[3]!))}]]`,
      );
      if (items.length !== body.length) die(`${name}: parsed ${items.length} of ${body.length} entries`);
      out += `${decl}export const ${name}: readonly (readonly [number, readonly [number, number]])[] = [\n${wrap(items, "  ")}\n];\n\n`;
    }
    nItems++;
    continue;
  }
  if ((m = /^pub(?:\(crate\))? fn ([a-z_]+)\(c: char\) -> (IsNormalized|bool|usize)\s*\{$/.exec(l))) {
    const [, name, ret] = m;
    const fnLine = i + 1;
    if (lines[i + 1] !== "    match c {") die(`${name}: expected \`match c {\``);
    i += 2;
    const conds: string[] = [];
    let cur = "";
    let fallback: string | undefined;
    const body: string[] = [];
    while (lines[i] !== "    }") {
      if (i >= lines.length) die(`unterminated fn ${name}`);
      const t = lines[i]!.trim();
      i++;
      const arm = /^(?:\| )?(.*?)(?: => (.*),)?$/.exec(t)!;
      const pat = arm[1]!;
      if (pat === "_") {
        fallback = value(arm[2]!, ret!);
        continue;
      }
      conds.push(charPat(pat, "c"));
      if (arm[2] !== undefined) {
        cur = conds.length === 1 ? conds[0]!.replace(/^\((.*)\)$/, "$1") : "\n" + conds.map((c) => `    ${c}`).join(" ||\n") + "\n  ";
        body.push(`  if (${cur}) return ${value(arm[2], ret!)};`);
        conds.length = 0;
      }
    }
    if (conds.length || fallback === undefined) die(`${name}: dangling alternatives or no \`_\` arm`);
    if (lines[i + 1] !== "}") die(`${name}: expected end of fn`);
    i += 2;
    out += `// crate: ${id}/src/tables.rs:${fnLine} ${name}\nexport function ${name}(c: number): ${TS_RET[ret!]} {\n${body.join("\n")}\n  return ${fallback};\n}\n\n`;
    nItems++;
    continue;
  }
  if (/^pub\(crate\) fn composition_table_astral\(c1: char, c2: char\) -> Option<char> \{$/.test(l)) {
    const fnLine = i + 1;
    if (lines[i + 1] !== "    match (c1, c2) {") die("composition_table_astral: expected `match (c1, c2) {`");
    i += 2;
    const body: string[] = [];
    let fallback: string | undefined;
    while (lines[i] !== "    }") {
      if (i >= lines.length) die("unterminated fn composition_table_astral");
      const t = lines[i]!.trim();
      i++;
      if ((m = /^_ => (.*),$/.exec(t))) {
        fallback = value(m[1]!, "Option<char>");
        continue;
      }
      const a = /^\(('\\u\{[0-9A-F]+\}'), ('\\u\{[0-9A-F]+\}')\) => (.*),$/.exec(t);
      if (!a) die(`composition_table_astral: unexpected arm ${t}`);
      body.push(`  if (c1 === ${hex(charLit(a[1]!))} && c2 === ${hex(charLit(a[2]!))}) return ${value(a[3]!, "Option<char>")};`);
    }
    if (fallback === undefined || lines[i + 1] !== "}") die("composition_table_astral: bad end");
    i += 2;
    out += `// crate: ${id}/src/tables.rs:${fnLine} composition_table_astral\nexport function composition_table_astral(c1: number, c2: number): number | undefined {\n${body.join("\n")}\n  return ${fallback};\n}\n\n`;
    nItems++;
    continue;
  }
  die(`tables.rs:${i + 1}: unexpected line ${JSON.stringify(l.slice(0, 80))}`);
}

const text =
  `// GENERATED by tools/gen-unicode-normalization.ts from ${id}/src/tables.rs. Do not edit.\n` +
  `// Upstream's tables.rs is itself generated by the crate's scripts/unicode.py. Every item is kept,\n` +
  `// in order: \`&[u16]\`/\`&[u32]\` -> typed arrays, \`&[char]\` -> Uint32Array of code points, tuple slices\n` +
  `// -> arrays of tuples; \`match\` lookups -> one \`if\` per arm, in arm order.\n` +
  `import type { IsNormalized } from "./quick_check.ts";\n\n` +
  out.trimEnd() +
  "\n";

if (args.check) {
  let cur = "";
  try {
    cur = readFileSync(join(REPO, OUT), "utf8");
  } catch {}
  if (cur !== text) die(`${OUT} is out of date; run: bun tools/gen-unicode-normalization.ts`);
  console.log(`${OUT} up to date (${nItems} items from ${id})`);
} else {
  writeFileSync(join(REPO, OUT), text);
  console.log(`wrote ${OUT} (${nItems} items from ${id})`);
}
