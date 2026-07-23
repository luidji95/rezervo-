export const SIMULATION_SCENARIO_VERSION = 1;

export const SIMULATION_PROFILES = {
  small: {
    clients: 100,
    appointments: 500,
    historyMonths: 6,
  },
  medium: {
    clients: 1_000,
    appointments: 10_000,
    historyMonths: 24,
  },
  large: {
    clients: 3_000,
    appointments: 30_000,
    historyMonths: 36,
  },
} as const;

export type SimulationProfileName = keyof typeof SIMULATION_PROFILES;

export function isSimulationProfile(value: string): value is SimulationProfileName {
  return value in SIMULATION_PROFILES;
}
