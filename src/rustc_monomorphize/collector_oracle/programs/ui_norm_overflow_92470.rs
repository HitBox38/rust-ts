//@ compile-flags: -Zwrite-long-types-to-disk=no
// Copied from tests/ui/codegen/normalization-overflow/recursion-issue-92470.rs at the pin: `items_of_instance` fails with
// NormalizationErrorInMono, reported as RecursionLimit. The flag is one compiletest passes.
//@ build-fail
fn main() {
    encode(&mut EncoderImpl);
}

pub trait Encoder {
    type W;

    fn writer(&self) -> Self::W;
}

fn encode<E: Encoder>(mut encoder: E) {
//~^ WARN: function cannot return without recursing
    encoder.writer();
    encode(&mut encoder);
    //~^ ERROR: reached the recursion limit while instantiating
}

struct EncoderImpl;

impl Encoder for EncoderImpl {
    type W = ();

    fn writer(&self) {}
}

impl<'a, T: Encoder> Encoder for &'a mut T {
    type W = T::W;

    fn writer(&self) -> Self::W {
        panic!()
    }
}
