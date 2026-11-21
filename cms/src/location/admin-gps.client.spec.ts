import { AdminGpsClient, type AdminGpsPayload } from './admin-gps.client';

const ENV_KEYS = [
  'VERCEL_ENV',
  'ADMIN_GPS_URL',
  'ADMIN_API_URL',
  'ADMIN_GPS_PREVIEW_URL',
  'ADMIN_PREVIEW_PROTECTION_BYPASS_SECRET',
  'CMS_GPS_INGEST_KEY',
  'ADMIN_GPS_RETRY_MS',
];

const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

const gpsPayload: AdminGpsPayload = {
  autoNumber: 'KA01AB0001',
  cmsVehicleId: 'cms-vehicle-1',
  cmsScreenId: 'cms-screen-1',
  lat: 12.9716,
  lng: 77.5946,
  accuracy: 10,
  recordedAt: '2026-11-21T06:00:00.000Z',
};

function configurePreview() {
  process.env.VERCEL_ENV = 'preview';
  process.env.ADMIN_GPS_URL = 'https://admin-production.vercel.app';
  process.env.ADMIN_GPS_PREVIEW_URL =
    'https://admin-git-developement-team.vercel.app';
  process.env.ADMIN_PREVIEW_PROTECTION_BYPASS_SECRET = 'preview-bypass-secret';
  process.env.CMS_GPS_INGEST_KEY = 'shared-cms-ingest-secret';
}

describe('AdminGpsClient', () => {
  let fetchSpy:
    | jest.SpyInstance<ReturnType<typeof fetch>, Parameters<typeof fetch>>
    | undefined;

  beforeEach(() => {
    jest.restoreAllMocks();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.useRealTimers();
  });

  it('sends the Vercel bypass and CMS ingest keys only to the configured Preview origin', async () => {
    configurePreview();
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    fetchSpy = fetchMock;
    const client = new AdminGpsClient();

    await expect(client.forwardUpsert(gpsPayload)).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://admin-git-developement-team.vercel.app/api/cms/gps',
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'x-cms-ingest-key': 'shared-cms-ingest-secret',
      'x-vercel-protection-bypass': 'preview-bypass-secret',
    });
    const body: unknown =
      typeof init.body === 'string' ? JSON.parse(init.body) : {};
    expect(body).toMatchObject({
      autoNumber: gpsPayload.autoNumber,
      lat: gpsPayload.lat,
      lng: gpsPayload.lng,
      recordedAt: gpsPayload.recordedAt,
      source: 'device_gps',
    });

    client.onModuleDestroy();
  });

  it('never sends the Vercel bypass header in Production', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.ADMIN_GPS_URL = 'https://admin-production.vercel.app';
    process.env.ADMIN_GPS_PREVIEW_URL =
      'https://admin-git-developement-team.vercel.app';
    process.env.ADMIN_PREVIEW_PROTECTION_BYPASS_SECRET =
      'preview-bypass-secret';
    process.env.CMS_GPS_INGEST_KEY = 'shared-cms-ingest-secret';
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    fetchSpy = fetchMock;
    const client = new AdminGpsClient();

    await expect(client.forwardUpsert(gpsPayload)).resolves.toBe(true);

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://admin-production.vercel.app/api/cms/gps',
    );
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<
      string,
      string
    >;
    expect(headers['x-cms-ingest-key']).toBe('shared-cms-ingest-secret');
    expect(headers['x-vercel-protection-bypass']).toBeUndefined();

    client.onModuleDestroy();
  });

  it('does not send the bypass header to a production-style Preview target', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.ADMIN_GPS_URL = 'https://admin-production.vercel.app';
    process.env.ADMIN_GPS_PREVIEW_URL = 'https://admin-production.vercel.app';
    process.env.ADMIN_PREVIEW_PROTECTION_BYPASS_SECRET =
      'preview-bypass-secret';
    process.env.CMS_GPS_INGEST_KEY = 'shared-cms-ingest-secret';
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    fetchSpy = fetchMock;
    const client = new AdminGpsClient();

    await expect(client.forwardUpsert(gpsPayload)).resolves.toBe(true);

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://admin-production.vercel.app/api/cms/gps',
    );
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<
      string,
      string
    >;
    expect(headers['x-vercel-protection-bypass']).toBeUndefined();

    client.onModuleDestroy();
  });

  it('retries a protected Preview failure and clears pending data after success', async () => {
    jest.useFakeTimers();
    configurePreview();
    process.env.ADMIN_GPS_RETRY_MS = '5000';
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          '{"vercel_auth_enabled":true,"message":"Protected by Vercel Authentication"}',
          {
            status: 401,
            headers: { 'x-vercel-id': 'iad1::preview-test' },
          },
        ),
      )
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    fetchSpy = fetchMock;
    const client = new AdminGpsClient();
    const warnSpy = jest.spyOn(client['logger'], 'warn');

    await expect(client.forwardUpsert(gpsPayload)).resolves.toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Vercel Deployment Protection denied the request',
      ),
    );
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('preview-bypass-secret'),
    );
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('shared-cms-ingest-secret'),
    );

    await jest.advanceTimersByTimeAsync(5_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    client.onModuleDestroy();
  });
});
