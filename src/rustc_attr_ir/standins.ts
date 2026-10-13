// PORT: stand-ins for types of crates that are not ported in this lane's base, used by the generated
// rustc_attr_ir types (tools/codegen/typemap.attr_ir.json points at this module):
//   - rustc_structures::{CollapseMacroDebuginfo, CrateType, Limit, NativeLibKind, SanitizerSet} (lane hir-def)
//   - rustc_abi::Align (not ported yet)
// They are opaque on purpose: no value can be built here and every Debug / Display call is `unported`,
// so nothing guesses their representation. Root, on integration: repoint the typemap.attr_ir.json
// entries at the real modules, regenerate the rustc_attr_ir set, and delete this file.
import type { Debug } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";

export type Align = { readonly __standin: "rustc_abi::Align" };
export const debug_Align: Debug<Align> = () => unported("rustc_abi::Align Debug (stand-in, rustc_abi not ported)");

export type CollapseMacroDebuginfo = { readonly __standin: "rustc_structures::CollapseMacroDebuginfo" };
export const debug_CollapseMacroDebuginfo: Debug<CollapseMacroDebuginfo> = () =>
  unported("rustc_structures::CollapseMacroDebuginfo Debug (stand-in, rustc_structures not ported)");

export type CrateType = { readonly __standin: "rustc_structures::CrateType" };
export const debug_CrateType: Debug<CrateType> = () => unported("rustc_structures::CrateType Debug (stand-in, rustc_structures not ported)");

export type Limit = { readonly __standin: "rustc_structures::Limit" };
export const debug_Limit: Debug<Limit> = () => unported("rustc_structures::Limit Debug (stand-in, rustc_structures not ported)");
/** `impl fmt::Display for Limit` (stand-in). */
export const display_Limit = (_v: Limit): string => unported("rustc_structures::Limit Display (stand-in, rustc_structures not ported)");

export type NativeLibKind = { readonly __standin: "rustc_structures::NativeLibKind" };
export const debug_NativeLibKind: Debug<NativeLibKind> = () =>
  unported("rustc_structures::NativeLibKind Debug (stand-in, rustc_structures not ported)");

export type SanitizerSet = { readonly __standin: "rustc_structures::SanitizerSet" };
export const debug_SanitizerSet: Debug<SanitizerSet> = () =>
  unported("rustc_structures::SanitizerSet Debug (stand-in, rustc_structures not ported)");
