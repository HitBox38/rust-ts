// PORT: stand-ins for types of crates that are not ported in this lane's base, used by the generated
// rustc_attr_ir types (tools/codegen/typemap.attr_ir.json points at this module):
//   (rustc_structures types now come from src/rustc_structures, lane hir-def)
//   - rustc_abi::Align (not ported yet)
// They are opaque on purpose: no value can be built here and every Debug / Display call is `unported`,
// so nothing guesses their representation. Root, on integration: repoint the typemap.attr_ir.json
// entries at the real modules, regenerate the rustc_attr_ir set, and delete this file.
import type { Debug } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";

export type Align = { readonly __standin: "rustc_abi::Align" };
export const debug_Align: Debug<Align> = () => unported("rustc_abi::Align Debug (stand-in, rustc_abi not ported)");





