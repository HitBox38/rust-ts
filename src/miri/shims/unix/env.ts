// Fill lane: `miri-shims-c` (plan-m6 wave 37): ported by this lane.
// Port of src/tools/miri/src/shims/unix/env.rs (crate `miri`, plan-m6 D2). Its types are generated into env.gen.ts
// (tools/codegen set `miri`); this module re-exports them.
//
// PORT:
// - `trait EvalContextExt` (impl for `MiriInterpCx`) is a `declare module` augmentation of `InterpCx` (decision C2).
// - `OsStr` / `OsString` are `string` (the os_str.rs contract); `&[u8]` C strings are `Uint8Array`.
// - `UnixEnvVars.map` is an `FxHashMap<OsString, Pointer>` (rust_ts/hash_map.ts, hashbrown order): `update_environ` and
//   `new` lay out the `environ` block in its iteration order, which the program can observe. `OsString`'s `Hash` is
//   `OsStr::as_encoded_bytes().hash()` = `[u8]::hash` (`write_length_prefix(len)` + `write(bytes)`), not `str`'s:
//   `OsString_key` below.
// - `std::env::current_dir` / `set_current_dir` (isolation off only) are host stand-ins (`process.cwd()` /
//   `process.chdir`, plan-m6 D14).
// - `env!("CARGO_PKG_VERSION")` is Miri's crate version at the pin (src/tools/miri/Cargo.toml: `0.1.0`).
import { type OpTy, type Pointer, type Scalar } from "../../lib.ts";
import { MemoryKind_from_MiriMemoryKind, type MiriInterpCx } from "../../machine.ts";
import { HOSTNAME } from "./mod.ts";
import { UnixEnvVars } from "./env.gen.ts";
import { EnvVars } from "../env.ts";
import { IoError_from_ErrorKind } from "../io_error.ts";
import { os_str_as_encoded_bytes } from "../os_str.ts";
import { type VisitWith } from "../../provenance_gc.ts";
import { FxHashMap, type KeyType } from "../../../rust_ts/hash_map.ts";
import { FieldIdx, Size } from "../../../rustc_abi/lib.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import {
  CheckInAllocMsg,
  InterpErrorInfo_from_InterpErrorKind,
  type InterpResult,
  interp_ok,
  Pointer as interp_Pointer,
  Scalar as interp_Scalar,
} from "../../../rustc_middle/mir/interpret/mod.ts";
import { Ty } from "../../../rustc_middle/ty/mod.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { spec } from "../../../rustc_target/lib.ts";
import { Arch, type Os } from "../../../rustc_target/spec/mod.ts";
import { type ErrorKind, io_error_from_node, type IoError as io_Error } from "../../../std/io.ts";
import { assert, unported, unreachable } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
export * from "./env.gen.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/unix/env.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/unix/env.rs:129
    getenv(this: MiriInterpCx, name_op: OpTy): InterpResult<Pointer>;
    // shims/unix/env.rs:140
    setenv(this: MiriInterpCx, name_op: OpTy, value_op: OpTy): InterpResult<Scalar>;
    // shims/unix/env.rs:172
    unsetenv(this: MiriInterpCx, name_op: OpTy): InterpResult<Scalar>;
    // shims/unix/env.rs:196
    getcwd(this: MiriInterpCx, buf_op: OpTy, size_op: OpTy): InterpResult<Pointer>;
    // shims/unix/env.rs:223
    gethostname(this: MiriInterpCx, name_op: OpTy, len_op: OpTy): InterpResult<Scalar>;
    // shims/unix/env.rs:298
    chdir(this: MiriInterpCx, path_op: OpTy): InterpResult<Scalar>;
    // shims/unix/env.rs:314
    update_environ(this: MiriInterpCx): InterpResult;
    // shims/unix/env.rs:329
    getpid(this: MiriInterpCx): InterpResult<Scalar>;
    // shims/unix/env.rs:342
    unix_gettid(this: MiriInterpCx, link_name: string): InterpResult<Scalar>;
    // shims/unix/env.rs:352
    uname(this: MiriInterpCx, uname: OpTy, fields_size: OpTy | undefined): InterpResult<Scalar>;
    // shims/unix/env.rs:402
    apple_pthread_threadid_np(this: MiriInterpCx, thread_op: OpTy, tid_op: OpTy): InterpResult<Scalar>;
  }
}

