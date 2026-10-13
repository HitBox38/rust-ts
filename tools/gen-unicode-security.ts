// Generates src/vendor/unicode_script/tables.ts and src/vendor/unicode_security/tables.ts from the crates' own
// `src/tables.rs` (unicode-script / unicode-security at the versions locked in upstream's Cargo.lock), the way
// tools/gen-unicode-normalization.ts does for unicode-normalization (written by lane lint-early-b).
//   bun tools/gen-unicode-security.ts            write the files
//   bun tools/gen-unicode-security.ts --check    exit 1 if a file is not up to date
// Both tables.rs are generated (scripts/unicode.py) with a fixed shape, parsed strictly (anything unexpected dies).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, UPSTREAM } from "../scripts/lib/common.ts";

const CHECK = process.argv.includes("--check");
const REG = `${process.env.HOME}/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f`;
function die(msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}
function locked(name: string): string {
  const lock = readFileSync(join(UPSTREAM, "Cargo.lock"), "utf8");
  const m = new RegExp(`name = "${name}"\\nversion = "([^"]+)"`).exec(lock);
  if (!m) die(`${name} not in Cargo.lock`);
  return m[1]!;
}
const charLit = (s: string): number => {
  const m = /^'\\u\{([0-9a-f]+)\}'$/.exec(s.trim());
  if (!m) die(`bad char literal ${s}`);
  return parseInt(m[1]!, 16);
};
const hex = (n: number): string => `0x${n.toString(16)}`;
function rows(nums: number[], width: number): string {
  const out: string[] = [];
  for (let i = 0; i < nums.length; i += width) out.push("  " + nums.slice(i, i + width).map(hex).join(", ") + ",");
  return out.join("\n");
}
function lineOf(lines: string[], re: RegExp): number {
  const i = lines.findIndex((l) => re.test(l));
  if (i < 0) die(`no line matches ${re}`);
  return i + 1;
}
/** The text of the `const NAME: ... = &[ ... ];` table starting at the line matching `re`. */
function tableText(lines: string[], re: RegExp): string {
  const start = lineOf(lines, re);
  let text = "";
  for (let i = start; i < lines.length; i++) {
    text += lines[i] + "\n";
    if (/^\s*\];\s*$/.test(lines[i]!)) return text.slice(text.indexOf("&[") + 2, text.lastIndexOf("]"));
  }
  die(`unterminated table at ${start}`);
}
function emit(path: string, out: string): void {
  const full = join(REPO, path);
  if (CHECK) {
    let cur = "";
    try {
      cur = readFileSync(full, "utf8");
    } catch {}
    if (cur !== out) die(`${path} is not up to date`);
    console.log(`${path}: up to date`);
  } else {
    writeFileSync(full, out);
    console.log(`wrote ${path}`);
  }
}

