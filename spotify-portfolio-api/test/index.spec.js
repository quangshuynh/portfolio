import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src";

describe("Spotify portfolio API", () => {
	it("returns a CORS-aware 404 for unsupported routes (unit style)", async () => {
		const request = new Request("http://example.com");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(404);
		expect(response.headers.get("Vary")).toBe("Origin");
		expect(await response.text()).toBe("Not found");
	});

	it("returns the same unsupported-route response (integration style)", async () => {
		const response = await SELF.fetch("http://example.com");

		expect(response.status).toBe(404);
		expect(response.headers.get("Vary")).toBe("Origin");
		expect(await response.text()).toBe("Not found");
	});
});
