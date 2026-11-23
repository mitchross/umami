import { beforeEach, expect, test, vi } from 'vitest';
import { isRelationalOnly } from '@/lib/db';
import { parseRequest } from '@/lib/request';
import { canDeleteWebsite } from '@/permissions';
import { deleteReplays } from '@/queries/prisma/sessionReplay';
import { POST } from './route';

vi.mock('@/lib/db', () => ({
  isRelationalOnly: vi.fn(),
}));

vi.mock('@/lib/request', () => ({
  parseRequest: vi.fn(),
}));

vi.mock('@/permissions', () => ({
  canDeleteWebsite: vi.fn(),
}));

vi.mock('@/queries/prisma/sessionReplay', () => ({
  deleteReplays: vi.fn(),
}));

const isRelationalOnlyMock = vi.mocked(isRelationalOnly);
const parseRequestMock = vi.mocked(parseRequest);
const canDeleteWebsiteMock = vi.mocked(canDeleteWebsite);
const deleteReplaysMock = vi.mocked(deleteReplays);

const REPLAY_1 = '11111111-1111-4111-8111-111111111111';
const REPLAY_2 = '22222222-2222-4222-8222-222222222222';

function post() {
  return POST(new Request('http://localhost/api/websites/website-1/replays/delete'), {
    params: Promise.resolve({ websiteId: 'website-1' }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

test('POST deletes the requested replays once each', async () => {
  parseRequestMock.mockResolvedValue({
    auth: {},
    body: { replayIds: [REPLAY_1, REPLAY_2, REPLAY_1] },
    error: undefined,
  } as any);
  isRelationalOnlyMock.mockReturnValue(true);
  canDeleteWebsiteMock.mockResolvedValue(true);
  deleteReplaysMock.mockResolvedValue(2);

  const response = await post();

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ deleted: 2 });
  expect(deleteReplaysMock).toHaveBeenCalledWith('website-1', [REPLAY_1, REPLAY_2]);
});

test('POST is unauthorized without delete permission', async () => {
  parseRequestMock.mockResolvedValue({
    auth: {},
    body: { replayIds: [REPLAY_1] },
    error: undefined,
  } as any);
  isRelationalOnlyMock.mockReturnValue(true);
  canDeleteWebsiteMock.mockResolvedValue(false);

  const response = await post();

  expect(response.status).toBe(401);
  expect(deleteReplaysMock).not.toHaveBeenCalled();
});

test('POST is rejected on ClickHouse storage', async () => {
  parseRequestMock.mockResolvedValue({
    auth: {},
    body: { replayIds: [REPLAY_1] },
    error: undefined,
  } as any);
  isRelationalOnlyMock.mockReturnValue(false);

  const response = await post();

  expect(response.status).toBe(400);
  expect(deleteReplaysMock).not.toHaveBeenCalled();
});
