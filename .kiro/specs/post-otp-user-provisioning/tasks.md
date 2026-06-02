# Tasks — Post-OTP User Provisioning

Bottom-up: schema → shared types → API → store → mobile UI.

---

## Schema & shared types

- [x] 1. Create migration `supabase migration new make_users_email_nullable` and write:
  ```sql
  ALTER TABLE public.users ALTER COLUMN email DROP NOT NULL;
  ```

- [ ] 2. After applying migration to DB: run `pnpm --filter @surewaka/db db:pull` to regenerate
  `packages/db/src/schema.ts` (do not edit manually)

- [x] 3. Add `otpRegisterSchema` and `OtpRegister` type to `packages/shared/src/validators.ts`:
  ```typescript
  export const otpRegisterSchema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  });
  export type OtpRegister = z.infer<typeof otpRegisterSchema>;
  ```

---

## API

- [x] 4. Create `apps/api/src/routes/auth.ts` — `POST /register` endpoint:
  - Apply `requireAuth` middleware
  - Validate body with `otpRegisterSchema`
  - Return 400 `{ code: 'MISSING_PHONE' }` if `c.get('user').phone` is undefined
  - Upsert `public.users`: `id = user.id`, `name`, `phone = user.phone`, `email = null`,
    `role = 'customer'`, `verified = false` — using `onConflictDoNothing()`
  - Return 200 `{ data: { id, name, phone, role }, error: null, meta: null }`

- [x] 5. Register auth routes in `apps/api/src/index.ts`:
  ```typescript
  import authRoutes from './routes/auth';
  app.route('/api/v1/auth', authRoutes);
  ```

---

## Auth store

- [x] 6. Add `profileExists: boolean | null` state and `setProfileExists` action to
  `packages/mobile-shared/src/store/auth-store.ts`

- [x] 7. Extend `initialize()` in the auth store:
  - After `getSession()`, if session exists: query
    `supabase.from('users').select('id').eq('id', session.user.id).single()`
    and `set({ profileExists: !!data })`
  - If no session: `set({ profileExists: null })`

- [x] 8. Extend `onAuthStateChange` in the auth store:
  - On new session (`newSession !== null`): run the same `public.users` existence query,
    `set({ profileExists: !!data })`
  - On sign-out (`newSession === null`): `set({ profileExists: null })`

---

## Mobile routing

- [x] 9. Update `apps/mobile-customer/app/(auth)/verify.tsx`:
  - Remove `router.replace('/(tabs)')` from the success branch of `onSubmit`
  - On success, do nothing — `onAuthStateChange` fires and the store handles routing

- [x] 10. Update `apps/mobile-customer/app/_layout.tsx` (`InnerLayout`):
  - Read `profileExists` from auth store
  - After `initialized && !loading`: if `user && profileExists === false`,
    return `<Redirect href="/(auth)/register" />`

- [x] 11. Update `apps/mobile-customer/app/(onboarding)/index.tsx`:
  - Read `profileExists` from auth store
  - Change `if (user)` guard to `if (user && profileExists)`

- [x] 12. Update `apps/mobile-customer/app/(tabs)/_layout.tsx`:
  - Change `if (!user)` redirect to `if (!user || profileExists === false)`

- [x] 13. Create `apps/mobile-customer/app/(auth)/register.tsx`:
  - No back navigation (`useNavigation().setOptions({ gestureEnabled: false })` or
    `<Stack.Screen options={{ gestureEnabled: false }} />`)
  - Single name input, `otpRegisterSchema` validation via react-hook-form + zodResolver
  - On submit: call `POST /api/v1/auth/register` with `{ name }` and the session Bearer token
  - On success: call `setProfileExists(true)` from auth store, then `router.replace('/(tabs)')`
  - On error: show inline error message, allow retry
