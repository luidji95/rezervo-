"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Globe, Mail, MapPin, Phone } from "lucide-react";

import { useSalon } from "@/context/SalonContext";
import { updateCurrentSalon } from "@/services/salonService";
import { getSalonWorkingHours } from "@/services/workingService";
import type { WorkingHour } from "@/types/workingHour";
import { generalSchema, type GeneralFormData } from "./generalSchema";

type Salon = NonNullable<ReturnType<typeof useSalon>["currentSalon"]>;

const DAYS = [
  { value: 1, label: "Ponedeljak" },
  { value: 2, label: "Utorak" },
  { value: 3, label: "Sreda" },
  { value: 4, label: "Četvrtak" },
  { value: 5, label: "Petak" },
  { value: 6, label: "Subota" },
  { value: 0, label: "Nedelja" },
];

function formatTime(time?: string | null) {
  if (!time) return "";
  return time.slice(0, 5);
}

function formatWorkingTime(hour?: WorkingHour) {
  if (!hour) return "Nije podešeno";
  if (!hour.is_working_day) return "Zatvoreno";

  return `${formatTime(hour.opens_at)} - ${formatTime(hour.closes_at)}`;
}

export default function GeneralManager({
  onChangeTab,
}: {
  onChangeTab?: (tab: "working-hours") => void;
}) {
  const { currentSalon, salonLoading, refetchSalon } = useSalon();

  const [isEditing, setIsEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [workingHours, setWorkingHours] = useState<WorkingHour[]>([]);
  const [workingHoursLoading, setWorkingHoursLoading] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<GeneralFormData>({
    resolver: zodResolver(generalSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      address_line: "",
      website_url: "",
      instagram_url: "",
      description: "",
    },
  });

  useEffect(() => {
    if (!currentSalon) return;

    reset({
      name: currentSalon.name || "",
      email: currentSalon.email || "",
      phone: currentSalon.phone || "",
      address_line: currentSalon.address_line || "",
      website_url: currentSalon.website_url || "",
      instagram_url: currentSalon.instagram_url || "",
      description: currentSalon.description || "",
    });
  }, [currentSalon, reset]);

useEffect(() => {
  const salonId = currentSalon?.id;

  if (!salonId) return;

  let ignore = false;

  async function loadWorkingHours() {
    try {
      setWorkingHoursLoading(true);

      const data = await getSalonWorkingHours(salonId);

      if (!ignore) {
        setWorkingHours(data);
      }
    } catch (error) {
      console.error("Greška pri učitavanju radnog vremena:", error);
    } finally {
      if (!ignore) {
        setWorkingHoursLoading(false);
      }
    }
  }

  loadWorkingHours();

  return () => {
    ignore = true;
  };
}, [currentSalon?.id]);

  async function onSubmit(data: GeneralFormData) {
    if (!currentSalon) return;

    try {
      setMessage("");

      await updateCurrentSalon({
        salonId: currentSalon.id,
        name: data.name,
        phone: data.phone,
        email: data.email,
        websiteUrl: data.website_url,
        instagramUrl: data.instagram_url,
        addressLine: data.address_line,
        description: data.description,
      });

      await refetchSalon();

      setIsEditing(false);
      setMessage("Podaci su uspešno sačuvani.");
    } catch (error) {
      console.error("Greška pri čuvanju salona:", error);
      setMessage("Došlo je do greške pri čuvanju.");
    }
  }

  function handleCancel() {
    if (!currentSalon) return;

    reset({
      name: currentSalon.name || "",
      email: currentSalon.email || "",
      phone: currentSalon.phone || "",
      address_line: currentSalon.address_line || "",
      website_url: currentSalon.website_url || "",
      instagram_url: currentSalon.instagram_url || "",
      description: currentSalon.description || "",
    });

    setIsEditing(false);
    setMessage("");
  }

  if (salonLoading) {
    return (
      <div className="settings-card">
        <p>Učitavanje opštih podešavanja...</p>
      </div>
    );
  }

  if (!currentSalon) {
    return (
      <div className="settings-card">
        <p className="settings-error-text">Salon nije pronađen.</p>
      </div>
    );
  }

  return (
    <div className="general-layout">
      <div className="general-left-column">
        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <h3>Osnovne informacije</h3>
              <p>Pregled osnovnih informacija o salonu.</p>
            </div>

            {!isEditing && (
              <button
                type="button"
                className="settings-secondary-btn"
                onClick={() => setIsEditing(true)}
              >
                Izmeni
              </button>
            )}
          </div>

          {!isEditing ? (
            <SalonInfoView salon={currentSalon} />
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="general-edit-form">
              <div className="salon-form-fields">
                <FormField label="Naziv salona *" error={errors.name?.message} full>
                  <input {...register("name")} />
                </FormField>

                <FormField label="Email" error={errors.email?.message}>
                  <input {...register("email")} />
                </FormField>

                <FormField label="Telefon" error={errors.phone?.message}>
                  <input {...register("phone")} />
                </FormField>

                <FormField label="Adresa" error={errors.address_line?.message} full>
                  <input {...register("address_line")} />
                </FormField>

                <FormField label="Web sajt">
                  <input {...register("website_url")} />
                </FormField>

                <FormField label="Instagram">
                  <input {...register("instagram_url")} placeholder="@salon" />
                </FormField>

                <FormField label="Opis salona" full>
                  <textarea rows={4} {...register("description")} />
                </FormField>

                <div className="form-actions full">
                  <button
                    type="button"
                    className="settings-secondary-btn"
                    onClick={handleCancel}
                    disabled={isSubmitting}
                  >
                    Otkaži
                  </button>

                  <button
                    type="submit"
                    className="settings-primary-btn"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? "Čuvanje..." : "Sačuvaj izmene"}
                  </button>
                </div>
              </div>
            </form>
          )}

          {message && <p className="settings-save-message standalone">{message}</p>}
        </section>

        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <h3>Radno vreme — sažetak</h3>
              <p>Vaše trenutno radno vreme iz baze.</p>
            </div>
            <button
              type="button"
              className="settings-secondary-btn"
              onClick={() => onChangeTab?.("working-hours")}
            >
              Izmeni
            </button>
          </div>

          {workingHoursLoading ? (
            <p className="card-sub">Učitavanje radnog vremena...</p>
          ) : (
            <div className="working-summary-grid">
              {DAYS.map((day) => {
                const hour = workingHours.find(
                  (item) => item.day_of_week === day.value
                );

                return (
                  <WorkingSummaryDay
                    key={day.value}
                    day={day.label}
                    time={formatWorkingTime(hour)}
                  />
                );
              })}
            </div>
          )}
        </section>
      </div>

      <aside className="general-right-column">
        <PublicPreviewCard salon={currentSalon} />
        <MapCard />
      </aside>
    </div>
  );
}



