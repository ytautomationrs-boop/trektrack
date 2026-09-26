import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {it,expect} from 'vitest';
it('adds settings safely to an existing user table and is repeatable',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE TABLE "User" (id TEXT PRIMARY KEY); INSERT INTO "User" (id) VALUES ('existing');`);
 const sql=await readFile(new URL('../prisma/migrations/20260926160000_settings_security/migration.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
 const result=await db.query(`SELECT "authVersion","twoFactorEnabled","notificationPreferences" FROM "User"`);expect(result.rows).toEqual([{authVersion:0,twoFactorEnabled:false,notificationPreferences:{}}]);
 }finally{await db.close();}
});
