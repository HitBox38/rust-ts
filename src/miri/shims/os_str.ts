// Port of src/tools/miri/src/shims/os_str.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-shims-a` (plan-m6 wave 37): ported.
// Its types are generated into os_str.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT:
// - `OsStr` / `OsString` / `Path` / `PathBuf` are `string` (typemap `std::ffi::OsString`; D14: host OS strings are
//   UTF-8). `as_encoded_bytes()` is the UTF-8 encoding, `os_str.len()` its byte length (`utf8_len`). A JS string holds
//   any `str`, but not every `OsStr`: on a Unix host `OsStr::from_bytes` accepts any bytes, and bytes that are not UTF-8
//   stop `unported` (`bytes_to_os_str`); on a Windows host `OsString::from_wide` accepts unpaired surrogates, which stop
//   `unported` likewise. Every other path is exact.
// - `#[cfg(unix)]` / `#[cfg(windows)]` (the *host* Miri runs on) is `HOST_IS_UNIX` / `HOST_IS_WINDOWS`
//   (`process.platform`), so both variants of `bytes_to_os_str` (:21 / :25), `u16vec_to_osstring` (:52 / :56),
//   `os_str_to_u16vec` (:89 / :93) and of `convert_path`'s tail are ported and the host picks one, as the build does.
// - `Cow<OsStr>` is the string itself (borrowed and owned behave the same on an immutable value).
// - `windows_to_unix` / `unix_to_windows` (`T: From<u8> + Copy + Eq`) work on `number[]` (UTF-8 bytes or UTF-16 units).
import { type Pointer } from "../lib.ts";
import { type MemoryKind, type MiriInterpCx } from "../machine.ts";
import { type PathConversion } from "./os_str.gen.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { debug_InterpErrorInfo, debug_InterpErrorKind } from "../../rustc_middle/mir/interpret/error.gen.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok } from "../../rustc_middle/mir/interpret/mod.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import { assert, unported } from "../../std/panic.ts";
import { Err, unwrap_result } from "../../std/result.ts";
import { utf8_len } from "../../std/str.ts";
export * from "./os_str.gen.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/os_str.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/os_str.rs:36
    read_os_str_from_c_str(this: MiriInterpCx, ptr: Pointer): InterpResult<string>;
    // shims/os_str.rs:47
    read_os_str_from_wide_str(this: MiriInterpCx, ptr: Pointer): InterpResult<string>;
    // shims/os_str.rs:69
    write_os_str_to_c_str(this: MiriInterpCx, os_str: string, ptr: Pointer, size: bigint): InterpResult<[boolean, bigint]>;
    // shims/os_str.rs:81
    write_os_str_to_wide_str_helper(this: MiriInterpCx, os_str: string, ptr: Pointer, size: bigint, truncate: boolean): InterpResult<[boolean, bigint]>;
    // shims/os_str.rs:119
    write_os_str_to_wide_str(this: MiriInterpCx, os_str: string, ptr: Pointer, size: bigint): InterpResult<[boolean, bigint]>;
    // shims/os_str.rs:130
    write_os_str_to_wide_str_truncated(this: MiriInterpCx, os_str: string, ptr: Pointer, size: bigint): InterpResult<[boolean, bigint]>;
    // shims/os_str.rs:140
    alloc_os_str_as_c_str(this: MiriInterpCx, os_str: string, memkind: MemoryKind): InterpResult<Pointer>;
    // shims/os_str.rs:156
    alloc_os_str_as_wide_str(this: MiriInterpCx, os_str: string, memkind: MemoryKind): InterpResult<Pointer>;
    // shims/os_str.rs:172
    read_path_from_c_str(this: MiriInterpCx, ptr: Pointer): InterpResult<string>;
    // shims/os_str.rs:186
    read_path_from_wide_str(this: MiriInterpCx, ptr: Pointer): InterpResult<string>;
    // shims/os_str.rs:197
    write_path_to_c_str(this: MiriInterpCx, path: string, ptr: Pointer, size: bigint): InterpResult<[boolean, bigint]>;
    // shims/os_str.rs:211
    write_path_to_wide_str(this: MiriInterpCx, path: string, ptr: Pointer, size: bigint): InterpResult<[boolean, bigint]>;
    // shims/os_str.rs:225
    write_path_to_wide_str_truncated(this: MiriInterpCx, path: string, ptr: Pointer, size: bigint): InterpResult<[boolean, bigint]>;
    // shims/os_str.rs:239
    alloc_path_as_c_str(this: MiriInterpCx, path: string, memkind: MemoryKind): InterpResult<Pointer>;
    // shims/os_str.rs:252
    alloc_path_as_wide_str(this: MiriInterpCx, path: string, memkind: MemoryKind): InterpResult<Pointer>;
    // shims/os_str.rs:263
    convert_path(this: MiriInterpCx, os_str: string, direction: PathConversion): string;
  }
}

