import type { Interaction } from "@shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  EditPolicyDialog,
  getScopedPolicyToolNames,
  getScopedPolicyTools,
} from "./edit-policy-dialog";

const mockUseAllProfileTools = vi.fn();
const mockUseHasPermissions = vi.fn();
const mockUseInternalMcpCatalog = vi.fn((_params?: unknown) => ({ data: [] }));
const mockUseOrganization = vi.fn();
const mockUseToolsWithAssignments = vi.fn();

vi.mock("@/lib/agent-tools.query", () => ({
  useAllProfileTools: (...args: unknown[]) => mockUseAllProfileTools(...args),
}));

vi.mock("@/lib/auth/auth.query", () => ({
  useHasPermissions: (...args: unknown[]) => mockUseHasPermissions(...args),
}));

vi.mock("@/lib/organization.query", () => ({
  useOrganization: (...args: unknown[]) => mockUseOrganization(...args),
}));

vi.mock("@/lib/mcp/internal-mcp-catalog.query", () => ({
  useInternalMcpCatalog: (...args: unknown[]) =>
    mockUseInternalMcpCatalog(args[0]),
}));

vi.mock("@/lib/tools/tool.query", () => ({
  useToolsWithAssignments: (...args: unknown[]) =>
    mockUseToolsWithAssignments(...args),
}));

vi.mock("@/app/mcp/tool-guardrails/_parts/tool-call-policies", () => ({
  ToolCallPolicies: () => <div>Tool call policies</div>,
}));

vi.mock("@/app/mcp/tool-guardrails/_parts/tool-result-policies", () => ({
  ToolResultPolicies: () => <div>Tool result policies</div>,
}));

describe("EditPolicyDialog", () => {
  it("shows the organization support message when the user cannot update tool policies", () => {
    mockUseHasPermissions.mockReturnValue({ data: false });
    mockUseOrganization.mockReturnValue({
      data: {
        chatErrorSupportMessage:
          "Contact support@company.com and include the blocked tool details.",
      },
    });
    mockUseAllProfileTools.mockReturnValue({ data: { data: [] } });
    mockUseToolsWithAssignments.mockReturnValue({ data: { data: [] } });

    render(
      <EditPolicyDialog
        open={true}
        onOpenChange={() => {}}
        toolName="internal-dev-test-server__print_archestra_test"
        profileId="agent-1"
      />,
    );

    expect(
      screen.getByText(
        "Contact support@company.com and include the blocked tool details.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Tool not found or not assigned to this Agent."),
    ).not.toBeInTheDocument();
  });

  it("shows a generic message when the user cannot update tool policies and no support message is configured", () => {
    mockUseHasPermissions.mockReturnValue({ data: false });
    mockUseOrganization.mockReturnValue({
      data: {
        chatErrorSupportMessage: null,
      },
    });
    mockUseAllProfileTools.mockReturnValue({ data: { data: [] } });
    mockUseToolsWithAssignments.mockReturnValue({ data: { data: [] } });

    render(
      <EditPolicyDialog
        open={true}
        onOpenChange={() => {}}
        toolName="internal-dev-test-server__print_archestra_test"
        profileId="agent-1"
      />,
    );

    expect(
      screen.getByText(
        "You do not have permission to edit tool guardrails. Contact your administrator or support team for help.",
      ),
    ).toBeInTheDocument();
  });

  it("shows a loading state while permission checks are still pending", () => {
    mockUseHasPermissions.mockReturnValue({ data: false, isLoading: true });
    mockUseOrganization.mockReturnValue({
      data: {
        chatErrorSupportMessage: "Contact support@company.com",
      },
    });
    mockUseAllProfileTools.mockReturnValue({ data: { data: [] } });
    mockUseToolsWithAssignments.mockReturnValue({ data: { data: [] } });

    render(
      <EditPolicyDialog
        open={true}
        onOpenChange={() => {}}
        toolName="internal-dev-test-server__print_archestra_test"
        profileId="agent-1"
      />,
    );

    expect(
      screen.queryByText("Tool not found or not assigned to this Agent."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Contact support@company.com"),
    ).not.toBeInTheDocument();
  });

  it("can open without a preselected tool", () => {
    mockUseHasPermissions.mockReturnValue({ data: true });
    mockUseOrganization.mockReturnValue({ data: {} });
    mockUseAllProfileTools.mockReturnValue({
      data: {
        data: [
          { tool: { id: "tool-1", name: "read_file" } },
          { tool: { id: "tool-2", name: "write_file" } },
        ],
      },
      isLoading: false,
    });
    mockUseToolsWithAssignments.mockReturnValue({ data: { data: [] } });

    render(
      <EditPolicyDialog
        open={true}
        onOpenChange={() => {}}
        profileId="agent-1"
      />,
    );

    expect(
      screen.getByText("Select a tool to edit policies."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No historical impact run yet."),
    ).not.toBeInTheDocument();
    expect(mockUseAllProfileTools).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ agentId: "agent-1" }),
      }),
    );
  });

  it("keeps the existing single-tool edit flow when a tool is preselected", () => {
    mockUseHasPermissions.mockReturnValue({ data: true });
    mockUseOrganization.mockReturnValue({ data: {} });
    mockUseAllProfileTools.mockReturnValue({
      data: {
        data: [
          { tool: { id: "tool-1", name: "read_file" } },
          { tool: { id: "tool-2", name: "write_file" } },
        ],
      },
      isLoading: false,
    });
    mockUseToolsWithAssignments.mockReturnValue({ data: { data: [] } });

    render(
      <EditPolicyDialog
        open={true}
        onOpenChange={() => {}}
        toolName="read_file"
        profileId="agent-1"
      />,
    );

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("Tool call policies")).toBeInTheDocument();
    expect(screen.getByText("Tool result policies")).toBeInTheDocument();
    expect(mockUseAllProfileTools).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { agentId: "agent-1", search: "read_file" },
        pagination: { limit: 50 },
      }),
    );
  });

  it("includes tools requested in the current LLM response when building scoped chat policy tools", () => {
    const interaction = {
      type: "anthropic:messages",
      model: "claude-opus",
      request: {
        model: "claude-opus",
        messages: [],
      },
      response: {
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "github__search_issues",
            input: {},
          },
        ],
      },
      dualLlmAnalyses: [],
    } as unknown as Interaction;

    expect(getScopedPolicyToolNames([interaction])).toEqual([
      "github__search_issues",
    ]);
  });

  it("excludes agent delegation tools from scoped chat policy tools", () => {
    const interaction = {
      type: "anthropic:messages",
      model: "claude-opus",
      request: {
        model: "claude-opus",
        messages: [],
      },
      response: {
        content: [
          {
            type: "tool_use",
            id: "toolu_agent",
            name: "agent__researcher",
            input: {},
          },
          {
            type: "tool_use",
            id: "toolu_github",
            name: "github__search_issues",
            input: {},
          },
        ],
      },
      dualLlmAnalyses: [],
    } as unknown as Interaction;

    expect(getScopedPolicyToolNames([interaction])).toEqual([
      "github__search_issues",
    ]);
  });

  it("keeps only MCP catalog tools in scoped chat policy tools", () => {
    expect(
      getScopedPolicyTools(
        [
          {
            id: "mcp-tool",
            name: "github__search_issues",
            catalogId: "github",
          },
          {
            id: "proxy-tool",
            name: "plain_tool",
            catalogId: null,
          },
        ],
        ["github__search_issues", "plain_tool"],
      ).map((tool) => tool.name),
    ).toEqual(["github__search_issues"]);
  });
});
