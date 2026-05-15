import {
  AdminForthDataTypes,
  logger,
  type AdminUser,
  type IAdminForth,
  type IAdminForthHttpResponse,
  type IRegisteredApiSchema,
} from 'adminforth';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import YAML from 'yaml';

dayjs.extend(utc);
dayjs.extend(timezone);


type ToolOverrideContext = {
  adminforth: IAdminForth;
  output?: unknown;
  adminUser?: AdminUser;
  inputs?: Record<string, unknown>;
  resourceLabel?: string;
  userTimeZone?: string;
};

type ToolOverride = {
  wipe_frontend_specific_data?: readonly string[];
  format_tool?: (params: ToolOverrideContext) => Promise<string> | string;
  post_process_response?: (params: ToolOverrideContext) => Promise<unknown> | unknown;
};

type GetResourceDataToolResponse = {
  data: Array<Record<string, unknown>>;
  total?: number;
  options?: Record<string, unknown>;
};

type DateTimeColumnType = AdminForthDataTypes.DATETIME | AdminForthDataTypes.TIME;
type RegisteredApiToolSchema = IRegisteredApiSchema & {
  handler: (input: unknown) => void | Promise<unknown>;
};

const DEFAULT_USER_TIME_ZONE = 'UTC';

function hasRegisteredApiToolHandler(schema: IRegisteredApiSchema): schema is RegisteredApiToolSchema {
  return typeof (schema as { handler?: unknown }).handler === 'function';
}

function getInputString(inputs: Record<string, unknown> | undefined, key: string) {
  const value = inputs?.[key];

  return typeof value === 'string' && value ? value : undefined;
}

function isHiddenResourceCall(
  hiddenResourceIds: ReadonlySet<string>,
  inputs: Record<string, unknown> | undefined,
) {
  const resourceId = getInputString(inputs, 'resourceId');

  return resourceId ? hiddenResourceIds.has(resourceId) : false;
}

function getInputArrayLength(inputs: Record<string, unknown> | undefined, key: string) {
  const value = inputs?.[key];

  return Array.isArray(value) ? value.length : undefined;
}

function resourceLabel(adminforth: IAdminForth, inputs: Record<string, unknown> | undefined) {
  const resourceId = getInputString(inputs, 'resourceId');
  const resource = adminforth.config.resources.find((res) => res.resourceId === resourceId);

  return resource?.label ?? resourceId ?? 'resource';
}

function getDataPrefix(inputs: Record<string, unknown> | undefined) {
  const offset = typeof inputs?.offset === 'number' ? inputs.offset : undefined;
  const limit = typeof inputs?.limit === 'number' ? inputs.limit : undefined;

  if (offset !== undefined && limit !== undefined) {
    return `${offset}-${offset + limit} `;
  }

  return limit === undefined ? '' : `${limit} `;
}

function actionText(inputs: Record<string, unknown> | undefined) {
  const actionId = getInputString(inputs, 'actionId');

  return actionId ? ` action ${actionId}` : ' action';
}

