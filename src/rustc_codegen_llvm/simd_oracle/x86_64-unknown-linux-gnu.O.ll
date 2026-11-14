; ModuleID = 'simd.98f09ecde305efe2-cgu.0'
source_filename = "simd.98f09ecde305efe2-cgu.0"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

; Function Attrs: nonlazybind uwtable
define <4 x float> @f_add_f32(<4 x float> %a, <4 x float> %b) unnamed_addr #0 !guid !4 {
start:
  %_0 = fadd <4 x float> %a, %b
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define <16 x i8> @f_and(<16 x i8> %a, <16 x i8> %b) unnamed_addr #0 !guid !5 {
start:
  %_0 = and <16 x i8> %a, %b
  ret <16 x i8> %_0
}

; Function Attrs: nonlazybind uwtable
define noundef i16 @f_bitmask_array(<16 x i8> %a) unnamed_addr #0 !guid !6 {
start:
  %0 = alloca [2 x i8], align 1
  %_0 = alloca [2 x i8], align 1
  %1 = lshr <16 x i8> %a, splat (i8 7)
  %2 = trunc <16 x i8> %1 to <16 x i1>
  %3 = bitcast <16 x i1> %2 to i16
  store i16 %3, ptr %0, align 1
  %4 = load [2 x i8], ptr %0, align 1
  store [2 x i8] %4, ptr %_0, align 1
  %5 = load i16, ptr %_0, align 1
  ret i16 %5
}

; Function Attrs: nonlazybind uwtable
define noundef i16 @f_bitmask_u16(<16 x i8> %a) unnamed_addr #0 !guid !7 {
start:
  %0 = lshr <16 x i8> %a, splat (i8 7)
  %1 = trunc <16 x i8> %0 to <16 x i1>
  %_0 = bitcast <16 x i1> %1 to i16
  ret i16 %_0
}

; Function Attrs: nonlazybind uwtable
define noundef i8 @f_bitmask_u8(<4 x i32> %a) unnamed_addr #0 !guid !8 {
start:
  %0 = lshr <4 x i32> %a, splat (i32 31)
  %1 = trunc <4 x i32> %0 to <4 x i1>
  %2 = bitcast <4 x i1> %1 to i4
  %_0 = zext i4 %2 to i8
  ret i8 %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @f_cg(<4 x i32> %a, <4 x i32> %b) unnamed_addr #0 !guid !9 {
start:
  %_0 = shufflevector <4 x i32> %a, <4 x i32> %b, <4 x i32> <i32 7, i32 1, i32 5, i32 0>
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define void @f_cg_wide(ptr dead_on_unwind noalias nofree noundef writable sret([32 x i8]) align 32 captures(address) dereferenceable(32) %_0, <4 x i32> %a, <4 x i32> %b) unnamed_addr #0 !guid !10 {
start:
  %0 = shufflevector <4 x i32> %a, <4 x i32> %b, <8 x i32> <i32 0, i32 1, i32 2, i32 3, i32 4, i32 5, i32 6, i32 7>
  store <8 x i32> %0, ptr %_0, align 32
  ret void
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @f_div_i32(<4 x i32> %a, <4 x i32> %b) unnamed_addr #0 !guid !11 {
start:
  %_0 = sdiv <4 x i32> %a, %b
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @f_div_u32(<4 x i32> %a, <4 x i32> %b) unnamed_addr #0 !guid !12 {
start:
  %_0 = udiv <4 x i32> %a, %b
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <16 x i8> @f_eq_u8(<16 x i8> %a, <16 x i8> %b) unnamed_addr #0 !guid !13 {
start:
  %0 = icmp eq <16 x i8> %a, %b
  %_0 = sext <16 x i1> %0 to <16 x i8>
  ret <16 x i8> %_0
}

; Function Attrs: nonlazybind uwtable
define noundef i32 @f_extract(<4 x i32> %a) unnamed_addr #0 !guid !14 {
start:
  %_0 = extractelement <4 x i32> %a, i32 3
  ret i32 %_0
}

; Function Attrs: nonlazybind uwtable
define noundef i32 @f_extract_dyn(<4 x i32> %a, i32 noundef %i) unnamed_addr #0 !guid !15 {
start:
  %_0 = extractelement <4 x i32> %a, i32 %i
  ret i32 %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @f_ge_u32(<4 x i32> %a, <4 x i32> %b) unnamed_addr #0 !guid !16 {
