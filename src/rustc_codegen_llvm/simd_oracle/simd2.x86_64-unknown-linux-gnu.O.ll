; ModuleID = 'simd2.c07133d7104f0304-cgu.0'
source_filename = "simd2.c07133d7104f0304-cgu.0"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

; Function Attrs: nonlazybind uwtable
define void @g_arith_offset(ptr dead_on_unwind noalias nofree noundef writable sret([32 x i8]) align 32 captures(address) dereferenceable(32) %_0, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %a, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %o) unnamed_addr #0 !guid !4 {
start:
  %0 = load <4 x ptr>, ptr %a, align 32
  %1 = load <4 x i64>, ptr %o, align 32
  %2 = getelementptr i32, <4 x ptr> %0, <4 x i64> %1
  store <4 x ptr> %2, ptr %_0, align 32
  ret void
}

; Function Attrs: nonlazybind uwtable
define void @g_arith_offset_u(ptr dead_on_unwind noalias nofree noundef writable sret([32 x i8]) align 32 captures(address) dereferenceable(32) %_0, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %a, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %o) unnamed_addr #0 !guid !5 {
start:
  %0 = load <4 x ptr>, ptr %a, align 32
  %1 = load <4 x i64>, ptr %o, align 32
  %2 = getelementptr i8, <4 x ptr> %0, <4 x i64> %1
  store <4 x ptr> %2, ptr %_0, align 32
  ret void
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @g_as_fptosi(<4 x float> %a) unnamed_addr #0 !guid !6 {
start:
  %_0 = call <4 x i32> @llvm.fptosi.sat.v4i32.v4f32(<4 x float> %a)
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i16> @g_as_fptoui(ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %a) unnamed_addr #0 !guid !7 {
start:
  %0 = load <4 x double>, ptr %a, align 32
  %_0 = call <4 x i16> @llvm.fptoui.sat.v4i16.v4f64(<4 x double> %0)
  ret <4 x i16> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x float> @g_as_sitofp(ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %a) unnamed_addr #0 !guid !8 {
start:
  %0 = load <4 x i64>, ptr %a, align 32
  %_0 = sitofp <4 x i64> %0 to <4 x float>
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i16> @g_bitreverse(<4 x i16> %a) unnamed_addr #0 !guid !9 {
start:
  %_0 = call <4 x i16> @llvm.bitreverse.v4i16(<4 x i16> %a)
  ret <4 x i16> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @g_bswap_u32(<4 x i32> %a) unnamed_addr #0 !guid !10 {
start:
  %_0 = call <4 x i32> @llvm.bswap.v4i32(<4 x i32> %a)
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i8> @g_bswap_u8(<4 x i8> %a) unnamed_addr #0 !guid !11 {
start:
  ret <4 x i8> %a
}

; Function Attrs: nonlazybind uwtable
define void @g_carryless_mul(ptr dead_on_unwind noalias nofree noundef writable sret([32 x i8]) align 32 captures(address) dereferenceable(32) %_0, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %a, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %b) unnamed_addr #0 !guid !12 {
start:
  %0 = load <4 x i64>, ptr %a, align 32
  %1 = load <4 x i64>, ptr %b, align 32
  %2 = call <4 x i64> @llvm.clmul.v4i64(<4 x i64> %0, <4 x i64> %1)
  store <4 x i64> %2, ptr %_0, align 32
  ret void
}

; Function Attrs: nonlazybind uwtable
define void @g_cast_fpext(ptr dead_on_unwind noalias nofree noundef writable sret([32 x i8]) align 32 captures(address) dereferenceable(32) %_0, <4 x float> %a) unnamed_addr #0 !guid !13 {
start:
  %0 = fpext <4 x float> %a to <4 x double>
  store <4 x double> %0, ptr %_0, align 32
  ret void
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @g_cast_fptosi(ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %a) unnamed_addr #0 !guid !14 {
start:
  %0 = load <4 x double>, ptr %a, align 32
  %_0 = fptosi <4 x double> %0 to <4 x i32>
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i8> @g_cast_fptoui(<4 x float> %a) unnamed_addr #0 !guid !15 {
start:
  %_0 = fptoui <4 x float> %a to <4 x i8>
  ret <4 x i8> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x float> @g_cast_fptrunc(ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %a) unnamed_addr #0 !guid !16 {
