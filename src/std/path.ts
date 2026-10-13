// `std::path` (library/std/src/path.rs, sys/path/{windows,windows_prefix,unix}.rs at the pin), as
// far as the compiler needs it. Moved from rustc_span/source_map.ts (review w23a, batch 3 #9).
import { panic } from "./panic.ts";
import { utf8, utf8_len } from "./str.ts";

// PORT: `Path`/`PathBuf` are strings; the host platform's path rules apply (rustc on the host
// does the same). Strings are indexed by UTF-16 unit; every separator/prefix byte is ASCII, so
// splits land in the same places as upstream's byte indices.

const HAS_PREFIXES = process.platform === "win32";
const MAIN_SEPARATOR_STR = HAS_PREFIXES ? "\\" : "/";

// std: library/std/src/sys/path/mod.rs is_sep_byte
function is_sep_byte(b: string): boolean {
  return HAS_PREFIXES ? b === "\\" || b === "/" : b === "/";
}

// std: library/std/src/sys/path/windows.rs is_verbatim_sep (unix.rs: is_sep_byte)
function is_verbatim_sep(b: string): boolean {
  return HAS_PREFIXES ? b === "\\" : b === "/";
}

/** `std::path::Prefix` */
export type Prefix =
  | { readonly $: "Verbatim"; readonly _0: string }
  | { readonly $: "VerbatimUNC"; readonly _0: string; readonly _1: string }
  | { readonly $: "VerbatimDisk"; readonly _0: string }
  | { readonly $: "DeviceNS"; readonly _0: string }
  | { readonly $: "UNC"; readonly _0: string; readonly _1: string }
  | { readonly $: "Disk"; readonly _0: string };

// std: library/std/src/path.rs Prefix::len
function prefix_len(p: Prefix): number {
  switch (p.$) {
    case "Verbatim":
      return 4 + p._0.length;
    case "VerbatimUNC":
      return 8 + p._0.length + (p._1.length > 0 ? 1 + p._1.length : 0);
    case "VerbatimDisk":
      return 6;
    case "UNC":
      return 2 + p._0.length + (p._1.length > 0 ? 1 + p._1.length : 0);
    case "DeviceNS":
      return 4 + p._0.length;
    case "Disk":
      return 2;
  }
}

function prefix_is_verbatim(p: Prefix): boolean {
  return p.$ === "Verbatim" || p.$ === "VerbatimDisk" || p.$ === "VerbatimUNC";
}

function prefix_is_drive(p: Prefix): boolean {
  return p.$ === "Disk";
}

function prefix_has_implicit_root(p: Prefix): boolean {
  return !prefix_is_drive(p);
}

function prefix_eq(a: Prefix, b: Prefix): boolean {
  return a.$ === b.$ && a._0 === b._0 && ("_1" in a ? a._1 === (b as { _1: string })._1 : true);
}

// std: library/std/src/sys/path/windows_prefix.rs parse_prefix
function parse_prefix(path: string): Prefix | undefined {
  if (!HAS_PREFIXES) return undefined;
  const prefix = path.slice(0, 8).replaceAll("/", "\\");
  let index = 0;
  const strip = (p: string): boolean => {
    if (prefix.slice(index).startsWith(p)) {
      index += p.length;
      return true;
    }
    return false;
  };
  if (strip("\\\\")) {
    // \\
    const save = index;
    if (strip("?\\") && !path.slice(0, index).includes("/")) {
      // \\?\
      if (strip("UNC\\")) {
        // \\?\UNC\server\share
        const p = path.slice(index);
        const [server, rest] = parse_next_component(p, true);
        const [share] = parse_next_component(rest, true);
        return { $: "VerbatimUNC", _0: server, _1: share };
      } else {
        const p = path.slice(index);

        // \\?\C:\path
        const drive = parse_drive_exact(p);
        if (drive !== undefined) {
          return { $: "VerbatimDisk", _0: drive };
        } else {
          // \\?\prefix
          const [pfx] = parse_next_component(p, true);
          return { $: "Verbatim", _0: pfx };
        }
      }
    }
    index = save;
    if (strip(".\\")) {
      // \\.\COM42
      const p = path.slice(index);
      const [pfx] = parse_next_component(p, false);
      return { $: "DeviceNS", _0: pfx };
    } else {
      const p = path.slice(index);
      const [server, rest] = parse_next_component(p, false);
      const [share] = parse_next_component(rest, false);

      if (server !== "" && share !== "") {
        // \\server\share
        return { $: "UNC", _0: server, _1: share };
      } else {
        // no valid prefix beginning with "\\" recognized
        return undefined;
      }
    }
  } else {
    // If it has a drive like `C:` then it's a disk.
    // Otherwise there is no prefix.
    const drive = parse_drive(path);
    return drive === undefined ? undefined : { $: "Disk", _0: drive };
  }
}

