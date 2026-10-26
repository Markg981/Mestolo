import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backoffDelay, connectRealtime, type RealtimeChannelLike } from './connect';

function makeClient() {
  const channels: { ch: RealtimeChannelLike; status: (s: string) => void; on: ReturnType<typeof vi.fn> }[] = [];
  const removeChannel = vi.fn();
  const client = {
    channel: vi.fn(() => {
      const on = vi.fn();
      let status: (s: string) => void = () => {};
      const ch: RealtimeChannelLike = {
        on: (...a) => {
          on(...a);
          return ch;
        },
        subscribe: (cb) => {
          status = cb ?? (() => {});
        },
      };
      channels.push({ ch, status: (s) => status(s), on });
      return ch;
    }),
    removeChannel,
  };
  return { client, channels, removeChannel };
}

describe('connectRealtime', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('registers every table on a single channel', () => {
    const { client, channels } = makeClient();
    connectRealtime(client, 'c', [{ table: 'a', filter: 'x=eq.1' }, { table: 'b' }], vi.fn(), vi.fn());
    expect(client.channel).toHaveBeenCalledTimes(1);
    expect(channels[0].on).toHaveBeenCalledTimes(2);
  });

  it('resubscribes with backoff after an error and notifies on reconnect', () => {
    const { client, channels, removeChannel } = makeClient();
    const onReconnect = vi.fn();
    connectRealtime(client, 'c', [{ table: 'a' }], vi.fn(), onReconnect);
    channels[0].status('SUBSCRIBED');
    expect(onReconnect).not.toHaveBeenCalled();
    channels[0].status('CHANNEL_ERROR');
    expect(removeChannel).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(backoffDelay(0) - 1);
    expect(client.channel).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(client.channel).toHaveBeenCalledTimes(2);
    channels[1].status('TIMED_OUT');
    vi.advanceTimersByTime(backoffDelay(1));
    expect(client.channel).toHaveBeenCalledTimes(3);
    channels[2].status('SUBSCRIBED');
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('caps the backoff delay', () => {
    expect(backoffDelay(20)).toBe(30000);
  });

  it('cleans up timers and channel on dispose', () => {
    const { client, channels, removeChannel } = makeClient();
    const dispose = connectRealtime(client, 'c', [{ table: 'a' }], vi.fn(), vi.fn());
    channels[0].status('CLOSED');
    dispose();
    vi.advanceTimersByTime(60000);
    expect(client.channel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    const m = makeClient();
    const d2 = connectRealtime(m.client, 'c', [{ table: 'a' }], vi.fn(), vi.fn());
    d2();
    expect(m.removeChannel).toHaveBeenCalledTimes(1);
    m.channels[0].status('CHANNEL_ERROR');
    vi.advanceTimersByTime(60000);
    expect(m.client.channel).toHaveBeenCalledTimes(1);
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });
});
