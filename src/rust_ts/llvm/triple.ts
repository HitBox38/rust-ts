// rust-ts: LLVM's `Triple` (llvm/lib/TargetParser/Triple.cpp, llvm/include/llvm/TargetParser/Triple.h) and the data layout a
// triple implies (`Triple::computeDataLayout`, llvm/lib/TargetParser/TargetDataLayout.cpp), as far as the IR model's target
// machine needs them (lane llir-init). Not ported code (PORTING §5c): each function follows its LLVM source, marked `// llvm:`.
//
// PORT: the model's `Triple` has no `SubArch`. `Triple::parseSubArch` (Triple.cpp:779) is long and nothing the model does reads
// the sub-architecture: `lookupTarget` matches on the arch, and the X86 and AArch64 data layouts read the arch, OS, environment
// and object format only (`isArm64e`, which reads it, is reached only by AArch64's MC subtarget, which the model answers from an
// oracle table: target.ts). A model function that would read it must port `parseSubArch` first.
import { unported } from "../../std/panic.ts";

/** `Triple::ArchType` (Triple.h:46). */
export type ArchType =
  | "UnknownArch" | "arm" | "armeb" | "aarch64" | "aarch64_be" | "aarch64_32" | "arc" | "avr" | "bpfel" | "bpfeb" | "csky" | "dxil"
  | "hexagon" | "loongarch32" | "loongarch64" | "m68k" | "mips" | "mipsel" | "mips64" | "mips64el" | "msp430" | "ppc" | "ppcle"
  | "ppc64" | "ppc64le" | "r600" | "amdgpu" | "riscv32" | "riscv64" | "riscv32be" | "riscv64be" | "sparc" | "sparcv9" | "sparcel"
  | "systemz" | "tce" | "tcele" | "tcele64" | "thumb" | "thumbeb" | "x86" | "x86_64" | "xcore" | "xtensa" | "nvptx" | "nvptx64"
  | "amdil" | "amdil64" | "hsail" | "hsail64" | "spir" | "spir64" | "spirv" | "spirv32" | "spirv64" | "kalimba" | "shave" | "lanai"
  | "wasm32" | "wasm64" | "renderscript32" | "renderscript64" | "ve";

/** `Triple::ObjectFormatType` (Triple.h). */
export type ObjectFormatType = "UnknownObjectFormat" | "COFF" | "DXContainer" | "ELF" | "GOFF" | "MachO" | "SPIRV" | "Wasm" | "XCOFF";