// std: library/std/src/sys/path/windows_prefix.rs parse_drive
function parse_drive(path: string): string | undefined {
  // In most DOS systems, it is not possible to have more than 26 drive letters.
  // See <https://en.wikipedia.org/wiki/Drive_letter_assignment#Common_assignments>.
  if (path.length >= 2 && /^[A-Za-z]$/.test(path[0]!) && path[1] === ":") return path[0]!.toUpperCase();
  return undefined;
}

// std: library/std/src/sys/path/windows_prefix.rs parse_drive_exact
function parse_drive_exact(path: string): string | undefined {
  // only parse two bytes: the drive letter and the drive separator
  if (path.length <= 2 || is_verbatim_sep(path[2]!)) {
    return parse_drive(path);
  } else {
    return undefined;
  }
}

// std: library/std/src/sys/path/windows_prefix.rs parse_next_component
function parse_next_component(path: string, verbatim: boolean): [string, string] {
  const separator = verbatim ? is_verbatim_sep : is_sep_byte;
  for (let i = 0; i < path.length; i++) {
    if (separator(path[i]!)) return [path.slice(0, i), path.slice(i + 1)];
  }
  return [path, ""];
}

/** `std::path::Component` */
export type Component =
  | { readonly $: "Prefix"; readonly raw: string; readonly parsed: Prefix }
  | { readonly $: "RootDir" }
  | { readonly $: "CurDir" }
  | { readonly $: "ParentDir" }
  | { readonly $: "Normal"; readonly _0: string };

function component_eq(a: Component, b: Component): boolean {
  if (a.$ !== b.$) return false;
  if (a.$ === "Prefix") return prefix_eq(a.parsed, (b as { parsed: Prefix }).parsed);
  if (a.$ === "Normal") return a._0 === (b as { _0: string })._0;
  return true;
}

// std: library/std/src/path.rs Component::as_os_str
function component_as_os_str(c: Component): string {
  switch (c.$) {
    case "Prefix":
      return c.raw;
    case "RootDir":
      return MAIN_SEPARATOR_STR;
    case "CurDir":
      return ".";
    case "ParentDir":
      return "..";
    case "Normal":
      return c._0;
  }
}

const enum State {
  Prefix = 0, // c:
  StartDir = 1, // / or . or nothing
  Body = 2, // foo/bar/baz
  Done = 3,
}

/** `std::path::Components` */
export class Components {
  constructor(
    public path: string,
    readonly prefix: Prefix | undefined,
    readonly has_physical_root: boolean,
    public front: State,
    public back: State,
  ) {}

  clone(): Components {
    return new Components(this.path, this.prefix, this.has_physical_root, this.front, this.back);
  }

  prefix_len(): number {
    if (!HAS_PREFIXES) return 0;
    return this.prefix === undefined ? 0 : prefix_len(this.prefix);
  }

  prefix_verbatim(): boolean {
    if (!HAS_PREFIXES) return false;
    return this.prefix === undefined ? false : prefix_is_verbatim(this.prefix);
  }

  prefix_remaining(): number {
    if (!HAS_PREFIXES) return 0;
    return this.front === State.Prefix ? this.prefix_len() : 0;
  }

