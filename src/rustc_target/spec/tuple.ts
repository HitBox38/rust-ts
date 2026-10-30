// compiler/rustc_target/src/spec/tuple.rs
//
// Not ported (no markers): `impl Hash` (tuple.rs:38; dep tracking), `from_path` (tuple.rs:93; needs `try_canonicalize` and
// `Path::file_stem`; target JSON files are unported anyway) and the `TargetJson` arm of `debug_tuple`
// (needs std's `DefaultHasher`, SipHash-1-3).
import type { DiagArgValue } from "../../rustc_error_messages/lib.ts";
import type { PathBuf } from "../../rustc_span/lib.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { type Debug, debug_str, debug_struct, debug_tuple as debug_tuple_fmt } from "../../std/fmt.ts";
import { panic, unported } from "../../std/panic.ts";
import type { Decoder, Encoder } from "../../rustc_serialize/serialize.ts";
import type { Result } from "../../std/result.ts";

/// Either a target tuple string or a path to a JSON file.
// #[derive(Clone, Debug)]
export type TargetTuple =
  | { readonly $: "TargetTuple"; readonly _0: string }
  | {
      readonly $: "TargetJson";
      /// Warning: This field may only be used by rustdoc. Using it anywhere else will lead to
      /// inconsistencies as it is discarded during serialization.
      readonly path_for_rustdoc: PathBuf;
      readonly tuple: string;
      readonly contents: string;
    };

// Use a manual implementation to prevent encoding the target json file path in the crate metadata
// impl<S: Encoder> Encodable<S> for TargetTuple
// rustc: compiler/rustc_target/src/spec/tuple.rs:55 encode
export function encode_TargetTuple(self: TargetTuple, s: Encoder): void {
  switch (self.$) {
    case "TargetTuple": {
      const tuple = self._0;
      s.emit_u8(0);
      s.emit_str(tuple);
      break;
    }
    case "TargetJson": {
      const { tuple, contents } = self;
      s.emit_u8(1);
      s.emit_str(tuple);
      s.emit_str(contents);
      break;
    }
  }
}

// impl<D: Decoder> Decodable<D> for TargetTuple
// rustc: compiler/rustc_target/src/spec/tuple.rs:71 decode
export function decode_TargetTuple(d: Decoder): TargetTuple {
  switch (d.read_u8()) {
    case 0:
      return { $: "TargetTuple", _0: d.read_str() };
    case 1:
      return {
        $: "TargetJson",
        path_for_rustdoc: "", // PathBuf::new()
        tuple: d.read_str(),
        contents: d.read_str(),
      };
    default: {
      return panic("invalid enum variant tag while decoding `TargetTuple`, expected 0..2");
    }
  }
}

export const TargetTuple = {
  // Use a manual implementation to ignore the path field
  // impl PartialEq for TargetTuple
  // rustc: compiler/rustc_target/src/spec/tuple.rs:24 eq
  eq(self: TargetTuple, other: TargetTuple): boolean {
    if (self.$ === "TargetTuple" && other.$ === "TargetTuple") {
      return self._0 === other._0;
    } else if (self.$ === "TargetJson" && other.$ === "TargetJson") {
      return self.tuple === other.tuple && self.contents === other.contents;
    } else {
      return false;
    }
  },

  /// Creates a target tuple from the passed target tuple string.
  // rustc: compiler/rustc_target/src/spec/tuple.rs:88 from_tuple
  from_tuple(tuple: string): TargetTuple {
    return { $: "TargetTuple", _0: tuple };
  },

  /// Creates a target tuple from the passed target path.
  // not ported (no marker): tuple.rs:93 from_path
  from_path(_path: PathBuf): Result<TargetTuple, unknown> {
    return unported("rustc_target::spec::TargetTuple::from_path (--target <path>.json)");
  },

  /// Returns a string tuple for this target.
  ///
  /// If this target is a path, the file name (without extension) is returned.
  // rustc: compiler/rustc_target/src/spec/tuple.rs:113 tuple
  tuple(self: TargetTuple): string {
    switch (self.$) {
      case "TargetTuple":
        return self._0;
      case "TargetJson":
        return self.tuple;
    }
  },

  /// Returns an extended string tuple for this target.
  ///
  /// If this target is a path, a hash of the path is appended to the tuple returned
  /// by `tuple()`.
  // rustc: compiler/rustc_target/src/spec/tuple.rs:125 debug_tuple
  debug_tuple(self: TargetTuple): string {
    // use std::hash::DefaultHasher;

    switch (self.$) {
      case "TargetTuple":
        return self._0;
      case "TargetJson":
        // `let mut hasher = DefaultHasher::new(); content.hash(&mut hasher); format!("{tuple}-{hash}")`
        return unported("rustc_target::spec::TargetTuple::debug_tuple (TargetJson: std DefaultHasher)");
    }
  },

  // impl fmt::Display for TargetTuple
  // rustc: compiler/rustc_target/src/spec/tuple.rs:141 fmt
  display(self: TargetTuple): string {
    return TargetTuple.debug_tuple(self);
  },
} as const;

// #[derive(Debug)]
export const debug_TargetTuple: Debug<TargetTuple> = (v, f) => {
  switch (v.$) {
    case "TargetTuple":
      return debug_tuple_fmt(f, "TargetTuple", [debug_str(v._0)]);
    case "TargetJson":
      return debug_struct(f, "TargetJson", [
        ["path_for_rustdoc", debug_str(v.path_for_rustdoc)],
        ["tuple", debug_str(v.tuple)],
        ["contents", debug_str(v.contents)],
      ]);
  }
};

// into_diag_arg_using_display!(&TargetTuple);
// PORT: used by the session diagnostics that name a target tuple.
export function TargetTuple_into_diag_arg(self: TargetTuple, _path: MutRef<PathBuf | undefined>): DiagArgValue {
  return { $: "Str", _0: TargetTuple.display(self) };
}
