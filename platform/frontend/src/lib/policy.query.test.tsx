import { archestraApiSdk } from "@shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useCallPolicyMutation,
  usePolicyDryRunMutation,
  useResultPolicyMutation,
} from "./policy.query";
import { handleApiError } from "./utils";

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock("@shared", async () => {
  const actual = await vi.importActual("@shared");
  return {
    ...actual,
    archestraApiSdk: {
      createToolInvocationPolicy: vi.fn(),
      updateToolInvocationPolicy: vi.fn(),
      createTrustedDataPolicy: vi.fn(),
      updateTrustedDataPolicy: vi.fn(),
      runPolicyDryRun: vi.fn(),
    },
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

vi.mock("./utils", async () => {
  const actual = await vi.importActual("./utils");
  return {
    ...actual,
    handleApiError: vi.fn(),
  };
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  queryClient.setQueryData(["tool-invocation-policies"], {
    byProfileToolId: {},
  });
  queryClient.setQueryData(["tool-result-policies"], {
    byProfileToolId: {},
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("policy row update mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a success toast for single call policy updates", async () => {
    vi.mocked(archestraApiSdk.createToolInvocationPolicy).mockResolvedValue({
      data: { id: "policy-1" },
    } as Awaited<
      ReturnType<typeof archestraApiSdk.createToolInvocationPolicy>
    >);

    const { result } = renderHook(() => useCallPolicyMutation(), {
      wrapper: createWrapper(),
    });

    const mutationResult = await result.current.mutateAsync({
      toolId: "tool-1",
      action: "block_always",
    });

    expect(mutationResult).toBe(true);
    expect(mockToastSuccess).toHaveBeenCalledWith("Call policy updated");
    expect(handleApiError).not.toHaveBeenCalled();
  });

  it("shows a success toast for single result policy updates", async () => {
    vi.mocked(archestraApiSdk.createTrustedDataPolicy).mockResolvedValue({
      data: { id: "policy-1" },
    } as Awaited<ReturnType<typeof archestraApiSdk.createTrustedDataPolicy>>);

    const { result } = renderHook(() => useResultPolicyMutation(), {
      wrapper: createWrapper(),
    });

    const mutationResult = await result.current.mutateAsync({
      toolId: "tool-1",
      action: "mark_as_untrusted",
    });

    expect(mutationResult).toBe(true);
    expect(mockToastSuccess).toHaveBeenCalledWith("Result policy updated");
    expect(handleApiError).not.toHaveBeenCalled();
  });

  it("can suppress dry-run error toasts for bulk preview flows", async () => {
    vi.mocked(archestraApiSdk.runPolicyDryRun).mockResolvedValue({
      error: "dry run unavailable",
    } as unknown as Awaited<
      ReturnType<typeof archestraApiSdk.runPolicyDryRun>
    >);

    const { result } = renderHook(
      () => usePolicyDryRunMutation({ showErrorToast: false }),
      {
        wrapper: createWrapper(),
      },
    );

    await expect(
      result.current.mutateAsync({
        policyFamily: "tool_call",
        limit: 1,
      }),
    ).rejects.toThrow("dry run unavailable");
    expect(mockToastError).not.toHaveBeenCalled();
  });
});
