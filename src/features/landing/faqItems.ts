import { TRIAL_OFFER_NOTICE } from "../pricing/trialOffer.ts";

// Landing FAQ: one source for questions and answers. Each answer describes what the product does today.
export type FaqItem = {
  id: string;
  question: string;
  answer: string;
  link?: { href: string; label: string; note: string };
};

export const FAQ_ITEMS: FaqItem[] = [
  {
    id: "instalacija",
    question: "Da li moram nešto da instaliram?",
    answer: "Ne. Rezervo koristite kroz internet pregledač na telefonu, tabletu ili računaru.",
  },
  {
    id: "zakazivanje",
    question: "Kako klijenti zakazuju termin?",
    answer: "Podelite link svog salona. Klijent bira uslugu, zaposlenog i slobodno vreme, pa unosi kontakt podatke. Za zakazivanje mu nije potreban Rezervo nalog.",
  },
  {
    id: "potvrda",
    question: "Da li moram ručno da potvrdim svaku online rezervaciju?",
    answer: "Ne. Kada sistem uspešno zakaže termin, on se odmah pojavljuje kao potvrđen u vašem kalendaru.",
  },
  {
    id: "sms",
    question: "Kako rade SMS obaveštenja?",
    answer: "U Pro paketu i tokom Pro probnog perioda možete uključiti SMS potvrdu online rezervacije sa privatnim linkom za otkazivanje. Podsetnik pre termina uključujete posebno u podešavanjima salona, gde birate i koliko ranije se šalje.",
  },
  {
    id: "otkazivanje",
    question: "Može li klijent sam da otkaže termin?",
    answer: "Da. Preko privatnog linka koji dobije nakon online rezervacije može da otkaže termin najkasnije dva sata pre početka. Za kasnije otkazivanje treba da kontaktira salon.",
  },
  {
    id: "probni-period",
    question: "Šta dobijam tokom probnog perioda?",
    answer: TRIAL_OFFER_NOTICE,
  },
  {
    id: "zaposleni",
    question: "Da li zaposleni mogu da imaju svoje naloge?",
    answer: "Da. Zaposlenima možete omogućiti pristup kroz njihove naloge, uz dozvole koje odgovaraju njihovoj ulozi.",
  },
  {
    id: "ai-recepcionista",
    question: "Da li je AI recepcionista već dostupan?",
    answer: "AI recepcionista je u pripremi.",
    link: { href: "/demo/ai-recepcioner", label: "Pogledajte interaktivni demo", note: "Demo je simulacija sa izmišljenim podacima; ništa se ne šalje niti zakazuje." },
  },
];