declare module "./env.gen.ts" {
  interface UnixEnvVars {
    // shims/unix/env.rs:24 (`impl VisitProvenance for UnixEnvVars`)
    visit_provenance(visit: VisitWith): void;
    // shims/unix/env.rs:55 // PORT: `environ_` (a field `environ` exists; mir-contract rule)
    environ_(): Pointer;
    // shims/unix/env.rs:59
    get_ptr(ecx: MiriInterpCx, name: string): InterpResult<Pointer | undefined>;
    // shims/unix/env.rs:80
    get(ecx: MiriInterpCx, name: string): InterpResult<string | undefined>;
  }
  namespace UnixEnvVars {
    // shims/unix/env.rs:35
    function new_(ecx: MiriInterpCx, env_vars: Map<string, string>): InterpResult<UnixEnvVars>;
    export { new_ as new };
  }
}

/** `throw_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`) */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}
/** `throw_ub_format!(..)` (`err_ub!(Ub(format!(..)))`) */
function throw_ub_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "Ub", _0: msg } }));
}

const utf8 = new TextEncoder();

/** `Hash for OsString` (= `OsStr::as_encoded_bytes().hash(state)`, i.e. `[u8]`'s `Hash`); `size_of::<OsString>()` = 24. */
export const OsString_key: KeyType<string> = {
  hash: (k, state) => {
    const bytes = os_str_as_encoded_bytes(k);
    state.write_length_prefix(bytes.length);
    state.write(bytes);
  },
  size: 24,
  align: 8,
};
/** `size_of::<Pointer>()` (`Pointer<Option<Provenance>>`: `Option<Provenance>` 24 + `Size` 8). PORT: hashbrown only reads
 * this for its minimum bucket count, which is the same for every element size above 3 bytes. */
const LAYOUT_POINTER = { size: 32, align: 8 };

/** `EnvVars::unix()` / `unix_mut()` (shims/env.rs:64 / :71; module header). */
// impl VisitProvenance for UnixEnvVars<'_>
// rustc: src/tools/miri/src/shims/unix/env.rs:24 visit_provenance
UnixEnvVars.prototype.visit_provenance = function (this: UnixEnvVars, visit: VisitWith): void {
  const { map, environ } = this;

  // `environ.visit_provenance(visit)` (MPlaceTy: its pointer's provenance)
  visit_pointer(environ.ptr(), visit);
  for (const ptr of map.values()) {
    visit_pointer(ptr, visit);
  }
};

/** `VisitProvenance for Pointer` (provenance_gc.rs:120): a `Concrete` provenance visits its alloc id and tag. */
function visit_pointer(ptr: Pointer, visit: VisitWith): void {
  const prov = ptr.provenance;
  if (prov !== undefined && prov.$ === "Concrete") {
    visit(prov.alloc_id, prov.tag);
  }
}

// rustc: src/tools/miri/src/shims/unix/env.rs:35 new
(UnixEnvVars as unknown as { new: (ecx: MiriInterpCx, env_vars: Map<string, string>) => InterpResult<UnixEnvVars> }).new = function (
  ecx: MiriInterpCx,
  env_vars: Map<string, string>,
): InterpResult<UnixEnvVars> {
  // Allocate memory for all these env vars.
  const env_vars_machine = FxHashMap.default<string, Pointer>(OsString_key, LAYOUT_POINTER);
  for (const [name, val] of env_vars) {
    const ptr = alloc_env_var(ecx, name, val);
    if (ptr.$ === "Err") return ptr;
    env_vars_machine.set(name, ptr._0);
  }

  // This is memory backing an extern static, hence `ExternStatic`, not `Env`.
  const layout = ecx.machine.layouts.unit_ptr_mut;
  const environ = ecx.allocate(layout, MemoryKind_from_MiriMemoryKind("ExternStatic"));
  if (environ.$ === "Err") return environ;
  const environ_block = alloc_environ_block(ecx, Array.from(env_vars_machine.values()));
  if (environ_block.$ === "Err") return environ_block;
  const w = ecx.write_pointer(environ_block._0, environ._0);
  if (w.$ === "Err") return w;

  return interp_ok(new UnixEnvVars(env_vars_machine, environ._0));
};

// rustc: src/tools/miri/src/shims/unix/env.rs:55 environ
UnixEnvVars.prototype.environ_ = function (this: UnixEnvVars): Pointer {
  return this.environ.ptr();
};

