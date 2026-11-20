/** In-memory seed used when Supabase is unavailable (CMS_DEV_AUTH=true).
 * Manager rule: exactly one active screen per Auto Number.
 */
export const DEV_SEED = {
  vehicles: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      autoNumber: 'KA01AB1234',
      displayName: 'Fleet Auto 01',
      makeModel: 'Tata Ace',
      registeredMobile: '9876543210',
      mobileE164: '+919876543210',
      status: 'active',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      autoNumber: 'KA02CD5678',
      displayName: 'Fleet Auto 02',
      makeModel: 'Mahindra Bolero',
      registeredMobile: '9123456780',
      mobileE164: '+919123456780',
      status: 'active',
    },
  ],
  operators: [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      vehicleId: '11111111-1111-4111-8111-111111111111',
      roleCode: 'cms_operator',
      displayName: 'Operator One',
      authUserId: null as string | null,
    },
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      vehicleId: '22222222-2222-4222-8222-222222222222',
      roleCode: 'cms_operator',
      displayName: 'Operator Two',
      authUserId: null as string | null,
    },
  ],
  screens: [
    {
      id: '33333333-3333-4333-8333-333333333331',
      vehicleId: '11111111-1111-4111-8111-111111111111',
      code: 'REAR',
      label: 'Rear screen',
      placement: 'rear',
      isActive: true,
    },
    {
      id: '33333333-3333-4333-8333-333333333332',
      vehicleId: '22222222-2222-4222-8222-222222222222',
      code: 'LEFT',
      label: 'Left panel',
      placement: 'left',
      isActive: true,
    },
    // Inactive — multi-screen no longer valid; kept only to document migration
    {
      id: '33333333-3333-4333-8333-333333333333',
      vehicleId: '22222222-2222-4222-8222-222222222222',
      code: 'RIGHT',
      label: 'Right panel (inactive)',
      placement: 'right',
      isActive: false,
    },
  ],
  assignments: [
    {
      operatorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      screenId: '33333333-3333-4333-8333-333333333331',
    },
    {
      operatorId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      screenId: '33333333-3333-4333-8333-333333333332',
    },
  ],
  /**
   * Sample locations for local CMS_DEV_AUTH only — not live telematics.
   * source is always reported as cms_dev_seed so the UI can label them as demo.
   */
  locations: [
    {
      vehicleId: '11111111-1111-4111-8111-111111111111', // KA01AB1234
      label: 'MG Road, Bengaluru',
      lat: 12.9756,
      lng: 77.6063,
      speedKmh: 18,
      headingDeg: 92,
      recordedAt: '2026-11-15T12:00:00.000Z',
    },
    {
      vehicleId: '22222222-2222-4222-8222-222222222222', // KA02CD5678
      label: 'Indiranagar, Bengaluru',
      lat: 12.9784,
      lng: 77.6408,
      speedKmh: 12,
      headingDeg: 210,
      recordedAt: '2026-11-15T12:00:00.000Z',
    },
  ],
};

/**
 * Local CMS_DEV_AUTH demo creatives served from web/public.
 * Auto-seeded when a screen queue is empty so login never shows a blank wait.
 */
export const DEV_DEMO_ADS = [
  {
    title: 'Demo Ad 1 Restaurant',
    advertiser: 'NiyoAds Demo',
    durationSec: 30,
    mediaUrl: '/test-ad-restaurant.mp4',
    externalAdId: 'dev-demo-restaurant',
  },
  {
    title: 'Demo Ad 2 BBQ Catering',
    advertiser: 'NiyoAds Demo',
    durationSec: 30,
    mediaUrl: '/ad2-bbq-catering.mp4',
    externalAdId: 'dev-demo-bbq',
  },
] as const;

export const DEV_OTP = '123456';
