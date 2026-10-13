//! Finds crate binaries and loads their metadata
//!
//! Might I be the first to welcome you to a world of platform differences,
//! version requirements, dependency graphs, conflicting desires, and fun! This
//! is the major guts (along with metadata::creader) of the compiler for loading
//! crates and resolving dependencies. Let's take a tour!
//!
//! # The problem
//!
//! Each invocation of the compiler is immediately concerned with one primary
//! problem, to connect a set of crates to resolved crates on the filesystem.
//! Concretely speaking, the compiler follows roughly these steps to get here:
//!
//! 1. Discover a set of `extern crate` statements.
//! 2. Transform these directives into crate names. If the directive does not
//!    have an explicit name, then the identifier is the name.
//! 3. For each of these crate names, find a corresponding crate on the
//!    filesystem.
//!
//! Sounds easy, right? Let's walk into some of the nuances.
//!
//! ## Transitive Dependencies
//!
//! Let's say we've got three crates: A, B, and C. A depends on B, and B depends
//! on C. When we're compiling A, we primarily need to find and locate B, but we
//! also end up needing to find and locate C as well.
//!
//! The reason for this is that any of B's types could be composed of C's types,
//! any function in B could return a type from C, etc. To be able to guarantee
//! that we can always type-check/translate any function, we have to have
//! complete knowledge of the whole ecosystem, not just our immediate
//! dependencies.
//!
//! So now as part of the "find a corresponding crate on the filesystem" step
//! above, this involves also finding all crates for *all upstream
//! dependencies*. This includes all dependencies transitively.
//!
//! ## Rlibs and Dylibs
//!
//! The compiler has two forms of intermediate dependencies. These are dubbed
//! rlibs and dylibs for the static and dynamic variants, respectively. An rlib
//! is a rustc-defined file format (currently just an ar archive) while a dylib
//! is a platform-defined dynamic library. Each library has a metadata somewhere
//! inside of it.
//!
//! A third kind of dependency is an rmeta file. These are metadata files and do
//! not contain any code, etc. To a first approximation, these are treated in the
//! same way as rlibs. Where there is both an rlib and an rmeta file, the rlib
//! gets priority (even if the rmeta file is newer). An rmeta file is only
//! useful for checking a downstream crate, attempting to link one will cause an
//! error.
//!
//! When translating a crate name to a crate on the filesystem, we all of a
//! sudden need to take into account both rlibs and dylibs! Linkage later on may
//! use either one of these files, as each has their pros/cons. The job of crate
//! loading is to discover what's possible by finding all candidates.
//!
//! Most parts of this loading systems keep the dylib/rlib as just separate
//! variables.
//!
//! ## Where to look?
//!
//! We can't exactly scan your whole hard drive when looking for dependencies,
//! so we need to places to look. Currently the compiler will implicitly add the
//! target lib search path ($prefix/lib/rustlib/$target/lib) to any compilation,
//! and otherwise all -L flags are added to the search paths.
//!
//! ## What criterion to select on?
//!
//! This is a pretty tricky area of loading crates. Given a file, how do we know
//! whether it's the right crate? Currently, the rules look along these lines:
//!
//! 1. Does the filename match an rlib/dylib pattern? That is to say, does the
//!    filename have the right prefix/suffix?
//! 2. Does the filename have the right prefix for the crate name being queried?
//!    This is filtering for files like `libfoo*.rlib` and such. If the crate
//!    we're looking for was originally compiled with -C extra-filename, the
//!    extra filename will be included in this prefix to reduce reading
//!    metadata from crates that would otherwise share our prefix.
//! 3. Is the file an actual rust library? This is done by loading the metadata
//!    from the library and making sure it's actually there.
//! 4. Does the name in the metadata agree with the name of the library?
//! 5. Does the target in the metadata agree with the current target?
//! 6. Does the SVH match? (more on this later)
//!
//! If the file answers `yes` to all these questions, then the file is
//! considered as being *candidate* for being accepted. It is illegal to have
//! more than two candidates as the compiler has no method by which to resolve
//! this conflict. Additionally, rlib/dylib candidates are considered
//! separately.
//!
//! After all this has happened, we have 1 or two files as candidates. These
//! represent the rlib/dylib file found for a library, and they're returned as
//! being found.
//!
//! ### What about versions?
//!
//! A lot of effort has been put forth to remove versioning from the compiler.
//! There have been forays in the past to have versioning baked in, but it was
//! largely always deemed insufficient to the point that it was recognized that
//! it's probably something the compiler shouldn't do anyway due to its
//! complicated nature and the state of the half-baked solutions.
//!
//! With a departure from versioning, the primary criterion for loading crates
//! is just the name of a crate. If we stopped here, it would imply that you
//! could never link two crates of the same name from different sources
//! together, which is clearly a bad state to be in.
//!
//! To resolve this problem, we come to the next section!
//!
//! # Expert Mode
//!
//! A number of flags have been added to the compiler to solve the "version
//! problem" in the previous section, as well as generally enabling more
//! powerful usage of the crate loading system of the compiler. The goal of
//! these flags and options are to enable third-party tools to drive the
//! compiler with prior knowledge about how the world should look.
//!
//! ## The `--extern` flag
//!
//! The compiler accepts a flag of this form a number of times:
//!
//! ```text
//! --extern crate-name=path/to/the/crate.rlib
//! ```
//!
//! This flag is basically the following letter to the compiler:
//!
//! > Dear rustc,
//! >
//! > When you are attempting to load the immediate dependency `crate-name`, I
//! > would like you to assume that the library is located at
//! > `path/to/the/crate.rlib`, and look nowhere else. Also, please do not
//! > assume that the path I specified has the name `crate-name`.
//!
//! This flag basically overrides most matching logic except for validating that
//! the file is indeed a rust library. The same `crate-name` can be specified
//! twice to specify the rlib/dylib pair.
//!
//! ## Enabling "multiple versions"
//!
//! This basically boils down to the ability to specify arbitrary packages to
//! the compiler. For example, if crate A wanted to use Bv1 and Bv2, then it
//! would look something like:
//!
//! ```compile_fail,E0463
//! extern crate b1;
//! extern crate b2;
//!
//! fn main() {}
//! ```
//!
//! and the compiler would be invoked as:
//!
//! ```text
//! rustc a.rs --extern b1=path/to/libb1.rlib --extern b2=path/to/libb2.rlib
//! ```
//!
//! In this scenario there are two crates named `b` and the compiler must be
//! manually driven to be informed where each crate is.
//!
//! ## Frobbing symbols
//!
//! One of the immediate problems with linking the same library together twice
//! in the same problem is dealing with duplicate symbols. The primary way to
//! deal with this in rustc is to add hashes to the end of each symbol.
//!
//! In order to force hashes to change between versions of a library, if
//! desired, the compiler exposes an option `-C metadata=foo`, which is used to
//! initially seed each symbol hash. The string `foo` is prepended to each
//! string-to-hash to ensure that symbols change over time.
//!
//! ## Loading transitive dependencies
//!
//! Dealing with same-named-but-distinct crates is not just a local problem, but
//! one that also needs to be dealt with for transitive dependencies. Note that
//! in the letter above `--extern` flags only apply to the *local* set of
//! dependencies, not the upstream transitive dependencies. Consider this
//! dependency graph:
//!
//! ```text
//! A.1   A.2
//! |     |
//! |     |
//! B     C
//!  \   /
//!   \ /
//!    D
//! ```
//!
//! In this scenario, when we compile `D`, we need to be able to distinctly
//! resolve `A.1` and `A.2`, but an `--extern` flag cannot apply to these
//! transitive dependencies.
//!
//! Note that the key idea here is that `B` and `C` are both *already compiled*.
//! That is, they have already resolved their dependencies. Due to unrelated
//! technical reasons, when a library is compiled, it is only compatible with
//! the *exact same* version of the upstream libraries it was compiled against.
//! We use the "Strict Version Hash" to identify the exact copy of an upstream
//! library.
//!
//! With this knowledge, we know that `B` and `C` will depend on `A` with
//! different SVH values, so we crawl the normal `-L` paths looking for
//! `liba*.rlib` and filter based on the contained SVH.
//!
//! In the end, this ends up not needing `--extern` to specify upstream
//! transitive dependencies.
//!
//! # Wrapping up
//!
//! That's the general overview of loading crates in the compiler, but it's by
//! no means all of the necessary details. Take a look at the rest of
//! metadata::locator or metadata::creader for all the juicy details!