// ---------------- unicode-script ----------------
{
  const v = locked("unicode-script");
  const id = `unicode-script-${v}`;
  const lines = readFileSync(join(REG, id, "src", "tables.rs"), "utf8").split("\n");
  const ver = /pub const UNICODE_VERSION: \(u64, u64, u64\) = \((\d+), (\d+), (\d+)\);/.exec(lines.join("\n"));
  if (!ver) die("unicode-script UNICODE_VERSION");
  // enum Script
  const enumStart = lineOf(lines, /^pub enum Script \{$/);
  const variants: [string, number][] = [];
  const docs = new Map<string, string>();
  let doc = "";
  let i = enumStart;
  for (; lines[i] !== "}"; i++) {
    const l = lines[i]!.trim();
    let m;
    if ((m = /^\/\/\/ ?(.*)$/.exec(l))) doc = m[1]!;
    else if ((m = /^([A-Za-z_]+) = (0x[0-9A-F]+|\d+),$/.exec(l))) {
      variants.push([m[1]!, Number(m[2])]);
      docs.set(m[1]!, doc);
    } else die(`unexpected line in enum Script: ${l}`);
  }
  const next = /^pub const NEXT_SCRIPT: u8 = (\d+);$/.exec(lines[i + 1]!);
  if (!next) die("NEXT_SCRIPT");
  // script_extensions
  const seStart = lineOf(lines, /^pub mod script_extensions \{$/);
  if (lines[seStart]!.trim() !== "use crate::ScriptExtension;") die("script_extensions use");
  const consts: { name: string; doc: string | undefined; expr: string }[] = [];
  doc = "";
  let docSet = false;
  for (i = seStart + 1; lines[i] !== "}"; i++) {
    const l = lines[i]!.trim();
    let m;
    if ((m = /^\/\/\/ ?(.*)$/.exec(l))) {
      doc = m[1]!;
      docSet = true;
      continue;
    }
    m = /^pub const ([A-Z0-9_]+): ScriptExtension = (.*);$/.exec(l);
    if (!m) die(`unexpected line in script_extensions: ${l}`);
    let e = m[2]!;
    let ts: string;
    let mm;
    if ((mm = /^ScriptExtension::new_(common|inherited|unknown)\(\)$/.exec(e))) ts = `ScriptExtension.new_${mm[1]}()`;
    else if ((mm = /^ScriptExtension::new\((0x[0-9a-f]+|0), (0x[0-9a-f]+|0), (0x[0-9a-f]+|0)\)$/.exec(e)))
      ts = `ScriptExtension.new(${mm[1]}n, ${mm[2]}n, ${mm[3]}n)`;
    else if (/^[A-Z0-9_]+$/.test(e)) ts = e;
    else if (/^[A-Z0-9_]+(\.union\([A-Z0-9_]+\))+$/.test(e)) ts = e;
    else die(`unexpected script_extensions expr: ${e}`);
    consts.push({ name: m[1]!, doc: docSet ? doc : undefined, expr: ts });
    docSet = false;
  }
  // impl Script name fns
  const nameFn = (fn: string): Map<string, string> => {
    const start = lineOf(lines, new RegExp(`fn ${fn}\\(self\\) -> &'static str \\{$`));
    if (lines[start]!.trim() !== "match self {") die(`${fn} match`);
    const out = new Map<string, string>();
    for (let j = start + 1; lines[j]!.trim() !== "}"; j++) {
      const m = /^Script::([A-Za-z_]+) => "([^"]*)",$/.exec(lines[j]!.trim());
      if (!m) die(`${fn}: ${lines[j]}`);
      out.set(m[1]!, m[2]!);
    }
    return out;
  };
  const fromFn = (fn: string): [string, string][] => {
    const start = lineOf(lines, new RegExp(`fn ${fn}\\(input: &str\\) -> Option<Self> \\{$`));
    if (lines[start]!.trim() !== "match input {") die(`${fn} match`);
    const out: [string, string][] = [];
    let j = start + 1;
    for (; lines[j]!.trim() !== "_ => None,"; j++) {
      const m = /^"([^"]*)" => Some\(Script::([A-Za-z_]+)\),$/.exec(lines[j]!.trim());
      if (!m) die(`${fn}: ${lines[j]}`);
      out.push([m[1]!, m[2]!]);
    }
    return out;
  };
  const full = nameFn("inner_full_name");
  const short = nameFn("inner_short_name");
  const fromFull = fromFn("inner_from_full_name");
  const fromShort = fromFn("inner_from_short_name");
  const forIntStart = lineOf(lines, /fn for_integer\(value: u8\) -> Self \{$/);
  const forInt: [number, string][] = [];
  {
    let j = forIntStart + 1;
    for (; lines[j]!.trim() !== "_ => unreachable!(),"; j++) {
      const m = /^(\d+) => Script::([A-Za-z_]+),$/.exec(lines[j]!.trim());
      if (!m) die(`for_integer: ${lines[j]}`);
      forInt.push([Number(m[1]), m[2]!]);
    }
  }
  for (const [n, d] of variants) {
    if (!full.has(n) || !short.has(n)) die(`names of ${n}`);
    if (d < 0xfd && !forInt.some(([k, s]) => k === d && s === n)) die(`for_integer ${n}`);
  }
  // tables
  const scripts: number[] = [];
  const disc = new Map(variants);
  for (const m of tableText(lines, /^\s*const SCRIPTS: &'static \[\(char, char, Script\)\] = &\[$/).matchAll(/\(\s*('[^']+'),\s*('[^']+'),\s*Script::([A-Za-z_]+)\s*\)/g)) {
    if (!disc.has(m[3]!)) die(`SCRIPTS: unknown script ${m[3]}`);
    scripts.push(charLit(m[1]!), charLit(m[2]!), disc.get(m[3]!)!);
  }
  const extText = tableText(lines, /^\s*const SCRIPT_EXTENSIONS: &'static \[\(char, char, ScriptExtension\)\] = &\[$/);
  const exts: [number, number, string][] = [];
  for (const m of extText.matchAll(/\(\s*('[^']+'),\s*('[^']+'),\s*script_extensions::([A-Z0-9_]+)\s*\)/g)) {
    if (!consts.some((c) => c.name === m[3])) die(`SCRIPT_EXTENSIONS: unknown ${m[3]}`);
    exts.push([charLit(m[1]!), charLit(m[2]!), m[3]!]);
  }
  if ((extText.match(/\(/g) ?? []).length !== exts.length) die("SCRIPT_EXTENSIONS: unparsed entries");
  const ln = (re: RegExp) => lineOf(lines, re);
  let o = `// GENERATED by tools/gen-unicode-security.ts from ${id}/src/tables.rs. Do not edit.\n`;
  o += `// Upstream's tables.rs is itself generated by the crate's scripts/unicode.py. \`enum Script\` -> a string union with\n`;
  o += `// \`Script_discriminant\` (\`#[repr(u8)]\`); the name \`match\`es -> lookup records; \`SCRIPTS\` -> flat [lo, hi, discriminant]\n`;
  o += `// triples; \`SCRIPT_EXTENSIONS\` -> [lo, hi, ScriptExtension] tuples.\n`;
  o += `import { ScriptExtension } from "./lib.ts";\nimport { unreachable } from "../../std/panic.ts";\n\n`;
  o += `/// The version of [Unicode](http://www.unicode.org/)\n/// that this version of unicode-script is based on.\n`;
  o += `export const UNICODE_VERSION: readonly [number, number, number] = [${ver[1]}, ${ver[2]}, ${ver[3]}];\n\n`;
  o += `/// A value of the \`Script\` property\nexport type Script =\n`;
  o += variants.map(([n]) => `  /// ${docs.get(n)}\n  | "${n}"`).join("\n") + ";\n";
  o += `export const Script = {\n${variants.map(([n]) => `  ${n}: "${n}"`).join(",\n")},\n} as const;\n`;
  o += `/** \`Script as u8\` (\`#[repr(u8)]\`). */\nexport const Script_discriminant: Readonly<Record<Script, number>> = {\n${variants.map(([n, d]) => `  ${n}: ${hex(d)}`).join(",\n")},\n};\n`;
  o += `export const NEXT_SCRIPT = ${next[1]};\n\n`;
  o += `/** The constants of \`pub mod script_extensions\`. */\nexport interface ScriptExtensions {\n${consts.map((c) => `  readonly ${c.name}: ScriptExtension;`).join("\n")}\n}\n`;
  o += `let SCRIPT_EXTENSIONS_CONSTS: ScriptExtensions | undefined = undefined;\n`;
  o += `/**\n * \`pub mod script_extensions\`. PORT: built on first use (lib.ts and this module import each other, so\n * \`ScriptExtension\` may not be initialised yet while this module loads): \`script_extensions::X\` is\n * \`script_extensions().X\`.\n */\n`;
  o += `export function script_extensions(): ScriptExtensions {\n  if (SCRIPT_EXTENSIONS_CONSTS !== undefined) return SCRIPT_EXTENSIONS_CONSTS;\n`;
  for (const c of consts) {
    if (c.doc !== undefined) o += `  /// ${c.doc}\n`;
    o += `  const ${c.name} = ${c.expr};\n`;
  }
  o += `  SCRIPT_EXTENSIONS_CONSTS = {\n${consts.map((c) => `    ${c.name}`).join(",\n")},\n  };\n  return SCRIPT_EXTENSIONS_CONSTS;\n}\n\n`;
  const rec = (name: string, m: Map<string, string>) =>
    `const ${name}: Readonly<Record<Script, string>> = {\n${variants.map(([n]) => `  ${n}: ${JSON.stringify(m.get(n))}`).join(",\n")},\n};\n`;
  const fromRec = (name: string, m: [string, string][]) =>
    `const ${name}: ReadonlyMap<string, Script> = new Map<string, Script>([\n${m.map(([k, s]) => `  [${JSON.stringify(k)}, "${s}"]`).join(",\n")},\n]);\n`;
  o += `// impl Script\n` + rec("FULL_NAMES", full);
  o += `// crate: ${id}/src/tables.rs:${ln(/fn inner_full_name\(/)} inner_full_name\nexport function Script_inner_full_name(self: Script): string {\n  return FULL_NAMES[self];\n}\n\n`;
  o += fromRec("FROM_FULL_NAMES", fromFull);
  o += `// crate: ${id}/src/tables.rs:${ln(/fn inner_from_full_name\(/)} inner_from_full_name\nexport function Script_inner_from_full_name(input: string): Script | undefined {\n  return FROM_FULL_NAMES.get(input);\n}\n\n`;
  o += rec("SHORT_NAMES", short);
  o += `// crate: ${id}/src/tables.rs:${ln(/fn inner_short_name\(/)} inner_short_name\nexport function Script_inner_short_name(self: Script): string {\n  return SHORT_NAMES[self];\n}\n\n`;
  o += fromRec("FROM_SHORT_NAMES", fromShort);
  o += `// crate: ${id}/src/tables.rs:${ln(/fn inner_from_short_name\(/)} inner_from_short_name\nexport function Script_inner_from_short_name(input: string): Script | undefined {\n  return FROM_SHORT_NAMES.get(input);\n}\n\n`;
  o += `const FOR_INTEGER: readonly Script[] = [\n${forInt.map(([k, s], idx) => (k !== idx ? die("for_integer not dense") : `  "${s}"`)).join(",\n")},\n];\n`;
  o += `// crate: ${id}/src/tables.rs:${ln(/fn for_integer\(/)} for_integer\nexport function Script_for_integer(value: number): Script {\n  const s = FOR_INTEGER[value];\n  return s !== undefined ? s : unreachable();\n}\n\n`;
  o += `// crate: ${id}/src/tables.rs:${ln(/^pub fn bsearch_range_value_table/)} bsearch_range_value_table\n`;
  o += `/** PORT: \`r\` is a flat [lo, hi, value-index] table (\`width\` 3) and \`values\` maps the third column to \`T\`. */\n`;
  o += `export function bsearch_range_value_table<T>(c: number, r: ArrayLike<number>, values: (i: number) => T): T | undefined {\n`;
  o += `  let lo = 0;\n  let hi = r.length / 3;\n  while (lo < hi) {\n    const mid = (lo + hi) >>> 1;\n    const rlo = r[mid * 3]!;\n    const rhi = r[mid * 3 + 1]!;\n`;
  o += `    if (rlo <= c && c <= rhi) return values(r[mid * 3 + 2]!);\n    else if (rhi < c) lo = mid + 1;\n    else hi = mid;\n  }\n  return undefined;\n}\n\n`;
  o += `// #[inline]\n// crate: ${id}/src/tables.rs:${ln(/^pub fn get_script\(/)} get_script\nexport function get_script(c: number): Script | undefined {\n  return bsearch_range_value_table(c, SCRIPTS, (d) => (d >= 0xfd ? DISCRIMINANT_SCRIPT.get(d)! : Script_for_integer(d)));\n}\n\n`;
  o += `// #[inline]\n// crate: ${id}/src/tables.rs:${ln(/^pub fn get_script_extension\(/)} get_script_extension\nexport function get_script_extension(c: number): ScriptExtension | undefined {\n  return bsearch_range_value_table(c, SCRIPT_EXTENSIONS_RANGES, (i) => script_extensions()[SCRIPT_EXTENSIONS_VALUE_NAMES[i]!]);\n}\n\n`;
  o += `const DISCRIMINANT_SCRIPT: ReadonlyMap<number, Script> = new Map<number, Script>([[0xff, "Unknown"], [0xfe, "Common"], [0xfd, "Inherited"]]);\n\n`;
  o += `const SCRIPTS = new Uint32Array([\n${rows(scripts, 12)}\n]);\n\n`;
  const uniq = [...new Set(exts.map((e) => e[2]))];
  o += `const SCRIPT_EXTENSIONS_VALUE_NAMES: readonly (keyof ScriptExtensions)[] = [\n${uniq.map((n) => `  "${n}"`).join(",\n")},\n];\n`;
  o += `const SCRIPT_EXTENSIONS_RANGES = new Uint32Array([\n${rows(exts.flatMap(([a, b, n]) => [a, b, uniq.indexOf(n)]), 12)}\n]);\n`;
  emit("src/vendor/unicode_script/tables.ts", o);
}

// ---------------- unicode-security ----------------
{
  const v = locked("unicode-security");
  const id = `unicode-security-${v}`;
  const lines = readFileSync(join(REG, id, "src", "tables.rs"), "utf8").split("\n");
  const ver = /pub const UNICODE_VERSION: \(u64, u64, u64\) = \((\d+), (\d+), (\d+)\);/.exec(lines.join("\n"));
  if (!ver) die("unicode-security UNICODE_VERSION");
  const ln = (re: RegExp) => lineOf(lines, re);
  // IdentifierType
  const itStart = ln(/^\s*pub enum IdentifierType \{$/);
  const itVariants: string[] = [];
  const itBody: string[] = [];
  for (let i = itStart; lines[i]!.trim() !== "}"; i++) {
    const l = lines[i]!.trim();
    if (l === "") {
      itBody.push("");
      continue;
    }
    let m;
    if ((m = /^\/\/ (.*)$/.exec(l))) itBody.push(`  // ${m[1]}`);
    else if ((m = /^([A-Za-z_]+),?$/.exec(l))) {
      itVariants.push(m[1]!);
      itBody.push(`  | "${m[1]}"`);
    } else die(`IdentifierType: ${l}`);
  }
  const status: number[] = [];
  const stText = tableText(lines, /^\s*const IDENTIFIER_STATUS: &'static \[\(char, char\)\] = &\[$/);
  for (const m of stText.matchAll(/\(\s*('[^']+'),\s*('[^']+')\s*\)/g)) status.push(charLit(m[1]!), charLit(m[2]!));
  if ((stText.match(/\(/g) ?? []).length * 2 !== status.length) die("IDENTIFIER_STATUS: unparsed entries");
  const types: number[] = [];
  const tyText = tableText(lines, /^\s*const IDENTIFIER_TYPE: &'static \[\(char, char, IdentifierType\)\] = &\[$/);
  for (const m of tyText.matchAll(/\(\s*('[^']+'),\s*('[^']+'),\s*IdentifierType::([A-Za-z_]+)\s*\)/g)) {
    const k = itVariants.indexOf(m[3]!);
    if (k < 0) die(`IDENTIFIER_TYPE: ${m[3]}`);
    types.push(charLit(m[1]!), charLit(m[2]!), k);
  }
  if ((tyText.match(/\(/g) ?? []).length * 3 !== types.length) die("IDENTIFIER_TYPE: unparsed entries");
  const confKeys: number[] = [];
  const confVals: number[][] = [];
  const cfText = tableText(lines, /^\s*const CONFUSABLES: &'static \[\(char, &'static \[char\]\)\] = &\[$/);
  for (const m of cfText.matchAll(/\(\s*('[^']+'),\s*&\[([^\]]*)\]\s*\)/g)) {
    confKeys.push(charLit(m[1]!));
    confVals.push(m[2]!.split(",").filter((s) => s.trim() !== "").map(charLit));
  }
  if ((cfText.match(/\(/g) ?? []).length !== confKeys.length) die("CONFUSABLES: unparsed entries");
  const pmText = tableText(lines, /^\s*const CONFUSABLES: &'static \[char\] = &\[$/);
  const pm = pmText.split(",").filter((s) => s.trim() !== "").map(charLit);
  for (const t of [status, types.filter((_, i) => i % 3 !== 2), confKeys, pm]) {
    for (let i = 1; i < t.length; i++) if (t[i]! < t[i - 1]!) die("table not sorted");
  }
  let o = `// GENERATED by tools/gen-unicode-security.ts from ${id}/src/tables.rs. Do not edit.\n`;
  o += `// Upstream's tables.rs is itself generated by the crate's scripts/unicode.py. Range tables -> flat [lo, hi] /\n`;
  o += `// [lo, hi, value] Uint32Arrays, \`&[char]\` -> Uint32Array of code points, \`CONFUSABLES\` -> sorted keys + prototypes.\n\n`;
  o += `/// The version of [Unicode](http://www.unicode.org/)\n/// that this version of unicode-security is based on.\n`;
  o += `export const UNICODE_VERSION: readonly [number, number, number] = [${ver[1]}, ${ver[2]}, ${ver[3]}];\n\n`;
  o += `// pub mod util\n`;
  o += `// #[inline]\n// crate: ${id}/src/tables.rs:${ln(/pub fn bsearch_table\(/)} bsearch_table\nfunction bsearch_table(c: number, r: ArrayLike<number>): boolean {\n  let lo = 0;\n  let hi = r.length;\n  while (lo < hi) {\n    const mid = (lo + hi) >>> 1;\n    if (r[mid]! === c) return true;\n    else if (r[mid]! < c) lo = mid + 1;\n    else hi = mid;\n  }\n  return false;\n}\n\n`;
  o += `// #[inline]\n// crate: ${id}/src/tables.rs:${ln(/pub fn bsearch_value_table</)} bsearch_value_table\n/** PORT: the \`(char, T)\` table is split into sorted \`keys\` and parallel \`values\`. */\nfunction bsearch_value_table<T>(c: number, keys: ArrayLike<number>, values: readonly T[]): T | undefined {\n  let lo = 0;\n  let hi = keys.length;\n  while (lo < hi) {\n    const mid = (lo + hi) >>> 1;\n    if (keys[mid]! === c) return values[mid];\n    else if (keys[mid]! < c) lo = mid + 1;\n    else hi = mid;\n  }\n  return undefined;\n}\n\n`;
  o += `// #[inline]\n// crate: ${id}/src/tables.rs:${ln(/pub fn bsearch_range_table\(/)} bsearch_range_table\nfunction bsearch_range_table(c: number, r: ArrayLike<number>): boolean {\n  let lo = 0;\n  let hi = r.length / 2;\n  while (lo < hi) {\n    const mid = (lo + hi) >>> 1;\n    const rlo = r[mid * 2]!;\n    const rhi = r[mid * 2 + 1]!;\n    if (rlo <= c && c <= rhi) return true;\n    else if (rhi < c) lo = mid + 1;\n    else hi = mid;\n  }\n  return false;\n}\n\n`;
  o += `// crate: ${id}/src/tables.rs:${ln(/pub fn bsearch_range_value_table</)} bsearch_range_value_table\n/** PORT: \`r\` is a flat [lo, hi, value-index] table and \`values\` maps the third column to \`T\`. */\nfunction bsearch_range_value_table<T>(c: number, r: ArrayLike<number>, values: readonly T[]): T | undefined {\n  let lo = 0;\n  let hi = r.length / 3;\n  while (lo < hi) {\n    const mid = (lo + hi) >>> 1;\n    const rlo = r[mid * 3]!;\n    const rhi = r[mid * 3 + 1]!;\n    if (rlo <= c && c <= rhi) return values[r[mid * 3 + 2]!];\n    else if (rhi < c) lo = mid + 1;\n    else hi = mid;\n  }\n  return undefined;\n}\n\n`;
  o += `// pub mod identifier\n// #[derive(Copy, Clone, Hash, Eq, PartialEq, Ord, PartialOrd, Debug)]\n/// https://www.unicode.org/reports/tr39/#Identifier_Status_and_Type\nexport type IdentifierType =\n${itBody.filter((l, i, a) => !(l === "" && (i === 0 || i === a.length - 1))).join("\n")};\n`;
  o += `export const IdentifierType = {\n${itVariants.map((n) => `  ${n}: "${n}"`).join(",\n")},\n} as const;\n`;
  o += `/** Variant order (\`#[derive(PartialOrd, Ord)]\`). */\nexport const IdentifierType_discriminant: Readonly<Record<IdentifierType, number>> = {\n${itVariants.map((n, i) => `  ${n}: ${i}`).join(",\n")},\n};\n`;
  o += `const IDENTIFIER_TYPE_VALUES: readonly IdentifierType[] = [${itVariants.map((n) => `"${n}"`).join(", ")}];\n\n`;
  o += `// #[inline]\n// crate: ${id}/src/tables.rs:${ln(/pub fn identifier_status_allowed\(/)} identifier_status_allowed\nexport function identifier_status_allowed(c: number): boolean {\n  // FIXME: do we want to special case ASCII here?\n  return bsearch_range_table(c, IDENTIFIER_STATUS);\n}\n\n`;
  o += `// #[inline]\n// crate: ${id}/src/tables.rs:${ln(/pub fn identifier_type\(/)} identifier_type\nexport function identifier_type(c: number): IdentifierType | undefined {\n  // FIXME: do we want to special case ASCII here?\n  return bsearch_range_value_table(c, IDENTIFIER_TYPE, IDENTIFIER_TYPE_VALUES);\n}\n\n`;
  o += `// Identifier status table:\nconst IDENTIFIER_STATUS = new Uint32Array([\n${rows(status, 12)}\n]);\n\n`;
  o += `const IDENTIFIER_TYPE = new Uint32Array([\n${rows(types, 12)}\n]);\n\n`;
  o += `// pub mod confusable_detection\n// #[inline]\n// crate: ${id}/src/tables.rs:${ln(/pub fn char_confusable_prototype\(/)} char_confusable_prototype\nexport function char_confusable_prototype(c: number): readonly number[] | undefined {\n  // FIXME: do we want to special case ASCII here?\n  return bsearch_value_table(c, CONFUSABLES_KEYS, CONFUSABLES_VALUES);\n}\n\n`;
  o += `// Confusable table:\nconst CONFUSABLES_KEYS = new Uint32Array([\n${rows(confKeys, 12)}\n]);\n`;
  o += `const CONFUSABLES_VALUES: readonly (readonly number[])[] = [\n${confVals.map((v) => `  [${v.map(hex).join(", ")}],`).join("\n")}\n];\n\n`;
  o += `// pub mod potential_mixed_script_confusable\n// #[inline]\n// crate: ${id}/src/tables.rs:${ln(/pub fn potential_mixed_script_confusable\(/)} potential_mixed_script_confusable\nexport function potential_mixed_script_confusable(c: number): boolean {\n  return bsearch_table(c, POTENTIAL_MIXED_SCRIPT_CONFUSABLES);\n}\n`;
  o += `const POTENTIAL_MIXED_SCRIPT_CONFUSABLES = new Uint32Array([\n${rows(pm, 12)}\n]);\n`;
  emit("src/vendor/unicode_security/tables.ts", o);
}
