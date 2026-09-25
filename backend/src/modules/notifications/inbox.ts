import { prisma } from '../../lib/prisma.js';
import { notifyUser, type NotificationKind } from './service.js';
/** Persist first; push delivery runs separately and never delays an action. */
export async function notifyActivity(userId: string, kind: string, dedupeKey: string, title: string, body: string, data: Record<string,string>) {
 try {
  const notification = await prisma.appNotification.create({data:{userId,kind,dedupeKey,title,body,data}});
  void notifyUser(userId,kind as NotificationKind,{title,body,data:{...data,notificationId:notification.id}});
 } catch (error: any) {
  if (error?.code !== 'P2002') console.error('[notifications] could not persist activity',error?.message);
 }
}