/** `cfg(unix)` / `cfg(windows)` of the host Miri runs on (D14). */
const HOST_IS_WINDOWS: boolean = process.platform === "win32";
const HOST_IS_UNIX: boolean = !HOST_IS_WINDOWS;

const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const UTF8_ENCODER = new TextEncoder();

/** `err_unsup_format!(..)` */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}

/** `{:?}` of a `&[u8]` / `Vec<u16>` (integers in a list). */
function debug_int_list(v: ArrayLike<number>): string {
  return `[${Array.from(v).join(", ")}]`;
}

/** `str::from_utf8(bytes).ok()` */
function str_from_utf8(bytes: Uint8Array): string | undefined {
  try {
    return UTF8_FATAL.decode(bytes);
  } catch {
    return undefined;
  }
}

/** `String::from_utf16(v).ok()` */
function string_from_utf16(v: readonly number[]): string | undefined {
  for (let i = 0; i < v.length; i++) {
    const c = v[i]!;
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = v[i + 1];
      if (d === undefined || !(d >= 0xdc00 && d <= 0xdfff)) return undefined;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return undefined;
    }
  }
  let s = "";
  for (let i = 0; i < v.length; i += 0x2000) s += String.fromCharCode(...v.slice(i, i + 0x2000));
  return s;
}

/** `OsStr::as_encoded_bytes` */
export function os_str_as_encoded_bytes(os_str: string): Uint8Array {
  return UTF8_ENCODER.encode(os_str);
}

// rustc: src/tools/miri/src/shims/os_str.rs:21 bytes_to_os_str
function bytes_to_os_str_unix(bytes: Uint8Array): InterpResult<string> {
  // `OsStr::from_bytes(bytes)`: any bytes; the port's `OsStr` is a `string` (module header).
  const s = str_from_utf8(bytes);
  if (s === undefined) {
    return unported(`miri::shims::os_str::bytes_to_os_str: a non-UTF-8 OsStr ${debug_int_list(bytes)} (OsStr is a string, D14)`);
  }
  return interp_ok(s);
}

// rustc: src/tools/miri/src/shims/os_str.rs:25 bytes_to_os_str
function bytes_to_os_str_not_unix(bytes: Uint8Array): InterpResult<string> {
  // We cannot use `from_encoded_bytes_unchecked` here since we can't trust `bytes`.
  const s = str_from_utf8(bytes);
  if (s === undefined) {
    return throw_unsup_format(`${debug_int_list(bytes)} is not a valid utf-8 string`);
  }
  return interp_ok(s);
}

export function bytes_to_os_str(bytes: Uint8Array): InterpResult<string> {
  return HOST_IS_UNIX ? bytes_to_os_str_unix(bytes) : bytes_to_os_str_not_unix(bytes);
}

/// Helper function to read an OsString from a null-terminated sequence of bytes, which is what
/// the Unix APIs usually handle.
// rustc: src/tools/miri/src/shims/os_str.rs:36 read_os_str_from_c_str
InterpCx.prototype.read_os_str_from_c_str = function (this: MiriInterpCx, ptr: Pointer): InterpResult<string> {
  const this_ = this.eval_context_ref();
  const bytes = this_.read_c_str(ptr);
  if (bytes.$ === "Err") return bytes;
  return bytes_to_os_str(bytes._0);
};

// rustc: src/tools/miri/src/shims/os_str.rs:52 u16vec_to_osstring
function u16vec_to_osstring_windows(u16_vec: number[]): InterpResult<string> {
  // `OsString::from_wide`: unpaired surrogates are valid in an `OsString` but not in the port's `string` (header).
  const s = string_from_utf16(u16_vec);
  if (s === undefined) {
    return unported(`miri::shims::os_str::u16vec_to_osstring: unpaired surrogates in ${debug_int_list(u16_vec)} (OsStr is a string, D14)`);
  }
  return interp_ok(s);
}

