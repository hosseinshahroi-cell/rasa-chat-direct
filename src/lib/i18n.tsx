import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "system" | "fa" | "en";

const STORAGE_KEY = "rasa_lang";

interface LangCtx {
  lang: Lang;
  effective: "fa" | "en";
  setLang: (l: Lang) => void;
}

const Ctx = createContext<LangCtx>({ lang: "system", effective: "fa", setLang: () => {} });

function resolveEffective(l: Lang): "fa" | "en" {
  if (l !== "system") return l;
  if (typeof navigator === "undefined") return "fa";
  return navigator.language.startsWith("fa") ? "fa" : "en";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("system");

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (stored === "fa" || stored === "en" || stored === "system") setLangState(stored);
  }, []);

  const effective = resolveEffective(lang);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = effective;
    document.documentElement.dir = effective === "fa" ? "rtl" : "ltr";
  }, [effective]);

  const setLang = (l: Lang) => {
    setLangState(l);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, l);
  };

  return <Ctx.Provider value={{ lang, effective, setLang }}>{children}</Ctx.Provider>;
}

export const useLang = () => useContext(Ctx);
