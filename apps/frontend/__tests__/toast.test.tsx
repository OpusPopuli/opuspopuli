import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { Toast, ToastContainer } from "@/components/Toast";
import { ToastProvider, useToast } from "@/lib/toast";
import type { ToastMessage } from "@/lib/toast";

describe("Toast Component", () => {
  const mockOnDismiss = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const createToast = (
    overrides: Partial<ToastMessage> = {},
  ): ToastMessage => ({
    id: "test-toast-1",
    type: "success",
    message: "Test message",
    duration: 5000,
    ...overrides,
  });

  describe("Toast rendering", () => {
    it("should render success toast with correct styling", () => {
      render(
        <Toast
          toast={createToast({ type: "success" })}
          onDismiss={mockOnDismiss}
        />,
      );

      const toast = screen.getByRole("alert");
      expect(toast).toHaveTextContent("Test message");
      expect(toast).toHaveClass("bg-positive-solid");
    });

    it("should render error toast with correct styling", () => {
      render(
        <Toast
          toast={createToast({ type: "error" })}
          onDismiss={mockOnDismiss}
        />,
      );

      const toast = screen.getByRole("alert");
      expect(toast).toHaveClass("bg-danger-solid");
    });

    it("should render warning toast with correct styling", () => {
      render(
        <Toast
          toast={createToast({ type: "warning" })}
          onDismiss={mockOnDismiss}
        />,
      );

      const toast = screen.getByRole("alert");
      expect(toast).toHaveClass("bg-warning-solid");
    });

    it("should render info toast with correct styling", () => {
      render(
        <Toast
          toast={createToast({ type: "info" })}
          onDismiss={mockOnDismiss}
        />,
      );

      const toast = screen.getByRole("alert");
      expect(toast).toHaveClass("bg-info-solid");
    });

    it("should have correct accessibility attributes", () => {
      render(<Toast toast={createToast()} onDismiss={mockOnDismiss} />);

      const toast = screen.getByRole("alert");
      expect(toast).toHaveAttribute("aria-live", "assertive");
      expect(toast).toHaveAttribute("aria-atomic", "true");
    });

    it("should have accessible close button", () => {
      render(<Toast toast={createToast()} onDismiss={mockOnDismiss} />);

      const closeButton = screen.getByRole("button", {
        name: /close notification/i,
      });
      expect(closeButton).toBeInTheDocument();
    });
  });

  describe("Toast auto-dismiss", () => {
    it("should auto-dismiss after specified duration", () => {
      render(
        <Toast
          toast={createToast({ duration: 3000 })}
          onDismiss={mockOnDismiss}
        />,
      );

      expect(mockOnDismiss).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(3000);
      });

      expect(mockOnDismiss).toHaveBeenCalledTimes(1);
    });

    it("should not auto-dismiss when duration is 0", () => {
      render(
        <Toast
          toast={createToast({ duration: 0 })}
          onDismiss={mockOnDismiss}
        />,
      );

      act(() => {
        jest.advanceTimersByTime(10000);
      });

      expect(mockOnDismiss).not.toHaveBeenCalled();
    });

    it("should not auto-dismiss when duration is undefined", () => {
      render(
        <Toast
          toast={createToast({ duration: undefined })}
          onDismiss={mockOnDismiss}
        />,
      );

      act(() => {
        jest.advanceTimersByTime(10000);
      });

      expect(mockOnDismiss).not.toHaveBeenCalled();
    });
  });

  describe("Toast manual dismiss", () => {
    it("should call onDismiss when close button is clicked", async () => {
      jest.useRealTimers();
      const user = userEvent.setup();
      render(<Toast toast={createToast()} onDismiss={mockOnDismiss} />);

      await user.click(
        screen.getByRole("button", { name: /close notification/i }),
      );

      expect(mockOnDismiss).toHaveBeenCalledTimes(1);
    });
  });
});