// rustc: src/tools/miri/src/shims/os_str.rs:56 u16vec_to_osstring
function u16vec_to_osstring_not_windows(u16_vec: number[]): InterpResult<string> {
  const s = string_from_utf16(u16_vec);
  if (s === undefined) {
    return throw_unsup_format(`${debug_int_list(u16_vec)} is not a valid utf-16 string`);
  }
  return interp_ok(s);
}

/// Helper function to read an OsString from a 0x0000-terminated sequence of u16,
/// which is what the Windows APIs usually handle.
// rustc: src/tools/miri/src/shims/os_str.rs:47 read_os_str_from_wide_str
InterpCx.prototype.read_os_str_from_wide_str = function (this: MiriInterpCx, ptr: Pointer): InterpResult<string> {
  const u16vec_to_osstring = HOST_IS_WINDOWS ? u16vec_to_osstring_windows : u16vec_to_osstring_not_windows;

  const u16_vec = this.eval_context_ref().read_wide_str(ptr);
  if (u16_vec.$ === "Err") return u16_vec;
  return u16vec_to_osstring(u16_vec._0);
};

/// Helper function to write an OsStr as a null-terminated sequence of bytes, which is what the
/// Unix APIs usually handle. Returns `(success, full_len)`, where length includes the null
/// terminator. On failure, nothing is written.
// rustc: src/tools/miri/src/shims/os_str.rs:69 write_os_str_to_c_str
InterpCx.prototype.write_os_str_to_c_str = function (this: MiriInterpCx, os_str: string, ptr: Pointer, size: bigint): InterpResult<[boolean, bigint]> {
  const bytes = os_str_as_encoded_bytes(os_str);
  return this.eval_context_mut().write_c_str(bytes, ptr, size);
};

// rustc: src/tools/miri/src/shims/os_str.rs:89 os_str_to_u16vec
function os_str_to_u16vec_windows(os_str: string): InterpResult<number[]> {
  // `os_str.encode_wide().collect()`
  return interp_ok(string_to_utf16(os_str));
}

// rustc: src/tools/miri/src/shims/os_str.rs:93 os_str_to_u16vec
function os_str_to_u16vec_not_windows(os_str: string): InterpResult<number[]> {
  // On non-Windows platforms the best we can do to transform Vec<u16> from/to OS strings is to do the
  // intermediate transformation into strings. Which invalidates non-utf8 paths that are actually
  // valid.
  // `os_str.to_str()` is always `Some` for the port's `OsStr` (a `string`, module header); the `None` arm:
  // `err_unsup_format!("{:?} is not a valid utf-8 string", os_str)` cannot be reached.
  return interp_ok(string_to_utf16(os_str));
}

/** `str::encode_utf16().collect()` */
function string_to_utf16(s: string): number[] {
  const v: number[] = new Array<number>(s.length);
  for (let i = 0; i < s.length; i++) v[i] = s.charCodeAt(i);
  return v;
}

/// Internal helper to share code between `write_os_str_to_wide_str` and
/// `write_os_str_to_wide_str_truncated`.
// rustc: src/tools/miri/src/shims/os_str.rs:81 write_os_str_to_wide_str_helper
InterpCx.prototype.write_os_str_to_wide_str_helper = function (
  this: MiriInterpCx,
  os_str: string,
  ptr: Pointer,
  size: bigint,
  truncate: boolean,
): InterpResult<[boolean, bigint]> {
  const os_str_to_u16vec = HOST_IS_WINDOWS ? os_str_to_u16vec_windows : os_str_to_u16vec_not_windows;

  const u16_vec = os_str_to_u16vec(os_str);
  if (u16_vec.$ === "Err") return u16_vec;
  const r = this.eval_context_mut().write_wide_str(u16_vec._0, ptr, size);
  if (r.$ === "Err") return r;
  const [written, size_needed] = r._0;
  if (truncate && !written && size > 0n) {
    // Write the truncated part that fits.
    // `size.saturating_sub(1).try_into().unwrap()` (size > 0 here)
    const truncated_data = u16_vec._0.slice(0, Number(size - 1n));
    const r2 = this.eval_context_mut().write_wide_str(truncated_data, ptr, size);
    if (r2.$ === "Err") return r2;
    const [written2, written_len] = r2._0;
    assert(written2 && written_len === size, "assertion failed: written && written_len == size");
  }
  return interp_ok([written, size_needed]);
};