// rustc: src/tools/miri/src/shims/unix/env.rs:59 get_ptr
UnixEnvVars.prototype.get_ptr = function (this: UnixEnvVars, ecx: MiriInterpCx, name: string): InterpResult<Pointer | undefined> {
  // We don't care about the value as we have the `map` to keep track of everything,
  // but we do want to do this read so it shows up as a data race.
  const _vars_ptr = ecx.read_pointer(this.environ);
  if (_vars_ptr.$ === "Err") return _vars_ptr;
  const var_ptr = this.map.get(name);
  if (var_ptr === undefined) {
    return interp_ok(undefined);
  }
  // The offset is used to strip the "{name}=" part of the string.
  const var_ptr_ = var_ptr.wrapping_offset(Size.from_bytes(BigInt(utf8.encode(name).length) + 1n), ecx);
  return interp_ok(var_ptr_);
};

/// Implementation detail for [`InterpCx::get_env_var`]. This basically does `getenv`, complete
/// with the reads of the environment, but returns an [`OsString`] instead of a pointer.
// rustc: src/tools/miri/src/shims/unix/env.rs:80 get
UnixEnvVars.prototype.get = function (this: UnixEnvVars, ecx: MiriInterpCx, name: string): InterpResult<string | undefined> {
  const var_ptr = this.get_ptr(ecx, name);
  if (var_ptr.$ === "Err") return var_ptr;
  if (var_ptr._0 !== undefined) {
    const var_ = ecx.read_os_str_from_c_str(var_ptr._0);
    if (var_.$ === "Err") return var_;
    return interp_ok(var_._0);
  } else {
    return interp_ok(undefined);
  }
};

// rustc: src/tools/miri/src/shims/unix/env.rs:95 alloc_env_var
function alloc_env_var(ecx: MiriInterpCx, name: string, value: string): InterpResult<Pointer> {
  let name_osstring = name;
  name_osstring += "=";
  name_osstring += value;
  return ecx.alloc_os_str_as_c_str(name_osstring, MemoryKind_from_MiriMemoryKind("Machine"));
}

/// Allocates an `environ` block with the given list of pointers.
// rustc: src/tools/miri/src/shims/unix/env.rs:107 alloc_environ_block
function alloc_environ_block(ecx: MiriInterpCx, vars: Pointer[]): InterpResult<Pointer> {
  // Add trailing null.
  vars.push(interp_Pointer.null());
  // Make an array with all these pointers inside Miri.
  const vars_layout = ecx.layout_of(Ty.new_array(ecx.tcx.deref(), ecx.machine.layouts.unit_ptr_mut.ty, vars.length));
  if (vars_layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(vars_layout._0));
  const vars_place = ecx.allocate(vars_layout._0, MemoryKind_from_MiriMemoryKind("Machine"));
  if (vars_place.$ === "Err") return vars_place;
  for (let idx = 0; idx < vars.length; idx++) {
    const place = ecx.project_field(vars_place._0, FieldIdx.from_usize(idx));
    if (place.$ === "Err") return place;
    const w = ecx.write_pointer(vars[idx]!, place._0);
    if (w.$ === "Err") return w;
  }
  return interp_ok(vars_place._0.ptr());
}

// rustc: src/tools/miri/src/shims/unix/env.rs:129 getenv
InterpCx.prototype.getenv = function (this: MiriInterpCx, name_op: OpTy): InterpResult<Pointer> {
  const this_ = this.eval_context_mut();
  this_.assert_target_os_is_unix("getenv");

  const name_ptr = this_.read_pointer(name_op);
  if (name_ptr.$ === "Err") return name_ptr;
  const name = this_.read_os_str_from_c_str(name_ptr._0);
  if (name.$ === "Err") return name;

  const var_ptr = EnvVars.unix(this_.machine.env_vars).get_ptr(this_, name._0);
  if (var_ptr.$ === "Err") return var_ptr;
  return interp_ok(var_ptr._0 ?? interp_Pointer.null());
};

