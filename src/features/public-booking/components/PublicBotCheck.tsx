"use client";

import { useEffect, useRef, useState } from "react";

// Cloudflare Turnstile widget (managed, shown only if interaction is needed). It reports a token, or null when the
// token expired or the check failed; a new `generation` resets it after a token was used. The token is validated
// on the server, which also checks the hostname and the action.
type TurnstileApi = {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId?: string): void;
  remove(widgetId: string): void;
};
declare global {
  interface Window { turnstile?: TurnstileApi }
}

const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
export const BOT_CHECK_ACTION = "public_booking";
let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("TURNSTILE_MISSING")));
    script.onerror = () => { scriptPromise = null; reject(new Error("TURNSTILE_LOAD_FAILED")); };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

type Props = { siteKey: string; generation: number; onToken: (token: string | null) => void };

export function PublicBotCheck({ siteKey, generation, onToken }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    onToken(null);
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action: BOT_CHECK_ACTION,
          appearance: "interaction-only",
          "refresh-expired": "auto",
          callback: (token: string) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
        });
      })
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => {
      cancelled = true;
      if (widgetIdRef.current) window.turnstile?.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, [siteKey, onToken]);

  useEffect(() => {
    if (generation === 0 || !widgetIdRef.current) return;
    onToken(null);
    window.turnstile?.reset(widgetIdRef.current);
  }, [generation, onToken]);

  return (
    <div className="pb-bot-check">
      <div ref={containerRef} />
      {loadFailed && <p className="pb-error" role="alert">Provera nije učitana. Proverite vezu i osvežite stranicu.</p>}
    </div>
  );
}