/** `TRIPLE_VENDOR` / `TRIPLE_VENDOR_ALIAS` of llvm/include/llvm/TargetParser/TripleName.def, in order: [enum, name]. */
const TRIPLE_VENDORS: readonly (readonly [string, string])[] = [
  ["AMD", "amd"], ["Apple", "apple"], ["CSR", "csr"], ["Freescale", "fsl"], ["IBM", "ibm"], ["ImaginationTechnologies", "img"],
  ["Intel", "intel"], ["Mesa", "mesa"], ["MipsTechnologies", "mti"], ["NVIDIA", "nvidia"], ["OpenEmbedded", "oe"], ["PC", "pc"],
  ["SCEI", "scei"], ["SCEI", "sie"], ["SUSE", "suse"], ["Meta", "meta"],
];
/** `TRIPLE_OS` / `TRIPLE_OS_ALIAS` of TripleName.def, in order: [enum, name]. */
const TRIPLE_OSES: readonly (readonly [string, string])[] = [
  ["Darwin", "darwin"], ["DragonFly", "dragonfly"], ["FreeBSD", "freebsd"], ["Fuchsia", "fuchsia"], ["IOS", "ios"],
  ["KFreeBSD", "kfreebsd"], ["Linux", "linux"], ["Lv2", "lv2"], ["MacOSX", "macosx"], ["MacOSX", "macos"], ["Managarm", "managarm"],
  ["NetBSD", "netbsd"], ["OpenBSD", "openbsd"], ["Solaris", "solaris"], ["UEFI", "uefi"], ["Win32", "windows"], ["Win32", "win32"],
  ["ZOS", "zos"], ["Haiku", "haiku"], ["RTEMS", "rtems"], ["AIX", "aix"], ["CUDA", "cuda"], ["NVCL", "nvcl"], ["AMDHSA", "amdhsa"],
  ["PS4", "ps4"], ["PS5", "ps5"], ["ELFIAMCU", "elfiamcu"], ["TvOS", "tvos"], ["WatchOS", "watchos"], ["BridgeOS", "bridgeos"],
  ["DriverKit", "driverkit"], ["XROS", "xros"], ["XROS", "visionos"], ["Mesa3D", "mesa3d"], ["AMDPAL", "amdpal"],
  ["HermitCore", "hermit"], ["Hurd", "hurd"], ["WASIp1", "wasip1"], ["WASIp2", "wasip2"], ["WASIp3", "wasip3"], ["WASI", "wasi"],
  ["Emscripten", "emscripten"], ["ShaderModel", "shadermodel"], ["LiteOS", "liteos"], ["Serenity", "serenity"], ["Vulkan", "vulkan"],
  ["CheriotRTOS", "cheriotrtos"], ["OpenCL", "opencl"], ["ChipStar", "chipstar"], ["Firmware", "firmware"], ["QURT", "qurt"], ["H2", "h2"],
];
/** `TRIPLE_ENV` of TripleName.def, in order: [enum, name]. */
const TRIPLE_ENVS: readonly (readonly [string, string])[] = [
  ["EABIHF", "eabihf"], ["EABI", "eabi"], ["GNUABIN32", "gnuabin32"], ["GNUABI64", "gnuabi64"], ["GNUEABIHFT64", "gnueabihft64"],
  ["GNUEABIHF", "gnueabihf"], ["GNUEABIT64", "gnueabit64"], ["GNUEABI", "gnueabi"], ["GNUF32", "gnuf32"], ["GNUF64", "gnuf64"],
  ["GNUSF", "gnusf"], ["GNUX32", "gnux32"], ["GNUILP32", "gnu_ilp32"], ["CODE16", "code16"], ["GNUT64", "gnut64"], ["GNU", "gnu"],
  ["Android", "android"], ["MuslABIN32", "muslabin32"], ["MuslABI64", "muslabi64"], ["MuslEABIHF", "musleabihf"],
  ["MuslEABI", "musleabi"], ["MuslF32", "muslf32"], ["MuslSF", "muslsf"], ["MuslX32", "muslx32"], ["MuslWALI", "muslwali"],
  ["Musl", "musl"], ["MSVC", "msvc"], ["Itanium", "itanium"], ["Cygnus", "cygnus"], ["CoreCLR", "coreclr"], ["Simulator", "simulator"],
  ["MacABI", "macabi"], ["Pixel", "pixel"], ["Vertex", "vertex"], ["Geometry", "geometry"], ["Hull", "hull"], ["Domain", "domain"],
  ["Compute", "compute"], ["Library", "library"], ["RayGeneration", "raygeneration"], ["Intersection", "intersection"],
  ["AnyHit", "anyhit"], ["ClosestHit", "closesthit"], ["Miss", "miss"], ["Callable", "callable"], ["Mesh", "mesh"],
  ["Amplification", "amplification"], ["RootSignature", "rootsignature"], ["OpenHOS", "ohos"], ["PAuthTest", "pauthtest"],
  ["LLVM", "llvm"], ["Mlibc", "mlibc"], ["MTIA", "mtia"],
];

