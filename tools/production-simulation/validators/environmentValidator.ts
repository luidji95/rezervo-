export type SimulationEnvironment = {
  supabaseUrl: string;
  serviceRoleKey: string;
  projectRef: string;
  environmentName: string;
  isProduction: boolean;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}.`);
  return value;
}

export function validateSimulationEnvironment(): SimulationEnvironment {
  if (process.env.ALLOW_REZERVO_SIMULATION !== "true") {
    throw new Error(
      "Simulation is locked. Set ALLOW_REZERVO_SIMULATION=true explicitly.",
    );
  }

  const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const url = new URL(supabaseUrl);
  const projectRef = url.hostname.split(".")[0] || "unknown";
  const environmentName = (
    process.env.APP_ENV ??
    process.env.VERCEL_ENV ??
    process.env.NODE_ENV ??
    "development"
  ).toLowerCase();
  const isProduction = environmentName === "production";

  if (
    isProduction &&
    process.env.ALLOW_PRODUCTION_SIMULATION_I_UNDERSTAND_THE_RISK !== "true"
  ) {
    throw new Error(
      "Production simulation is locked. The explicit production override is missing.",
    );
  }

  return {
    supabaseUrl,
    serviceRoleKey,
    projectRef,
    environmentName,
    isProduction,
  };
}