// Port of compiler/rustc_metadata/src/locator.rs (lane locator, wave 11).
//
// PORT notes:
// - `PathBuf`/`&Path` are UTF-8 strings (PORTING section 5); `Path::display()` is the string itself.
// - `FxIndexMap`/`FxIndexSet` are insertion-ordered `Map`/`Set` (PORTING section 5).
// - `OwnedSlice` (`rustc_data_structures::owned_slice`) is a `Uint8Array`; `OwnedSlice::slice` is `subarray`.
// - `info!`/`debug!` (tracing) are comments.
// - Reading metadata goes through `MetadataBlob::{new, check_compatibility, get_header, get_crate_hash}`
//   (rmeta/decoder.ts, wave 11 rmeta-decoder) and the backend's `MetadataLoader` (rlib/dylib: wave 11
//   object-read); those stubs call `unported` until their lanes land.
import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import { CrateSource } from "../rustc_crate_store/lib.ts";
import type { DiagArgValue } from "../rustc_error_messages/lib.ts";
import { try_canonicalize } from "../rustc_fs_util/lib.ts";
import { config, type Session } from "../rustc_session/lib.ts";
import type { FileSearch } from "../rustc_session/filesearch.ts";
import type { PathKind } from "../rustc_session/search_paths.ts";
import type { CanonicalizedPath } from "../rustc_session/utils.ts";
import type { PathBuf, Span } from "../rustc_span/lib.ts";
import { display_Symbol, Symbol } from "../rustc_span/symbol.ts";
import { Target } from "../rustc_target/spec/mod.ts";
import { TargetTuple } from "../rustc_target/spec/tuple.ts";
import { debug_str } from "../std/fmt.ts";
import { io_error_other, type IoResult } from "../std/io.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { assert, panic, unported, unwrap } from "../std/panic.ts";
import { path_components, path_file_name } from "../std/path.ts";
import { Err, Ok, type Result, unwrap_result } from "../std/result.ts";
import type { Write } from "../vendor/anstream/stream.ts";
import type { Library, MetadataLoader } from "./creader.ts";
import * as diagnostics from "./diagnostics.ts";
import { dlsym_proc_macros, type ProcMacroClient } from "./host_dylib.ts";
import { MetadataBlob, type Svh } from "./rmeta/decoder.ts";
import { METADATA_HEADER, rustc_version } from "./rmeta/mod.ts";

/** PORT: `crate::rmeta::ProcMacroKind` (rmeta/mod.rs) is not declared yet (wave 11 rmeta-types). */
type ProcMacroKind = unknown;

// #[derive(Clone)]
export class CrateLocator {
  constructor(
    // Immutable per-session configuration.
    public only_needs_metadata: boolean,
    public metadata_loader: MetadataLoader,
    public cfg_version: string,

    // Immutable per-search configuration.
    public crate_name: Symbol,
    public exact_paths: CanonicalizedPath[],
    public hash: Svh | undefined,
    public extra_filename: string | undefined,
    public target: Target,
    public tuple: TargetTuple,
    public filesearch: FileSearch,
    public is_proc_macro: boolean,
    public path_kind: PathKind,
  ) {}

  /** `#[derive(Clone)]` */
  clone(): CrateLocator {
    return new CrateLocator(
      this.only_needs_metadata,
      this.metadata_loader,
      this.cfg_version,
      this.crate_name,
      this.exact_paths.slice(),
      this.hash,
      this.extra_filename,
      this.target,
      this.tuple,
      this.filesearch,
      this.is_proc_macro,
      this.path_kind,
    );
  }

  // rustc: compiler/rustc_metadata/src/locator.rs:304 new
  static new(
    sess: Session,
    metadata_loader: MetadataLoader,
    crate_name: Symbol,
    is_rlib: boolean,
    hash: Svh | undefined,
    extra_filename: string | undefined,
    path_kind: PathKind,
  ): CrateLocator {
    const needs_object_code = sess.opts.output_types.should_codegen();
    // If we're producing an rlib, then we don't need object code.
    // Or, if we're not producing object code, then we don't need it either
    // (e.g., if we're a cdylib but emitting just metadata).
    const only_needs_metadata = is_rlib || !needs_object_code;

    let exact_paths: CanonicalizedPath[];
    if (hash === undefined) {
      const entry = sess.opts.externs.get(Symbol.as_str(crate_name));
      const files = entry === undefined ? undefined : entry.files();
      exact_paths = files === undefined ? [] : [...files];
    } else {
      // SVH being specified means this is a transitive dependency,
      // so `--extern` options do not apply.
      exact_paths = [];
    }

    return new CrateLocator(
      only_needs_metadata,
      metadata_loader,
      sess.cfg_version,
      crate_name,
      exact_paths,
      hash,
      extra_filename,
      sess.target,
      sess.opts.target_triple,
      sess.target_filesearch(),
      /* is_proc_macro */ false,
      path_kind,
    );
  }

