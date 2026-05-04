import { eq } from "drizzle-orm";
import db, { schema } from "@/database";
import { createFastifyInstance, type FastifyInstanceWithZod } from "@/server";
import { afterEach, beforeEach, describe, expect, test } from "@/test";
import type { User } from "@/types";

describe("autonomy policy dry-run route", () => {
  let app: FastifyInstanceWithZod;
  let user: User;
  let organizationId: string;

  beforeEach(async ({ makeUser }) => {
    user = await makeUser();
    app = createFastifyInstance();
    app.addHook("onRequest", async (request) => {
      (request as typeof request & { user: User }).user = user;
      (
        request as typeof request & {
          organizationId: string;
        }
      ).organizationId = organizationId;
    });

    const { default: autonomyPolicyRoutes } = await import(
      "./autonomy-policies"
    );
    await app.register(autonomyPolicyRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  test("runs candidate policies against history without mutating live policies or returning raw payloads", async ({
    makeAgent,
    makeInteraction,
    makeOrganization,
    makeTeam,
    makeTool,
  }) => {
    const organization = await makeOrganization();
    organizationId = organization.id;
    await db
      .update(schema.organizationsTable)
      .set({ globalToolPolicy: "restrictive" })
      .where(eq(schema.organizationsTable.id, organization.id));

    const team = await makeTeam(organization.id, user.id);
    const agent = await makeAgent({
      organizationId: organization.id,
      teams: [team.id],
    });
    const tool = await makeTool({ name: "read_file" });
    await makeInteraction(agent.id, {
      source: "chat",
      sessionId: "session-1",
    } as never);

    const response = await app.inject({
      method: "POST",
      url: "/api/autonomy-policies/dry-run",
      payload: {
        policyFamily: "tool_call",
        profileId: agent.id,
        limit: 10,
        toolInvocationPolicyReplacements: [
          {
            toolId: tool.id,
            policies: [
              {
                toolId: tool.id,
                conditions: [],
                action: "block_always",
                reason: "Draft block",
              },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.safety).toEqual({
      livePoliciesMutated: false,
      liveToolsExecuted: false,
      llmCallsExecuted: false,
      rawPayloadsReturned: false,
    });
    expect(payload.result.summary).toMatchObject({
      evaluatedCases: 1,
      affectedToolCalls: 1,
      affectedToolInteractions: 1,
      newlyBlocked: 1,
      missingPolicyInputSteps: 0,
    });
    expect(JSON.stringify(payload)).not.toContain("/etc/passwd");

    const livePolicies = await db
      .select()
      .from(schema.toolInvocationPoliciesTable)
      .where(eq(schema.toolInvocationPoliciesTable.toolId, tool.id));
    expect(livePolicies).toHaveLength(1);
    expect(livePolicies[0].action).toBe("block_when_context_is_untrusted");
  });

  test("rejects dry run for an agent outside the caller's access scope", async ({
    makeAgent,
    makeOrganization,
  }) => {
    const organization = await makeOrganization();
    organizationId = organization.id;
    const inaccessibleAgent = await makeAgent({
      organizationId,
      scope: "team",
      teams: [],
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/autonomy-policies/dry-run",
      payload: {
        policyFamily: "tool_call",
        profileId: inaccessibleAgent.id,
        limit: 10,
      },
    });

    expect(response.statusCode).toBe(403);
  });

  test("limits dry run extraction to the requested session", async ({
    makeAgent,
    makeInteraction,
    makeOrganization,
    makeTeam,
    makeTool,
  }) => {
    const organization = await makeOrganization();
    organizationId = organization.id;
    await db
      .update(schema.organizationsTable)
      .set({ globalToolPolicy: "restrictive" })
      .where(eq(schema.organizationsTable.id, organization.id));

    const team = await makeTeam(organization.id, user.id);
    const agent = await makeAgent({
      organizationId: organization.id,
      teams: [team.id],
    });
    const tool = await makeTool({ name: "read_file" });
    await makeInteraction(agent.id, {
      source: "chat",
      sessionId: "included-session",
    } as never);
    await makeInteraction(agent.id, {
      source: "chat",
      sessionId: "excluded-session",
    } as never);

    const response = await app.inject({
      method: "POST",
      url: "/api/autonomy-policies/dry-run",
      payload: {
        policyFamily: "tool_call",
        profileId: agent.id,
        sessionId: "included-session",
        limit: 10,
        toolInvocationPolicyReplacements: [
          {
            toolId: tool.id,
            policies: [
              {
                toolId: tool.id,
                conditions: [],
                action: "block_always",
                reason: "Draft block",
              },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.filters.sessionId).toBe("included-session");
    expect(payload.result.summary.evaluatedCases).toBe(1);
    expect(payload.result.summary.affectedToolCalls).toBe(1);
    expect(payload.result.summary.affectedToolInteractions).toBe(1);
  });

  test("uses interactionId as an anchor for the complete interaction group", async ({
    makeAgent,
    makeInteraction,
    makeOrganization,
    makeTeam,
    makeTool,
  }) => {
    const organization = await makeOrganization();
    organizationId = organization.id;
    await db
      .update(schema.organizationsTable)
      .set({ globalToolPolicy: "restrictive" })
      .where(eq(schema.organizationsTable.id, organization.id));

    const team = await makeTeam(organization.id, user.id);
    const agent = await makeAgent({
      organizationId: organization.id,
      teams: [team.id],
    });
    const tool = await makeTool({ name: "read_file" });
    const includedInteraction = await makeInteraction(agent.id, {
      source: "chat",
      sessionId: "shared-session",
    } as never);
    await makeInteraction(agent.id, {
      response: makeReadFileToolCallResponse("call_test_456"),
      source: "chat",
      sessionId: "shared-session",
    } as never);

    const response = await app.inject({
      method: "POST",
      url: "/api/autonomy-policies/dry-run",
      payload: {
        policyFamily: "tool_call",
        profileId: agent.id,
        interactionId: includedInteraction.id,
        limit: 10,
        toolInvocationPolicyReplacements: [
          {
            toolId: tool.id,
            policies: [
              {
                toolId: tool.id,
                conditions: [],
                action: "block_always",
                reason: "Draft block",
              },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.filters.interactionId).toBe(includedInteraction.id);
    expect(payload.extractionSummary.interactionsScanned).toBe(2);
    expect(payload.result.summary.evaluatedCases).toBe(1);
    expect(payload.result.summary.affectedToolCalls).toBe(2);
    expect(payload.result.summary.affectedToolInteractions).toBe(2);
  });

  test("runs session-scoped dry run across all accessible profiles in that session", async ({
    makeAgent,
    makeInteraction,
    makeOrganization,
    makeTeam,
    makeTool,
  }) => {
    const organization = await makeOrganization();
    organizationId = organization.id;
    await db
      .update(schema.organizationsTable)
      .set({ globalToolPolicy: "restrictive" })
      .where(eq(schema.organizationsTable.id, organization.id));

    const team = await makeTeam(organization.id, user.id);
    const agentA = await makeAgent({
      organizationId: organization.id,
      teams: [team.id],
    });
    const agentB = await makeAgent({
      organizationId: organization.id,
      teams: [team.id],
    });
    const tool = await makeTool({ name: "read_file" });
    await makeInteraction(agentA.id, {
      source: "chat",
      sessionId: "multi-profile-session",
    } as never);
    await makeInteraction(agentB.id, {
      response: makeReadFileToolCallResponse("call_test_profile_b"),
      source: "chat",
      sessionId: "multi-profile-session",
    } as never);

    const response = await app.inject({
      method: "POST",
      url: "/api/autonomy-policies/dry-run",
      payload: {
        policyFamily: "tool_call",
        profileId: agentA.id,
        sessionId: "multi-profile-session",
        limit: 10,
        toolInvocationPolicyReplacements: [
          {
            toolId: tool.id,
            policies: [
              {
                toolId: tool.id,
                conditions: [],
                action: "block_always",
                reason: "Draft block",
              },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.result.summary.evaluatedCases).toBe(1);
    expect(payload.result.summary.affectedToolCalls).toBe(2);
    expect(payload.result.summary.affectedToolInteractions).toBe(2);
  });

  test("runs combined default-action drafts without requiring a profileId", async ({
    makeAgent,
    makeInteraction,
    makeOrganization,
    makeTeam,
    makeTool,
  }) => {
    const organization = await makeOrganization();
    organizationId = organization.id;
    await db
      .update(schema.organizationsTable)
      .set({ globalToolPolicy: "restrictive" })
      .where(eq(schema.organizationsTable.id, organization.id));

    const team = await makeTeam(organization.id, user.id);
    const agent = await makeAgent({
      organizationId: organization.id,
      teams: [team.id],
    });
    const tool = await makeTool({ name: "read_file" });
    await makeInteraction(agent.id, {
      source: "chat",
      sessionId: "combined-default-action-session",
    } as never);

    const response = await app.inject({
      method: "POST",
      url: "/api/autonomy-policies/dry-run",
      payload: {
        policyFamily: "combined",
        sessionId: "combined-default-action-session",
        toolIds: [tool.id],
        limit: 10,
        toolInvocationDefaultActions: [
          {
            toolId: tool.id,
            action: "block_always",
          },
        ],
        trustedDataDefaultActions: [
          {
            toolId: tool.id,
            action: "mark_as_trusted",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.policyFamily).toBe("combined");
    expect(payload.filters).toMatchObject({
      sessionId: "combined-default-action-session",
      toolIds: [tool.id],
    });
    expect(payload.filters.profileId).toBeUndefined();
    expect(payload.result.summary).toMatchObject({
      evaluatedCases: 1,
      affectedToolCalls: 1,
      affectedToolInteractions: 1,
      newlyBlocked: 1,
    });
  });

  test("rejects legacy full candidate policy payloads", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/autonomy-policies/dry-run",
      payload: {
        policyFamily: "tool_call",
        profileId: crypto.randomUUID(),
        limit: 10,
        candidateInvocationPolicies: [],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  test("rejects result policy replacements in a call-policy dry run", async ({
    makeTool,
  }) => {
    const tool = await makeTool({ name: "read_email" });

    const response = await app.inject({
      method: "POST",
      url: "/api/autonomy-policies/dry-run",
      payload: {
        policyFamily: "tool_call",
        profileId: crypto.randomUUID(),
        trustedDataPolicyReplacements: [
          {
            toolId: tool.id,
            policies: [
              {
                toolId: tool.id,
                conditions: [],
                action: "mark_as_trusted",
                description: null,
              },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  test("rejects call policy replacements in a result-policy dry run", async ({
    makeTool,
  }) => {
    const tool = await makeTool({ name: "send_email" });

    const response = await app.inject({
      method: "POST",
      url: "/api/autonomy-policies/dry-run",
      payload: {
        policyFamily: "tool_result",
        profileId: crypto.randomUUID(),
        toolInvocationPolicyReplacements: [
          {
            toolId: tool.id,
            policies: [
              {
                toolId: tool.id,
                conditions: [],
                action: "block_always",
                reason: null,
              },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  test("rejects policy replacements when nested policy toolId does not match", async ({
    makeAgent,
    makeOrganization,
    makeTeam,
    makeTool,
  }) => {
    const organization = await makeOrganization();
    organizationId = organization.id;
    const team = await makeTeam(organization.id, user.id);
    const agent = await makeAgent({
      organizationId: organization.id,
      teams: [team.id],
    });
    const tool = await makeTool({ name: "send_email" });
    const otherTool = await makeTool({ name: "read_email" });

    const response = await app.inject({
      method: "POST",
      url: "/api/autonomy-policies/dry-run",
      payload: {
        policyFamily: "tool_call",
        profileId: agent.id,
        limit: 10,
        toolInvocationPolicyReplacements: [
          {
            toolId: tool.id,
            policies: [
              {
                toolId: otherTool.id,
                conditions: [],
                action: "block_always",
                reason: null,
              },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
  });
});

function makeReadFileToolCallResponse(toolCallId: string) {
  return {
    id: `chatcmpl-test-${toolCallId}`,
    object: "chat.completion",
    created: 1234567890,
    model: "gpt-4",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          refusal: null,
          tool_calls: [
            {
              id: toolCallId,
              type: "function",
              function: {
                name: "read_file",
                arguments: '{"file_path":"/etc/passwd"}',
              },
            },
          ],
        },
        finish_reason: "tool_calls",
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
    },
  };
}
