import { startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';

// StrictMode omitted: React 19 StrictMode double-invokes ClerkProvider's script-loading
// effect in dev, causing failed_to_load_clerk_js after the 15s timeout.
startTransition(() => {
  hydrateRoot(
    document,
    <HydratedRouter />
  );
});
