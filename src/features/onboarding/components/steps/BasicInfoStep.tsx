import type { UseFormReturn } from "react-hook-form";

import {
  SALON_BUSINESS_TYPE_OPTIONS,
  type OnboardingFormData,
} from "@/app/onboarding/onboardingSchema";

type BasicInfoStepProps = {
  form: UseFormReturn<OnboardingFormData>;
  onSubmit: (data: OnboardingFormData) => Promise<void>;
};

export function BasicInfoStep({ form, onSubmit }: BasicInfoStepProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;

  return (
    <form
      className="onboarding-form onboarding-form-grid"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
    >
      <div className="onboarding-field">
        <label htmlFor="name">Salon name</label>

        <input id="name" type="text" {...register("name")} />

        {errors.name && (
          <p className="onboarding-field-error">{errors.name.message}</p>
        )}
      </div>

      <div className="onboarding-field">
        <label htmlFor="businessType">Business type</label>

        <select id="businessType" {...register("businessType")}>
          {SALON_BUSINESS_TYPE_OPTIONS.map((type) => (
            <option key={`${type.label}-${type.value}`} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>

        {errors.businessType && (
          <p className="onboarding-field-error">
            {errors.businessType.message}
          </p>
        )}
      </div>

      <div className="onboarding-field">
        <label htmlFor="phone">Phone</label>

        <input id="phone" type="text" {...register("phone")} />

        {errors.phone && (
          <p className="onboarding-field-error">{errors.phone.message}</p>
        )}
      </div>

      <div className="onboarding-field">
        <label htmlFor="email">Email</label>

        <input id="email" type="email" {...register("email")} />

        {errors.email && (
          <p className="onboarding-field-error">{errors.email.message}</p>
        )}
      </div>

      <div className="onboarding-field onboarding-field-full">
        <label htmlFor="addressLine">Address</label>

        <input id="addressLine" type="text" {...register("addressLine")} />

        {errors.addressLine && (
          <p className="onboarding-field-error">
            {errors.addressLine.message}
          </p>
        )}
      </div>

      <div className="onboarding-field">
        <label htmlFor="websiteUrl">Website (optional)</label>

        <input id="websiteUrl" type="text" {...register("websiteUrl")} />

        {errors.websiteUrl && (
          <p className="onboarding-field-error">{errors.websiteUrl.message}</p>
        )}
      </div>

      <div className="onboarding-field">
        <label htmlFor="instagramUrl">Instagram (optional)</label>

        <input
          id="instagramUrl"
          type="text"
          placeholder="@instagram"
          {...register("instagramUrl")}
        />

        {errors.instagramUrl && (
          <p className="onboarding-field-error">
            {errors.instagramUrl.message}
          </p>
        )}
      </div>

      <div className="onboarding-field onboarding-field-full">
        <label htmlFor="description">Description (optional)</label>

        <textarea id="description" rows={4} {...register("description")} />
      </div>

      <div className="onboarding-actions onboarding-field-full">
        <button
          className="onboarding-primary-btn"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Čuvanje..." : "Sačuvaj salon"}
        </button>
      </div>
    </form>
  );
}
