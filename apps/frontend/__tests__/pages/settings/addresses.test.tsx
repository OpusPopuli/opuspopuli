import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import AddressesPage from "@/app/settings/addresses/page";

// Mock Apollo Client
const mockRefetch = jest.fn();
const mockCreateAddress = jest.fn();
const mockUpdateAddress = jest.fn();
const mockDeleteAddress = jest.fn();
const mockSetPrimaryAddress = jest.fn();

let mockQueryResult = {
  data: null as { myAddresses: unknown[] } | null,
  loading: false,
  error: null as Error | null,
  refetch: mockRefetch,
};

const mockMutationResults = {
  create: { loading: false },
  update: { loading: false },
  delete: { loading: false },
  setPrimary: { loading: false },
};

jest.mock("@apollo/client/react", () => ({
  useQuery: () => mockQueryResult,
  useMutation: (mutation: unknown) => {
    // Return different mocks based on the mutation
    if (mutation === require("@/lib/graphql/profile").CREATE_ADDRESS) {
      return [mockCreateAddress, mockMutationResults.create];
    }
    if (mutation === require("@/lib/graphql/profile").UPDATE_ADDRESS) {
      return [mockUpdateAddress, mockMutationResults.update];
    }
    if (mutation === require("@/lib/graphql/profile").DELETE_ADDRESS) {
      return [mockDeleteAddress, mockMutationResults.delete];
    }
    if (mutation === require("@/lib/graphql/profile").SET_PRIMARY_ADDRESS) {
      return [mockSetPrimaryAddress, mockMutationResults.setPrimary];
    }
    return [jest.fn(), { loading: false }];
  },
}));

