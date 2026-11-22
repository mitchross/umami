import clickhouse from '@/lib/clickhouse';
import { CLICKHOUSE, PRISMA, runQuery } from '@/lib/db';
import prisma from '@/lib/prisma';

const FUNCTION_NAME = 'getReplayPages';

export interface ReplayPage {
  url: string;
  createdAt: Date | string;
}

/** Pageviews of one visit, oldest first, so the player can show the page at any point in time. */
export async function getReplayPages(websiteId: string, visitId: string): Promise<ReplayPage[]> {
  return runQuery({
    [PRISMA]: () => relationalQuery(websiteId, visitId),
    [CLICKHOUSE]: () => clickhouseQuery(websiteId, visitId),
  });
}

async function relationalQuery(websiteId: string, visitId: string): Promise<ReplayPage[]> {
  const { rawQuery } = prisma;

  return rawQuery(
    `
    select concat(hostname, url_path) as "url", created_at as "createdAt"
    from website_event
    where website_id = {{websiteId::uuid}}
      and visit_id = {{visitId::uuid}}
      and event_type = 1
    order by created_at
    limit 500
    `,
    { websiteId, visitId },
    FUNCTION_NAME,
  );
}

async function clickhouseQuery(websiteId: string, visitId: string): Promise<ReplayPage[]> {
  const { rawQuery } = clickhouse;

  return rawQuery(
    `
    select concat(hostname, url_path) as url, created_at as createdAt
    from website_event
    where website_id = {websiteId:UUID}
      and visit_id = {visitId:UUID}
      and event_type = 1
    order by created_at
    limit 500
    `,
    { websiteId, visitId },
    FUNCTION_NAME,
  );
}