  // rustc: compiler/rustc_metadata/src/locator.rs:347 for_proc_macro
  for_proc_macro(sess: Session, path_kind: PathKind): void {
    this.is_proc_macro = true;
    this.target = sess.host;
    this.tuple = TargetTuple.from_tuple(config.host_tuple());
    this.filesearch = sess.host_filesearch();
    this.path_kind = path_kind;
  }

  // rustc: compiler/rustc_metadata/src/locator.rs:355 for_target_proc_macro
  for_target_proc_macro(sess: Session, path_kind: PathKind): void {
    this.is_proc_macro = true;
    this.target = sess.target;
    this.tuple = sess.opts.target_triple;
    this.filesearch = sess.target_filesearch();
    this.path_kind = path_kind;
  }

  // rustc: compiler/rustc_metadata/src/locator.rs:363 for_wasm_proc_macro
  for_wasm_proc_macro(sess: Session, path_kind: PathKind): void {
    this.is_proc_macro = true;
    this.target = sess.wasm_proc_macro_target;
    this.tuple = sess.wasm_proc_macro_tuple;
    this.filesearch = sess.wasm_proc_macro_filesearch();
    this.path_kind = path_kind;
  }

  // rustc: compiler/rustc_metadata/src/locator.rs:371 maybe_load_library_crate
  maybe_load_library_crate(crate_rejections: CrateRejections): Result<Library | undefined, CrateError> {
    if (this.exact_paths.length !== 0) {
      return this.find_commandline_library(crate_rejections);
    }
    const seen_paths = new Set<PathBuf>();
    if (this.extra_filename !== undefined) {
      const extra_filename = this.extra_filename;
      const r = this.find_library_crate(crate_rejections, extra_filename, seen_paths);
      if (r.$ === "Err") return r;
      const library = r._0;
      if (library !== undefined) {
        return Ok(library);
      }
    }
    return this.find_library_crate(crate_rejections, "", seen_paths);
  }

  // rustc: compiler/rustc_metadata/src/locator.rs:388 find_library_crate
  find_library_crate(crate_rejections: CrateRejections, extra_prefix: string, seen_paths: Set<PathBuf>): Result<Library | undefined, CrateError> {
    const rmeta_prefix = `lib${display_Symbol(this.crate_name)}${extra_prefix}`;
    const rlib_prefix = rmeta_prefix;
    const dylib_prefix = `${this.target.dll_prefix}${display_Symbol(this.crate_name)}${extra_prefix}`;
    const staticlib_prefix = `${this.target.staticlib_prefix}${display_Symbol(this.crate_name)}${extra_prefix}`;
    const interface_prefix = rmeta_prefix;

    const rmeta_suffix = ".rmeta";
    const rlib_suffix = ".rlib";
    const dylib_suffix = this.target.dll_suffix;
    const staticlib_suffix = this.target.staticlib_suffix;
    const interface_suffix = ".rs";

    const candidates = new Map<string, [Set<PathBuf>, Set<PathBuf>, Set<PathBuf>, Set<PathBuf>]>();

    // First, find all possible candidate rlibs and dylibs purely based on
    // the name of the files themselves. We're trying to match against an
    // exact crate name and a possibly an exact hash.
    //
    // During this step, we can filter all found libraries based on the
    // name and id found in the crate id (we ignore the path portion for
    // filename matching), as well as the exact hash (if specified). If we
    // end up having many candidates, we must look at the metadata to
    // perform exact matches against hashes/crate ids. Note that opening up
    // the metadata is where we do an exact match against the full contents
    // of the crate id (path/name/id).
    //
    // The goal of this step is to look at as little metadata as possible.
    // Unfortunately, the prefix-based matching sometimes is over-eager.
    // E.g. if `rlib_suffix` is `libstd` it'll match the file
    // `libstd_detect-8d6701fb958915ad.rlib` (incorrect) as well as
    // `libstd-f3ab5b1dea981f17.rlib` (correct). But this is hard to avoid
    // given that `extra_filename` comes from the `-C extra-filename`
    // option and thus can be anything, and the incorrect match will be
    // handled safely in `extract_one`.
    let should_check_staticlibs = true;
    for (const [prefix, suffix, kind] of [
      [rlib_prefix, rlib_suffix, CrateFlavor.Rlib],
      [rmeta_prefix, rmeta_suffix, CrateFlavor.Rmeta],
      [dylib_prefix, dylib_suffix, CrateFlavor.Dylib],
      [interface_prefix, interface_suffix, CrateFlavor.SDylib],
    ] as const) {
      if (prefix === staticlib_prefix && suffix === staticlib_suffix) {
        should_check_staticlibs = false;
      }

      for (const [hash, spf_path] of this.filesearch.get_library_candidates(prefix, suffix, this.path_kind)) {
        // info!("lib candidate: {}", spf_path.display());

        let entry = candidates.get(hash);
        if (entry === undefined) {
          entry = [new Set(), new Set(), new Set(), new Set()];
          candidates.set(hash, entry);
        }
        const [rlibs, rmetas, dylibs, interfaces] = entry;
        {
          // As a performance optimisation we canonicalize the path and skip
          // ones we've already seen. This allows us to ignore crates
          // we know are exactual equal to ones we've already found.
          // Going to the same crate through different symlinks does not change the result.
          const canon = try_canonicalize(spf_path);
          const path = canon.$ === "Ok" ? canon._0 : spf_path;
          if (seen_paths.has(path)) {
            continue;
          }
          seen_paths.add(path);
        }
        // Use the original path (potentially with unresolved symlinks),
        // filesystem code should not care, but this is nicer for diagnostics.
        switch (kind) {
          case "Rlib":
            rlibs.add(spf_path);
            break;
          case "Rmeta":
            rmetas.add(spf_path);
            break;
          case "Dylib":
            dylibs.add(spf_path);
            break;
          case "SDylib":
            interfaces.add(spf_path);
            break;
        }
      }
    }

    if (should_check_staticlibs) {
      for (const [, path] of this.filesearch.get_library_candidates(staticlib_prefix, staticlib_suffix, this.path_kind)) {
        crate_rejections.via_kind.push({ path, got: "static" });
      }
    }

    // We have now collected all known libraries into a set of candidates
    // keyed of the filename hash listed. For each filename, we also have a
    // list of rlibs/dylibs that apply. Here, we map each of these lists
    // (per hash), to a Library candidate for returning.
    //
    // A Library candidate is created if the metadata for the set of
    // libraries corresponds to the crate id and hash criteria that this
    // search is being performed for.
    const libraries = new Map<Svh, Library>();
    for (const [_hash, [rlibs, rmetas, dylibs, interfaces]] of candidates) {
      const r = this.extract_lib(crate_rejections, rlibs, rmetas, dylibs, interfaces);
      if (r.$ === "Err") return r;
      if (r._0 !== undefined) {
        const [svh, lib] = r._0;
        libraries.set(svh, lib);
      }
    }

    // Having now translated all relevant found hashes into libraries, see
    // what we've got and figure out if we found multiple candidates for
    // libraries or not.
    switch (libraries.size) {
      case 0:
        return Ok(undefined);
      case 1:
        return Ok(unwrap(libraries.values().next().value));
      default: {
        const candidates: PathBuf[] = [...libraries.values()].map((lib) => unwrap(lib.source.paths()[0]));
        candidates.sort(PathBuf_cmp);

        return Err({
          $: "MultipleCandidates",
          _0: this.crate_name,
          // these are the same for all candidates
          _1: get_flavor_from_path(unwrap(candidates[0])),
          _2: candidates,
        });
      }
    }
  }

