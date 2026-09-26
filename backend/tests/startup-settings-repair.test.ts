import {PGlite} from '@electric-sql/pglite';
import {createRequire} from 'node:module';
import {it,expect} from 'vitest';
const {ensureSettingsSchema}=createRequire(import.meta.url)('../startup-settings-schema.cjs');
it('repairs a partially changed foreign key and skips DDL on healthy startup',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`CREATE TABLE "User" (id TEXT PRIMARY KEY,"displayName" TEXT NOT NULL,"createdAt" TIMESTAMP DEFAULT now()); CREATE TABLE "Challenge" (id TEXT PRIMARY KEY,"creatorId" TEXT REFERENCES "User"(id)); INSERT INTO "User" (id,"displayName") VALUES ('u','Runner'); INSERT INTO "Challenge" VALUES ('c','u');`);
  let writes=0;
  const client={$queryRawUnsafe:async(sql:string)=>(await db.query(sql)).rows,$executeRawUnsafe:async(sql:string)=>{writes++;await db.exec(sql);}};
  await ensureSettingsSchema(client);
  expect(writes).toBeGreaterThan(0);writes=0;
  await ensureSettingsSchema(client);expect(writes).toBe(0);
  await db.exec(`DELETE FROM "User" WHERE id='u'`);
  expect((await db.query(`SELECT "creatorId" FROM "Challenge"`)).rows).toEqual([{creatorId:null}]);
 }finally{await db.close();}
});
