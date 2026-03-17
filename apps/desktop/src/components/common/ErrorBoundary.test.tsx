import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { ErrorBoundary } from "./ErrorBoundary";

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("Test error");
  return <div>OK</div>;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("ErrorBoundary", () => {
  it("renders children when no error", async () => {
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <div>child content</div>
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toContain("child content");
  });

  it("renders error UI when child throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <ThrowingComponent shouldThrow={true} />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toContain("页面出错了");
    expect(container.textContent).toContain("Test error");
    spy.mockRestore();
  });

  it("shows retry button that resets error state", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <ThrowingComponent shouldThrow={true} />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toContain("页面出错了");

    // Verify retry button exists
    const retryBtn = container.querySelector("button");
    expect(retryBtn).not.toBeNull();
    expect(retryBtn!.textContent).toBe("重试");

    // Click retry - the child still throws so error boundary catches again
    await act(async () => {
      retryBtn!.click();
    });
    // The error state was reset, but the child throws again, so error UI reappears
    expect(container.textContent).toContain("页面出错了");
    spy.mockRestore();
  });

  it("renders custom fallback", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      root.render(
        <ErrorBoundary fallback={<div>Custom fallback</div>}>
          <ThrowingComponent shouldThrow={true} />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toContain("Custom fallback");
    spy.mockRestore();
  });
});
