import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock Apollo Client hooks
const mockIndexDocument = jest.fn();
const mockAnswerQuery = jest.fn();
const mockSearchText = jest.fn();

let mockIndexLoading = false;
let mockQueryLoading = false;
let mockSearchLoading = false;

jest.mock("@apollo/client/react", () => ({
  useMutation: jest.fn((mutation) => {
    // Return different mocks based on the mutation
    if (mutation?.definitions?.[0]?.name?.value === "IndexDocument") {
      return [mockIndexDocument, { loading: mockIndexLoading }];
    }
    if (mutation?.definitions?.[0]?.name?.value === "AnswerQuery") {
      return [mockAnswerQuery, { loading: mockQueryLoading }];
    }
    return [jest.fn(), { loading: false }];
  }),
  useLazyQuery: jest.fn(() => [mockSearchText, { loading: mockSearchLoading }]),
}));

// Mock crypto.randomUUID
Object.defineProperty(global, "crypto", {
  value: {
    randomUUID: () => "test-uuid-1234",
  },
});

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

// Mock the Header component since it requires AuthProvider
jest.mock("@/components/Header", () => ({
  Header: () => <header data-testid="mock-header">Mock Header</header>,
}));

import RAGDemo from "../app/rag-demo/page";

describe("RAG Demo Page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.clear();
    mockIndexDocument.mockReset();
    mockAnswerQuery.mockReset();
    mockSearchText.mockReset();
    mockIndexLoading = false;
    mockQueryLoading = false;
    mockSearchLoading = false;
  });

  describe("Login Screen", () => {
    it("should display login screen when no user is logged in", () => {
      render(<RAGDemo />);

      expect(screen.getByText("RAG Demo - Login")).toBeInTheDocument();
      expect(
        screen.getByText(/Enter an email to create a demo session/i),
      ).toBeInTheDocument();
      expect(screen.getByText("Email")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Start Demo Session/i }),
      ).toBeInTheDocument();
    });

    it("should have email input with default placeholder", () => {
      render(<RAGDemo />);

      const emailInput = screen.getByPlaceholderText("demo@example.com");
      expect(emailInput).toBeInTheDocument();
      expect(emailInput).toHaveValue("demo@example.com");
    });

    it("should allow email input to be changed", () => {
      render(<RAGDemo />);

      const emailInput = screen.getByPlaceholderText("demo@example.com");
      fireEvent.change(emailInput, { target: { value: "test@test.com" } });
      expect(emailInput).toHaveValue("test@test.com");
    });

    it("should create demo session on login button click", async () => {
      render(<RAGDemo />);

      const emailInput = screen.getByPlaceholderText("demo@example.com");
      fireEvent.change(emailInput, { target: { value: "test@test.com" } });

      const loginButton = screen.getByRole("button", {
        name: /Start Demo Session/i,
      });
      fireEvent.click(loginButton);

      // After login, should show main demo page
      await waitFor(() => {
        expect(screen.getByText("RAG Pipeline Demo")).toBeInTheDocument();
      });
    });
  });

  describe("Main Demo Screen", () => {
    const loginAndGetMainScreen = () => {
      render(<RAGDemo />);
      const loginButton = screen.getByRole("button", {
        name: /Start Demo Session/i,
      });
      fireEvent.click(loginButton);
    };

    it("should display main demo screen when user is logged in", () => {
      loginAndGetMainScreen();
      expect(screen.getByText("RAG Pipeline Demo")).toBeInTheDocument();
    });

    it("should display user email and logout button", () => {
      loginAndGetMainScreen();

      expect(screen.getByText("demo@example.com")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Logout/i }),
      ).toBeInTheDocument();
    });

    it("should display Index Document and Query tabs", () => {
      loginAndGetMainScreen();

      // Use getAllByText since "Index Document" appears in both tab and button
      const indexElements = screen.getAllByText("Index Document");
      expect(indexElements.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Query Knowledge Base")).toBeInTheDocument();
    });

    it("should show Index Document tab content by default", () => {
      loginAndGetMainScreen();

      expect(screen.getByText("Index a Document")).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText("e.g., my-document-1"),
      ).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText("Paste your document text here..."),
      ).toBeInTheDocument();
    });

    it("should logout when logout button is clicked", async () => {
      loginAndGetMainScreen();

      const logoutButton = screen.getByRole("button", { name: /Logout/i });
      fireEvent.click(logoutButton);

      // Should show login screen again
      await waitFor(() => {
        expect(screen.getByText("RAG Demo - Login")).toBeInTheDocument();
      });
    });
  });

  describe("Index Document Tab", () => {
    beforeEach(() => {
      render(<RAGDemo />);
      const loginButton = screen.getByRole("button", {
        name: /Start Demo Session/i,
      });
      fireEvent.click(loginButton);
    });

    it("should display document indexing form", () => {
      expect(screen.getByText("Index a Document")).toBeInTheDocument();
      expect(
        screen.getByText(/Paste text content below to index/i),
      ).toBeInTheDocument();
    });

    it("should have disabled Index button when no text is entered", () => {
      // Get all buttons with "Index Document" text and find the one that's a submit-style button (green/disabled)
      const indexButtons = screen.getAllByRole("button", {
        name: /Index Document/i,
      });
      // The action button is the one that should be disabled (not the tab)
      const actionButton = indexButtons.find(
        (btn) =>
          btn.classList.contains("bg-green-600") ||
          btn.classList.contains("disabled:bg-gray-400"),
      );
      expect(actionButton).toBeDisabled();
    });

    it("should enable Index button when text is entered", () => {
      const textArea = screen.getByPlaceholderText(
        "Paste your document text here...",
      );
      fireEvent.change(textArea, {
        target: { value: "Test document content" },
      });

      const indexButtons = screen.getAllByRole("button", {
        name: /Index Document/i,
      });
      const actionButton = indexButtons.find(
        (btn) =>
          btn.classList.contains("bg-green-600") ||
          btn.classList.contains("disabled:bg-gray-400"),
      );
      expect(actionButton).not.toBeDisabled();
    });

    it("should call indexDocument mutation when Index button is clicked", async () => {
      mockIndexDocument.mockResolvedValue({
        data: { indexDocument: true },
      });

      const textArea = screen.getByPlaceholderText(
        "Paste your document text here...",
      );
      fireEvent.change(textArea, {
        target: { value: "Test document content" },
      });

      const indexButtons = screen.getAllByRole("button", {
        name: /Index Document/i,
      });
      const actionButton = indexButtons.find(
        (btn) =>
          btn.classList.contains("bg-green-600") ||
          btn.classList.contains("disabled:bg-gray-400"),
      );
      fireEvent.click(actionButton!);

      await waitFor(() => {
        expect(mockIndexDocument).toHaveBeenCalled();
      });
    });

    it("should show success notification on successful indexing", async () => {
      mockIndexDocument.mockResolvedValue({
        data: { indexDocument: true },
      });

      const textArea = screen.getByPlaceholderText(
        "Paste your document text here...",
      );
      fireEvent.change(textArea, {
        target: { value: "Test document content" },
      });

      const indexButtons = screen.getAllByRole("button", {
        name: /Index Document/i,
      });
      const actionButton = indexButtons.find(
        (btn) =>
          btn.classList.contains("bg-green-600") ||
          btn.classList.contains("disabled:bg-gray-400"),
      );
      fireEvent.click(actionButton!);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
        expect(screen.getByText(/indexed successfully/i)).toBeInTheDocument();
      });
    });

    it("should use custom document ID when provided", async () => {
      mockIndexDocument.mockResolvedValue({
        data: { indexDocument: true },
      });

      const docIdInput = screen.getByPlaceholderText("e.g., my-document-1");
      fireEvent.change(docIdInput, { target: { value: "my-custom-doc" } });

      const textArea = screen.getByPlaceholderText(
        "Paste your document text here...",
      );
      fireEvent.change(textArea, {
        target: { value: "Test document content" },
      });

      const indexButtons = screen.getAllByRole("button", {
        name: /Index Document/i,
      });
      const actionButton = indexButtons.find(
        (btn) =>
          btn.classList.contains("bg-green-600") ||
          btn.classList.contains("disabled:bg-gray-400"),
      );
      fireEvent.click(actionButton!);

      await waitFor(() => {
        expect(mockIndexDocument).toHaveBeenCalledWith(
          expect.objectContaining({
            variables: expect.objectContaining({
              documentId: "my-custom-doc",
            }),
          }),
        );
      });
    });

    it("should show error notification on indexing failure", async () => {
      mockIndexDocument.mockRejectedValue(new Error("Network error"));

      const textArea = screen.getByPlaceholderText(
        "Paste your document text here...",
      );
      fireEvent.change(textArea, {
        target: { value: "Test document content" },
      });

      const indexButtons = screen.getAllByRole("button", {
        name: /Index Document/i,
      });
      const actionButton = indexButtons.find(
        (btn) =>
          btn.classList.contains("bg-green-600") ||
          btn.classList.contains("disabled:bg-gray-400"),
      );
      fireEvent.click(actionButton!);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
        expect(
          screen.getByText(/Error indexing document/i),
        ).toBeInTheDocument();
      });
    });

    it("should show failure notification when indexDocument returns false", async () => {
      mockIndexDocument.mockResolvedValue({
        data: { indexDocument: false },
      });

      const textArea = screen.getByPlaceholderText(
        "Paste your document text here...",
      );
      fireEvent.change(textArea, {
        target: { value: "Test document content" },
      });

      const indexButtons = screen.getAllByRole("button", {
        name: /Index Document/i,
      });
      const actionButton = indexButtons.find(
        (btn) =>
          btn.classList.contains("bg-green-600") ||
          btn.classList.contains("disabled:bg-gray-400"),
      );
      fireEvent.click(actionButton!);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
        expect(
          screen.getByText(/Failed to index document/i),
        ).toBeInTheDocument();
      });
    });
  });

  describe("Query Tab", () => {
    beforeEach(() => {
      render(<RAGDemo />);
      const loginButton = screen.getByRole("button", {
        name: /Start Demo Session/i,
      });
      fireEvent.click(loginButton);

      // Switch to Query tab
      const queryTab = screen.getByText("Query Knowledge Base");
      fireEvent.click(queryTab);
    });

    it("should display query form when Query tab is active", () => {
      expect(screen.getByText("Ask a Question")).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText(
          "e.g., What are the main topics discussed in the document?",
        ),
      ).toBeInTheDocument();
    });

    it("should have disabled buttons when no query is entered", () => {
      const askButton = screen.getByRole("button", {
        name: /Ask Question \(RAG\)/i,
      });
      const searchButton = screen.getByRole("button", { name: /Search Only/i });

      expect(askButton).toBeDisabled();
      expect(searchButton).toBeDisabled();
    });

    it("should enable buttons when query is entered", () => {
      const queryInput = screen.getByPlaceholderText(
        "e.g., What are the main topics discussed in the document?",
      );
      fireEvent.change(queryInput, {
        target: { value: "What is OPUSPOPULI?" },
      });

      const askButton = screen.getByRole("button", {
        name: /Ask Question \(RAG\)/i,
      });
      const searchButton = screen.getByRole("button", { name: /Search Only/i });

      expect(askButton).not.toBeDisabled();
      expect(searchButton).not.toBeDisabled();
    });

    it("should call answerQuery mutation when Ask Question is clicked", async () => {
      mockAnswerQuery.mockResolvedValue({
        data: { answerQuery: "OPUSPOPULI is a platform..." },
      });

      const queryInput = screen.getByPlaceholderText(
        "e.g., What are the main topics discussed in the document?",
      );
      fireEvent.change(queryInput, {
        target: { value: "What is OPUSPOPULI?" },
      });

      const askButton = screen.getByRole("button", {
        name: /Ask Question \(RAG\)/i,
      });
      fireEvent.click(askButton);

      await waitFor(() => {
        expect(mockAnswerQuery).toHaveBeenCalled();
      });
    });

    it("should display answer after successful query", async () => {
      mockAnswerQuery.mockResolvedValue({
        data: { answerQuery: "OPUSPOPULI is a platform for AI applications" },
      });

      const queryInput = screen.getByPlaceholderText(
        "e.g., What are the main topics discussed in the document?",
      );
      fireEvent.change(queryInput, {
        target: { value: "What is OPUSPOPULI?" },
      });

      const askButton = screen.getByRole("button", {
        name: /Ask Question \(RAG\)/i,
      });
      fireEvent.click(askButton);

      await waitFor(() => {
        expect(
          screen.getByText("OPUSPOPULI is a platform for AI applications"),
        ).toBeInTheDocument();
      });
    });

    it("should display fallback message when no answer is received", async () => {
      mockAnswerQuery.mockResolvedValue({
        data: { answerQuery: null },
      });

      const queryInput = screen.getByPlaceholderText(
        "e.g., What are the main topics discussed in the document?",
      );
      fireEvent.change(queryInput, {
        target: { value: "What is OPUSPOPULI?" },
      });

      const askButton = screen.getByRole("button", {
        name: /Ask Question \(RAG\)/i,
      });
      fireEvent.click(askButton);

      await waitFor(() => {
        expect(screen.getByText("No answer received")).toBeInTheDocument();
      });
    });

    it("should call searchText query when Search Only is clicked", async () => {
      mockSearchText.mockResolvedValue({
        data: {
          searchText: {
            results: [
              { content: "Chunk 1", documentId: "doc-1", score: 0.95 },
              { content: "Chunk 2", documentId: "doc-1", score: 0.85 },
            ],
            total: 2,
            hasMore: false,
          },
        },
      });

      const queryInput = screen.getByPlaceholderText(
        "e.g., What are the main topics discussed in the document?",
      );
      fireEvent.change(queryInput, {
        target: { value: "What is OPUSPOPULI?" },
      });

      const searchButton = screen.getByRole("button", { name: /Search Only/i });
      fireEvent.click(searchButton);

      await waitFor(() => {
        expect(mockSearchText).toHaveBeenCalled();
      });
    });

    it("should display search results with metadata after successful search", async () => {
      mockSearchText.mockResolvedValue({
        data: {
          searchText: {
            results: [
              { content: "Result chunk 1", documentId: "doc-1", score: 0.95 },
              { content: "Result chunk 2", documentId: "doc-2", score: 0.85 },
            ],
            total: 2,
            hasMore: false,
          },
        },
      });

      const queryInput = screen.getByPlaceholderText(
        "e.g., What are the main topics discussed in the document?",
      );
      fireEvent.change(queryInput, {
        target: { value: "What is OPUSPOPULI?" },
      });

      const searchButton = screen.getByRole("button", { name: /Search Only/i });
      fireEvent.click(searchButton);

      await waitFor(() => {
        expect(screen.getByText("Relevant Chunks (2)")).toBeInTheDocument();
        expect(screen.getByText("Result chunk 1")).toBeInTheDocument();
        expect(screen.getByText("Result chunk 2")).toBeInTheDocument();
        // Check document IDs are displayed
        expect(screen.getByText("doc-1")).toBeInTheDocument();
        expect(screen.getByText("doc-2")).toBeInTheDocument();
        // Check scores are displayed
        expect(screen.getByText("Score: 95.0%")).toBeInTheDocument();
        expect(screen.getByText("Score: 85.0%")).toBeInTheDocument();
      });
    });

    it("should handle empty search results", async () => {
      mockSearchText.mockResolvedValue({
        data: { searchText: null },
      });

      const queryInput = screen.getByPlaceholderText(
        "e.g., What are the main topics discussed in the document?",
      );
      fireEvent.change(queryInput, {
        target: { value: "What is OPUSPOPULI?" },
      });

      const searchButton = screen.getByRole("button", { name: /Search Only/i });
      fireEvent.click(searchButton);

      await waitFor(() => {
        expect(mockSearchText).toHaveBeenCalled();
      });

      // Empty results - no chunks should be displayed
      expect(screen.queryByText(/Relevant Chunks/)).not.toBeInTheDocument();
    });

    it("should show Load More button when hasMore is true", async () => {
      mockSearchText.mockResolvedValue({
        data: {
          searchText: {
            results: [
              { content: "Chunk 1", documentId: "doc-1", score: 0.95 },
              { content: "Chunk 2", documentId: "doc-1", score: 0.85 },
            ],
            total: 5,
            hasMore: true,
          },
        },
      });

      const queryInput = screen.getByPlaceholderText(
        "e.g., What are the main topics discussed in the document?",
      );
      fireEvent.change(queryInput, {
        target: { value: "What is OPUSPOPULI?" },
      });

      const searchButton = screen.getByRole("button", { name: /Search Only/i });
      fireEvent.click(searchButton);

      await waitFor(() => {
        expect(
          screen.getByText("Relevant Chunks (2 of 5)"),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: /Load More Results/i }),
        ).toBeInTheDocument();
      });
    });

    it("should not show Load More button when hasMore is false", async () => {
      mockSearchText.mockResolvedValue({
        data: {
          searchText: {
            results: [{ content: "Chunk 1", documentId: "doc-1", score: 0.95 }],
            total: 1,
            hasMore: false,
          },
        },
      });

      const queryInput = screen.getByPlaceholderText(
        "e.g., What are the main topics discussed in the document?",
      );
      fireEvent.change(queryInput, {
        target: { value: "What is OPUSPOPULI?" },
      });

      const searchButton = screen.getByRole("button", { name: /Search Only/i });
      fireEvent.click(searchButton);

      await waitFor(() => {
        expect(screen.getByText("Relevant Chunks (1)")).toBeInTheDocument();
      });

      expect(
        screen.queryByRole("button", { name: /Load More Results/i }),
      ).not.toBeInTheDocument();
    });

    it("should handle query on Enter key press", async () => {
      mockAnswerQuery.mockResolvedValue({
        data: { answerQuery: "Answer from Enter key" },
      });

      const queryInput = screen.getByPlaceholderText(
        "e.g., What are the main topics discussed in the document?",
      );
      fireEvent.change(queryInput, { target: { value: "Test question" } });
      fireEvent.keyDown(queryInput, { key: "Enter", code: "Enter" });

      await waitFor(() => {
        expect(mockAnswerQuery).toHaveBeenCalled();
      });
    });

    it("should display error message on query failure", async () => {
      mockAnswerQuery.mockRejectedValue(new Error("Query failed"));

      const queryInput = screen.getByPlaceholderText(
        "e.g., What are the main topics discussed in the document?",
      );
      fireEvent.change(queryInput, {
        target: { value: "What is OPUSPOPULI?" },
      });

      const askButton = screen.getByRole("button", {
        name: /Ask Question \(RAG\)/i,
      });
      fireEvent.click(askButton);

      await waitFor(() => {
        expect(screen.getByText(/Error: Query failed/i)).toBeInTheDocument();
      });
    });

    it("should clear search results on search failure", async () => {
      mockSearchText.mockRejectedValue(new Error("Search failed"));

      const queryInput = screen.getByPlaceholderText(
        "e.g., What are the main topics discussed in the document?",
      );
      fireEvent.change(queryInput, {
        target: { value: "What is OPUSPOPULI?" },
      });

      const searchButton = screen.getByRole("button", { name: /Search Only/i });
      fireEvent.click(searchButton);

      await waitFor(() => {
        expect(mockSearchText).toHaveBeenCalled();
      });

      // Results should be empty (cleared on error)
      expect(screen.queryByText(/Relevant Chunks/)).not.toBeInTheDocument();
    });

    it("should load more results when Load More is clicked", async () => {
      // First search returns results with hasMore=true
      mockSearchText
        .mockResolvedValueOnce({
          data: {
            searchText: {
              results: [
                { content: "Chunk 1", documentId: "doc-1", score: 0.95 },
                { content: "Chunk 2", documentId: "doc-1", score: 0.85 },
              ],
              total: 4,
              hasMore: true,
            },
          },
        })
        // Second search (Load More) returns additional results
        .mockResolvedValueOnce({
          data: {
            searchText: {
              results: [
                { content: "Chunk 3", documentId: "doc-2", score: 0.75 },
                { content: "Chunk 4", documentId: "doc-2", score: 0.65 },
              ],
              total: 4,
              hasMore: false,
            },
          },
        });

      const queryInput = screen.getByPlaceholderText(
        "e.g., What are the main topics discussed in the document?",
      );
      fireEvent.change(queryInput, {
        target: { value: "What is OPUSPOPULI?" },
      });

      const searchButton = screen.getByRole("button", { name: /Search Only/i });
      fireEvent.click(searchButton);

      await waitFor(() => {
        expect(
          screen.getByText("Relevant Chunks (2 of 4)"),
        ).toBeInTheDocument();
      });

      // Click Load More
      const loadMoreButton = screen.getByRole("button", {
        name: /Load More Results/i,
      });
      fireEvent.click(loadMoreButton);

      await waitFor(() => {
        // Should now show all 4 chunks
        expect(screen.getByText("Chunk 1")).toBeInTheDocument();
        expect(screen.getByText("Chunk 2")).toBeInTheDocument();
        expect(screen.getByText("Chunk 3")).toBeInTheDocument();
        expect(screen.getByText("Chunk 4")).toBeInTheDocument();
      });

      // Load More button should be gone since hasMore is now false
      expect(
        screen.queryByRole("button", { name: /Load More Results/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("Tab Navigation", () => {
    beforeEach(() => {
      render(<RAGDemo />);
      const loginButton = screen.getByRole("button", {
        name: /Start Demo Session/i,
      });
      fireEvent.click(loginButton);
    });

    it("should switch to Query tab when clicked", () => {
      const queryTab = screen.getByText("Query Knowledge Base");
      fireEvent.click(queryTab);

      expect(screen.getByText("Ask a Question")).toBeInTheDocument();
      expect(screen.queryByText("Index a Document")).not.toBeInTheDocument();
    });

    it("should switch back to Index tab when clicked", () => {
      // First switch to Query tab
      const queryTab = screen.getByText("Query Knowledge Base");
      fireEvent.click(queryTab);

      // Then switch back to Index tab
      const indexTab = screen.getByText("Index Document");
      fireEvent.click(indexTab);

      expect(screen.getByText("Index a Document")).toBeInTheDocument();
      expect(screen.queryByText("Ask a Question")).not.toBeInTheDocument();
    });
  });

  describe("Toast Notifications", () => {
    beforeEach(() => {
      render(<RAGDemo />);
      const loginButton = screen.getByRole("button", {
        name: /Start Demo Session/i,
      });
      fireEvent.click(loginButton);
    });

    it("should display success toast with correct content", async () => {
      mockIndexDocument.mockResolvedValue({
        data: { indexDocument: true },
      });

      const textArea = screen.getByPlaceholderText(
        "Paste your document text here...",
      );
      fireEvent.change(textArea, {
        target: { value: "Test document content" },
      });

      const indexButtons = screen.getAllByRole("button", {
        name: /Index Document/i,
      });
      const actionButton = indexButtons.find(
        (btn) =>
          btn.classList.contains("bg-green-600") ||
          btn.classList.contains("disabled:bg-gray-400"),
      );
      fireEvent.click(actionButton!);

      await waitFor(() => {
        const alert = screen.getByRole("alert");
        expect(alert).toBeInTheDocument();
        expect(alert).toHaveTextContent("✓");
      });
    });

    it("should close toast when close button is clicked", async () => {
      mockIndexDocument.mockResolvedValue({
        data: { indexDocument: true },
      });

      const textArea = screen.getByPlaceholderText(
        "Paste your document text here...",
      );
      fireEvent.change(textArea, {
        target: { value: "Test document content" },
      });

      const indexButtons = screen.getAllByRole("button", {
        name: /Index Document/i,
      });
      const actionButton = indexButtons.find(
        (btn) =>
          btn.classList.contains("bg-green-600") ||
          btn.classList.contains("disabled:bg-gray-400"),
      );
      fireEvent.click(actionButton!);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
      });

      // Click close button
      const closeButton = screen.getByRole("button", {
        name: /Close notification/i,
      });
      fireEvent.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      });
    });

    it("should display error toast with correct styling", async () => {
      mockIndexDocument.mockRejectedValue(new Error("Test error"));

      const textArea = screen.getByPlaceholderText(
        "Paste your document text here...",
      );
      fireEvent.change(textArea, {
        target: { value: "Test document content" },
      });

      const indexButtons = screen.getAllByRole("button", {
        name: /Index Document/i,
      });
      const actionButton = indexButtons.find(
        (btn) =>
          btn.classList.contains("bg-green-600") ||
          btn.classList.contains("disabled:bg-gray-400"),
      );
      fireEvent.click(actionButton!);

      await waitFor(() => {
        const alert = screen.getByRole("alert");
        expect(alert).toBeInTheDocument();
        expect(alert).toHaveTextContent("✕");
      });
    });
  });

  describe("Session Persistence", () => {
    it("should restore user from localStorage on mount", async () => {
      // Set up localStorage with saved user
      const savedUser = {
        id: "saved-user-id",
        email: "saved@example.com",
        roles: ["user"],
        department: "demo",
        clearance: "public",
      };
      localStorageMock.setItem("user", JSON.stringify(savedUser));

      render(<RAGDemo />);

      // Should immediately show main demo page with saved user
      await waitFor(() => {
        expect(screen.getByText("RAG Pipeline Demo")).toBeInTheDocument();
        expect(screen.getByText("saved@example.com")).toBeInTheDocument();
      });
    });

    it("should clear search state on logout", async () => {
      render(<RAGDemo />);
      const loginButton = screen.getByRole("button", {
        name: /Start Demo Session/i,
      });
      fireEvent.click(loginButton);

      // Switch to Query tab and perform a search
      const queryTab = screen.getByText("Query Knowledge Base");
      fireEvent.click(queryTab);

      mockSearchText.mockResolvedValue({
        data: {
          searchText: {
            results: [
              { content: "Test chunk", documentId: "doc-1", score: 0.95 },
            ],
            total: 1,
            hasMore: false,
          },
        },
      });

      const queryInput = screen.getByPlaceholderText(
        "e.g., What are the main topics discussed in the document?",
      );
      fireEvent.change(queryInput, { target: { value: "test query" } });

      const searchButton = screen.getByRole("button", { name: /Search Only/i });
      fireEvent.click(searchButton);

      await waitFor(() => {
        expect(screen.getByText("Relevant Chunks (1)")).toBeInTheDocument();
      });

      // Now logout
      const logoutButton = screen.getByRole("button", { name: /Logout/i });
      fireEvent.click(logoutButton);

      // Should show login screen
      await waitFor(() => {
        expect(screen.getByText("RAG Demo - Login")).toBeInTheDocument();
      });
    });
  });

  describe("Error Handling Edge Cases", () => {
    beforeEach(() => {
      render(<RAGDemo />);
      const loginButton = screen.getByRole("button", {
        name: /Start Demo Session/i,
      });
      fireEvent.click(loginButton);
    });

    it("should handle non-Error object in indexDocument error", async () => {
      mockIndexDocument.mockRejectedValue("String error");

      const textArea = screen.getByPlaceholderText(
        "Paste your document text here...",
      );
      fireEvent.change(textArea, {
        target: { value: "Test document content" },
      });

      const indexButtons = screen.getAllByRole("button", {
        name: /Index Document/i,
      });
      const actionButton = indexButtons.find(
        (btn) =>
          btn.classList.contains("bg-green-600") ||
          btn.classList.contains("disabled:bg-gray-400"),
      );
      fireEvent.click(actionButton!);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
        expect(screen.getByText(/Unknown error/i)).toBeInTheDocument();
      });
    });

    it("should handle non-Error object in answerQuery error", async () => {
      mockAnswerQuery.mockRejectedValue({ code: "UNKNOWN" });

      const queryTab = screen.getByText("Query Knowledge Base");
      fireEvent.click(queryTab);

      const queryInput = screen.getByPlaceholderText(
        "e.g., What are the main topics discussed in the document?",
      );
      fireEvent.change(queryInput, {
        target: { value: "What is OPUSPOPULI?" },
      });

      const askButton = screen.getByRole("button", {
        name: /Ask Question \(RAG\)/i,
      });
      fireEvent.click(askButton);

      await waitFor(() => {
        expect(screen.getByText(/Error: Unknown error/i)).toBeInTheDocument();
      });
    });

    it("should handle search error on loadMore and preserve existing results", async () => {
      // First search returns results with hasMore=true
      mockSearchText
        .mockResolvedValueOnce({
          data: {
            searchText: {
              results: [
                { content: "Chunk 1", documentId: "doc-1", score: 0.95 },
              ],
              total: 3,
              hasMore: true,
            },
          },
        })
        // Load more fails
        .mockRejectedValueOnce(new Error("Load more failed"));

      const queryTab = screen.getByText("Query Knowledge Base");
      fireEvent.click(queryTab);

      const queryInput = screen.getByPlaceholderText(
        "e.g., What are the main topics discussed in the document?",
      );
      fireEvent.change(queryInput, {
        target: { value: "What is OPUSPOPULI?" },
      });

      const searchButton = screen.getByRole("button", { name: /Search Only/i });
      fireEvent.click(searchButton);

      await waitFor(() => {
        expect(screen.getByText("Chunk 1")).toBeInTheDocument();
      });

      // Click Load More which will fail
      const loadMoreButton = screen.getByRole("button", {
        name: /Load More Results/i,
      });
      fireEvent.click(loadMoreButton);

      // Original results should still be visible
      await waitFor(() => {
        expect(screen.getByText("Chunk 1")).toBeInTheDocument();
      });
    });

    it("should not submit when user or documentText is empty", async () => {
      // This tests the early return in handleIndexDocument
      const textArea = screen.getByPlaceholderText(
        "Paste your document text here...",
      );
      // Enter only whitespace
      fireEvent.change(textArea, { target: { value: "   " } });

      const indexButtons = screen.getAllByRole("button", {
        name: /Index Document/i,
      });
      const actionButton = indexButtons.find(
        (btn) =>
          btn.classList.contains("bg-green-600") ||
          btn.classList.contains("disabled:bg-gray-400"),
      );

      // Button should be disabled for whitespace-only input
      expect(actionButton).toBeDisabled();
    });

    it("should not submit query when query is empty", async () => {
      const queryTab = screen.getByText("Query Knowledge Base");
      fireEvent.click(queryTab);

      const queryInput = screen.getByPlaceholderText(
        "e.g., What are the main topics discussed in the document?",
      );
      // Enter only whitespace
      fireEvent.change(queryInput, { target: { value: "   " } });

      const askButton = screen.getByRole("button", {
        name: /Ask Question \(RAG\)/i,
      });

      // Button should be disabled for whitespace-only input
      expect(askButton).toBeDisabled();
    });

    it("should not trigger ask question on non-Enter keys", async () => {
      const queryTab = screen.getByText("Query Knowledge Base");
      fireEvent.click(queryTab);

      const queryInput = screen.getByPlaceholderText(
        "e.g., What are the main topics discussed in the document?",
      );
      fireEvent.change(queryInput, { target: { value: "Test question" } });
      fireEvent.keyDown(queryInput, { key: "Tab", code: "Tab" });

      // Should not have called answerQuery
      expect(mockAnswerQuery).not.toHaveBeenCalled();
    });
  });

  describe("Search Result Edge Cases", () => {
    beforeEach(() => {
      render(<RAGDemo />);
      const loginButton = screen.getByRole("button", {
        name: /Start Demo Session/i,
      });
      fireEvent.click(loginButton);
      const queryTab = screen.getByText("Query Knowledge Base");
      fireEvent.click(queryTab);
    });

    it("should handle search with empty results array", async () => {
      mockSearchText.mockResolvedValue({
        data: {
          searchText: {
            results: [],
            total: 0,
            hasMore: false,
          },
        },
      });

      const queryInput = screen.getByPlaceholderText(
        "e.g., What are the main topics discussed in the document?",
      );
      fireEvent.change(queryInput, {
        target: { value: "What is OPUSPOPULI?" },
      });

      const searchButton = screen.getByRole("button", { name: /Search Only/i });
      fireEvent.click(searchButton);

      await waitFor(() => {
        expect(mockSearchText).toHaveBeenCalled();
      });

      // No results should be displayed
      expect(screen.queryByText(/Relevant Chunks/)).not.toBeInTheDocument();
    });

    it("should append results when loading more", async () => {
      mockSearchText
        .mockResolvedValueOnce({
          data: {
            searchText: {
              results: [
                { content: "First batch", documentId: "doc-1", score: 0.95 },
              ],
              total: 2,
              hasMore: true,
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            searchText: {
              results: [
                { content: "Second batch", documentId: "doc-2", score: 0.85 },
              ],
              total: 2,
              hasMore: false,
            },
          },
        });

      const queryInput = screen.getByPlaceholderText(
        "e.g., What are the main topics discussed in the document?",
      );
      fireEvent.change(queryInput, { target: { value: "Test" } });

      const searchButton = screen.getByRole("button", { name: /Search Only/i });
      fireEvent.click(searchButton);

      await waitFor(() => {
        expect(screen.getByText("First batch")).toBeInTheDocument();
      });

      const loadMoreButton = screen.getByRole("button", {
        name: /Load More Results/i,
      });
      fireEvent.click(loadMoreButton);

      await waitFor(() => {
        expect(screen.getByText("First batch")).toBeInTheDocument();
        expect(screen.getByText("Second batch")).toBeInTheDocument();
      });
    });
  });
});