/** `StringSwitch` arms of `Triple::parseArch`, in order: names, or `startsWith` prefixes. */
const ARCH_CASES: readonly (readonly [readonly string[], ArchType, "Case" | "StartsWith"])[] = [
  [["i386", "i486", "i586", "i686"], "x86", "Case"],
  [["i786", "i886", "i986"], "x86", "Case"],
  [["amd64", "x86_64", "x86_64h", "x86_64_lfi"], "x86_64", "Case"],
  [["powerpc", "powerpcspe", "ppc", "ppc32"], "ppc", "Case"],
  [["powerpcle", "ppcle", "ppc32le"], "ppcle", "Case"],
  [["powerpc64", "ppu", "ppc64"], "ppc64", "Case"],
  [["powerpc64le", "ppc64le"], "ppc64le", "Case"],
  [["xscale"], "arm", "Case"],
  [["xscaleeb"], "armeb", "Case"],
  [["aarch64"], "aarch64", "Case"],
  [["aarch64_be"], "aarch64_be", "Case"],
  [["aarch64_32"], "aarch64_32", "Case"],
  [["aarch64_lfi"], "aarch64", "Case"],
  [["arc"], "arc", "Case"],
  [["arm64"], "aarch64", "Case"],
  [["arm64_32"], "aarch64_32", "Case"],
  [["arm64e"], "aarch64", "Case"],
  [["arm64e.x1"], "aarch64", "Case"],
  [["arm64ec"], "aarch64", "Case"],
  [["arm"], "arm", "Case"],
  [["armeb"], "armeb", "Case"],
  [["thumb"], "thumb", "Case"],
  [["thumbeb"], "thumbeb", "Case"],
  [["avr"], "avr", "Case"],
  [["m68k"], "m68k", "Case"],
  [["msp430"], "msp430", "Case"],
  [["mips", "mipseb", "mipsallegrex", "mipsisa32r6", "mipsr6"], "mips", "Case"],
  [["mipsel", "mipsallegrexel", "mipsisa32r6el", "mipsr6el"], "mipsel", "Case"],
  [["mips64", "mips64eb", "mipsn32", "mipsisa64r6", "mips64r6", "mipsn32r6"], "mips64", "Case"],
  [["mips64el", "mipsn32el", "mipsisa64r6el", "mips64r6el", "mipsn32r6el"], "mips64el", "Case"],
  [["amdgpu"], "amdgpu", "StartsWith"],
  [["amdgcn"], "amdgpu", "Case"],
  [["r600"], "r600", "Case"],
  [["riscv32"], "riscv32", "Case"],
  [["riscv64"], "riscv64", "Case"],
  [["riscv32be"], "riscv32be", "Case"],
  [["riscv64be"], "riscv64be", "Case"],
  [["hexagon"], "hexagon", "Case"],
  [["s390x", "systemz"], "systemz", "Case"],
  [["sparc"], "sparc", "Case"],
  [["sparcel"], "sparcel", "Case"],
  [["sparcv9", "sparc64"], "sparcv9", "Case"],
  [["tce"], "tce", "Case"],
  [["tcele"], "tcele", "Case"],
  [["tcele64"], "tcele64", "Case"],
  [["xcore"], "xcore", "Case"],
  [["nvptx"], "nvptx", "Case"],
  [["nvptx64"], "nvptx64", "Case"],
  [["amdil"], "amdil", "Case"],
  [["amdil64"], "amdil64", "Case"],
  [["hsail"], "hsail", "Case"],
  [["hsail64"], "hsail64", "Case"],
  [["spir"], "spir", "Case"],
  [["spir64"], "spir64", "Case"],
  [["spirv", "spirv1.5", "spirv1.6"], "spirv", "Case"],
  [["spirv32", "spirv32v1.0", "spirv32v1.1", "spirv32v1.2", "spirv32v1.3", "spirv32v1.4", "spirv32v1.5", "spirv32v1.6"], "spirv32", "Case"],
  [["spirv64", "spirv64v1.0", "spirv64v1.1", "spirv64v1.2", "spirv64v1.3", "spirv64v1.4", "spirv64v1.5", "spirv64v1.6"], "spirv64", "Case"],
  [["kalimba"], "kalimba", "StartsWith"],
  [["lanai"], "lanai", "Case"],
  [["renderscript32"], "renderscript32", "Case"],
  [["renderscript64"], "renderscript64", "Case"],
  [["shave"], "shave", "Case"],
  [["ve"], "ve", "Case"],
  [["wasm32"], "wasm32", "Case"],
  [["wasm64"], "wasm64", "Case"],
  [["csky"], "csky", "Case"],
  [["loongarch32"], "loongarch32", "Case"],
  [["loongarch64"], "loongarch64", "Case"],
  [["dxil", "dxilv1.0", "dxilv1.1", "dxilv1.2", "dxilv1.3", "dxilv1.4", "dxilv1.5", "dxilv1.6", "dxilv1.7", "dxilv1.8", "dxilv1.9"], "dxil", "Case"],
  [["xtensa"], "xtensa", "Case"],
];

export class Triple {
  Data: string;
  Arch: ArchType = "UnknownArch";
  Vendor = "UnknownVendor";
  OS = "UnknownOS";
  Environment = "UnknownEnvironment";
  ObjectFormat: ObjectFormatType = "UnknownObjectFormat";

