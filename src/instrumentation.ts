import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import { getAppSecret } from './lib/app-secret';

export async function register() {
  // Deployment secrets are required at runtime, not while building the image.
  if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) {
    getAppSecret();
  }

  // Create the websites listed in WEBSITES_CONFIG once, when the server starts.
  if (
    process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD &&
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.WEBSITES_CONFIG
  ) {
    const { loadWebsitesConfig } = await import('./lib/website-config');
    const { provisionWebsites } = await import('./lib/website-provision');
    const config = await loadWebsitesConfig();

    if (config) {
      const { created, updated, unchanged } = await provisionWebsites(config);

      console.log(
        `Websites from ${process.env.WEBSITES_CONFIG}: ${created} created, ${updated} updated, ${unchanged} unchanged.`,
      );
    }
  }
}
