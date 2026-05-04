import {
  AGENT_TOOL_PREFIX,
  type archestraApiTypes,
  isAgentTool,
  parseFullToolName,
} from "@shared";
import type { ToolWithAssignmentsData } from "./tool.query";

export type InternalMcpCatalogItem =
  archestraApiTypes.GetInternalMcpCatalogResponses["200"][number];

export function getToolCatalogItem(
  tool: Pick<ToolWithAssignmentsData, "catalogId"> | undefined,
  internalMcpCatalogItems: InternalMcpCatalogItem[] | undefined,
) {
  if (!tool?.catalogId) {
    return undefined;
  }
  return internalMcpCatalogItems?.find((item) => item.id === tool.catalogId);
}

export function getToolSourceName(
  tool: Pick<ToolWithAssignmentsData, "name" | "catalogId">,
  internalMcpCatalogItems: InternalMcpCatalogItem[] | undefined,
) {
  const catalogItem = getToolCatalogItem(tool, internalMcpCatalogItems);
  if (catalogItem) {
    return catalogItem.name;
  }

  if (tool.catalogId) {
    return parseFullToolName(tool.name).serverName ?? "MCP Server";
  }

  if (isAgentTool(tool.name) || tool.name.startsWith(AGENT_TOOL_PREFIX)) {
    return "Agent";
  }

  return "LLM Proxy";
}

export function getToolSourceNameByToolName(
  toolName: string,
  toolsByName: Map<string, Pick<ToolWithAssignmentsData, "name" | "catalogId">>,
  internalMcpCatalogItems: InternalMcpCatalogItem[] | undefined,
) {
  const tool = toolsByName.get(toolName);
  if (tool) {
    return getToolSourceName(tool, internalMcpCatalogItems);
  }

  return parseFullToolName(toolName).serverName ?? "LLM Proxy";
}