start:
  %0 = load <4 x double>, ptr %a, align 32
  %_0 = fptrunc <4 x double> %0 to <4 x float>
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @g_cast_identity(<4 x i32> %a) unnamed_addr #0 !guid !17 {
start:
  ret <4 x i32> %a
}

; Function Attrs: nonlazybind uwtable
define void @g_cast_isize(ptr dead_on_unwind noalias nofree noundef writable sret([32 x i8]) align 32 captures(address) dereferenceable(32) %_0, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %a) unnamed_addr #0 !guid !18 {
start:
  %0 = load <4 x i64>, ptr %a, align 32
  store <4 x i64> %0, ptr %_0, align 32
  ret void
}

; Function Attrs: nonlazybind uwtable
define void @g_cast_ptr(ptr dead_on_unwind noalias nofree noundef writable sret([32 x i8]) align 32 captures(address) dereferenceable(32) %_0, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %a) unnamed_addr #0 !guid !19 {
start:
  %0 = load <4 x ptr>, ptr %a, align 32
  store <4 x ptr> %0, ptr %_0, align 32
  ret void
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @g_cast_same(<4 x i32> %a) unnamed_addr #0 !guid !20 {
start:
  ret <4 x i32> %a
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @g_cast_sext(<4 x i8> %a) unnamed_addr #0 !guid !21 {
start:
  %_0 = sext <4 x i8> %a to <4 x i32>
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define void @g_cast_sitofp(ptr dead_on_unwind noalias nofree noundef writable sret([32 x i8]) align 32 captures(address) dereferenceable(32) %_0, <4 x i32> %a) unnamed_addr #0 !guid !22 {
start:
  %0 = sitofp <4 x i32> %a to <4 x double>
  store <4 x double> %0, ptr %_0, align 32
  ret void
}

; Function Attrs: nonlazybind uwtable
define <4 x i16> @g_cast_trunc(ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %a) unnamed_addr #0 !guid !23 {
start:
  %0 = load <4 x i64>, ptr %a, align 32
  %_0 = trunc <4 x i64> %0 to <4 x i16>
  ret <4 x i16> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x float> @g_cast_uitofp(<4 x i16> %a) unnamed_addr #0 !guid !24 {
start:
  %_0 = uitofp <4 x i16> %a to <4 x float>
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define void @g_cast_zext(ptr dead_on_unwind noalias nofree noundef writable sret([32 x i8]) align 32 captures(address) dereferenceable(32) %_0, <4 x i8> %a) unnamed_addr #0 !guid !25 {
start:
  %0 = zext <4 x i8> %a to <4 x i64>
  store <4 x i64> %0, ptr %_0, align 32
  ret void
}

; Function Attrs: nonlazybind uwtable
define <4 x float> @g_ceil(<4 x float> %a) unnamed_addr #0 !guid !26 {
start:
  %_0 = call <4 x float> @llvm.ceil.v4f32(<4 x float> %a)
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @g_ctlz(<4 x i32> %a) unnamed_addr #0 !guid !27 {
start:
  %_0 = call <4 x i32> @llvm.ctlz.v4i32(<4 x i32> %a, i1 false)
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define void @g_ctpop(ptr dead_on_unwind noalias nofree noundef writable sret([32 x i8]) align 32 captures(address) dereferenceable(32) %_0, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %a) unnamed_addr #0 !guid !28 {
start:
  %0 = load <4 x i64>, ptr %a, align 32
  %1 = call <4 x i64> @llvm.ctpop.v4i64(<4 x i64> %0)
  store <4 x i64> %1, ptr %_0, align 32
  ret void
}