  /// Construct a triple from the string representation provided.
  ///
  /// This stores the string representation and parses the various pieces into
  /// enum members.
  // llvm: llvm/lib/TargetParser/Triple.cpp:1093 Triple
  constructor(Str: string) {
    this.Data = Str;
    // Do minimal parsing by hand here.
    // StringRef(Data).split(Components, '-', /*MaxSplit*/ 3);
    const Components: string[] = [];
    let rest = Str;
    for (let k = 0; k < 3; k++) {
      const i = rest.indexOf("-");
      if (i < 0) break;
      Components.push(rest.slice(0, i));
      rest = rest.slice(i + 1);
    }
    Components.push(rest);
    if (Components.length > 0) {
      this.Arch = Triple.parseArch(Components[0]!);
      // SubArch = parseSubArch(Components[0]); (not modelled: header)
      if (Components.length > 1) {
        this.Vendor = parseVendor(Components[1]!);
        if (Components.length > 2) {
          this.OS = parseOS(Components[2]!);
          if (Components.length > 3) {
            this.Environment = parseEnvironment(Components[3]!);
            this.ObjectFormat = parseFormat(Components[3]!);
          }
        }
      } else {
        const c = Components[0]!;
        this.Environment = c.startsWith("mipsn32")
          ? "GNUABIN32"
          : c.startsWith("mips64")
            ? "GNUABI64"
            : c.startsWith("mipsisa64")
              ? "GNUABI64"
              : c.startsWith("mipsisa32")
                ? "GNU"
                : ["mips", "mipsel", "mipsr6", "mipsr6el"].includes(c)
                  ? "GNU"
                  : "UnknownEnvironment";
      }
    }
    if (this.ObjectFormat === "UnknownObjectFormat") this.ObjectFormat = getDefaultFormat(this);
  }

  // llvm: llvm/lib/TargetParser/Triple.cpp:640 parseArch
  static parseArch(ArchName: string): ArchType {
    let AT: ArchType = "UnknownArch";
    for (const [names, at, how] of ARCH_CASES) {
      if (how === "Case" ? names.includes(ArchName) : names.some((n) => ArchName.startsWith(n))) {
        AT = at;
        break;
      }
    }

    // Some architectures require special parsing logic just to compute the
    // ArchType result.
    if (AT === "UnknownArch") {
      if (ArchName.startsWith("arm") || ArchName.startsWith("thumb") || ArchName.startsWith("aarch64")) {
        // return parseARMArch(ArchName);
        return unported(`llir: Triple parseARMArch(${JSON.stringify(ArchName)}) (ARMTargetParser is not in the model)`);
      }
      if (ArchName.startsWith("bpf")) {
        // return parseBPFArch(ArchName);
        return unported(`llir: Triple parseBPFArch(${JSON.stringify(ArchName)})`);
      }
    }

    return AT;
  }

