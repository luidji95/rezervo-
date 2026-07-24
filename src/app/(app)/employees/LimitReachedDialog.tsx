"use client";

import Link from "next/link";
import { LockKeyhole, X } from "lucide-react";
import { UPGRADE_DESTINATION } from "@/features/billing/upgradeNavigation";
import { useEmployeeDialog } from "./useEmployeeDialog";

export function LimitReachedDialog({ planName, limit, onClose }: { planName: string; limit: number; onClose: () => void }) {
  const dialogRef = useEmployeeDialog(onClose, false);
  return <div className="employee-modal-backdrop"><div ref={dialogRef} className="employee-modal employee-limit-dialog" role="dialog" aria-modal="true" aria-labelledby="employee-limit-title">
    <button type="button" className="employee-limit-close" onClick={onClose} aria-label="Zatvori"><X size={18} /></button>
    <span className="employee-limit-icon"><LockKeyhole size={24} aria-hidden="true" /></span>
    <h2 id="employee-limit-title">Dostigli ste limit zaposlenih</h2>
    <p>{planName} paket podržava do {limit} aktivna zaposlena. Nadogradite paket da biste dodali još članova tima.</p>
    <div className="employee-limit-actions"><Link className="employees-primary-btn" href={UPGRADE_DESTINATION}>Pogledaj pakete</Link><button type="button" className="employees-secondary-btn" onClick={onClose}>Zatvori</button></div>
  </div></div>;
}
