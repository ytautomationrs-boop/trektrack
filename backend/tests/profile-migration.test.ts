import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {it,expect} from 'vitest';
it('deduplicates legacy usernames, enforces case-insensitive uniqueness and preserves original accounts',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE TABLE "User" (id TEXT PRIMARY KEY,"displayName" TEXT NOT NULL,"createdAt" TIMESTAMP DEFAULT now()); CREATE TABLE "Challenge" (id TEXT PRIMARY KEY,"creatorId" TEXT NOT NULL REFERENCES "User"(id)); INSERT INTO "User"(id,"displayName","createdAt") VALUES ('old','Runner','2020-01-01'),('new',' runner ','2021-01-01');`);
 const sql=await readFile(new URL('../prisma/migrations/20260927010000_profile_cover/migration.sql',import.meta.url),'utf8');
 await db.exec(sql);await db.exec(sql);
 const names=await db.query<{displayName:string}>(`SELECT "displayName" FROM "User" ORDER BY "createdAt"`);
 expect(names.rows[0]?.displayName).toBe('Runner');expect(names.rows[1]?.displayName).not.toBe(' runner ');
 await expect(db.exec(`INSERT INTO "User"(id,"displayName") VALUES ('third','RUNNER')`)).rejects.toThrow();
 }finally{await db.close();}
});
