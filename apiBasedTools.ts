import {
  AdminForthDataTypes,
  logger,
  type AdminUser,
  type HttpExtra,
  type IAdminForth,
  type IRegisteredApiSchema,
} from 'adminforth';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import { inspect } from 'util';
import YAML from 'yaml';

dayjs.extend(utc);
dayjs.extend(timezone);

type CookieItem = {
  key: string;
  value: string;
};

type ToolOverrideCallParams = Pick<ApiBasedToolCallParams, 'httpExtra' | 'inputs' | 'userTimeZone'>;

type ToolOverrideContext = {
  adminforth: IAdminForth;
  output?: unknown;
  adminUser?: AdminUser;
  httpExtra?: Partial<HttpExtra>;
  inputs?: Record<string, unknown>;
  resourceLabel?: string;
  userTimeZone?: string;
  invokeTool: (toolName: string, params?: ToolOverrideCallParams) => Promise<unknown>;
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

const DEFAULT_USER_TIME_ZONE = 'UTC';

function getInputString(inputs: Record<string, unknown> | undefined, key: string) {
  const value = inputs?.[key];

  return typeof value === 'string' && value ? value : undefined;
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
  inputs?: Record<string, unknown>;
  httpExtra?: Partial<HttpExtra>;
  userTimeZone?: string;
};

export type ApiBasedTool = {
  description?: string;
  input_schema?: unknown;
  input_schma?: unknown;
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

export function serializeUnknownError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const errorWithCause = error as Error & { cause?: unknown };
    const errorRecord = error as unknown as Record<string, unknown>;
    const serialized: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };

    if (errorWithCause.cause !== undefined) {
      serialized.cause = serializeUnknownError(errorWithCause.cause);
    }

    for (const key of Object.getOwnPropertyNames(error)) {
      if (key in serialized) {
        continue;
      }

      serialized[key] = errorRecord[key];
    }

    return serialized;
  }

  if (typeof error === 'object' && error !== null) {
    return {
      type: error.constructor?.name ?? 'Object',
      inspected: inspect(error, { depth: 6, breakLength: 120 }),
    };
  }

  return {
    type: typeof error,
    value: error,
  };
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
  httpExtra?: Partial<HttpExtra>;
  inputs?: Record<string, unknown>;
  invokeTool: (toolName: string, params?: ToolOverrideCallParams) => Promise<unknown>;
  output: unknown;
  toolName: string;
  userTimeZone?: string;
}): Promise<unknown> {
  const {
    adminforth,
    adminUser,
    httpExtra,
    inputs,
    invokeTool,
    output,
    toolName,
    userTimeZone,
  } = params;
  const sanitizedOutput = sanitizeForYaml(output);
  const override = TOOL_OVERRIDES[toolName];

  if (!override) {
    return sanitizedOutput;
  }

  for (const path of override.wipe_frontend_specific_data ?? []) {
    wipePath(sanitizedOutput, path.split('.'));
  }

  if (!override.post_process_response) {
    return sanitizedOutput;
  }

  const postProcessedOutput = await override.post_process_response({
    adminforth,
    output: sanitizedOutput,
    adminUser,
    httpExtra,
    inputs,
    userTimeZone,
    invokeTool: async (nestedToolName, nestedParams = {}) => {
      const nestedInputs = nestedParams.inputs ?? inputs;
      const nestedHttpExtra = nestedParams.httpExtra ?? httpExtra;
      const nestedUserTimeZone = nestedParams.userTimeZone ?? userTimeZone;
      const nestedOutput = await invokeTool(nestedToolName, {
        inputs: nestedInputs,
        httpExtra: nestedHttpExtra,
        userTimeZone: nestedUserTimeZone,
      });

      return applyToolOverride({
        adminforth,
        adminUser,
        httpExtra: nestedHttpExtra,
        inputs: nestedInputs,
        invokeTool,
        output: nestedOutput,
        toolName: nestedToolName,
        userTimeZone: nestedUserTimeZone,
      });
    },
  });

  return sanitizeForYaml(postProcessedOutput);
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
  httpExtra?: Partial<HttpExtra>;
  inputs?: Record<string, unknown>;
  toolName: string;
  userTimeZone?: string;
}) {
  const formatTool = TOOL_OVERRIDES[params.toolName]?.format_tool;

  return await formatTool?.({
    adminforth: params.adminforth,
    adminUser: params.adminUser,
    httpExtra: params.httpExtra,
    inputs: params.inputs,
    resourceLabel: resourceLabel(params.adminforth, params.inputs),
    userTimeZone: params.userTimeZone,
    invokeTool: async () => {
      throw new Error('Tool info formatting cannot invoke tools');
    },
  });
}