  // rustc: compiler/rustc_metadata/src/locator.rs:522 extract_lib
  extract_lib(
    crate_rejections: CrateRejections,
    rlibs: Set<PathBuf>,
    rmetas: Set<PathBuf>,
    dylibs: Set<PathBuf>,
    interfaces: Set<PathBuf>,
  ): Result<[Svh, Library] | undefined, CrateError> {
    const slot: MutRef<Slot | undefined> = { value: undefined };
    // Order here matters, rmeta should come first.
    //
    // Make sure there's at most one rlib and at most one dylib.
    //
    // See comment in `extract_one` below.
    const rmeta = this.extract_one(crate_rejections, rmetas, CrateFlavor.Rmeta, slot);
    if (rmeta.$ === "Err") return rmeta;
    const rlib = this.extract_one(crate_rejections, rlibs, CrateFlavor.Rlib, slot);
    if (rlib.$ === "Err") return rlib;
    const sdylib_interface = this.extract_one(crate_rejections, interfaces, CrateFlavor.SDylib, slot);
    if (sdylib_interface.$ === "Err") return sdylib_interface;
    const dylib = this.extract_one(crate_rejections, dylibs, CrateFlavor.Dylib, slot);
    if (dylib.$ === "Err") return dylib;

    if (sdylib_interface._0 !== undefined && dylib._0 === undefined) {
      return Err({ $: "FullMetadataNotFound", _0: this.crate_name, _1: CrateFlavor.SDylib });
    }

    const source = new CrateSource(dylib._0, rlib._0, rmeta._0, sdylib_interface._0);
    const s = slot.value;
    return Ok(s === undefined ? undefined : [s[0], { source, metadata: s[1] }]);
  }

  // rustc: compiler/rustc_metadata/src/locator.rs:550 needs_crate_flavor
  needs_crate_flavor(flavor: CrateFlavor): boolean {
    if (flavor === CrateFlavor.Dylib && this.is_proc_macro) {
      return true;
    }

    if (this.only_needs_metadata) {
      return flavor === CrateFlavor.Rmeta;
    } else {
      // we need all flavors (perhaps not true, but what we do for now)
      return true;
    }
  }

  // Attempts to extract *one* library from the set `m`. If the set has no
  // elements, `None` is returned. If the set has more than one element, then
  // the errors and notes are emitted about the set of libraries.
  //
  // With only one library in the set, this function will extract it, and then
  // read the metadata from it if `*slot` is `None`. If the metadata couldn't
  // be read, it is assumed that the file isn't a valid rust library (no
  // errors are emitted).
  //
  // The `PathBuf` in `slot` will only be used for diagnostic purposes.
  // rustc: compiler/rustc_metadata/src/locator.rs:573 extract_one
  extract_one(crate_rejections: CrateRejections, m: Set<PathBuf>, flavor: CrateFlavor, slot: MutRef<Slot | undefined>): Result<PathBuf | undefined, CrateError> {
    // If we are producing an rlib, and we've already loaded metadata, then
    // we should not attempt to discover further crate sources (unless we're
    // locating a proc macro; exact logic is in needs_crate_flavor). This means
    // that under -Zbinary-dep-depinfo we will not emit a dependency edge on
    // the *unused* rlib, and by returning `None` here immediately we
    // guarantee that we do indeed not use it.
    //
    // See also #68149 which provides more detail on why emitting the
    // dependency on the rlib is a bad thing.
    if (slot.value !== undefined) {
      if (m.size === 0 || !this.needs_crate_flavor(flavor)) {
        return Ok(undefined);
      }
    }

    let ret: PathBuf | undefined = undefined;
    let err_data: PathBuf[] | undefined = undefined;
    for (const lib of m) {
      // info!("{} reading metadata from: {}", flavor, lib.display());
      if (flavor === CrateFlavor.Rmeta && file_len(lib) === 0) {
        // Empty files will cause get_metadata_section to fail. Rmeta
        // files can be empty, for example with binaries (which can
        // often appear with `cargo check` when checking a library as
        // a unittest). We don't want to emit a user-visible warning
        // in this case as it is not a real problem.
        // debug!("skipping empty file");
        continue;
      }
      let hash: Svh;
      let metadata: MetadataBlob;
      const r = get_metadata_section(this.target, flavor, lib, this.metadata_loader, this.cfg_version, this.crate_name);
      if (r.$ === "Ok") {
        const blob = r._0;
        const h = this.crate_matches(crate_rejections, blob, lib);
        if (h !== undefined) {
          [hash, metadata] = [h, blob];
        } else {
          // info!("metadata mismatch");
          continue;
        }
      } else {
        const err = r._0;
        if (err.$ === "VersionMismatch") {
          const { found_version } = err;
          // The file was present and created by the same compiler version, but we
          // couldn't load it for some reason. Give a hard error instead of silently
          // ignoring it, but only if we would have given an error anyway.
          // info!("Rejecting via version: expected {} got {}", expected_version, found_version);
          crate_rejections.via_version.push({ path: lib, got: found_version });
          continue;
        } else if (err.$ === "LoadFailure") {
          // info!("no metadata found: {}", err);
          // Metadata was loaded from interface file earlier.
          if (slot.value !== undefined && slot.value[3] === CrateFlavor.SDylib) {
            ret = lib;
            continue;
          }
          // The file was present and created by the same compiler version, but we
          // couldn't load it for some reason. Give a hard error instead of silently
          // ignoring it, but only if we would have given an error anyway.
          crate_rejections.via_invalid.push({ path: lib, got: err._0 });
          continue;
        } else {
          // Err(err @ MetadataError::NotPresent(_))
          // info!("no metadata found: {}", err);
          continue;
        }
      }
      // If we see multiple hashes, emit an error about duplicate candidates.
      if (slot.value !== undefined && slot.value[0] !== hash) {
        if (err_data !== undefined) {
          const candidates = err_data;
          return Err({ $: "MultipleCandidates", _0: this.crate_name, _1: flavor, _2: candidates });
        }
        const taken = slot.value;
        slot.value = undefined;
        err_data = [taken[2]];
      }
      if (err_data !== undefined) {
        const candidates = err_data;
        candidates.push(lib);
        continue;
      }

      // We error eagerly here. If we're locating a rlib, then in theory the full metadata
      // could still be in a (later resolved) dylib. In practice, if the rlib and dylib
      // were produced in a way where one has full metadata and the other hasn't, it would
      // mean that they were compiled using different compiler flags and probably also have
      // a different SVH value.
      if (metadata.get_header().is_stub) {
        // `is_stub` should never be true for .rmeta files.
        assert(flavor !== CrateFlavor.Rmeta, `assertion \`left != right\` failed\n  left: ${flavor}\n right: ${CrateFlavor.Rmeta}`);

        // Because rmeta files are resolved before rlib/dylib files, if this is a stub and
        // we haven't found a slot already, it means that the full metadata is missing.
        if (slot.value === undefined) {
          return Err({ $: "FullMetadataNotFound", _0: this.crate_name, _1: flavor });
        }
      } else {
        slot.value = [hash, metadata, lib, flavor];
      }
      ret = lib;
    }

    if (err_data !== undefined) {
      const candidates = err_data;
      return Err({ $: "MultipleCandidates", _0: this.crate_name, _1: flavor, _2: candidates });
    } else {
      return Ok(ret);
    }
  }

