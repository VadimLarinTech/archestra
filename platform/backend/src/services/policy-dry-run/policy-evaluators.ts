import {
  CONTEXT_EXTERNAL_AGENT_ID,
  CONTEXT_TEAM_IDS,
  isAgentTool,
  TOOL_INVOCATION_APPROVAL_REQUIRED_AUTONOMOUS_REASON,
  TOOL_INVOCATION_BLOCK_ALWAYS_REASON,
  TOOL_INVOCATION_NO_POLICY_UNTRUSTED_REASON,
  TOOL_INVOCATION_UNTRUSTED_CONTEXT_REASON,
} from "@shared";
import { get } from "lodash-es";
import { archestraMcpBranding } from "@/archestra-mcp-server/branding";
import type { CallPolicyCondition } from "@/database/schemas/tool-invocation-policy";
import type { ResultPolicyCondition } from "@/database/schemas/trusted-data-policy";
import type { PolicyEvaluationContext } from "@/models/tool-invocation-policy";
import type {
  AutonomyPolicyOperator,
  GlobalToolPolicy,
  ToolInvocation,
  TrustedData,
} from "@/types";

export type ToolInvocationPolicyForEvaluation = {
  id?: string;
  toolId: string;
  conditions: CallPolicyCondition[];
  action: ToolInvocation.ToolInvocationPolicyAction;
  reason?: string | null;
};

export type ToolInvocationDryRunOutcome =
  | "allow"
  | "require_approval"
  | "block"
  | "incomplete"
  | "unsupported";

export type PolicyEvaluationReason = {
  code:
    | "global_policy_permissive"
    | "built_in_tool"
    | "agent_tool"
    | "matched_specific_policy"
    | "matched_default_policy"
    | "untrusted_context"
    | "no_policy_untrusted_context"
    | "no_policy_trusted_context"
    | "tool_not_found"
    | "missing_policy_input";
  message: string;
  matchedPolicyId?: string;
  matchedPolicyAction?: ToolInvocation.ToolInvocationPolicyAction;
  matchedConditionKeys?: string[];
  fallbackDecision: boolean;
};

export type ToolInvocationDryRunResult = {
  outcome: ToolInvocationDryRunOutcome;
  isAllowed: boolean;
  requiresApproval: boolean;
  reason: string;
  reasonDetails: PolicyEvaluationReason;
  toolCallName: string;
  toolId?: string;
};

export type TrustedDataPolicyForEvaluation = {
  id?: string;
  toolId: string;
  description?: string | null;
  conditions: ResultPolicyCondition[];
  action: TrustedData.TrustedDataPolicyAction;
};

export type TrustedDataDryRunOutcome =
  | "trusted"
  | "untrusted"
  | "blocked"
  | "sanitize_with_dual_llm"
  | "incomplete"
  | "unsupported";

export type TrustedDataEvaluationReason = {
  code:
    | "global_policy_permissive"
    | "built_in_tool"
    | "matched_specific_policy"
    | "matched_default_policy"
    | "no_matching_policy"
    | "tool_not_found"
    | "missing_policy_input";
  message: string;
  matchedPolicyId?: string;
  matchedPolicyAction?: TrustedData.TrustedDataPolicyAction;
  matchedConditionKeys?: string[];
  fallbackDecision: boolean;
};

export type TrustedDataDryRunResult = {
  outcome: TrustedDataDryRunOutcome;
  isTrusted: boolean;
  isBlocked: boolean;
  shouldSanitizeWithDualLlm: boolean;
  reason: string;
  reasonDetails: TrustedDataEvaluationReason;
  toolName: string;
  toolId?: string;
};

const KNOWN_POLICY_EXECUTION_MODES = new Set([
  "api",
  "chat",
  "slack",
  "ms_teams",
  "email",
  "schedule_trigger",
]);

