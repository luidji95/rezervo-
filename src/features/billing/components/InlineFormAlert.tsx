"use client";
import { forwardRef } from "react";
import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { UPGRADE_DESTINATION } from "../upgradeNavigation";
export const InlineFormAlert = forwardRef<HTMLDivElement, { title: string; message: string; showUpgradeAction?: boolean }>(function InlineFormAlert({ title, message, showUpgradeAction }, ref) {
  return <div ref={ref} className="employee-inline-alert" role="alert" tabIndex={-1}><CircleAlert size={20} aria-hidden="true" /><div><strong>{title}</strong><p>{message}</p>{showUpgradeAction && <Link href={UPGRADE_DESTINATION}>Pogledaj pakete</Link>}</div></div>;
});
