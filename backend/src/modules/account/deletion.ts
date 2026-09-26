import {prisma} from '../../lib/prisma.js';
const blocked=(message:string)=>Object.assign(new Error(message),{statusCode:409});
/** Never discard a wallet balance or a competition's unsettled prize claim. */
export async function deleteAccount(userId:string,authVersion:number,beforeDelete?:()=>Promise<void>){
 return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
  const user=await tx.user.findUniqueOrThrow({where:{id:userId}});
  if(user.authVersion!==authVersion)throw blocked('Account security changed. Sign in again.');
  if(user.walletBalanceCents!==0)throw blocked('Withdraw your wallet balance before deleting your account.');
  const [races,challenges,withdrawals,deposits]=await Promise.all([
   tx.raceEntry.count({where:{userId,race:{status:{in:['FILLING','LOCKED','RUNNING','RESOLVING']}}}}),
   tx.challenge.count({where:{status:{in:['OPEN','ACTIVE']},OR:[{creatorId:userId},{participants:{some:{userId}}}]}}),
   tx.withdrawal.count({where:{userId,status:'PENDING'}}),
   tx.depositIntent.count({where:{userId,status:'PENDING'}}),
  ]);
  if(races||challenges)throw blocked('Leave open competitions and finish active competitions before deleting your account.');
  if(withdrawals||deposits)throw blocked('A payment is still pending. Complete or resolve it before deleting your account.');
  if(beforeDelete)await beforeDelete();
  // Restricted historical relationships are explicitly removed; cascading
  // relations remove posts, photos, messages, notifications and credentials.
  await tx.report.deleteMany({where:{OR:[{reporterId:userId},{reportedUserId:userId}]}});
  await tx.raceEntry.deleteMany({where:{userId}});
  const squads=await tx.raceSquad.findMany({where:{captainUserId:userId},select:{id:true,entries:{take:1,select:{userId:true}}}});
  for(const squad of squads){
   if(squad.entries[0])await tx.raceSquad.update({where:{id:squad.id},data:{captainUserId:squad.entries[0].userId}});
   else await tx.raceSquad.delete({where:{id:squad.id}});
  }
  await tx.challengeInvite.deleteMany({where:{OR:[{inviterId:userId},{inviteeEmail:{equals:user.email,mode:'insensitive'}}]}});
  await tx.challengeParticipant.deleteMany({where:{userId}});
  // Completed legacy challenges retain their shared results without an owner.
  await tx.challenge.updateMany({where:{creatorId:userId},data:{creatorId:null}});
  await tx.$executeRaw`UPDATE "InviteCode" SET "usedByUserIds"=array_remove("usedByUserIds",${userId}) WHERE ${userId}=ANY("usedByUserIds")`;
  await tx.appNotification.deleteMany({where:{OR:[{data:{path:['actorId'],equals:userId}},{data:{path:['playerId'],equals:userId}}]}});
  await tx.user.delete({where:{id:userId}});
  return {deleted:true};
 },{isolationLevel:'Serializable',timeout:25000});
}
