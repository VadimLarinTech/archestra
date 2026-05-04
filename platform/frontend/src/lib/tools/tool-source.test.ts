import { describe, expect, it } from "vitest";
import {
  getToolSourceName,
  getToolSourceNameByToolName,
  type InternalMcpCatalogItem,
} from "./tool-source";

const catalogItems = [
  {
    id: "catalog-github",
    name: "GitHub",
  },
] as InternalMcpCatalogItem[];

describe("tool source labels", () => {
  it("uses the catalog source name when a tool has a matching catalog id", () => {
    expect(
      getToolSourceName(
        { name: "github__list_issues", catalogId: "catalog-github" },
        catalogItems,
      ),
    ).toBe("GitHub");
  });

  it("uses Agent for delegation tools without catalog metadata", () => {
    expect(
      getToolSourceName(
        { name: "agent__researcher", catalogId: null },
        catalogItems,
      ),
    ).toBe("Agent");
  });

  it("uses LLM Proxy for non-MCP tools without catalog metadata", () => {
    expect(
      getToolSourceName({ name: "plain_tool", catalogId: null }, catalogItems),
    ).toBe("LLM Proxy");
  });

  it("uses the parsed MCP server name when catalog metadata is not loaded yet", () => {
    expect(
      getToolSourceName(
        {
          name: "github_dry_run_test__get_label",
          catalogId: "catalog-missing",
        },
        catalogItems,
      ),
    ).toBe("github_dry_run_test");
  });

  it("uses the parsed server name when only the historical tool name is available", () => {
    expect(
      getToolSourceNameByToolName(
        "github_dry_run_test__get_label",
        new Map(),
        catalogItems,
      ),
    ).toBe("github_dry_run_test");
  });
});