export function evaluateToolInvocationPolicy(params: {
  toolName: string;
  toolId?: string;
  // biome-ignore lint/suspicious/noExplicitAny: tool inputs can be any shape
  toolInput: Record<string, any>;
  context: PolicyEvaluationContext;
  contextIsTrusted: boolean;
  executionMode?: string;
  globalToolPolicy: GlobalToolPolicy;
  policies: ToolInvocationPolicyForEvaluation[];
}): ToolInvocationDryRunResult {
  const base = {
    toolCallName: params.toolName,
    toolId: params.toolId,
  };

  if (
    !params.toolName ||
    params.toolInput === undefined ||
    !params.context ||
    !Array.isArray(params.context.teamIds) ||
    typeof params.contextIsTrusted !== "boolean" ||
    !params.globalToolPolicy ||
    !Array.isArray(params.policies)
  ) {
    return {
      ...base,
      outcome: "incomplete",
      isAllowed: false,
      requiresApproval: false,
      reason: "Missing policy-relevant input",
      reasonDetails: {
        code: "missing_policy_input",
        message: "Missing policy-relevant input",
        fallbackDecision: true,
      },
    };
  }

  if (params.globalToolPolicy === "permissive") {
    return {
      ...base,
      outcome: "allow",
      isAllowed: true,
      requiresApproval: false,
      reason: "",
      reasonDetails: {
        code: "global_policy_permissive",
        message: "Allowed by permissive global policy",
        fallbackDecision: true,
      },
    };
  }

  if (archestraMcpBranding.isToolName(params.toolName)) {
    return {
      ...base,
      outcome: "allow",
      isAllowed: true,
      requiresApproval: false,
      reason: "",
      reasonDetails: {
        code: "built_in_tool",
        message: "Built-in Archestra tool bypasses policies",
        fallbackDecision: true,
      },
    };
  }

  if (isAgentTool(params.toolName)) {
    return {
      ...base,
      outcome: "allow",
      isAllowed: true,
      requiresApproval: false,
      reason: "",
      reasonDetails: {
        code: "agent_tool",
        message: "Agent delegation tool bypasses policies",
        fallbackDecision: true,
      },
    };
  }

  if (!params.toolId) {
    return {
      ...base,
      outcome: "allow",
      isAllowed: true,
      requiresApproval: false,
      reason: "",
      reasonDetails: {
        code: "tool_not_found",
        message: "Tool not found",
        fallbackDecision: true,
      },
    };
  }

  const resolvedPolicies = params.policies.filter(
    (policy) => policy.toolId === params.toolId,
  );
  const specificPolicies = resolvedPolicies.filter(
    (p) => p.conditions.length > 0,
  );
  const defaultPolicies = resolvedPolicies.filter(
    (p) => p.conditions.length === 0,
  );

  let matchedSpecificPolicy:
    | {
        policy: ToolInvocationPolicyForEvaluation;
        allowsUntrusted: boolean;
        requiresApproval: boolean;
      }
    | undefined;

  for (const policy of specificPolicies) {
    const conditionsMatch = evaluateInvocationConditions(
      policy.conditions,
      params.toolInput,
      params.context,
    );

    if (!conditionsMatch) continue;

    if (policy.action === "block_always") {
      return buildInvocationDecision({
        ...base,
        outcome: "block",
        isAllowed: false,
        requiresApproval: false,
        policy,
        reason: policy.reason ?? TOOL_INVOCATION_BLOCK_ALWAYS_REASON,
        reasonCode: "matched_specific_policy",
        fallbackDecision: false,
      });
    }

    if (policy.action === "block_when_context_is_untrusted") {
      if (!params.contextIsTrusted) {
        return buildInvocationDecision({
          ...base,
          outcome: "block",
          isAllowed: false,
          requiresApproval: false,
          policy,
          reason: TOOL_INVOCATION_UNTRUSTED_CONTEXT_REASON,
          reasonCode: "untrusted_context",
          fallbackDecision: false,
        });
      }

      matchedSpecificPolicy = {
        policy,
        allowsUntrusted: false,
        requiresApproval: false,
      };
      continue;
    }

    matchedSpecificPolicy = {
      policy,
      allowsUntrusted: true,
      requiresApproval: policy.action === "require_approval",
    };
  }

  if (matchedSpecificPolicy) {
    const { policy } = matchedSpecificPolicy;
    if (matchedSpecificPolicy.requiresApproval) {
      return buildRequireApprovalDecision({
        ...base,
        policy,
        reasonCode: "matched_specific_policy",
        executionMode: params.executionMode,
      });
    }

    if (!params.contextIsTrusted && !matchedSpecificPolicy.allowsUntrusted) {
      return buildInvocationDecision({
        ...base,
        outcome: "block",
        isAllowed: false,
        requiresApproval: false,
        policy,
        reason: TOOL_INVOCATION_UNTRUSTED_CONTEXT_REASON,
        reasonCode: "untrusted_context",
        fallbackDecision: false,
      });
    }

    return buildInvocationDecision({
      ...base,
      outcome: "allow",
      isAllowed: true,
      requiresApproval: false,
      policy,
      reason: "",
      reasonCode: "matched_specific_policy",
      fallbackDecision: false,
    });
  }

  for (const policy of defaultPolicies) {
    if (policy.action === "block_always") {
      return buildInvocationDecision({
        ...base,
        outcome: "block",
        isAllowed: false,
        requiresApproval: false,
        policy,
        reason: policy.reason ?? TOOL_INVOCATION_BLOCK_ALWAYS_REASON,
        reasonCode: "matched_default_policy",
        fallbackDecision: false,
      });
    }

    if (policy.action === "block_when_context_is_untrusted") {
      if (!params.contextIsTrusted) {
        return buildInvocationDecision({
          ...base,
          outcome: "block",
          isAllowed: false,
          requiresApproval: false,
          policy,
          reason: TOOL_INVOCATION_UNTRUSTED_CONTEXT_REASON,
          reasonCode: "untrusted_context",
          fallbackDecision: false,
        });
      }

      return buildInvocationDecision({
        ...base,
        outcome: "allow",
        isAllowed: true,
        requiresApproval: false,
        policy,
        reason: "",
        reasonCode: "matched_default_policy",
        fallbackDecision: false,
      });
    }

    if (policy.action === "require_approval") {
      return buildRequireApprovalDecision({
        ...base,
        policy,
        reasonCode: "matched_default_policy",
        executionMode: params.executionMode,
      });
    }

    return buildInvocationDecision({
      ...base,
      outcome: "allow",
      isAllowed: true,
      requiresApproval: false,
      policy,
      reason: "",
      reasonCode: "matched_default_policy",
      fallbackDecision: false,
    });
  }

  if (!params.contextIsTrusted) {
    return {
      ...base,
      outcome: "block",
      isAllowed: false,
      requiresApproval: false,
      reason: TOOL_INVOCATION_NO_POLICY_UNTRUSTED_REASON,
      reasonDetails: {
        code: "no_policy_untrusted_context",
        message: TOOL_INVOCATION_NO_POLICY_UNTRUSTED_REASON,
        fallbackDecision: true,
      },
    };
  }

  return {
    ...base,
    outcome: "allow",
    isAllowed: true,
    requiresApproval: false,
    reason: "",
    reasonDetails: {
      code: "no_policy_trusted_context",
      message: "No matching policy required blocking",
      fallbackDecision: true,
    },
  };
}

