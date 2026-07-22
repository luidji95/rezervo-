import type { Service } from "@/types/service";

type EmployeeServiceSelectorProps = {
  disabled?: boolean;
  selectedServiceIds: string[];
  services: Service[];
  onChange: (serviceIds: string[]) => void;
};

export function EmployeeServiceSelector({
  disabled,
  selectedServiceIds,
  services,
  onChange,
}: EmployeeServiceSelectorProps) {
  function toggleService(serviceId: string) {
    onChange(
      selectedServiceIds.includes(serviceId)
        ? selectedServiceIds.filter((id) => id !== serviceId)
        : [...selectedServiceIds, serviceId]
    );
  }

  return (
    <div className="employee-services-picker">
      <h4>Usluge</h4>

      {services.length === 0 ? (
        <p className="employee-muted-text">Nema aktivnih usluga u salonu.</p>
      ) : (
        <div className="employee-service-checkboxes">
          {services.map((service) => (
            <label key={service.id}>
              <input
                type="checkbox"
                checked={selectedServiceIds.includes(service.id)}
                disabled={disabled}
                onChange={() => toggleService(service.id)}
              />
              <span>
                <strong>{service.name}</strong>
                <small>
                  {service.duration_minutes} min · {service.price} {service.currency}
                </small>
              </span>
            </label>
          ))}
        </div>
      )}

      {selectedServiceIds.length === 0 && (
        <p className="employee-service-warning">
          Zaposleni nema dodeljene usluge i neće biti dostupan za online
          rezervacije.
        </p>
      )}
    </div>
  );
}