// rustc: src/tools/miri/src/shims/unix/env.rs:140 setenv
InterpCx.prototype.setenv = function (this: MiriInterpCx, name_op: OpTy, value_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();
  this_.assert_target_os_is_unix("setenv");

  const name_ptr = this_.read_pointer(name_op);
  if (name_ptr.$ === "Err") return name_ptr;
  const value_ptr = this_.read_pointer(value_op);
  if (value_ptr.$ === "Err") return value_ptr;

  let new_: [string, string] | undefined = undefined;
  const is_null = this_.ptr_is_null(name_ptr._0);
  if (is_null.$ === "Err") return is_null;
  if (!is_null._0) {
    const name = this_.read_os_str_from_c_str(name_ptr._0);
    if (name.$ === "Err") return name;
    // PORT: `to_string_lossy().contains('=')`: a lossy decode keeps every `=` byte.
    if (name._0.length !== 0 && !name._0.includes("=")) {
      const value = this_.read_os_str_from_c_str(value_ptr._0);
      if (value.$ === "Err") return value;
      new_ = [name._0, value._0];
    }
  }
  if (new_ !== undefined) {
    const [name, value] = new_;
    const var_ptr = alloc_env_var(this_, name, value);
    if (var_ptr.$ === "Err") return var_ptr;
    const map = EnvVars.unix_mut(this_.machine.env_vars).map;
    // `map.insert(name, var_ptr)` returns the old value
    const old = map.get(name);
    map.set(name, var_ptr._0);
    if (old !== undefined) {
      const r = this_.deallocate_ptr(old, undefined, MemoryKind_from_MiriMemoryKind("Machine"));
      if (r.$ === "Err") return r;
    }
    const r = this_.update_environ();
    if (r.$ === "Err") return r;
    return interp_ok(interp_Scalar.from_i32(0)); // return zero on success
  } else {
    // name argument is a null pointer, points to an empty string, or points to a string containing an '=' character.
    return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "EINVAL" });
  }
};

// rustc: src/tools/miri/src/shims/unix/env.rs:172 unsetenv
InterpCx.prototype.unsetenv = function (this: MiriInterpCx, name_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();
  this_.assert_target_os_is_unix("unsetenv");

  const name_ptr = this_.read_pointer(name_op);
  if (name_ptr.$ === "Err") return name_ptr;
  // PORT: `Option<Option<Pointer>>` → `{ old } | undefined`.
  let success: { old: Pointer | undefined } | undefined = undefined;
  const is_null = this_.ptr_is_null(name_ptr._0);
  if (is_null.$ === "Err") return is_null;
  if (!is_null._0) {
    const name = this_.read_os_str_from_c_str(name_ptr._0);
    if (name.$ === "Err") return name;
    if (name._0.length !== 0 && !name._0.includes("=")) {
      const map = EnvVars.unix_mut(this_.machine.env_vars).map;
      const old = map.get(name._0);
      map.delete(name._0);
      success = { old };
    }
  }
  if (success !== undefined) {
    const old = success.old;
    if (old !== undefined) {
      const r = this_.deallocate_ptr(old, undefined, MemoryKind_from_MiriMemoryKind("Machine"));
      if (r.$ === "Err") return r;
    }
    const r = this_.update_environ();
    if (r.$ === "Err") return r;
    return interp_ok(interp_Scalar.from_i32(0));
  } else {
    // name argument is a null pointer, points to an empty string, or points to a string containing an '=' character.
    return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "EINVAL" });
  }
};

/**
 * `std::env::current_dir()` (D14 host stand-in). PORT: `process.cwd()` is a decoded string, so a directory name that is not UTF-8
 * would come out lossy, and unlike `environ` it is not escaped (os_str.ts header). APFS refuses such a name, so on the root host it
 * cannot arise; on Linux it could.
 */
function current_dir(): Result<string, io_Error> {
  try {
    return Ok(process.cwd());
  } catch (e) {
    return Err(io_error_from_node(e));
  }
}

/** `std::env::set_current_dir(path)` (D14 host stand-in). */
function set_current_dir(path: string): Result<null, io_Error> {
  try {
    process.chdir(path);
    return Ok(null);
  } catch (e) {
    return Err(io_error_from_node(e));
  }
}

