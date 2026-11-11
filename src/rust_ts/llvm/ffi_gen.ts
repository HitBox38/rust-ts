// rust-ts: generator of the IR model's contract (plan-m7 D4, D5; review plan-m7 F6; lane llir-core-a). Not ported code.
//
// `rustc_codegen_llvm/src/llvm/ffi.rs` is the seam: the ported codegen calls its functions, and the model in this directory
// answers them in place of libLLVM. This file reads ffi.rs **at the pin** and writes the two generated files of the contract:
//
//   ffi_types.ts  the enums and bitflags ffi.rs declares (PORTING §5 shapes), and the debuginfo handle aliases
//   ffi.ts        one export per `fn` of ffi.rs, in ffi.rs's order, named as in ffi.rs and typed from its signature. A name an
//                 implementation module (`IMPL_MODULES`) exports is bound to it; any other is a stub that stops with
//                 `unported("llir: <name>")`. Every export goes through `bind` (trace.ts), which writes the port's side of the
//                 call trace when `RUST_TS_LLVM_TRACE` is set (scripts/lib/llvm-trace.ts's format).
//
//   bun src/rust_ts/llvm/ffi_gen.ts           rewrite both files
//   bun src/rust_ts/llvm/ffi_gen.ts --check   exit 1 with an ERROR line if either file is not what this generator writes now
//
// ffi.test.ts runs the check, and checks the contract against ffi.rs independently of this generator's own output (every fn,
// in order, with its arity), so a stale contract or a fn lost by the parser fails a unit test.
//
// Types (PORT decisions, recorded in docs/handoff/llir-core-a.md):
// - Handles (`&Value`, `&'a mut Builder<'a>`, `ptr::NonNull<TargetMachine>`) are the handle types of handles.ts; `Option<&T>` and a
//   returned `*mut T` are `T | undefined`.
// - Pointer and length pairs stay two parameters, as in ffi.rs, so a ported call reads like the Rust one: a `*const &T` is
//   `readonly T[]`, a PTR_LEN_STR `*const c_uchar` is `PtrLenStr` (a `string` is its UTF-8 bytes), a `*const c_char` is `string`.
// - `u64` / `c_ulonglong` / `i64` are `bigint` (a value: `LLVMConstInt`'s `N`), except parameters whose name says they are a count,
//   size, length, byte count, alignment, offset or bit width, which stay below 2^53 and are `number` (PORTING §5).
// - Out-parameters (`&mut c_uint`, `*mut size_t`) are `MutRef<T>` (PORTING §8); C callbacks are `unknown` (driver lanes refine them).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const FFI_PATH = "compiler/rustc_codegen_llvm/src/llvm/ffi.rs";
/** Implementation modules, in the order they are searched. llir-core-b and later llir lanes add theirs here. */
export const IMPL_MODULES = ["./core.ts"] as const;

export interface FfiParam {
  name: string;
  rust: string;
}
export interface FfiFn {
  name: string;
  line: number;
  params: FfiParam[];
  ret: string | undefined;
}
export interface FfiEnum {
  name: string;
  line: number;
  variants: { name: string; value: number }[];
}
export interface FfiFlags {
  name: string;
  line: number;
  repr: string;
  consts: { name: string; value: number }[];
}
export interface FfiItems {
  fns: FfiFn[];
  enums: FfiEnum[];
  flags: FfiFlags[];
  /** `pub(crate) type X;` in `extern` blocks and the opaque `struct X<'a>(InvariantOpaque<'a>)`s. */
  opaque: string[];
  /** `pub(crate) type DIScope = DIDescriptor;` */
  aliases: { name: string; target: string }[];
}

/** ffi.rs with comments blanked to spaces (newlines kept, so offsets keep their line). */
function blankComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src[i] === '"') {
      const j = src.indexOf('"', i + 1);
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (src.startsWith("//", i)) {
      const j = src.indexOf("\n", i);
      const end = j < 0 ? src.length : j;
      out += " ".repeat(end - i);
      i = end;
    } else if (src.startsWith("/*", i)) {
      const j = src.indexOf("*/", i) + 2;
      out += src.slice(i, j).replace(/[^\n]/g, " ");
      i = j;
    } else out += src[i++];
  }
  return out;
}

