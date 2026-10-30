// Port of compiler/rustc_middle/src/middle/dependency_format.rs.
//! Type definitions for learning about the dependency formats of all upstream
//! crates (rlibs/dylibs/oh my).
//!
//! For all the gory details, see the provider of the `dependency_formats`
//! query.
//
// PORT: hand-written types (rustc_middle types are hand-written, see codegen set `rustc_middle`'s note). The derived
// `StableHash`/`Encodable`/`Decodable` of `Linkage` are not ported: `Linkage` is not part of crate metadata (only
// rlink files, `-Zno-link`, carry it) and nothing hashes the `dependency_formats` result without incremental.

// FIXME: move this file to rustc_metadata::dependency_format, but
// this will introduce circular dependency between rustc_metadata and rustc_middle

import type { CrateType } from "../../rustc_structures/crate_type.ts";
import type { Debug } from "../../std/fmt.ts";

/// A list of dependencies for a certain crate type.
// PORT: `IndexVec<CrateNum, Linkage>` is an array indexed by the `CrateNum` (PORTING section 5).
export type DependencyList = Linkage[];

/// A mapping of all required dependencies for a particular flavor of output.
///
/// This is local to the tcx, and is generally relevant to one session.
// PORT: `FxIndexMap` is an insertion-ordered `Map` (PORTING section 5).
export type Dependencies = Map<CrateType, DependencyList>;

// rustc-type: compiler/rustc_middle/src/middle/dependency_format.rs:24 Linkage
// #[derive(Copy, Clone, PartialEq, Debug, StableHash, Encodable, Decodable)]
export type Linkage = "NotLinked" | "IncludedFromDylib" | "Static" | "Dynamic";
export const Linkage = { NotLinked: "NotLinked", IncludedFromDylib: "IncludedFromDylib", Static: "Static", Dynamic: "Dynamic" } as const;
/** `#[derive(Debug)]` */
export const debug_Linkage: Debug<Linkage> = (v) => v;
