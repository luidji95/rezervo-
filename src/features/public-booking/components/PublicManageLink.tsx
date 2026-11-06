"use client";

import { useEffect, useRef, useState } from "react";
import { buildManageLink, MANAGE_BOOKING_PATH } from "@/lib/publicBookingManage/manageToken";

type Props = { token: string };

// Shown on the success screen only when the server attached this booking's token. The link is the only key to the
// appointment, so the text asks the client to keep it and not to share it.
export function PublicManageLink({ token }: Props) {
  const [manualLink, setManualLink] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");
  const fieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (copyState === "manual") fieldRef.current?.select(); }, [copyState]);

  const copy = async () => {
    const link = buildManageLink(window.location.origin, token);
    try {
      await navigator.clipboard.writeText(link);
      setCopyState("copied");
    } catch {
      setManualLink(link);
      setCopyState("manual");
    }
  };

  return (
    <section className="pb-manage-link" aria-labelledby="pb-manage-link-title">
      <h2 id="pb-manage-link-title">Privatni link za vaš termin</h2>
      <p>Sačuvajte ovaj privatni link ako želite da otkažete termin. Ako ga izgubite, kontaktirajte salon.</p>
      <p>Otkazivanje je moguće najkasnije 2 sata pre početka. Link važi samo za ovaj termin, zato ga ne delite.</p>
      <div className="pb-manage-actions">
        <a className="pb-button" href={`${MANAGE_BOOKING_PATH}#${token}`} rel="noreferrer">Upravljaj terminom</a>
        <button type="button" className="pb-button-secondary" onClick={() => void copy()}>Kopiraj privatni link</button>
      </div>
      {copyState === "copied" && <p className="pb-copy-status" role="status">Link je kopiran.</p>}
      {copyState === "manual" && manualLink && (
        <>
          <p className="pb-copy-status" role="status">Kopiranje nije uspelo. Označite i kopirajte link ručno:</p>
          <input ref={fieldRef} className="pb-copy-field" readOnly value={manualLink} aria-label="Privatni link za upravljanje terminom" onFocus={(event) => event.currentTarget.select()} />
        </>
      )}
    </section>
  );
}