export function evaluateTrustedDataPolicy(params: {
  toolName: string;
  toolId?: string;
  // biome-ignore lint/suspicious/noExplicitAny: tool outputs can be any shape
  toolOutput: any;
  context: PolicyEvaluationContext;
  globalToolPolicy: GlobalToolPolicy;
  policies: TrustedDataPolicyForEvaluation[];
}): TrustedDataDryRunResult {
  const base = {
    toolName: params.toolName,
    toolId: params.toolId,
  };

  if (
    !params.toolName ||
    params.toolOutput === undefined ||
    !params.context ||
    !Array.isArray(params.context.teamIds) ||
    !params.globalToolPolicy ||
    !Array.isArray(params.policies)
  ) {
    return {
      ...base,
      outcome: "incomplete",
      isTrusted: false,
      isBlocked: false,
      shouldSanitizeWithDualLlm: false,
      reason: "Missing policy-relevant input",
      reasonDetails: {
        code: "missing_policy_input",
        message: "Missing policy-relevant input",
        fallbackDecision: true,
      },
    };
  }

  if (params.globalToolPolicy === "permissive") {
    return {
      ...base,
      outcome: "trusted",
      isTrusted: true,
      isBlocked: false,
      shouldSanitizeWithDualLlm: false,
      reason: "Trusted by permissive global policy",
      reasonDetails: {
        code: "global_policy_permissive",
        message: "Trusted by permissive global policy",
        fallbackDecision: true,
      },
    };
  }

  if (archestraMcpBranding.isToolName(params.toolName)) {
    return {
      ...base,
      outcome: "trusted",
      isTrusted: true,
      isBlocked: false,
      shouldSanitizeWithDualLlm: false,
      reason: "Built-in MCP server tool",
      reasonDetails: {
        code: "built_in_tool",
        message: "Built-in MCP server tool",
        fallbackDecision: true,
      },
    };
  }

  if (!params.toolId) {
    return {
      ...base,
      outcome: "untrusted",
      isTrusted: false,
      isBlocked: false,
      shouldSanitizeWithDualLlm: false,
      reason: `Tool ${params.toolName} not found`,
      reasonDetails: {
        code: "tool_not_found",
        message: `Tool ${params.toolName} not found`,
        fallbackDecision: true,
      },
    };
  }

  const resolvedPolicies = params.policies.filter(
    (policy) => policy.toolId === params.toolId,
  );
  const specificPolicies = resolvedPolicies.filter(
    (p) => !isDefaultPolicy(p.conditions),
  );
  const defaultPolicies = resolvedPolicies.filter((p) =>
    isDefaultPolicy(p.conditions),
  );

  for (const policy of specificPolicies) {
    if (
      policy.action === "block_always" &&
      evaluateResultConditions(
        policy.conditions,
        params.toolOutput,
        params.context,
      )
    ) {
      return buildTrustedDataDecision({
        ...base,
        policy,
        policyKind: "specific",
      });
    }
  }

  for (const policy of specificPolicies) {
    if (
      evaluateResultConditions(
        policy.conditions,
        params.toolOutput,
        params.context,
      )
    ) {
      return buildTrustedDataDecision({
        ...base,
        policy,
        policyKind: "specific",
      });
    }
  }

  const defaultPolicy = defaultPolicies[0];
  if (defaultPolicy) {
    return buildTrustedDataDecision({
      ...base,
      policy: defaultPolicy,
      policyKind: "default",
    });
  }

  return {
    ...base,
    outcome: "untrusted",
    isTrusted: false,
    isBlocked: false,
    shouldSanitizeWithDualLlm: false,
    reason: "No matching policies - data is untrusted by default",
    reasonDetails: {
      code: "no_matching_policy",
      message: "No matching policies - data is untrusted by default",
      fallbackDecision: true,
    },
  };
}