const lineAt = (src: string, off: number): number => {
  let n = 1;
  for (let i = 0; i < off; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
};

/** Index just past the bracket closing the `(` or `{` at `open` (only that kind of bracket nests; `<<` and `->` are text). */
function closeOf(src: string, open: number): number {
  const o = src[open]!;
  const c = o === "(" ? ")" : "}";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) depth++;
    else if (src[i] === c && --depth === 0) return i + 1;
  }
  throw new Error(`ffi_gen: unbalanced bracket at offset ${open}`);
}

/** Splits at commas outside brackets. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "(" || c === "<" || c === "[") depth++;
    else if ((c === ")" || c === ">" || c === "]") && s[i - 1] !== "-") depth--;
    if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim().replace(/\s+/g, " ")).filter((x) => x !== "");
}

/** The integer value of a bitflags or discriminant expression (`(1 << 2)`, `2 << 16`, `7`). */
function intExpr(e: string): number {
  const t = e.replace(/\s+/g, "");
  if (!/^[0-9()<|x]+$/.test(t)) throw new Error(`ffi_gen: not an integer expression: ${e}`);
  const toks = t.match(/0x[0-9a-fA-F]+|\d+|<<|\||\(|\)/g)!;
  let p = 0;
  const atom = (): number => {
    const k = toks[p++]!;
    if (k === "(") {
      const v = or();
      p++;
      return v;
    }
    return Number(k);
  };
  const shift = (): number => {
    let v = atom();
    while (toks[p] === "<<") {
      p++;
      v = v * 2 ** atom();
    }
    return v;
  };
  const or = (): number => {
    let v = shift();
    while (toks[p] === "|") {
      p++;
      v = v | shift();
    }
    return v;
  };
  return or();
}

