

import {
  getPublicEmployees,
  getPublicSalonBySlug,
  getPublicServices,
} from "@/services/publicBookingService";

import { AvailabilityTestButton } from "./AvailabilityTestButton";

type BookingTestPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function BookingTestPage({
  params,
}: BookingTestPageProps) {
  const { slug } = await params;

  const salon = await getPublicSalonBySlug(slug);
  const services = await getPublicServices(salon.id);
  const employees = await getPublicEmployees(salon.id);

  return (
    <main>
      <h1>Public Booking Test</h1>

      <section>
        <h2>Salon</h2>
        <p>{salon.name}</p>
        <p>{salon.city}</p>
        <p>{salon.address_line}</p>
      </section>

      <section>
        <h2>Public Services</h2>

        {services.length === 0 ? (
          <p>No public services found.</p>
        ) : (
          <ul>
            {services.map((service) => (
              <li key={service.id}>
                <strong>{service.name}</strong> — {service.duration_minutes} min
                — {service.price} {service.currency}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Public Employees</h2>

        {employees.length === 0 ? (
          <p>No public employees found.</p>
        ) : (
          <ul>
            {employees.map((employee) => (
              <li key={employee.id}>
                <strong>{employee.display_name || employee.full_name}</strong>
                {employee.position ? ` — ${employee.position}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      {services[0] && employees[0] && (
  <AvailabilityTestButton
    salonId={salon.id}
    serviceId={services[0].id}
    employeeId={employees[0].id}
  />
)}
    </main>
  );
}