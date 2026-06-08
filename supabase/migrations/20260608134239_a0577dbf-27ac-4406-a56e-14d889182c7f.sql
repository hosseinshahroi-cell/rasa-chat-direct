
REVOKE EXECUTE ON FUNCTION public.report_user(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_reports(boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_resolve_report(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_flags(uuid, boolean, boolean, boolean, boolean, boolean, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_global_locks(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_broadcast(text) FROM PUBLIC, anon;
