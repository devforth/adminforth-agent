import {
  AdminForthDataTypes,
  type AdminUser,
  type HttpExtra,
  type IAdminForth,
  type IAdminForthHttpResponse,
  type IHttpServer,
} from 'adminforth';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import { PassThrough } from 'stream';
import { inspect } from 'util';
import YAML from 'yaml';

dayjs.extend(utc);
dayjs.extend(timezone);

type CookieItem = {
  key: string;
  value: string;
};

type CapturedEndpointHandlerInput = {
  body: Record<string, unknown>;
  adminUser?: AdminUser;
  query: Record<string, string>;
  headers: Record<string, any>;
  cookies: CookieItem[];
  response: IAdminForthHttpResponse;
  requestUrl: string;
  abortSignal: AbortSignal;
  _raw_express_req: any;
  _raw_express_res: any;
  tr: (
    msg: string,
    category: string,
    params: any,
    pluralizationNumber?: number,
  ) => Promise<string>;
};

type EndpointWithSchemas = {
  method: string;
  noAuth?: boolean;
  path: string;
  description?: string;
  request_schema?: unknown;
  response_schema?: unknown;
  responce_schema?: unknown;
  handler: (input: CapturedEndpointHandlerInput) => Promise<any> | any;
};

type CapturedEndpoint = EndpointWithSchemas & {
  normalizedResponseSchema?: unknown;
};

type ToolHttpResponse = IAdminForthHttpResponse & {
  headers: Array<[string, string]>;
  jsonPayload?: unknown;
  status: number;
  message?: string;
};

type ToolOverrideCallParams = Pick<ApiBasedToolCallParams, 'httpExtra' | 'inputs' | 'userTimeZone'>;

type ToolOverrideContext = {
  output: unknown;
  adminUser?: AdminUser;
  httpExtra?: Partial<HttpExtra>;
  inputs?: Record<string, unknown>;
  userTimeZone?: string;
  invokeTool: (toolName: string, params?: ToolOverrideCallParams) => Promise<unknown>;
};

type ToolOverride = {
  wipe_frontend_specific_data?: readonly string[];
  post_process_response?: (params: ToolOverrideContext) => Promise<unknown> | unknown;
};

type GetResourceToolResponse = {
  resource: {
    columns: Array<{
      name: string;
      type?: string;
    }>;
  };
};

type GetResourceDataToolResponse = {
  data: Array<Record<string, unknown>>;
  total?: number;
  options?: Record<string, unknown>;
};

const DEFAULT_USER_TIME_ZONE = 'UTC';

