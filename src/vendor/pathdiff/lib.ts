// Port of pathdiff 0.2.3 `src/lib.rs` (lane ssa-archive: `rustc_codegen_ssa::back::rpath` calls `diff_paths`; the version
// in upstream's Cargo.lock).
//
// Copyright 2012-2015 The Rust Project Developers. Licensed under the Apache License, Version 2.0 or the MIT license, at
// your option.
//
// Adapted from rustc's path_relative_from
// https://github.com/rust-lang/rust/blob/e1d0de82cc40b666b88d4a6d2c9dcbc81d7ed27f/src/librustc_back/rpath.rs#L116-L158
//
// PORT: the `camino` feature (`diff_utf8_paths`) is off in rustc's build and is not ported. `PathBuf` is a `string`
// (PORTING section 5). `Component`'s `PartialEq` and `as_os_str` are not exported by src/std/path.ts, so `component_eq`
// and `component_as_os_str` below repeat them (std's derived `PartialEq` and `Component::as_os_str`).
import { type Component, path_components, path_is_absolute, path_join } from "../../std/path.ts";

/// Construct a relative path from a provided base directory path to the provided path.
///
/// ```rust
/// use pathdiff::diff_paths;
/// use std::path::*;
///
/// assert_eq!(diff_paths("/foo/bar",      "/foo/bar/baz"),  Some("../".into()));
/// assert_eq!(diff_paths("/foo/bar/baz",  "/foo/bar"),      Some("baz".into()));
/// assert_eq!(diff_paths("/foo/bar/quux", "/foo/bar/baz"),  Some("../quux".into()));
/// assert_eq!(diff_paths("/foo/bar/baz",  "/foo/bar/quux"), Some("../baz".into()));
/// assert_eq!(diff_paths("/foo/bar",      "/foo/bar/quux"), Some("../".into()));
///
/// assert_eq!(diff_paths("/foo/bar",      "baz"),           Some("/foo/bar".into()));
/// assert_eq!(diff_paths("/foo/bar",      "/baz"),          Some("../foo/bar".into()));
/// assert_eq!(diff_paths("foo",           "bar"),           Some("../foo".into()));
/// ```
// crate: pathdiff-0.2.3/src/lib.rs:43 diff_paths
export function diff_paths(path: string, base: string): string | undefined {
  if (path_is_absolute(path) !== path_is_absolute(base)) {
    if (path_is_absolute(path)) {
      return path;
    } else {
      return undefined;
    }
  } else {
    const ita = path_components(path);
    const itb = path_components(base);
    const comps: Component[] = [];
    for (;;) {
      const a = ita.next();
      const b = itb.next();
      if (a === undefined && b === undefined) {
        break;
      } else if (a !== undefined && b === undefined) {
        comps.push(a);
        for (let c = ita.next(); c !== undefined; c = ita.next()) comps.push(c);
        break;
      } else if (a === undefined) {
        comps.push({ $: "ParentDir" });
      } else if (comps.length === 0 && component_eq(a, b!)) {
        // ()
      } else if (b!.$ === "CurDir") {
        comps.push(a);
      } else if (b!.$ === "ParentDir") {
        return undefined;
      } else {
        comps.push({ $: "ParentDir" });
        for (let c = itb.next(); c !== undefined; c = itb.next()) {
          comps.push({ $: "ParentDir" });
        }
        comps.push(a);
        for (let c = ita.next(); c !== undefined; c = ita.next()) comps.push(c);
        break;
      }
    }
    // `comps.iter().map(|c| c.as_os_str()).collect::<PathBuf>()`: `PathBuf::push` of each component.
    let buf = "";
    for (const c of comps) buf = path_join(buf, component_as_os_str(c));
    return buf;
  }
}

/** std's derived `PartialEq for Component` (src/std/path.ts keeps its copy private).
 *  PORT: `Prefix` components occur only on Windows (unchecked); they compare by their text here, where std compares the
 *  parsed prefix. */
function component_eq(a: Component, b: Component): boolean {
  if (a.$ !== b.$) return false;
  if (a.$ === "Prefix") return a.raw === (b as { raw: string }).raw;
  if (a.$ === "Normal") return a._0 === (b as { _0: string })._0;
  return true;
}

/** std's `Component::as_os_str` (src/std/path.ts keeps its copy private). */
function component_as_os_str(c: Component): string {
  switch (c.$) {
    case "Prefix":
      return c.raw;
    case "RootDir":
      return process.platform === "win32" ? "\\" : "/";
    case "CurDir":
      return ".";
    case "ParentDir":
      return "..";
    case "Normal":
      return c._0;
  }
}
