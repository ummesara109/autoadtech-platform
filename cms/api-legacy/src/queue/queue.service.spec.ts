jest.mock('../supabase/supabase.service', () => ({
  SupabaseService: jest.fn().mockImplementation(() => ({
    isConfigured: false,
    client: null,
  })),
}));

jest.mock('../redis/redis.service', () => ({
  RedisService: jest.fn().mockImplementation(() => ({
    del: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { ConflictException } from '@nestjs/common';
import { QueueService } from './queue.service';
import { memoryQueueStore } from './queue.store';
import { SupabaseService } from '../supabase/supabase.service';
import { RedisService } from '../redis/redis.service';

const SCREEN_A = '33333333-3333-4333-8333-333333333331'; // KA01
const SCREEN_B = '33333333-3333-4333-8333-333333333332'; // KA02
const VEHICLE_A = '11111111-1111-4111-8111-111111111111';
const VEHICLE_B = '22222222-2222-4222-8222-222222222222';

function makeService() {
  const svc = new QueueService(
    new SupabaseService(null as never),
    new RedisService(null as never),
  );
  svc.resetMemory();
  return svc;
}

describe('QueueService (memory / no fake history)', () => {
  beforeEach(() => {
    memoryQueueStore.reset();
  });

  it('starts first enqueued ad as PLAYING when idle', async () => {
    const svc = makeService();
    const res = await svc.enqueue(SCREEN_A, [
      { title: 'Ad 1', advertiser: 'A', durationSec: 15 },
    ]);
    expect(res.interruptedPlaying).toBe(false);
    expect(res.playing?.title).toBe('Ad 1');
    expect(res.queued).toHaveLength(0);
    const snap = await svc.snapshot(SCREEN_A);
    expect(snap.playbackHistory).toHaveLength(0);
  });

  it('never interrupts PLAYING when new ads are assigned (append)', async () => {
    const svc = makeService();
    const first = await svc.enqueue(SCREEN_A, [{ title: 'Playing' }]);
    const playingId = first.playing!.id;
    const second = await svc.enqueue(SCREEN_A, [
      { title: 'Queued-1' },
      { title: 'Queued-2' },
    ]);
    expect(second.interruptedPlaying).toBe(false);
    expect(second.playing?.id).toBe(playingId);
    expect(second.playing?.title).toBe('Playing');
    expect(second.queued.map((q) => q.title)).toEqual(['Queued-1', 'Queued-2']);
  });

  it('plays sequentially: complete → next QUEUED becomes PLAYING', async () => {
    const svc = makeService();
    const enq = await svc.enqueue(SCREEN_A, [
      { title: 'One' },
      { title: 'Two' },
      { title: 'Three' },
    ]);
    expect(enq.playing?.title).toBe('One');
    expect(enq.queued).toHaveLength(2);

    await svc.completePlaying(SCREEN_A, enq.playing!.id);
    const after1 = await svc.snapshot(SCREEN_A);
    expect(after1.currentlyPlaying?.title).toBe('Two');
    expect(after1.upcomingQueue.map((q) => q.title)).toEqual(['Three']);

    const hist = (await svc.snapshot(SCREEN_A)).playbackHistory;
    expect(hist).toHaveLength(1);
    expect(hist[0].title).toBe('One');
    expect(hist[0].outcome).toBe('COMPLETED');

    await svc.completePlaying(SCREEN_A, after1.currentlyPlaying!.id);
    const after2 = await svc.snapshot(SCREEN_A);
    expect(after2.currentlyPlaying?.title).toBe('Three');
    await svc.completePlaying(SCREEN_A, after2.currentlyPlaying!.id);
    const after3 = await svc.snapshot(SCREEN_A);
    expect(after3.currentlyPlaying).toBeNull();
    expect((await svc.snapshot(SCREEN_A)).playbackHistory).toHaveLength(3);
  });

  it('enforces one PLAYING per screen (complete wrong id fails)', async () => {
    const svc = makeService();
    const enq = await svc.enqueue(SCREEN_A, [
      { title: 'One' },
      { title: 'Two' },
    ]);
    const queuedId = enq.queued[0].id;
    await expect(svc.completePlaying(SCREEN_A, queuedId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect((await svc.snapshot(SCREEN_A)).currentlyPlaying?.title).toBe('One');
  });

  it('isolates multi-auto queues (screen A vs B)', async () => {
    const svc = makeService();
    await svc.enqueue(SCREEN_A, [{ title: 'A1' }, { title: 'A2' }], {
      vehicleId: VEHICLE_A,
    });
    await svc.enqueue(SCREEN_B, [{ title: 'B1' }], { vehicleId: VEHICLE_B });

    const a = await svc.snapshot(SCREEN_A);
    const b = await svc.snapshot(SCREEN_B);
    expect(a.currentlyPlaying?.title).toBe('A1');
    expect(a.upcomingQueue.map((q) => q.title)).toEqual(['A2']);
    expect(b.currentlyPlaying?.title).toBe('B1');
    expect(b.upcomingQueue).toHaveLength(0);

    await svc.completePlaying(SCREEN_A, a.currentlyPlaying!.id);
    const a2 = await svc.snapshot(SCREEN_A);
    const b2 = await svc.snapshot(SCREEN_B);
    expect(a2.currentlyPlaying?.title).toBe('A2');
    expect(b2.currentlyPlaying?.title).toBe('B1');
  });

  it('does not invent fake history before any completion', async () => {
    const svc = makeService();
    expect((await svc.snapshot(SCREEN_A)).playbackHistory).toEqual([]);
    await svc.enqueue(SCREEN_A, [{ title: 'Live' }]);
    expect((await svc.snapshot(SCREEN_A)).playbackHistory).toEqual([]);
  });

  it('ensureDevDemoAdsIfEmpty seeds 2 demo ads when idle, skips when PLAYING', async () => {
    const svc = makeService();
    const first = await svc.ensureDevDemoAdsIfEmpty(SCREEN_A);
    expect(first).toBe(true);
    const snap = await svc.snapshot(SCREEN_A);
    expect(snap.currentlyPlaying?.title).toBe('Demo Ad 1 Restaurant');
    expect(snap.currentlyPlaying?.mediaUrl).toBe('/test-ad-restaurant.mp4');
    expect(snap.upcomingQueue).toHaveLength(1);
    expect(snap.upcomingQueue[0].mediaUrl).toBe('/ad2-bbq-catering.mp4');

    const again = await svc.ensureDevDemoAdsIfEmpty(SCREEN_A);
    expect(again).toBe(false);
    expect((await svc.snapshot(SCREEN_A)).currentlyPlaying?.title).toBe(
      'Demo Ad 1 Restaurant',
    );
  });

  it('cancel only affects QUEUED, not PLAYING', async () => {
    const svc = makeService();
    const enq = await svc.enqueue(SCREEN_A, [
      { title: 'Playing' },
      { title: 'Later' },
    ]);
    await svc.cancelQueued(SCREEN_A, enq.queued[0].id);
    const snap = await svc.snapshot(SCREEN_A);
    expect(snap.currentlyPlaying?.title).toBe('Playing');
    expect(snap.upcomingQueue).toHaveLength(0);
  });
});
