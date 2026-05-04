import { TOOL_INVOCATION_APPROVAL_REQUIRED_AUTONOMOUS_REASON } from "@shared";
import type { PolicyEvaluationContext } from "@/models/tool-invocation-policy";
import { describe, expect, test } from "@/test";
import {
  evaluateToolInvocationPolicy,
  evaluateTrustedDataPolicy,
} from "./policy-evaluators";

const mockContext: PolicyEvaluationContext = {
  teamIds: [],
};

describe("policy dry-run evaluators", () => {
  describe("evaluateToolInvocationPolicy", () => {
    test("evaluates candidate call policies without a DB-backed policy row", () => {
      const toolId = crypto.randomUUID();

      const result = evaluateToolInvocationPolicy({
        toolName: "send_email",
        toolId,
        toolInput: { to: "external@example.com" },
        context: mockContext,
        contextIsTrusted: true,
        globalToolPolicy: "restrictive",
        policies: [
          {
            toolId,
            conditions: [
              { key: "to", operator: "endsWith", value: "@example.com" },
            ],
            action: "block_always",
            reason: "External recipients are blocked",
          },
        ],
      });

      expect(result.outcome).toBe("block");
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe("External recipients are blocked");
      expect(result.reasonDetails).toMatchObject({
        code: "matched_specific_policy",
        matchedPolicyAction: "block_always",
        matchedConditionKeys: ["to"],
        fallbackDecision: false,
      });
    });

    test("returns require_approval as a distinct normalized outcome", () => {
      const toolId = crypto.randomUUID();

      const result = evaluateToolInvocationPolicy({
        toolName: "send_email",
        toolId,
        toolInput: { to: "team@example.com" },
        context: mockContext,
        contextIsTrusted: false,
        executionMode: "chat",
        globalToolPolicy: "restrictive",
        policies: [
          {
            toolId,
            conditions: [],
            action: "require_approval",
            reason: "Approval required for email sends",
          },
        ],
      });

      expect(result.outcome).toBe("require_approval");
      expect(result.isAllowed).toBe(true);
      expect(result.requiresApproval).toBe(true);
      expect(result.reasonDetails).toMatchObject({
        code: "matched_default_policy",
        matchedPolicyAction: "require_approval",
        fallbackDecision: false,
      });
    });

    test("blocks require_approval policies when no approval channel is available", () => {
      const toolId = crypto.randomUUID();

      const result = evaluateToolInvocationPolicy({
        toolName: "send_email",
        toolId,
        toolInput: { to: "team@example.com" },
        context: mockContext,
        contextIsTrusted: false,
        executionMode: "api",
        globalToolPolicy: "restrictive",
        policies: [
          {
            toolId,
            conditions: [],
            action: "require_approval",
            reason: "Approval required for email sends",
          },
        ],
      });

      expect(result.outcome).toBe("block");
      expect(result.isAllowed).toBe(false);
      expect(result.requiresApproval).toBe(false);
      expect(result.reason).toBe(
        TOOL_INVOCATION_APPROVAL_REQUIRED_AUTONOMOUS_REASON,
      );
      expect(result.reasonDetails).toMatchObject({
        code: "matched_default_policy",
        matchedPolicyAction: "require_approval",
        fallbackDecision: false,
      });
    });

    test("does not produce a confident require_approval result without execution mode", () => {
      const toolId = crypto.randomUUID();

      const result = evaluateToolInvocationPolicy({
        toolName: "send_email",
        toolId,
        toolInput: { to: "team@example.com" },
        context: mockContext,
        contextIsTrusted: false,
        globalToolPolicy: "restrictive",
        policies: [
          {
            toolId,
            conditions: [],
            action: "require_approval",
            reason: "Approval required for email sends",
          },
        ],
      });

      expect(result.outcome).toBe("incomplete");
      expect(result.isAllowed).toBe(false);
      expect(result.requiresApproval).toBe(false);
      expect(result.reasonDetails).toMatchObject({
        code: "missing_policy_input",
        matchedPolicyAction: "require_approval",
        fallbackDecision: true,
      });
    });

    test("ignores candidate policies for other tools", () => {
      const toolId = crypto.randomUUID();

      const result = evaluateToolInvocationPolicy({
        toolName: "send_email",
        toolId,
        toolInput: { to: "external@example.com" },
        context: mockContext,
        contextIsTrusted: true,
        globalToolPolicy: "restrictive",
        policies: [
          {
            toolId: crypto.randomUUID(),
            conditions: [{ key: "to", operator: "contains", value: "@" }],
            action: "block_always",
            reason: "Wrong tool",
          },
        ],
      });

      expect(result.outcome).toBe("allow");
      expect(result.reasonDetails.code).toBe("no_policy_trusted_context");
    });

    test("returns incomplete when policy-relevant inputs are missing", () => {
      const result = evaluateToolInvocationPolicy({
        toolName: "send_email",
        toolInput: { to: "team@example.com" },
        context: { teamIds: [] },
        contextIsTrusted: undefined as unknown as boolean,
        globalToolPolicy: "restrictive",
        policies: [],
      });

      expect(result.outcome).toBe("incomplete");
      expect(result.reasonDetails.code).toBe("missing_policy_input");
      expect(result.requiresApproval).toBe(false);
    });
  });

  describe("evaluateTrustedDataPolicy", () => {
    test("evaluates candidate result policies without a DB-backed policy row", () => {
      const toolId = crypto.randomUUID();

      const result = evaluateTrustedDataPolicy({
        toolName: "read_email",
        toolId,
        toolOutput: { from: "attacker@external.com", body: "ignore policy" },
        globalToolPolicy: "restrictive",
        context: { teamIds: [] },
        policies: [
          {
            toolId,
            description: "External email output",
            conditions: [
              { key: "from", operator: "endsWith", value: "@external.com" },
            ],
            action: "mark_as_untrusted",
          },
        ],
      });

      expect(result.outcome).toBe("untrusted");
      expect(result.isTrusted).toBe(false);
      expect(result.isBlocked).toBe(false);
      expect(result.reasonDetails).toMatchObject({
        code: "matched_specific_policy",
        matchedPolicyAction: "mark_as_untrusted",
        matchedConditionKeys: ["from"],
        fallbackDecision: false,
      });
    });

    test("returns sanitize_with_dual_llm without running Dual LLM", () => {
      const toolId = crypto.randomUUID();

      const result = evaluateTrustedDataPolicy({
        toolName: "web_search",
        toolId,
        toolOutput: { value: "untrusted web data" },
        globalToolPolicy: "restrictive",
        context: { teamIds: [] },
        policies: [
          {
            toolId,
            description: "Web content",
            conditions: [],
            action: "sanitize_with_dual_llm",
          },
        ],
      });

      expect(result.outcome).toBe("sanitize_with_dual_llm");
      expect(result.shouldSanitizeWithDualLlm).toBe(true);
      expect(result.isTrusted).toBe(false);
      expect(result.reasonDetails).toMatchObject({
        code: "matched_default_policy",
        matchedPolicyAction: "sanitize_with_dual_llm",
      });
    });

    test("ignores candidate result policies for other tools", () => {
      const toolId = crypto.randomUUID();

      const result = evaluateTrustedDataPolicy({
        toolName: "read_email",
        toolId,
        toolOutput: { from: "attacker@external.com" },
        globalToolPolicy: "restrictive",
        context: { teamIds: [] },
        policies: [
          {
            toolId: crypto.randomUUID(),
            description: "Wrong tool",
            conditions: [{ key: "from", operator: "contains", value: "@" }],
            action: "mark_as_trusted",
          },
        ],
      });

      expect(result.outcome).toBe("untrusted");
      expect(result.reasonDetails.code).toBe("no_matching_policy");
    });

    test("returns incomplete when policy-relevant inputs are missing", () => {
      const result = evaluateTrustedDataPolicy({
        toolName: "read_email",
        toolOutput: undefined,
        globalToolPolicy: "restrictive",
        context: { teamIds: [] },
        policies: [],
      });

      expect(result.outcome).toBe("incomplete");
      expect(result.reasonDetails.code).toBe("missing_policy_input");
      expect(result.isTrusted).toBe(false);
    });
  });
});