const mockAddresses = [
  {
    id: "addr-1",
    userId: "user-1",
    addressType: "RESIDENTIAL",
    isPrimary: true,
    label: "Home",
    addressLine1: "123 Main St",
    addressLine2: "Apt 4",
    city: "San Francisco",
    state: "CA",
    postalCode: "94102",
    country: "US",
    isVerified: true,
    congressionalDistrict: "CA-12",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "addr-2",
    userId: "user-1",
    addressType: "MAILING",
    isPrimary: false,
    label: "Work",
    addressLine1: "456 Office Blvd",
    addressLine2: null,
    city: "Oakland",
    state: "CA",
    postalCode: "94612",
    country: "US",
    isVerified: false,
    congressionalDistrict: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
];

describe("AddressesPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryResult = {
      data: { myAddresses: mockAddresses },
      loading: false,
      error: null,
      refetch: mockRefetch,
    };
    globalThis.confirm = jest.fn(() => true);
    globalThis.alert = jest.fn();
  });

  describe("loading state", () => {
    it("should show loading skeleton when data is loading", () => {
      mockQueryResult = {
        data: null,
        loading: true,
        error: null,
        refetch: mockRefetch,
      };

      const { container } = render(<AddressesPage />);

      expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("should show error message when query fails", () => {
      mockQueryResult = {
        data: null,
        loading: false,
        error: new Error("Failed to load"),
        refetch: mockRefetch,
      };

      render(<AddressesPage />);

      expect(
        screen.getByText("Failed to load data. Please try again."),
      ).toBeInTheDocument();
    });
  });

  describe("rendering", () => {
    it("should render the page header", () => {
      render(<AddressesPage />);

      expect(screen.getByText("Addresses")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Manage your addresses for civic and mailing purposes",
        ),
      ).toBeInTheDocument();
    });

    it("should render Add Address button", () => {
      render(<AddressesPage />);

      expect(
        screen.getByRole("button", { name: "Add Address" }),
      ).toBeInTheDocument();
    });

    it("should render address list", () => {
      render(<AddressesPage />);

      expect(screen.getByText("Home")).toBeInTheDocument();
      expect(screen.getByText("123 Main St, Apt 4")).toBeInTheDocument();
      expect(screen.getByText("San Francisco, CA 94102")).toBeInTheDocument();
    });

    it("should show Primary badge for primary address", () => {
      render(<AddressesPage />);

      expect(screen.getByText("Primary")).toBeInTheDocument();
    });

    it("should show Verified badge for verified address", () => {
      render(<AddressesPage />);

      expect(screen.getByText("Verified")).toBeInTheDocument();
    });

    it("should show Set Primary button for non-primary addresses", () => {
      render(<AddressesPage />);

      expect(screen.getByText("Set Primary")).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("should show empty state when no addresses exist", () => {
      mockQueryResult = {
        data: { myAddresses: [] },
        loading: false,
        error: null,
        refetch: mockRefetch,
      };

      render(<AddressesPage />);

      expect(screen.getByText("No addresses added yet")).toBeInTheDocument();
      expect(
        screen.getByText("Add an address to get started"),
      ).toBeInTheDocument();
    });
  });

  describe("add address form", () => {
    it("should show form when Add Address is clicked", async () => {
      const user = userEvent.setup();
      render(<AddressesPage />);

      await user.click(screen.getByRole("button", { name: "Add Address" }));

      expect(screen.getByText("Add New Address")).toBeInTheDocument();
      expect(screen.getByText("Street Address *")).toBeInTheDocument();
      expect(screen.getByText("City *")).toBeInTheDocument();
      expect(screen.getByText("State *")).toBeInTheDocument();
      expect(screen.getByText("ZIP Code *")).toBeInTheDocument();
    });

    it("should hide form when Cancel is clicked", async () => {
      const user = userEvent.setup();
      render(<AddressesPage />);

      await user.click(screen.getByRole("button", { name: "Add Address" }));
      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByText("Add New Address")).not.toBeInTheDocument();
    });

    it("should have submit button in the form", async () => {
      const user = userEvent.setup();
      render(<AddressesPage />);

      await user.click(screen.getByRole("button", { name: "Add Address" }));

      // Form should have a submit button
      const submitButton = screen
        .getAllByRole("button", { name: /Add Address/i })
        .find((btn) => btn.getAttribute("type") === "submit");

      expect(submitButton).toBeDefined();
      expect(submitButton).toBeInTheDocument();
    });
  });

  describe("set primary address", () => {
    it("should call setPrimaryAddress when Set Primary is clicked", async () => {
      const user = userEvent.setup();
      mockSetPrimaryAddress.mockResolvedValueOnce({
        data: { setPrimaryAddress: mockAddresses[1] },
      });

      render(<AddressesPage />);

      await user.click(screen.getByText("Set Primary"));

      await waitFor(() => {
        expect(mockSetPrimaryAddress).toHaveBeenCalledWith({
          variables: { id: "addr-2" },
        });
      });
    });
  });

  describe("delete address", () => {
    it("should show confirmation before deleting", async () => {
      const user = userEvent.setup();
      render(<AddressesPage />);

      // Get the delete buttons by their accessible name
      const deleteButtons = screen.getAllByRole("button", { name: "Delete" });

      await user.click(deleteButtons[0]);

      expect(globalThis.confirm).toHaveBeenCalledWith(
        "Are you sure you want to delete this address?",
      );
    });

    it("should call deleteAddress when confirmed", async () => {
      const user = userEvent.setup();
      mockDeleteAddress.mockResolvedValueOnce({
        data: { deleteAddress: true },
      });

      render(<AddressesPage />);

      const deleteButtons = screen.getAllByRole("button", { name: "Delete" });

      await user.click(deleteButtons[0]);

      await waitFor(() => {
        expect(mockDeleteAddress).toHaveBeenCalledWith({
          variables: { id: "addr-1" },
        });
      });
    });

    it("should not delete when cancelled", async () => {
      const user = userEvent.setup();
      (globalThis.confirm as jest.Mock).mockReturnValueOnce(false);

      render(<AddressesPage />);

      const deleteButtons = screen.getAllByRole("button", { name: "Delete" });

      await user.click(deleteButtons[0]);

      expect(mockDeleteAddress).not.toHaveBeenCalled();
    });
  });
});
