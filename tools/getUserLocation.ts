import { tool } from "langchain";
import { z } from "zod";

export type CurrentPageContext = {
  path: string;
  fullPath: string;
  title: string;
  url: string;
};

const getUserLocationSchema = z.object({});

export function createGetUserLocationTool() {
  return tool(
    async (_input, runtime) => {
      const currentPage = (runtime.context as { currentPage?: CurrentPageContext }).currentPage;

      if (!currentPage) {
        return JSON.stringify(
          {
            status: 404,
            message: "Current user location is not available.",
          },
          null,
          2,
        );
      }

      return JSON.stringify(
        {
          status: 200,
          location: currentPage,
        },
        null,
        2,
      );
    },
    {
      name: "get_user_location",
      description:
        "Get the user's current location in the AdminForth UI, including current page path, full path, title, and URL. Call this tool when you do not understand what the user is referring to, especially when they say here, this page, current page, opened page, or otherwise rely on page context.",
      schema: getUserLocationSchema,
    },
  );
}
