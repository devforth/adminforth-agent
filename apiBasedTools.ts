import type {
  AdminUser,
  HttpExtra,
  IAdminForth,
  IAdminForthHttpResponse,
  IHttpServer,
} from 'adminforth';
import { PassThrough } from 'stream';
import { inspect } from 'util';
import YAML from 'yaml';

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
  status: number;
  message?: string;
};

export type ApiBasedToolCallParams = {
  adminUser?: AdminUser;
  adminuser?: AdminUser;
  inputs?: Record<string, unknown>;
  httpExtra?: Partial<HttpExtra>;
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
  path: string = '$',
  seen: WeakMap<object, string> = new WeakMap(),
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'function') {
    const fn = value as Function;
    return fn.name ? `[Function ${fn.name}]` : '[Function]';
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'symbol') {
    return value.toString();
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof RegExp) {
    return value.toString();
  }

  if (value instanceof Map) {
    return Array.from(value.entries()).map(([entryKey, entryValue], index) => ([
      sanitizeForYaml(entryKey, `${path}.mapKey[${index}]`, seen),
      sanitizeForYaml(entryValue, `${path}.mapValue[${index}]`, seen),
    ]));
  }

  if (value instanceof Set) {
    return Array.from(value.values()).map((item, index) => (
      sanitizeForYaml(item, `${path}[${index}]`, seen)
    ));
  }

  const objectValue = value as Record<string, unknown>;

  if (seen.has(objectValue)) {
    return `[Circular -> ${seen.get(objectValue)}]`;
  }

  seen.set(objectValue, path);

  if (Array.isArray(objectValue)) {
    return objectValue.map((item, index) => sanitizeForYaml(item, `${path}[${index}]`, seen));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(objectValue)) {
    sanitized[key] = sanitizeForYaml(nestedValue, `${path}.${key}`, seen);
  }

  return sanitized;
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

  for (const endpoint of capturedEndpoints) {
    const toolName = endpointPathToToolName(endpoint.path);
    apiBasedTools[toolName] = {
      description: endpoint.description,
      input_schema: endpoint.request_schema,
      input_schma: endpoint.request_schema,
      output_schema: endpoint.normalizedResponseSchema,
      call: async ({ adminUser, adminuser, inputs, httpExtra } = {}) => {
        const output = await callCapturedEndpoint({
          adminforth,
          endpoint,
          adminUser: adminUser ?? adminuser,
          inputs,
          httpExtra,
        });

        return YAML.stringify(sanitizeForYaml(output));
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