  // llvm: llvm/include/llvm/TargetParser/Triple.h:513 getArch
  getArch(): ArchType {
    return this.Arch;
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:519 getVendor
  getVendor(): string {
    return this.Vendor;
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:522 getOS
  getOS(): string {
    return this.OS;
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:528 getEnvironment
  getEnvironment(): string {
    return this.Environment;
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:537 getObjectFormat
  getObjectFormat(): ObjectFormatType {
    return this.ObjectFormat;
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:578 str
  str(): string {
    return this.Data;
  }
  /// Is this a Mac OS X triple. For legacy reasons, we support both "darwin"
  /// and "osx" as OS X triples.
  // llvm: llvm/include/llvm/TargetParser/Triple.h:680 isMacOSX
  isMacOSX(): boolean {
    return this.getOS() === "Darwin" || this.getOS() === "MacOSX";
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:689 isiOS
  isiOS(): boolean {
    return this.getOS() === "IOS" || this.isTvOS();
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:692 isTvOS
  isTvOS(): boolean {
    return this.getOS() === "TvOS";
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:695 isWatchOS
  isWatchOS(): boolean {
    return this.getOS() === "WatchOS";
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:700 isXROS
  isXROS(): boolean {
    return this.getOS() === "XROS";
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:703 isBridgeOS
  isBridgeOS(): boolean {
    return this.getOS() === "BridgeOS";
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:706 isDriverKit
  isDriverKit(): boolean {
    return this.getOS() === "DriverKit";
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:708 isOSzOS
  isOSzOS(): boolean {
    return this.getOS() === "ZOS";
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:716 isAppleFirmware
  isAppleFirmware(): boolean {
    return this.getVendor() === "Apple" && this.isOSFirmware();
  }
  /// Is this a "Darwin" OS (macOS, iOS, tvOS, watchOS, DriverKit, XROS, or
  /// bridgeOS).
  // llvm: llvm/include/llvm/TargetParser/Triple.h:722 isOSDarwin
  isOSDarwin(): boolean {
    return this.isMacOSX() || this.isiOS() || this.isWatchOS() || this.isDriverKit() || this.isXROS() || this.isBridgeOS() || this.isAppleFirmware();
    // Apple firmware isn't necessarily a Darwin based OS, but for most intents
    // and purposes it can be treated like a Darwin OS in the compiler.
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:755 isOSIAMCU
  isOSIAMCU(): boolean {
    return this.getOS() === "ELFIAMCU";
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:773 isUEFI
  isUEFI(): boolean {
    return this.getOS() === "UEFI";
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:776 isOSWindows
  isOSWindows(): boolean {
    return this.getOS() === "Win32";
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:782 isOSWindowsOrUEFI
  isOSWindowsOrUEFI(): boolean {
    return this.isOSWindows() || this.isUEFI();
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:785 isKnownWindowsMSVCEnvironment
  isKnownWindowsMSVCEnvironment(): boolean {
    return this.isOSWindows() && this.getEnvironment() === "MSVC";
  }
  /// Checks if the environment could be MSVC.
  // llvm: llvm/include/llvm/TargetParser/Triple.h:790 isWindowsMSVCEnvironment
  isWindowsMSVCEnvironment(): boolean {
    return this.isKnownWindowsMSVCEnvironment() || (this.isOSWindows() && this.getEnvironment() === "UnknownEnvironment");
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:854 isOSAIX
  isOSAIX(): boolean {
    return this.getOS() === "AIX";
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:868 isOSBinFormatCOFF
  isOSBinFormatCOFF(): boolean {
    return this.getObjectFormat() === "COFF";
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:871 isOSBinFormatGOFF
  isOSBinFormatGOFF(): boolean {
    return this.getObjectFormat() === "GOFF";
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:874 isOSBinFormatMachO
  isOSBinFormatMachO(): boolean {
    return this.getObjectFormat() === "MachO";
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:880 isOSBinFormatXCOFF
  isOSBinFormatXCOFF(): boolean {
    return this.getObjectFormat() === "XCOFF";
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:954 isOSFirmware
  isOSFirmware(): boolean {
    return this.getOS() === "Firmware";
  }
  // llvm: llvm/include/llvm/TargetParser/Triple.h:1204 isX86_64
  isX86_64(): boolean {
    return this.getArch() === "x86_64";
  }
  /// Tests whether the target is the PS4 platform.
  // llvm: llvm/include/llvm/TargetParser/Triple.h:894 isPS4
  isPS4(): boolean {
    return this.getArch() === "x86_64" && this.getVendor() === "SCEI" && this.getOS() === "PS4";
  }
  /// Tests whether the target is the PS5 platform.
  // llvm: llvm/include/llvm/TargetParser/Triple.h:900 isPS5
  isPS5(): boolean {
    return this.getArch() === "x86_64" && this.getVendor() === "SCEI" && this.getOS() === "PS5";
  }
  /// Tests whether the target is the PS4 or PS5 platform.
  // llvm: llvm/include/llvm/TargetParser/Triple.h:906 isPS
  isPS(): boolean {
    return this.isPS4() || this.isPS5();
  }
  /// Tests whether the target is X32.
  // llvm: llvm/include/llvm/TargetParser/Triple.h:1235 isX32
  isX32(): boolean {
    const Env = this.getEnvironment();
    return Env === "GNUX32" || Env === "MuslX32";
  }

  // llvm: llvm/lib/TargetParser/Triple.cpp:2254 isLittleEndian
  isLittleEndian(): boolean {
    switch (this.getArch()) {
      case "aarch64":
      case "aarch64_32":
      case "amdgpu":
      case "amdil64":
      case "amdil":
      case "arm":
      case "avr":
      case "bpfel":
      case "csky":
      case "dxil":
      case "hexagon":
      case "hsail64":
      case "hsail":
      case "kalimba":
      case "loongarch32":
      case "loongarch64":
      case "mips64el":
      case "mipsel":
      case "msp430":
      case "nvptx64":
      case "nvptx":
      case "ppcle":
      case "ppc64le":
      case "r600":
      case "renderscript32":
      case "renderscript64":
      case "riscv32":
      case "riscv64":
      case "shave":
      case "sparcel":
      case "spir64":
      case "spir":
      case "spirv":
      case "spirv32":
      case "spirv64":
      case "tcele":
      case "tcele64":
      case "thumb":
      case "ve":
      case "wasm32":
      case "wasm64":
      case "x86":
      case "x86_64":
      case "xcore":
      case "xtensa":
        return true;
      default:
        return false;
    }
  }

  // llvm: llvm/lib/TargetParser/TargetDataLayout.cpp:555 computeDataLayout
  computeDataLayout(ABIName: string): string {
    const what = (f: string): never => unported(`llir: ${f} (TargetDataLayout.cpp; only the X86 and AArch64 layouts are in the model)`);
    void ABIName;
    switch (this.getArch()) {
      case "arm":
      case "armeb":
      case "thumb":
      case "thumbeb":
        return what("computeARMDataLayout");
      case "aarch64":
      case "aarch64_be":
      case "aarch64_32":
        return computeAArch64DataLayout(this);
      case "arc":
        return "e-m:e-p:32:32-i1:8:32-i8:8:32-i16:16:32-i32:32:32-" + "f32:32:32-i64:32-f64:32-a:0:32-n32";
      case "avr":
        return "e-P1-p:16:8-i8:8-i16:8-i32:8-i64:8-f32:8-f64:8-n8:16-a:8";
      case "bpfel":
      case "bpfeb":
        return what("computeBPFDataLayout");
      case "csky":
        return what("computeCSKYDataLayout");
      case "dxil":
        return "e-m:e-ve-p:32:32-i1:32-i8:8-i16:16-i32:32-i64:64-f16:16-" + "f32:32-f64:64-n8:16:32:64";
      case "hexagon":
        return (
          "e-m:e-p:32:32:32-a:0-n16:32-" +
          "i64:64:64-i32:32:32-i16:16:16-i1:8:8-f32:32:32-f64:64:64-" +
          "v32:32:32-v64:64:64-v512:512:512-v1024:1024:1024-v2048:2048:2048"
        );
      case "loongarch32":
      case "loongarch64":
        return what("computeLoongArchDataLayout");
      case "m68k":
        return what("computeM68kDataLayout");
      case "mips":
      case "mipsel":
      case "mips64":
      case "mips64el":
        return what("computeMipsDataLayout");
      case "msp430":
        return "e-m:e-p:16:16-i32:16-i64:16-f32:16-f64:16-a:8-n8:16-S16";
      case "ppc":
      case "ppcle":
      case "ppc64":
      case "ppc64le":
        return what("computePowerDataLayout");
      case "amdgpu":
      case "r600":
        return what("computeAMDDataLayout");
      case "riscv32":
      case "riscv64":
      case "riscv32be":
      case "riscv64be":
        return what("computeRISCVDataLayout");
      case "sparc":
      case "sparcv9":
      case "sparcel":
        return what("computeSparcDataLayout");
      case "systemz":
        return what("computeSystemZDataLayout");
      case "tce":
        return (
          "E-p:32:32:32-i1:8:8-i8:8:32-i16:16:32-i32:32:32-i64:32:32-" +
          "f16:16:16-f32:32:32-f64:32:32-v64:64:64-i128:128-v128:128:128-" +
          "v256:256:256-v512:512:512-v1024:1024:1024-v2048:2048:2048-" +
          "v4096:4096:4096-a0:0:32-n32"
        );
      case "tcele":
        return (
          "e-p:32:32:32-i1:8:8-i8:8:32-i16:16:32-i32:32:32-i64:32:32-" +
          "f16:16:16-f32:32:32-f64:32:32-v64:64:64-i128:128-v128:128:128-" +
          "v256:256:256-v512:512:512-v1024:1024:1024-v2048:2048:2048-" +
          "v4096:4096:4096-a0:0:32-n32"
        );
      case "tcele64":
        return (
          "e-p:64:64:64-i1:8:64-i8:8:64-i16:16:64-i32:32:64-i64:64:64-" +
          "f16:16:64-f32:32:64-f64:64:64-v64:64:64-i128:128-v128:128:128-" +
          "v256:256:256-v512:512:512-v1024:1024:1024-v2048:2048:2048-" +
          "v4096:4096:4096-a0:0:64-n64"
        );
      case "x86":
      case "x86_64":
        return computeX86DataLayout(this);
      case "xcore":
        return "e-m:e-p:32:32-i1:8:32-i8:8:32-i16:16:32-i64:32-f64:32-a:0:32-n32";
      case "xtensa":
        return "e-m:e-p:32:32-i8:8:32-i16:16:32-i64:64-n32";
      case "nvptx":
      case "nvptx64":
        return what("computeNVPTXDataLayout");
      case "spir":
      case "spir64":
      case "spirv":
      case "spirv32":
      case "spirv64":
        return what("computeSPIRVDataLayout");
      case "lanai":
        return what("computeLanaiDataLayout");
      case "wasm32":
      case "wasm64":
        return what("computeWebAssemblyDataLayout");
      case "ve":
        return what("computeVEDataLayout");

      case "amdil":
      case "amdil64":
      case "hsail":
      case "hsail64":
      case "kalimba":
      case "shave":
      case "renderscript32":
      case "renderscript64":
        // These are all virtual ISAs with no LLVM backend, and therefore no fixed
        // LLVM data layout.
        return "";

      case "UnknownArch":
        return "";
    }
  }
}

// llvm: llvm/lib/TargetParser/Triple.cpp:742 parseVendor
function parseVendor(VendorName: string): string {
  for (const [e, name] of TRIPLE_VENDORS) if (VendorName === name) return e;
  return "UnknownVendor";
}

// llvm: llvm/lib/TargetParser/Triple.cpp:750 parseOS
function parseOS(OSName: string): string {
  for (const [e, name] of TRIPLE_OSES) if (OSName.startsWith(name)) return e;
  return "UnknownOS";
}

// llvm: llvm/lib/TargetParser/Triple.cpp:758 parseEnvironment
function parseEnvironment(EnvironmentName: string): string {
  for (const [e, name] of TRIPLE_ENVS) if (EnvironmentName.startsWith(name)) return e;
  return "UnknownEnvironment";
}

// llvm: llvm/lib/TargetParser/Triple.cpp:765 parseFormat
function parseFormat(EnvironmentName: string): ObjectFormatType {
  // "xcoff" must come before "coff" because of the order-dependendent
  // pattern matching.
  if (EnvironmentName.endsWith("xcoff")) return "XCOFF";
  if (EnvironmentName.endsWith("coff")) return "COFF";
  if (EnvironmentName.endsWith("elf")) return "ELF";
  if (EnvironmentName.endsWith("goff")) return "GOFF";
  if (EnvironmentName.endsWith("macho")) return "MachO";
  if (EnvironmentName.endsWith("wasm")) return "Wasm";
  if (EnvironmentName.endsWith("spirv")) return "SPIRV";
  return "UnknownObjectFormat";
}

// llvm: llvm/lib/TargetParser/Triple.cpp:992 getDefaultFormat
function getDefaultFormat(T: Triple): ObjectFormatType {
  switch (T.getArch()) {
    case "UnknownArch":
    case "aarch64":
    case "aarch64_32":
    case "arm":
    case "thumb":
    case "x86":
    case "x86_64":
      switch (T.getOS()) {
        case "Win32":
        case "UEFI":
          return "COFF";
        default:
          return T.isOSDarwin() ? "MachO" : "ELF";
      }
    case "aarch64_be":
    case "amdgpu":
    case "amdil64":
    case "amdil":
    case "arc":
    case "armeb":
    case "avr":
    case "bpfeb":
    case "bpfel":
    case "csky":
    case "hexagon":
    case "hsail64":
    case "hsail":
    case "kalimba":
    case "lanai":
    case "loongarch32":
    case "loongarch64":
    case "m68k":
    case "mips64":
    case "mips64el":
    case "mips":
    case "msp430":
    case "nvptx64":
    case "nvptx":
    case "ppc64le":
    case "ppcle":
    case "r600":
    case "renderscript32":
    case "renderscript64":
    case "riscv32":
    case "riscv64":
    case "riscv32be":
    case "riscv64be":
    case "shave":
    case "sparc":
    case "sparcel":
    case "sparcv9":
    case "spir64":
    case "spir":
    case "tce":
    case "tcele":
    case "tcele64":
    case "thumbeb":
    case "ve":
    case "xcore":
    case "xtensa":
      return "ELF";

    case "mipsel":
      if (T.isOSWindows()) return "COFF";
      return "ELF";

    case "ppc64":
    case "ppc":
      if (T.isOSAIX()) return "XCOFF";
      if (T.isOSDarwin()) return "MachO";
      return "ELF";

    case "systemz":
      if (T.isOSzOS()) return "GOFF";
      return "ELF";

    case "wasm32":
    case "wasm64":
      return "Wasm";

    case "spirv":
    case "spirv32":
    case "spirv64":
      return "SPIRV";

    case "dxil":
      return "DXContainer";
  }
}

// llvm: llvm/lib/TargetParser/TargetDataLayout.cpp:16 getManglingComponent
function getManglingComponent(T: Triple): string {
  if (T.isOSBinFormatGOFF()) return "-m:l";
  if (T.isOSBinFormatMachO()) return "-m:o";
  if (T.isOSWindowsOrUEFI() && T.isOSBinFormatCOFF()) return T.getArch() === "x86" ? "-m:x" : "-m:w";
  if (T.isOSBinFormatXCOFF()) return "-m:a";
  return "-m:e";
}

// llvm: llvm/lib/TargetParser/TargetDataLayout.cpp:83 computeAArch64DataLayout
function computeAArch64DataLayout(TT: Triple): string {
  if (TT.isOSBinFormatMachO()) {
    if (TT.getArch() === "aarch64_32") return "e-m:o-p:32:32-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-" + "n32:64-S128-Fn32";
    return "e-m:o-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-n32:64-S128-" + "Fn32";
  }
  if (TT.isOSBinFormatCOFF()) return "e-m:w-p270:32:32-p271:32:32-p272:64:64-p:64:64-i32:32-i64:64-i128:" + "128-n32:64-S128-Fn32";
  const Endian = TT.isLittleEndian() ? "e" : "E";
  const Ptr32 = TT.getEnvironment() === "GNUILP32" ? "-p:32:32" : "";
  return Endian + "-m:e" + Ptr32 + "-p270:32:32-p271:32:32-p272:64:64-i8:8:32-i16:16:32-i64:64-i128:128-" + "n32:64-S128-Fn32";
}

// DataLayout: little or big endian
// llvm: llvm/lib/TargetParser/TargetDataLayout.cpp:408 computeX86DataLayout
function computeX86DataLayout(TT: Triple): string {
  const Is64Bit = TT.isX86_64();

  // X86 is little endian
  let Ret = "e";

  Ret += getManglingComponent(TT);
  // X86 and x32 have 32 bit pointers.
  if (!Is64Bit || TT.isX32()) Ret += "-p:32:32";

  // Address spaces for 32 bit signed, 32 bit unsigned, and 64 bit pointers.
  Ret += "-p270:32:32-p271:32:32-p272:64:64";

  // Some ABIs align 64 bit integers and doubles to 64 bits, others to 32.
  // 128 bit integers are not specified in the 32-bit ABIs but are used
  // internally for lowering f128, so we match the alignment to that.
  if (Is64Bit || TT.isOSWindows()) Ret += "-i64:64-i128:128";
  else if (TT.isOSIAMCU()) Ret += "-i64:32-f64:32";
  else Ret += "-i128:128-f64:32:64";

  // Some ABIs align long double to 128 bits, others to 32.
  if (TT.isOSIAMCU()) {
    // No f80
  } else if (Is64Bit || TT.isOSDarwin() || TT.isWindowsMSVCEnvironment()) Ret += "-f80:128";
  else Ret += "-f80:32";

  if (TT.isOSIAMCU()) Ret += "-f128:32";

  // The registers can hold 8, 16, 32 or, in x86-64, 64 bits.
  if (Is64Bit) Ret += "-n8:16:32:64";
  else Ret += "-n8:16:32";

  // The stack is aligned to 32 bits on some ABIs and 128 bits on others.
  if ((!Is64Bit && TT.isOSWindows()) || TT.isOSIAMCU()) Ret += "-a:0:32-S32";
  else Ret += "-S128";

  return Ret;
}
