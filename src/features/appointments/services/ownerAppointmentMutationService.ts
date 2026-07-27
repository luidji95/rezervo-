import { supabase } from "@/lib/supabase/client";
import type { CreateAppointmentInput, CreateAppointmentResult } from "@/types/appointment";
import { createTrustedAppointmentNotification } from "@/services/trustedAppointmentNotificationService";
import { getAppointmentMutationMessage } from "./appointmentMutationError";

export type OwnerAppointmentStatus = "pending"|"confirmed"|"completed"|"cancelled"|"no_show";

function row(data: unknown): Record<string, unknown> | null { return Array.isArray(data) && data[0] && typeof data[0]==="object" ? data[0] as Record<string,unknown> : null; }

export async function createOwnerAppointment(input: CreateAppointmentInput): Promise<CreateAppointmentResult> {
  const { data,error }=await supabase.rpc("create_owner_appointment_atomic_v1",{
    p_salon_id:input.salonId,p_service_id:input.serviceId,p_employee_id:input.employeeId,p_start_time:input.startTime,
    p_customer_full_name:input.client.fullName,p_customer_phone:input.client.phone||"",p_customer_email:input.client.email||"",
    p_customer_note:input.customerNote||"",p_idempotency_key:crypto.randomUUID(),
  });
  if(error) throw new Error(getAppointmentMutationMessage(error));const result=row(data);if(!result) throw new Error(getAppointmentMutationMessage(null));
  if(result.was_created===true) await createTrustedAppointmentNotification(String(result.appointment_id),"appointment_created").catch(()=>null);
  return { id:String(result.appointment_id),salon_id:input.salonId,start_time:String(result.appointment_start),status:String(result.appointment_status) } as CreateAppointmentResult;
}

export async function updateOwnerAppointmentStatus(input:{appointmentId:string;salonId:string;nextStatus:OwnerAppointmentStatus}) {
  void input.salonId;const {data,error}=await supabase.rpc("update_owner_appointment_status_v1",{p_appointment_id:input.appointmentId,p_next_status:input.nextStatus,p_cancellation_reason:null});
  if(error) throw new Error(getAppointmentMutationMessage(error));const result=row(data);if(!result) throw new Error(getAppointmentMutationMessage(null));
  const events:Partial<Record<OwnerAppointmentStatus,"appointment_confirmed"|"appointment_completed"|"appointment_cancelled"|"appointment_no_show">>={confirmed:"appointment_confirmed",completed:"appointment_completed",cancelled:"appointment_cancelled",no_show:"appointment_no_show"};
  const event=events[input.nextStatus];
  if(event) await createTrustedAppointmentNotification(input.appointmentId,event).catch(()=>null);
  if(typeof window!=="undefined"){window.dispatchEvent(new Event("rezervo:appointment-status-changed"));window.localStorage.setItem("rezervo:appointments-version",Date.now().toString());}
  return {id:String(result.appointment_id),status:String(result.new_status)};
}

export async function rescheduleOwnerAppointment(appointmentId:string,newStart:string,newEnd:string,newEmployeeId:string){
  void newEnd;const {data,error}=await supabase.rpc("reschedule_owner_appointment_v1",{p_appointment_id:appointmentId,p_start_time:newStart,p_employee_id:newEmployeeId});
  if(error) throw new Error(getAppointmentMutationMessage(error));const result=row(data);if(!result) throw new Error(getAppointmentMutationMessage(null));
  await createTrustedAppointmentNotification(appointmentId,"appointment_rescheduled").catch(()=>null);return {id:appointmentId,salon_id:String(result.salon_id),start_time:String(result.appointment_start)};
}

export async function updateOwnerAppointmentDetails(appointmentId:string,clientId:string,data:{fullName:string;phone:string;email:string;internalNote:string;customerNote:string}){
  const clientResult=await supabase.from("clients").update({full_name:data.fullName.trim(),phone:data.phone?.trim()||null,email:data.email?.trim()||null}).eq("id",clientId);
  if(clientResult.error) throw new Error("Podatke klijenta trenutno nije moguće sačuvati.");
  const {error}=await supabase.rpc("update_owner_appointment_notes_v1",{p_appointment_id:appointmentId,p_internal_note:data.internalNote||"",p_customer_note:data.customerNote||""});
  if(error) throw new Error(getAppointmentMutationMessage(error));return {success:true};
}