/// Helper function to write an OsStr as a 0x0000-terminated u16-sequence, which is what the
/// Windows APIs usually handle. Returns `(success, full_len)`, where length is measured
/// in units of `u16` and includes the null terminator. On failure, nothing is written.
// rustc: src/tools/miri/src/shims/os_str.rs:119 write_os_str_to_wide_str
InterpCx.prototype.write_os_str_to_wide_str = function (this: MiriInterpCx, os_str: string, ptr: Pointer, size: bigint): InterpResult<[boolean, bigint]> {
  return this.write_os_str_to_wide_str_helper(os_str, ptr, size, /*truncate*/ false);
};

/// Like `write_os_str_to_wide_str`, but on failure as much as possible is written into
/// the buffer (always with a null terminator).
// rustc: src/tools/miri/src/shims/os_str.rs:130 write_os_str_to_wide_str_truncated
InterpCx.prototype.write_os_str_to_wide_str_truncated = function (
  this: MiriInterpCx,
  os_str: string,
  ptr: Pointer,
  size: bigint,
): InterpResult<[boolean, bigint]> {
  return this.write_os_str_to_wide_str_helper(os_str, ptr, size, /*truncate*/ true);
};

/// Allocate enough memory to store the given `OsStr` as a null-terminated sequence of bytes.
// rustc: src/tools/miri/src/shims/os_str.rs:140 alloc_os_str_as_c_str
InterpCx.prototype.alloc_os_str_as_c_str = function (this: MiriInterpCx, os_str: string, memkind: MemoryKind): InterpResult<Pointer> {
  const size = BigInt(utf8_len(os_str)) + 1n; // Make space for `0` terminator.
  const this_ = this.eval_context_mut();

  const tcx = this_.tcx.deref();
  const arg_type = Ty.new_array(tcx, tcx.types.u8, Number(size));
  const arg_place = this_.allocate(unwrap_result(this_.layout_of(arg_type), debug_InterpErrorKind), memkind);
  if (arg_place.$ === "Err") return arg_place;
  const [written] = unwrap_result(this.write_os_str_to_c_str(os_str, arg_place._0.ptr(), size), debug_InterpErrorInfo);
  assert(written, "assertion failed: written");
  return interp_ok(arg_place._0.ptr());
};

/// Allocate enough memory to store the given `OsStr` as a null-terminated sequence of `u16`.
// rustc: src/tools/miri/src/shims/os_str.rs:156 alloc_os_str_as_wide_str
InterpCx.prototype.alloc_os_str_as_wide_str = function (this: MiriInterpCx, os_str: string, memkind: MemoryKind): InterpResult<Pointer> {
  // PORT: `os_str.len()` is the encoded byte length (as upstream), not the number of `u16`s.
  const size = BigInt(utf8_len(os_str)) + 1n; // Make space for `0x0000` terminator.
  const this_ = this.eval_context_mut();

  const tcx = this_.tcx.deref();
  const arg_type = Ty.new_array(tcx, tcx.types.u16, Number(size));
  const arg_place = this_.allocate(unwrap_result(this_.layout_of(arg_type), debug_InterpErrorKind), memkind);
  if (arg_place.$ === "Err") return arg_place;
  const [written] = unwrap_result(this.write_os_str_to_wide_str(os_str, arg_place._0.ptr(), size), debug_InterpErrorInfo);
  assert(written, "assertion failed: written");
  return interp_ok(arg_place._0.ptr());
};

/// Read a null-terminated sequence of bytes, and perform path separator conversion if needed.
// rustc: src/tools/miri/src/shims/os_str.rs:172 read_path_from_c_str
InterpCx.prototype.read_path_from_c_str = function (this: MiriInterpCx, ptr: Pointer): InterpResult<string> {
  const this_ = this.eval_context_ref();
  const os_str = this_.read_os_str_from_c_str(ptr);
  if (os_str.$ === "Err") return os_str;

  return interp_ok(this_.convert_path(os_str._0, "TargetToHost"));
};