const TOOL_OVERRIDES: Record<string, ToolOverride> = {
  get_resource: {
    wipe_frontend_specific_data: [
      'resource.columns[].filterOptions',
      'resource.columns[].components',
      'resource.options.actions[].customComponent',
      'resource.options.pageInjections',
    ],
    format_tool: ({ resourceLabel }) => `Get ${resourceLabel} resource`,
  },
  get_resource_data: {
    format_tool: ({ inputs, resourceLabel }) => (
      `Get ${getDataPrefix(inputs)}${resourceLabel}`
    ),
    post_process_response: async ({ adminforth, output, inputs, userTimeZone }) => {
      if (hasToolError(output)) {
        return output;
      }

      const dateTimeColumnNames = getDateTimeColumnNames(adminforth, inputs);

      if (dateTimeColumnNames.length === 0) {
        return output;
      }

      if (!hasGetResourceDataRows(output)) {
        logger.warn(
          `Skipping datetime formatting for get_resource_data because response.data is not an array for resource ${getInputString(inputs, 'resourceId') ?? 'unknown'}`,
        );
        return output;
      }

      const localizedTimeZone = userTimeZone ?? DEFAULT_USER_TIME_ZONE;
      formatDateTimeColumns(output.data, dateTimeColumnNames, localizedTimeZone);

      return output;
    },
  },
  aggregate: {
    format_tool: ({ resourceLabel }) => `Aggregate ${resourceLabel}`,
  },
  start_custom_action: {
    format_tool: ({ inputs, resourceLabel }) => `Run ${resourceLabel}${actionText(inputs)}`,
  },
  start_custom_bulk_action: {
    format_tool: ({ inputs, resourceLabel }) => {
      const recordCount = getInputArrayLength(inputs, 'recordIds');
      const recordsText = recordCount === undefined ? '' : ` for ${recordCount} records`;

      return `Run ${resourceLabel}${actionText(inputs)}${recordsText}`;
    },
  },
  start_bulk_action: {
    format_tool: ({ inputs, resourceLabel }) => {
      const recordCount = getInputArrayLength(inputs, 'recordIds');
      const recordsText = recordCount === undefined ? '' : ` for ${recordCount} records`;

      return `Run ${resourceLabel}${actionText(inputs)}${recordsText}`;
    },
  },
  create_record: {
    format_tool: ({ resourceLabel }) => `Create ${resourceLabel}`,
  },
  update_record: {
    format_tool: ({ resourceLabel }) => `Update ${resourceLabel}`,
  },
  delete_record: {
    format_tool: ({ resourceLabel }) => `Delete ${resourceLabel}`,
  },
};

export type ApiBasedToolCallParams = {
  adminUser?: AdminUser;
  adminuser?: AdminUser;
  abortSignal?: AbortSignal;
  inputs?: Record<string, unknown>;
  userTimeZone?: string;
  acceptLanguage?: string;
};

export type ApiBasedTool = {
  description?: string;
  input_schema?: unknown;
  output_schema?: unknown;
  call: (params?: ApiBasedToolCallParams) => Promise<string>;
};

function sanitizeForYaml(
  value: unknown,
): unknown {
  const traversalStack: object[] = [];
  const serialized = JSON.stringify(value, function (this: unknown, _key: string, nestedValue: unknown) {
    if (typeof nestedValue === 'function' || typeof nestedValue === 'symbol' || nestedValue === undefined) {
      return undefined;
    }

    if (typeof nestedValue === 'bigint') {
      return nestedValue.toString();
    }

    if (typeof nestedValue !== 'object' || nestedValue === null) {
      return nestedValue;
    }

    if (nestedValue instanceof Map) {
      return Object.fromEntries(nestedValue);
    }

    if (nestedValue instanceof Set) {
      return Array.from(nestedValue.values());
    }

    while (traversalStack.length > 0 && traversalStack[traversalStack.length - 1] !== this) {
      traversalStack.pop();
    }

    if (traversalStack.includes(nestedValue)) {
      return undefined;
    }

    traversalStack.push(nestedValue);
    return nestedValue;
  });

  if (serialized === undefined) {
    return null;
  }

  return JSON.parse(serialized);
}

function wipePath(target: unknown, pathParts: string[]): void {
  if (!target || typeof target !== 'object' || pathParts.length === 0) {
    return;
  }

  const [currentPart, ...rest] = pathParts;
  const isArrayTraversal = currentPart.endsWith('[]');
  const key = isArrayTraversal ? currentPart.slice(0, -2) : currentPart;
  const targetRecord = target as Record<string, unknown>;

  if (!(key in targetRecord)) {
    return;
  }

  if (rest.length === 0) {
    delete targetRecord[key];
    return;
  }

  const nextValue = targetRecord[key];

  if (isArrayTraversal) {
    if (!Array.isArray(nextValue)) {
      return;
    }

    for (const item of nextValue) {
      wipePath(item, rest);
    }

    return;
  }

  wipePath(nextValue, rest);
}

function hasToolError(output: unknown): output is { error: unknown } {
  return typeof output === 'object' && output !== null && 'error' in output;
}