; Function Attrs: nonlazybind uwtable
define <4 x i8> @g_cttz(<4 x i8> %a) unnamed_addr #0 !guid !29 {
start:
  %_0 = call <4 x i8> @llvm.cttz.v4i8(<4 x i8> %a, i1 false)
  ret <4 x i8> %_0
}

; Function Attrs: nonlazybind uwtable
define void @g_expose_provenance(ptr dead_on_unwind noalias nofree noundef writable sret([32 x i8]) align 32 captures(address) dereferenceable(32) %_0, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %a) unnamed_addr #0 !guid !30 {
start:
  %0 = load <4 x ptr>, ptr %a, align 32
  %1 = ptrtoint <4 x ptr> %0 to <4 x i64>
  store <4 x i64> %1, ptr %_0, align 32
  ret void
}

; Function Attrs: nonlazybind uwtable
define void @g_fabs(ptr dead_on_unwind noalias nofree noundef writable sret([32 x i8]) align 32 captures(address) dereferenceable(32) %_0, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %a) unnamed_addr #0 !guid !31 {
start:
  %0 = load <4 x double>, ptr %a, align 32
  %1 = call <4 x double> @llvm.fabs.v4f64(<4 x double> %0)
  store <4 x double> %1, ptr %_0, align 32
  ret void
}

; Function Attrs: nonlazybind uwtable
define <4 x float> @g_fcos(<4 x float> %a) unnamed_addr #0 !guid !32 {
start:
  %_0 = call <4 x float> @llvm.cos.v4f32(<4 x float> %a)
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x float> @g_fexp(<4 x float> %a) unnamed_addr #0 !guid !33 {
start:
  %_0 = call <4 x float> @llvm.exp.v4f32(<4 x float> %a)
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x float> @g_fexp2(<4 x float> %a) unnamed_addr #0 !guid !34 {
start:
  %_0 = call <4 x float> @llvm.exp2.v4f32(<4 x float> %a)
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define void @g_flog(ptr dead_on_unwind noalias nofree noundef writable sret([32 x i8]) align 32 captures(address) dereferenceable(32) %_0, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %a) unnamed_addr #0 !guid !35 {
start:
  %0 = load <4 x double>, ptr %a, align 32
  %1 = call <4 x double> @llvm.log.v4f64(<4 x double> %0)
  store <4 x double> %1, ptr %_0, align 32
  ret void
}

; Function Attrs: nonlazybind uwtable
define <4 x float> @g_flog10(<4 x float> %a) unnamed_addr #0 !guid !36 {
start:
  %_0 = call <4 x float> @llvm.log10.v4f32(<4 x float> %a)
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x float> @g_flog2(<4 x float> %a) unnamed_addr #0 !guid !37 {
start:
  %_0 = call <4 x float> @llvm.log2.v4f32(<4 x float> %a)
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x float> @g_floor(<4 x float> %a) unnamed_addr #0 !guid !38 {
start:
  %_0 = call <4 x float> @llvm.floor.v4f32(<4 x float> %a)
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x float> @g_fma(<4 x float> %a, <4 x float> %b, <4 x float> %c) unnamed_addr #0 !guid !39 {
start:
  %_0 = call <4 x float> @llvm.fma.v4f32(<4 x float> %a, <4 x float> %b, <4 x float> %c)
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x float> @g_fsin(<4 x float> %a) unnamed_addr #0 !guid !40 {
start:
  %_0 = call <4 x float> @llvm.sin.v4f32(<4 x float> %a)
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x float> @g_fsqrt(<4 x float> %a) unnamed_addr #0 !guid !41 {
start:
  %_0 = call <4 x float> @llvm.sqrt.v4f32(<4 x float> %a)
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @g_funnel_shl(<4 x i32> %a, <4 x i32> %b, <4 x i32> %c) unnamed_addr #0 !guid !42 {
start:
  %_0 = call <4 x i32> @llvm.fshl.v4i32(<4 x i32> %a, <4 x i32> %b, <4 x i32> %c)
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i8> @g_funnel_shr(<4 x i8> %a, <4 x i8> %b, <4 x i8> %c) unnamed_addr #0 !guid !43 {
start:
  %_0 = call <4 x i8> @llvm.fshr.v4i8(<4 x i8> %a, <4 x i8> %b, <4 x i8> %c)
  ret <4 x i8> %_0
}