  len_before_body(): number {
    const root = this.front <= State.StartDir && this.has_physical_root ? 1 : 0;
    const cur_dir = this.front <= State.StartDir && this.include_cur_dir() ? 1 : 0;
    return this.prefix_remaining() + root + cur_dir;
  }

  finished(): boolean {
    return this.front === State.Done || this.back === State.Done || this.front > this.back;
  }

  is_sep_byte(b: string): boolean {
    return this.prefix_verbatim() ? is_verbatim_sep(b) : is_sep_byte(b);
  }

  as_path(): string {
    const comps = this.clone();
    if (comps.front === State.Body) comps.trim_left();
    if (comps.back === State.Body) comps.trim_right();
    return comps.path;
  }

  has_root(): boolean {
    if (this.has_physical_root) return true;
    if (HAS_PREFIXES && this.prefix !== undefined) {
      if (prefix_has_implicit_root(this.prefix)) return true;
    }
    return false;
  }

  include_cur_dir(): boolean {
    if (this.has_root()) return false;
    const slice = this.path.slice(this.prefix_remaining());
    if (slice === ".") return true;
    if (slice.length >= 2 && slice[0] === ".") return this.is_sep_byte(slice[1]!);
    return false;
  }

  parse_single_component(comp: string): Component | undefined {
    if (comp === "." && HAS_PREFIXES && this.prefix_verbatim()) return { $: "CurDir" };
    if (comp === ".") return undefined; // . components are normalized away, except at the beginning
    if (comp === "..") return { $: "ParentDir" };
    if (comp === "") return undefined;
    return { $: "Normal", _0: comp };
  }

  parse_next_component(): [number, Component | undefined] {
    let extra = 0;
    let comp = this.path;
    for (let i = 0; i < this.path.length; i++) {
      if (this.is_sep_byte(this.path[i]!)) {
        extra = 1;
        comp = this.path.slice(0, i);
        break;
      }
    }
    return [comp.length + extra, this.parse_single_component(comp)];
  }

  parse_next_component_back(): [number, Component | undefined] {
    const start = this.len_before_body();
    let extra = 0;
    let comp = this.path.slice(start);
    for (let i = this.path.length - 1; i >= start; i--) {
      if (this.is_sep_byte(this.path[i]!)) {
        extra = 1;
        comp = this.path.slice(i + 1);
        break;
      }
    }
    return [comp.length + extra, this.parse_single_component(comp)];
  }

  trim_left(): void {
    while (this.path !== "") {
      const [size, comp] = this.parse_next_component();
      if (comp !== undefined) return;
      this.path = this.path.slice(size);
    }
  }

  trim_right(): void {
    while (this.path.length > this.len_before_body()) {
      const [size, comp] = this.parse_next_component_back();
      if (comp !== undefined) return;
      this.path = this.path.slice(0, this.path.length - size);
    }
  }

  next(): Component | undefined {
    while (!this.finished()) {
      switch (this.front) {
        case State.Body:
          if (this.path !== "") {
            const [size, comp] = this.parse_next_component();
            this.path = this.path.slice(size);
            if (comp !== undefined) return comp;
          } else {
            this.front = State.Done;
          }
          break;
        case State.StartDir:
          this.front = State.Body;
          if (this.has_physical_root) {
            this.path = this.path.slice(1);
            return { $: "RootDir" };
          } else if (HAS_PREFIXES && this.prefix !== undefined) {
            if (prefix_has_implicit_root(this.prefix) && !prefix_is_verbatim(this.prefix)) {
              return { $: "RootDir" };
            }
          } else if (this.include_cur_dir()) {
            this.path = this.path.slice(1);
            return { $: "CurDir" };
          }
          break;
        case State.Prefix:
          if (this.prefix_len() === 0) {
            this.front = State.StartDir;
          } else {
            this.front = State.StartDir;
            const raw = this.path.slice(0, this.prefix_len());
            this.path = this.path.slice(this.prefix_len());
            return { $: "Prefix", raw, parsed: this.prefix! };
          }
          break;
        case State.Done:
          return panic("internal error: entered unreachable code");
      }
    }
    return undefined;
  }

