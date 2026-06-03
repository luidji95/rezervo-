"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { CalendarAppointment } from "@/services/calendarQueryService";

type EditAppointmentModalProps = {
  isOpen: boolean;
  onClose: () => void;
  appointment: CalendarAppointment;
  onUpdateConfirm: (formData: {
    fullName: string;
    phone: string;
    email: string;
    internalNote: string;
    customerNote: string;
  }) => Promise<void>;
};

export default function EditAppointmentModal({
  isOpen,
  onClose,
  appointment,
  onUpdateConfirm,
}: EditAppointmentModalProps) {
  // Lokalne države se inicijalizuju direktno iz props-a (Key prop na roditelju brine o resetovanju)
  const [fullName, setFullName] = useState(appointment.clients?.full_name || "");
  const [phone, setPhone] = useState(appointment.clients?.phone || "");
  const [email, setEmail] = useState(appointment.clients?.email || "");
  const [internalNote, setInternalNote] = useState(appointment.internal_note || "");
  const [customerNote, setCustomerNote] = useState(appointment.customer_note || "");
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      await onUpdateConfirm({
        fullName,
        phone,
        email,
        internalNote,
        customerNote,
      });
      onClose();
    } catch (err) {
      console.error("Greška pri izmeni podataka termina:", err);
      alert("Nije uspelo ažuriranje podataka.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: "rgba(15, 23, 42, 0.6)", display: "flex",
      alignItems: "center", justifyContent: "center", zIndex: 1000,
      backdropFilter: "blur(4px)"
    }}>
      <div style={{
        backgroundColor: "#ffffff", borderRadius: "12px", width: "100%",
        maxWidth: "480px", padding: "24px", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)"
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#0f172a" }}>Izmeni podatke o terminu</h2>
            <p style={{ fontSize: "13px", color: "#64748b", marginTop: "2px" }}>
              Usluga: <strong>{appointment.services?.name || "Nije navedena"}</strong>
            </p>
          </div>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}>
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "4px" }}>
              Ime i prezime klijenta
            </label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "14px", color: "#0f172a" }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "4px" }}>
                Telefon
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "14px", color: "#0f172a" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "4px" }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "14px", color: "#0f172a" }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "4px" }}>
              Interna napomena (vidi samo salon)
            </label>
            <textarea
              rows={2}
              value={internalNote}
              onChange={(e) => setInternalNote(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "14px", color: "#0f172a", resize: "none" }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "4px" }}>
              Napomena klijenta
            </label>
            <textarea
              rows={2}
              value={customerNote}
              onChange={(e) => setCustomerNote(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "14px", color: "#0f172a", resize: "none" }}
            />
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: "12px", justifyContent: "end", marginTop: "14px" }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{ padding: "10px 16px", borderRadius: "6px", border: "1px solid #cbd5e1", backgroundColor: "#ffffff", color: "#334155", fontSize: "14px", cursor: "pointer" }}
            >
              Otkaži
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{ padding: "10px 16px", borderRadius: "6px", border: "none", backgroundColor: "#4f46e5", color: "#ffffff", fontSize: "14px", fontWeight: 500, cursor: "pointer" }}
            >
              {submitting ? "Čuvanje..." : "Sačuvaj izmene"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}