type WaitlistSignupRecord = {
  id: string;
  fullName: string;
  email: string;
  userType: 'sender' | 'business' | 'driver';
  source: string;
  createdAt: string;
};

const CSV_INJECTION_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Sanitize a cell value to prevent CSV formula injection.
 * If the value starts with a dangerous character, prefix it with a single quote.
 */
function sanitizeCell(value: string): string {
  if (value.length > 0 && CSV_INJECTION_PREFIXES.includes(value[0])) {
    return `'${value}`;
  }
  return value;
}

/**
 * Escape a value for CSV: wrap in double quotes and escape internal double quotes.
 */
function escapeCsvValue(value: string): string {
  const sanitized = sanitizeCell(value);
  const escaped = sanitized.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Generate a CSV filename with the current date in YYYY-MM-DD format.
 */
export function generateCsvFilename(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `waitlist-export-${year}-${month}-${day}.csv`;
}

/**
 * Generate CSV content string from waitlist signup records.
 * Returns the full CSV string with header row and one data row per record.
 */
export function generateCsvContent(data: WaitlistSignupRecord[]): string {
  const header = ['Full Name', 'Email', 'User Type', 'Source', 'Signup Date'];
  const headerRow = header.map(escapeCsvValue).join(',');

  const dataRows = data.map((record) => {
    const row = [
      record.fullName,
      record.email,
      record.userType,
      record.source,
      record.createdAt,
    ];
    return row.map(escapeCsvValue).join(',');
  });

  return [headerRow, ...dataRows].join('\n');
}

/**
 * Export waitlist data as a CSV file and trigger a browser download.
 */
export function exportWaitlistCsv(data: WaitlistSignupRecord[], filename?: string): void {
  const csvFilename = filename ?? generateCsvFilename();
  const csvContent = generateCsvContent(data);

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = csvFilename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  URL.revokeObjectURL(url);
  document.body.removeChild(link);
}
