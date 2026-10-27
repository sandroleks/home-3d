/** A TURN or STUN server, as `RTCPeerConnection` and Trystero's `turnConfig` take it. */
export interface IceServer { urls: string | string[]; username?: string; credential?: string }

const isIceServer = (v: unknown): v is IceServer => {
  if (!v || typeof v !== 'object') return false;
  const { urls, username, credential } = v as Record<string, unknown>;
  const urlsOk = typeof urls === 'string' || (Array.isArray(urls) && urls.length > 0 && urls.every((u) => typeof u === 'string'));
  return urlsOk && (username === undefined || typeof username === 'string') && (credential === undefined || typeof credential === 'string');
};

/**
 * The TURN servers to fall back on when two visitors can't connect directly (`api/turn.ts` on Vercel). Never throws:
 * with no function (local dev, another host), a slow one, or a bad answer, it is an empty list, and the walkthrough
 * connects as it would without TURN.
 */
export async function fetchIceServers(fetcher: typeof fetch, url: string, timeoutMs: number): Promise<IceServer[]> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { signal: abort.signal });
    if (!res.ok) return [];
    const list = ((await res.json()) as { iceServers?: unknown } | null)?.iceServers;
    return Array.isArray(list) ? list.filter(isIceServer) : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
