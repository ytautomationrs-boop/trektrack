import {beforeEach,it,expect,vi} from 'vitest';
const db=vi.hoisted(()=>({create:vi.fn()}));
vi.mock('../../lib/prisma.js',()=>({prisma:{mediaAsset:db}}));
import {storePhoto} from './service.js';
beforeEach(()=>{vi.clearAllMocks();db.create.mockResolvedValue({});});
it('stores an uploaded photo separately and returns an opaque URL',async()=>{
 const result=await storePhoto('owner','data:image/jpeg;base64,/9j/2Q==');
 expect(result).toMatch(/\/media\/[0-9a-f]{48}$/);expect(db.create.mock.calls[0]![0].data.ownerId).toBe('owner');expect(db.create.mock.calls[0]![0].data.bytes).toBeInstanceOf(Buffer);
});
it('rejects disguised content and oversized uploads without storing them',async()=>{
 await expect(storePhoto('owner','data:image/jpeg;base64,SGVsbG8=')).rejects.toMatchObject({statusCode:400});
 const bytes=Buffer.alloc(600001);bytes[0]=255;bytes[1]=216;
 await expect(storePhoto('owner',`data:image/jpeg;base64,${bytes.toString('base64')}`)).rejects.toMatchObject({statusCode:400});expect(db.create).not.toHaveBeenCalled();
});
