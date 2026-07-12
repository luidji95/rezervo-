function createRowKey(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createServiceRowKey(id?: string) {
  return createRowKey(id ?? "new-service");
}

export function createEmployeeRowKey(id?: string) {
  return createRowKey(id ?? "new-employee");
}

