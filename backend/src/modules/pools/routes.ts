import {poolAttestationRoutes} from './attestation.js';
import {poolHealthRoutes} from './health.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { createPool,getPool,joinPool,leavePool,listPools,tickPools } from './store.js';
export async function poolRoutes(app:FastifyInstance){
  await app.register(poolHealthRoutes);
  await app.register(poolAttestationRoutes);
  app.get('/pools',{preHandler:requireAuth},async req=>listPools(req.userId));
  app.post('/pools',{preHandler:requireAuth},async(req,reply)=>{z.object({currency:z.literal('ZAR')}).passthrough().parse(req.body);const u=await prisma.user.findUniqueOrThrow({where:{id:req.userId},select:{displayName:true}});return reply.code(201).send({pool:await createPool(req.userId,u.displayName,req.body)});});
  app.get<{Params:{id:string}}>('/pools/:id',{preHandler:requireAuth},async req=>({pool:await getPool(req.params.id,req.userId)}));
  app.post<{Params:{id:string}}>('/pools/:id/join',{preHandler:requireAuth},async req=>{const u=await prisma.user.findUniqueOrThrow({where:{id:req.userId},select:{displayName:true}});return {pool:await joinPool(req.params.id,req.userId,u.displayName)};});
  app.post<{Params:{id:string}}>('/pools/:id/leave',{preHandler:requireAuth},async req=>({pool:await leavePool(req.params.id,req.userId)}));
  let running=false;
  // Pool lifecycle runs independently of payment-provider jobs.
  const timer=setInterval(()=>{if(running)return;running=true;void tickPools().catch(e=>app.log.error(e,'Pool lifecycle')).finally(()=>{running=false;});},60000);timer.unref();app.addHook('onClose',async()=>clearInterval(timer));
}
