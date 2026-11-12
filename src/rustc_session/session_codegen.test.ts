// Not upstream: the `Session` methods rustc_codegen_llvm calls (lane ssa-mir-rest): `needs_plt` (session.rs:863),
// `direct_access_external_data` (:1092), `branch_protection` (:1125), `must_emit_unwind_tables` (:1144), and
// `PointerAuthConfig::{calculate_pauth_abi_version, fn_attrs}` (:186, :301).
//
// The expectations are the oracle's (pinned nightly), read off the LLVM IR it emits for the same flags
// (`rustc +nightly --emit=llvm-ir -o - <file>`; the files are the two no_core crates below, `A` as `--crate-type lib`, `B` as
// `--crate-type bin`). How each method shows in that IR (rustc_codegen_llvm at the pin):
// - `needs_plt() == false` <=> the `RtLibUseGOT` module flag (context.rs) and `nonlazybind` on fns (declare.rs);
// - `must_emit_unwind_tables()` <=> `uwtable` on fns (attributes.rs);
// - `branch_protection()` <=> the `branch-target-enforcement` / `sign-return-address*` module flags and fn attributes
//   (`"sign-return-address-key"="a_key"|"b_key"`, `"branch-target-enforcement"`);
// - `direct_access_external_data()`: `@X = external dso_local global` of an extern static in an executable, which
//   mono_item.rs `should_assume_dso_local` decides by `direct_access_external_data().unwrap_or(relocation_model == Static)`
//   for these targets (PIC, not Darwin, not PowerPC64).
// The `PointerAuthConfig` methods have no oracle fact: the one kind of target with a config (`CfgAbi::Pauthtest`) stops
// in `build_session`. Their expectations are read off session.rs:186-320.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA } from "../../scripts/lib/common.ts";
import { oracleSysroot } from "../../scripts/lib/oracle.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { Arch, Os, type Target } from "../rustc_target/spec/mod.ts";
import { PointerAuthConfig, type PointerAuthSchema, type Session } from "./session.ts";

const A = [
  "#![feature(no_core, lang_items)]",
  "#![no_core]",
  "#![allow(internal_features)]",
  '#[lang = "pointee_sized"] pub trait PointeeSized {}',
  '#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}',
  '#[lang = "sized"] pub trait Sized: MetaSized {}',
  'unsafe extern "C" { safe fn ext(); }',
  "#[unsafe(no_mangle)] pub fn f() { ext(); }",
].join("\n");
// B (for direct_access_external_data, as `--crate-type bin`): A's lang items, `#![no_main]`, `#[lang = "copy"]` with
// `impl Copy for u8 {}`, `unsafe extern "C" { safe static X: u8; }` and `#[unsafe(no_mangle)] pub fn f() -> u8 { X }`.

class CaptureConfig extends Error {}
function config_from_args(args: string[]): Config {
  let config: Config | undefined;
  try {
    compiler_entrypoint(["rustc", ...args], {
      config(c: Config) {
        config = c;
        throw new CaptureConfig();
      },
    });
  } catch (e) {
    if (!(e instanceof CaptureConfig)) throw e;
  }
  if (config === undefined) throw new Error("ERROR: no config");
  return config;
}

/** Builds the session for `flags` and returns `f(sess)`. */
function with_sess<R>(flags: string, f: (sess: Session) => R): R {
  const file = join(DATA, "tmp", "ssa-mir-rest", "sess.rs");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, A);
  let out: { r: R } | undefined;
  const args = ["--crate-type", "lib", "--sysroot", oracleSysroot(), ...flags.split(" ").filter((s) => s !== ""), file];
  run_compiler(config_from_args(args), (compiler) => {
    out = { r: f(compiler.sess) };
  });
  if (out === undefined) throw new Error("ERROR: run_compiler did not run the callback");
  return out.r;
}

const X86 = "--target x86_64-unknown-linux-gnu";

test("Session::needs_plt (session.rs:863) against the oracle's RtLibUseGOT / nonlazybind", () => {
  const cases: [string, boolean][] = [
    // host (aarch64-apple-darwin): no RtLibUseGOT, no nonlazybind.
    ["", true],
    // `-Zplt=no` overrides: RtLibUseGOT, nonlazybind.
    ["-Zplt=no", false],
    // x86_64-unknown-linux-gnu: `plt_by_default` false and full RELRO: RtLibUseGOT, nonlazybind.
    [X86, false],
    // `-Zplt=yes` / partial RELRO: neither.
    [`${X86} -Zplt=yes`, true],
    [`${X86} -Crelro-level=partial`, true],
  ];
  expect(cases.map(([flags]) => with_sess(flags, (s) => s.needs_plt()))).toEqual(cases.map(([, v]) => v));
});