function isDefaultPolicy(conditions: ResultPolicyCondition[]): boolean {
  return conditions.length === 0;
}

function evaluateInvocationConditions(
  conditions: CallPolicyCondition[],
  // biome-ignore lint/suspicious/noExplicitAny: tool inputs can be any shape
  toolInput: Record<string, any>,
  context: PolicyEvaluationContext,
): boolean {
  return conditions.every((condition) => {
    const { key, value, operator } = condition;
    if (key.startsWith("context.")) {
      return evaluateContextCondition(key, value, operator, context);
    }
    return evaluateInputCondition(key, value, operator, toolInput);
  });
}

function evaluateContextCondition(
  key: string,
  value: string,
  operator: AutonomyPolicyOperator.SupportedOperator,
  context: PolicyEvaluationContext,
): boolean {
  if (key === CONTEXT_TEAM_IDS) {
    switch (operator) {
      case "contains":
        return context.teamIds.includes(value);
      case "notContains":
        return !context.teamIds.includes(value);
      default:
        return false;
    }
  }

  if (key === CONTEXT_EXTERNAL_AGENT_ID) {
    const contextValue = context.externalAgentId;
    switch (operator) {
      case "equal":
        return contextValue === value;
      case "notEqual":
        return contextValue !== value;
      default:
        return false;
    }
  }

  return false;
}