  // rustc: compiler/rustc_metadata/src/locator.rs:698 crate_matches
  crate_matches(crate_rejections: CrateRejections, metadata: MetadataBlob, libpath: PathBuf): Svh | undefined {
    const header = metadata.get_header();
    if (header.is_proc_macro_crate !== this.is_proc_macro) {
      // info!("Rejecting via proc macro: expected {} got {}", self.is_proc_macro, header.is_proc_macro_crate);
      return undefined;
    }

    if (this.exact_paths.length === 0 && this.crate_name !== header.name) {
      // info!("Rejecting via crate name");
      return undefined;
    }

    if (!TargetTuple.eq(header.triple, this.tuple)) {
      // info!("Rejecting via crate triple: expected {} got {}", self.tuple, header.triple);
      crate_rejections.via_triple.push({ path: libpath, got: TargetTuple.display(header.triple) });
      return undefined;
    }

    const hash = metadata.get_crate_hash();
    if (this.hash !== undefined) {
      const expected_hash = this.hash;
      if (hash !== expected_hash) {
        // info!("Rejecting via hash: expected {} got {}", expected_hash, hash);
        crate_rejections.via_hash.push({ path: libpath, got: hash });
        return undefined;
      }
    }

    return hash;
  }

  // rustc: compiler/rustc_metadata/src/locator.rs:741 find_commandline_library
  find_commandline_library(crate_rejections: CrateRejections): Result<Library | undefined, CrateError> {
    // debug!("find_commandline_library {}", self.crate_name);

    // First, filter out all libraries that look suspicious. We only accept
    // files which actually exist that have the correct naming scheme for
    // rlibs/dylibs.
    const rlibs = new Set<PathBuf>();
    const rmetas = new Set<PathBuf>();
    const dylibs = new Set<PathBuf>();
    const sdylib_interfaces = new Set<PathBuf>();
    for (const loc of this.exact_paths) {
      const loc_canon = loc.canonicalized();
      const loc_orig = loc.original();
      if (!path_exists(loc_canon)) {
        return Err({ $: "ExternLocationNotExist", _0: this.crate_name, _1: loc_orig });
      }
      if (!path_is_file(loc_orig)) {
        return Err({ $: "ExternLocationNotFile", _0: this.crate_name, _1: loc_orig });
      }
      // Note to take care and match against the non-canonicalized name:
      // some systems save build artifacts into content-addressed stores
      // that do not preserve extensions, and then link to them using
      // e.g. symbolic links. If we canonicalize too early, we resolve
      // the symlink, the file type is lost and we might treat rlibs and
      // rmetas as dylibs.
      const file = path_file_name(loc_orig);
      if (file === undefined) {
        return Err({ $: "ExternLocationNotFile", _0: this.crate_name, _1: loc_orig });
      }
      if (file.startsWith("lib")) {
        if (file.endsWith(".rlib")) {
          rlibs.add(loc_canon);
          continue;
        }
        if (file.endsWith(".rmeta")) {
          rmetas.add(loc_canon);
          continue;
        }
        if (file.endsWith(".rs")) {
          sdylib_interfaces.add(loc_canon);
        }
      }
      const dll_prefix = this.target.dll_prefix;
      const dll_suffix = this.target.dll_suffix;
      if (file.startsWith(dll_prefix) && file.endsWith(dll_suffix)) {
        dylibs.add(loc_canon);
        continue;
      }
      crate_rejections.via_filename.push({ path: loc_orig, got: "" });
    }

    // Extract the dylib/rlib/rmeta triple.
    const r = this.extract_lib(crate_rejections, rlibs, rmetas, dylibs, sdylib_interfaces);
    if (r.$ === "Err") return r;
    return Ok(r._0 === undefined ? undefined : r._0[1]);
  }

  // rustc: compiler/rustc_metadata/src/locator.rs:801 into_error
  into_error(crate_rejections: CrateRejections, dep_root: CratePaths | undefined): CrateError {
    return {
      $: "LocatorCombined",
      _0: {
        crate_name: this.crate_name,
        dep_root,
        triple: this.tuple,
        dll_prefix: this.target.dll_prefix,
        dll_suffix: this.target.dll_suffix,
        crate_rejections,
      },
    };
  }
}

/** `Option<(Svh, MetadataBlob, PathBuf, CrateFlavor)>`: the `slot` of `extract_lib` / `extract_one`. */
type Slot = [Svh, MetadataBlob, PathBuf, CrateFlavor];

// #[derive(Clone, Debug)]
export class CratePaths {
  constructor(
    public name: Symbol,
    public source: CrateSource,
  ) {}

  // rustc: compiler/rustc_metadata/src/locator.rs:268 new
  static new(name: Symbol, source: CrateSource): CratePaths {
    return new CratePaths(name, source);
  }
}

// #[derive(Copy, Clone, Debug, PartialEq)]
export type CrateFlavor = "Rlib" | "Rmeta" | "Dylib" | "SDylib";
export const CrateFlavor = { Rlib: "Rlib", Rmeta: "Rmeta", Dylib: "Dylib", SDylib: "SDylib" } as const;

/** `impl fmt::Display for CrateFlavor` */
// rustc: compiler/rustc_metadata/src/locator.rs:282 fmt
export function display_CrateFlavor(self: CrateFlavor): string {
  switch (self) {
    case "Rlib":
      return "rlib";
    case "Rmeta":
      return "rmeta";
    case "Dylib":
      return "dylib";
    case "SDylib":
      return "sdylib";
  }
}