/// Read a null-terminated sequence of `u16`s, and perform path separator conversion if needed.
// rustc: src/tools/miri/src/shims/os_str.rs:186 read_path_from_wide_str
InterpCx.prototype.read_path_from_wide_str = function (this: MiriInterpCx, ptr: Pointer): InterpResult<string> {
  const this_ = this.eval_context_ref();
  const os_str = this_.read_os_str_from_wide_str(ptr);
  if (os_str.$ === "Err") return os_str;

  return interp_ok(this_.convert_path(os_str._0, "TargetToHost"));
};

/// Write a Path to the machine memory (as a null-terminated sequence of bytes),
/// adjusting path separators if needed.
// rustc: src/tools/miri/src/shims/os_str.rs:197 write_path_to_c_str
InterpCx.prototype.write_path_to_c_str = function (this: MiriInterpCx, path: string, ptr: Pointer, size: bigint): InterpResult<[boolean, bigint]> {
  const this_ = this.eval_context_mut();
  const os_str = this_.convert_path(path, "HostToTarget");
  return this_.write_os_str_to_c_str(os_str, ptr, size);
};

/// Write a Path to the machine memory (as a null-terminated sequence of `u16`s),
/// adjusting path separators if needed.
// rustc: src/tools/miri/src/shims/os_str.rs:211 write_path_to_wide_str
InterpCx.prototype.write_path_to_wide_str = function (this: MiriInterpCx, path: string, ptr: Pointer, size: bigint): InterpResult<[boolean, bigint]> {
  const this_ = this.eval_context_mut();
  const os_str = this_.convert_path(path, "HostToTarget");
  return this_.write_os_str_to_wide_str(os_str, ptr, size);
};

/// Write a Path to the machine memory (as a null-terminated sequence of `u16`s),
/// adjusting path separators if needed.
// rustc: src/tools/miri/src/shims/os_str.rs:225 write_path_to_wide_str_truncated
InterpCx.prototype.write_path_to_wide_str_truncated = function (
  this: MiriInterpCx,
  path: string,
  ptr: Pointer,
  size: bigint,
): InterpResult<[boolean, bigint]> {
  const this_ = this.eval_context_mut();
  const os_str = this_.convert_path(path, "HostToTarget");
  return this_.write_os_str_to_wide_str_truncated(os_str, ptr, size);
};

/// Allocate enough memory to store a Path as a null-terminated sequence of bytes,
/// adjusting path separators if needed.
// rustc: src/tools/miri/src/shims/os_str.rs:239 alloc_path_as_c_str
InterpCx.prototype.alloc_path_as_c_str = function (this: MiriInterpCx, path: string, memkind: MemoryKind): InterpResult<Pointer> {
  const this_ = this.eval_context_mut();
  const os_str = this_.convert_path(path, "HostToTarget");
  return this_.alloc_os_str_as_c_str(os_str, memkind);
};

/// Allocate enough memory to store a Path as a null-terminated sequence of `u16`s,
/// adjusting path separators if needed.
// rustc: src/tools/miri/src/shims/os_str.rs:252 alloc_path_as_wide_str
InterpCx.prototype.alloc_path_as_wide_str = function (this: MiriInterpCx, path: string, memkind: MemoryKind): InterpResult<Pointer> {
  const this_ = this.eval_context_mut();
  const os_str = this_.convert_path(path, "HostToTarget");
  return this_.alloc_os_str_as_wide_str(os_str, memkind);
};

const B_SLASH = 0x2f; // b'/'
const B_BACKSLASH = 0x5c; // b'\\'
const B_QUESTION = 0x3f; // b'?'
const B_COLON = 0x3a; // b':'