function evaluateInputCondition(
  key: string,
  value: string,
  operator: AutonomyPolicyOperator.SupportedOperator,
  // biome-ignore lint/suspicious/noExplicitAny: tool inputs can be any shape
  input: Record<string, any>,
): boolean {
  const argumentValue = get(input, key);
  if (argumentValue === undefined) return false;

  switch (operator) {
    case "endsWith":
      return typeof argumentValue === "string" && argumentValue.endsWith(value);
    case "startsWith":
      return (
        typeof argumentValue === "string" && argumentValue.startsWith(value)
      );
    case "contains":
      return typeof argumentValue === "string" && argumentValue.includes(value);
    case "notContains":
      return (
        typeof argumentValue === "string" && !argumentValue.includes(value)
      );
    case "equal":
      return argumentValue === value;
    case "notEqual":
      return argumentValue !== value;
    case "regex":
      return (
        typeof argumentValue === "string" &&
        new RegExp(value).test(argumentValue)
      );
    default:
      return false;
  }
}

function evaluateResultConditions(
  conditions: ResultPolicyCondition[],
  // biome-ignore lint/suspicious/noExplicitAny: tool outputs can be any shape
  toolOutput: any,
  context: PolicyEvaluationContext,
): boolean {
  if (conditions.length === 0) {
    return true;
  }

  for (const condition of conditions) {
    const { key, value, operator } = condition;

    if (key.startsWith("context.")) {
      if (!evaluateContextCondition(key, value, operator, context)) {
        return false;
      }
      continue;
    }

    const outputValue = toolOutput?.value || toolOutput;
    const values = extractValuesFromPath(outputValue, key);
    if (values.length === 0) {
      return false;
    }

    const allMatch = values.every((v) =>
      evaluateOutputCondition(v, operator, value),
    );
    if (!allMatch) {
      return false;
    }
  }

  return true;
}

// biome-ignore lint/suspicious/noExplicitAny: tool outputs can be any shape
function extractValuesFromPath(obj: any, path: string): any[] {
  if (path.includes("[*]")) {
    const parts = path.split("[*].");
    const arrayPath = parts[0];
    const itemPath = parts[1];

    const array = get(obj, arrayPath);
    if (!Array.isArray(array)) {
      return [];
    }

    return array
      .map((item) => get(item, itemPath))
      .filter((v) => v !== undefined);
  }

  const value = get(obj, path);
  return value !== undefined ? [value] : [];
}

function evaluateOutputCondition(
  // biome-ignore lint/suspicious/noExplicitAny: policy values can be any type
  value: any,
  operator: AutonomyPolicyOperator.SupportedOperator,
  policyValue: string,
): boolean {
  switch (operator) {
    case "endsWith":
      return typeof value === "string" && value.endsWith(policyValue);
    case "startsWith":
      return typeof value === "string" && value.startsWith(policyValue);
    case "contains":
      return typeof value === "string" && value.includes(policyValue);
    case "notContains":
      return typeof value === "string" && !value.includes(policyValue);
    case "equal":
      return value === policyValue;
    case "notEqual":
      return value !== policyValue;
    case "regex":
      return typeof value === "string" && new RegExp(policyValue).test(value);
    default:
      return false;
  }
}

function buildInvocationDecision(params: {
  toolCallName: string;
  toolId?: string;
  outcome: Exclude<ToolInvocationDryRunOutcome, "incomplete" | "unsupported">;
  isAllowed: boolean;
  requiresApproval: boolean;
  policy: ToolInvocationPolicyForEvaluation;
  reason: string;
  reasonCode: PolicyEvaluationReason["code"];
  fallbackDecision: boolean;
}): ToolInvocationDryRunResult {
  return {
    toolCallName: params.toolCallName,
    toolId: params.toolId,
    outcome: params.outcome,
    isAllowed: params.isAllowed,
    requiresApproval: params.requiresApproval,
    reason: params.reason,
    reasonDetails: {
      code: params.reasonCode,
      message: params.reason || params.outcome,
      matchedPolicyId: params.policy.id,
      matchedPolicyAction: params.policy.action,
      matchedConditionKeys: params.policy.conditions.map(
        (condition) => condition.key,
      ),
      fallbackDecision: params.fallbackDecision,
    },
  };
}

