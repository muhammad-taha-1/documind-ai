import { redirect } from "next/navigation";
import { describe, expect, it, vi } from "vitest";
import { inlineContentDisposition, INTERNAL_ERROR_MESSAGE, withErrorHandling } from "./api";

describe("inlineContentDisposition", () => {
  it("names a plain file as is", () => {
    expect(inlineContentDisposition("report.pdf")).toBe(`inline; filename="report.pdf"; filename*=UTF-8''report.pdf`);
  });

  it("keeps quotes and backslashes out of the quoted fallback", () => {
    expect(inlineContentDisposition(`a "b"\\c.pdf`)).toBe(
      `inline; filename="a _b__c.pdf"; filename*=UTF-8''a%20%22b%22%5Cc.pdf`,
    );
  });

  it("percent-encodes non-ASCII names, with an ASCII fallback", () => {
    expect(inlineContentDisposition("résumé (final)'s.pdf")).toBe(
      `inline; filename="r_sum_ (final)'s.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%28final%29%27s.pdf`,
    );
  });

  it("can't be used to inject another header", () => {
    expect(inlineContentDisposition("a\r\nSet-Cookie: x=1.pdf")).not.toMatch(/[\r\n]/);
  });
});

describe("withErrorHandling", () => {
  const request = new Request("http://localhost/api/things/1", { method: "PATCH" });

  it("passes the handler's own responses through", async () => {
    const handler = withErrorHandling(async (_request: Request, id: string) => Response.json({ id }, { status: 201 }));

    const response = await handler(request, "abc");

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "abc" });
  });

  it("turns an unexpected failure into a logged 500 with the usual error body", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("connection refused");
    const handler = withErrorHandling(async () => {
      throw failure;
    });

    const response = await handler(request);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: INTERNAL_ERROR_MESSAGE });
    // The details go to the log, not the client
    expect(consoleError).toHaveBeenCalledWith("Unhandled error in PATCH /api/things/1", failure);
    consoleError.mockRestore();
  });

  it("lets Next.js's own control flow through (redirect, notFound)", async () => {
    const handler = withErrorHandling(async () => redirect("/login"));
    await expect(handler(request)).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  });
});
