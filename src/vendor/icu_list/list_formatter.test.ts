// The and-list cases of icu_list 2.3.0's `test_spanish` / `test_basic`-style tests, run against
// rustc_baked_icu_data (upstream's tests need compiled data and the datagen feature; see the
// crate-skip markers in list_formatter.ts). The oracle test covers the full behavior.
import { expect, test } from "bun:test";
import { unwrap_result } from "../../std/result.ts";
import { BakedDataProvider } from "../../rustc_baked_icu_data/lib.ts";
import { locale } from "../icu_locale_core/locale.ts";
import { ListFormatter, ListFormatterPreferences } from "./list_formatter.ts";
import { ListFormatterOptions } from "./options.ts";

function and(tag: string): ListFormatter {
  return unwrap_result(ListFormatter.try_new_and_unstable(new BakedDataProvider(), ListFormatterPreferences.from_locale(locale(tag)), ListFormatterOptions.default()));
}

test("spanish and-lists (special case e before i/hi)", () => {
  const f = and("es");
  expect(f.format_to_string(["x", "Mallorca"])).toBe("x y Mallorca");
  expect(f.format_to_string(["x", "Ibiza"])).toBe("x e Ibiza");
  expect(f.format_to_string(["x", "Hidalgo"])).toBe("x e Hidalgo");
  expect(f.format_to_string(["x", "Hierva"])).toBe("x y Hierva");
  expect(f.format_to_string(["España", "Suiza", "Italia"])).toBe("España, Suiza e Italia");
  expect(and("es-AR").format_to_string(["x", "Ibiza"])).toBe("x e Ibiza");
});

test("english and-lists", () => {
  const f = and("en");
  expect(f.format_to_string([])).toBe("");
  expect(f.format_to_string(["a"])).toBe("a");
  expect(f.format_to_string(["a", "b"])).toBe("a and b");
  expect(f.format_to_string(["a", "b", "c"])).toBe("a, b, and c");
  expect(f.format_to_string(["a", "b", "c", "d"])).toBe("a, b, c, and d");
  expect(and("en-US").format_to_string(["a", "b", "c"])).toBe("a, b, and c");
});