; Function Attrs: nonlazybind uwtable
define noundef i32 @g_reduce_add_ordered_i32(<4 x i32> %a, i32 noundef %acc) unnamed_addr #0 !guid !44 {
start:
  %0 = call i32 @llvm.vector.reduce.add.v4i32(<4 x i32> %a)
  %_0 = add i32 %acc, %0
  ret i32 %_0
}

; Function Attrs: nonlazybind uwtable
define noundef i32 @g_reduce_add_unordered_u32(<4 x i32> %a) unnamed_addr #0 !guid !45 {
start:
  %0 = call i32 @llvm.vector.reduce.add.v4i32(<4 x i32> %a)
  %_0 = call i32 @llvm.vector.reduce.add.v4i32(<4 x i32> %a)
  ret i32 %_0
}

; Function Attrs: nonlazybind uwtable
define noundef i64 @g_reduce_mul_ordered_u64(ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %a, i64 noundef %acc) unnamed_addr #0 !guid !46 {
start:
  %0 = load <4 x i64>, ptr %a, align 32
  %1 = call i64 @llvm.vector.reduce.mul.v4i64(<4 x i64> %0)
  %_0 = mul i64 %acc, %1
  ret i64 %_0
}

; Function Attrs: nonlazybind uwtable
define noundef i16 @g_reduce_mul_unordered_i16(<4 x i16> %a) unnamed_addr #0 !guid !47 {
start:
  %0 = call i16 @llvm.vector.reduce.mul.v4i16(<4 x i16> %a)
  %_0 = call i16 @llvm.vector.reduce.mul.v4i16(<4 x i16> %a)
  ret i16 %_0
}

; Function Attrs: nonlazybind uwtable
define void @g_relaxed_fma(ptr dead_on_unwind noalias nofree noundef writable sret([32 x i8]) align 32 captures(address) dereferenceable(32) %_0, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %a, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %b, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %c) unnamed_addr #0 !guid !48 {
start:
  %0 = load <4 x double>, ptr %a, align 32
  %1 = load <4 x double>, ptr %b, align 32
  %2 = load <4 x double>, ptr %c, align 32
  %3 = call <4 x double> @llvm.fmuladd.v4f64(<4 x double> %0, <4 x double> %1, <4 x double> %2)
  store <4 x double> %3, ptr %_0, align 32
  ret void
}

; Function Attrs: nonlazybind uwtable
define <4 x float> @g_round(<4 x float> %a) unnamed_addr #0 !guid !49 {
start:
  %_0 = call <4 x float> @llvm.round.v4f32(<4 x float> %a)
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x float> @g_round_ties_even(<4 x float> %a) unnamed_addr #0 !guid !50 {
start:
  %_0 = call <4 x float> @llvm.rint.v4f32(<4 x float> %a)
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @g_saturating_add_i32(<4 x i32> %a, <4 x i32> %b) unnamed_addr #0 !guid !51 {
start:
  %_0 = call <4 x i32> @llvm.sadd.sat.v4i32(<4 x i32> %a, <4 x i32> %b)
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i8> @g_saturating_add_u8(<4 x i8> %a, <4 x i8> %b) unnamed_addr #0 !guid !52 {
start:
  %_0 = call <4 x i8> @llvm.uadd.sat.v4i8(<4 x i8> %a, <4 x i8> %b)
  ret <4 x i8> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i16> @g_saturating_sub_i16(<4 x i16> %a, <4 x i16> %b) unnamed_addr #0 !guid !53 {
start:
  %_0 = call <4 x i16> @llvm.ssub.sat.v4i16(<4 x i16> %a, <4 x i16> %b)
  ret <4 x i16> %_0
}

