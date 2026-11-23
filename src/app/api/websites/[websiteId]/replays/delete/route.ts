import { z } from 'zod';
import { isRelationalOnly } from '@/lib/db';
import { parseRequest } from '@/lib/request';
import { badRequest, json, unauthorized } from '@/lib/response';
import { canDeleteWebsite } from '@/permissions';
import { deleteReplays } from '@/queries/prisma/sessionReplay';

const MAX_DELETE_REPLAYS = 500;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const schema = z.object({
    replayIds: z.array(z.uuid()).min(1).max(MAX_DELETE_REPLAYS),
  });

  const { auth, body, error } = await parseRequest(request, schema);

  if (error) {
    return error();
  }

  if (!isRelationalOnly()) {
    return badRequest({ message: 'Replay deletion is only available with relational storage.' });
  }

  const { websiteId } = await params;

  if (!(await canDeleteWebsite(auth, websiteId))) {
    return unauthorized();
  }

  const deleted = await deleteReplays(websiteId, [...new Set<string>(body.replayIds)]);

  return json({ deleted });
}
