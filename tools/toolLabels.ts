import type { IAdminForth } from "adminforth";

type ToolInputs = Record<string, unknown>;
type LabelContext = { inputs: ToolInputs; resourceLabel: string };

function getInputString(inputs: ToolInputs, key: string) {
  const value = inputs[key];

  return typeof value === "string" && value ? value : undefined;
}

function getInputArrayLength(inputs: ToolInputs, key: string) {
  const value = inputs[key];

  return Array.isArray(value) ? value.length : undefined;
}

function resourceLabel(adminforth: IAdminForth, inputs: ToolInputs) {
  const resourceId = getInputString(inputs, "resourceId");
  const resource = adminforth.config.resources.find((res) => res.resourceId === resourceId);

  return resource?.label ?? resourceId ?? "resource";
}

function getDataPrefix(inputs: ToolInputs) {
  const offset = typeof inputs.offset === "number" ? inputs.offset : undefined;
  const limit = typeof inputs.limit === "number" ? inputs.limit : undefined;

  if (offset !== undefined && limit !== undefined) {
    return `${offset}-${offset + limit} `;
  }

  return limit === undefined ? "" : `${limit} `;
}

function actionText(inputs: ToolInputs) {
  const actionId = getInputString(inputs, "actionId");

  return actionId ? ` action ${actionId}` : " action";
}

function bulkActionLabel({ inputs, resourceLabel }: LabelContext) {
  const recordCount = getInputArrayLength(inputs, "recordIds");
  const recordsText = recordCount === undefined ? "" : ` for ${recordCount} records`;

  return `Run ${resourceLabel}${actionText(inputs)}${recordsText}`;
}

const TOOL_LABELS: Record<string, (context: LabelContext) => string> = {
  fetch_skill: ({ inputs }) => `Load ${(inputs.skillName as string).split("-").join(" ")} skill`,
  fetch_tool_schema: ({ inputs }) => `Load ${(inputs.toolName as string).split("_").join(" ")} tool`,
  get_resource: ({ resourceLabel }) => `Get ${resourceLabel} resource`,
  get_resource_data: ({ inputs, resourceLabel }) => `Get ${getDataPrefix(inputs)}${resourceLabel}`,
  aggregate: ({ resourceLabel }) => `Aggregate ${resourceLabel}`,
  start_custom_action: ({ inputs, resourceLabel }) => `Run ${resourceLabel}${actionText(inputs)}`,
  start_custom_bulk_action: bulkActionLabel,
  start_bulk_action: bulkActionLabel,
  create_record: ({ resourceLabel }) => `Create ${resourceLabel}`,
  update_record: ({ resourceLabel }) => `Update ${resourceLabel}`,
  delete_record: ({ resourceLabel }) => `Delete ${resourceLabel}`,
};

/** Human-readable label of a tool call for the processing timeline; undefined for tools without one. */
export function formatToolCall(adminforth: IAdminForth, toolName: string, inputs: ToolInputs) {
  return TOOL_LABELS[toolName]?.({ inputs, resourceLabel: resourceLabel(adminforth, inputs) });
}
