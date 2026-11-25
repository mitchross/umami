import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getSessionReplays } from './getSessionReplays';

const { pagedRawQueryMock } = vi.hoisted(() => ({ pagedRawQueryMock: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  default: {
    pagedRawQuery: pagedRawQueryMock,
    parseFilters: () => ({
      filterQuery: '',
      cohortQuery: '',
      queryParams: {},
      joinSessionQuery: '',
    }),
  },
}));
vi.mock('@/lib/clickhouse', () => ({ default: {} }));
vi.mock('@/lib/db', () => ({
  PRISMA: 'prisma',
  CLICKHOUSE: 'clickhouse',
  runQuery: (queries: Record<string, () => unknown>) => queries.prisma(),
}));

describe('getSessionReplays', () => {
  beforeEach(() => {
    pagedRawQueryMock.mockReset();
    pagedRawQueryMock.mockResolvedValue({ data: [], count: 0 });
  });

  test('hides visits whose chunks are all known to have no human input', async () => {
    await getSessionReplays('website-1', {} as any);

    const sql = pagedRawQueryMock.mock.calls[0][0] as string;

    expect(sql).toMatch(/having bool_or\(coalesce\(sr\.has_interaction, true\)\)/);
    expect(sql).not.toContain('{{minDurationMs}}');
  });

  test('keeps the minimum duration filter alongside the interaction filter', async () => {
    await getSessionReplays('website-1', { minDuration: 5 } as any);

    const [sql, params] = pagedRawQueryMock.mock.calls[0];

    expect(sql).toMatch(/having bool_or\(coalesce\(sr\.has_interaction, true\)\)\s+and extract/);
    expect(params.minDurationMs).toBe(5000);
  });
});
