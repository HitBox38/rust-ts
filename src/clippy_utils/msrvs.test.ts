// `clippy_utils::msrvs` (lane clippy-contract-b2): `#[clippy::msrv]` and `rust-version` parsing, `Msrv` / `MsrvStack`,
// and `check_attrs`' errors, against the oracle clippy-driver.
//
// Fixtures (diagnostics_oracle/capture.ts, run by hand):
// - msrv.json: for 25 version strings, whether the oracle's `redundant_field_names` fires on `S { x: x }`, an early lint
//   gated on `msrvs::FIELD_INIT_SHORTHAND` (1.17.0) through `MsrvStack::meets` (redundant_field_names.rs:
//   `self.msrv.meets(msrvs::FIELD_INIT_SHORTHAND)`, the stack fed by `extract_msrv_attr!`'s `check_attributes`):
//   - `attr_fires` with `#![clippy::msrv = "<v>"]` (and `attr_errors`, check_attrs' errors for it);
//   - `env_fires` with no attribute and `CARGO_PKG_RUST_VERSION=<v>` (Cargo.toml's `rust-version`), which
//     clippy_config's `Conf::read` parses with `parse_version(Symbol::intern(&v))` into `conf.msrv`, and the lint's
//     `MsrvStack::from(conf.msrv)`;
// - msrv_attrs.stderr: the oracle's stderr on msrv_attrs.rs, check_attrs' three errors, rendered.
// Here the same inputs go through the ported `MsrvStack` / `parse_attrs` / `check_attrs` / `Msrv`.
import { beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AttributeExt as AstAttributeExt } from "../rustc_ast/attr/mod.ts";
import { type RustcVersion, display_RustcVersion } from "../rustc_ast/attr/version.ts";
import { parse_version } from "../rustc_attr_parsing/attributes/util.ts";
import type { LateContext } from "../rustc_lint/context.ts";
import { new_parser_from_source_str, unwrap_or_emit_fatal } from "../rustc_parse/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { PLAIN } from "../std/fmt.ts";
import { render_with } from "./diagnostics_oracle/harness.ts";
import * as msrvs from "./msrvs.ts";
import { Msrv, MsrvStack, check_attrs, debug_Msrv, debug_MsrvStack, parse_attrs_for_tests, reset_seen_msrv_attr_for_tests } from "./msrvs.ts";

const DIR = join(import.meta.dir, "diagnostics_oracle");
const ORACLE = JSON.parse(readFileSync(join(DIR, "msrv.json"), "utf8")) as {
  cases: { version: string; attr_fires: boolean; attr_errors: string[]; env_fires: boolean }[];
};

beforeEach(() => reset_seen_msrv_attr_for_tests());

/** `cx` for `Msrv::meets` while no `#[clippy::msrv]` was seen: `current` returns `self.0` without reading it. */
const NO_CX = undefined as unknown as LateContext;

test("#[clippy::msrv] and rust-version gate an MSRV lint as in the oracle", () => {
  expect(ORACLE.cases.length).toBe(25);
  const got: string[] = [];
  const want: string[] = [];
  render_with("msrv_attrs.rs", {
    pre(sess) {
      ORACLE.cases.forEach((c, i) => {
        // `#![clippy::msrv = "<v>"]` at the crate root: the early pass's `check_attributes(krate.attrs)`
        const src = `#![feature(custom_inner_attributes)]\n#![clippy::msrv = ${JSON.stringify(c.version)}]\n`;
        const p = unwrap_or_emit_fatal(new_parser_from_source_str(sess.psess, { $: "Custom", _0: `m${i}` }, src, "Nothing"));
        const kr = p.parse_crate_mod();
        if (kr.$ === "Err") throw new Error(`ERROR: parse ${c.version}`);
        const stack = MsrvStack.from(undefined);
        stack.check_attributes(kr._0.attrs);
        // and, as clippy runs it on the same attributes, check_attrs' errors (messages only; rendering is checked below)
        const errs: string[] = [];
        const dcx = sess.dcx();
        const before = dcx.err_count();
        check_attrs(
          {
            dcx: () => ({
              struct_span_err: (_: unknown, m: string) => (errs.push(`error: ${m}`), { with_span_note: () => ({ emit: () => undefined }) }),
              span_err: (_: unknown, m: string) => errs.push(`error: ${m}`),
            }),
          } as never,
          AstAttributeExt.Attribute,
          kr._0.attrs,
        );
        expect(dcx.err_count()).toBe(before);
        // `CARGO_PKG_RUST_VERSION=<v>`: conf.rs `parse_version(Symbol::intern(&v))`, then `MsrvStack::from(conf.msrv)`
        const cargo = parse_version(Symbol.intern(c.version));
        const env_stack = MsrvStack.from(cargo);
        const late = Msrv.from(cargo);
        reset_seen_msrv_attr_for_tests(); // the attribute above was seen; the `rust-version` runs see none
        got.push(
          `${JSON.stringify(c.version)} attr=${stack.meets(msrvs.FIELD_INIT_SHORTHAND)} ${JSON.stringify(errs)} env=${env_stack.meets(msrvs.FIELD_INIT_SHORTHAND)} late=${late.meets(NO_CX, msrvs.FIELD_INIT_SHORTHAND)}`,
        );
        want.push(`${JSON.stringify(c.version)} attr=${c.attr_fires} ${JSON.stringify(c.attr_errors)} env=${c.env_fires} late=${c.env_fires}`);
      });
    },
  });
  expect(got).toEqual(want);
});