describe("ToastContainer", () => {
  it("should render children", () => {
    render(
      <ToastContainer>
        <div data-testid="child">Child content</div>
      </ToastContainer>,
    );

    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("should have correct accessibility attributes", () => {
    render(
      <ToastContainer>
        <div>Content</div>
      </ToastContainer>,
    );

    expect(screen.getByLabelText("Notifications")).toBeInTheDocument();
  });

  it("should be positioned fixed in top right", () => {
    render(
      <ToastContainer>
        <div>Content</div>
      </ToastContainer>,
    );

    const container = screen.getByLabelText("Notifications");
    expect(container).toHaveClass("fixed", "top-4", "right-4", "z-50");
  });
});

describe("ToastProvider and useToast", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function TestComponent() {
    const { toasts, showToast, dismissToast, clearAllToasts } = useToast();
    return (
      <div>
        <button onClick={() => showToast("Success!", "success")}>
          Show Success
        </button>
        <button onClick={() => showToast("Error!", "error")}>Show Error</button>
        <button onClick={() => showToast("Warning!", "warning")}>
          Show Warning
        </button>
        <button onClick={() => showToast("Info!", "info")}>Show Info</button>
        <button onClick={clearAllToasts}>Clear All</button>
        <div data-testid="toast-count">{toasts.length}</div>
        {toasts.map((toast) => (
          <div key={toast.id} data-testid={`toast-${toast.id}`}>
            {toast.message}
            <button onClick={() => dismissToast(toast.id)}>Dismiss</button>
          </div>
        ))}
      </div>
    );
  }

  it("should throw error when useToast is used outside provider", () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    expect(() => {
      render(<TestComponent />);
    }).toThrow("useToast must be used within a ToastProvider");

    consoleError.mockRestore();
  });

  it("should show toast when showToast is called", async () => {
    jest.useRealTimers();
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>,
    );

    await user.click(screen.getByText("Show Success"));

    // Toast appears in both TestComponent state display and actual Toast component
    expect(screen.getAllByText("Success!")).toHaveLength(2);
    expect(screen.getByTestId("toast-count")).toHaveTextContent("1");
  });

  it("should show multiple toasts", async () => {
    jest.useRealTimers();
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>,
    );

    await user.click(screen.getByText("Show Success"));
    await user.click(screen.getByText("Show Error"));

    // Each toast appears in both TestComponent state display and actual Toast component
    expect(screen.getAllByText("Success!")).toHaveLength(2);
    expect(screen.getAllByText("Error!")).toHaveLength(2);
    expect(screen.getByTestId("toast-count")).toHaveTextContent("2");
  });

  it("should dismiss individual toast", async () => {
    jest.useRealTimers();
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>,
    );

    await user.click(screen.getByText("Show Success"));
    expect(screen.getByTestId("toast-count")).toHaveTextContent("1");

    await user.click(screen.getByText("Dismiss"));
    expect(screen.getByTestId("toast-count")).toHaveTextContent("0");
  });

  it("should clear all toasts", async () => {
    jest.useRealTimers();
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>,
    );

    await user.click(screen.getByText("Show Success"));
    await user.click(screen.getByText("Show Error"));
    expect(screen.getByTestId("toast-count")).toHaveTextContent("2");

    await user.click(screen.getByText("Clear All"));
    expect(screen.getByTestId("toast-count")).toHaveTextContent("0");
  });

  it("should auto-dismiss toasts after duration", async () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>,
    );

    await act(async () => {
      screen.getByText("Show Success").click();
    });

    expect(screen.getByTestId("toast-count")).toHaveTextContent("1");

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    await waitFor(() => {
      expect(screen.getByTestId("toast-count")).toHaveTextContent("0");
    });
  });

  it("should return toast id from showToast", async () => {
    jest.useRealTimers();
    let toastId: string | undefined;

    function TestIdComponent() {
      const { showToast } = useToast();
      return (
        <button
          onClick={() => {
            toastId = showToast("Test");
          }}
        >
          Show
        </button>
      );
    }

    const user = userEvent.setup();
    render(
      <ToastProvider>
        <TestIdComponent />
      </ToastProvider>,
    );

    await user.click(screen.getByText("Show"));

    expect(toastId).toBeDefined();
    expect(toastId).toMatch(/^toast-\d+$/);
  });
});
