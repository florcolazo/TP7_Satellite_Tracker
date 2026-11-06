import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { TtlCache } from '../src/cache.ts';
import { createProxy } from '../src/index.ts';
import { SlidingWindowLimiter } from '../src/limiter.ts';

describe('proxy', () => {
  const upstreamCalls: string[] = [];
  const fakeFetch = (async (url: string | URL) => {
    upstreamCalls.push(String(url));
    if (String(url).includes('/tle/25544')) {
      return new Response(JSON.stringify({ info: { satid: 25544, satname: 'SPACE STATION' }, tle: 'l1\r\nl2' }));
    }
    return new Response(JSON.stringify({ error: 'Invalid API Key!' }));
  }) as typeof fetch;

  const { server } = createProxy({ port: 0, n2yoKey: 'SECRETA', appToken: 'tok', fetch: fakeFetch });
  let base = '';

  before(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());

  const get = (path: string, token = 'tok') => fetch(base + path, { headers: { 'x-app-token': token } });

  it('health informa qué proveedores están configurados, sin exponer secretos', async () => {
    const r = await (await get('/health', '')).json();
    assert.equal(r.n2yo, true);
    assert.equal(r.spacetrack, false);
    assert.ok(!JSON.stringify(r).includes('SECRETA'));
  });

  it('rechaza requests sin token de la app', async () => {
    assert.equal((await get('/n2yo/tle/25544', 'otro')).status, 401);
  });

  it('agrega la API key del lado servidor y cachea la respuesta', async () => {
    const a = await (await get('/n2yo/tle/25544')).json();
    const b = await (await get('/n2yo/tle/25544')).json();
    assert.deepEqual(a, b);
    assert.equal(upstreamCalls.filter((u) => u.includes('/tle/25544')).length, 1);
    assert.ok(upstreamCalls[0].endsWith('&apiKey=SECRETA'));
  });

  it('traduce errores de N2YO (HTTP 200 con {error}) a 502', async () => {
    assert.equal((await get('/n2yo/tle/99999')).status, 502);
  });

  it('Space-Track sin credenciales → 503 (la app hace fallback)', async () => {
    assert.equal((await get('/spacetrack/gp/25544')).status, 503);
  });

  it('valida parámetros', async () => {
    assert.equal((await get('/n2yo/positions/25544/abc/0/0/1')).status, 400);
    assert.equal((await get('/nada')).status, 404);
  });
});

describe('SlidingWindowLimiter', () => {
  it('aplica 30/min y 300/h a la vez', () => {
    let t = 0;
    const l = new SlidingWindowLimiter([{ limit: 30, windowMs: 60_000 }, { limit: 300, windowMs: 3_600_000 }], () => t);
    for (let i = 0; i < 30; i++) assert.equal(l.tryTake(), 0);
    assert.equal(l.tryTake(), 60_000);
    t = 60_000;
    assert.equal(l.tryTake(), 0);
  });
});

describe('TtlCache', () => {
  it('expira por TTL y desaloja por capacidad', () => {
    let t = 0;
    const c = new TtlCache<number>(2, () => t);
    c.set('a', 1, 100);
    c.set('b', 2, 100);
    c.set('c', 3, 100);
    assert.equal(c.get('a'), undefined);
    t = 150;
    assert.equal(c.get('b'), undefined);
  });
});