function buildRequireApprovalDecision(params: {
  toolCallName: string;
  toolId?: string;
  policy: ToolInvocationPolicyForEvaluation;
  reasonCode: Extract<
    PolicyEvaluationReason["code"],
    "matched_specific_policy" | "matched_default_policy"
  >;
  executionMode?: string;
}): ToolInvocationDryRunResult {
  const missingExecutionMode =
    !params.executionMode ||
    !KNOWN_POLICY_EXECUTION_MODES.has(params.executionMode);
  if (missingExecutionMode) {
    const reason =
      "Missing execution/source mode for approval policy evaluation";
    return {
      toolCallName: params.toolCallName,
      toolId: params.toolId,
      outcome: "incomplete",
      isAllowed: false,
      requiresApproval: false,
      reason,
      reasonDetails: {
        code: "missing_policy_input",
        message: reason,
        matchedPolicyId: params.policy.id,
        matchedPolicyAction: params.policy.action,
        matchedConditionKeys: params.policy.conditions.map(
          (condition) => condition.key,
        ),
        fallbackDecision: true,
      },
    };
  }

  if (params.executionMode !== "chat") {
    return buildInvocationDecision({
      toolCallName: params.toolCallName,
      toolId: params.toolId,
      outcome: "block",
      isAllowed: false,
      requiresApproval: false,
      policy: params.policy,
      reason: TOOL_INVOCATION_APPROVAL_REQUIRED_AUTONOMOUS_REASON,
      reasonCode: params.reasonCode,
      fallbackDecision: false,
    });
  }

  return buildInvocationDecision({
    toolCallName: params.toolCallName,
    toolId: params.toolId,
    outcome: "require_approval",
    isAllowed: true,
    requiresApproval: true,
    policy: params.policy,
    reason: params.policy.reason ?? "Tool invocation requires approval",
    reasonCode: params.reasonCode,
    fallbackDecision: false,
  });
}

function buildTrustedDataDecision(params: {
  toolName: string;
  toolId?: string;
  policy: TrustedDataPolicyForEvaluation;
  policyKind: "specific" | "default";
}): TrustedDataDryRunResult {
  const policyLabel = params.policy.description || "Unnamed policy";
  const byPolicy =
    params.policyKind === "default" ? "default policy" : "policy";
  const reasonCode =
    params.policyKind === "default"
      ? "matched_default_policy"
      : "matched_specific_policy";

  const baseReasonDetails = {
    code: reasonCode,
    matchedPolicyId: params.policy.id,
    matchedPolicyAction: params.policy.action,
    matchedConditionKeys: params.policy.conditions.map(
      (condition) => condition.key,
    ),
    fallbackDecision: false,
  } satisfies Omit<TrustedDataEvaluationReason, "message">;

  switch (params.policy.action) {
    case "block_always": {
      const message = `Data blocked by ${byPolicy}: ${policyLabel}`;
      return {
        toolName: params.toolName,
        toolId: params.toolId,
        outcome: "blocked",
        isTrusted: false,
        isBlocked: true,
        shouldSanitizeWithDualLlm: false,
        reason: message,
        reasonDetails: { ...baseReasonDetails, message },
      };
    }
    case "mark_as_trusted": {
      const message = `Data trusted by ${byPolicy}: ${policyLabel}`;
      return {
        toolName: params.toolName,
        toolId: params.toolId,
        outcome: "trusted",
        isTrusted: true,
        isBlocked: false,
        shouldSanitizeWithDualLlm: false,
        reason: message,
        reasonDetails: { ...baseReasonDetails, message },
      };
    }
    case "mark_as_untrusted": {
      const message = `Data untrusted by ${byPolicy}: ${policyLabel}`;
      return {
        toolName: params.toolName,
        toolId: params.toolId,
        outcome: "untrusted",
        isTrusted: false,
        isBlocked: false,
        shouldSanitizeWithDualLlm: false,
        reason: message,
        reasonDetails: { ...baseReasonDetails, message },
      };
    }
    case "sanitize_with_dual_llm": {
      const message = `Data requires dual LLM sanitization by ${byPolicy}: ${policyLabel}`;
      return {
        toolName: params.toolName,
        toolId: params.toolId,
        outcome: "sanitize_with_dual_llm",
        isTrusted: false,
        isBlocked: false,
        shouldSanitizeWithDualLlm: true,
        reason: message,
        reasonDetails: { ...baseReasonDetails, message },
      };
    }
  }
}