  // std: library/std/src/path.rs:977 <Components as DoubleEndedIterator>::next_back
  next_back(): Component | undefined {
    while (!this.finished()) {
      switch (this.back) {
        case State.Body:
          if (this.path.length > this.len_before_body()) {
            const [size, comp] = this.parse_next_component_back();
            this.path = this.path.slice(0, this.path.length - size);
            if (comp !== undefined) return comp;
          } else {
            this.back = State.StartDir;
          }
          break;
        case State.StartDir:
          this.back = HAS_PREFIXES ? State.Prefix : State.Done;
          if (this.has_physical_root) {
            this.path = this.path.slice(0, this.path.length - 1);
            return { $: "RootDir" };
          } else if (HAS_PREFIXES && this.prefix !== undefined) {
            if (prefix_has_implicit_root(this.prefix) && !prefix_is_verbatim(this.prefix)) {
              return { $: "RootDir" };
            }
          } else if (this.include_cur_dir()) {
            this.path = this.path.slice(0, this.path.length - 1);
            return { $: "CurDir" };
          }
          break;
        case State.Prefix:
          if (!HAS_PREFIXES) return panic("internal error: entered unreachable code");
          if (this.prefix_len() > 0) {
            this.back = State.Done;
            return { $: "Prefix", raw: this.path, parsed: this.prefix! };
          }
          this.back = State.Done;
          return undefined;
        case State.Done:
          return panic("internal error: entered unreachable code");
      }
    }
    return undefined;
  }

  // PORT: upstream compares `self.clone().rev()` with `other.clone().rev()`; comparing the forward
  // sequences gives the same answer (both iterate the same components) without porting `next_back`.
  eq(other: Components): boolean {
    if (
      this.path.length === other.path.length &&
      this.front === other.front &&
      this.back === State.Body &&
      other.back === State.Body &&
      this.prefix_verbatim() === other.prefix_verbatim()
    ) {
      // possible future improvement: this could bail out earlier if there were a
      // reverse memcmp/bcmp comparing back to front
      if (this.path === other.path) return true;
    }
    const a = this.clone();
    const b = other.clone();
    for (;;) {
      const x = a.next();
      const y = b.next();
      if (x === undefined || y === undefined) return x === y;
      if (!component_eq(x, y)) return false;
    }
  }
}

// std: library/std/src/path.rs Path::components
export function path_components(p: string): Components {
  const prefix = parse_prefix(p);
  return new Components(p, prefix, has_physical_root(p, prefix), HAS_PREFIXES ? State.Prefix : State.StartDir, State.Body);
}

// std: library/std/src/path.rs has_physical_root
function has_physical_root(s: string, prefix: Prefix | undefined): boolean {
  const path = prefix !== undefined ? s.slice(prefix_len(prefix)) : s;
  return path !== "" && is_sep_byte(path[0]!);
}

// std: library/std/src/path.rs iter_after
function iter_after(iter: Components, prefix: Components): Components | undefined {
  for (;;) {
    const iter_next = iter.clone();
    const x = iter_next.next();
    const y = prefix.next();
    if (x !== undefined && y !== undefined) {
      if (!component_eq(x, y)) return undefined;
    } else if (x !== undefined && y === undefined) {
      return iter;
    } else if (x === undefined && y === undefined) {
      return iter;
    } else {
      return undefined;
    }
    iter = iter_next;
  }
}

/** `Path::strip_prefix` */
export function path_strip_prefix(path: string, base: string): string | undefined {
  return iter_after(path_components(path), path_components(base))?.as_path();
}

/** `Path::has_root` */
function path_has_root(p: string): boolean {
  return path_components(p).has_root();
}

/** `Path::is_absolute` (sys::path::is_absolute) */
export function path_is_absolute(p: string): boolean {
  if (!HAS_PREFIXES) return path_has_root(p);
  return path_has_root(p) && path_components(p).prefix !== undefined;
}

/** `Path::eq` */
export function path_eq(a: string, b: string): boolean {
  return path_components(a).eq(path_components(b));
}