start:
  %0 = icmp uge <4 x i32> %a, %b
  %_0 = sext <4 x i1> %0 to <4 x i32>
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @f_gt_f32(<4 x float> %a, <4 x float> %b) unnamed_addr #0 !guid !17 {
start:
  %0 = fcmp ogt <4 x float> %a, %b
  %_0 = sext <4 x i1> %0 to <4 x i32>
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @f_insert(<4 x i32> %a, i32 noundef %v) unnamed_addr #0 !guid !18 {
start:
  %_0 = insertelement <4 x i32> %a, i32 %v, i32 2
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @f_insert_dyn(<4 x i32> %a, i32 noundef %i, i32 noundef %v) unnamed_addr #0 !guid !19 {
start:
  %_0 = insertelement <4 x i32> %a, i32 %v, i32 %i
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @f_le_u32(<4 x i32> %a, <4 x i32> %b) unnamed_addr #0 !guid !20 {
start:
  %0 = icmp ule <4 x i32> %a, %b
  %_0 = sext <4 x i1> %0 to <4 x i32>
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @f_lt_f32(<4 x float> %a, <4 x float> %b) unnamed_addr #0 !guid !21 {
start:
  %0 = fcmp olt <4 x float> %a, %b
  %_0 = sext <4 x i1> %0 to <4 x i32>
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @f_lt_i32(<4 x i32> %a, <4 x i32> %b) unnamed_addr #0 !guid !22 {
start:
  %0 = icmp slt <4 x i32> %a, %b
  %_0 = sext <4 x i1> %0 to <4 x i32>
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x float> @f_max_nsz(<4 x float> %a, <4 x float> %b) unnamed_addr #0 !guid !23 {
start:
  %_0 = call nsz <4 x float> @llvm.maximumnum.v4f32(<4 x float> %a, <4 x float> %b)
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x float> @f_min_nsz(<4 x float> %a, <4 x float> %b) unnamed_addr #0 !guid !24 {
start:
  %_0 = call nsz <4 x float> @llvm.minimumnum.v4f32(<4 x float> %a, <4 x float> %b)
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @f_mul_u32(<4 x i32> %a, <4 x i32> %b) unnamed_addr #0 !guid !25 {
start:
  %_0 = mul <4 x i32> %a, %b
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @f_ne_i32(<4 x i32> %a, <4 x i32> %b) unnamed_addr #0 !guid !26 {
start:
  %0 = icmp ne <4 x i32> %a, %b
  %_0 = sext <4 x i1> %0 to <4 x i32>
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x float> @f_neg_f32(<4 x float> %a) unnamed_addr #0 !guid !27 {
start:
  %_0 = fneg <4 x float> %a
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @f_neg_i32(<4 x i32> %a) unnamed_addr #0 !guid !28 {
start:
  %_0 = sub <4 x i32> zeroinitializer, %a
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <16 x i8> @f_or(<16 x i8> %a, <16 x i8> %b) unnamed_addr #0 !guid !29 {
start:
  %_0 = or <16 x i8> %a, %b
  ret <16 x i8> %_0
}

; Function Attrs: nonlazybind uwtable
define noundef zeroext i1 @f_reduce_all(<16 x i8> %a) unnamed_addr #0 !guid !30 {
start:
  %0 = lshr <16 x i8> %a, splat (i8 7)
  %1 = trunc <16 x i8> %0 to <16 x i1>
  %_0 = call i1 @llvm.vector.reduce.and.v16i1(<16 x i1> %1)
  ret i1 %_0
}

; Function Attrs: nonlazybind uwtable
define noundef i32 @f_reduce_and(<4 x i32> %a) unnamed_addr #0 !guid !31 {
start:
  %_0 = call i32 @llvm.vector.reduce.and.v4i32(<4 x i32> %a)
  ret i32 %_0
}

; Function Attrs: nonlazybind uwtable
define noundef zeroext i1 @f_reduce_any(<4 x i32> %a) unnamed_addr #0 !guid !32 {
start:
  %0 = lshr <4 x i32> %a, splat (i32 31)
  %1 = trunc <4 x i32> %0 to <4 x i1>
  %_0 = call i1 @llvm.vector.reduce.or.v4i1(<4 x i1> %1)
  ret i1 %_0
}

; Function Attrs: nonlazybind uwtable
define noundef zeroext i1 @f_reduce_any_u8(<16 x i8> %a) unnamed_addr #0 !guid !33 {
start:
  %0 = lshr <16 x i8> %a, splat (i8 7)
  %1 = trunc <16 x i8> %0 to <16 x i1>
  %_0 = call i1 @llvm.vector.reduce.or.v16i1(<16 x i1> %1)
  ret i1 %_0
}

