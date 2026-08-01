const CHECKOUT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NUMERIC_OBJECT_ID_PATTERN = /^[1-9]\d*$/;

export class LemonSqueezyResourceIdError extends Error {
  constructor() {
    super("LEMONSQUEEZY_RESOURCE_ID_INVALID");
    this.name = "LemonSqueezyResourceIdError";
  }
}

export function parseLemonSqueezyCheckoutId(value: unknown): string {
  if (typeof value !== "string" || !CHECKOUT_ID_PATTERN.test(value)) {
    throw new LemonSqueezyResourceIdError();
  }
  return value;
}

export function parseLemonSqueezyNumericObjectId(value: unknown): string {
  const normalized =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : value;
  if (
    typeof normalized !== "string" ||
    !NUMERIC_OBJECT_ID_PATTERN.test(normalized)
  ) {
    throw new LemonSqueezyResourceIdError();
  }
  return normalized;
}