/** `impl IntoDiagArg for CrateFlavor` */
// rustc: compiler/rustc_metadata/src/locator.rs:293 into_diag_arg
export function CrateFlavor_into_diag_arg(self: CrateFlavor, _: MutRef<PathBuf | undefined>): DiagArgValue {
  switch (self) {
    case "Rlib":
      return { $: "Str", _0: "rlib" };
    case "Rmeta":
      return { $: "Str", _0: "rmeta" };
    case "Dylib":
      return { $: "Str", _0: "dylib" };
    case "SDylib":
      return { $: "Str", _0: "sdylib" };
  }
}

// rustc: compiler/rustc_metadata/src/locator.rs:817 get_metadata_section
function get_metadata_section(
  target: Target,
  flavor: CrateFlavor,
  filename: PathBuf,
  loader: MetadataLoader,
  cfg_version: string,
  crate_name: Symbol | undefined,
): Result<MetadataBlob, MetadataError> {
  if (!path_exists(filename)) {
    return Err({ $: "NotPresent", _0: filename });
  }
  let raw_bytes: Uint8Array;
  switch (flavor) {
    case "Rlib": {
      const r = loader.get_rlib_metadata(target, filename);
      if (r.$ === "Err") return Err({ $: "LoadFailure", _0: r._0 });
      raw_bytes = r._0;
      break;
    }
    case "SDylib": {
      // PORT: compiling the interface runs `std::env::current_exe()` (the compiler binary) as a subprocess
      // (`--emit=metadata -Zbuild-sdylib-interface`) into a temp dir; rust-ts has no compiler binary of its own
      // and does not emit metadata yet (M5).
      return unported("rustc_metadata::locator::get_metadata_section (sdylib interface: compiles it with the current compiler binary)");
    }
    case "Dylib": {
      const r = loader.get_dylib_metadata(target, filename);
      if (r.$ === "Err") return Err({ $: "LoadFailure", _0: r._0 });
      const buf = r._0;
      const header_len = METADATA_HEADER.length;
      // header + u64 length of data
      const data_start = header_len + 8;

      // debug!("checking {} bytes of metadata-version stamp", header_len);
      const header = buf.subarray(0, Math.min(header_len, buf.length));
      if (!bytes_eq(header, METADATA_HEADER)) {
        return Err({ $: "LoadFailure", _0: `invalid metadata version found: ${filename}` });
      }

      // Length of the metadata - this allows linkers to pad the section if they want
      const len_bytes = buf.subarray(header_len, Math.min(data_start, buf.length));
      if (len_bytes.length !== 8) {
        return Err({ $: "LoadFailure", _0: "invalid metadata length found" });
      }
      // PORT: `u64::from_le_bytes(len_bytes) as usize`; the slice below panics (as upstream's index does) when
      // the length runs past the buffer, so the value is compared as a bigint before it becomes a number.
      const metadata_len = new DataView(len_bytes.buffer, len_bytes.byteOffset, 8).getBigUint64(0, true);

      // Header is okay -> inflate the actual metadata
      const end = BigInt(data_start) + metadata_len;
      if (end > BigInt(buf.length)) {
        return panic(`range end index ${end} out of range for slice of length ${buf.length}`);
      }
      raw_bytes = buf.subarray(data_start, Number(end));
      break;
    }
    case "Rmeta": {
      const r = get_rmeta_metadata_section(filename);
      if (r.$ === "Err") return r;
      raw_bytes = r._0;
      break;
    }
  }
  const blob_r = MetadataBlob.new(raw_bytes);
  if (blob_r.$ === "Err") {
    return Err({ $: "LoadFailure", _0: `corrupt metadata encountered in ${filename}` });
  }
  const blob = blob_r._0;
  const compat = blob.check_compatibility(cfg_version);
  if (compat.$ === "Ok") {
    // debug!("metadata blob read okay");
    return Ok(blob);
  } else if (compat._0 === undefined) {
    return Err({ $: "LoadFailure", _0: `invalid metadata version found: ${filename}` });
  } else {
    const found_version = compat._0;
    return Err({ $: "VersionMismatch", expected_version: rustc_version(cfg_version), found_version });
  }
}

// rustc: compiler/rustc_metadata/src/locator.rs:936 get_rmeta_metadata_section
function get_rmeta_metadata_section(filename: PathBuf): Result<Uint8Array, MetadataError> {
  // mmap the file, because only a small fraction of it is read.
  let file: number;
  try {
    file = openSync(filename, "r");
  } catch {
    return Err({ $: "LoadFailure", _0: `failed to open rmeta metadata: '${filename}'` });
  }
  // PORT: `Mmap::map(file)` (memmap2 0.2.3) reads the whole file instead (`Bun.mmap` opens files read-write, which
  // fails on read-only sysroots). memmap2 refuses zero-length maps (`InvalidInput`), so an empty file is a map
  // error here too.
  let mmap: Uint8Array | undefined;
  try {
    const len = fstatSync(file).size;
    if (len !== 0) {
      const buf = new Uint8Array(len);
      let off = 0;
      while (off < len) {
        const n = readSync(file, buf, off, len - off, off);
        if (n === 0) break;
        off += n;
      }
      mmap = buf.subarray(0, off);
    }
  } catch {
    mmap = undefined;
  } finally {
    closeSync(file);
  }
  if (mmap === undefined) {
    return Err({ $: "LoadFailure", _0: `failed to mmap rmeta metadata: '${filename}'` });
  }

  return Ok(mmap);
}

/// A diagnostic function for dumping crate metadata to an output stream.
// rustc: compiler/rustc_metadata/src/locator.rs:956 list_file_metadata
export function list_file_metadata(
  target: Target,
  path: PathBuf,
  metadata_loader: MetadataLoader,
  out: Write,
  ls_kinds: readonly string[],
  cfg_version: string,
): IoResult<void> {
  const flavor = get_flavor_from_path(path);
  const r = get_metadata_section(target, flavor, path, metadata_loader, cfg_version, undefined);
  if (r.$ === "Ok") {
    return r._0.list_crate_metadata(out, ls_kinds);
  } else {
    return Err(io_error_other(display_MetadataError(r._0)));
  }
}

// rustc: compiler/rustc_metadata/src/locator.rs:971 get_flavor_from_path
function get_flavor_from_path(path: PathBuf): CrateFlavor {
  const filename = unwrap(path_file_name(path));

  if (filename.endsWith(".rlib")) {
    return CrateFlavor.Rlib;
  } else if (filename.endsWith(".rmeta")) {
    return CrateFlavor.Rmeta;
  } else {
    return CrateFlavor.Dylib;
  }
}

