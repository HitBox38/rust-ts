// Not upstream: `Session::pointer_authentication{,_functions,_init_fini}` (session.rs:1267-1277), moved here from
// rustc_codegen_ssa common.ts's stand-in (docs/reviews/ssa-contract.md N4). Read off upstream: `is_some()` of the config,
// then `cfg.function_pointers` / `cfg.init_fini` of a present config. The methods read only `pointer_auth_config`, so
// they run on an object holding just that field.
import { expect, test } from "bun:test";
import { type PointerAuthConfig, type PointerAuthSchema, Session } from "./session.ts";

const schema = (n: number): PointerAuthSchema => ({
  is_address_discriminated: { $: "Synthetic", _0: 1n },
  discrimination_kind: "None",
  key: "ASIA",
  constant_discriminator: n,
});
const config = (fp: PointerAuthSchema | undefined, init_fini: PointerAuthSchema | undefined): PointerAuthConfig => ({
  return_addresses: true,
  auth_traps: true,
  indirect_gotos: true,
  elf_got: false,
  aarch64_jump_table_hardening: true,
  function_pointers: fp,
  init_fini,
  intrinsics: true,
  typeinfo_vt_ptr_discrimination: true,
  vt_ptr_addr_discrimination: true,
  vt_ptr_type_discrimination: true,
});
const sess = (pointer_auth_config: PointerAuthConfig | undefined): Session =>
  Object.assign(Object.create(Session.prototype) as Session, { pointer_auth_config });

test("pointer_authentication accessors", () => {
  const none = sess(undefined);
  expect([none.pointer_authentication(), none.pointer_authentication_functions(), none.pointer_authentication_init_fini()]).toEqual([false, undefined, undefined]);
  const [a, b] = [schema(0), schema(0xd9d4)];
  const both = sess(config(a, b));
  expect(both.pointer_authentication()).toBe(true);
  expect(both.pointer_authentication_functions()).toBe(a);
  expect(both.pointer_authentication_init_fini()).toBe(b);
  const empty = sess(config(undefined, undefined));
  expect([empty.pointer_authentication(), empty.pointer_authentication_functions(), empty.pointer_authentication_init_fini()]).toEqual([true, undefined, undefined]);
});
