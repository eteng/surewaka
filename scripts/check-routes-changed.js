#!/usr/bin/env node
// Claude Code PostToolUse hook — fires after every Edit/Write.
// If the modified file is an API route, instructs Claude to update openapi.yaml.

// Set to true to only fire when the edit contains a route definition change
// (.get/.post/.put/.patch/.delete call). Reduces noise on comment-only edits.
const THROTTLE = false;

let raw = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    const filePath = input?.tool_input?.file_path ?? '';
    if (!/apps\/api\/src\/routes\/.*\.ts$/.test(filePath)) return;

    if (THROTTLE) {
      const newString = input?.tool_input?.new_string ?? '';
      if (!/\.(get|post|put|patch|delete)\(/.test(newString)) return;
    }

    const rel = filePath.replace(/.*apps\/api\/src\/routes\//, '');
    process.stdout.write(
      `[openapi-hook] REQUIRED ACTION: routes/${rel} was just modified.\n` +
      `Before responding to the user, read that file and update docs/openapi.yaml to reflect any changes — ` +
      `new paths, removed endpoints, changed parameters, or updated request/response schemas. ` +
      `Only touch the affected sections.\n`
    );
  } catch {
    // Non-JSON stdin or missing fields — ignore silently
  }
});
