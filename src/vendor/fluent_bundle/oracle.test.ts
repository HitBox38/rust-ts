// Oracle snapshot: testdata/snapshot.cases run through the port must print exactly
// testdata/snapshot.expected, which is the output of a scratch Rust program on the pinned crates
// (fluent-bundle 0.16.0, fluent-langneg 0.13.1, intl-memoizer 0.5.3, intl_pluralrules 7.0.2,
// unic-langid 0.9.6; release build). The program and the case generator are described in
// docs/handoff/fluent-bundle.md. Case kinds: F (format a message of a resource: bundle locales,
// isolation, builtins, STREQ, concurrent memoizer, args), N (FluentNumber::as_string and
// PluralOperands::from(&FluentNumber)), T (FluentValue::try_number), L (negotiate_languages),
// A (parse_accepted_languages), R ({:?} of FluentResource::try_new), V ({:?} of FluentArgs).
import { expect, test } from "bun:test";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { debug_result, type Result } from "../../std/result.ts";
import { debug_option, debug_str, debug_tuple, debug_vec, PLAIN } from "../../std/fmt.ts";
import { Panic } from "../../std/panic.ts";
import { type FluentError, FluentArgs, FluentBundle, FluentResource, FluentValue, debug_FluentArgs, debug_FluentError, debug_FluentResource, debug_FluentValue, display_FluentError } from "./lib.ts";
import { FluentNumber, FluentNumberOptions, FluentValue_from_num, PluralOperands_from_FluentNumber } from "./types/mod.ts";
import type { MemoizerKind } from "./memoizer.ts";
import type { FluentBundle as BundleT } from "./bundle.ts";
import { negotiate_languages, parse_accepted_languages, type NegotiationStrategy } from "../fluent_langneg/lib.ts";
import { debug_PluralOperands } from "../intl_pluralrules/operands.ts";
import { debug_LanguageIdentifierError, display_LanguageIdentifier, LanguageIdentifier } from "../unic_langid/lib.ts";
import { debug_ParserError } from "../fluent_syntax/parser/mod.ts";

function unesc(s: string): string {
  let out = ""; const cs = Array.from(s);
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!;
    if (c === "\\") {
      const n = cs[++i];
      if (n === "n") out += "\n"; else if (n === "t") out += "\t"; else if (n === "r") out += "\r"; else if (n === "\\") out += "\\";
      else if (n === "u") { out += String.fromCodePoint(parseInt(cs.slice(i + 1, i + 7).join(""), 16)); i += 6; }
      else throw new Panic("bad escape");
    } else out += c;
  }
  return out;
}
function parse_lid(s: string): LanguageIdentifier {
  const r = LanguageIdentifier.from_str(s);
  if (r.$ === "Err") throw new Panic(`bad langid in case: ${debug_LanguageIdentifierError(r._0, PLAIN)}`);
  return r._0;
}
const langids = (csv: string) => (csv === "" ? [] : csv.split(",").map(parse_lid));
/** Rust `str::parse::<f64>` for the probe's inputs (plain decimal/inf/NaN literals). */
const pf = (v: string) => (v === "inf" ? Infinity : v === "-inf" ? -Infinity : v === "NaN" ? NaN : Number(v));
function value(spec: string): FluentValue {
  const k = spec.slice(0, 2), v = spec.slice(2);
  switch (k) {
    case "s:": return FluentValue.from_String(v);
    case "f:": return FluentValue_from_num(pf(v));
    case "i:": return FluentValue_from_num(BigInt(v));
    case "u:": return FluentValue_from_num(BigInt(v));
    case "t:": return FluentValue.try_number(v);
    case "N:": return FluentValue.None;
    case "E:": return FluentValue.Error;
  }
  throw new Panic("bad value");
}
function args(spec: string): FluentArgs | undefined {
  if (spec === "-") return undefined;
  const a = FluentArgs.new();
  if (spec === "") return a;
  for (const kv of spec.split(";")) { const i = kv.indexOf("="); a.set(unesc(kv.slice(0, i)), value(unesc(kv.slice(i + 1)))); }
  return a;
}
const show = (v: LanguageIdentifier[]) => v.map(display_LanguageIdentifier).join(",");
const strategy = (s: string): NegotiationStrategy => (s === "F" ? "Filtering" : s === "M" ? "Matching" : "Lookup");
const debug_unit_result = (r: Result<null, FluentError>, err: (e: FluentError) => string) => (r.$ === "Ok" ? "Ok(())" : `Err(${err(r._0)})`);