; Function Attrs: nonlazybind uwtable
define void @g_saturating_sub_u64(ptr dead_on_unwind noalias nofree noundef writable sret([32 x i8]) align 32 captures(address) dereferenceable(32) %_0, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %a, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %b) unnamed_addr #0 !guid !54 {
start:
  %0 = load <4 x i64>, ptr %a, align 32
  %1 = load <4 x i64>, ptr %b, align 32
  %2 = call <4 x i64> @llvm.usub.sat.v4i64(<4 x i64> %0, <4 x i64> %1)
  store <4 x i64> %2, ptr %_0, align 32
  ret void
}

; Function Attrs: nonlazybind uwtable
define <4 x float> @g_select_i32(<4 x i32> %m, <4 x float> %a, <4 x float> %b) unnamed_addr #0 !guid !55 {
start:
  %0 = lshr <4 x i32> %m, splat (i32 31)
  %1 = trunc <4 x i32> %0 to <4 x i1>
  %_0 = select <4 x i1> %1, <4 x float> %a, <4 x float> %b
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define void @g_select_u8(ptr dead_on_unwind noalias nofree noundef writable sret([32 x i8]) align 32 captures(address) dereferenceable(32) %_0, <4 x i8> %m, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %a, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %b) unnamed_addr #0 !guid !56 {
start:
  %0 = load <4 x i64>, ptr %a, align 32
  %1 = load <4 x i64>, ptr %b, align 32
  %2 = lshr <4 x i8> %m, splat (i8 7)
  %3 = trunc <4 x i8> %2 to <4 x i1>
  %4 = select <4 x i1> %3, <4 x i64> %0, <4 x i64> %1
  store <4 x i64> %4, ptr %_0, align 32
  ret void
}

; Function Attrs: nonlazybind uwtable
define void @g_trunc(ptr dead_on_unwind noalias nofree noundef writable sret([32 x i8]) align 32 captures(address) dereferenceable(32) %_0, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %a) unnamed_addr #0 !guid !57 {
start:
  %0 = load <4 x double>, ptr %a, align 32
  %1 = call <4 x double> @llvm.trunc.v4f64(<4 x double> %0)
  store <4 x double> %1, ptr %_0, align 32
  ret void
}

