const EXCHANGE_API_URL = 'https://api.exchangerate-api.com/v4/latest/USD';

export async function getUsdToNgnRate(): Promise<number> {
  try {
    const res = await fetch(EXCHANGE_API_URL);
    if (!res.ok) throw new Error(`Exchange rate API responded ${res.status}`);
    const json = (await res.json()) as { rates: Record<string, number> };
    const rate = json.rates['NGN'];
    if (!rate || typeof rate !== 'number') throw new Error('NGN rate missing from response');
    return rate;
  } catch (err) {
    console.error('[ExchangeRate] Primary source failed, trying fallback:', err);
    // Fallback: open.er-api.com (no key needed)
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!res.ok) throw new Error(`Fallback exchange rate API responded ${res.status}`);
    const json = (await res.json()) as { rates: Record<string, number> };
    const rate = json.rates['NGN'];
    if (!rate) throw new Error('NGN rate missing from fallback response');
    return rate;
  }
}