; Function Attrs: nonlazybind uwtable
define noundef i32 @f_reduce_max_u32(<4 x i32> %a) unnamed_addr #0 !guid !34 {
start:
  %_0 = call i32 @llvm.vector.reduce.umax.v4i32(<4 x i32> %a)
  ret i32 %_0
}

; Function Attrs: nonlazybind uwtable
define noundef i32 @f_reduce_min_i32(<4 x i32> %a) unnamed_addr #0 !guid !35 {
start:
  %_0 = call i32 @llvm.vector.reduce.smin.v4i32(<4 x i32> %a)
  ret i32 %_0
}

; Function Attrs: nonlazybind uwtable
define noundef i8 @f_reduce_or(<16 x i8> %a) unnamed_addr #0 !guid !36 {
start:
  %_0 = call i8 @llvm.vector.reduce.or.v16i8(<16 x i8> %a)
  ret i8 %_0
}

; Function Attrs: nonlazybind uwtable
define noundef i32 @f_reduce_xor(<4 x i32> %a) unnamed_addr #0 !guid !37 {
start:
  %_0 = call i32 @llvm.vector.reduce.xor.v4i32(<4 x i32> %a)
  ret i32 %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x float> @f_rem_f32(<4 x float> %a, <4 x float> %b) unnamed_addr #0 !guid !38 {
start:
  %_0 = frem <4 x float> %a, %b
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @f_rem_i32(<4 x i32> %a, <4 x i32> %b) unnamed_addr #0 !guid !39 {
start:
  %_0 = srem <4 x i32> %a, %b
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @f_rem_u32(<4 x i32> %a, <4 x i32> %b) unnamed_addr #0 !guid !40 {
start:
  %_0 = urem <4 x i32> %a, %b
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @f_select_bitmask(i8 noundef %m, <4 x i32> %a, <4 x i32> %b) unnamed_addr #0 !guid !41 {
start:
  %0 = trunc i8 %m to i4
  %1 = bitcast i4 %0 to <4 x i1>
  %_0 = select <4 x i1> %1, <4 x i32> %a, <4 x i32> %b
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @f_select_bitmask_array(i8 noundef %0, <4 x i32> %a, <4 x i32> %b) unnamed_addr #0 !guid !42 {
start:
  %1 = alloca [1 x i8], align 1
  %2 = alloca [1 x i8], align 1
  %m = alloca [1 x i8], align 1
  call void @llvm.lifetime.start.p0(ptr %2)
  store i8 %0, ptr %2, align 1
  call void @llvm.memcpy.p0.p0.i64(ptr align 1 %m, ptr align 1 %2, i64 1, i1 false)
  call void @llvm.lifetime.end.p0(ptr %2)
  call void @llvm.memcpy.p0.p0.i64(ptr align 1 %1, ptr align 1 %m, i64 1, i1 false)
  %3 = load i8, ptr %1, align 1
  %4 = trunc i8 %3 to i4
  %5 = bitcast i4 %4 to <4 x i1>
  %_0 = select <4 x i1> %5, <4 x i32> %a, <4 x i32> %b
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @f_shl(<4 x i32> %a, <4 x i32> %b) unnamed_addr #0 !guid !43 {
start:
  %_0 = shl <4 x i32> %a, %b
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @f_shr_i32(<4 x i32> %a, <4 x i32> %b) unnamed_addr #0 !guid !44 {
start:
  %_0 = ashr <4 x i32> %a, %b
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @f_shr_u32(<4 x i32> %a, <4 x i32> %b) unnamed_addr #0 !guid !45 {
start:
  %_0 = lshr <4 x i32> %a, %b
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @f_shuffle(<4 x i32> %a, <4 x i32> %b) unnamed_addr #0 !guid !46 {
start:
  %_0 = shufflevector <4 x i32> %a, <4 x i32> %b, <4 x i32> <i32 7, i32 0, i32 5, i32 2>
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define void @f_shuffle_wide(ptr dead_on_unwind noalias nofree noundef writable sret([32 x i8]) align 32 captures(address) dereferenceable(32) %_0, <4 x i32> %a, <4 x i32> %b) unnamed_addr #0 !guid !47 {
start:
  %0 = shufflevector <4 x i32> %a, <4 x i32> %b, <8 x i32> <i32 0, i32 1, i32 2, i32 3, i32 4, i32 5, i32 6, i32 7>
  store <8 x i32> %0, ptr %_0, align 32
  ret void
}

