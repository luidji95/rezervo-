import { ImageResponse } from "next/og";

// Slika koja se prikazuje kad se link na rezervo.studio pošalje u Viber, WhatsApp, Instagram DM ili Facebook.
export const alt = "Rezervo – online zakazivanje termina za salone";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const VIOLET = "#6d28d9";
const VIOLET_DARK = "#4c1d95";
const INK = "#1c142d";

function Slot({ time, label, booked }: { time: string; label: string; booked?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <div style={{ display: "flex", width: 64, color: "#8d8598", fontSize: 22 }}>{time}</div>
      <div
        style={{
          display: "flex",
          flex: 1,
          alignItems: "center",
          height: 58,
          padding: "0 20px",
          borderLeft: `6px solid ${booked ? "#8b5cf6" : "#e4dded"}`,
          borderRadius: 10,
          background: booked ? "#ede9fe" : "#f8f7fb",
          color: booked ? VIOLET_DARK : "#a39bb0",
          fontSize: 22,
          fontWeight: 700,
        }}
      >
        {label}
      </div>
    </div>
  );
}

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          padding: "64px 70px",
          background: "linear-gradient(135deg, #faf8ff 0%, #f0eafd 100%)",
          color: INK,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 600 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 64,
                height: 64,
                borderRadius: 18,
                background: `linear-gradient(145deg, #7c3aed, ${VIOLET_DARK})`,
                color: "#fff",
                fontSize: 34,
                fontWeight: 800,
              }}
            >
              R
            </div>
            <div style={{ display: "flex", fontSize: 40, fontWeight: 800, letterSpacing: -1.5 }}>Rezervo</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div style={{ display: "flex", flexDirection: "column", fontSize: 60, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2.5 }}>
              <span>Online zakazivanje</span>
              <span style={{ color: VIOLET }}>za vaš salon.</span>
            </div>
            <div style={{ display: "flex", fontSize: 27, lineHeight: 1.4, color: "#514b60" }}>
              Klijenti sami biraju termin. Vi šaljete SMS potvrdu i podsetnik.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                display: "flex",
                padding: "14px 26px",
                borderRadius: 14,
                background: VIOLET,
                color: "#fff",
                fontSize: 24,
                fontWeight: 800,
              }}
            >
              3 meseca besplatno
            </div>
            <div style={{ display: "flex", fontSize: 24, color: "#6b6478", fontWeight: 700 }}>rezervo.studio</div>
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "flex-end" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              width: 420,
              padding: 28,
              borderRadius: 26,
              background: "#fff",
              boxShadow: "0 30px 70px rgba(76, 29, 149, 0.18)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ display: "flex", fontSize: 26, fontWeight: 800 }}>Danas</div>
              <div
                style={{
                  display: "flex",
                  padding: "6px 14px",
                  borderRadius: 999,
                  background: "#dcfce7",
                  color: "#166534",
                  fontSize: 18,
                  fontWeight: 800,
                }}
              >
                SMS poslat
              </div>
            </div>
            <Slot time="09:00" label="Šišanje · Ana" booked />
            <Slot time="10:30" label="Feniranje · Milica" booked />
            <Slot time="12:00" label="Slobodno" />
            <Slot time="13:30" label="Manikir · Jelena" booked />
          </div>
        </div>
      </div>
    ),
    size,
  );
}
