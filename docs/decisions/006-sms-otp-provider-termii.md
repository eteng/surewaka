# ADR-006: Termii as SMS OTP Provider for Nigeria

## Status

Accepted

## Context

SureWaka uses phone OTP as the primary authentication method for customers and drivers. The platform targets Lagos initially, expanding across Nigeria. We need an SMS provider that delivers reliably to Nigerian carriers (MTN, Airtel, Glo, 9mobile) at a cost that scales with our user base.

Supabase Auth supports phone OTP natively with Twilio, MessageBird, and Vonage as built-in providers. However, these are global providers optimized for US/EU markets.

## Decision

Use **Termii** as the production SMS OTP provider for Nigeria, integrated via a Supabase Auth Hook (custom SMS sender).

Use **Twilio with test OTPs** for development (no real SMS sent, free).

## Provider Comparison (Nigeria)

| Provider | Cost/SMS (Nigeria) | Billing | Carrier Routes | Delivery Rate |
|----------|-------------------|---------|----------------|---------------|
| **Termii** | ~₦4-5 (~$0.003) | Naira (NGN) | Direct to MTN, Airtel, Glo, 9mobile | ~95%+ |
| Africa's Talking | ~$0.01-0.02 | Local currency | Direct (Kenya-focused, good Nigeria) | ~90% |
| Arkesel | ~$0.005-0.01 | USD/GHS | Direct (Ghana-focused) | ~85% Nigeria |
| Twilio | ~$0.05 + $0.05/verify | USD | Aggregator chains | ~80-85% Nigeria |
| Vonage | ~$0.04-0.05 | USD | Aggregator chains | ~80-85% Nigeria |
| MessageBird | ~$0.04-0.05 | USD/EUR | Aggregator chains | ~80-85% Nigeria |

## Rationale

### Cost

At 10,000 OTPs/month:
- Termii: ~₦50,000 (~$33)
- Twilio: ~$1,000 ($0.05 SMS + $0.05 verify fee)

**30x cheaper** at scale. For a logistics platform where every booking triggers auth, this compounds fast.

### Delivery reliability

Global providers (Twilio, Vonage, MessageBird) route Nigerian SMS through aggregator chains — multiple hops between the provider and the local carrier. Each hop adds latency and a chance of message loss.

Termii has **direct connections** to all four major Nigerian carriers. This means:
- OTPs arrive in 2-5 seconds (vs 10-30s through aggregators)
- Higher delivery success rate (~95% vs ~80-85%)
- Better handling of DND (Do Not Disturb) registered numbers

### Local market fit

- Bills in Naira — no FX conversion overhead or USD card requirements
- Handles Nigerian regulatory requirements (sender ID registration with NCC)
- Support team in Nigerian timezone
- Understands local carrier quirks (MTN DND, Airtel routing)

### Integration approach

Termii is not a built-in Supabase Auth provider. Two integration paths:

**Option A: Supabase Auth Hook (recommended)**
- Configure a custom SMS hook in Supabase Auth settings
- Hook calls our API endpoint → API calls Termii → SMS delivered
- Supabase still manages OTP generation, verification, and session creation
- We only replace the SMS delivery layer

**Option B: Custom OTP via API**
- Our API generates OTP, stores it, calls Termii, verifies it
- More control but more code to maintain
- Loses Supabase Auth's built-in rate limiting and security

## Implementation Plan

1. **Development (now):** Twilio with test OTPs in Supabase dashboard — zero cost
2. **Pre-launch:** Integrate Termii via Supabase Auth Hook
3. **Production:** Termii for all Nigerian numbers
4. **Future (international expansion):** Add Twilio as fallback for non-Nigerian numbers

## Consequences

**Positive:**
- 30x cost reduction vs Twilio at scale
- Faster OTP delivery (2-5s vs 10-30s)
- Higher delivery success rate in Nigeria
- Naira billing — simpler accounting
- Better user experience (faster login)

**Negative:**
- Not a built-in Supabase provider — requires custom Auth Hook
- Vendor lock-in to a smaller company (mitigated by simple API — easy to swap)
- Less global coverage if we expand beyond Nigeria (add Twilio as fallback)
- Termii dashboard/docs less polished than Twilio

## When to Revisit

- If expanding to markets outside Nigeria/West Africa (add Twilio/Africa's Talking as regional fallbacks)
- If Termii reliability drops below 90% delivery rate
- If Supabase adds Termii as a native provider (simplify integration)
- If WhatsApp OTP becomes viable (Termii supports it — cheaper than SMS)
