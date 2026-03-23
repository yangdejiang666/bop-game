const assetAvailabilityCache = new Map<string, Promise<boolean>>();

async function probeOnce(url: string): Promise<boolean> {
  try {
    const headResponse = await fetch(url, {
      method: "HEAD",
      cache: "no-store",
    });
    if (headResponse.ok) {
      return true;
    }
    if (headResponse.status !== 405 && headResponse.status !== 501) {
      return false;
    }
  } catch {
    // Fall back to a lightweight GET probe below.
  }

  try {
    const getResponse = await fetch(url, {
      method: "GET",
      cache: "no-store",
    });
    return getResponse.ok;
  } catch {
    return false;
  }
}

export function checkAssetAvailability(url: string): Promise<boolean> {
  const normalizedUrl = url.trim();
  if (!normalizedUrl) {
    return Promise.resolve(false);
  }

  const cached = assetAvailabilityCache.get(normalizedUrl);
  if (cached) {
    return cached;
  }

  const probePromise = probeOnce(normalizedUrl);
  assetAvailabilityCache.set(normalizedUrl, probePromise);
  return probePromise;
}
