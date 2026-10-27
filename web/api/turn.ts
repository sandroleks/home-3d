/**
 * Vercel function: short-lived TURN credentials for the walkthrough's multiplayer, from Cloudflare's TURN service.
 * Most visitors connect to each other directly; TURN relays the ones whose networks block that (strict NAT, mobile
 * carriers, some offices). The API token stays here, on the server; browsers only ever see credentials that expire.
 *
 * Needs CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN (Cloudflare dashboard → Realtime → TURN Server). Without
 * them, or if Cloudflare fails, it answers an empty list and the walkthrough connects without TURN, as before.
 */

/** Seconds the credentials last: longer than anyone stays in the flat. */
const TTL = 86400;

export interface IceServer { urls: string[]; username?: string; credential?: string }

/** The ICE servers from Cloudflare's answer, without the port 53 URLs, which browsers block (they only time out). */
export function iceServersFrom(body: unknown): IceServer[] {
  const list = (body as { iceServers?: unknown } | null)?.iceServers;
  if (!Array.isArray(list)) return [];
  return list.flatMap((s): IceServer[] => {
    if (!s || typeof s !== 'object') return [];
    const { urls, username, credential } = s as Record<string, unknown>;
    const all = (Array.isArray(urls) ? urls : [urls]).filter((u): u is string => typeof u === 'string');
    const usable = all.filter((u) => !/:53(\?|$)/.test(u));
    if (!usable.length) return [];
    return [{
      urls: usable,
      ...(typeof username === 'string' ? { username } : {}),
      ...(typeof credential === 'string' ? { credential } : {}),
    }];
  });
}

const answer = (iceServers: IceServer[]) =>
  Response.json({ iceServers }, { headers: { 'Cache-Control': 'no-store' } }); // credentials are per visitor

export async function GET(request: Request): Promise<Response> {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const token = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (!keyId || !token) return answer([]);
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: TTL }),
      signal: request.signal,
    });
    if (!res.ok) {
      console.error(`Cloudflare TURN answered ${res.status}`);
      return answer([]);
    }
    return answer(iceServersFrom(await res.json()));
  } catch (err) {
    console.error('Could not reach Cloudflare TURN', err);
    return answer([]);
  }
}