/** `Path::parent` */
// std: library/std/src/path.rs:2636 parent
export function path_parent(self_: string): string | undefined {
  const comps = path_components(self_);
  const comp = comps.next_back();
  if (comp === undefined) return undefined;
  switch (comp.$) {
    case "Normal":
    case "CurDir":
    case "ParentDir":
      return comps.as_path();
    default:
      return undefined;
  }
}

/** `Path::file_name` */
// std: library/std/src/path.rs:2703 file_name
export function path_file_name(self_: string): string | undefined {
  const p = path_components(self_).next_back();
  return p !== undefined && p.$ === "Normal" ? p._0 : undefined;
}

// std: library/std/src/path.rs:334 rsplit_file_at_dot
function rsplit_file_at_dot(file: string): [string | undefined, string | undefined] {
  if (file === "..") {
    return [file, undefined];
  }
  // `file.as_encoded_bytes().rsplitn(2, |b| *b == b'.')`
  const i = file.lastIndexOf(".");
  const after = i < 0 ? file : file.slice(i + 1);
  const before = i < 0 ? undefined : file.slice(0, i);
  if (before === "") {
    return [file, undefined];
  } else {
    return [before, after];
  }
}

/** `Path::file_stem` (library/std/src/path.rs:2900) */
export function path_file_stem(self_: string): string | undefined {
  const name = path_file_name(self_);
  if (name === undefined) return undefined;
  const [before, after] = rsplit_file_at_dot(name);
  return before ?? after;
}

/** `Path::join` = `to_path_buf()` + `PathBuf::_push` */
export function path_join(self_: string, path: string): string {
  let inner = self_;
  // in general, a separator is needed if the rightmost byte is not a separator
  let need_sep = inner.length > 0 ? !is_sep_byte(inner[inner.length - 1]!) : false;

  // in the special case of `C:` on Windows, do *not* add a separator
  const comps = path_components(inner);

  if (comps.prefix_len() > 0 && comps.prefix_len() === comps.path.length && prefix_is_drive(comps.prefix!)) {
    need_sep = false;
  }

  // On Unix: prefix is always None.
  const need_clear = path_is_absolute(path) || path_components(path).prefix !== undefined;

  // absolute `path` replaces `self`
  if (need_clear) {
    inner = "";

    // verbatim paths need . and .. removed
  } else if (comps.prefix_verbatim() && path !== "") {
    const buf: Component[] = [];
    for (let c = comps.next(); c !== undefined; c = comps.next()) buf.push(c);
    const pcomps = path_components(path);
    for (let c = pcomps.next(); c !== undefined; c = pcomps.next()) {
      switch (c.$) {
        case "RootDir":
          buf.length = Math.min(buf.length, 1);
          buf.push(c);
          break;
        case "CurDir":
          break;
        case "ParentDir":
          if (buf.length > 0 && buf[buf.length - 1]!.$ === "Normal") buf.pop();
          break;
        default:
          buf.push(c);
      }
    }

    let res = "";
    let need_sep = false;

    for (const c of buf) {
      if (need_sep && c.$ !== "RootDir") res += MAIN_SEPARATOR_STR;
      res += component_as_os_str(c);

      need_sep = c.$ === "RootDir" ? false : c.$ === "Prefix" ? !prefix_is_drive(c.parsed) && prefix_len(c.parsed) > 0 : true;
    }

    return res;

    // `path` has a root but no prefix, e.g., `\windows` (Windows only)
  } else if (path_has_root(path)) {
    const prefix_len = path_components(inner).prefix_remaining();
    inner = inner.slice(0, prefix_len);

    // `path` is a pure relative path
  } else if (need_sep) {
    inner += MAIN_SEPARATOR_STR;
  }

  return inner + path;
}


/** The `Hasher` methods `impl Hash for Path` (and the derived `Hash for Prefix`) call. */
export interface Hasher {
  write(bytes: Uint8Array): void;
  write_u8(i: number): void;
  write_usize(i: bigint): void;
  write_isize(i: number): void;
  write_length_prefix(len: number): void;
}

