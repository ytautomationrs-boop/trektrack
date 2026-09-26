import {poolAttestationRoutes} from './attestation.js';
import {poolHealthRoutes} from './health.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { reportSchema } from './engine.js';
import { fillTestPlayers,advancePool,createPool,getPool,joinPool,leavePool,listPools,reportPool,tickPools } from './store.js';
export async function poolRoutes(app:FastifyInstance){
  await app.register(poolHealthRoutes);
  await app.register(poolAttestationRoutes);
  app.get('/pools',{preHandler:requireAuth},async req=>listPools(req.userId));
  app.post('/pools',{preHandler:requireAuth},async(req,reply)=>{const u=await prisma.user.findUniqueOrThrow({where:{id:req.userId},select:{displayName:true}});return reply.code(201).send({pool:await createPool(req.userId,u.displayName,req.body)});});
  app.get<{Params:{id:string}}>('/pools/:id',{preHandler:requireAuth},async req=>({pool:await getPool(req.params.id,req.userId)}));
  app.post<{Params:{id:string}}>('/pools/:id/join',{preHandler:requireAuth},async req=>{const u=await prisma.user.findUniqueOrThrow({where:{id:req.userId},select:{displayName:true}});return {pool:await joinPool(req.params.id,req.userId,u.displayName)};});
  app.post<{Params:{id:string}}>('/pools/:id/leave',{preHandler:requireAuth},async req=>({pool:await leavePool(req.params.id,req.userId)}));
  app.post<{Params:{id:string}}>('/pools/:id/test-fill',{preHandler:requireAuth},async req=>({pool:await fillTestPlayers(req.params.id,req.userId)}));
  app.post<{Params:{id:string}}>('/pools/:id/test-report',{preHandler:requireAuth},async req=>{const b=reportSchema.parse(req.body);return {pool:await reportPool(req.params.id,req.userId,b.participantId,b.day,b)};});
  app.post<{Params:{id:string}}>('/pools/:id/test-advance',{preHandler:requireAuth},async req=>{const b=z.object({version:z.number().int().min(0),reports:z.array(reportSchema).max(50).optional()}).parse(req.body);return {pool:await advancePool(req.params.id,req.userId,b.version,b.reports)};});
  let running=false;
  // Separate from the existing race/payment job switch: only test credits.
  const timer=setInterval(()=>{if(running)return;running=true;void tickPools().catch(e=>app.log.error(e,'Pool test lifecycle')).finally(()=>{running=false;});},60000);timer.unref();app.addHook('onClose',async()=>clearInterval(timer));
}
