const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/;
const TICKET = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{1,63}$/;
const OPERATOR = /^[A-Za-z0-9._@-]{1,64}$/;

export type RecoveryApply = { reviewToken: string; ticket: string; reason: string; operator: string };
export type RecoveryCommand =
  | { kind: "event"; targetId: string; apply: RecoveryApply | null }
  | { kind: "subscription"; targetId: string; apply: RecoveryApply | null }
  | { kind: "plan-change"; targetId: string; apply: RecoveryApply | null };

export class RecoveryUsageError extends Error {
  constructor(message: string) { super(message); this.name = "RecoveryUsageError"; }
}

const TARGET_FLAGS = { event: "--event", subscription: "--subscription", "plan-change": "--change" } as const;
const VALUE_FLAGS = new Set(["--event", "--subscription", "--change", "--review-token", "--ticket", "--reason", "--operator"]);
const SWITCH_FLAGS = new Set(["--apply"]);

export const RECOVERY_USAGE = [
  "Usage:",
  "  billing-recovery event --event <webhook-event-uuid>                 (dry-run)",
  "  billing-recovery subscription --subscription <subscription-uuid>    (dry-run)",
  "  billing-recovery plan-change --change <plan-change-uuid>            (dry-run, C2)",
  "  ... --apply --review-token <token> --ticket <ref> --reason <text> --operator <label>",
  "Dry-run is the default. The billing environment and credentials come from the trusted",
  "environment of the operator shell and can not be passed as arguments.",
].join("\n");

/** Parses operator arguments. Anything unknown is rejected, so secrets or an environment can never be smuggled in. */
export function parseRecoveryArgs(argv: readonly string[]): RecoveryCommand {
  const [kind, ...rest] = argv;
  if (kind !== "event" && kind !== "subscription" && kind !== "plan-change") throw new RecoveryUsageError("A command (event|subscription|plan-change) is required.");
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (SWITCH_FLAGS.has(flag)) { apply = true; continue; }
    if (!VALUE_FLAGS.has(flag)) throw new RecoveryUsageError(`Unsupported argument: ${flag.startsWith("--") ? flag : "positional value"}.`);
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) throw new RecoveryUsageError(`${flag} needs a value.`);
    if (values.has(flag)) throw new RecoveryUsageError(`${flag} was given twice.`);
    values.set(flag, value);
    index += 1;
  }
  const targetFlag = TARGET_FLAGS[kind];
  const targetId = values.get(targetFlag);
  for (const otherFlag of Object.values(TARGET_FLAGS)) {
    if (otherFlag !== targetFlag && values.has(otherFlag)) throw new RecoveryUsageError(`${otherFlag} does not apply to the ${kind} command.`);
  }
  if (!targetId || !UUID.test(targetId)) throw new RecoveryUsageError(`${targetFlag} must be a UUID.`);

  const applyFlags = ["--review-token", "--ticket", "--reason", "--operator"].filter((flag) => values.has(flag));
  if (!apply) {
    if (applyFlags.length > 0) throw new RecoveryUsageError(`${applyFlags[0]} is only valid together with --apply.`);
    return { kind, targetId: targetId.toLowerCase(), apply: null };
  }
  const reviewToken = values.get("--review-token") ?? "";
  const ticket = values.get("--ticket") ?? "";
  const reason = (values.get("--reason") ?? "").trim();
  const operator = values.get("--operator") ?? "";
  if (!TOKEN.test(reviewToken)) throw new RecoveryUsageError("--apply requires the --review-token printed by the dry-run.");
  if (!TICKET.test(ticket)) throw new RecoveryUsageError("--apply requires a --ticket reference.");
  if (reason.length < 10 || reason.length > 500) throw new RecoveryUsageError("--apply requires a --reason of 10-500 characters.");
  if (!OPERATOR.test(operator)) throw new RecoveryUsageError("--apply requires an --operator label (letters, digits, . _ @ -).");
  return { kind, targetId: targetId.toLowerCase(), apply: { reviewToken, ticket, reason, operator } };
}
