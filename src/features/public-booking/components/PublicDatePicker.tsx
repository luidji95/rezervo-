type PublicDatePickerProps = {
  minDate: string;
  disabled?: boolean;
  selectedDate: string;
  onSelectDate: (date: string) => void;
};

export function PublicDatePicker({
  minDate,
  disabled = false,
  selectedDate,
  onSelectDate,
}: PublicDatePickerProps) {
  return (
    <section className="public-date-section">
      <div className="public-section-heading">
        <p className="public-booking-eyebrow">Datum</p>
        <h2>Izaberite datum</h2>
      </div>

      <label className="public-date-field" htmlFor="public-booking-date">
        <span>Datum termina</span>
        <input
          id="public-booking-date"
          type="date"
          disabled={disabled}
          min={minDate}
          value={selectedDate}
          onChange={(event) => onSelectDate(event.target.value)}
        />
      </label>
    </section>
  );
}