// rustc: src/tools/miri/src/shims/unix/env.rs:196 getcwd
InterpCx.prototype.getcwd = function (this: MiriInterpCx, buf_op: OpTy, size_op: OpTy): InterpResult<Pointer> {
  const this_ = this.eval_context_mut();
  this_.assert_target_os_is_unix("getcwd");

  const buf = this_.read_pointer(buf_op);
  if (buf.$ === "Err") return buf;
  const size = this_.read_target_usize(size_op);
  if (size.$ === "Err") return size;

  const isolated_op = this_.machine.isolated_op;
  if (isolated_op.$ === "Reject") {
    const reject_with = isolated_op._0;
    const r1 = this_.reject_in_isolation("`getcwd`", reject_with);
    if (r1.$ === "Err") return r1;
    const r2 = this_.set_last_error(IoError_from_ErrorKind("PermissionDenied"));
    if (r2.$ === "Err") return r2;
    return interp_ok(interp_Pointer.null());
  }

  // If we cannot get the current directory, we return null
  const cwd = current_dir();
  if (cwd.$ === "Ok") {
    const w = this_.write_path_to_c_str(cwd._0, buf._0, size._0);
    if (w.$ === "Err") return w;
    if (w._0[0]) {
      return interp_ok(buf._0);
    }
    const r = this_.set_last_error({ $: "LibcError", _0: "ERANGE" });
    if (r.$ === "Err") return r;
  } else {
    const r = this_.set_last_error({ $: "HostError", _0: cwd._0 });
    if (r.$ === "Err") return r;
  }

  return interp_ok(interp_Pointer.null());
};

// rustc: src/tools/miri/src/shims/unix/env.rs:223 gethostname
InterpCx.prototype.gethostname = function (this: MiriInterpCx, name_op: OpTy, len_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();
  this_.assert_target_os_is_unix("gethostname");

  const name_r = this_.read_pointer(name_op);
  if (name_r.$ === "Err") return name_r;
  const name = name_r._0;
  const len_r = this_.read_target_usize(len_op);
  if (len_r.$ === "Err") return len_r;
  const len = len_r._0;

  // macOS makes a length of zero UB by writing to `name[namelen - 1]`:
  // <https://github.com/apple-oss-distributions/Libc/blob/main/gen/FreeBSD/gethostname.c#L48-L60>
  //
  // Since POSIX does not clearly specify whether a zero length is valid, require the length
  // argument to be non-zero on every platform. This cannot be folded into the access check
  // below: `check_ptr_access` delegates to `check_and_deref_ptr`, which treats every
  // zero-sized access as valid and returns before checking `name`. In particular, it would
  // accept a null pointer here.
  if (len === 0n) {
    return throw_ub_format("`gethostname` called with a length of zero");
  }
  // The caller promises that `name` points to an array of `len` bytes, so validate that
  // entire range up front. Since `len` is non-zero, this also rejects null and dangling
  // pointers.
  {
    const r = this_.check_ptr_access(name, Size.from_bytes(len), CheckInAllocMsg.MemoryAccess);
    if (r.$ === "Err") return r;
  }

  if (len > BigInt(HOSTNAME.length)) {
    const w = this_.write_c_str(HOSTNAME, name, len);
    if (w.$ === "Err") return w;
    const [written, _] = w._0;
    assert(written, "assertion failed: written"); // Value should fit.
    return interp_ok(interp_Scalar.from_i32(0));
  }

  // The exact behavior on a too short buffer differs by platform and even libc.
  // POSIX says:
  // > The returned name shall be null-terminated, except that if namelen is
  // > an insufficient length to hold the host name, then the returned name
  // > shall be truncated and it is unspecified whether the returned name is
  // > null-terminated.
  const target = this_.tcx.deref().sess.target;
  const os = target.os.$;
  if (os === "Android") {
    // Android violates POSIX and does not write anything:
    // <https://raw.githubusercontent.com/aosp-mirror/platform_bionic/master/libc/bionic/gethostname.cpp>
    return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "ENAMETOOLONG" });
  } else if ((os === "Linux" && target.env.$ === "Gnu") || os === "FreeBsd") {
    // Write what we can *without* trailing null.
    const len_ = Number(len);
    const w = this_.write_bytes_ptr(name, HOSTNAME.subarray(0, len_).values());
    if (w.$ === "Err") return w;
    return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "ENAMETOOLONG" });
  } else if (os === "Linux" || os === "MacOs" || os === "Solaris" || os === "Illumos") {
    // Write what we can *with* trailing null.
    const len_ = Number(len);
    const copy_len = len_ - 1;
    const bytes = new Uint8Array(copy_len + 1);
    bytes.set(HOSTNAME.subarray(0, copy_len));
    const w = this_.write_bytes_ptr(name, bytes.values());
    if (w.$ === "Err") return w;

    // These implementations report truncation as successful. POSIX requires
    // truncation when `namelen` is insufficient, but does not require it
    // to be reported as an error.
    // musl: <https://git.musl-libc.org/cgit/musl/tree/src/unistd/gethostname.c>
    // macOS: <https://github.com/apple-oss-distributions/Libc/blob/main/gen/FreeBSD/gethostname.c>
    // Illumos: <https://github.com/illumos/illumos-gate/blob/master/usr/src/lib/libc/port/gen/gethostname.c>
    // Solaris: <https://docs.oracle.com/cd/E88353_01/html/E37843/gethostname-3c.html>
    return interp_ok(interp_Scalar.from_i32(0));
  } else {
    return throw_unsup_format(`\`gethostname\` is not supported on ${spec.Os.display(target.os)}`);
  }
};

