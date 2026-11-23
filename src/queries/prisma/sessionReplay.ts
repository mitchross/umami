import type { SessionReplaySaved } from '@/generated/prisma/client';
import { uuid } from '@/lib/crypto';
import prisma from '@/lib/prisma';
import type { PageResult, QueryFilters } from '@/lib/types';

export interface CreateReplayChunkArgs {
  websiteId: string;
  sessionId: string;
  visitId: string;
  chunkIndex: number;
  events: Uint8Array;
  eventCount: number;
  startedAt: Date;
  endedAt: Date;
}

export async function getReplayChunks(websiteId: string, visitId: string) {
  return prisma.client.sessionReplay.findMany({
    where: {
      websiteId,
      visitId,
    },
    orderBy: {
      chunkIndex: 'asc',
    },
    select: {
      events: true,
      sessionId: true,
      chunkIndex: true,
      eventCount: true,
      startedAt: true,
      endedAt: true,
    },
  });
}

export async function createReplayChunk({
  websiteId,
  sessionId,
  visitId,
  chunkIndex,
  events,
  eventCount,
  startedAt,
  endedAt,
}: CreateReplayChunkArgs) {
  return prisma.client.sessionReplay.create({
    data: {
      id: uuid(),
      websiteId,
      sessionId,
      visitId,
      chunkIndex,
      events: new Uint8Array(events) as any,
      eventCount,
      startedAt,
      endedAt,
    },
  });
}

export async function deleteReplaysByWebsite(websiteId: string) {
  return prisma.client.sessionReplay.deleteMany({
    where: { websiteId },
  });
}

/** Permanently deletes the given replays (by visit ID) and their saved entries. Events stay. */
export async function deleteReplays(websiteId: string, visitIds: string[]): Promise<number> {
  if (visitIds.length === 0) {
    return 0;
  }

  const transaction = prisma.transaction as <T>(input: (tx: any) => Promise<T>) => Promise<T>;

  return transaction(async tx => {
    const found = await tx.sessionReplay.findMany({
      where: { websiteId, visitId: { in: visitIds } },
      distinct: ['visitId'],
      select: { visitId: true },
    });

    await tx.sessionReplaySaved.deleteMany({
      where: { websiteId, visitId: { in: visitIds } },
    });

    await tx.sessionReplay.deleteMany({
      where: { websiteId, visitId: { in: visitIds } },
    });

    return found.length as number;
  });
}

export async function getReplaySaved(websiteId: string, visitId: string): Promise<boolean> {
  const record = await prisma.client.sessionReplaySaved.findUnique({
    where: { websiteId_visitId: { websiteId, visitId } },
    select: { id: true },
  });
  return record !== null;
}

export async function createReplaySaved(websiteId: string, visitId: string, name: string) {
  return prisma.client.sessionReplaySaved.create({
    data: { id: uuid(), websiteId, visitId, name },
  });
}

export async function updateReplaySaved(websiteId: string, visitId: string, name: string) {
  return prisma.client.sessionReplaySaved.updateMany({
    where: { websiteId, visitId },
    data: { name },
  });
}

export async function deleteReplaySaved(websiteId: string, visitId: string) {
  return prisma.client.sessionReplaySaved.deleteMany({
    where: { websiteId, visitId },
  });
}

export async function getSavedReplays(
  websiteId: string,
  filters: QueryFilters,
): Promise<PageResult<SessionReplaySaved[]>> {
  const { search } = filters;
  const { getSearchParameters, pagedQuery } = prisma;

  const where = {
    websiteId,
    ...getSearchParameters(search, [{ name: 'contains' }]),
  };

  return pagedQuery(
    'sessionReplaySaved',
    {
      where,
      orderBy: { createdAt: 'desc' },
    },
    filters,
  );
}
