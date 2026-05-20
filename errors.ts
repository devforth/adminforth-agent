export function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "AbortError" || error.name === "APIUserAbortError")
  );
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
