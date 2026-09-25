import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';


export async function storePhoto(ownerId: string, image: string | null | undefined): Promise<string | null> {
  if (!image) return null;
  if (!image.startsWith('data:')) return image;
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image);
  if (!match) throw Object.assign(new Error('Choose a JPEG, PNG or WebP photo.'), { statusCode: 400 });
  const bytes = Buffer.from(match[2]!, 'base64');
  const valid = match[1] === 'jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 : match[1] === 'png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
  if (!valid || bytes.length > 600_000) throw Object.assign(new Error('This photo could not be prepared. Choose it again to resize it.'), { statusCode: 400 });
  // A high-entropy capability URL, like a private object-storage download URL.
  // Photos never travel inside feed or participant JSON after upload.
  const id = randomBytes(24).toString('hex');
  await prisma.mediaAsset.create({ data: { id, ownerId, contentType: `image/${match[1]}`, bytes } });
  return `${(process.env.WEB_APP_URL || 'https://lightsteelblue-giraffe-860469.hostingersite.com').replace(/\/$/,'')}/media/${id}`;
}
export async function mediaRoutes(app: FastifyInstance) {
  app.get('/media/:id', async (req, reply) => {
    const { id } = req.params as {id: string};
    if (!/^[a-f0-9]{48}$/.test(id)) return reply.code(404).send();
    const asset = await prisma.mediaAsset.findUnique({ where: {id}, select: {bytes:true,contentType:true} });
    if (!asset) return reply.code(404).send();
    return reply.header('Cache-Control','public, max-age=31536000, immutable').header('X-Content-Type-Options','nosniff').type(asset.contentType).send(asset.bytes);
  });
}
