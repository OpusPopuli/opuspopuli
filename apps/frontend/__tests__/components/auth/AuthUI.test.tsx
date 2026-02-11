import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import {
  AuthCard,
  AuthHeader,
  AuthErrorAlert,
  AuthInput,
  AuthSubmitButton,
  AuthDivider,
} from "@/components/auth/AuthUI";

describe("AuthCard", () => {
  it("should render children", () => {
    render(
      <AuthCard>
        <p>Card content</p>
      </AuthCard>,
    );

    expect(screen.getByText("Card content")).toBeInTheDocument();
  });

  it("should apply custom className", () => {
    const { container } = render(
      <AuthCard className="text-center">
        <p>Content</p>
      </AuthCard>,
    );

    expect(container.firstChild).toHaveClass("text-center");
  });

  it("should have base card styling", () => {
    const { container } = render(
      <AuthCard>
        <p>Content</p>
      </AuthCard>,
    );

    expect(container.firstChild).toHaveClass("bg-white", "rounded-2xl", "p-8");
  });
});

describe("AuthHeader", () => {
  it("should render title as heading", () => {
    render(<AuthHeader title="Welcome" subtitle="Sign in below" />);

    expect(
      screen.getByRole("heading", { name: "Welcome" }),
    ).toBeInTheDocument();
  });

  it("should render subtitle", () => {
    render(<AuthHeader title="Welcome" subtitle="Sign in below" />);

    expect(screen.getByText("Sign in below")).toBeInTheDocument();
  });
});

describe("AuthErrorAlert", () => {
  it("should render nothing when error is null", () => {
    const { container } = render(<AuthErrorAlert error={null} />);

    expect(container.firstChild).toBeNull();
  });

  it("should render nothing when error is undefined", () => {
    const { container } = render(<AuthErrorAlert error={undefined} />);

    expect(container.firstChild).toBeNull();
  });

  it("should render nothing when error is empty string", () => {
    const { container } = render(<AuthErrorAlert error="" />);

    expect(container.firstChild).toBeNull();
  });

  it("should render error message", () => {
    render(<AuthErrorAlert error="Something went wrong" />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("should have error styling", () => {
    const { container } = render(<AuthErrorAlert error="Error" />);

    expect(container.firstChild).toHaveClass("bg-red-50", "border-red-200");
  });
});

describe("AuthInput", () => {
  it("should render label and input", () => {
    render(
      <AuthInput id="email" label="Email" value="" onChange={jest.fn()} />,
    );

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("should display current value", () => {
    render(
      <AuthInput
        id="email"
        label="Email"
        value="test@example.com"
        onChange={jest.fn()}
      />,
    );

    expect(screen.getByDisplayValue("test@example.com")).toBeInTheDocument();
  });

  it("should call onChange with value when typing", async () => {
    const handleChange = jest.fn();
    const user = userEvent.setup();
    render(
      <AuthInput id="email" label="Email" value="" onChange={handleChange} />,
    );

    await user.type(screen.getByLabelText("Email"), "a");

    expect(handleChange).toHaveBeenCalledWith("a");
  });

  it("should apply placeholder", () => {
    render(
      <AuthInput
        id="email"
        label="Email"
        value=""
        onChange={jest.fn()}
        placeholder="you@example.com"
      />,
    );

    expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument();
  });

  it("should set input type", () => {
    render(
      <AuthInput
        id="email"
        label="Email"
        type="email"
        value=""
        onChange={jest.fn()}
      />,
    );

    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
  });

  it("should default type to text", () => {
    render(<AuthInput id="name" label="Name" value="" onChange={jest.fn()} />);

    expect(screen.getByLabelText("Name")).toHaveAttribute("type", "text");
  });

  it("should apply custom className to input", () => {
    render(
      <AuthInput
        id="code"
        label="Code"
        value=""
        onChange={jest.fn()}
        className="font-mono"
      />,
    );

    expect(screen.getByLabelText("Code")).toHaveClass("font-mono");
  });

  it("should set required attribute", () => {
    render(
      <AuthInput
        id="email"
        label="Email"
        value=""
        onChange={jest.fn()}
        required
      />,
    );

    expect(screen.getByLabelText("Email")).toBeRequired();
  });

  it("should set autoComplete attribute", () => {
    render(
      <AuthInput
        id="email"
        label="Email"
        value=""
        onChange={jest.fn()}
        autoComplete="email"
      />,
    );

    expect(screen.getByLabelText("Email")).toHaveAttribute(
      "autocomplete",
      "email",
    );
  });
});

describe("AuthSubmitButton", () => {
  it("should render children when not loading", () => {
    render(
      <AuthSubmitButton loadingText="Loading...">Submit</AuthSubmitButton>,
    );

    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
  });

  it("should show loading text when loading", () => {
    render(
      <AuthSubmitButton loading loadingText="Sending...">
        Submit
      </AuthSubmitButton>,
    );

    expect(screen.getByText("Sending...")).toBeInTheDocument();
    expect(screen.queryByText("Submit")).not.toBeInTheDocument();
  });

  it("should be disabled when loading", () => {
    render(
      <AuthSubmitButton loading loadingText="Loading...">
        Submit
      </AuthSubmitButton>,
    );

    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("should be disabled when disabled prop is true", () => {
    render(
      <AuthSubmitButton disabled loadingText="Loading...">
        Submit
      </AuthSubmitButton>,
    );

    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("should default to submit type", () => {
    render(
      <AuthSubmitButton loadingText="Loading...">Submit</AuthSubmitButton>,
    );

    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });

  it("should accept button type", () => {
    render(
      <AuthSubmitButton type="button" loadingText="Loading...">
        Click
      </AuthSubmitButton>,
    );

    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("should call onClick when clicked", async () => {
    const handleClick = jest.fn();
    const user = userEvent.setup();
    render(
      <AuthSubmitButton
        type="button"
        onClick={handleClick}
        loadingText="Loading..."
      >
        Click me
      </AuthSubmitButton>,
    );

    await user.click(screen.getByRole("button", { name: "Click me" }));

    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});

describe("AuthDivider", () => {
  it("should render 'or' text", () => {
    render(<AuthDivider />);

    expect(screen.getByText("or")).toBeInTheDocument();
  });
});