function run(f: string[]): string {
  switch (f[0]) {
    case "F": {
      const r = FluentResource.try_new(unesc(f[2]!));
      if (r.$ === "Err") { const [res, e] = r._0; return `parse_errs ${debug_vec(e, PLAIN, debug_ParserError)}\n` + format_with(f, res); }
      return format_with(f, r._0);
    }
    case "N": {
      const o = FluentNumberOptions.default();
      if (f[2] !== "-") o.minimum_fraction_digits = Number(f[2]);
      const n = FluentNumber.new(pf(f[1]!), o);
      const ops = PluralOperands_from_FluentNumber(n);
      if (f.length > 3 && f[3] === "o") return debug_PluralOperands(ops, PLAIN);
      return `${debug_str(n.as_string())} | ${debug_PluralOperands(ops, PLAIN)}`;
    }
    case "T": return debug_FluentValue(FluentValue.try_number(unesc(f[1]!)), PLAIN);
    case "L": {
      const req = langids(f[2]!), av = langids(f[3]!);
      const def = f[4] === "-" ? undefined : (() => { const r = LanguageIdentifier.from_str(f[4]!); if (r.$ === "Err") throw new Panic(`called \`Result::unwrap()\` on an \`Err\` value: ${debug_LanguageIdentifierError(r._0, PLAIN)}`); return r._0; })();
      return show(negotiate_languages(req, av, def, strategy(f[1]!)));
    }
    case "A": return parse_accepted_languages(unesc(f[1]!)).map(display_LanguageIdentifier).join(",");
    case "R": { const r = FluentResource.try_new(unesc(f[1]!)); return debug_result(r, PLAIN, debug_FluentResource, ([res, e], fm) => debug_tuple(fm, "", [debug_FluentResource(res, fm), debug_vec(e, fm, debug_ParserError)])); }
    case "V": return debug_option(args(f[1]!), PLAIN, debug_FluentArgs);
  }
  throw new Panic("bad case");
}
function format_with(f: string[], res: FluentResource): string {
  const flags = f[6]!; const locales = langids(f[1]!);
  const a = args(f[5]!);
  if (flags.includes("c")) return go(FluentBundle.new_concurrent(locales), res, flags, f[3]!, f[4]!, a);
  return go(FluentBundle.new(locales), res, flags, f[3]!, f[4]!, a);
}
function go<M extends MemoizerKind>(bundle: BundleT<M>, res: FluentResource, flags: string, msgid: string, attr: string, a: FluentArgs | undefined): string {
  let out = "";
  bundle.set_use_isolating(flags.includes("i"));
  if (flags.includes("b")) out += `builtins ${debug_unit_result(bundle.add_builtins(), (e) => debug_FluentError(e, PLAIN))}\n`;
  if (flags.includes("s")) {
    const r = bundle.add_function("STREQ", (positional) => {
      const [x, y] = positional;
      if (positional.length === 2 && x!.$ === "String" && y!.$ === "String") return FluentValue.from_String(`${x!._0 === y!._0}`);
      return FluentValue.Error;
    });
    out += `streq ${debug_unit_result(r, (e) => debug_str(display_FluentError(e)))}\n`;
  }
  const added = bundle.add_resource(res);
  if (added.$ === "Err") { out += `add ${debug_vec(added._0, PLAIN, debug_FluentError)}\n`; for (const x of added._0) out += `  ${display_FluentError(x)}\n`; }
  const msg = bundle.get_message(msgid);
  if (msg === undefined) return out + "no message";
  const pat = attr === "-" ? msg.value() : msg.get_attribute(attr)?.value();
  if (pat === undefined) return out + "no pattern";
  const errs: FluentError[] = [];
  const s = bundle.format_pattern(pat, a, errs);
  out += `=> ${debug_str(s)} ${debug_vec(errs, PLAIN, debug_FluentError)}`;
  for (const e of errs) out += `\n  ${display_FluentError(e)}`;
  return out;
}

function run_file(p: string): string {
  let o = "";
  const lines = readFileSync(p, "utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  lines.forEach((line, i) => {
    if (line === "" || line.startsWith("#")) return;
    const f = line.split("\t");
    let r: string;
    try {
      r = run(f);
    } catch (e) {
      if (e instanceof Panic) r = `PANIC ${debug_str(e.message)}`;
      else r = `JSERROR ${String(e)}`;
    }
    o += `#${i + 1} ${f[0]}\n${r}\n`;
  });
  return o;
}

test("oracle snapshot", () => {
  const got = run_file(join(import.meta.dir, "testdata", "snapshot.cases")).split("\n");
  const want = readFileSync(join(import.meta.dir, "testdata", "snapshot.expected"), "utf8").split("\n");
  const i = got.findIndex((l, k) => l !== want[k]);
  expect(i === -1 ? "" : `first difference at line ${i + 1}: ${got[i]} / ${want[i]}`).toBe("");
  expect(got.length).toBe(want.length);
});