function hasGetResourceDataRows(output: unknown): output is GetResourceDataToolResponse {
  if (typeof output !== 'object' || output === null || !('data' in output)) {
    return false;
  }

  return Array.isArray((output as { data?: unknown }).data);
}

function getDateTimeColumnNames(
  adminforth: IAdminForth,
  inputs: Record<string, unknown> | undefined,
): string[] {
  const resourceId = getInputString(inputs, 'resourceId');
  const resource = adminforth.config.resources.find((res) => res.resourceId === resourceId);

  if (!resource) {
    return [];
  }

  return resource.dataSourceColumns
    .filter((column) => column.type === AdminForthDataTypes.DATETIME)
    .map((column) => column.name);
}

function formatGmtOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffsetMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absoluteOffsetMinutes / 60);
  const minutes = absoluteOffsetMinutes % 60;

  if (minutes === 0) {
    return `GMT${sign}${hours}`;
  }

  return `GMT${sign}${hours}:${String(minutes).padStart(2, '0')}`;
}

function formatDateTimeValue(value: string, userTimeZone: string): string {
  const localizedValue = dayjs.utc(value).tz(userTimeZone);
  return `${localizedValue.format('DD MMM YYYY, HH:mm:ss.SSS')} (${formatGmtOffset(localizedValue.utcOffset())})`;
}

function formatDateTimeColumns(
  rows: Array<Record<string, unknown>>,
  dateTimeColumnNames: string[],
  userTimeZone: string,
): void {
  for (const row of rows) {
    for (const columnName of dateTimeColumnNames) {
      const value = row[columnName];

      if (typeof value === 'string' && value) {
        row[columnName] = formatDateTimeValue(value, userTimeZone);
      }
    }
  }
}

async function applyToolOverride(params: {
  adminforth: IAdminForth;
  adminUser?: AdminUser;
  inputs?: Record<string, unknown>;
  output: unknown;
  toolName: string;
  userTimeZone?: string;
}): Promise<unknown> {
  const { adminforth, adminUser, inputs, output, toolName, userTimeZone } = params;
  const sanitizedOutput = sanitizeForYaml(output);
  const override = TOOL_OVERRIDES[toolName];

  if (!override) {
    return sanitizedOutput;
  }

  for (const path of override.wipe_frontend_specific_data ?? []) {
    wipePath(sanitizedOutput, path.split('.'));
  }

  return override.post_process_response
    ? sanitizeForYaml(await override.post_process_response({
        adminforth,
        adminUser,
        output: sanitizedOutput,
        inputs,
        userTimeZone,
      }))
    : sanitizedOutput;
}

