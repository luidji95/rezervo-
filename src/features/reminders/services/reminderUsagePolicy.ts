export function countsTowardReminderQuota(input: {
  sentAt: string | null;
  providerMessageId: string | null;
}) {
  return Boolean(input.sentAt && input.providerMessageId);
}
