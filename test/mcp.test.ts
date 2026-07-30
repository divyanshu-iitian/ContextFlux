import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFixtureRepository, removeFixtureRepository } from "./fixture.js";

describe("ContextFlux MCP server", () => {
  let root: string;
  let client: Client;
  let transport: StdioClientTransport;

  beforeEach(async () => {
    root = await createFixtureRepository();
    transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", path.resolve("src/mcp.ts")],
      cwd: process.cwd(),
      env: {
        CONTEXTFLUX_ROOT: root,
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
      },
      stderr: "pipe",
    });
    client = new Client({ name: "contextflux-test", version: "0.1.0" });
    await client.connect(transport);
  }, 20_000);

  afterEach(async () => {
    await client.close();
    await removeFixtureRepository(root);
  });

  it("supports introspection and a bounded context call", async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "get_task_context",
      "search_repository",
      "repository_map",
      "index_status",
    ]);
    expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(true);

    const result = await client.callTool({
      name: "get_task_context",
      arguments: {
        task: "Add regression tests for login in src/auth.ts",
        budgetTokens: 512,
        intent: "code2test",
      },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent?.budgetTokens).toBe(512);
    expect(Number(result.structuredContent?.usedTokens)).toBeLessThanOrEqual(512);
  }, 20_000);
});
