// Checks tools/codegen/diagnostics.ts against the real `#[derive(Diagnostic)]` /
// `#[derive(Subdiagnostic)]` expansion of the pinned rustc_macros.
//
//   bun tools/codegen/diag-expand.ts <set | compiler/..../file.rs>... [--write-fixture]
//
// For each upstream file (given directly or as a set of types.sets.json), a scratch crate under
// $RUST_TS_DATA/tmp/diag-expand includes the file as a module and depends on upstream
// `compiler/rustc_macros`; `cargo +nightly rustc -- -Zunpretty=expanded` prints the expansion
// (name-resolution errors of the other imports do not stop it). Every `match self` arm of every
// generated `into_diag` / `add_to_diag` is tokenized and canonicalized (inline messages and
// `format!` calls by value, `__code_N` renumbered per arm) and compared with the generator's IR
// rendered as Rust (`renderRust`). `--write-fixture` stores the canonical expansion in
// tools/codegen/fixtures/diag-expansion.json so that `diagnostics.test.ts` can repeat the
// comparison without cargo.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type DeriveImpl, diagDerives, diagnostic_derive, parseFormatString, renderRust, subdiagnostic_derive } from "./diagnostics.ts";
import { loadSet, type PFile, type ProbeJson, REPO, runProbe } from "./types.ts";

// ---- Rust tokens --------------------------------------------------------------------------------

export type RTok = { k: "ident" | "punct" | "num" | "life"; v: string } | { k: "str"; v: string };

const IDENT_START = /[\p{XID_Start}_]/u;
const IDENT_CONT = /[\p{XID_Continue}]/u;

function unescapeRust(body: string): string {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = body[++i]!;
    switch (n) {
      case "n":
        out += "\n";
        break;
      case "r":
        out += "\r";
        break;
      case "t":
        out += "\t";
        break;
      case "0":
        out += "\0";
        break;
      case "\\":
      case "'":
      case '"':
        out += n;
        break;
      case "x":
        out += String.fromCharCode(parseInt(body.slice(i + 1, i + 3), 16));
        i += 2;
        break;
      case "u": {
        const j = body.indexOf("}", i);
        out += String.fromCodePoint(parseInt(body.slice(i + 2, j), 16));
        i = j;
        break;
      }
      case "\n": {
        // line continuation: skip the newline and leading whitespace
        while (i + 1 < body.length && /\s/.test(body[i + 1]!)) i++;
        break;
      }
      default:
        throw new Error(`unknown escape \\${n}`);
    }
  }
  return out;
}