; Function Attrs: nonlazybind uwtable
define void @g_with_exposed_provenance(ptr dead_on_unwind noalias nofree noundef writable sret([32 x i8]) align 32 captures(address) dereferenceable(32) %_0, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %a) unnamed_addr #0 !guid !58 {
start:
  %0 = load <4 x i64>, ptr %a, align 32
  %1 = inttoptr <4 x i64> %0 to <4 x ptr>
  store <4 x ptr> %1, ptr %_0, align 32
  ret void
}

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x i32> @llvm.fptosi.sat.v4i32.v4f32(<4 x float>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x i16> @llvm.fptoui.sat.v4i16.v4f64(<4 x double>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x i16> @llvm.bitreverse.v4i16(<4 x i16>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x i32> @llvm.bswap.v4i32(<4 x i32>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x i64> @llvm.clmul.v4i64(<4 x i64>, <4 x i64>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x float> @llvm.ceil.v4f32(<4 x float>) #1

; Function Attrs: nocallback nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x i32> @llvm.ctlz.v4i32(<4 x i32>, i1 immarg) #2

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x i64> @llvm.ctpop.v4i64(<4 x i64>) #1

; Function Attrs: nocallback nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x i8> @llvm.cttz.v4i8(<4 x i8>, i1 immarg) #2

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x double> @llvm.fabs.v4f64(<4 x double>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x float> @llvm.cos.v4f32(<4 x float>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x float> @llvm.exp.v4f32(<4 x float>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x float> @llvm.exp2.v4f32(<4 x float>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x double> @llvm.log.v4f64(<4 x double>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x float> @llvm.log10.v4f32(<4 x float>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x float> @llvm.log2.v4f32(<4 x float>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x float> @llvm.floor.v4f32(<4 x float>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x float> @llvm.fma.v4f32(<4 x float>, <4 x float>, <4 x float>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x float> @llvm.sin.v4f32(<4 x float>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x float> @llvm.sqrt.v4f32(<4 x float>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x i32> @llvm.fshl.v4i32(<4 x i32>, <4 x i32>, <4 x i32>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x i8> @llvm.fshr.v4i8(<4 x i8>, <4 x i8>, <4 x i8>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i32 @llvm.vector.reduce.add.v4i32(<4 x i32>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.vector.reduce.mul.v4i64(<4 x i64>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i16 @llvm.vector.reduce.mul.v4i16(<4 x i16>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x double> @llvm.fmuladd.v4f64(<4 x double>, <4 x double>, <4 x double>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x float> @llvm.round.v4f32(<4 x float>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x float> @llvm.rint.v4f32(<4 x float>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x i32> @llvm.sadd.sat.v4i32(<4 x i32>, <4 x i32>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x i8> @llvm.uadd.sat.v4i8(<4 x i8>, <4 x i8>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x i16> @llvm.ssub.sat.v4i16(<4 x i16>, <4 x i16>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x i64> @llvm.usub.sat.v4i64(<4 x i64>, <4 x i64>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x double> @llvm.trunc.v4f64(<4 x double>) #1

attributes #0 = { nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #1 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #2 = { nocallback nofree nosync nounwind speculatable willreturn memory(none) }

!llvm.module.flags = !{!0, !1, !2}
!llvm.ident = !{!3}

!0 = !{i32 8, !"PIC Level", i32 2}
!1 = !{i32 2, !"RtLibUseGOT", i32 1}
!2 = !{i32 7, !"uwtable", i32 2}
!3 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!4 = !{i64 6723998244623224159}
!5 = !{i64 5527960515423182425}
!6 = !{i64 -4315867626429300455}
!7 = !{i64 241000007999707832}
!8 = !{i64 8005007131353315819}
!9 = !{i64 6613480023208613220}
!10 = !{i64 -9168897889976993203}
!11 = !{i64 -2281880821674052847}
!12 = !{i64 -1871686404632665717}
!13 = !{i64 -2235313097054564370}
!14 = !{i64 4904513108024915863}
!15 = !{i64 -2562043583791628368}
!16 = !{i64 -5764033930096164529}
!17 = !{i64 3352697974670155499}
!18 = !{i64 -5755839525059402473}
!19 = !{i64 1601469422178741572}
!20 = !{i64 7960111690567677336}
!21 = !{i64 2965177110701619988}
!22 = !{i64 -2550544378990593333}
!23 = !{i64 8476019219255437708}
!24 = !{i64 -5211095205063325508}
!25 = !{i64 8984107202362580387}
!26 = !{i64 5726647241332987553}
!27 = !{i64 7457415095788235561}
!28 = !{i64 4526355197023789440}
!29 = !{i64 -477829304677127599}
!30 = !{i64 -4120942849878086411}
!31 = !{i64 -8269517781739584683}
!32 = !{i64 -8197475339024387735}
!33 = !{i64 4807659690216358205}
!34 = !{i64 -1549459125608769709}
!35 = !{i64 4978558403223926709}
!36 = !{i64 1175975385810487792}
!37 = !{i64 -4775953656197219064}
!38 = !{i64 3974104587983694341}
!39 = !{i64 -7588787568694928099}
!40 = !{i64 9029917325895833500}
!41 = !{i64 8159035527481647662}
!42 = !{i64 -4215722748854276810}
!43 = !{i64 3573187594583680825}
!44 = !{i64 8907218507086729050}
!45 = !{i64 -5804168804758630993}
!46 = !{i64 7058989668313056949}
!47 = !{i64 -3584133292201279437}
!48 = !{i64 -1284130059310298949}
!49 = !{i64 2144473868389122471}
!50 = !{i64 -6473264827726560860}
!51 = !{i64 8808395278906295316}
!52 = !{i64 -4250022903186761794}
!53 = !{i64 -7842300229183519846}
!54 = !{i64 5543646091672819808}
!55 = !{i64 -2519444687575857852}
!56 = !{i64 -4073015881326488633}
!57 = !{i64 2112797346077275869}
!58 = !{i64 5081745535838371307}
