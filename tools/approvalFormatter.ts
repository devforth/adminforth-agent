import type { AdminForthResource, IAdminForth } from "adminforth";

/** One tool call awaiting approval, normalized out of the provider interrupt payload. */
export type ApprovalRequest = {
  toolName: string;
  args: Record<string, unknown>;
};

/** Argument keys that address the call itself rather than the data being changed. */
const NON_FIELD_KEYS = new Set(["resourceId", "recordId", "primaryKey", "requiredColumnsToSkip", "meta", "extra"]);
const MAX_VALUE_LENGTH = 80;
const MAX_FIELDS = 12;

function truncate(text: string, limit = MAX_VALUE_LENGTH): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function findResource(adminforth: IAdminForth, resourceId?: unknown): AdminForthResource | undefined {
  return typeof resourceId === "string"
    ? (adminforth.config?.resources ?? []).find((resource) => resource.resourceId === resourceId)
    : undefined;
}

function resourceLabel(resource: AdminForthResource | undefined, args: Record<string, unknown>): string {
  return resource?.label ?? (typeof args.resourceId === "string" ? args.resourceId : "resource");
}

/** `first_name` / `firstName` -> `First name`, for keys the resource does not declare. */
function humanize(name: string): string {
  const spaced = name.replace(/[_-]+/g, " ").replace(/([a-z\d])([A-Z])/g, "$1 $2").trim();

  return spaced ? `${spaced[0].toUpperCase()}${spaced.slice(1).toLowerCase()}` : name;
}

function formatValue(value: unknown, column?: any): string {
  if (value === undefined || value === null || value === "") {
    return "empty";
  }

  if (column?.masked || column?.backendOnly) {
    return "••••••";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  const enumLabel = Array.isArray(column?.enum)
    ? column.enum.find((item: any) => item.value === value)?.label
    : undefined;

  if (enumLabel) {
    return truncate(String(enumLabel));
  }

  if (Array.isArray(value)) {
    return truncate(value.map((item) => formatValue(item)).join(", "));
  }

  if (typeof value === "object") {
    return truncate(JSON.stringify(value));
  }

  return truncate(String(value));
}

/** `Brand: Tesla, Price: 45000` — the record payload in the resource's own wording. */
function formatRecord(record: unknown, resource: AdminForthResource | undefined): string {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return "";
  }

  const columnsByName = new Map((resource?.columns ?? []).map((column) => [column.name, column]));
  const entries = Object.entries(record as Record<string, unknown>)
    .filter(([key]) => !NON_FIELD_KEYS.has(key));
  const shown = entries.slice(0, MAX_FIELDS).map(([name, value]) => {
    const column = columnsByName.get(name);

    return `${column?.label || humanize(name)}: ${formatValue(value, column)}`;
  });
  const hidden = entries.length - shown.length;

  return hidden > 0 ? `${shown.join(", ")} and ${hidden} more` : shown.join(", ");
}

function actionLabel(resource: AdminForthResource | undefined, actionId: unknown): string {
  if (typeof actionId !== "string" || !actionId) {
    return "action";
  }

  const action = (resource?.options?.actions ?? []).find((candidate: any) => candidate.id === actionId);

  return `"${action?.name || humanize(actionId)}"`;
}

/**
 * Describe a tool call awaiting approval in a sentence an admin (not a developer) can
 * act on — resource and column labels instead of ids, values instead of raw JSON.
 * Falls back to a key/value dump for tool calls it does not recognize.
 */
export function formatApprovalRequest(
  adminforth: IAdminForth,
  request: ApprovalRequest,
): string {
  const { args, toolName } = request;
  const resource = findResource(adminforth, args.resourceId);
  const label = resourceLabel(resource, args);

  switch (toolName) {
    case "create_record": {
      const fields = formatRecord(args.record, resource);

      return `Create a new record in ${label}${fields ? ` — ${fields}` : ""}`;
    }

    case "update_record": {
      const fields = formatRecord(args.record, resource);

      return `Update record with id:${formatValue(args.recordId)} in ${label}${fields ? ` — set ${fields}` : ""}`;
    }

    case "delete_record":
      return `Delete record with id:${formatValue(args.primaryKey)} from ${label} — this cannot be undone`;

    case "start_custom_action":
      return `Run ${actionLabel(resource, args.actionId)} on record ${formatValue(args.recordId)} in ${label}`;

    case "start_custom_bulk_action":
    case "start_bulk_action": {
      const count = Array.isArray(args.recordIds) ? args.recordIds.length : 0;

      return `Run ${actionLabel(resource, args.actionId)} on ${count} record(s) in ${label}`;
    }

    default: {
      const fields = formatRecord(args, resource);

      return `${humanize(toolName)}${fields ? ` — ${fields}` : ""}`;
    }
  }
}