function endpointPathToToolName(path: string) {
  return path
    .replace(/^\/+/, '')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function stripAdminApiPrefix(path: string, adminforth: IAdminForth) {
  const configuredBaseUrl = adminforth.config.baseUrl || '';
  const normalizedBaseUrl = configuredBaseUrl.endsWith('/')
    ? configuredBaseUrl.slice(0, -1)
    : configuredBaseUrl;
  const apiPrefix = `${normalizedBaseUrl}/adminapi/v1`;

  if (path.startsWith(apiPrefix)) {
    const strippedPath = path.slice(apiPrefix.length);
    return strippedPath.startsWith('/') ? strippedPath : `/${strippedPath}`;
  }

  return path;
}

function openApiSchemaPathToToolName(path: string, adminforth: IAdminForth) {
  return endpointPathToToolName(stripAdminApiPrefix(path, adminforth));
}

function formatLogNameList(names: string[]) {
  return names.length ? names.join(', ') : '(none)';
}

export async function formatApiBasedToolCall(params: {
  adminforth: IAdminForth;
  adminUser?: AdminUser;
  inputs?: Record<string, unknown>;
  toolName: string;
  userTimeZone?: string;
}) {
  return await TOOL_OVERRIDES[params.toolName]?.format_tool?.({
    adminforth: params.adminforth,
    adminUser: params.adminUser,
    inputs: params.inputs,
    resourceLabel: resourceLabel(params.adminforth, params.inputs),
    userTimeZone: params.userTimeZone,
  });
}

function normalizeDateTimeInputsToUtc(
  body: Record<string, unknown>,
  adminforth: IAdminForth,
  userTimeZone?: string,
): Record<string, unknown> {
  if (!userTimeZone || typeof body.resourceId !== 'string') {
    return body;
  }

  const resource = adminforth.config.resources.find((res) => res.resourceId === body.resourceId);

  if (!resource) {
    return body;
  }

  const columnsByName = new Map(resource.dataSourceColumns.map((column) => [column.name, column]));

  const normalizeColumnValue = (
    value: unknown,
    columnType: DateTimeColumnType,
  ): unknown => {
    if (Array.isArray(value)) {
      return value.map((item) => normalizeColumnValue(item, columnType));
    }

    if (typeof value !== 'string' || value === '') {
      return value;
    }

    if (columnType === AdminForthDataTypes.DATETIME) {
      return dayjs.tz(value, userTimeZone).utc().toISOString();
    }

    const userDate = dayjs().tz(userTimeZone).format('YYYY-MM-DD');
    return dayjs.tz(`${userDate}T${value}`, userTimeZone).utc().format('HH:mm:ss');
  };

  const normalizeValue = (value: unknown, key?: string): unknown => {
    const column = key ? columnsByName.get(key) : undefined;

    if (column?.type === AdminForthDataTypes.DATETIME || column?.type === AdminForthDataTypes.TIME) {
      return normalizeColumnValue(value, column.type);
    }

    if (Array.isArray(value)) {
      return value.map((item) => normalizeValue(item));
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    const record = value as Record<string, unknown>;
    const filterColumn = typeof record.field === 'string' ? columnsByName.get(record.field) : undefined;

    if (
      'value' in record &&
      (filterColumn?.type === AdminForthDataTypes.DATETIME || filterColumn?.type === AdminForthDataTypes.TIME)
    ) {
      return {
        ...record,
        value: normalizeColumnValue(record.value, filterColumn.type),
      };
    }

    return Object.fromEntries(
      Object.entries(record).map(([nestedKey, nestedValue]) => [
        nestedKey,
        normalizeValue(nestedValue, nestedKey),
      ]),
    );
  };

  return normalizeValue(body) as Record<string, unknown>;
}

const METHODS_WITHOUT_REQUEST_BODY = new Set<string>(['GET', 'HEAD']);

function createDirectToolResponse(): IAdminForthHttpResponse & {
  headers: Array<[string, string]>;
  status: number;
  message?: string;
} {
  const headers: Array<[string, string]> = [];

  return {
    headers,
    status: 200,
    setHeader(name, value) {
      headers.push([name, value]);
    },
    setStatus(code, message) {
      this.status = code;
      this.message = message;
    },
    blobStream() {
      throw new Error('blobStream is not available for API-based agent tools');
    },
  };
}

function validationErrorResponse(
  error: 'REQUEST_VALIDATION_FAILED' | 'RESPONSE_VALIDATION_FAILED',
  details: unknown,
) {
  return {
    error,
    details,
  };
}

async function callOpenApiSchema(params: {
  adminforth: IAdminForth;
  adminUser?: AdminUser;
  abortSignal?: AbortSignal;
  inputs?: Record<string, unknown>;
  schema: RegisteredApiToolSchema;
  toolName: string;
  userTimeZone?: string;
  acceptLanguage?: string;
}) {
  const { adminforth, adminUser, abortSignal, inputs, schema, toolName, userTimeZone, acceptLanguage } = params;
  const method = schema.method.toUpperCase();
  const normalizedInputs = normalizeDateTimeInputsToUtc(
    (inputs ?? {}) as Record<string, unknown>,
    adminforth,
    userTimeZone,
  );
  const hasRequestBody = !METHODS_WITHOUT_REQUEST_BODY.has(method);
  const body = hasRequestBody ? normalizedInputs : {};
  const query = hasRequestBody ? {} : normalizedInputs;
  const requestValidation = adminforth.openApi.validateRequestSchema(schema, body);

  if (!requestValidation.valid) {
    return validationErrorResponse('REQUEST_VALIDATION_FAILED', requestValidation.errors);
  }

  const response = createDirectToolResponse();
  logger.info(`Calling OpenAPI tool "${toolName}" with direct handler`);
  const lang = acceptLanguage ?? "en";
  const tr = (
    msg: string,
    category: string,
    trParams: unknown,
    pluralizationNumber?: number,
  ) => adminforth.tr(msg, category, lang, trParams, pluralizationNumber);
  const output = await schema.handler({
    body,
    query,
    headers: {},
    cookies: [],
    adminUser,
    response,
    requestUrl: schema.path,
    abortSignal: abortSignal ?? new AbortController().signal,
    _raw_express_req: undefined as never,
    _raw_express_res: undefined as never,
    tr,
  });

  if (response.message) {
    return response.status >= 400
      ? {
        error: 'HANDLER_ERROR',
        status: response.status,
        response: response.message,
      }
      : response.message;
  }

  if (output === null) {
    return { status: response.status };
  }

  const responseValidation = adminforth.openApi.validateResponseSchema(schema, output);

  if (!responseValidation.valid) {
    return validationErrorResponse('RESPONSE_VALIDATION_FAILED', responseValidation.errors);
  }

  return response.status >= 400
    ? {
      error: 'HANDLER_ERROR',
      status: response.status,
      response: output,
    }
    : output;
}

export function prepareApiBasedTools(
  adminforth: IAdminForth,
  hiddenResourceIds: Iterable<string> = [],
): Record<string, ApiBasedTool> {
  const apiBasedTools: Record<string, ApiBasedTool> = {};
  const openApiSchemas = adminforth.openApi.registeredSchemas;
  const openApiSchemasByToolName = new Map<string, RegisteredApiToolSchema>();
  const hiddenResourceIdSet = new Set(hiddenResourceIds);

  for (const schema of openApiSchemas) {
    const toolName = openApiSchemaPathToToolName(schema.path, adminforth);
    if (hasRegisteredApiToolHandler(schema)) {
      openApiSchemasByToolName.set(toolName, schema);
    }
  }

  logger.info(
    `AdminForth Agent OpenAPI APIs: ${formatLogNameList(
      adminforth.openApi.registeredSchemas.map((schema) => openApiSchemaPathToToolName(schema.path, adminforth)),
    )}`,
  );
  logger.info(
    `AdminForth Agent OpenAPI tools connected: ${formatLogNameList([...openApiSchemasByToolName.keys()])}`,
  );

  for (const [toolName, schema] of openApiSchemasByToolName.entries()) {
    apiBasedTools[toolName] = {
      description: schema.description,
      input_schema: schema.request_schema,
      output_schema: schema.response_schema,
      call: async ({ adminUser, adminuser, abortSignal, inputs, userTimeZone, acceptLanguage } = {}) => {
        if (isHiddenResourceCall(hiddenResourceIdSet, inputs)) {
          return YAML.stringify({
            error: 'RESOURCE_NOT_AVAILABLE',
            message: 'This resource is not available to the agent.',
          });
        }

        const output = await callOpenApiSchema({
          adminforth,
          adminUser: adminUser ?? adminuser,
          abortSignal,
          schema,
          toolName,
          inputs,
          userTimeZone,
          acceptLanguage,
        });

        const processedOutput = await applyToolOverride({
          adminforth,
          adminUser: adminUser ?? adminuser,
          inputs,
          output,
          toolName,
          userTimeZone,
        });

        return YAML.stringify(processedOutput);
      },
    };
  }

  return apiBasedTools;
}

export function serializeApiBasedTool(tool: ApiBasedTool | undefined) {
  if (!tool) {
    return null;
  }

  return {
    description: tool.description,
    input_schema: tool.input_schema,
    output_schema: tool.output_schema,
    call: '[Function]',
  };
}
