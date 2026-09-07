import { describe, expect, it, vi } from "vitest";
import { api } from "../services/api.ts";

describe("SinoPac API login adapter", () => {
  it("calls the server-side API login endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ authenticated: true, simulation: true, accounts: [] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const result = await api.login();
    expect(result.accessToken).toBe("sinopac-api-session");
    expect(fetch).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({ method: "POST" }));
    vi.unstubAllGlobals();
  });
});