// rustc: src/tools/miri/src/shims/unix/env.rs:298 chdir
InterpCx.prototype.chdir = function (this: MiriInterpCx, path_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();
  this_.assert_target_os_is_unix("chdir");

  const path_ptr = this_.read_pointer(path_op);
  if (path_ptr.$ === "Err") return path_ptr;
  const path = this_.read_path_from_c_str(path_ptr._0);
  if (path.$ === "Err") return path;

  const isolated_op = this_.machine.isolated_op;
  if (isolated_op.$ === "Reject") {
    const reject_with = isolated_op._0;
    const r = this_.reject_in_isolation("`chdir`", reject_with);
    if (r.$ === "Err") return r;
    return this_.set_errno_and_return_neg1_i32(IoError_from_ErrorKind("PermissionDenied"));
  }

  const result = set_current_dir(path._0);
  const mapped: Result<number, io_Error> = result.$ === "Ok" ? Ok(0) : result;
  const v = this_.try_unwrap_io_result(mapped, (v: number) => v);
  if (v.$ === "Err") return v;
  return interp_ok(interp_Scalar.from_i32(v._0));
};

/// Updates the `environ` static.
// rustc: src/tools/miri/src/shims/unix/env.rs:314 update_environ
InterpCx.prototype.update_environ = function (this: MiriInterpCx): InterpResult {
  const this_ = this.eval_context_mut();
  // Deallocate the old environ list.
  const environ = EnvVars.unix(this_.machine.env_vars).environ;
  const old_vars_ptr = this_.read_pointer(environ);
  if (old_vars_ptr.$ === "Err") return old_vars_ptr;
  {
    const r = this_.deallocate_ptr(old_vars_ptr._0, undefined, MemoryKind_from_MiriMemoryKind("Machine"));
    if (r.$ === "Err") return r;
  }

  // Write the new list.
  const vals = Array.from(EnvVars.unix(this_.machine.env_vars).map.values());
  const environ_block = alloc_environ_block(this_, vals);
  if (environ_block.$ === "Err") return environ_block;
  const w = this_.write_pointer(environ_block._0, environ);
  if (w.$ === "Err") return w;

  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/unix/env.rs:329 getpid
InterpCx.prototype.getpid = function (this: MiriInterpCx): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();
  this_.assert_target_os_is_unix("getpid");

  // The reason we need to do this wacky of a conversion is because
  // `libc::getpid` returns an i32, however, `std::process::id()` return an u32.
  // So we un-do the conversion that stdlib does and turn it back into an i32.
  // In `Scalar` representation, these are the same, so we don't need to anything else.
  return interp_ok(interp_Scalar.from_u32(this_.get_pid()));
};

/// The `gettid`-like function for Unix platforms that take no parameters and return a 32-bit
/// integer. It is not always named "gettid".
// rustc: src/tools/miri/src/shims/unix/env.rs:342 unix_gettid
InterpCx.prototype.unix_gettid = function (this: MiriInterpCx, link_name: string): InterpResult<Scalar> {
  const this_ = this.eval_context_ref();
  this_.assert_target_os_is_unix(link_name);

  // For most platforms the return type is an `i32`, but some are unsigned. The TID
  // will always be positive so we don't need to differentiate.
  return interp_ok(interp_Scalar.from_u32(this_.get_tid(this_.active_thread())));
};

/** `env!("CARGO_PKG_VERSION")` of the miri crate at the pin (module header). */
const CARGO_PKG_VERSION = "0.1.0";