test("Session::must_emit_unwind_tables (session.rs:1144) against the oracle's uwtable", () => {
  const cases: [string, boolean][] = [
    // host: uwtable; with `-Cpanic=abort` (the target does not default to it) or `-Cforce-unwind-tables=no`, none.
    ["", true],
    ["-Cpanic=abort", false],
    ["-Cforce-unwind-tables=no", false],
    // x86_64-unknown-linux-gnu: uwtable, also with `-Cpanic=abort` (`default_uwtable`); none when forced off.
    [X86, true],
    [`${X86} -Cpanic=abort`, true],
    [`${X86} -Cpanic=abort -Cforce-unwind-tables=no`, false],
    [`${X86} -Cforce-unwind-tables=no`, false],
  ];
  expect(cases.map(([flags]) => with_sess(flags, (s) => s.must_emit_unwind_tables()))).toEqual(cases.map(([, v]) => v));
});

test("Session::branch_protection (session.rs:1125) against the oracle's branch-protection flags", () => {
  // No `-Zbranch-protection`: `None`.
  expect(with_sess("", (s) => s.branch_protection())).toBeUndefined();
  // aarch64-unknown-linux-gnu `bti,pac-ret`: "branch-target-enforcement" 1, "sign-return-address" 1, key A.
  expect(with_sess("--target aarch64-unknown-linux-gnu -Zbranch-protection=bti,pac-ret", (s) => s.branch_protection())).toEqual({
    bti: true,
    pac_ret: { leaf: false, pc: false, key: "A" },
    gcs: false,
  });
  // `pac-ret,b-key`: key B, no BTI.
  expect(with_sess("--target aarch64-unknown-linux-gnu -Zbranch-protection=pac-ret,b-key", (s) => s.branch_protection())).toEqual({
    bti: false,
    pac_ret: { leaf: false, pc: false, key: "B" },
    gcs: false,
  });
  // aarch64-pc-windows-msvc `pac-ret` (key A on the command line): the oracle signs with "b_key"
  // ("sign-return-address-with-bkey" 1). The port has no aarch64 Windows target spec yet, so the branch (:1132) is driven
  // by setting `os` to Windows on the aarch64-linux session's own target. The session's option itself keeps key A: the
  // method returns an adjusted copy.
  with_sess("--target aarch64-unknown-linux-gnu -Zbranch-protection=pac-ret", (s) => {
    expect(s.branch_protection()?.pac_ret?.key).toBe("A");
    s.target.os = Os.Windows;
    expect(s.branch_protection()).toEqual({ bti: false, pac_ret: { leaf: false, pc: false, key: "B" }, gcs: false });
    expect(s.opts.unstable_opts.branch_protection?.pac_ret?.key).toBe("A");
    // `pac-ret,b-key` stays B (and keeps its other fields).
    s.opts.unstable_opts.branch_protection = { bti: false, pac_ret: { leaf: true, pc: false, key: "B" }, gcs: false };
    expect(s.branch_protection()?.pac_ret).toEqual({ leaf: true, pc: false, key: "B" });
  });
  // Windows on another arch is not adjusted (the arch check).
  with_sess("--target aarch64-unknown-linux-gnu -Zbranch-protection=pac-ret", (s) => {
    s.target.os = Os.Windows;
    s.target.arch = Arch.X86_64;
    expect(s.branch_protection()?.pac_ret?.key).toBe("A");
  });
});

test("Session::direct_access_external_data (session.rs:1092) against the oracle's dso_local", () => {
  const cases: [string, boolean | undefined][] = [
    // x86_64 linux, PIC: no dso_local (the option is unset and the model is not static).
    [X86, undefined],
    // `-Zdirect-access-external-data=yes`: dso_local.
    [`${X86} -Zdirect-access-external-data=yes`, true],
    // static relocation model: dso_local from the model (the option is unset) ...
    [`${X86} -Crelocation-model=static`, undefined],
    // ... unless `-Zdirect-access-external-data=no`: none.
    [`${X86} -Crelocation-model=static -Zdirect-access-external-data=no`, false],
  ];
  expect(cases.map(([flags]) => with_sess(flags, (s) => s.direct_access_external_data()))).toEqual(cases.map(([, v]) => v));
  // A target spec that sets it: loongarch64-unknown-linux-gnu's says `Some(false)` (no dso_local even with a static model),
  // and `-Zdirect-access-external-data=yes` wins over it (dso_local). The port has no loongarch64 target spec yet, so the
  // x86_64 session's own target carries the spec's value.
  expect(
    with_sess(`${X86} -Crelocation-model=static`, (s) => {
      s.target.direct_access_external_data = false;
      return s.direct_access_external_data();
    }),
  ).toBe(false);
  expect(
    with_sess(`${X86} -Crelocation-model=static -Zdirect-access-external-data=yes`, (s) => {
      s.target.direct_access_external_data = false;
      return s.direct_access_external_data();
    }),
  ).toBe(true);
});