/** A small Rust tokenizer (enough for pretty-printed expansions). */
export function tokenizeRust(src: string): RTok[] {
  const out: RTok[] = [];
  let i = 0;
  const cps = src;
  while (i < cps.length) {
    const c = cps[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "/" && cps[i + 1] === "/") {
      while (i < cps.length && cps[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && cps[i + 1] === "*") {
      let depth = 0;
      do {
        if (cps.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (cps.startsWith("*/", i)) {
          depth--;
          i += 2;
        } else i++;
      } while (depth > 0 && i < cps.length);
      continue;
    }
    // raw strings r"..", r#".."#, br#".."#
    const raw = /^(b|c)?r(#*)"/.exec(cps.slice(i, i + 40));
    if (raw) {
      const hashes = raw[2]!;
      const start = i + raw[0].length;
      const end = cps.indexOf(`"${hashes}`, start);
      out.push({ k: "str", v: cps.slice(start, end) });
      i = end + 1 + hashes.length;
      continue;
    }
    if (c === '"' || ((c === "b" || c === "c") && cps[i + 1] === '"')) {
      let j = c === '"' ? i + 1 : i + 2;
      const start = j;
      while (cps[j] !== '"') j += cps[j] === "\\" ? 2 : 1;
      out.push({ k: "str", v: unescapeRust(cps.slice(start, j)) });
      i = j + 1;
      // literal suffix
      while (i < cps.length && IDENT_CONT.test(cps[i]!)) i++;
      continue;
    }
    if (c === "'") {
      // char literal or lifetime
      if (cps[i + 1] === "\\") {
        let j = i + 2;
        while (cps[j] !== "'") j++;
        out.push({ k: "str", v: unescapeRust(cps.slice(i + 1, j)) });
        i = j + 1;
        continue;
      }
      const cp = cps.codePointAt(i + 1)!;
      const w = cp > 0xffff ? 2 : 1;
      if (cps[i + 1 + w] === "'") {
        out.push({ k: "str", v: String.fromCodePoint(cp) });
        i += 2 + w;
        continue;
      }
      let j = i + 1;
      while (j < cps.length && IDENT_CONT.test(cps[j]!)) j++;
      out.push({ k: "life", v: cps.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < cps.length && /[0-9a-zA-Z_]/.test(cps[j]!)) j++;
      out.push({ k: "num", v: cps.slice(i, j) });
      i = j;
      continue;
    }
    if (IDENT_START.test(c)) {
      let j = i;
      while (j < cps.length && IDENT_CONT.test(cps[j]!)) j++;
      let v = cps.slice(i, j);
      if (v === "r" && cps[j] === "#") {
        // raw identifier
        let k = j + 1;
        while (k < cps.length && IDENT_CONT.test(cps[k]!)) k++;
        v = cps.slice(j + 1, k);
        j = k;
      }
      out.push({ k: "ident", v });
      i = j;
      continue;
    }
    out.push({ k: "punct", v: c });
    i++;
  }
  return out;
}

// ---- canonical form -----------------------------------------------------------------------------

const tokText = (t: RTok) => (t.k === "str" ? JSON.stringify(t.v) : t.v);

function matchSeq(toks: RTok[], i: number, seq: string): boolean {
  const parts = seq.split(" ");
  for (let k = 0; k < parts.length; k++) {
    const t = toks[i + k];
    if (!t || t.k === "str" || t.v !== parts[k]) return false;
  }
  return true;
}
/** index of the token closing the group opened at `open` */
function closeOf(toks: RTok[], open: number): number {
  let depth = 0;
  for (let i = open; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.k !== "punct") continue;
    if (t.v === "(" || t.v === "[" || t.v === "{") depth++;
    else if (t.v === ")" || t.v === "]" || t.v === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("unbalanced tokens");
}
function splitTopLevel(toks: RTok[], sep: string): RTok[][] {
  const out: RTok[][] = [[]];
  let depth = 0;
  for (const t of toks) {
    if (t.k === "punct" && (t.v === "(" || t.v === "[" || t.v === "{")) depth++;
    if (t.k === "punct" && (t.v === ")" || t.v === "]" || t.v === "}")) depth--;
    if (depth === 0 && t.k === "punct" && t.v === sep) out.push([]);
    else out[out.length - 1]!.push(t);
  }
  return out;
}

/** `FMT<...>`: a format call by value (template pieces with their argument expressions). */
function fmtToken(template: string, args: RTok[][], named: boolean): string {
  const pieces = parseFormatString(template);
  if (typeof pieces === "string") return `FMT!${pieces}`;
  const byName = new Map<string, string>();
  const positional: string[] = [];
  for (const a of args) {
    if (named) {
      const [n, ...rest] = splitTopLevel(a, "=");
      byName.set(n!.map(tokText).join(""), rest.flat().map(tokText).join(" "));
    } else positional.push(a.map(tokText).join(" "));
  }
  let implicit = 0;
  const canon = pieces.map((p) => {
    if ("lit" in p) return p.lit;
    const key = p.arg === "" ? String(implicit++) : p.arg;
    const v = /^\d+$/.test(key) ? positional[Number(key)] : byName.get(key);
    return { arg: v ?? `?${key}`, spec: p.spec };
  });
  // adjacent literals merge (the pretty printer may split or join them)
  const merged: (string | { arg: string; spec: string })[] = [];
  for (const p of canon) {
    const last = merged[merged.length - 1];
    if (typeof p === "string" && typeof last === "string") merged[merged.length - 1] = last + p;
    else merged.push(p);
  }
  return `FMT${JSON.stringify(merged)}`;
}

/** Canonical token texts of an arm body. */
export function canonicalize(toks: RTok[]): string[] {
  const out: string[] = [];
  const codes = new Map<string, string>();
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (matchSeq(toks, i, "rustc_errors : : DiagMessage : : Inline ( std : : borrow : : Cow : : Borrowed (") && toks[i + 19]?.k === "str") {
      out.push(`MSG${JSON.stringify(toks[i + 19]!.v)}`);
      i += 21;
      continue;
    }
    if (matchSeq(toks, i, ": : alloc : : __export : : must_use ( { : : alloc : : fmt : : format ( format_args ! (")) {
      const open = i + 23;
      const close = closeOf(toks, open);
      const [tpl, ...args] = splitTopLevel(toks.slice(open + 1, close), ",");
      out.push(fmtToken(tpl![0]!.k === "str" ? tpl![0]!.v : "?", args.filter((a) => a.length), false));
      i = closeOf(toks, i + 9); // the `(` of must_use
      continue;
    }
    if (matchSeq(toks, i, "format ! (")) {
      const close = closeOf(toks, i + 2);
      const [tpl, ...args] = splitTopLevel(toks.slice(i + 3, close), ",");
      out.push(fmtToken(tpl![0]!.k === "str" ? tpl![0]!.v : "?", args.filter((a) => a.length), true));
      i = close;
      continue;
    }
    if (t.k === "ident" && /^__code_\d+$/.test(t.v)) {
      if (!codes.has(t.v)) codes.set(t.v, `__code#${codes.size}`);
      out.push(codes.get(t.v)!);
      continue;
    }
    out.push(tokText(t));
  }
  return out;
}

// ---- expansion ----------------------------------------------------------------------------------

export interface ExpandedImpl {
  kind: "Diagnostic" | "Subdiagnostic";
  item: string;
  arms: { pat: string; body: string[] }[];
}

/** The derive impls of each `mod m<i>` of the expansion. */
export function extractImpls(expanded: string): Map<string, ExpandedImpl[]> {
  const toks = tokenizeRust(expanded);
  const out = new Map<string, ExpandedImpl[]>();
  for (let i = 0; i < toks.length; i++) {
    if (!(matchSeq(toks, i, "mod") && toks[i + 1]?.k === "ident" && matchSeq(toks, i + 2, "{"))) continue;
    const name = toks[i + 1]!.v;
    const close = closeOf(toks, i + 2);
    const impls: ExpandedImpl[] = [];
    for (let j = i + 3; j < close; j++) {
      let kind: ExpandedImpl["kind"] | undefined;
      let k = j;
      if (matchSeq(toks, j, "rustc_errors : : Diagnostic < '_sess > for")) {
        kind = "Diagnostic";
        k = j + 8;
      } else if (matchSeq(toks, j, "rustc_errors : : Subdiagnostic for")) {
        kind = "Subdiagnostic";
        k = j + 5;
      } else continue;
      if (toks[j - 1]?.v === ">" || toks[j - 1]?.v === "impl") {
        const item = toks[k]!.v;
        // `match self {`
        let m = k;
        while (!matchSeq(toks, m, "match self {")) m++;
        const mclose = closeOf(toks, m + 2);
        const arms: ExpandedImpl["arms"] = [];
        let p = m + 3;
        while (p < mclose) {
          let q = p;
          while (!(toks[q]!.v === "=" && toks[q + 1]!.v === ">")) q++;
          const pat = toks.slice(p, q).map(tokText).join(" ");
          const bopen = q + 2;
          const bclose = closeOf(toks, bopen);
          arms.push({ pat, body: canonicalize(toks.slice(bopen + 1, bclose)) });
          p = bclose + 1;
          if (toks[p]?.v === ",") p++;
        }
        impls.push({ kind, item, arms });
        j = mclose;
      }
    }
    out.set(name, impls);
    i = close;
  }
  return out;
}

/** Build the scratch crate and return the expansion text of `files` (cached per pin + file list). */
export async function expand(files: string[]): Promise<string> {
  const { DATA, UPSTREAM, PIN } = await import("../../scripts/lib/common.ts");
  const dir = join(DATA, "tmp", "diag-expand");
  mkdirSync(join(dir, "src"), { recursive: true });
  const key = JSON.stringify({ pin: PIN.commit, files });
  const cache = join(dir, "expanded.rs");
  const keyFile = join(dir, "expanded.key");
  if (existsSync(cache) && existsSync(keyFile) && readFileSync(keyFile, "utf8") === key) return readFileSync(cache, "utf8");
  writeFileSync(
    join(dir, "Cargo.toml"),
    [
      "[package]",
      'name = "diagexpand"',
      'version = "0.0.0"',
      'edition = "2024"',
      "publish = false",
      "[lib]",
      'path = "src/lib.rs"',
      "[dependencies]",
      `rustc_macros = { path = ${JSON.stringify(join(UPSTREAM, "compiler", "rustc_macros").replaceAll("\\", "/"))} }`,
      "[workspace]",
      "",
    ].join("\n"),
  );
  const lib = ["#![allow(unused)]"];
  files.forEach((f, i) => {
    writeFileSync(join(dir, "src", `m${i}.rs`), readFileSync(join(UPSTREAM, f), "utf8"));
    lib.push(`pub mod m${i};`);
  });
  writeFileSync(join(dir, "src", "lib.rs"), lib.join("\n") + "\n");
  const r = Bun.spawnSync(["cargo", `+${PIN.toolchain}`, "rustc", "--quiet", "--manifest-path", join(dir, "Cargo.toml"), "--", "-Zunpretty=expanded"], {
    env: { ...process.env, RUSTC_BOOTSTRAP: "1", CARGO_TARGET_DIR: join(DATA, "target", "diag-expand") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = r.stdout.toString();
  if (!text.includes("mod m0")) throw new Error(`expansion failed: ${r.stderr.toString().split("\n").slice(0, 5).join(" | ")}`);
  writeFileSync(cache, text);
  writeFileSync(keyFile, key);
  return text;
}

// ---- comparison ---------------------------------------------------------------------------------

/** The generator's derives of one probed file, rendered as canonical Rust tokens. */
export function generatedImpls(file: PFile, errors: string[]): ExpandedImpl[] {
  const out: ExpandedImpl[] = [];
  const state = { code_ident_count: 0 };
  const errs = { error: (m: string) => errors.push(m) };
  for (const item of file.items) {
    const derives = diagDerives(item.attrs.flatMap((a) => a.derives ?? []));
    for (const d of derives) {
      const impl: DeriveImpl = d === "Diagnostic" ? diagnostic_derive(item, file.path, errs, state) : subdiagnostic_derive(item, file.path, errs, state);
      out.push({
        kind: d,
        item: item.name,
        arms: renderRust(impl).map((a) => ({ pat: canonicalize(tokenizeRust(a.pat)).join(" "), body: canonicalize(tokenizeRust(a.body)) })),
      });
    }
  }
  return out;
}

export interface CompareResult {
  impls: number;
  same: number;
  diffs: string[];
}
export function compare(expected: ExpandedImpl[], actual: ExpandedImpl[], file: string): CompareResult {
  const diffs: string[] = [];
  let same = 0;
  const key = (x: ExpandedImpl) => `${x.kind} ${x.item}`;
  const act = new Map(actual.map((a) => [key(a), a]));
  for (const e of expected) {
    const a = act.get(key(e));
    act.delete(key(e));
    if (!a) {
      diffs.push(`${file}: ${key(e)}: not generated`);
      continue;
    }
    let ok = e.arms.length === a.arms.length;
    let first = ok ? "" : `${e.arms.length} arms expanded, ${a.arms.length} generated`;
    for (let i = 0; ok && i < e.arms.length; i++) {
      const ea = e.arms[i]!;
      const aa = a.arms[i]!;
      if (ea.pat !== aa.pat) {
        ok = false;
        first = `arm ${i} pattern: expanded \`${ea.pat}\`, generated \`${aa.pat}\``;
        break;
      }
      const n = Math.max(ea.body.length, aa.body.length);
      for (let t = 0; t < n; t++) {
        if (ea.body[t] !== aa.body[t]) {
          ok = false;
          const ctx = (b: string[]) => b.slice(Math.max(0, t - 6), t + 6).join(" ");
          first = `arm ${i} token ${t}: expanded \`${ctx(ea.body)}\`, generated \`${ctx(aa.body)}\``;
          break;
        }
      }
    }
    if (ok) same++;
    else diffs.push(`${file}: ${key(e)}: ${first}`);
  }
  for (const k of act.keys()) diffs.push(`${file}: ${k}: generated, not in the expansion`);
  return { impls: expected.length, same, diffs };
}

export const FIXTURE = join(REPO, "tools", "codegen", "fixtures", "diag-expansion.json");

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const write = argv.includes("--write-fixture");
  const sets = argv.filter((a) => !a.startsWith("--"));
  if (!sets.length) {
    console.log("usage: bun tools/codegen/diag-expand.ts <set | compiler/..../file.rs>... [--write-fixture]");
    process.exit(2);
  }
  const files = sets.flatMap((s) => (s.endsWith(".rs") ? [s] : loadSet(s).files));
  const expanded = extractImpls(await expand(files));
  const probe: ProbeJson = await runProbe(files);
  const fixture: Record<string, ExpandedImpl[]> = {};
  let impls = 0;
  let same = 0;
  const diffs: string[] = [];
  const errors: string[] = [];
  files.forEach((f, i) => {
    const exp = expanded.get(`m${i}`) ?? [];
    fixture[f] = exp;
    const pf = probe.files.find((p) => p.path === f)!;
    const r = compare(exp, generatedImpls(pf, errors), f);
    impls += r.impls;
    same += r.same;
    diffs.push(...r.diffs);
  });
  console.log(`diag-expand: ${files.length} files, ${impls} derive impls in the expansion, ${same} identical, ${diffs.length} differ, ${errors.length} generator errors`);
  for (const d of diffs.slice(0, 5)) console.log(`ERROR: ${d}`);
  for (const e of errors.slice(0, 5)) console.log(`ERROR: ${e}`);
  if (write) {
    writeFileSync(FIXTURE, JSON.stringify(fixture) + "\n");
    console.log(`fixture: ${FIXTURE}`);
  }
  if (diffs.length || errors.length) process.exit(1);
}
