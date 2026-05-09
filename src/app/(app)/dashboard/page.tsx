"use client";

import { useSalon } from "@/context/SalonContext";

export default function DashboardPage() {
  const { currentSalon, salonLoading } = useSalon();

  if (salonLoading) {
    return <p>Loading salon...</p>;
  }

  return (
    <main>
      <h1>Rezervo Dashboard</h1>
      <p>Current salon: {currentSalon?.name}</p>
      <p>City: {currentSalon?.city}</p>
    </main>
  );
}