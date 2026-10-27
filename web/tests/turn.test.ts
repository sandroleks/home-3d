import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET, iceServersFrom } from '../api/turn';
import { fetchIceServers } from '../src/turn';

// Cloudflare's answer, as its docs show it (credentials shortened), plus the port 53 URL it can add
const cloudflare = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
    {
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turn:turn.cloudflare.com:53?transport=udp',
        'turns:turn.cloudflare.com:443?transport=tcp',
      ],
      username: 'user',
      credential: 'secret',
    },
  ],
};

describe('iceServersFrom', () => {
  it('keeps the servers and drops the port 53 URLs browsers block', () => {
    expect(iceServersFrom(cloudflare)).toEqual([
      { urls: ['stun:stun.cloudflare.com:3478'] },
      { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'user', credential: 'secret' },
    ]);
  });

  it('drops a server left with no URL, and takes a single URL string', () => {
    expect(iceServersFrom({ iceServers: [{ urls: 'turn:a:53' }, { urls: 'turn:b:3478', username: 'u', credential: 'c' }] }))
      .toEqual([{ urls: ['turn:b:3478'], username: 'u', credential: 'c' }]);
  });

  it('is empty for anything else', () => {
    for (const body of [null, {}, { iceServers: 'x' }, { iceServers: [null, 3, { urls: [4] }] }]) expect(iceServersFrom(body)).toEqual([]);
  });
});

describe('GET /api/turn', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  const get = async () => {
    const res = await GET(new Request('https://example.test/api/turn'));
    return { res, body: await res.json() };
  };

  it('is an empty list, without asking Cloudflare, when no key is configured', async () => {
    vi.stubEnv('CLOUDFLARE_TURN_KEY_ID', '');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const { res, body } = await get();
    expect(body).toEqual({ iceServers: [] });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('asks Cloudflare for credentials with the key and token, and passes them on', async () => {
    vi.stubEnv('CLOUDFLARE_TURN_KEY_ID', 'key1');
    vi.stubEnv('CLOUDFLARE_TURN_API_TOKEN', 'token1');
    const fetcher = vi.fn(async () => Response.json(cloudflare, { status: 201 }));
    vi.stubGlobal('fetch', fetcher);
    const { body } = await get();
    expect(body).toEqual({ iceServers: iceServersFrom(cloudflare) });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/key1/credentials/generate-ice-servers');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token1');
    expect(JSON.parse(init.body as string)).toEqual({ ttl: 86400 });
  });

  it('is an empty list when Cloudflare refuses or can not be reached', async () => {
    vi.stubEnv('CLOUDFLARE_TURN_KEY_ID', 'key1');
    vi.stubEnv('CLOUDFLARE_TURN_API_TOKEN', 'token1');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', async () => new Response('no', { status: 401 }));
    expect((await get()).body).toEqual({ iceServers: [] });
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    expect((await get()).body).toEqual({ iceServers: [] });
  });
});

describe('fetchIceServers', () => {
  const answering = (res: () => Response | Promise<Response>) => (async () => res()) as unknown as typeof fetch;

  it('returns the servers the function answers', async () => {
    const servers = iceServersFrom(cloudflare);
    expect(await fetchIceServers(answering(() => Response.json({ iceServers: servers })), 'api/turn', 1000)).toEqual(servers);
  });

  it('leaves out malformed servers', async () => {
    const body = { iceServers: [{ urls: [] }, { urls: 'turn:a', username: 3 }, { urls: 'turn:b' }] };
    expect(await fetchIceServers(answering(() => Response.json(body)), 'api/turn', 1000)).toEqual([{ urls: 'turn:b' }]);
  });

  it('is empty with no function: a 404, the dev server answering index.html, or no network', async () => {
    expect(await fetchIceServers(answering(() => new Response('', { status: 404 })), 'api/turn', 1000)).toEqual([]);
    expect(await fetchIceServers(answering(() => new Response('<!doctype html>')), 'api/turn', 1000)).toEqual([]);
    expect(await fetchIceServers(answering(() => { throw new TypeError('offline'); }), 'api/turn', 1000)).toEqual([]);
  });

  it('gives up after the timeout', async () => {
    const hanging = ((_url: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch;
    expect(await fetchIceServers(hanging, 'api/turn', 20)).toEqual([]);
  });
});
