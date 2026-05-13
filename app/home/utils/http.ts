export async function readJsonResponse<T>(response: Response) {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function readErrorMessage(response: Response, fallback: string) {
  const body = await readJsonResponse<{ error?: string }>(response);
  return body?.error || fallback;
}
