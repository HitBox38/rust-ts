// rust-ts: icu_list's and-list formatter over rustc_baked_icu_data against the oracle (the
// `listfmt` probe, built from icu_list / icu_locale_core / icu_provider =2.3.0 with a path
// dependency on the pinned upstream compiler/rustc_baked_icu_data). Every probe line is rebuilt
// from the TS port and compared:
//   U  unic_langid parse + Display of every tag (rustc's `lang.to_string()` input)
//   P  `Locale::try_from_str` (Display or `{:?}` of the error), the DataLocale the and-list
//      constructor requests, and the locale the baked provider fell back to (or the DataError)
//   F  `format_to_string` on the rustc construct path (parse error -> EN) for Wide/Short/Narrow
//   E  the constructor error (rustc's `expect` ICEs there)
// Skips if the probe isn't built (bun scripts/probes.ts build listfmt).
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import { BakedDataProvider, supported_locales } from "../../rustc_baked_icu_data/lib.ts";
import { debug_ParseError } from "../icu_locale_core/parser/errors.ts";
import { Locale } from "../icu_locale_core/locale.ts";
import { debug_DataError } from "../icu_provider/error.ts";
import { DataIdentifierBorrowed, DataRequest } from "../icu_provider/request.ts";
import { display_LanguageIdentifier, LanguageIdentifier as UnicLanguageIdentifier } from "../unic_langid/lib.ts";
import { ListFormatter, ListFormatterPreferences } from "./list_formatter.ts";
import { ListFormatterOptions, type ListLength } from "./options.ts";
import { ListAndV1, ListFormatterPatterns } from "./provider/mod.ts";

const PROBE = join(DATA, "target", "probes", "release", "listfmt" + (process.platform === "win32" ? ".exe" : ""));

function unhex(h: string): Uint8Array {
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return b;
}
function hex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}
const enc = new TextEncoder();
const dec = (h: string) => new TextDecoder("utf-8", { fatal: true }).decode(unhex(h));

test("list formatting matches the oracle", () => {
  if (!existsSync(PROBE)) {
    console.log("SKIP: listfmt probe not built (bun scripts/probes.ts build listfmt)");
    return;
  }
  const r = Bun.spawnSync([PROBE], { stdout: "pipe" });
  expect(r.exitCode).toBe(0);
  const want = r.stdout.toString().split("\n");
  if (want[want.length - 1] === "") want.pop();

  const lists: string[][] = [];
  const tags: string[] = [];
  for (const line of want) {
    const f = line.split("\t");
    if (f[0] === "L") lists[Number(f[1])] = f.slice(2).map(dec);
    if (f[0] === "U") tags.push(dec(f[1]!));
  }

  const got: string[] = [];
  lists.forEach((l, i) => got.push(["L", String(i), ...l.map((x) => hex(enc.encode(x)))].join("\t")));

  // The icu inputs: every raw tag, then every unic-langid Display not already present.
  const inputs: string[] = [];
  for (const t of tags) if (!inputs.includes(t)) inputs.push(t);
  for (const t of tags) {
    const u = UnicLanguageIdentifier.from_str(t);
    if (u.$ === "Ok") {
      const s = display_LanguageIdentifier(u._0);
      got.push(`U\t${hex(enc.encode(t))}\tOk\t${s}`);
      if (!inputs.includes(s)) inputs.push(s);
    } else {
      got.push(`U\t${hex(enc.encode(t))}\tErr`);
    }
  }

  const provider = new BakedDataProvider();
  for (const input of inputs) {
    const h = hex(enc.encode(input));
    const p = Locale.try_from_str(input);
    if (p.$ === "Ok") {
      const locale = p._0;
      const prefs = ListFormatterPreferences.from_locale(locale);
      const dl = ListAndV1.INFO.make_locale(prefs.locale_preferences);
      const resp = provider.load(ListAndV1, DataRequest(DataIdentifierBorrowed.for_marker_attributes_and_locale(ListFormatterPatterns.WIDE, dl)));
      const md = resp.$ === "Ok" ? (resp._0.metadata.locale?.to_string() ?? "-") : debug_DataError(resp._0);
      got.push(`P\t${h}\tOk\t${locale.to_string()}\t${dl.to_string()}\t${md}`);
    } else {
      got.push(`P\t${h}\tErr\t${debug_ParseError(p._0)}`);
    }
    for (const [lc, len] of [
      ["W", "Wide"],
      ["S", "Short"],
      ["N", "Narrow"],
    ] as [string, ListLength][]) {
      // rustc_error_messages::fluent_value_from_str_list_sep_by_and::MemoizableListFormatter::construct
      const q = Locale.try_from_str(input);
      const locale = q.$ === "Ok" ? q._0 : supported_locales.EN;
      const lf = ListFormatter.try_new_and_unstable(provider, ListFormatterPreferences.from_locale(locale), ListFormatterOptions.default().with_length(len));
      if (lf.$ === "Err") {
        got.push(`E\t${h}\t${lc}\t${debug_DataError(lf._0)}`);
        continue;
      }
      lists.forEach((l, i) => got.push(`F\t${h}\t${lc}\t${i}\t${hex(enc.encode(lf._0.format_to_string(l)))}`));
    }
  }

  const bad: string[] = [];
  for (let k = 0; k < Math.max(want.length, got.length) && bad.length < 8; k++) {
    if (want[k] !== got[k]) bad.push(`line ${k + 1}:\n  oracle: ${want[k]?.slice(0, 300)}\n  port:   ${got[k]?.slice(0, 300)}`);
  }
  expect(bad).toEqual([]);
  expect(got.length).toBe(want.length);
  // Coverage of the comparison itself.
  expect(want.filter((l) => l.startsWith("F\t")).length).toBeGreaterThan(40000);
  expect(want.filter((l) => l.startsWith("P\t") && l.includes("\tErr\t")).length).toBeGreaterThan(20);
});
