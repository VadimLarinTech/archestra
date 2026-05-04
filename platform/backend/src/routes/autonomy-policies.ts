import { RouteId } from "@shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { hasAnyAgentTypeAdminPermission } from "@/auth";
import {
  AgentTeamModel,
  ToolInvocationPolicyModel,
  TrustedDataPolicyModel,
} from "@/models";
import {
  runHistoricalPolicyDryRun,
  ToolInvocationDefaultActionChangeSchema,
  ToolInvocationPolicyReplacementSchema,
  TrustedDataDefaultActionChangeSchema,
  TrustedDataPolicyReplacementSchema,
} from "@/services/policy-dry-run/run";
import {
  ApiError,
  AutonomyPolicyOperator,
  constructResponseSchema,
  DeleteObjectResponseSchema,
  ToolInvocation,
  TrustedData,
  UuidIdSchema,
} from "@/types";

const PolicyDryRunBaseBodySchema = z.object({
  profileId: UuidIdSchema.optional(),
  sessionId: z.string().min(1).optional(),
  interactionId: UuidIdSchema.optional(),
  toolName: z.string().min(1).optional(),
  toolNames: z.array(z.string().min(1)).optional(),
  toolIds: z.array(UuidIdSchema).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

const PolicyDryRunBodySchema = z.discriminatedUnion("policyFamily", [
  PolicyDryRunBaseBodySchema.extend({
    policyFamily: z.literal("tool_call"),
    toolInvocationPolicyReplacements: z
      .array(ToolInvocationPolicyReplacementSchema)
      .optional(),
    toolInvocationDefaultActions: z
      .array(ToolInvocationDefaultActionChangeSchema)
      .optional(),
  }).strict(),
  PolicyDryRunBaseBodySchema.extend({
    policyFamily: z.literal("tool_result"),
    trustedDataPolicyReplacements: z
      .array(TrustedDataPolicyReplacementSchema)
      .optional(),
    trustedDataDefaultActions: z
      .array(TrustedDataDefaultActionChangeSchema)
      .optional(),
  }).strict(),
  PolicyDryRunBaseBodySchema.extend({
    policyFamily: z.literal("combined"),
    toolInvocationPolicyReplacements: z
      .array(ToolInvocationPolicyReplacementSchema)
      .optional(),
    trustedDataPolicyReplacements: z
      .array(TrustedDataPolicyReplacementSchema)
      .optional(),
    toolInvocationDefaultActions: z
      .array(ToolInvocationDefaultActionChangeSchema)
      .optional(),
    trustedDataDefaultActions: z
      .array(TrustedDataDefaultActionChangeSchema)
      .optional(),
  }).strict(),
]);

const PolicyDryRunOutcomeSchema = z.enum([
  "allow",
  "require_approval",
  "block",
  "incomplete",
  "unsupported",
  "trusted",
  "untrusted",
  "blocked",
  "sanitize_with_dual_llm",
]);

const PolicyDryRunReasonSchema = z.object({
  code: z.string(),
  message: z.string(),
  matchedPolicyId: z.string().optional(),
  matchedPolicyAction: z.string().optional(),
  matchedConditionKeys: z.array(z.string()).optional(),
  fallbackDecision: z.boolean(),
});

const PolicyDryRunTrustStateSchema = z.object({
  current: z.boolean(),
  draft: z.boolean(),
});

const PolicyDryRunDecisionRecordSchema = z.object({
  caseId: z.string(),
  stepId: z.string(),
  stepOrder: z.number(),
  stepType: z.enum(["tool_call", "tool_result", "refusal", "unsupported"]),
  policyFamily: z.enum(["tool_call", "tool_result", "combined"]),
  currentOutcome: PolicyDryRunOutcomeSchema.optional(),
  draftOutcome: PolicyDryRunOutcomeSchema.optional(),
  changed: z.boolean(),
  category: z.enum([
    "unchanged",
    "newly_blocked",
    "newly_require_approval",
    "less_restrictive",
    "result_newly_blocked",
    "result_now_available",
    "result_now_safe",
    "result_now_sensitive",
    "result_reclassified",
    "missing_policy_input",
    "unsupported",
  ]),
  currentReason: PolicyDryRunReasonSchema.optional(),
  draftReason: PolicyDryRunReasonSchema.optional(),
  trustBefore: PolicyDryRunTrustStateSchema,
  trustAfter: PolicyDryRunTrustStateSchema,
  completeness: z.enum(["complete", "missing_policy_input", "unsupported"]),
  confidence: z.enum(["high_confidence", "partial", "unsupported"]),
  reasons: z.array(z.string()),
  sourceArtifact: z.object({
    interactionId: z.string(),
    field: z.enum(["request", "processedRequest", "response"]),
    providerType: z.string(),
  }),
  stepPreview: z.object({
    title: z.string(),
    toolName: z.string().optional(),
    toolCallId: z.string().optional(),
    target: z.string().optional(),
    safeIdentifiers: z.array(
      z.object({
        label: z.string(),
        value: z.string(),
      }),
    ),
    hiddenInputFields: z.array(z.string()),
    rawResultHidden: z.boolean(),
    note: z.string(),
  }),
  counterfactual: z.boolean(),
  firstDivergence: z.boolean(),
  firstResultReclassification: z.boolean(),
  firstDownstreamAffectedStep: z.boolean(),
});

const PolicyDryRunResponseSchema = z.object({
  policyFamily: z.enum(["tool_call", "tool_result", "combined"]),
  filters: z.object({
    profileId: UuidIdSchema.optional(),
    sessionId: z.string().optional(),
    interactionId: UuidIdSchema.optional(),
    toolName: z.string().optional(),
    toolNames: z.array(z.string()).optional(),
    toolIds: z.array(UuidIdSchema).optional(),
    limit: z.number(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
  safety: z.object({
    livePoliciesMutated: z.literal(false),
    liveToolsExecuted: z.literal(false),
    llmCallsExecuted: z.literal(false),
    rawPayloadsReturned: z.literal(false),
  }),
  extractionSummary: z.object({
    interactionsScanned: z.number(),
    casesBuilt: z.number(),
    completeCases: z.number(),
    partialCases: z.number(),
    unsupportedCases: z.number(),
    completeSteps: z.number(),
    missingPolicyInputSteps: z.number(),
    unsupportedSteps: z.number(),
  }),
  result: z.object({
    policyFamily: z.enum(["tool_call", "tool_result", "combined"]),
    summary: z.object({
      evaluatedCases: z.number(),
      skippedCases: z.number(),
      evaluatedSteps: z.number(),
      unsupportedSteps: z.number(),
      missingPolicyInputSteps: z.number(),
      affectedCases: z.number(),
      affectedSessions: z.number(),
      affectedToolCalls: z.number(),
      affectedToolInteractions: z.number(),
      newlyBlocked: z.number(),
      newlyRequireApproval: z.number(),
      lessRestrictive: z.number(),
      resultsNewlyBlocked: z.number(),
      resultsNowAvailable: z.number(),
      resultsNowSafe: z.number(),
      resultsNowSensitive: z.number(),
      resultsReclassified: z.number(),
      trustStateChanged: z.number(),
      firstDownstreamAffected: z.number(),
      counterfactualSteps: z.number(),
    }),
    cases: z.array(
      z.object({
        caseId: z.string(),
        replayability: z.enum(["complete", "partial", "unsupported"]),
        records: z.array(PolicyDryRunDecisionRecordSchema),
        firstDivergenceStepId: z.string().optional(),
        firstResultReclassificationStepId: z.string().optional(),
        firstDownstreamAffectedStepId: z.string().optional(),
      }),
    ),
    representativeExample: PolicyDryRunDecisionRecordSchema.optional(),
  }),
});

const autonomyPolicyRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    "/api/autonomy-policies/operators",
    {
      schema: {
        operationId: RouteId.GetOperators,
        description: "Get all supported policy operators",
        tags: ["Autonomy Policies"],
        response: constructResponseSchema(
          z.array(
            z.object({
              value: AutonomyPolicyOperator.SupportedOperatorSchema,
              label: z.string(),
            }),
          ),
        ),
      },
    },
    async (_, reply) => {
      const supportedOperators = Object.values(
        AutonomyPolicyOperator.SupportedOperatorSchema.enum,
      ).map((value) => {
        /**
         * Convert the camel cased supported operator values to title case
         * https://stackoverflow.com/a/7225450/3902555
         */
        const titleCaseConversion = value.replace(/([A-Z])/g, " $1");
        const label =
          titleCaseConversion.charAt(0).toUpperCase() +
          titleCaseConversion.slice(1);

        return { value, label };
      });

      return reply.send(supportedOperators);
    },
  );

  fastify.post(
    "/api/autonomy-policies/dry-run",
    {
      schema: {
        operationId: RouteId.RunPolicyDryRun,
        description:
          "Run a historical impact preview for candidate tool policies without mutating live policies",
        tags: ["Autonomy Policies"],
        body: PolicyDryRunBodySchema,
        response: constructResponseSchema(PolicyDryRunResponseSchema),
      },
    },
    async ({ body, organizationId, user }, reply) => {
      if (body.startDate && body.endDate && body.startDate > body.endDate) {
        throw new ApiError(400, "startDate must be before endDate");
      }
      const isAgentAdmin = await hasAnyAgentTypeAdminPermission({
        userId: user.id,
        organizationId,
      });
      if (body.profileId) {
        const hasAgentAccess = await AgentTeamModel.userHasAgentAccess(
          user.id,
          body.profileId,
          isAgentAdmin,
        );
        if (!hasAgentAccess) {
          throw new ApiError(403, "Forbidden");
        }
      }
      const profileIds =
        body.sessionId || !body.profileId
          ? await AgentTeamModel.getUserAccessibleAgentIds(
              user.id,
              isAgentAdmin,
            )
          : undefined;

      return reply.send(
        await runHistoricalPolicyDryRun({
          ...body,
          profileIds,
        }),
      );
    },
  );

  fastify.get(
    "/api/autonomy-policies/tool-invocation",
    {
      schema: {
        operationId: RouteId.GetToolInvocationPolicies,
        description: "Get all tool invocation policies",
        tags: ["Tool Invocation Policies"],
        response: constructResponseSchema(
          z.array(ToolInvocation.SelectToolInvocationPolicySchema),
        ),
      },
    },
    async (_, reply) => {
      return reply.send(await ToolInvocationPolicyModel.findAll());
    },
  );

  fastify.post(
    "/api/autonomy-policies/tool-invocation",
    {
      schema: {
        operationId: RouteId.CreateToolInvocationPolicy,
        description: "Create a new tool invocation policy",
        tags: ["Tool Invocation Policies"],
        body: ToolInvocation.InsertToolInvocationPolicySchema,
        response: constructResponseSchema(
          ToolInvocation.SelectToolInvocationPolicySchema,
        ),
      },
    },
    async ({ body }, reply) => {
      return reply.send(await ToolInvocationPolicyModel.create(body));
    },
  );

  fastify.get(
    "/api/autonomy-policies/tool-invocation/:id",
    {
      schema: {
        operationId: RouteId.GetToolInvocationPolicy,
        description: "Get tool invocation policy by ID",
        tags: ["Tool Invocation Policies"],
        params: z.object({
          id: UuidIdSchema,
        }),
        response: constructResponseSchema(
          ToolInvocation.SelectToolInvocationPolicySchema,
        ),
      },
    },
    async ({ params: { id } }, reply) => {
      const policy = await ToolInvocationPolicyModel.findById(id);

      if (!policy) {
        throw new ApiError(404, "Tool invocation policy not found");
      }

      return reply.send(policy);
    },
  );

  fastify.put(
    "/api/autonomy-policies/tool-invocation/:id",
    {
      schema: {
        operationId: RouteId.UpdateToolInvocationPolicy,
        description: "Update a tool invocation policy",
        tags: ["Tool Invocation Policies"],
        params: z.object({
          id: UuidIdSchema,
        }),
        body: ToolInvocation.InsertToolInvocationPolicySchema.partial(),
        response: constructResponseSchema(
          ToolInvocation.SelectToolInvocationPolicySchema,
        ),
      },
    },
    async ({ params: { id }, body }, reply) => {
      const policy = await ToolInvocationPolicyModel.update(id, body);

      if (!policy) {
        throw new ApiError(404, "Tool invocation policy not found");
      }

      return reply.send(policy);
    },
  );

  fastify.delete(
    "/api/autonomy-policies/tool-invocation/:id",
    {
      schema: {
        operationId: RouteId.DeleteToolInvocationPolicy,
        description: "Delete a tool invocation policy",
        tags: ["Tool Invocation Policies"],
        params: z.object({
          id: UuidIdSchema,
        }),
        response: constructResponseSchema(DeleteObjectResponseSchema),
      },
    },
    async ({ params: { id } }, reply) => {
      const success = await ToolInvocationPolicyModel.delete(id);

      if (!success) {
        throw new ApiError(404, "Tool invocation policy not found");
      }

      return reply.send({ success: true });
    },
  );

  fastify.get(
    "/api/trusted-data-policies",
    {
      schema: {
        operationId: RouteId.GetTrustedDataPolicies,
        description: "Get all trusted data policies",
        tags: ["Trusted Data Policies"],
        response: constructResponseSchema(
          z.array(TrustedData.SelectTrustedDataPolicySchema),
        ),
      },
    },
    async (_, reply) => {
      return reply.send(await TrustedDataPolicyModel.findAll());
    },
  );

  fastify.post(
    "/api/trusted-data-policies",
    {
      schema: {
        operationId: RouteId.CreateTrustedDataPolicy,
        description: "Create a new trusted data policy",
        tags: ["Trusted Data Policies"],
        body: TrustedData.InsertTrustedDataPolicySchema,
        response: constructResponseSchema(
          TrustedData.SelectTrustedDataPolicySchema,
        ),
      },
    },
    async ({ body }, reply) => {
      return reply.send(await TrustedDataPolicyModel.create(body));
    },
  );

  fastify.get(
    "/api/trusted-data-policies/:id",
    {
      schema: {
        operationId: RouteId.GetTrustedDataPolicy,
        description: "Get trusted data policy by ID",
        tags: ["Trusted Data Policies"],
        params: z.object({
          id: UuidIdSchema,
        }),
        response: constructResponseSchema(
          TrustedData.SelectTrustedDataPolicySchema,
        ),
      },
    },
    async ({ params: { id } }, reply) => {
      const policy = await TrustedDataPolicyModel.findById(id);

      if (!policy) {
        throw new ApiError(404, "Trusted data policy not found");
      }

      return reply.send(policy);
    },
  );

  fastify.put(
    "/api/trusted-data-policies/:id",
    {
      schema: {
        operationId: RouteId.UpdateTrustedDataPolicy,
        description: "Update a trusted data policy",
        tags: ["Trusted Data Policies"],
        params: z.object({
          id: UuidIdSchema,
        }),
        body: TrustedData.InsertTrustedDataPolicySchema.partial(),
        response: constructResponseSchema(
          TrustedData.SelectTrustedDataPolicySchema,
        ),
      },
    },
    async ({ params: { id }, body }, reply) => {
      const policy = await TrustedDataPolicyModel.update(id, body);

      if (!policy) {
        throw new ApiError(404, "Trusted data policy not found");
      }

      return reply.send(policy);
    },
  );

  fastify.delete(
    "/api/trusted-data-policies/:id",
    {
      schema: {
        operationId: RouteId.DeleteTrustedDataPolicy,
        description: "Delete a trusted data policy",
        tags: ["Trusted Data Policies"],
        params: z.object({
          id: UuidIdSchema,
        }),
        response: constructResponseSchema(DeleteObjectResponseSchema),
      },
    },
    async ({ params: { id } }, reply) => {
      const success = await TrustedDataPolicyModel.delete(id);

      if (!success) {
        throw new ApiError(404, "Trusted data policy not found");
      }

      return reply.send({ success: true });
    },
  );

  // Bulk operations for default policies
  fastify.post(
    "/api/tool-invocation/bulk-default",
    {
      schema: {
        operationId: RouteId.BulkUpsertDefaultCallPolicy,
        description:
          "Bulk upsert default tool invocation policies (empty conditions) for multiple tools",
        tags: ["Tool Invocation Policies"],
        body: z.object({
          toolIds: z.array(UuidIdSchema),
          action: z.enum([
            "allow_when_context_is_untrusted",
            "block_when_context_is_untrusted",
            "block_always",
            "require_approval",
          ]),
        }),
        response: constructResponseSchema(
          z.object({
            updated: z.number(),
            created: z.number(),
          }),
        ),
      },
    },
    async ({ body }, reply) => {
      const result = await ToolInvocationPolicyModel.bulkUpsertDefaultPolicy(
        body.toolIds,
        body.action,
      );
      return reply.send(result);
    },
  );

  fastify.post(
    "/api/trusted-data-policies/bulk-default",
    {
      schema: {
        operationId: RouteId.BulkUpsertDefaultResultPolicy,
        description:
          "Bulk upsert default trusted data policies (empty conditions) for multiple tools",
        tags: ["Trusted Data Policies"],
        body: z.object({
          toolIds: z.array(UuidIdSchema),
          action: z.enum([
            "mark_as_trusted",
            "mark_as_untrusted",
            "block_always",
            "sanitize_with_dual_llm",
          ]),
        }),
        response: constructResponseSchema(
          z.object({
            updated: z.number(),
            created: z.number(),
          }),
        ),
      },
    },
    async ({ body }, reply) => {
      const result = await TrustedDataPolicyModel.bulkUpsertDefaultPolicy(
        body.toolIds,
        body.action,
      );
      return reply.send(result);
    },
  );
};

export default autonomyPolicyRoutes;
