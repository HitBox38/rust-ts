// Port of the unit tests of unicode-script =0.5.7 `src/lib.rs` (`mod tests`).
import { expect, test } from "bun:test";
import { debug_ScriptExtension, NEXT_SCRIPT, Script_discriminant, Script_try_from, ScriptExtension, ScriptExtension_from_Script, script_extensions } from "./lib.ts";
import { Script_for_integer } from "./tables.ts";

// crate: unicode-script-0.5.7/src/lib.rs:417 test_conversion
test("test_conversion", () => {
  const seen_scripts = new Set<string>();
  const seen_exts = new Set<string>();
  for (let bit = 0; bit < NEXT_SCRIPT; bit++) {
    const script = Script_for_integer(bit);
    const ext = ScriptExtension_from_Script(script);
    const key = debug_ScriptExtension(ext) + `${ext.first}:${ext.second}:${ext.third}`;
    expect(seen_scripts.has(script)).toBe(false);
    expect(seen_exts.has(key)).toBe(false);
    seen_scripts.add(script);
    seen_exts.add(key);
    expect(Script_discriminant[script]).toBe(bit);
    expect(ScriptExtension.new_common().intersection(ext).is_empty()).toBe(false);
    expect(ScriptExtension.new_inherited().intersection(ext).is_empty()).toBe(false);
    expect(ScriptExtension.new_unknown().intersection(ext).is_empty()).toBe(true);
    const all = [];
    const it = ext.iter();
    for (let s = it.next(); s !== undefined; s = it.next()) all.push(s);
    expect(all).toEqual([script]);
    expect(Script_try_from(ext)).toEqual({ $: "Ok", _0: script });
  }
});

// crate: unicode-script-0.5.7/src/lib.rs:443 test_specific
test("test_specific", () => {
  const s =
    "सवव मानवी व्यद्क् जन्मतःच स्वतींत्र आहेत व त्ाींना समान प्रवतष्ठा व समान अविकार आहेत. त्ाींना ववचारशद्क् व सवविे कबुद्द्धलाभलेली आहे. व त्ाींनी एकमेकाींशी बींिुत्वाचाभावनेने आचरण करावे.";
  const ext = ScriptExtension.for_str(s);
  const se = script_extensions();
  expect(ext.eq(se.DEVA)).toBe(true);
  expect(ext.intersection(se.DEVA_DOGR_GUJR_GURU_KHOJ_KTHI_MAHJ_MODI_SIND_TAKR_TIRH).is_empty()).toBe(false);

  const u = ext.union(ScriptExtension_from_Script("Dogra"));
  expect(u.intersection(se.DEVA_DOGR_GUJR_GURU_KHOJ_KTHI_MAHJ_MODI_SIND_TAKR_TIRH).eq(u)).toBe(true);
});

// crate: unicode-script-0.5.7/src/lib.rs:471 test_specific_ext
test("test_specific_ext", () => {
  const ext = script_extensions().DEVA_DOGR_GUJR_GURU_KHOJ_KTHI_MAHJ_MODI_SIND_TAKR_TIRH;

  const all = new Set<string>();
  const it = ext.iter();
  for (let s = it.next(); s !== undefined; s = it.next()) all.add(s);

  for (let bit = 0; bit < NEXT_SCRIPT; bit++) {
    const script = Script_for_integer(bit);
    expect(ext.contains_script(script)).toBe(all.has(script));
  }

  for (const s of ["Devanagari", "Dogra", "Gujarati", "Gurmukhi", "Khojki", "Kaithi", "Mahajani", "Modi", "Khudawadi", "Takri", "Tirhuta"] as const) {
    expect(ext.contains_script(s)).toBe(true);
  }

  expect(Script_try_from(ext).$).toBe("Err");
});
