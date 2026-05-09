"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useSalon } from "@/context/SalonContext";
import {
  createService,
  deleteService,
  getSalonServices,
  updateService,
} from "@/services/serviceService";
import type { Service } from "@/types/service";

import { servicesSchema, type ServicesFormData } from "./serviceSchema";

const emptyFormValues: ServicesFormData = {
  name: "",
  description: "",
  durationMinutes: 30,
  priceAmount: 0,
};

export default function ServicesPage() {
  const { currentSalon, salonLoading } = useSalon();

  const [services, setServices] = useState<Service[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingService, setEditingService] = useState<Service | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ServicesFormData>({
    resolver: zodResolver(servicesSchema),
    defaultValues: emptyFormValues,
  });

  async function fetchServices() {
    if (!currentSalon) return;

    setServicesLoading(true);

    try {
      const data = await getSalonServices(currentSalon.id);
      setServices(data);
    } catch (error) {
      console.error("Failed to fetch services:", error);
    } finally {
      setServicesLoading(false);
    }
  }

  useEffect(() => {
    fetchServices();
  }, [currentSalon?.id]);

  async function onSubmit(data: ServicesFormData) {
    if (!currentSalon) return;

    setSubmitError(null);

    try {
      if (editingService) {
        const updatedService = await updateService({
          serviceId: editingService.id,
          name: data.name,
          description: data.description || null,
          durationMinutes: data.durationMinutes,
          priceAmount: data.priceAmount,
        });

        setServices((prev) =>
          prev.map((service) =>
            service.id === updatedService.id ? updatedService : service
          )
        );

        setEditingService(null);
        reset(emptyFormValues);
        return;
      }

      const newService = await createService({
        salonId: currentSalon.id,
        name: data.name,
        description: data.description || null,
        durationMinutes: data.durationMinutes,
        priceAmount: data.priceAmount,
      });

      setServices((prev) => [newService, ...prev]);
      reset(emptyFormValues);
    } catch (error) {
      console.error("Failed to save service:", error);
      setSubmitError("Something went wrong while saving service.");
    }
  }

  async function handleDelete(serviceId: string) {
    setDeleteError(null);
    setDeletingId(serviceId);

    try {
      await deleteService(serviceId);

      setServices((prev) =>
        prev.filter((service) => service.id !== serviceId)
      );

      if (editingService?.id === serviceId) {
        setEditingService(null);
        reset(emptyFormValues);
      }
    } catch (error) {
      console.error("Failed to delete service:", error);
      setDeleteError("Something went wrong while deleting service.");
    } finally {
      setDeletingId(null);
    }
  }

  function handleStartEdit(service: Service) {
    setSubmitError(null);
    setDeleteError(null);
    setEditingService(service);

    reset({
      name: service.name,
      description: service.description ?? "",
      durationMinutes: service.duration_minutes,
      priceAmount: Number(service.price),
    });
  }

  function handleCancelEdit() {
    setEditingService(null);
    reset(emptyFormValues);
  }

  if (salonLoading) {
    return <p>Loading salon...</p>;
  }

  if (!currentSalon) {
    return <p>No salon found.</p>;
  }

  return (
    <main>
      <h1>Services</h1>
      <p>Manage services for {currentSalon.name}</p>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <h2>{editingService ? "Edit service" : "Create service"}</h2>

        <div>
          <label htmlFor="name">Service name</label>
          <input id="name" type="text" {...register("name")} />
          {errors.name && <p>{errors.name.message}</p>}
        </div>

        <div>
          <label htmlFor="description">Description</label>
          <input id="description" type="text" {...register("description")} />
        </div>

        <div>
          <label htmlFor="durationMinutes">Duration minutes</label>
          <input
            id="durationMinutes"
            type="number"
            {...register("durationMinutes")}
          />
          {errors.durationMinutes && <p>{errors.durationMinutes.message}</p>}
        </div>

        <div>
          <label htmlFor="priceAmount">Price</label>
          <input id="priceAmount" type="number" {...register("priceAmount")} />
          {errors.priceAmount && <p>{errors.priceAmount.message}</p>}
        </div>

        {submitError && <p>{submitError}</p>}

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? editingService
              ? "Saving..."
              : "Creating..."
            : editingService
              ? "Save changes"
              : "Create service"}
        </button>

        {editingService && (
          <button type="button" onClick={handleCancelEdit}>
            Cancel edit
          </button>
        )}
      </form>

      <section>
        <h2>Existing services</h2>

        {deleteError && <p>{deleteError}</p>}

        {servicesLoading && <p>Loading services...</p>}

        {!servicesLoading && services.length === 0 && <p>No services yet.</p>}

        {!servicesLoading &&
          services.map((service) => (
            <article key={service.id}>
              <h3>{service.name}</h3>

              {service.description && <p>{service.description}</p>}

              <p>{service.duration_minutes} min</p>

              <p>
                {service.price} {service.currency}
              </p>

              <button type="button" onClick={() => handleStartEdit(service)}>
                Edit
              </button>

              <button
                type="button"
                onClick={() => handleDelete(service.id)}
                disabled={deletingId === service.id}
              >
                {deletingId === service.id ? "Deleting..." : "Delete"}
              </button>
            </article>
          ))}
      </section>
    </main>
  );
}