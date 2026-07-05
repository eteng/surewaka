import { describe, it, expect, vi } from 'vitest';
import { formatPumbleMessage, sendPumbleAlert } from '../pumble';

vi.stubGlobal('fetch', vi.fn());

describe('formatPumbleMessage', () => {
  it('includes rule name and delivery context', () => {
    const msg = formatPumbleMessage('driver_silent', {
      driverName: 'Emeka N.',
      deliveryId: 'SW-1234',
      minutesSilent: 22,
      customerName: 'Ngozi O.',
      zone: 'Lekki',
    });
    expect(msg).toContain('Driver Silent');
    expect(msg).toContain('Emeka N.');
    expect(msg).toContain('22');
  });
});

describe('sendPumbleAlert', () => {
  it('POSTs JSON with text field to webhook URL', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await sendPumbleAlert('https://pumble.example.com/hook', 'leg_overdue', {
      deliveryId: 'SW-5678',
      minutesOverdue: 35,
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://pumble.example.com/hook',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.text).toContain('CRITICAL');
  });

  it('does not throw on network failure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('timeout'));
    await expect(
      sendPumbleAlert('https://pumble.example.com/hook', 'driver_silent', {}),
    ).resolves.not.toThrow();
  });
});
