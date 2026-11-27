/**
 * Runs once when the Next.js server starts.
 *
 * The import is dynamic and behind the runtime check so that the Edge bundle
 * never pulls in the database driver.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerShutdownHooks } = await import('@/lib/shutdown');
    registerShutdownHooks();

    // Load the country database now rather than on the first request.
    const { startGeoIp } = await import('@/lib/geoip');
    void startGeoIp();
  }
}