/// A function to fetch all macros inside a proc-macro crate.
///
/// Used by rust-analyzer-proc-macro-srv.
// rustc: compiler/rustc_metadata/src/locator.rs:986 get_proc_macros
export function get_proc_macros(path: PathBuf, metadata_loader: MetadataLoader, cfg_version: string): IoResult<[ProcMacroClient, ProcMacroKind][]> {
  const host_tuple = TargetTuple.from_tuple(config.host_tuple());
  const [host] = unwrap_result(Target.search(host_tuple, "", false), (e) => debug_str(e));

  const r = get_metadata_section(host, CrateFlavor.Dylib, path, metadata_loader, cfg_version, undefined);
  if (r.$ === "Err") return Err(io_error_other(display_MetadataError(r._0)));
  const metadata = r._0;
  const stable_crate_id = metadata.get_root().stable_crate_id();

  const c = dlsym_proc_macros(path, stable_crate_id);
  if (c.$ === "Err") {
    // let (crate::DylibError::DlOpen(path, err) | crate::DylibError::DlSym(path, err)) = err;
    const [path, err] = [c._0._0, c._0._1];
    return Err(io_error_other(`${path}${err}`));
  }
  const clients = c._0;

  const proc_macro_info = metadata.get_proc_macro_info();
  assert(
    proc_macro_info.length === clients.length,
    `assertion \`left == right\` failed\n  left: ${proc_macro_info.length}\n right: ${clients.length}`,
  );

  return Ok(clients.map((client, i): [ProcMacroClient, ProcMacroKind] => [client, proc_macro_info[i]]));
}

// ------------------------------------------ Error reporting -------------------------------------

// #[derive(Clone, Debug)]
interface CrateMismatch {
  path: PathBuf;
  got: string;
}

// #[derive(Clone, Debug, Default)]
export class CrateRejections {
  constructor(
    public via_hash: CrateMismatch[],
    public via_triple: CrateMismatch[],
    public via_kind: CrateMismatch[],
    public via_version: CrateMismatch[],
    public via_filename: CrateMismatch[],
    public via_invalid: CrateMismatch[],
  ) {}

  /** `#[derive(Default)]` */
  static default(): CrateRejections {
    return new CrateRejections([], [], [], [], [], []);
  }
}

/// Candidate rejection reasons collected during crate search.
/// If no candidate is accepted, then these reasons are presented to the user,
/// otherwise they are ignored.
// #[derive(Debug)]
export interface CombinedLocatorError {
  crate_name: Symbol;
  dep_root: CratePaths | undefined;
  triple: TargetTuple;
  dll_prefix: string;
  dll_suffix: string;
  crate_rejections: CrateRejections;
}

// #[derive(Debug)]
export type CrateError =
  | { readonly $: "NonAsciiName"; readonly _0: Symbol }
  | { readonly $: "ExternLocationNotExist"; readonly _0: Symbol; readonly _1: PathBuf }
  | { readonly $: "ExternLocationNotFile"; readonly _0: Symbol; readonly _1: PathBuf }
  | { readonly $: "MultipleCandidates"; readonly _0: Symbol; readonly _1: CrateFlavor; readonly _2: PathBuf[] }
  | { readonly $: "FullMetadataNotFound"; readonly _0: Symbol; readonly _1: CrateFlavor }
  | { readonly $: "SymbolConflictsCurrent"; readonly _0: Symbol }
  | { readonly $: "StableCrateIdCollision"; readonly _0: Symbol; readonly _1: Symbol }
  | { readonly $: "DlOpen"; readonly _0: string; readonly _1: string }
  | { readonly $: "DlSym"; readonly _0: string; readonly _1: string }
  | { readonly $: "LocatorCombined"; readonly _0: CombinedLocatorError }
  | { readonly $: "NotFound"; readonly _0: Symbol };

// #[derive(Debug)]
type MetadataError =
  /// The file was missing.
  | { readonly $: "NotPresent"; readonly _0: PathBuf }
  /// The file was present and invalid.
  | { readonly $: "LoadFailure"; readonly _0: string }
  /// The file was present, but compiled with a different rustc version.
  | { readonly $: "VersionMismatch"; readonly expected_version: string; readonly found_version: string };

/** `impl fmt::Display for MetadataError<'_>` */
// rustc: compiler/rustc_metadata/src/locator.rs:1067 fmt
function display_MetadataError(self: MetadataError): string {
  switch (self.$) {
    case "NotPresent": {
      const filename = self._0;
      return `no such file: '${filename}'`;
    }
    case "LoadFailure":
      return self._0;
    case "VersionMismatch": {
      const { expected_version, found_version } = self;
      return `rustc version mismatch. expected ${expected_version}, found ${found_version}`;
    }
  }
}