const TOOL_OVERRIDES: Record<string, ToolOverride> = {
  get_resource: {
    wipe_frontend_specific_data: [
      'resource.columns[].filterOptions',
      'resource.columns[].components',
      'resource.options.actions[].customComponent',
      'resource.options.pageInjections',
    ],
  },
  get_resource_data: {
    post_process_response: async ({ output, inputs, invokeTool, userTimeZone }) => {
      if (hasToolError(output)) {
        return output;
      }

      const resourceId = inputs?.resourceId as string;
      const getResourceOutput = await invokeTool('get_resource', {
        inputs: { resourceId },
      });
      const dateTimeColumnNames = getDateTimeColumnNames(getResourceOutput);

      if (dateTimeColumnNames.length === 0) {
        return output;
      }

      const localizedTimeZone = userTimeZone ?? DEFAULT_USER_TIME_ZONE;
      const response = output as GetResourceDataToolResponse;
      formatDateTimeColumns(response.data, dateTimeColumnNames, localizedTimeZone);

      return response;
    },
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

function getDateTimeColumnNames(output: unknown): string[] {
  const resource = (output as GetResourceToolResponse).resource;

  return resource.columns
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
  capturedEndpointsByToolName: Record<string, CapturedEndpoint>;
  httpExtra?: Partial<HttpExtra>;
  inputs?: Record<string, unknown>;
  output: unknown;
  toolName: string;
  userTimeZone?: string;
}): Promise<unknown> {
  const {
    adminforth,
    adminUser,
    capturedEndpointsByToolName,
    httpExtra,
    inputs,
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
    output: sanitizedOutput,
    adminUser,
    httpExtra,
    inputs,
    userTimeZone,
    invokeTool: async (nestedToolName, nestedParams = {}) => {
      const nestedEndpoint = capturedEndpointsByToolName[nestedToolName];

      if (!nestedEndpoint) {
        throw new Error(`Tool ${nestedToolName} is not registered`);
      }

      const nestedInputs = nestedParams.inputs ?? inputs;
      const nestedHttpExtra = nestedParams.httpExtra ?? httpExtra;
      const nestedUserTimeZone = nestedParams.userTimeZone ?? userTimeZone;
      const nestedOutput = await callCapturedEndpoint({
        adminforth,
        endpoint: nestedEndpoint,
        adminUser,
        inputs: nestedInputs,
        httpExtra: nestedHttpExtra,
      });

      return applyToolOverride({
        adminforth,
        adminUser,
        capturedEndpointsByToolName,
        httpExtra: nestedHttpExtra,
        inputs: nestedInputs,
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

function normalizeCookies(cookies?: Partial<HttpExtra>['cookies']): CookieItem[] {
  if (!cookies) {
    return [];
  }

  if (Array.isArray(cookies)) {
    return cookies;
  }

  return Object.entries(cookies).map(([key, value]) => ({ key, value }));
}

function createToolResponse(baseResponse?: IAdminForthHttpResponse): ToolHttpResponse {
  return {
    headers: [],
    status: 200,
    message: undefined,
    setHeader(name, value) {
      this.headers.push([name, value]);
      baseResponse?.setHeader(name, value);
    },
    setStatus(code, message) {
      this.status = code;
      this.message = message;
      baseResponse?.setStatus(code, message);
    },
    blobStream() {
      return baseResponse?.blobStream() ?? new PassThrough();
    },
  };
}

function createRawExpressRequest(params: {
  adminUser?: AdminUser;
  body: Record<string, unknown>;
  cookies: CookieItem[];
  headers: Record<string, any>;
  method: string;
  query: Record<string, string>;
  requestUrl: string;
}) {
  const cookieHeader = params.cookies
    .map(({ key, value }) => `${key}=${value}`)
    .join('; ');

  return {
    adminUser: params.adminUser,
    body: params.body,
    destroyed: false,
    headers: {
      ...params.headers,
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    method: params.method.toUpperCase(),
    on: () => undefined,
    query: params.query,
    url: params.requestUrl,
  };
}

function createRawExpressResponse(response: ToolHttpResponse) {
  const rawResponse = {
    destroyed: false,
    on: () => undefined,
    setHeader(name: string, value: string) {
      response.setHeader(name, value);
      return rawResponse;
    },
    status(code: number) {
      response.status = code;
      return rawResponse;
    },
    send(message: string) {
      response.message = message;
      return rawResponse;
    },
    json(payload: unknown) {
      response.jsonPayload = payload;
      response.message = JSON.stringify(payload);
      return rawResponse;
    },
    write: () => true,
    writeHead: () => rawResponse,
    writableEnded: false,
    end: () => rawResponse,
  };

  return rawResponse;
}

async function callCapturedEndpoint(params: {
  adminforth: IAdminForth;
  adminUser?: AdminUser;
  endpoint: CapturedEndpoint;
  httpExtra?: Partial<HttpExtra>;
  inputs?: Record<string, unknown>;
}) {
  const { adminforth, adminUser, endpoint, httpExtra, inputs } = params;
  const response = createToolResponse(httpExtra?.response);
  const headers = {
    'content-type': 'application/json',
    ...(httpExtra?.headers ?? {}),
  };
  const body = (inputs ?? httpExtra?.body ?? {}) as Record<string, unknown>;
  const query = httpExtra?.query ?? {};
  const cookies = normalizeCookies(httpExtra?.cookies);
  const requestUrl = httpExtra?.requestUrl ?? `${adminforth.config.baseUrl}/adminapi/v1${endpoint.path}`;
  const abortController = new AbortController();
  const rawRequest = createRawExpressRequest({
    adminUser,
    body,
    cookies,
    headers,
    method: endpoint.method,
    query,
    requestUrl,
  });
  const rawResponse = createRawExpressResponse(response);
  const acceptLanguage = headers['accept-language'];
  const tr = (
    msg: string,
    category: string = 'default',
    translationParams: any,
    pluralizationNumber?: number,
  ) => adminforth.tr(msg, category, acceptLanguage, translationParams, pluralizationNumber);

  const output = await endpoint.handler({
    body,
    adminUser,
    query,
    headers,
    cookies,
    response,
    requestUrl,
    abortSignal: abortController.signal,
    _raw_express_req: rawRequest,
    _raw_express_res: rawResponse,
    tr,
  });

  if (output !== undefined && output !== null) {
    return output;
  }

  if (response.jsonPayload !== undefined) {
    return response.jsonPayload;
  }

  if (response.message !== undefined) {
    return response.message;
  }

  return {
    headers: response.headers,
    status: response.status,
  };
}

export function prepareApiBasedTools(adminforth: IAdminForth): Record<string, ApiBasedTool> {
  const capturedEndpoints: CapturedEndpoint[] = [];

  const captureServer: IHttpServer = {
    setupSpaServer() {},
    endpoint: ((options: EndpointWithSchemas) => {
      const normalizedResponseSchema = options.response_schema ?? options.responce_schema;
      if (!options.request_schema && !normalizedResponseSchema) {
        return;
      }

      capturedEndpoints.push({
        ...options,
        response_schema: normalizedResponseSchema,
        normalizedResponseSchema,
      });
    }) as IHttpServer['endpoint'],
  };

  adminforth.setupEndpoints(captureServer);

  const apiBasedTools: Record<string, ApiBasedTool> = {};
  const capturedEndpointsByToolName = Object.fromEntries(
    capturedEndpoints.map((endpoint) => [endpointPathToToolName(endpoint.path), endpoint]),
  );

  for (const endpoint of capturedEndpoints) {
    const toolName = endpointPathToToolName(endpoint.path);
    apiBasedTools[toolName] = {
      description: endpoint.description,
      input_schema: endpoint.request_schema,
      input_schma: endpoint.request_schema,
      output_schema: endpoint.normalizedResponseSchema,
      call: async ({ adminUser, adminuser, inputs, httpExtra, userTimeZone } = {}) => {
        const output = await callCapturedEndpoint({
          adminforth,
          endpoint,
          adminUser: adminUser ?? adminuser,
          inputs,
          httpExtra,
        });

        const processedOutput = await applyToolOverride({
          adminforth,
          adminUser: adminUser ?? adminuser,
          capturedEndpointsByToolName,
          httpExtra,
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
    input_schma: tool.input_schma,
    output_schema: tool.output_schema,
    call: '[Function]',
  };
}