function normalizeCookies(
  cookies?: Partial<HttpExtra>['cookies'] | Record<string, string>,
): CookieItem[] {
  if (!cookies) {
    return [];
  }

  if (Array.isArray(cookies)) {
    return cookies;
  }

  return Object.entries(cookies).map(([key, value]) => ({ key, value }));
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

    if (columnType === AdminForthDataTypes.TIME) {
      const userDate = dayjs().tz(userTimeZone).format('YYYY-MM-DD');
      return dayjs.tz(`${userDate}T${value}`, userTimeZone).utc().format('HH:mm:ss');
    }
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

const METHODS_WITHOUT_REQUEST_BODY = new Set(['GET', 'HEAD']);
const HEADERS_NOT_FORWARDED_TO_API_TOOL = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function getHeaderValue(
  headers: Partial<HttpExtra>['headers'] | undefined,
  headerName: string,
) {
  const normalizedHeaderName = headerName.toLowerCase();
  const value = Object.entries(headers ?? {}).find(
    ([name]) => name.toLowerCase() === normalizedHeaderName,
  )?.[1];

  if (typeof value !== 'string') {
    return undefined;
  }

  return value.split(',')[0].trim();
}

function isAbsoluteHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function getRequestOrigin(httpExtra?: Partial<HttpExtra>) {
  const requestUrl = httpExtra?.requestUrl;

  if (requestUrl && isAbsoluteHttpUrl(requestUrl)) {
    return new URL(requestUrl).origin;
  }

  const host = getHeaderValue(httpExtra?.headers, 'x-forwarded-host')
    ?? getHeaderValue(httpExtra?.headers, 'host');

  if (!host) {
    return undefined;
  }

  const protocol = getHeaderValue(httpExtra?.headers, 'x-forwarded-proto') ?? 'http';
  return `${protocol}://${host}`;
}

function resolveOpenApiRequestUrl(params: {
  httpExtra?: Partial<HttpExtra>;
  path: string;
  toolName: string;
}) {
  if (isAbsoluteHttpUrl(params.path)) {
    return params.path;
  }

  const origin = getRequestOrigin(params.httpExtra);

  if (!origin) {
    throw new Error(
      `Tool "${params.toolName}" has relative OpenAPI path "${params.path}" but request host header is unavailable.`,
    );
  }

  return new URL(params.path, origin).toString();
}

function createToolRequestHeaders(
  httpExtra: Partial<HttpExtra> | undefined,
  userTimeZone?: string,
) {
  const headers: Record<string, string> = {};

  for (const [name, value] of Object.entries(httpExtra?.headers ?? {})) {
    const headerName = name.toLowerCase();

    if (typeof value === 'string' && !HEADERS_NOT_FORWARDED_TO_API_TOOL.has(headerName)) {
      headers[headerName] = value;
    }
  }

  headers.accept = 'application/json';
  headers['content-type'] = 'application/json';

  if (userTimeZone) {
    headers['x-timezone'] = userTimeZone;
  }

  const cookieHeader = normalizeCookies(httpExtra?.cookies)
    .map(({ key, value }) => `${key}=${value}`)
    .join('; ');

  if (cookieHeader && !headers.cookie) {
    headers.cookie = cookieHeader;
  }

  return headers;
}

function appendInputsToQueryString(url: string, inputs: Record<string, unknown>) {
  const nextUrl = new URL(url);

  for (const [key, value] of Object.entries(inputs)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        nextUrl.searchParams.append(
          key,
          typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item),
        );
      }
      continue;
    }

    nextUrl.searchParams.set(
      key,
      typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value),
    );
  }

  return nextUrl.toString();
}