; Function Attrs: nonlazybind uwtable
define <4 x float> @f_splat_f32(float noundef %x) unnamed_addr #0 !guid !48 {
start:
  %0 = insertelement <4 x float> poison, float %x, i32 0
  %_0 = shufflevector <4 x float> %0, <4 x float> poison, <4 x i32> zeroinitializer
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define <16 x i8> @f_splat_u8(i8 noundef %x) unnamed_addr #0 !guid !49 {
start:
  %0 = insertelement <16 x i8> poison, i8 %x, i32 0
  %_0 = shufflevector <16 x i8> %0, <16 x i8> poison, <16 x i32> zeroinitializer
  ret <16 x i8> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @f_sub_i32(<4 x i32> %a, <4 x i32> %b) unnamed_addr #0 !guid !50 {
start:
  %_0 = sub <4 x i32> %a, %b
  ret <4 x i32> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x i32> @f_xor(<4 x i32> %a, <4 x i32> %b) unnamed_addr #0 !guid !51 {
start:
  %_0 = xor <4 x i32> %a, %b
  ret <4 x i32> %_0
}

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x float> @llvm.maximumnum.v4f32(<4 x float>, <4 x float>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare <4 x float> @llvm.minimumnum.v4f32(<4 x float>, <4 x float>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i1 @llvm.vector.reduce.and.v16i1(<16 x i1>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i32 @llvm.vector.reduce.and.v4i32(<4 x i32>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i1 @llvm.vector.reduce.or.v4i1(<4 x i1>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i1 @llvm.vector.reduce.or.v16i1(<16 x i1>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i32 @llvm.vector.reduce.umax.v4i32(<4 x i32>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i32 @llvm.vector.reduce.smin.v4i32(<4 x i32>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i8 @llvm.vector.reduce.or.v16i8(<16 x i8>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i32 @llvm.vector.reduce.xor.v4i32(<4 x i32>) #1

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(argmem: readwrite)
declare void @llvm.lifetime.start.p0(ptr captures(none)) #2

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(argmem: readwrite)
declare void @llvm.memcpy.p0.p0.i64(ptr noalias writeonly captures(none), ptr noalias readonly captures(none), i64, i1 immarg) #2

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(argmem: readwrite)
declare void @llvm.lifetime.end.p0(ptr captures(none)) #2

attributes #0 = { nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #1 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #2 = { nocallback nofree nosync nounwind willreturn memory(argmem: readwrite) }

!llvm.module.flags = !{!0, !1, !2}
!llvm.ident = !{!3}

!0 = !{i32 8, !"PIC Level", i32 2}
!1 = !{i32 2, !"RtLibUseGOT", i32 1}
!2 = !{i32 7, !"uwtable", i32 2}
!3 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!4 = !{i64 5171964673683194894}
!5 = !{i64 -5299514047830926414}
!6 = !{i64 -4550566506347628712}
!7 = !{i64 4738336959258531906}
!8 = !{i64 -6685619418040964307}
!9 = !{i64 -4533340468471311072}
!10 = !{i64 -7524655871995819610}
!11 = !{i64 -4549167555786338323}
!12 = !{i64 1064698909710127072}
!13 = !{i64 3843973910164818589}
!14 = !{i64 -4206624943203161159}
!15 = !{i64 1872128067710552100}
!16 = !{i64 -2543028107187582910}
!17 = !{i64 5927507960539778826}
!18 = !{i64 2089984554589726042}
!19 = !{i64 8411653500061538658}
!20 = !{i64 8229451485811816736}
!21 = !{i64 2281922531565220500}
!22 = !{i64 -4818354544644487280}
!23 = !{i64 -8945034329640514911}
!24 = !{i64 -632784438056443391}
!25 = !{i64 -2630305438492140774}
!26 = !{i64 8706017194683465203}
!27 = !{i64 -8924993551987989338}
!28 = !{i64 -6379767854529136175}
!29 = !{i64 -5461068446506417641}
!30 = !{i64 -71440370306828889}
!31 = !{i64 2625876153735894829}
!32 = !{i64 -6070216921975556696}
!33 = !{i64 -3672552659539554688}
!34 = !{i64 3702247741943361860}
!35 = !{i64 -6038295639407368525}
!36 = !{i64 5356887938430040075}
!37 = !{i64 5038364738385663425}
!38 = !{i64 4637420813866920670}
!39 = !{i64 -1110594301873475514}
!40 = !{i64 4398582303931543420}
!41 = !{i64 -7054853206829439366}
!42 = !{i64 -1972109390307265899}
!43 = !{i64 6434795502386076660}
!44 = !{i64 -7700953650839232465}
!45 = !{i64 1843714330859135119}
!46 = !{i64 -7136294369580016360}
!47 = !{i64 2022400298028973002}
!48 = !{i64 -1645337776680461458}
!49 = !{i64 7997696660298571242}
!50 = !{i64 3089917591610506898}
!51 = !{i64 -2471958441396022244}
