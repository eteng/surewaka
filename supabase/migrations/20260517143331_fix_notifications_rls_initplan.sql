-- Fix RLS policies to use subquery for auth.uid() (performance optimization)
DROP POLICY notifications_select_own ON public.notifications;
DROP POLICY notifications_update_own ON public.notifications;

CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT USING ((select auth.uid()) = user_id);

CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE USING ((select auth.uid()) = user_id);;
