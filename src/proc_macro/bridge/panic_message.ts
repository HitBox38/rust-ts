// Port of library/proc_macro/src/bridge/panic_message.rs (subset).
//
// PORT: the `From<Box<dyn Any + Send>>` conversions (both directions) and the RPC `Encode`/`Decode` impls move
// panic payloads across the bridge; they are M6 (decision D6) and not ported.

/// Simplified version of panic payloads, ignoring
/// types other than `&'static str` and `String`.
// std-type: library/proc_macro/src/bridge/panic_message.rs:7 PanicMessage
export type PanicMessage =
  | { readonly $: "StaticStr"; _0: string }
  | { readonly $: "String"; _0: string }
  | { readonly $: "Unknown" };

export const PanicMessage = {
  Unknown: Object.freeze({ $: "Unknown" as const }),

  // std: library/proc_macro/src/bridge/panic_message.rs:39 as_str
  as_str(self: PanicMessage): string | undefined {
    switch (self.$) {
      case "StaticStr":
        return self._0;
      case "String":
        return self._0;
      case "Unknown":
        return undefined;
    }
  },

  // std: library/proc_macro/src/bridge/panic_message.rs:47 into_string
  into_string(self: PanicMessage): string | undefined {
    switch (self.$) {
      case "StaticStr":
        return self._0;
      case "String":
        return self._0;
      case "Unknown":
        return undefined;
    }
  },
};
