// Port of compiler/rustc_metadata/src/rmeta/parameterized.rs.
//
// PORT (lane rmeta-contract): `trait ParameterizedOverTcx { type Value<'tcx>; }` maps a `'static` metadata type
// to the same type at another lifetime (`T::Value<'tcx>`). TS has no lifetimes, so every impl
// (`trivially_parameterized_over_tcx!`, `parameterized_over_tcx!`, the `Option` / tuple / `Vec` / `IndexVec` /
// `UnordMap` / `Binder` / `EarlyBinder` / `LazyValue` / `LazyArray` / `Region` / `GenericArg` impls) is the
// identity: `T::Value<'tcx>` is `T`. The file has no fns.

/** `<T as ParameterizedOverTcx>::Value<'tcx>`: `T` (lifetimes are erased). */
export type Value<T> = T;