/** `impl Hash for OsStr`: `self.as_encoded_bytes().hash(state)`, i.e. `[u8]`'s Hash. */
function os_str_hash(s: string, h: Hasher): void {
  const bytes = utf8(s);
  h.write_length_prefix(bytes.length);
  h.write(bytes);
}

/** `#[derive(Hash)]` for `Prefix` (variant order: Verbatim, VerbatimUNC, VerbatimDisk, DeviceNS,
 *  UNC, Disk; the discriminant is hashed as an `isize`). */
function prefix_hash(p: Prefix, h: Hasher): void {
  switch (p.$) {
    case "Verbatim":
      h.write_isize(0);
      os_str_hash(p._0, h);
      break;
    case "VerbatimUNC":
      h.write_isize(1);
      os_str_hash(p._0, h);
      os_str_hash(p._1, h);
      break;
    case "VerbatimDisk":
      h.write_isize(2);
      h.write_u8(p._0.charCodeAt(0));
      break;
    case "DeviceNS":
      h.write_isize(3);
      os_str_hash(p._0, h);
      break;
    case "UNC":
      h.write_isize(4);
      os_str_hash(p._0, h);
      os_str_hash(p._1, h);
      break;
    case "Disk":
      h.write_isize(5);
      h.write_u8(p._0.charCodeAt(0));
      break;
  }
}

const USIZE_MASK = (1n << 64n) - 1n;

/** `usize::rotate_right` on a 64-bit usize. */
function usize_rotate_right(x: bigint, n: bigint): bigint {
  return ((x >> n) | (x << (64n - n))) & USIZE_MASK;
}

// PORT: works on the path's UTF-8 bytes like upstream's `as_u8_slice`; `prefix_len` (counted in
// UTF-16 units by the string-based `Prefix`) is converted to a byte length. `chunk_bits` is a
// 64-bit usize, so it is a bigint here.
// std: library/std/src/path.rs:3800 <Path as Hash>::hash
export function path_hash(self_: string, h: Hasher): void {
  let bytes = utf8(self_);
  let prefix_len_ = 0;
  let verbatim = false;
  const prefix = parse_prefix(self_);
  if (prefix !== undefined) {
    prefix_hash(prefix, h);
    [prefix_len_, verbatim] = [utf8_len(self_.slice(0, prefix_len(prefix))), prefix_is_verbatim(prefix)];
  }
  bytes = bytes.subarray(prefix_len_);

  let component_start = 0;
  // track some extra state to avoid prefix collisions.
  // ["foo", "bar"] and ["foobar"], will have the same payload bytes
  // but result in different chunk_bits
  let chunk_bits = 0n;

  for (let i = 0; i < bytes.length; i++) {
    const b = String.fromCharCode(bytes[i]!);
    const is_sep = verbatim ? is_verbatim_sep(b) : is_sep_byte(b);
    if (is_sep) {
      if (i > component_start) {
        const to_hash = bytes.subarray(component_start, i);
        chunk_bits = (chunk_bits + BigInt(to_hash.length)) & USIZE_MASK;
        chunk_bits = usize_rotate_right(chunk_bits, 2n);
        h.write(to_hash);
      }

      // skip over separator and optionally a following CurDir item
      // since components() would normalize these away.
      component_start = i + 1;

      const tail = bytes.subarray(component_start);

      if (!verbatim) {
        if (tail.length === 1 && tail[0] === 0x2e) {
          component_start += 1;
        } else if (tail.length >= 2 && tail[0] === 0x2e && is_sep_byte(String.fromCharCode(tail[1]!))) {
          component_start += 1;
        }
      }
    }
  }

  if (component_start < bytes.length) {
    const to_hash = bytes.subarray(component_start);
    chunk_bits = (chunk_bits + BigInt(to_hash.length)) & USIZE_MASK;
    chunk_bits = usize_rotate_right(chunk_bits, 2n);
    h.write(to_hash);
  }

  h.write_usize(chunk_bits);
}
