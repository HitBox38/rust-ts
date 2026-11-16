// Port of the `#[test]`s of src/tools/rustfmt/src/config/options.rs (lane rustfmt-contract-1), plus checks of the hand
// impls that have no upstream test (marked "not upstream").
import { expect, test } from "bun:test";
import { install_serde_stubs } from "./serde_stubs.test_support.ts";

install_serde_stubs();
const { StyleEdition, WidthHeuristics, Density, IgnoreList, default_IgnoreList, display_IgnoreList, display_WidthHeuristics } = await import("./mod.ts");

// rustc: src/tools/rustfmt/src/config/options.rs:747 style_edition_comparisons
test("style_edition_comparisons", () => {
  const eq = (a: string, b: string) => a === b;
  const { lt, gt } = StyleEdition;
  // Style Edition 2015
  expect(eq("Edition2015", "Edition2015")).toBe(true);
  expect(lt("Edition2015", "Edition2018")).toBe(true);
  expect(lt("Edition2015", "Edition2021")).toBe(true);
  expect(lt("Edition2015", "Edition2024")).toBe(true);
  expect(lt("Edition2015", "Edition2027")).toBe(true);

  // Style Edition 2018
  expect(gt("Edition2018", "Edition2015")).toBe(true);
  expect(eq("Edition2018", "Edition2018")).toBe(true);
  expect(lt("Edition2018", "Edition2021")).toBe(true);
  expect(lt("Edition2018", "Edition2024")).toBe(true);
  expect(lt("Edition2018", "Edition2027")).toBe(true);

  // Style Edition 2021
  expect(gt("Edition2021", "Edition2015")).toBe(true);
  expect(gt("Edition2021", "Edition2018")).toBe(true);
  expect(eq("Edition2021", "Edition2021")).toBe(true);
  expect(lt("Edition2021", "Edition2024")).toBe(true);
  expect(lt("Edition2021", "Edition2027")).toBe(true);

  // Style Edition 2024
  expect(gt("Edition2024", "Edition2015")).toBe(true);
  expect(gt("Edition2024", "Edition2018")).toBe(true);
  expect(gt("Edition2024", "Edition2021")).toBe(true);
  expect(eq("Edition2024", "Edition2024")).toBe(true);
  expect(lt("Edition2024", "Edition2027")).toBe(true);

  // Style Edition 2024
  expect(gt("Edition2027", "Edition2015")).toBe(true);
  expect(gt("Edition2027", "Edition2018")).toBe(true);
  expect(gt("Edition2027", "Edition2021")).toBe(true);
  expect(gt("Edition2027", "Edition2024")).toBe(true);
  expect(eq("Edition2027", "Edition2027")).toBe(true);
});

test("not upstream: WidthHeuristics::scaled in f32 (options.rs:329)", () => {
  // max_width 100 and below: the defaults (config/mod.rs test_default_sets_correct_widths)
  expect(display_WidthHeuristics(WidthHeuristics.scaled(100))).toBe(
    "WidthHeuristics { fn_call_width: 60, attr_fn_like_width: 70, struct_lit_width: 18, struct_variant_width: 35, array_width: 60, chain_width: 60, single_line_if_else_max_width: 50, single_line_let_else_max_width: 50 }",
  );
  // 120 / 100 = 1.2 (f32 1.2000000476837158): 18 * 1.2 = 21.6 → 22; 35 * 1.2 = 42.0 → 42
  const w = WidthHeuristics.scaled(120);
  expect([w.fn_call_width, w.attr_fn_like_width, w.struct_lit_width, w.struct_variant_width]).toEqual([72, 84, 22, 42]);
  // 125 / 100 = 1.25 → round(12.5) / 10 = 1.3 (f32::round: half away from zero)
  expect(WidthHeuristics.scaled(125).fn_call_width).toBe(78);
  expect(display_WidthHeuristics(WidthHeuristics.set(7))).toContain("chain_width: 7");
});

test("not upstream: Density::to_list_tactic, IgnoreList (options.rs:124, :375, :455)", () => {
  expect(Density.to_list_tactic("Vertical", "Edition2024", 1)).toEqual({ $: "Horizontal" });
  expect(Density.to_list_tactic("Vertical", "Edition2027", 1)).toEqual({ $: "HorizontalVertical" });
  expect(Density.to_list_tactic("Vertical", "Edition2015", 2)).toEqual({ $: "Vertical" });
  const l = default_IgnoreList();
  expect(display_IgnoreList(l)).toBe("[]");
  l.add_prefix("/a");
  expect(l.rustfmt_toml_path_()).toBe("/a");
  expect(IgnoreList.from_str("x")).toEqual({ $: "Err", _0: "IgnoreList is not parsable" });
});
