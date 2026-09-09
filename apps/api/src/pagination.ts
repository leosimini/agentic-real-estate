import { z } from 'zod';

const cursorSchema = z.object({
  updatedAt: z.string().datetime({ offset: true }),
  id: z.string().uuid()
}).strict();

export type OpportunityCursor = z.infer<typeof cursorSchema>;

export function encodeCursor(cursor: OpportunityCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(cursor: string): OpportunityCursor {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw new Error('Invalid pagination cursor');
  }
}