function SalonInfoView({ salon }: { salon: Salon }) {
  return (
    <div className="salon-info-view">
      <div className="salon-info-logo">
        {salon.logo_url ? (
          <Image
            src={salon.logo_url}
            alt={salon.name}
            width={150}
            height={150}
            unoptimized
          />
        ) : (
          <span>{salon.name.charAt(0).toUpperCase()}</span>
        )}
      </div>

      <div className="salon-info-grid">
        <InfoItem label="Naziv salona" value={salon.name} />
        <InfoItem label="Email" value={salon.email || "Nije uneto"} />
        <InfoItem label="Telefon" value={salon.phone || "Nije uneto"} />
        <InfoItem label="Adresa" value={salon.address_line || "Nije uneto"} />
        <InfoItem label="Web sajt" value={salon.website_url || "Nije uneto"} />
        <InfoItem label="Instagram" value={salon.instagram_url || "Nije uneto"} />
        <InfoItem label="Grad" value={salon.city || "Nije uneto"} />
        <InfoItem label="Vremenska zona" value={salon.timezone || "Europe/Belgrade"} />

        <div className="info-item full">
          <span>Opis salona</span>
          <strong>{salon.description || "Opis još nije dodat."}</strong>
        </div>
      </div>
    </div>
  );
}

function PublicPreviewCard({ salon }: { salon: Salon }) {
  return (
    <section className="settings-card public-preview-card">
      <div className="settings-card-header">
        <div>
          <h3>Pregled javnog prikaza</h3>
          <p>Ovako će vaš salon izgledati klijentima na online rezervacijama.</p>
        </div>
      </div>

      <div className="public-salon-preview">
        <div className="public-cover-image" />

        <div className="public-preview-body">
          <div className="public-logo-floating">
            {salon.logo_url ? (
              <Image
                src={salon.logo_url}
                alt={salon.name}
                width={86}
                height={86}
                unoptimized
              />
            ) : (
              <span>{salon.name.charAt(0).toUpperCase()}</span>
            )}
          </div>

          <h3>{salon.name}</h3>
          <p className="public-rating">⭐ 4.9 (128 ocena)</p>

          <PreviewLine
            icon={<MapPin size={15} />}
            text={salon.address_line || "Adresa nije uneta"}
          />
          <PreviewLine
            icon={<Phone size={15} />}
            text={salon.phone || "Telefon nije unet"}
          />
          <PreviewLine
            icon={<Mail size={15} />}
            text={salon.email || "Email nije unet"}
          />
          <PreviewLine
            icon={<Globe size={15} />}
            text={salon.website_url || "Web sajt nije unet"}
          />

          <button type="button" className="preview-booking-btn">
            Pogledaj stranicu za rezervacije
          </button>
        </div>
      </div>
    </section>
  );
}

function MapCard() {
  return (
    <section className="settings-card map-card">
      <div className="settings-card-header">
        <div>
          <h3>Lokacija na mapi</h3>
          <p>Vaša adresa koja je prikazana klijentima.</p>
        </div>
      </div>

      <div className="fake-map">
        <MapPin size={34} />
      </div>

      <button type="button" className="settings-secondary-btn full-width">
        Promeni lokaciju
      </button>
    </section>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FormField({
  label,
  error,
  full,
  children,
}: {
  label: string;
  error?: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`form-field ${full ? "full" : ""}`}>
      <label>{label}</label>
      {children}
      {error && <small>{error}</small>}
    </div>
  );
}

function WorkingSummaryDay({ day, time }: { day: string; time: string }) {
  return (
    <div className="working-summary-day">
      <span>{day}</span>
      <strong>{time}</strong>
    </div>
  );
}

function PreviewLine({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="preview-info-row">
      {icon}
      <span>{text}</span>
    </div>
  );
}