//@ compile-flags: -Zwrite-long-types-to-disk=no
// Copied from tests/ui/codegen/normalization-overflow/recursion-issue-137823.rs at the pin: `items_of_instance` fails with
// NormalizationErrorInMono, reported as RecursionLimit. The flag is one compiletest passes.
//@ build-fail

// Regression test for issue #137823
// Tests that recursive monomorphization with associated types produces
// a proper "recursion limit" error instead of an ICE.

fn convert<S: Converter>() -> S::Out {
    convert2::<ConvertWrap<S>>()
    //~^ ERROR: reached the recursion limit while instantiating
}

fn convert2<S: Converter>() -> S::Out {
    convert::<S>()
}

fn main() {
    convert::<Ser>();
}

trait Converter {
    type Out;
}

struct Ser;

impl Converter for Ser {
    type Out = ();
}

struct ConvertWrap<S> {
    _d: S,
}

impl<S> Converter for ConvertWrap<S>
where
    S: Converter,
{
    type Out = S::Out;
}