async function parseOpenApiToolResponse(response: Response) {
  const responseText = await response.text();
  const payload = responseText && response.headers.get('content-type')?.includes('application/json')
    ? JSON.parse(responseText)
    : responseText;

  if (response.ok) {
    return responseText ? payload : { status: response.status };
  }

  return {
    error: 'HTTP_ERROR',
    status: response.status,
    statusText: response.statusText,
    response: payload,
  };
}

async function callOpenApiSchema(params: {
  adminforth: IAdminForth;
  httpExtra?: Partial<HttpExtra>;
  inputs?: Record<string, unknown>;
  schema: IRegisteredApiSchema;
  toolName: string;
  userTimeZone?: string;
}) {
  const { adminforth, httpExtra, inputs, schema, toolName, userTimeZone } = params;
  const method = schema.method.toUpperCase();
  const body = normalizeDateTimeInputsToUtc(
    (inputs ?? httpExtra?.body ?? {}) as Record<string, unknown>,
    adminforth,
    userTimeZone,
  );
  const requestUrl = resolveOpenApiRequestUrl({
    httpExtra,
    path: schema.path,
    toolName,
  });
  const hasRequestBody = !METHODS_WITHOUT_REQUEST_BODY.has(method);
  const response = await fetch(hasRequestBody ? requestUrl : appendInputsToQueryString(requestUrl, body), {
    method,
    headers: createToolRequestHeaders(httpExtra, userTimeZone),
    body: hasRequestBody ? JSON.stringify(body) : undefined,
  });

  return parseOpenApiToolResponse(response);
}

export function prepareApiBasedTools(adminforth: IAdminForth): Record<string, ApiBasedTool> {
  const apiBasedTools: Record<string, ApiBasedTool> = {};
  const openApiSchemas = adminforth.openApi.registeredSchemas.filter(
    (schema) => schema.request_schema || schema.response_schema,
  );
  const openApiSchemasByToolName = new Map<string, IRegisteredApiSchema>();

  for (const schema of openApiSchemas) {
    const toolName = openApiSchemaPathToToolName(schema.path, adminforth);
    openApiSchemasByToolName.set(toolName, schema);
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
      input_schma: schema.request_schema,
      output_schema: schema.response_schema,
      call: async ({ adminUser, adminuser, inputs, httpExtra, userTimeZone } = {}) => {
        const invokeTool = async (
          nextToolName: string,
          nextParams: ToolOverrideCallParams = {},
        ) => {
          const nextSchema = openApiSchemasByToolName.get(nextToolName);

          if (!nextSchema) {
            throw new Error(`Tool ${nextToolName} is not registered in OpenAPI`);
          }

          return callOpenApiSchema({
            adminforth,
            schema: nextSchema,
            toolName: nextToolName,
            inputs: nextParams.inputs,
            httpExtra: nextParams.httpExtra,
            userTimeZone: nextParams.userTimeZone,
          });
        };

        const output = await invokeTool(toolName, {
          inputs,
          httpExtra,
          userTimeZone,
        });

        const processedOutput = await applyToolOverride({
          adminforth,
          adminUser: adminUser ?? adminuser,
          httpExtra,
          inputs,
          invokeTool,
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
    input_schma: tool.input_schma,
    output_schema: tool.output_schema,
    call: '[Function]',
  };
}