/// Adjust a Windows path to Unix conventions such that it un-does everything that
/// `unix_to_windows` did, and such that if the Windows input path was absolute, then the
/// Unix output path is absolute.
// rustc: src/tools/miri/src/shims/os_str.rs:274 windows_to_unix
export function windows_to_unix(path: number[]): void {
  const sep = B_SLASH;
  // Make sure all path separators are `/`.
  for (let i = 0; i < path.length; i++) {
    if (path[i] === B_BACKSLASH) {
      path[i] = sep;
    }
  }
  // If this starts with `//?/`, it was probably produced by `unix_to_windows` and we
  // remove the `//?` that got added to get the Unix path back out.
  if (path.length >= 4 && path[0] === sep && path[1] === sep && path[2] === B_QUESTION && path[3] === sep) {
    // Remove first 3 characters. It still starts with `/` so it is absolute on Unix.
    path.splice(0, 3);
  }
  // If it starts with a drive letter (`X:/`), convert it to an absolute Unix path.
  else if (path.length >= 3 && path[1] === B_COLON && path[2] === sep) {
    // We add a `/` at the beginning, to store the absolute Windows
    // path in something that looks like an absolute Unix path.
    path.splice(0, 0, sep);
  }
}

/// Adjust a Unix path to Windows conventions such that it un-does everything that
/// `windows_to_unix` did, and such that if the Unix input path was absolute, then the
/// Windows output path is absolute.
// rustc: src/tools/miri/src/shims/os_str.rs:302 unix_to_windows
export function unix_to_windows(path: number[]): void {
  const sep = B_BACKSLASH;
  // Make sure all path separators are `\`.
  for (let i = 0; i < path.length; i++) {
    if (path[i] === B_SLASH) {
      path[i] = sep;
    }
  }
  // If the path is `\X:\`, the leading separator was probably added by `windows_to_unix`
  // and we should get rid of it again.
  if (path.length >= 4 && path[2] === B_COLON && path[3] === sep && path[0] === sep) {
    // The new path is still absolute on Windows.
    path.splice(0, 1);
  }
  // If this starts with a `\` but not a `\\`, then this was absolute on Unix but is
  // relative on Windows (relative to "the root of the current directory", e.g. the
  // drive letter).
  else if (path.length >= 1 && path[0] === sep && path[1] !== sep) {
    // We add `\\?` so it starts with `\\?\` which is some magic path on Windows
    // that *is* considered absolute. This way we store the absolute Unix path
    // in something that looks like an absolute Windows path.
    path.splice(0, 0, sep, sep, B_QUESTION);
  }
}

// rustc: src/tools/miri/src/shims/os_str.rs:263 convert_path
InterpCx.prototype.convert_path = function (this: MiriInterpCx, os_str: string, direction: PathConversion): string {
  const this_ = this.eval_context_ref();
  const target_os = this_.tcx.deref().sess.target.os;

  // Below we assume that everything non-Windows works like Unix, at least
  // when it comes to file system path conventions.
  if (HOST_IS_WINDOWS) {
    // #[cfg(windows)]
    if (target_os.$ === "Windows") {
      // Windows-on-Windows, all fine.
      return os_str;
    } else {
      // Unix target, Windows host.
      const path: number[] = string_to_utf16(os_str);
      switch (direction) {
        case "HostToTarget":
          windows_to_unix(path);
          break;
        case "TargetToHost":
          unix_to_windows(path);
          break;
      }
      // `OsString::from_wide(&path)`: only ASCII units were moved or inserted, so the units stay valid UTF-16.
      return unwrap_utf16(path);
    }
  } else {
    // #[cfg(not(windows))]
    if (target_os.$ === "Windows") {
      // Windows target, Unix host.
      const path: number[] = Array.from(os_str_as_encoded_bytes(os_str));
      switch (direction) {
        case "HostToTarget":
          unix_to_windows(path);
          break;
        case "TargetToHost":
          windows_to_unix(path);
          break;
      }
      // `OsString::from_vec(path)`: only ASCII bytes were moved or inserted, so the bytes stay valid UTF-8.
      const s = str_from_utf8(Uint8Array.from(path));
      if (s === undefined) return unported("miri::shims::os_str::convert_path: a non-UTF-8 OsString (D14)");
      return s;
    } else {
      // Unix-on-Unix, all is fine.
      return os_str;
    }
  }
};

/** `OsString::from_wide` of units that are valid UTF-16 (see `convert_path`). */
function unwrap_utf16(v: number[]): string {
  const s = string_from_utf16(v);
  if (s === undefined) return unported("miri::shims::os_str::convert_path: unpaired surrogates in an OsString (D14)");
  return s;
}
