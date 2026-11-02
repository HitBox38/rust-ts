// Fill lane: `miri-shims-c` (plan-m6 wave 37): ported by this lane.
// Port of src/tools/miri/src/shims/unix/mod.rs (crate `miri`, plan-m6 D2): the module list and two made-up constants.
//
// PORT: the `mod` items are loaded by src/miri/lib.ts (decision C2/C10); the `pub use self::x::EvalContextExt as _`
// re-exports are the `declare module` augmentations of each module. `UnixEnvVars`, `UnixFileDescription`, `DirTable`,
// `ThreadNameResult` are imported from their own modules (a re-export here would make this module read theirs at load).
// The other-OS modules (android, freebsd, macos, netbsd, solarish) are out of scope (plan-m6 D2): their dispatch arms in
// foreign_items.ts stop `unported`.

// Make up some constants.
export const UID = 1000;
export const HOSTNAME: Uint8Array = new TextEncoder().encode("Miri");
