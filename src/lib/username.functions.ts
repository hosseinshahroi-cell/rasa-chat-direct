import { createServerFn } from "@tanstack/react-start";

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;

export const checkUsernameAvailability = createServerFn({ method: "POST" })
  .inputValidator((input: { username: string; excludeUserId?: string }) => input)
  .handler(async ({ data }) => {
    const username = (data.username ?? "").trim();
    if (!username) {
      return { available: false, error: "نام کاربری نمی‌تواند خالی باشد" };
    }
    if (username.length < 4) {
      return { available: false, error: "آیدی باید بیشتر از ۳ کاراکتر باشد" };
    }
    if (!USERNAME_REGEX.test(username)) {
      return {
        available: false,
        error: "آیدی فقط می‌تواند شامل حروف انگلیسی، اعداد و _ باشد (فارسی مجاز نیست)",
      };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const query = supabaseAdmin
      .from("profiles")
      .select("id, username")
      .ilike("username", username)
      .limit(1);
    const { data: rows, error } = await query;
    if (error) {
      return { available: false, error: "خطا در بررسی آیدی" };
    }
    const existing = rows?.[0];
    if (existing && existing.id !== data.excludeUserId) {
      return { available: false, error: "این آیدی در پیام رسان رسا وجود دارد" };
    }
    return { available: true, error: null as string | null };
  });
