import { describe, it, expect } from 'vitest';
import {
  savedRecipientSchema,
  createSavedRecipientSchema,
  updateSavedRecipientSchema,
} from '../validators';

// Validators under test come from task 2.1:
//   savedRecipientSchema  = recipientDetailsSchema.extend({ id, label?, created_at })
//   createSavedRecipientSchema = savedRecipientSchema.omit({ id, created_at })
//   updateSavedRecipientSchema = createSavedRecipientSchema.partial()
//
// Recipient rules inherited from recipientDetailsSchema:
//   recipientName  — string 2–100 chars
//   recipientPhone — matches ^(\+234|0)[789][01]\d{8}$
//   deliveryNotes  — optional string ≤200 chars
//   label          — optional string ≤50 chars (added on savedRecipientSchema)
//
// _Requirements: 7.2, 7.3, 7.4, 7.5_

const validCreate = {
  recipientName: 'Adaeze Okafor',
  recipientPhone: '+2348012345678',
  deliveryNotes: 'Leave with the security at the gate',
  label: 'Home',
};

const validSaved = {
  ...validCreate,
  id: '3f5b1c2e-9a4d-4b7e-8c1f-2a6d0e7b9c34',
  created_at: '2024-01-15T10:30:00.000Z',
};

describe('savedRecipientSchema', () => {
  it('accepts a valid full saved-recipient shape', () => {
    expect(savedRecipientSchema.safeParse(validSaved).success).toBe(true);
  });

  it('accepts a valid shape without optional deliveryNotes and label', () => {
    const { deliveryNotes, label, ...rest } = validSaved;
    expect(savedRecipientSchema.safeParse(rest).success).toBe(true);
  });

  it('rejects an invalid (non-uuid) id', () => {
    const result = savedRecipientSchema.safeParse({ ...validSaved, id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('requires created_at', () => {
    const { created_at, ...rest } = validSaved;
    expect(savedRecipientSchema.safeParse(rest).success).toBe(false);
  });
});

describe('createSavedRecipientSchema', () => {
  it('accepts a valid create shape', () => {
    expect(createSavedRecipientSchema.safeParse(validCreate).success).toBe(true);
  });

  it('accepts a create shape with only the required recipient fields', () => {
    const result = createSavedRecipientSchema.safeParse({
      recipientName: 'Bola Ade',
      recipientPhone: '08012345678',
    });
    expect(result.success).toBe(true);
  });

  describe('omits id and created_at', () => {
    it('does not require id', () => {
      const { id, ...withoutId } = validSaved;
      // withoutId still carries created_at, but create schema strips it — the
      // remaining recipient fields are valid, so parsing succeeds.
      expect(createSavedRecipientSchema.safeParse(validCreate).success).toBe(true);
      // A missing id must not cause a failure.
      expect(createSavedRecipientSchema.safeParse(withoutId).success).toBe(true);
    });

    it('strips id and created_at from the parsed output (not part of the create shape)', () => {
      const result = createSavedRecipientSchema.safeParse(validSaved);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty('id');
        expect(result.data).not.toHaveProperty('created_at');
      }
    });
  });

  describe('recipientName length', () => {
    it('rejects recipientName shorter than 2 characters', () => {
      const result = createSavedRecipientSchema.safeParse({ ...validCreate, recipientName: 'A' });
      expect(result.success).toBe(false);
    });

    it('accepts recipientName at the 2-character lower bound', () => {
      const result = createSavedRecipientSchema.safeParse({ ...validCreate, recipientName: 'Ab' });
      expect(result.success).toBe(true);
    });

    it('rejects recipientName longer than 100 characters', () => {
      const result = createSavedRecipientSchema.safeParse({
        ...validCreate,
        recipientName: 'a'.repeat(101),
      });
      expect(result.success).toBe(false);
    });

    it('accepts recipientName at the 100-character upper bound', () => {
      const result = createSavedRecipientSchema.safeParse({
        ...validCreate,
        recipientName: 'a'.repeat(100),
      });
      expect(result.success).toBe(true);
    });
  });

  describe('recipientPhone Nigerian pattern', () => {
    it('accepts a +234-prefixed number', () => {
      const result = createSavedRecipientSchema.safeParse({
        ...validCreate,
        recipientPhone: '+2347012345678',
      });
      expect(result.success).toBe(true);
    });

    it('accepts a 0-prefixed number', () => {
      const result = createSavedRecipientSchema.safeParse({
        ...validCreate,
        recipientPhone: '09112345678',
      });
      expect(result.success).toBe(true);
    });

    it('rejects a number with an invalid leading digit group', () => {
      // 6 is not in [789]
      const result = createSavedRecipientSchema.safeParse({
        ...validCreate,
        recipientPhone: '06012345678',
      });
      expect(result.success).toBe(false);
    });

    it('rejects a number with an invalid second digit', () => {
      // 5 is not in [01]
      const result = createSavedRecipientSchema.safeParse({
        ...validCreate,
        recipientPhone: '08512345678',
      });
      expect(result.success).toBe(false);
    });

    it('rejects a number that is too short', () => {
      const result = createSavedRecipientSchema.safeParse({
        ...validCreate,
        recipientPhone: '0801234567',
      });
      expect(result.success).toBe(false);
    });

    it('rejects a number that is too long', () => {
      const result = createSavedRecipientSchema.safeParse({
        ...validCreate,
        recipientPhone: '080123456789',
      });
      expect(result.success).toBe(false);
    });

    it('rejects a non-Nigerian international number', () => {
      const result = createSavedRecipientSchema.safeParse({
        ...validCreate,
        recipientPhone: '+14155550123',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('deliveryNotes length', () => {
    it('rejects deliveryNotes longer than 200 characters', () => {
      const result = createSavedRecipientSchema.safeParse({
        ...validCreate,
        deliveryNotes: 'x'.repeat(201),
      });
      expect(result.success).toBe(false);
    });

    it('accepts deliveryNotes at the 200-character upper bound', () => {
      const result = createSavedRecipientSchema.safeParse({
        ...validCreate,
        deliveryNotes: 'x'.repeat(200),
      });
      expect(result.success).toBe(true);
    });
  });

  describe('label length', () => {
    it('rejects label longer than 50 characters', () => {
      const result = createSavedRecipientSchema.safeParse({
        ...validCreate,
        label: 'l'.repeat(51),
      });
      expect(result.success).toBe(false);
    });

    it('accepts label at the 50-character upper bound', () => {
      const result = createSavedRecipientSchema.safeParse({
        ...validCreate,
        label: 'l'.repeat(50),
      });
      expect(result.success).toBe(true);
    });
  });
});

describe('updateSavedRecipientSchema', () => {
  it('accepts an empty object (fully partial)', () => {
    expect(updateSavedRecipientSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a single-field recipientName update', () => {
    expect(
      updateSavedRecipientSchema.safeParse({ recipientName: 'Chidi Nwankwo' }).success,
    ).toBe(true);
  });

  it('accepts a single-field recipientPhone update', () => {
    expect(updateSavedRecipientSchema.safeParse({ recipientPhone: '+2348112345678' }).success).toBe(
      true,
    );
  });

  it('accepts a single-field deliveryNotes update', () => {
    expect(
      updateSavedRecipientSchema.safeParse({ deliveryNotes: 'Call on arrival' }).success,
    ).toBe(true);
  });

  it('accepts a single-field label update', () => {
    expect(updateSavedRecipientSchema.safeParse({ label: 'Office' }).success).toBe(true);
  });

  it('still enforces field rules on provided fields (bad phone rejected)', () => {
    expect(updateSavedRecipientSchema.safeParse({ recipientPhone: '08512345678' }).success).toBe(
      false,
    );
  });

  it('still enforces field rules on provided fields (short name rejected)', () => {
    expect(updateSavedRecipientSchema.safeParse({ recipientName: 'A' }).success).toBe(false);
  });
});
