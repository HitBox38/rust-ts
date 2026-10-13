// Port of library/proc_macro/src/bridge/client.rs (subset: the `Client` handle type).
//
// PORT: everything else in client.rs (`Bridge`, `BridgeState`, the client-side handles and `Methods`,
// `Client::expand1` / `expand2`, `run_client`, `ProcMacro`) runs inside a proc-macro dylib; it is M6
// (decision D6). `Client::run1` / `run2` are defined in server.rs and attached by server.ts.

/// A client-side RPC entry-point, which may be using a different `proc_macro`
/// from the one used by the server, but can be invoked compatibly.
///
/// Note that the input and output type parameters are erased. They do not
/// participate in the ABI, so while using the wrong runN method will likely
/// result in a panic, it will not result in UB.
// std-type: library/proc_macro/src/bridge/client.rs:221 Client
// PORT: `run: extern "C" fn(BridgeConfig<'_>) -> Buffer` is the entry point of a loaded proc-macro dylib (M6);
// it is kept opaque.
export class Client {
  constructor(public run: unknown) {}
}
