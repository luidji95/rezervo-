import type { Metadata } from "next";
import { AiReceptionistDemo } from "@/features/ai-demo/AiReceptionistDemo";

export const metadata: Metadata = {
  title: "AI recepcionista — interaktivni demo | Rezervo",
  description: "Simulacija budućeg AI recepcioniste: kako bi klijent kroz poruke zakazao termin u salonu. Funkcija je u pripremi; razgovor i termini su izmišljeni.",
  alternates: { canonical: "/demo/ai-recepcioner" },
  openGraph: { title: "AI recepcionista — interaktivni demo", description: "Simulacija zakazivanja kroz poruke. Funkcija je u pripremi.", type: "website", url: "/demo/ai-recepcioner" },
};

export default function AiReceptionistDemoPage() {
  return <AiReceptionistDemo />;
}