test("PointerAuthConfig::calculate_pauth_abi_version / fn_attrs (session.rs:186, :301)", () => {
  const schema: PointerAuthSchema = { is_address_discriminated: { $: "Synthetic", _0: 1n }, discrimination_kind: "None", key: "ASIA", constant_discriminator: 0xd9d4 };
  const hw = (b: boolean): PointerAuthSchema => ({ ...schema, is_address_discriminated: { $: "HardwareAddress", _0: b } });
  // `PointerAuthConfig::default` (session.rs:170): everything on but `elf_got`, both schemas present.
  const dflt: PointerAuthConfig = {
    return_addresses: true,
    auth_traps: true,
    indirect_gotos: true,
    elf_got: false,
    aarch64_jump_table_hardening: true,
    function_pointers: schema,
    init_fini: schema,
    intrinsics: true,
    typeinfo_vt_ptr_discrimination: true,
    vt_ptr_addr_discrimination: true,
    vt_ptr_type_discrimination: true,
  };
  const pauth = { cfg_abi: { $: "Pauthtest" } } as unknown as Target;
  // Bits (:197-207): INTRINSICS 0, CALLS 1, RETURNS 2, AUTHTRAPS 3, VT_PTR_ADDR_DISCR 4, VT_PTR_TYPE_DISCR 5, INIT_FINI 6,
  // INIT_FINI_ADDR_DISC 7 (a `Synthetic` or `HardwareAddress(true)` init/fini schema), GOT 8, GOTOS 9,
  // TYPEINFO_VT_PTR_DISCR 10. The default: all but GOT = 0b110_1111_1111 = 0x6ff.
  expect(PointerAuthConfig.calculate_pauth_abi_version(dflt, pauth)).toBe(0x6ff);
  // `HardwareAddress(false)` clears bit 7; `HardwareAddress(true)` keeps it; no init/fini clears 6 and 7; `elf_got` sets 8.
  expect(PointerAuthConfig.calculate_pauth_abi_version({ ...dflt, init_fini: hw(false) }, pauth)).toBe(0x67f);
  expect(PointerAuthConfig.calculate_pauth_abi_version({ ...dflt, init_fini: hw(true) }, pauth)).toBe(0x6ff);
  expect(PointerAuthConfig.calculate_pauth_abi_version({ ...dflt, init_fini: undefined, elf_got: true }, pauth)).toBe(0x73f);
  // No function-pointer schema clears CALLS; everything off is 0.
  const off: PointerAuthConfig = {
    ...dflt,
    return_addresses: false,
    auth_traps: false,
    indirect_gotos: false,
    aarch64_jump_table_hardening: false,
    function_pointers: undefined,
    init_fini: undefined,
    intrinsics: false,
    typeinfo_vt_ptr_discrimination: false,
    vt_ptr_addr_discrimination: false,
    vt_ptr_type_discrimination: false,
  };
  expect(PointerAuthConfig.calculate_pauth_abi_version({ ...dflt, function_pointers: undefined }, pauth)).toBe(0x6fd);
  expect(PointerAuthConfig.calculate_pauth_abi_version(off, pauth)).toBe(0);
  // The `assert!` on the target's `cfg_abi` (:187).
  expect(() => PointerAuthConfig.calculate_pauth_abi_version(dflt, { cfg_abi: { $: "Unspecified" } } as unknown as Target)).toThrow(
    "assertion failed: target.cfg_abi == CfgAbi::Pauthtest",
  );
  // fn_attrs (:301): in this order, each when its field is set.
  expect(PointerAuthConfig.fn_attrs(dflt)).toEqual(["aarch64-jump-table-hardening", "ptrauth-auth-traps", "ptrauth-calls", "ptrauth-indirect-gotos", "ptrauth-returns"]);
  expect(PointerAuthConfig.fn_attrs({ ...dflt, function_pointers: undefined, auth_traps: false })).toEqual(["aarch64-jump-table-hardening", "ptrauth-indirect-gotos", "ptrauth-returns"]);
  expect(PointerAuthConfig.fn_attrs(off)).toEqual([]);
});