/** Every item of ffi.rs the contract needs. */
export function parseFfi(raw: string): FfiItems {
  const src = blankComments(raw);
  const items: FfiItems = { fns: [], enums: [], flags: [], opaque: [], aliases: [] };
  // Functions, anywhere (they are all inside `unsafe extern "C"` blocks).
  for (const m of src.matchAll(/\bfn (LLVM\w+)\s*(<[^(]*>)?\s*\(/g)) {
    const open = m.index! + m[0].length - 1;
    const close = closeOf(src, open);
    const params = splitTop(src.slice(open + 1, close - 1)).map((p) => {
      const c = p.indexOf(":");
      return { name: p.slice(0, c).trim(), rust: p.slice(c + 1).trim() };
    });
    const tail = src.slice(close, src.indexOf(";", close));
    const ret = /^\s*->\s*([\s\S]+)$/.exec(tail)?.[1]?.trim().replace(/\s+/g, " ");
    items.fns.push({ name: m[1]!, line: lineAt(src, m.index! + 3), params, ret });
  }
  // Fieldless enums.
  for (const m of src.matchAll(/pub(?:\(crate\))? enum (\w+) \{/g)) {
    const open = m.index! + m[0].length - 1;
    const body = src.slice(open + 1, closeOf(src, open) - 1).replace(/#\[[^\]]*\]/g, "");
    let next = 0;
    const variants = splitTop(body).map((v) => {
      const eq = v.indexOf("=");
      const name = (eq < 0 ? v : v.slice(0, eq)).trim();
      const value = eq < 0 ? next : intExpr(v.slice(eq + 1));
      next = value + 1;
      return { name, value };
    });
    items.enums.push({ name: m[1]!, line: lineAt(src, m.index! + m[0].indexOf("enum")), variants });
  }
  // bitflags.
  for (const m of src.matchAll(/struct (\w+)\s*:\s*(\w+)\s*\{/g)) {
    const open = m.index! + m[0].length - 1;
    const body = src.slice(open + 1, closeOf(src, open) - 1);
    const consts = [...body.matchAll(/const (\w+)\s*=\s*([^;]+);/g)].map((c) => ({ name: c[1]!, value: intExpr(c[2]!) }));
    items.flags.push({ name: m[1]!, line: lineAt(src, m.index!), repr: m[2]!, consts });
  }
  for (const m of src.matchAll(/pub(?:\(crate\))? type (\w+);/g)) items.opaque.push(m[1]!);
  for (const m of src.matchAll(/pub(?:\(crate\))? struct (\w+)<'\w+>\(InvariantOpaque<'\w+>\);/g)) items.opaque.push(m[1]!);
  for (const m of src.matchAll(/pub(?:\(crate\))? type (DI\w+) = (\w+);/g)) items.aliases.push({ name: m[1]!, target: m[2]! });
  return items;
}

const RESERVED = new Set(["default", "new", "delete", "this", "in", "function", "var", "class", "enum", "export", "import", "super", "switch", "case", "with", "yield", "void", "null", "typeof", "instanceof", "package", "interface", "private", "protected", "public", "static", "let", "const", "catch", "finally", "throw", "try", "do", "debugger"]);
export const tsParamName = (n: string): string => (RESERVED.has(n) ? `${n}_` : n);

/** Parameters whose `u64` holds a count, size or similar (< 2^53): `number`; any other `u64` is `bigint`. */
const SMALL_U64 = /count|size|len|align|offset|bits|elements|bytes/i;

/** Handle types: the opaque types of ffi.rs plus the handles the generator knows from other files. */
const EXTRA_HANDLES = ["DIBuilder", "RustString"];

/** The TS type of a Rust type in a signature. Throws on a type it does not know, so a new ffi.rs shape fails the generator. */
export function tsType(rust: string, param: string | undefined, items: FfiItems, ret: boolean): string {
  const t = rust.replace(/'\w+ ?/g, "").replace(/<\s*>/g, "").replace(/\s+/g, " ").trim();
  const handles = new Set([...items.opaque, ...items.aliases.map((a) => a.name), ...EXTRA_HANDLES]);
  const enums = new Set(items.enums.map((e) => e.name));
  const flags = new Set(items.flags.map((f) => f.name));
  const handleOf = (s: string): string | undefined => {
    const h = s.replace(/^(&mut |&|ptr::NonNull<|\*const |\*mut )/, "").replace(/>$/, "").replace(/<.*>$/, "").replace(/^crate::llvm::|^llvm::/, "");
    return handles.has(h) ? h : undefined;
  };
  const small = param !== undefined && SMALL_U64.test(param);
  switch (t) {
    case "Bool":
    case "llvm::Bool":
      return "Bool";
    case "bool":
      return "boolean";
    case "c_uint":
    case "u32":
    case "c_int":
    case "i32":
    case "usize":
    case "size_t":
    case "NonZero<c_uint>":
    case "f64":
    case "c_double":
      return "number";
    case "u64":
    case "c_ulonglong":
    case "i64":
      return small ? "number" : "bigint";
    case "MetadataKindId":
    case "LLVMRustResult":
      return t;
    case "*const c_char":
      return ret ? "string | undefined" : "string";
    case "*mut c_char":
      return ret ? "string | undefined" : "unknown";
    case "*const c_uchar":
      return "PtrLenStr";
    case "*const u8":
      return "Uint8Array";
    case "*const u64":
      return "readonly bigint[]";
    case "*const c_uint":
    case "*const size_t":
      return "readonly number[]";
    case "*const *const c_char":
      return "readonly string[]";
    case "*const *const c_uchar":
      return "readonly PtrLenStr[]";
    case "*const ThinLTOModule":
      return "readonly ThinLTOModule[]";
    case "*mut size_t":
    case "*mut c_uint":
    case "&mut c_uint":
    case "&mut usize":
    case "&mut size_t":
      return "MutRef<number>";
    case "&mut u64":
      return small ? "MutRef<number>" : "MutRef<bigint>";
    case "&mut *const c_char":
      return "MutRef<string | undefined>";
    case "&mut DiagnosticLevel":
      return "MutRef<DiagnosticLevel>";
    case "*mut c_void":
    case "*const c_void":
    case "DiagnosticHandlerTy":
    case "SelfProfileBeforePassCallback":
    case "SelfProfileAfterPassCallback":
    case "GetSymbolsCallback":
    case "GetSymbolsErrorCallback":
    case "Option<&mut Option<crate::back::lto::Buffer>>":
      return "unknown";
    case "Option<&SanitizerOptions>":
      return "SanitizerOptions | undefined";
  }
  if (t.startsWith("extern \"C\" fn") || t.startsWith("unsafe extern \"C\" fn")) return "unknown";
  if (t.startsWith("*const crate::coverageinfo::ffi::")) return "readonly unknown[]";
  if (enums.has(t) || flags.has(t)) return t;
  let m = /^RawEnum<(\w+)>$/.exec(t);
  if (m && enums.has(m[1]!)) return `RawEnum<${m[1]}>`;
  m = /^&mut Option<&(\w+)>$/.exec(t);
  if (m && handleOf(m[1]!)) return `MutRef<${handleOf(m[1]!)} | undefined>`;
  m = /^Option<(.+)>$/.exec(t);
  if (m && handleOf(m[1]!)) return `${handleOf(m[1]!)} | undefined`;
  m = /^\*const Option<&(\w+)>$/.exec(t);
  if (m && handleOf(m[1]!)) return `readonly (${handleOf(m[1]!)} | undefined)[]`;
  m = /^\*const &(\w+)(<.*>)?$/.exec(t);
  if (m && handleOf(m[1]!)) return `readonly ${handleOf(m[1]!)}[]`;
  m = /^\*mut &(\w+)$/.exec(t);
  if (m && handleOf(m[1]!)) return `${handleOf(m[1]!)}[]`;
  if (/^\*mut /.test(t) && handleOf(t)) return ret ? `${handleOf(t)} | undefined` : handleOf(t)!;
  if (/^\*const /.test(t) && handleOf(t)) return ret ? `${handleOf(t)} | undefined` : handleOf(t)!;
  if (handleOf(t)) return handleOf(t)!;
  throw new Error(`ffi_gen: no TS type for \`${rust}\`${param ? ` (parameter ${param})` : ""}`);
}

const HEADER = (what: string) =>
  `// GENERATED by src/rust_ts/llvm/ffi_gen.ts from ${FFI_PATH} at the pin (${what}). Do not edit: change the generator or
// an implementation module and rerun \`bun src/rust_ts/llvm/ffi_gen.ts\`. Not ported code (lane llir-core-a).
`;

/** ffi_types.ts: enums (string unions + companion + discriminants), bitflags (branded numbers + `flags_companion`), aliases. */
export function genTypes(items: FfiItems): string {
  let o = HEADER("its enums, bitflags and debuginfo aliases");
  o += `import { flags_companion } from "../../vendor/bitflags/traits.ts";\n`;
  for (const e of items.enums) {
    o += `\n// ffi: ${FFI_PATH}:${e.line} ${e.name}\n`;
    o += `export type ${e.name} = ${e.variants.map((v) => JSON.stringify(v.name)).join(" | ")};\n`;
    o += `export const ${e.name} = { ${e.variants.map((v) => `${v.name}: ${JSON.stringify(v.name)}`).join(", ")} } as const;\n`;
    o += `export const ${e.name}_discriminant: Readonly<Record<${e.name}, number>> = { ${e.variants.map((v) => `${v.name}: ${v.value}`).join(", ")} };\n`;
  }
  for (const f of items.flags) {
    // PORT: `AllocKindFlags: u64` holds bits below 2^6, so it is a 32-bit flags type here.
    const bits = f.repr === "u64" ? 32 : f.repr === "u8" ? 8 : f.repr === "u16" ? 16 : 32;
    o += `\n// ffi: ${FFI_PATH}:${f.line} ${f.name}\n`;
    o += `export type ${f.name} = number & { readonly __brand: ${JSON.stringify(f.name)} };\n`;
    o += `export const ${f.name} = flags_companion<${f.name}, { ${f.consts.map((c) => `${c.name}: ${f.name}`).join("; ")} }>(\n  ${bits},\n`;
    o += `  { ${f.consts.map((c) => `${c.name}: ${c.value} as ${f.name}`).join(", ")} },\n`;
    o += `  [${f.consts.map((c) => `[${JSON.stringify(c.name)}, ${c.value} as ${f.name}]`).join(", ")}],\n);\n`;
  }
  return o;
}

/** ffi.ts: the functions. `impls` maps a fn name to the implementation module that exports it. */
export function genFns(items: FfiItems, impls: ReadonlyMap<string, string>): string {
  const typeNames = new Set([...items.enums.map((e) => e.name), ...items.flags.map((f) => f.name)]);
  const handleNames = [...new Set([...items.opaque, ...items.aliases.map((a) => a.name), ...EXTRA_HANDLES])].sort();
  let o = HEADER(`its ${items.fns.length} functions`);
  o += `import type { ${handleNames.join(", ")} } from "./handles.ts";\n`;
  o += `import type { Bool, MetadataKindId, MutRef, PtrLenStr, RawEnum, SanitizerOptions, ThinLTOModule } from "./support.ts";\n`;
  o += `import type { ${[...typeNames, "LLVMRustResult"].filter((n, i, a) => a.indexOf(n) === i).sort().join(", ")} } from "./ffi_types.ts";\n`;
  o += `import { bind, stub } from "./trace.ts";\n`;
  const mods = [...new Set(impls.values())];
  mods.forEach((m, i) => (o += `import * as impl${i} from ${JSON.stringify(m)};\n`));
  o += `\nexport type { ${handleNames.join(", ")} } from "./handles.ts";\nexport * from "./ffi_types.ts";\nexport * from "./support.ts";\n`;
  const done = items.fns.filter((f) => impls.has(f.name)).map((f) => f.name);
  o += `\n/** The ${done.length} of ${items.fns.length} functions an implementation module provides; every other one is a stub. */\n`;
  o += `export const IMPLEMENTED: ReadonlySet<string> = new Set([\n${done.map((n) => `  ${JSON.stringify(n)},\n`).join("")}]);\n`;
  for (const f of items.fns) {
    const params = f.params.map((p) => `${tsParamName(p.name)}: ${tsType(p.rust, p.name, items, false)}`).join(", ");
    const ret = f.ret === undefined ? "void" : tsType(f.ret, undefined, items, true);
    const mod = impls.get(f.name);
    const rhs = mod === undefined ? `stub(${JSON.stringify(f.name)})` : `bind(${JSON.stringify(f.name)}, impl${mods.indexOf(mod)}.${f.name})`;
    o += `\n// ffi: ${FFI_PATH}:${f.line} ${f.name}\nexport const ${f.name}: (${params}) => ${ret} = ${rhs};\n`;
  }
  return o;
}

/** Which implementation module exports each ffi fn (the first in `IMPL_MODULES` order). */
export async function implMap(items: FfiItems, dir: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const m of IMPL_MODULES) {
    const mod = (await import(join(dir, m))) as Record<string, unknown>;
    for (const f of items.fns) if (!map.has(f.name) && typeof mod[f.name] === "function") map.set(f.name, m);
  }
  return map;
}

export async function generate(upstream: string, dir: string): Promise<{ types: string; fns: string; items: FfiItems }> {
  const items = parseFfi(readFileSync(join(upstream, FFI_PATH), "utf8"));
  return { types: genTypes(items), fns: genFns(items, await implMap(items, dir)), items };
}

if (import.meta.main) {
  const { UPSTREAM } = await import("../../../scripts/lib/common.ts");
  const dir = import.meta.dir;
  const items = parseFfi(readFileSync(join(UPSTREAM, FFI_PATH), "utf8"));
  const check = process.argv.includes("--check");
  const typesFile = join(dir, "ffi_types.ts");
  const fnsFile = join(dir, "ffi.ts");
  const types = genTypes(items);
  const stale: string[] = [];
  const current = (f: string): string | undefined => {
    try {
      return readFileSync(f, "utf8");
    } catch {
      return undefined;
    }
  };
  // The types first: the implementation modules import them, and `implMap` imports the implementation modules.
  if (check) {
    if (current(typesFile) !== types) stale.push("ffi_types.ts");
  } else writeFileSync(typesFile, types);
  const fns = genFns(items, await implMap(items, dir));
  if (check) {
    if (current(fnsFile) !== fns) stale.push("ffi.ts");
    if (stale.length) {
      console.log(`ERROR: stale contract: ${stale.join(", ")}; run bun src/rust_ts/llvm/ffi_gen.ts`);
      process.exit(1);
    }
    console.log(`contract up to date: ${items.fns.length} fns, ${items.enums.length} enums, ${items.flags.length} bitflags`);
  } else {
    writeFileSync(fnsFile, fns);
    console.log(`wrote ffi.ts (${items.fns.length} fns) and ffi_types.ts (${items.enums.length} enums, ${items.flags.length} bitflags)`);
  }
}
