// Port of src/tools/miri/src/shims/extern_static.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-shims-a` (plan-m6 wave 37): ported.
//! Provides the `extern static` that this platform expects.
//
// PORT:
// - `impl MiriMachine` (associated fns, no `self`) are statics of `MiriMachine` registered with `port_methods`
//   (decision C10: `MiriMachine` is in an import cycle with this module, so it is not read at load).
// - `FxHashMap::try_insert(..).unwrap()` is `try_insert_unwrap` (its unreachable panic text stops `unported`).
import { type ImmTy, type Pointer, type StrictPointer } from "../lib.ts";
import { type MiriInterpCx, MemoryKind_from_MiriMemoryKind, MiriMachine, debug_Provenance, type Provenance } from "../machine.ts";
import { EnvVars } from "./env.ts";
import { DynSym } from "./foreign_items.ts";
import { MiriImmTy } from "../operator.ts";
import { port_methods } from "../../rust_ts/miri_stub.ts";
import { debug_Size, type Size } from "../../rustc_abi/lib.ts";
import { debug_Pointer, type InterpResult, interp_ok, Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { debug_Symbol, Symbol } from "../../rustc_span/symbol.ts";
import { debug_struct, type Debug, PLAIN } from "../../std/fmt.ts";
import { assert, panic, unported } from "../../std/panic.ts";
import { unwrap_result } from "../../std/result.ts";

declare module "../machine.gen.ts" {
  namespace MiriMachine {
    // shims/extern_static.rs:9
    export let add_extern_static: (ecx: MiriInterpCx, name: string, ptr: Pointer) => void;
    // shims/extern_static.rs:15
    export let alloc_extern_static: (ecx: MiriInterpCx, name: string, val: ImmTy) => InterpResult;
    // shims/extern_static.rs:27
    export let add_weak_symbol: (ecx: MiriInterpCx, name: string, ptr: Pointer) => InterpResult;
    // shims/extern_static.rs:42
    export let weak_fn_symbols: (ecx: MiriInterpCx, names: readonly string[]) => InterpResult;
    // shims/extern_static.rs:52
    export let init_extern_statics: (ecx: MiriInterpCx) => InterpResult;
  }
}

/** `map.try_insert(key, value).unwrap()` (`HashMap::try_insert`). PORT: unreachable (`init_extern_statics` runs once, on
 *  empty maps); the `unwrap` panic text (the `OccupiedError` Debug) is not ported (decision for miri-threads: invented
 *  `OccupiedError` texts stop `unported`). */
function try_insert_unwrap(map: Map<Symbol, StrictPointer>, key: Symbol, value: StrictPointer): void {
  if (map.has(key)) {
    unported("miri::shims::extern_static: `try_insert(..).unwrap()` panic text (Debug of OccupiedError)");
  }
  map.set(key, value);
}

/** `ptr.into_pointer_or_addr().unwrap()` (the `Err` is the address, a `Size`). */
function into_pointer_or_addr_unwrap(ptr: Pointer): StrictPointer {
  return unwrap_result(ptr.into_pointer_or_addr(), debug_Size);
}

// rustc: src/tools/miri/src/shims/extern_static.rs:9 add_extern_static
function add_extern_static(ecx: MiriInterpCx, name: string, ptr: Pointer): void {
  // This got just allocated, so there definitely is a pointer here.
  const ptr_ = into_pointer_or_addr_unwrap(ptr);
  try_insert_unwrap(ecx.machine.extern_statics, Symbol.intern(name), ptr_);
}

// rustc: src/tools/miri/src/shims/extern_static.rs:15 alloc_extern_static
function alloc_extern_static(ecx: MiriInterpCx, name: string, val: ImmTy): InterpResult {
  const place = ecx.allocate(val.layout, MemoryKind_from_MiriMemoryKind("ExternStatic"));
  if (place.$ === "Err") return place;
  const w = ecx.write_immediate(val.imm, place._0);
  if (w.$ === "Err") return w;
  MiriMachine.add_extern_static(ecx, name, place._0.ptr());
  return interp_ok(undefined);
}

/// Make `ptr` available as a weak symbol with the given name.
// rustc: src/tools/miri/src/shims/extern_static.rs:27 add_weak_symbol
function add_weak_symbol(ecx: MiriInterpCx, name: string, ptr: Pointer): InterpResult {
  // Allocate the extra indirection place and add it to the map.
  const layout = ecx.machine.layouts.unit_ptr_mut;
  const place = ecx.allocate(layout, MemoryKind_from_MiriMemoryKind("ExternStatic"));
  if (place.$ === "Err") return place;
  const w = ecx.write_scalar(Scalar.from_maybe_pointer(ptr, ecx), place._0);
  if (w.$ === "Err") return w;
  const weak_ptr = into_pointer_or_addr_unwrap(place._0.ptr());
  try_insert_unwrap(ecx.machine.extern_statics_imports, Symbol.intern(name), weak_ptr);
  return interp_ok(undefined);
}

/// Extern statics that are initialized with function pointers to the symbols of the same name.
// rustc: src/tools/miri/src/shims/extern_static.rs:42 weak_fn_symbols
function weak_fn_symbols(ecx: MiriInterpCx, names: readonly string[]): InterpResult {
  for (const name of names) {
    assert(ecx.is_dyn_sym(name), () => `${name} is not a dynamic symbol`);
    const ptr = ecx.fn_ptr({ $: "Other", _0: DynSym.from_str(name) });
    const r = MiriMachine.add_weak_symbol(ecx, name, ptr);
    if (r.$ === "Err") return r;
  }
  return interp_ok(undefined);
}

/// Sets up the "extern statics" for this machine.
// rustc: src/tools/miri/src/shims/extern_static.rs:52 init_extern_statics
function init_extern_statics(ecx: MiriInterpCx): InterpResult {
  if (ecx.target_os_is_unix()) {
    // "environ" is mandated by POSIX.
    const environ = EnvVars.unix(ecx.machine.env_vars).environ_();
    MiriMachine.add_extern_static(ecx, "environ", environ);
    // We also provide it as a weak symbol, which is needed on FreeBSD.
    const r = MiriMachine.add_weak_symbol(ecx, "environ", environ);
    if (r.$ === "Err") return r;
  }

  const os = ecx.tcx.deref().sess.target.os;
  switch (os.$) {
    case "Linux": {
      const r = MiriMachine.weak_fn_symbols(ecx, ["getrandom", "gettid", "statx", "strlen"]);
      if (r.$ === "Err") return r;
      break;
    }
    case "Android": {
      const r = MiriMachine.weak_fn_symbols(ecx, ["signal", "getrandom", "gettid", "futimens", "preadv", "pwritev"]);
      if (r.$ === "Err") return r;
      break;
    }
    case "Windows": {
      // "_tls_used"
      // This is some obscure hack that is part of the Windows TLS story. It's a `u8`.
      const val = MiriImmTy.from_int(0n, ecx.machine.layouts.u8);
      const r = MiriMachine.alloc_extern_static(ecx, "_tls_used", val);
      if (r.$ === "Err") return r;
      break;
    }
    case "Illumos":
    case "Solaris": {
      const r = MiriMachine.weak_fn_symbols(ecx, ["pthread_setname_np"]);
      if (r.$ === "Err") return r;
      break;
    }
    default:
      break; // No "extern statics" supported on this target.
  }

  // Also initialize `missing_weak_symbol`.
  const place = ecx.allocate(ecx.machine.layouts.usize, MemoryKind_from_MiriMemoryKind("ExternStatic"));
  if (place.$ === "Err") return place;
  const w = ecx.write_null(place._0);
  if (w.$ === "Err") return w;
  ecx.machine.extern_static_weak_import_default = into_pointer_or_addr_unwrap(place._0.ptr());

  return interp_ok(undefined);
}

// impl<'tcx> MiriMachine<'tcx> (shims/extern_static.rs:8)
port_methods("miri::shims::extern_static::MiriMachine", () => MiriMachine, {
  add_extern_static,
  alloc_extern_static,
  add_weak_symbol,
  weak_fn_symbols,
  init_extern_statics,
});