test("check_attrs' errors render as the oracle's (msrv_attrs.rs)", () => {
  const out = render_with("msrv_attrs.rs", {
    pre(sess, krate) {
      // clippy's pre-expansion `EarlyAttributes::check_attributes` (attrs/mod.rs) on each attribute list in visiting order
      check_attrs(sess, AstAttributeExt.Attribute, krate.attrs);
      for (const item of krate.items) check_attrs(sess, AstAttributeExt.Attribute, item.attrs);
    },
  });
  expect(out).toBe(readFileSync(join(DIR, "msrv_attrs.stderr"), "utf8"));
});

test("MsrvStack: check_attributes pushes, check_attributes_post pops, meets compares", () => {
  const v = (s: string): RustcVersion => parse_version(Symbol.intern(s))!;
  render_with("msrv_attrs.rs", {
    pre(sess, krate) {
      const stack = MsrvStack.from(v("1.30"));
      expect(debug_MsrvStack(stack, PLAIN)).toBe("MsrvStack { stack: [RustcVersion { major: 1, minor: 30, patch: 0 }] }");
      expect(stack.meets(msrvs.ITERATOR_FIND_MAP)).toBe(true); // 1.30.0
      expect(stack.meets(msrvs.ITER_FLATTEN)).toBe(true); // 1.29.0
      expect(stack.meets(msrvs.OPTION_REPLACE)).toBe(false); // 1.31.0
      stack.check_attributes(krate.attrs); // `#![clippy::msrv = "1.40"]`
      expect(display_RustcVersion(stack.current()!)).toBe("1.40.0");
      const c = krate.items[2]!; // `#[clippy::msrv = "1.2.3"] #[clippy::msrv = "1.4"] #[clippy::msrv = "1.5"] fn c`
      stack.check_attributes(c.attrs); // the first one wins
      expect(display_RustcVersion(stack.current()!)).toBe("1.2.3");
      expect(stack.meets(msrvs.DURATION_FROM_MILLIS_SECS)).toBe(false); // 1.3.0
      stack.check_attributes_post(c.attrs);
      const a = krate.items[0]!; // `#[clippy::msrv = "abc"]`: not a version, nothing pushed or popped
      stack.check_attributes(a.attrs);
      stack.check_attributes_post(a.attrs);
      expect(display_RustcVersion(stack.current()!)).toBe("1.40.0");
      stack.check_attributes_post(krate.attrs);
      expect(stack.stack.length).toBe(1);
      const empty = MsrvStack.from(undefined);
      expect(empty.current()).toBeUndefined();
      expect(empty.meets(msrvs.BOX_INTO_NON_NULL)).toBe(true); // no MSRV: everything is met
      expect(parse_attrs_for_tests(AstAttributeExt.Attribute, krate.items[1]!.attrs)).toBeUndefined(); // `#[clippy::msrv]`
      expect(parse_attrs_for_tests(AstAttributeExt.Attribute, krate.items[4]!.attrs)).toBeUndefined(); // `fn main`: none
    },
  });
});

test("Msrv: from, Default, Debug, and the attribute walk up the HIR once an attribute was seen", () => {
  expect(debug_Msrv(Msrv.default(), PLAIN)).toBe("Msrv(None)");
  expect(Msrv.default().meets(NO_CX, msrvs.BOX_INTO_NON_NULL)).toBe(true);
  const got: string[] = [];
  render_with("msrv_attrs.rs", {
    pre(_sess, krate) {
      // the early pass sees the crate's `#![clippy::msrv]` (sets SEEN_MSRV_ATTR)
      MsrvStack.from(undefined).check_attributes(krate.attrs);
    },
    post(tcx) {
      for (const id of tcx.hir_free_items()) {
        const def_id = id.owner_id.def_id;
        const sym_ = tcx.opt_item_name(def_id);
        const name = sym_ === undefined ? "" : Symbol.as_str(sym_);
        if (!["a", "b", "c", "d", "main"].includes(name)) continue; // `extern crate std`, the prelude import
        const msrv = Msrv.from(parse_version(Symbol.intern("1.10")));
        const at = msrv.at(tcx, id.hir_id());
        got.push(`${name} ${at === undefined ? "None" : display_RustcVersion(at)} ${msrv.meets_at(tcx, id.hir_id(), msrvs.FIELD_INIT_SHORTHAND)}`);
      }
    },
  });
  // fn a: "abc" is not a version and fn b's attribute has no value, so the crate's 1.40 applies; fn c: the first of
  // three; fn d: "1.0-nightly" is not a version (parse_version takes no suffix); main: the crate's.
  expect(got).toEqual(["a 1.40.0 true", "b 1.40.0 true", "c 1.2.3 false", "d 1.40.0 true", "main 1.40.0 true"]);
});
