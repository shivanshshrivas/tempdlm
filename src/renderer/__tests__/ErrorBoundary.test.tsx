// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "../components/ErrorBoundary";

function ThrowingChild(): never {
  throw new Error("Boom from child");
}

describe("ErrorBoundary", () => {
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    consoleErrorSpy.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders fallback UI when a child throws during render", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
    const expectedMessage = import.meta.env.DEV
      ? "Boom from child"
      : "An unexpected error occurred.";
    expect(screen.getByText(expectedMessage)).toBeInTheDocument();
  });

  it("shows a reload button in the fallback UI", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });
});