export const CrateError = {
  // rustc: compiler/rustc_metadata/src/locator.rs:1084 report
  report(self: CrateError, sess: Session, span: Span, missing_core: boolean): void {
    const dcx = sess.dcx();
    switch (self.$) {
      case "NonAsciiName": {
        const crate_name = self._0;
        dcx.emit_err(diagnostics.NonAsciiName_diagnostic({ span, crate_name }));
        break;
      }
      case "ExternLocationNotExist": {
        const [crate_name, loc] = [self._0, self._1];
        dcx.emit_err(diagnostics.ExternLocationNotExist_diagnostic({ span, crate_name, location: loc }));
        break;
      }
      case "ExternLocationNotFile": {
        const [crate_name, loc] = [self._0, self._1];
        dcx.emit_err(diagnostics.ExternLocationNotFile_diagnostic({ span, crate_name, location: loc }));
        break;
      }
      case "MultipleCandidates": {
        const [crate_name, flavor, candidates] = [self._0, self._1, self._2];
        dcx.emit_err(diagnostics.MultipleCandidates_diagnostic({ span, crate_name, flavor, candidates }));
        break;
      }
      case "FullMetadataNotFound": {
        const [crate_name, flavor] = [self._0, self._1];
        dcx.emit_err(diagnostics.FullMetadataNotFound_diagnostic({ span, crate_name, flavor }));
        break;
      }
      case "SymbolConflictsCurrent": {
        const root_name = self._0;
        dcx.emit_err(diagnostics.SymbolConflictsCurrent_diagnostic({ span, crate_name: root_name }));
        break;
      }
      case "StableCrateIdCollision": {
        const [crate_name0, crate_name1] = [self._0, self._1];
        dcx.emit_err(diagnostics.StableCrateIdCollision_diagnostic({ span, crate_name0, crate_name1 }));
        break;
      }
      case "DlOpen":
      case "DlSym": {
        const [path, err] = [self._0, self._1];
        dcx.emit_err(diagnostics.DlError_diagnostic({ span, path, err }));
        break;
      }
      case "LocatorCombined": {
        const locator = self._0;
        const crate_name = locator.crate_name;
        let add_info: string;
        if (locator.dep_root === undefined) {
          add_info = "";
        } else {
          const r = locator.dep_root;
          add_info = ` which \`${display_Symbol(r.name)}\` depends on`;
        }
        if (locator.crate_rejections.via_filename.length !== 0) {
          const mismatches = locator.crate_rejections.via_filename;
          for (const { path } of mismatches) {
            dcx.emit_err(diagnostics.CrateLocationUnknownType_diagnostic({ span, path, crate_name }));
            dcx.emit_err(diagnostics.LibFilenameForm_diagnostic({ span, dll_prefix: locator.dll_prefix, dll_suffix: locator.dll_suffix }));
          }
        }
        let found_crates = "";
        if (locator.crate_rejections.via_hash.length !== 0) {
          const mismatches = locator.crate_rejections.via_hash;
          for (const { path } of mismatches) {
            found_crates += `\ncrate \`${display_Symbol(crate_name)}\`: ${path}`;
          }
          if (locator.dep_root !== undefined) {
            const r = locator.dep_root;
            for (const path of r.source.paths()) {
              found_crates += `\ncrate \`${display_Symbol(r.name)}\`: ${path}`;
            }
          }
          dcx.emit_err(diagnostics.NewerCrateVersion_diagnostic({ span, crate_name, add_info, found_crates }));
        } else if (locator.crate_rejections.via_triple.length !== 0) {
          const mismatches = locator.crate_rejections.via_triple;
          for (const { path, got } of mismatches) {
            found_crates += `\ncrate \`${display_Symbol(crate_name)}\`, target triple ${got}: ${path}`;
          }
          dcx.emit_err(
            diagnostics.NoCrateWithTriple_diagnostic({
              span,
              crate_name,
              locator_triple: TargetTuple.tuple(locator.triple),
              add_info,
              found_crates,
            }),
          );
        } else if (locator.crate_rejections.via_kind.length !== 0) {
          const mismatches = locator.crate_rejections.via_kind;
          for (const { path } of mismatches) {
            found_crates += `\ncrate \`${display_Symbol(crate_name)}\`: ${path}`;
          }
          dcx.emit_err(diagnostics.FoundStaticlib_diagnostic({ span, crate_name, add_info, found_crates }));
        } else if (locator.crate_rejections.via_version.length !== 0) {
          const mismatches = locator.crate_rejections.via_version;
          for (const { path, got } of mismatches) {
            found_crates += `\ncrate \`${display_Symbol(crate_name)}\` compiled by ${got}: ${path}`;
          }
          dcx.emit_err(
            diagnostics.IncompatibleRustc_diagnostic({
              span,
              crate_name,
              add_info,
              found_crates,
              rustc_version: rustc_version(sess.cfg_version),
            }),
          );
        } else if (locator.crate_rejections.via_invalid.length !== 0) {
          const crate_rejections: string[] = [];
          for (const { got } of locator.crate_rejections.via_invalid) {
            crate_rejections.push(got);
          }
          dcx.emit_err(diagnostics.InvalidMetadataFiles_diagnostic({ span, crate_name, add_info, crate_rejections }));
        } else {
          const error: diagnostics.CannotFindCrate = {
            span,
            crate_name,
            add_info,
            missing_core,
            current_crate: sess.opts.crate_name ?? "<unknown>",
            is_nightly_build: sess.is_nightly_build(),
            profiler_runtime: Symbol.intern(sess.opts.unstable_opts.profiler_runtime),
            locator_triple: locator.triple,
            is_ui_testing: sess.opts.unstable_opts.ui_testing,
            is_tier_3: sess.target.metadata.tier === 3,
          };
          // The diagnostic for missing core is very good, but it is followed by a lot of
          // other diagnostics that do not add information.
          if (missing_core) {
            dcx.emit_fatal(diagnostics.CannotFindCrate_diagnostic(error));
          } else {
            dcx.emit_err(diagnostics.CannotFindCrate_diagnostic(error));
          }
        }
        break;
      }
      case "NotFound": {
        const crate_name = self._0;
        const error: diagnostics.CannotFindCrate = {
          span,
          crate_name,
          add_info: "",
          missing_core,
          current_crate: sess.opts.crate_name ?? "<unknown>",
          is_nightly_build: sess.is_nightly_build(),
          profiler_runtime: Symbol.intern(sess.opts.unstable_opts.profiler_runtime),
          locator_triple: sess.opts.target_triple,
          is_ui_testing: sess.opts.unstable_opts.ui_testing,
          is_tier_3: sess.target.metadata.tier === 3,
        };
        // The diagnostic for missing core is very good, but it is followed by a lot of
        // other diagnostics that do not add information.
        if (missing_core) {
          dcx.emit_fatal(diagnostics.CannotFindCrate_diagnostic(error));
        } else {
          dcx.emit_err(diagnostics.CannotFindCrate_diagnostic(error));
        }
        break;
      }
    }
  },
} as const;

// ---- std helpers (PORT: local to this file; src/std has no fs/Path counterparts yet) ----

/** `Path::exists` (`fs::metadata(path).is_ok()`, follows symlinks). */
function path_exists(path: PathBuf): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** `Path::is_file` (`fs::metadata(path).map(|m| m.is_file()).unwrap_or(false)`). */
function path_is_file(path: PathBuf): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** `lib.metadata().is_ok_and(|m| m.len() == 0)`: the file length, `undefined` when `fs::metadata` fails. */
function file_len(path: PathBuf): number | undefined {
  try {
    return statSync(path).size;
  } catch {
    return undefined;
  }
}

/** `<[u8] as PartialEq>::eq` */
function bytes_eq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const COMPONENT_ORDER = { Prefix: 0, RootDir: 1, CurDir: 2, ParentDir: 3, Normal: 4 } as const;

/** `impl Ord for PathBuf` (`compare_components`: component-wise, `Component`'s derived `Ord`). */
function PathBuf_cmp(a: PathBuf, b: PathBuf): number {
  const x = path_components(a);
  const y = path_components(b);
  for (;;) {
    const l = x.next();
    const r = y.next();
    if (l === undefined || r === undefined) return l === undefined ? (r === undefined ? 0 : -1) : 1;
    if (l.$ !== r.$) return COMPONENT_ORDER[l.$] - COMPONENT_ORDER[r.$];
    if (l.$ === "Prefix" && r.$ === "Prefix") {
      const c = os_str_cmp(l.raw, r.raw);
      if (c !== 0) return c;
    } else if (l.$ === "Normal" && r.$ === "Normal") {
      const c = os_str_cmp(l._0, r._0);
      if (c !== 0) return c;
    }
  }
}

/** `OsStr`'s `Ord` on unix (byte order; for UTF-8 that is code point order). */
function os_str_cmp(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}