/// `fields_size`, if present, says how large each field of the struct is.
// rustc: src/tools/miri/src/shims/unix/env.rs:352 uname
InterpCx.prototype.uname = function (this: MiriInterpCx, uname: OpTy, fields_size: OpTy | undefined): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();
  this_.assert_target_os_is_unix("uname");

  const uname_ptr = this_.read_pointer(uname);
  if (uname_ptr.$ === "Err") return uname_ptr;
  let fields_size_: number | undefined;
  if (fields_size === undefined) {
    fields_size_ = undefined;
  } else {
    const s = this_.read_scalar(fields_size);
    if (s.$ === "Err") return s;
    const i = interp_Scalar.to_i32(s._0);
    if (i.$ === "Err") return i;
    fields_size_ = i._0;
  }

  const is_null = this_.ptr_is_null(uname_ptr._0);
  if (is_null.$ === "Err") return is_null;
  if (is_null._0) {
    return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "EFAULT" });
  }

  const uname_place = this_.deref_pointer_as(uname, this_.libc_ty_layout("utsname"));
  if (uname_place.$ === "Err") return uname_place;
  const target = this_.machine.tcx.sess.target;
  const arch = Arch.desc_symbol(target.arch);
  // Values required by POSIX.
  const values: [string, string][] = [
    ["sysname", "Miri"],
    ["nodename", "Miri"],
    ["release", CARGO_PKG_VERSION],
    ["version", `Miri ${CARGO_PKG_VERSION}`],
    ["machine", Symbol.as_str(arch)],
  ];
  if (target.os.$ === "Linux" || target.os.$ === "Android") {
    values.push(["domainname", "(none)"]);
  }

  for (const [name, value] of values) {
    const field = this_.project_field_named(uname_place._0, name);
    if (field.$ === "Err") return field;
    const size = field._0.layout.size.bytes_u64();
    if (fields_size_ !== undefined && !(fields_size_ >= 0 && BigInt(fields_size_) === size)) {
      return throw_unsup_format("the fields size passed to `uname` does not match the type in the libc crate");
    }
    const w = this_.write_c_str(utf8.encode(value), field._0.ptr(), size);
    if (w.$ === "Err") return w;
    const [written, _] = w._0;
    assert(written, "assertion failed: written"); // All values should fit.
  }
  return interp_ok(interp_Scalar.from_i32(0));
};

/// The Apple-specific `int pthread_threadid_np(pthread_t thread, uint64_t *thread_id)`, which
/// allows querying the ID for arbitrary threads, identified by their pthread_t.
///
/// API documentation: <https://www.manpagez.com/man/3/pthread_threadid_np/>.
// rustc: src/tools/miri/src/shims/unix/env.rs:402 apple_pthread_threadid_np
InterpCx.prototype.apple_pthread_threadid_np = function (this: MiriInterpCx, thread_op: OpTy, tid_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();
  this_.assert_target_os(MAC_OS, "pthread_threadip_np");

  const tid_dest = this_.read_pointer(tid_op);
  if (tid_dest.$ === "Err") return tid_dest;
  const is_null = this_.ptr_is_null(tid_dest._0);
  if (is_null.$ === "Err") return is_null;
  if (is_null._0) {
    // If NULL is passed, an error is immediately returned
    return interp_ok(this_.eval_libc("EINVAL"));
  }

  const thread_s = this_.read_scalar(thread_op);
  if (thread_s.$ === "Err") return thread_s;
  const thread_i = interp_Scalar.to_int(thread_s._0, this_.libc_ty_layout("pthread_t").size);
  if (thread_i.$ === "Err") return thread_i;
  let thread;
  if (thread_i._0 === 0n) {
    // Null thread ID indicates that we are querying the active thread.
    thread = this_.machine.threads.active_thread_();
  } else {
    // Our pthread_t is just the raw ThreadId.
    // macOS documents this to return an error and indeed it does not seem to segfault.
    const lookup = this_.thread_id_try_from(thread_i._0);
    if (lookup.$ !== "Ok") {
      return interp_ok(this_.eval_libc("ESRCH"));
    }
    thread = lookup._0;
  }

  // This returns an `int`, not a `pthread_t`, so we treat it like we treat `gettid` on Linux.
  const tid = this_.get_tid(thread);
  const tid_dest_place = this_.deref_pointer_as(tid_op, this_.machine.layouts.u64);
  if (tid_dest_place.$ === "Err") return tid_dest_place;
  const w = this_.write_int(BigInt(tid), tid_dest_place._0);
  if (w.$ === "Err") return w;

  // Possible errors have been handled, return success.
  return interp_ok(interp_Scalar.from_u32(0));
};

const MAC_OS: Os = { $: "MacOs" };
