export type BillingPeriod = "monthly" | "yearly";

export type PreviewPlan = {
  id: "basic" | "pro" | "premium";
  name: string;
  monthlyPrice: string;
  yearlyPrice: string;
  description: string;
  features: string[];
  popular?: boolean;
  current?: boolean;
};

export type PreviewPayment = {
  id: string;
  date: string;
  plan: string;
  amount: string;
  status: "Uspešno";
};
