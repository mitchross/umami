import { corsPreflight, getApiCorsHeaders, withCorsHeaders } from '@/lib/cors';
import { getRecorderConfig } from '@/lib/recorder';
import { parseRequest } from '@/lib/request';
import { AUTO_WEBSITE_ID } from '@/lib/website-config';
import { resolveWebsiteByHostname } from '@/lib/website-provision';
import { getWebsite } from '@/queries/prisma';

export function OPTIONS() {
  return corsPreflight();
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { error } = await parseRequest(request, null, { skipAuth: true });

  if (error) {
    return withCorsHeaders(error());
  }

  const { websiteId: requestedWebsite } = await params;
  // `auto` recorders send the page hostname, because this GET has no body.
  const websiteId =
    requestedWebsite === AUTO_WEBSITE_ID
      ? await resolveWebsiteByHostname(new URL(request.url).searchParams.get('hostname'))
      : requestedWebsite;
  const website = websiteId ? await getWebsite(websiteId) : null;

  const headers = {
    ...getApiCorsHeaders(),
    'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
  };

  if (!website || !website.recorderEnabled) {
    return Response.json({ enabled: false }, { headers });
  }

  const config = getRecorderConfig(website.replayConfig);

  return Response.json(
    {
      enabled: true,
      replayEnabled: config.replayEnabled === true,
      heatmapEnabled: config.heatmapEnabled === true,
      sampleRate: config.sampleRate ?? 0.15,
      heatmapSampleRate: config.heatmapSampleRate ?? 0.15,
      maskLevel: config.maskLevel ?? 'moderate',
      maxDuration: config.maxDuration ?? 300000,
      blockSelector: config.blockSelector ?? '',
    },
    { headers },
  );
}
