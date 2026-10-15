import { logger, type AdminForthResource, type IAdminForth } from "adminforth";
import { getErrorMessage } from "../shared/errors.js";

/** One tool call awaiting approval, normalized out of the provider interrupt payload. */
export type ApprovalRequest = {
  toolName: string;
  args: Record<string, unknown>;
};

/** One value on the approval card; `from` is the stored value an update replaces. */
export type ApprovalField = {
  label: string;
  from?: string;
  to: string;
};

/** A tool call awaiting approval, described for the approval card. */
export type ApprovalDescription = {
  /** What the call does and to which record, e.g. `Update record with id:10 in Cars`. */
  summary: string;
  /** The values the call writes, in the resource's own wording. */
  fields: ApprovalField[];
};

/** Argument keys that address the call itself rather than the data being changed. */
const NON_FIELD_KEYS = new Set(["resourceId", "recordId", "primaryKey", "requiredColumnsToSkip", "meta", "extra"]);
const MAX_VALUE_LENGTH = 80;

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

/**
 * The record payload as labelled values in the resource's own wording. Every field is
 * listed: the admin approves exactly what will be written. With `oldRecord` each value is
 * paired with the one it replaces.
 */
function describeFields(
  record: unknown,
  resource: AdminForthResource | undefined,
  oldRecord?: Record<string, unknown>,
): ApprovalField[] {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return [];
  }

  const columnsByName = new Map((resource?.columns ?? []).map((column) => [column.name, column]));

  return Object.entries(record as Record<string, unknown>)
    .filter(([key]) => !NON_FIELD_KEYS.has(key))
    .map(([name, value]) => {
      const column = columnsByName.get(name);

      return {
        label: column?.label || humanize(name),
        from: oldRecord ? formatValue(oldRecord[name], column) : undefined,
        to: formatValue(value, column),
      };
    });
}

/**
 * The stored record an update would change, read the same way the update endpoint reads it.
 * The preview must never block the approval prompt, so a failed read only drops the old values.
 */
async function loadRecord(
  adminforth: IAdminForth,
  resource: AdminForthResource | undefined,
  recordId: unknown,
): Promise<Record<string, unknown> | undefined> {
  if (!resource) {
    return undefined;
  }

  try {
    return await adminforth.connectors[resource.dataSource].getRecordByPrimaryKey(resource, String(recordId)) ?? undefined;
  } catch (error) {
    logger.warn(`Approval preview: failed to read record ${String(recordId)} of "${resource.resourceId}": ${getErrorMessage(error)}`);
    return undefined;
  }
}

function actionLabel(resource: AdminForthResource | undefined, actionId: unknown): string {
  if (typeof actionId !== "string" || !actionId) {
    return "action";
  }

  const action = (resource?.options?.actions ?? []).find((candidate: any) => candidate.id === actionId);

  return `"${action?.name || humanize(actionId)}"`;
}

/**
 * Describe a tool call awaiting approval so an admin (not a developer) can act on it —
 * resource and column labels instead of ids, values instead of raw JSON, and for an
 * update the current value next to each new one. Tool calls it does not recognize are
 * shown as their arguments.
 */
export async function formatApprovalRequest(
  adminforth: IAdminForth,
  request: ApprovalRequest,
): Promise<ApprovalDescription> {
  const { args, toolName } = request;
  const resource = findResource(adminforth, args.resourceId);
  const label = resourceLabel(resource, args);

  switch (toolName) {
    case "create_record":
      return {
        summary: `Create a new record in ${label}`,
        fields: describeFields(args.record, resource),
      };

    case "update_record":
      return {
        summary: `Update record with id:${formatValue(args.recordId)} in ${label}`,
        fields: describeFields(args.record, resource, await loadRecord(adminforth, resource, args.recordId)),
      };

    case "delete_record":
      return {
        summary: `Delete record with id:${formatValue(args.primaryKey)} from ${label} — this cannot be undone`,
        fields: [],
      };

    case "start_custom_action":
      return {
        summary: `Run ${actionLabel(resource, args.actionId)} on record ${formatValue(args.recordId)} in ${label}`,
        fields: [],
      };

    case "start_custom_bulk_action":
    case "start_bulk_action": {
      const count = Array.isArray(args.recordIds) ? args.recordIds.length : 0;

      return {
        summary: `Run ${actionLabel(resource, args.actionId)} on ${count} record(s) in ${label}`,
        fields: [],
      };
    }

    default:
      return {
        summary: humanize(toolName),
        fields: describeFields(args, resource),
      };
  }
}
