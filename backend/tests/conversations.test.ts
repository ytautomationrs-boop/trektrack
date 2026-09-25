import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
const mocks=vi.hoisted(()=>({$queryRaw:vi.fn(),directMessage:{groupBy:vi.fn()},user:{findMany:vi.fn()}}));
vi.mock('../src/lib/prisma.js',()=>({prisma:mocks}));
vi.mock('../src/modules/notifications/inbox.js',()=>({notifyActivity:vi.fn()}));
import {listConversations} from '../src/modules/social/service.js';
const sql=new PGlite();
beforeAll(async()=>{
 await sql.exec(`CREATE TABLE "DirectMessage" (id TEXT PRIMARY KEY,"senderId" TEXT,"recipientId" TEXT,body TEXT,"createdAt" TIMESTAMP,"readAt" TIMESTAMP);
 INSERT INTO "DirectMessage" VALUES ('old','viewer','friend','Old','2026-09-01',NULL),('latest','friend','viewer','Latest','2026-09-25',NULL),('other','another','viewer','Another','2026-09-20',NULL),('private','unrelated','stranger','Private','2026-09-25',NULL);`);
 mocks.$queryRaw.mockImplementation(async(strings:TemplateStringsArray,...values:unknown[])=>{
  // Bind each occurrence separately, exactly as Prisma does. Substituting
  // literals hides PostgreSQL's DISTINCT ON parameter-identity error.
  const query=strings.reduce((q,part,i)=>q+(i?`$${i}`:'')+part,'');return (await sql.query(query,values)).rows;
 });
 mocks.directMessage.groupBy.mockResolvedValue([{senderId:'friend',_count:{_all:1}}]);
 mocks.user.findMany.mockResolvedValue(['friend','another'].map(id=>({id,displayName:id,avatarUrl:null,bio:null,createdAt:new Date()})));
});
afterAll(()=>sql.close());
it('loads latest conversations using real PostgreSQL parameter binding',async()=>{
 const rows=await listConversations('viewer');expect(rows.map(row=>row.lastMessage.id)).toEqual(['latest','other']);expect(rows[0]?.player.id).toBe('friend');expect(rows[0]?.unreadCount).toBe(1);
});
