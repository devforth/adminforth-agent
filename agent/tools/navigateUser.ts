import { tool } from "langchain";
import { z } from "zod";
import type { CurrentPageContext } from "./getUserLocation.js";
import type { AgentEventEmitter } from "../../agentEvents.js";

const filterSchema = z.object({
  column: z.string().min(1).describe("Resource column name."),
  operator: z
    .string()
    .min(1)
    .describe("Filter operator suffix, for example eq, gte, lte, like, in."),
  value: z.unknown().describe("Filter value. Dates should be ISO strings."),
});

const navigateUserSchema = z
  .object({
    targetPath: z
      .string()
      .optional()
      .describe(
        "Root-relative AdminForth path to open, with optional query string and hash, for example /resource/adminuser?sort=created_at__desc.",
      ),
    resourceId: z
      .string()
      .optional()
      .describe("Resource id to build an AdminForth resource route for."),
    mode: z
      .enum(["list", "show", "edit", "create"])
      .optional()
      .default("list")
      .describe("Resource page mode. Defaults to list."),
    recordId: z
      .union([z.string(), z.number()])
      .optional()
      .describe("Record primary key for show or edit resource pages."),
    filters: z
      .array(filterSchema)
      .optional()
      .describe(
        "List page filters. Each item becomes filter__{column}__{operator}=JSON.stringify(value).",
      ),
    sort: z
      .object({
        column: z.string().min(1),
        direction: z.enum(["asc", "desc"]),
      })
      .optional()
      .describe("List page sort. Becomes sort={column}__{direction}."),
    query: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional()
      .describe("Additional query parameters to append to the target URL."),
  })
  .refine((input) => input.targetPath || input.resourceId, {
    message: "Either targetPath or resourceId is required.",
  });

function normalizeTargetPath(targetPath: string, currentPage?: CurrentPageContext) {
  const trimmed = targetPath.trim();

  if (!trimmed) {
    throw new Error("targetPath cannot be empty.");
  }

  const currentOrigin = currentPage?.url ? new URL(currentPage.url).origin : undefined;

  if (currentOrigin) {
    const targetUrl = new URL(trimmed, currentOrigin);

    if (targetUrl.origin !== currentOrigin) {
      throw new Error("Only same-origin navigation targets are allowed.");
    }

    return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
  }

  const fallbackOrigin = "http://adminforth.local";
  const targetUrl = new URL(trimmed, fallbackOrigin);

  if (targetUrl.origin !== fallbackOrigin) {
    throw new Error("Only relative AdminForth paths are allowed when current origin is unavailable.");
  }

  return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
}

function appendQueryParams(path: string, params: URLSearchParams) {
  const queryString = params.toString();

  if (!queryString) {
    return path;
  }

  const hashIndex = path.indexOf("#");
  const pathWithoutHash = hashIndex === -1 ? path : path.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : path.slice(hashIndex);
  const separator = pathWithoutHash.includes("?") ? "&" : "?";

  return `${pathWithoutHash}${separator}${queryString}${hash}`;
}

function buildResourcePath(input: z.infer<typeof navigateUserSchema>) {
  if (!input.resourceId) {
    throw new Error("resourceId is required to build a resource route.");
  }

  const resourceId = encodeURIComponent(input.resourceId);
  const mode = input.mode ?? "list";

  if (mode === "show" || mode === "edit") {
    if (input.recordId === undefined || input.recordId === null) {
      throw new Error(`recordId is required for ${mode} resource pages.`);
    }

    return `/resource/${resourceId}/${mode}/${encodeURIComponent(String(input.recordId))}`;
  }

  if (mode === "create") {
    return `/resource/${resourceId}/create`;
  }

  return `/resource/${resourceId}`;
}

function buildQueryParams(input: z.infer<typeof navigateUserSchema>) {
  const params = new URLSearchParams();

  for (const filter of input.filters ?? []) {
    params.set(
      `filter__${filter.column}__${filter.operator}`,
      JSON.stringify(filter.value),
    );
  }

  if (input.sort) {
    params.set("sort", `${input.sort.column}__${input.sort.direction}`);
  }

  for (const [key, value] of Object.entries(input.query ?? {})) {
    params.set(key, String(value));
  }

  return params;
}

function buildSurfaceUrl(targetPath: string, adminBaseUrl?: string, adminPublicOrigin?: string) {
  const normalizedBasePath = adminBaseUrl?.replace(/\/+$/, "") ?? "";
  const normalizedTargetPath = targetPath.replace(/^\/+/, "");
  const path = `${normalizedBasePath}/${normalizedTargetPath}`;

  return adminPublicOrigin ? new URL(path, adminPublicOrigin).toString() : path;
}

export function createNavigateUserTool() {
  return tool(
    async (input, runtime) => {
      const context = runtime.context as {
        currentPage?: CurrentPageContext;
        chatSurface?: string;
        adminBaseUrl?: string;
        adminPublicOrigin?: string;
        emit?: AgentEventEmitter;
      };
      const currentPage = context.currentPage;
      const basePath = input.targetPath
        ? normalizeTargetPath(input.targetPath, currentPage)
        : buildResourcePath(input);
      const targetPath = appendQueryParams(basePath, buildQueryParams(input));

      if (context.chatSurface) {
        const url = buildSurfaceUrl(targetPath, context.adminBaseUrl, context.adminPublicOrigin);

        return JSON.stringify(
          {
            status: 200,
            action: "link",
            surface: context.chatSurface,
            targetPath,
            url,
            message: `Send this link to the user: ${url}`,
          },
          null,
          2,
        );
      }

      await context.emit?.({
        type: "open-page",
        targetPath,
      });

      return JSON.stringify(
        {
          status: 200,
          action: "navigate",
          targetPath,
          message: `Navigation requested to ${targetPath}.`,
        },
        null,
        2,
      );
    },
    {
      name: "navigate_user",
      description:
        "Navigate the user to another AdminForth page. Use this only when the user asks to open, show, go to, or switch to a resource list/detail page, including filtered or sorted resource lists. Or if the user is asked to open something on the left. Do not use this tool in any other case.",
      schema: navigateUserSchema,
    },
  );
}
