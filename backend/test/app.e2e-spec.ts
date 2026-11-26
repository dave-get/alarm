/**
 * End-to-end API test against a running stack (docker compose up, or npm run start:dev).
 *   E2E_BASE_URL=http://localhost:3000 npm run test:e2e
 * Skipped when E2E_BASE_URL is not set.
 */
const BASE = process.env.E2E_BASE_URL?.replace(/\/$/, '');
const d = BASE ? describe : describe.skip;

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

d('Crypto Price Alert API (e2e)', () => {
  const email = `e2e-${Date.now()}@example.com`;
  let access = '';
  let refresh = '';
  let alertId = '';

  it('health and readiness', async () => {
    expect((await call('GET', '/health')).status).toBe(200);
    expect((await call('GET', '/ready')).status).toBe(200);
  });

  it('public market endpoints', async () => {
    const symbols = await call('GET', '/api/v1/market/symbols');
    expect(symbols.body.data.map((s: { symbol: string }) => s.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'SOLUSDT']);
    const prices = await call('GET', '/api/v1/market/prices');
    expect(prices.body.data).toHaveLength(5);
    expect((await call('GET', '/api/v1/market/prices/DOGEUSDT')).status).toBe(400);
  });

  it('register, login, refresh', async () => {
    const reg = await call('POST', '/api/v1/auth/register', { email, password: 'correct horse battery' });
    expect(reg.status).toBe(201);
    expect((await call('POST', '/api/v1/auth/register', { email, password: 'correct horse battery' })).status).toBe(409);
    expect((await call('POST', '/api/v1/auth/login', { email, password: 'wrong password' })).status).toBe(401);
    const login = await call('POST', '/api/v1/auth/login', { email, password: 'correct horse battery' });
    expect(login.status).toBe(200);
    access = login.body.data.tokens.accessToken;
    refresh = login.body.data.tokens.refreshToken;
    const r = await call('POST', '/api/v1/auth/refresh', { refreshToken: refresh });
    expect(r.status).toBe(200);
    // A spent refresh token is a reuse: rejected.
    expect((await call('POST', '/api/v1/auth/refresh', { refreshToken: refresh })).status).toBe(401);
    access = r.body.data.accessToken;
  });

  it('requires authentication for alarms', async () => {
    expect((await call('GET', '/api/v1/alerts')).status).toBe(401);
  });

  it('validates alarm input', async () => {
    const bad = [
      { symbol: 'DOGEUSDT', targetPrice: '1.5', condition: 'ABOVE' },
      { symbol: 'XRPUSDT', targetPrice: 1.5, condition: 'ABOVE' },
      { symbol: 'XRPUSDT', targetPrice: '-1', condition: 'ABOVE' },
      { symbol: 'XRPUSDT', targetPrice: '1.5', condition: 'SIDEWAYS' },
    ];
    for (const b of bad) expect((await call('POST', '/api/v1/alerts', b, access)).status).toBe(400);
  });

  it('alarm lifecycle', async () => {
    const created = await call('POST', '/api/v1/alerts', { symbol: 'XRPUSDT', targetPrice: '999999.5000', condition: 'ABOVE', mode: 'ONCE' }, access);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ success: true, data: { symbol: 'XRPUSDT', targetPrice: '999999.5', condition: 'ABOVE', status: 'ACTIVE', mode: 'ONCE' } });
    alertId = created.body.data.id;

    expect((await call('GET', '/api/v1/alerts', undefined, access)).body.data.some((a: { id: string }) => a.id === alertId)).toBe(true);
    expect((await call('PATCH', `/api/v1/alerts/${alertId}/pause`, undefined, access)).body.data.status).toBe('PAUSED');
    expect((await call('PATCH', `/api/v1/alerts/${alertId}/pause`, undefined, access)).status).toBe(409);
    expect((await call('PATCH', `/api/v1/alerts/${alertId}/resume`, undefined, access)).body.data.status).toBe('ACTIVE');
    expect((await call('PATCH', `/api/v1/alerts/${alertId}`, { targetPrice: '999998' }, access)).body.data.targetPrice).toBe('999998');
    expect((await call('DELETE', `/api/v1/alerts/${alertId}`, undefined, access)).body.data.status).toBe('CANCELLED');
    expect((await call('GET', '/api/v1/alerts/history', undefined, access)).status).toBe(200);
  });

  it("another user can't see the alarm", async () => {
    const other = await call('POST', '/api/v1/auth/register', { email: `other-${email}`, password: 'another long password' });
    const token = other.body.data.tokens.accessToken;
    expect((await call('GET', `/api/v1/alerts/${alertId}`, undefined, token)).status).toBe(404);
  });

  it('devices and notifications', async () => {
    expect((await call('POST', '/api/v1/devices', { pushToken: 'not-a-token', platform: 'ANDROID' }, access)).status).toBe(400);
    expect((await call('POST', '/api/v1/notifications/test', undefined, access)).status).toBe(400); // no device yet
    const dev = await call('POST', '/api/v1/devices', { pushToken: 'ExponentPushToken[e2e-test-token-000000]', platform: 'ANDROID' }, access);
    expect(dev.status).toBe(201);
    expect((await call('GET', '/api/v1/notifications', undefined, access)).body.data.items).toBeInstanceOf(Array);
    expect((await call('DELETE', `/api/v1/devices/${dev.body.data.id}`, undefined, access)).status).toBe(204);
  });
});
