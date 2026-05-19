// Feature: waitlist-admin, Property 8: CSV export completeness
// Validates: Requirements 7.2
//
// For any set of waitlist signup records, the generated CSV SHALL contain exactly
// one row per record (plus header), and each row SHALL include the fullName, email,
// userType, source, and createdAt values matching the source record.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { generateCsvContent } from '../lib/export-csv';

// ─── Types ───────────────────────────────────────────────────────────────────

type WaitlistUserType = 'sender' | 'business' | 'driver';

type WaitlistSignupRecord = {
  id: string;
  fullName: string;
  email: string;
  userType: WaitlistUserType;
  source: string;
  createdAt: string;
};

// ─── Sanitization (mirrors the export-csv.ts logic for comparison) ───────────

const CSV_INJECTION_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

function sanitizeCell(value: string): string {
  if (value.length > 0 && CSV_INJECTION_PREFIXES.includes(value[0])) {
    return `'${value}`;
  }
  return value;
}

// ─── CSV Parser ──────────────────────────────────────────────────────────────

/**
 * Parse a CSV string back into rows of fields.
 * Handles quoted fields and escaped double quotes ("").
 */
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let i = 0;

  while (i < csv.length) {
    const row: string[] = [];

    while (i < csv.length) {
      let field = '';

      if (csv[i] === '"') {
        // Quoted field
        i++; // skip opening quote
        while (i < csv.length) {
          if (csv[i] === '"') {
            if (i + 1 < csv.length && csv[i + 1] === '"') {
              // Escaped double quote
              field += '"';
              i += 2;
            } else {
              // End of quoted field
              i++; // skip closing quote
              break;
            }
          } else {
            field += csv[i];
            i++;
          }
        }
      } else {
        // Unquoted field
        while (i < csv.length && csv[i] !== ',' && csv[i] !== '\n') {
          field += csv[i];
          i++;
        }
      }

      row.push(field);

      if (i < csv.length && csv[i] === ',') {
        i++; // skip comma, continue to next field
      } else {
        break; // end of row (newline or end of string)
      }
    }

    rows.push(row);

    if (i < csv.length && csv[i] === '\n') {
      i++; // skip newline
    }
  }

  return rows;
}

/**
 * Get the expected CSV cell value for a source record field.
 * The CSV export sanitizes values that start with injection-prone characters.
 */
function expectedCsvValue(value: string): string {
  return sanitizeCell(value);
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const userTypeArb = fc.constantFrom<WaitlistUserType>('sender', 'business', 'driver');

/**
 * Generate strings that are safe for CSV testing — no newlines or null bytes
 * which would break row-level parsing, but allow commas, quotes, and special chars.
 */
const csvSafeString = fc
  .string({ minLength: 1, maxLength: 60 })
  .map((s) => s.replace(/[\n\r\0]/g, ' '))
  .filter((s) => s.trim().length > 0);

const signupRecordArb: fc.Arbitrary<WaitlistSignupRecord> = fc.record({
  id: fc.uuid(),
  fullName: csvSafeString,
  email: fc.emailAddress(),
  userType: userTypeArb,
  source: fc.constantFrom('home', 'launch-campaign', 'referral', 'social', 'partner'),
  createdAt: fc
    .integer({ min: new Date('2024-01-01').getTime(), max: new Date('2025-12-31').getTime() })
    .map((ts) => new Date(ts).toISOString()),
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('CSV Export — Property Tests', () => {
  describe('Property 8: CSV export completeness', () => {
    it('CSV contains exactly one header row plus one data row per record', () => {
      fc.assert(
        fc.property(
          fc.array(signupRecordArb, { minLength: 0, maxLength: 50 }),
          (signups) => {
            const csv = generateCsvContent(signups);
            const rows = parseCsv(csv);

            // **Validates: Requirements 7.2**
            // Header row + one row per record
            expect(rows.length).toBe(signups.length + 1);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('header row contains the expected column names', () => {
      fc.assert(
        fc.property(
          fc.array(signupRecordArb, { minLength: 1, maxLength: 10 }),
          (signups) => {
            const csv = generateCsvContent(signups);
            const rows = parseCsv(csv);
            const header = rows[0];

            // **Validates: Requirements 7.2**
            expect(header).toEqual(['Full Name', 'Email', 'User Type', 'Source', 'Signup Date']);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('each data row contains correct field values matching the source record', () => {
      fc.assert(
        fc.property(
          fc.array(signupRecordArb, { minLength: 1, maxLength: 50 }),
          (signups) => {
            const csv = generateCsvContent(signups);
            const rows = parseCsv(csv);

            // Skip header row
            const dataRows = rows.slice(1);

            // **Validates: Requirements 7.2**
            for (let i = 0; i < signups.length; i++) {
              const record = signups[i];
              const row = dataRows[i];

              // Each row should have exactly 5 fields
              expect(row.length).toBe(5);

              // Compare values (the CSV contains sanitized values)
              expect(row[0]).toBe(expectedCsvValue(record.fullName));
              expect(row[1]).toBe(expectedCsvValue(record.email));
              expect(row[2]).toBe(expectedCsvValue(record.userType));
              expect(row[3]).toBe(expectedCsvValue(record.source));
              expect(row[4]).toBe(expectedCsvValue(record.createdAt));
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('CSV handles special characters in field values correctly', () => {
      fc.assert(
        fc.property(
          fc.array(signupRecordArb, { minLength: 1, maxLength: 20 }),
          (signups) => {
            const csv = generateCsvContent(signups);
            const rows = parseCsv(csv);
            const dataRows = rows.slice(1);

            // **Validates: Requirements 7.2**
            // Verify round-trip: parse back and check all records are present
            expect(dataRows.length).toBe(signups.length);

            for (let i = 0; i < signups.length; i++) {
              const record = signups[i];
              const row = dataRows[i];

              // The parsed value must match the sanitized original
              expect(row[0]).toBe(expectedCsvValue(record.fullName));
              expect(row[1]).toBe(expectedCsvValue(record.email));
              expect(row[2]).toBe(expectedCsvValue(record.userType));
              expect(row[3]).toBe(expectedCsvValue(record.source));
              expect(row[4]).toBe(expectedCsvValue(record.createdAt));
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
