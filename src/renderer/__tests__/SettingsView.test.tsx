// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsView from "../components/SettingsView";
import { type UserSettings } from "../../shared/types";

// applyTheme is called on save — mock it so tests don't manipulate document.documentElement
vi.mock("../utils/theme", () => ({ applyTheme: vi.fn() }));

// ─── Mock window.tempdlm ─────────────────────────────────────────────────────

const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn().mockResolvedValue({ success: true });
const mockPickFolder = vi.fn().mockResolvedValue(null);
const mockGetAppVersion = vi.fn().mockResolvedValue("1.0.0");
const mockCheckForUpdate = vi.fn().mockResolvedValue(undefined);

const baseSettings: UserSettings = {
  downloadsFolder: "C:\\Users\\Test\\Downloads",
  launchAtStartup: false,
  defaultTimer: "30m",
  customDefaultMinutes: 60,
  theme: "system",
  showNotifications: true,
  dialogPosition: "bottom-right",
  whitelistRules: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSettings.mockResolvedValue({ ...baseSettings });
  Object.defineProperty(window, "tempdlm", {
    value: {
      getSettings: mockGetSettings,
      updateSettings: mockUpdateSettings,
      pickFolder: mockPickFolder,
      getAppVersion: mockGetAppVersion,
      checkForUpdate: mockCheckForUpdate,
      onUpdateError: vi.fn(() => vi.fn()),
    },
    writable: true,
    configurable: true,
  });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SettingsView", () => {
  describe("rendering", () => {
    it("renders current downloads folder", async () => {
      render(<SettingsView />);
      await waitFor(() =>
        expect(screen.getByText("C:\\Users\\Test\\Downloads")).toBeInTheDocument(),
      );
    });

    it("renders default timer selection", async () => {
      render(<SettingsView />);
      await waitFor(() => {
        const btn = screen.getByRole("button", { name: "30m" });
        expect(btn).toHaveAttribute("aria-pressed", "true");
      });
    });

    it("renders launch at startup checkbox unchecked", async () => {
      render(<SettingsView />);
      await waitFor(() => {
        const checkbox = screen.getByLabelText("Launch at startup");
        expect(checkbox).not.toBeChecked();
      });
    });

    it("renders show notifications checkbox checked", async () => {
      render(<SettingsView />);
      await waitFor(() => {
        const checkbox = screen.getByLabelText("Show notifications");
        expect(checkbox).toBeChecked();
      });
    });

    it("shows empty whitelist message when no rules", async () => {
      render(<SettingsView />);
      await waitFor(() => expect(screen.getByText("No rules added.")).toBeInTheDocument());
    });

    it("renders existing whitelist rules", async () => {
      mockGetSettings.mockResolvedValue({
        ...baseSettings,
        whitelistRules: [
          {
            id: "r1",
            type: "extension",
            value: ".pdf",
            action: "never-delete",
            enabled: true,
          },
        ],
      });
      render(<SettingsView />);
      await waitFor(() => expect(screen.getByText(".pdf")).toBeInTheDocument());
    });
  });

  describe("save", () => {
    it("save button is disabled when there are no unsaved changes", async () => {
      render(<SettingsView />);
      await waitFor(() => screen.getByText("C:\\Users\\Test\\Downloads"));
      expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
    });

    it("calls updateSettings with current settings on Save", async () => {
      render(<SettingsView />);
      await waitFor(() => screen.getByText("C:\\Users\\Test\\Downloads"));
      // Make a change to enable the save button
      await userEvent.click(screen.getByLabelText("Launch at startup"));
      await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
      expect(mockUpdateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          downloadsFolder: "C:\\Users\\Test\\Downloads",
          launchAtStartup: true,
        }),
      );
    });

    it('shows "Settings saved." confirmation after save', async () => {
      render(<SettingsView />);
      await waitFor(() => screen.getByText("C:\\Users\\Test\\Downloads"));
      await userEvent.click(screen.getByLabelText("Launch at startup"));
      await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
      await waitFor(() => expect(screen.getByText("Settings saved.")).toBeInTheDocument());
    });

    it('shows "Unsaved changes" indicator when form is dirty', async () => {
      render(<SettingsView />);
      await waitFor(() => screen.getByText("C:\\Users\\Test\\Downloads"));
      await userEvent.click(screen.getByLabelText("Launch at startup"));
      expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    });

    it("shows error message when save is rejected by main process", async () => {
      mockUpdateSettings.mockResolvedValueOnce({
        success: false,
        error: "downloadsFolder must be a directory",
      });
      render(<SettingsView />);
      await waitFor(() => screen.getByText("C:\\Users\\Test\\Downloads"));
      await userEvent.click(screen.getByLabelText("Launch at startup"));
      await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent("downloadsFolder must be a directory"),
      );
      expect(screen.queryByText("Settings saved.")).not.toBeInTheDocument();
    });
  });

  describe("default timer", () => {
    it("updates selection when a preset is clicked", async () => {
      render(<SettingsView />);
      await waitFor(() => screen.getByRole("button", { name: "30m" }));
      await userEvent.click(screen.getByRole("button", { name: "5m" }));
      expect(screen.getByRole("button", { name: "5m" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "30m" })).toHaveAttribute("aria-pressed", "false");
    });

    it("saves updated timer preset", async () => {
      render(<SettingsView />);
      await waitFor(() => screen.getByRole("button", { name: "30m" }));
      await userEvent.click(screen.getByRole("button", { name: "1d" }));
      await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
      expect(mockUpdateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ defaultTimer: "1d" }),
      );
    });
  });

  describe("whitelist rules", () => {
    it("adds a new rule", async () => {
      render(<SettingsView />);
      await waitFor(() => screen.getByLabelText("New whitelist rule value"));
      await userEvent.type(screen.getByLabelText("New whitelist rule value"), ".exe");
      await userEvent.click(screen.getByRole("button", { name: "Add" }));
      expect(screen.getByText(".exe")).toBeInTheDocument();
    });

    it("clears the input after adding a rule", async () => {
      render(<SettingsView />);
      await waitFor(() => screen.getByLabelText("New whitelist rule value"));
      const input = screen.getByLabelText("New whitelist rule value");
      await userEvent.type(input, ".exe");
      await userEvent.click(screen.getByRole("button", { name: "Add" }));
      expect(input).toHaveValue("");
    });

    it("does not add a rule with empty value", async () => {
      render(<SettingsView />);
      await waitFor(() => screen.getByRole("button", { name: "Add" }));
      await userEvent.click(screen.getByRole("button", { name: "Add" }));
      expect(screen.getByText("No rules added.")).toBeInTheDocument();
    });

    it("rejects invalid extension format and shows error", async () => {
      render(<SettingsView />);
      await waitFor(() => screen.getByLabelText("New whitelist rule value"));
      await userEvent.type(screen.getByLabelText("New whitelist rule value"), "notanext");
      await userEvent.click(screen.getByRole("button", { name: "Add" }));
      expect(screen.getByRole("alert")).toHaveTextContent('Must be a file extension like ".pdf"');
      expect(screen.getByText("No rules added.")).toBeInTheDocument();
    });

    it("rejects path traversal in rule value", async () => {
      render(<SettingsView />);
      await waitFor(() => screen.getByLabelText("New whitelist rule value"));
      await userEvent.type(screen.getByLabelText("New whitelist rule value"), "../../../etc");
      await userEvent.click(screen.getByRole("button", { name: "Add" }));
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("No rules added.")).toBeInTheDocument();
    });

    it("clears validation error when input changes", async () => {
      render(<SettingsView />);
      await waitFor(() => screen.getByLabelText("New whitelist rule value"));
      await userEvent.type(screen.getByLabelText("New whitelist rule value"), "bad");
      await userEvent.click(screen.getByRole("button", { name: "Add" }));
      expect(screen.getByRole("alert")).toBeInTheDocument();
      await userEvent.clear(screen.getByLabelText("New whitelist rule value"));
      await userEvent.type(screen.getByLabelText("New whitelist rule value"), ".pdf");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("removes a rule", async () => {
      mockGetSettings.mockResolvedValue({
        ...baseSettings,
        whitelistRules: [
          {
            id: "r1",
            type: "extension",
            value: ".pdf",
            action: "never-delete",
            enabled: true,
          },
        ],
      });
      render(<SettingsView />);
      await waitFor(() => screen.getByText(".pdf"));
      await userEvent.click(screen.getByLabelText("Remove whitelist rule .pdf"));
      expect(screen.queryByText(".pdf")).not.toBeInTheDocument();
    });
  });

  describe("folder picker", () => {
    it("calls pickFolder when Browse is clicked", async () => {
      render(<SettingsView />);
      await waitFor(() => screen.getByLabelText("Browse for downloads folder"));
      await userEvent.click(screen.getByLabelText("Browse for downloads folder"));
      expect(mockPickFolder).toHaveBeenCalled();
    });

    it("updates folder display when pickFolder returns a path", async () => {
      mockPickFolder.mockResolvedValue("D:\\NewFolder");
      render(<SettingsView />);
      await waitFor(() => screen.getByLabelText("Browse for downloads folder"));
      await userEvent.click(screen.getByLabelText("Browse for downloads folder"));
      await waitFor(() => expect(screen.getByText("D:\\NewFolder")).toBeInTheDocument());
    });

    it("does not update folder when pickFolder returns null (cancelled)", async () => {
      mockPickFolder.mockResolvedValue(null);
      render(<SettingsView />);
      await waitFor(() => screen.getByText("C:\\Users\\Test\\Downloads"));
      await userEvent.click(screen.getByLabelText("Browse for downloads folder"));
      await waitFor(() => {
        expect(screen.getByText("C:\\Users\\Test\\Downloads")).toBeInTheDocument();
      });
    });
  });

  describe("theme selector", () => {
    it("renders System, Light, and Dark buttons", async () => {
      render(<SettingsView />);
      await waitFor(() => screen.getByText("C:\\Users\\Test\\Downloads"));
      expect(screen.getByRole("button", { name: "System" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Light" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Dark" })).toBeInTheDocument();
    });

    it("marks the current theme as pressed", async () => {
      render(<SettingsView />);
      await waitFor(() => screen.getByText("C:\\Users\\Test\\Downloads"));
      expect(screen.getByRole("button", { name: "System" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "false");
    });

    it("updates selection when a theme button is clicked", async () => {
      render(<SettingsView />);
      await waitFor(() => screen.getByRole("button", { name: "System" }));
      await userEvent.click(screen.getByRole("button", { name: "Dark" }));
      expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "System" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("saves the selected theme when Save is clicked", async () => {
      render(<SettingsView />);
      await waitFor(() => screen.getByRole("button", { name: "System" }));
      await userEvent.click(screen.getByRole("button", { name: "Light" }));
      await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
      expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({ theme: "light" }));
    });

    it("calls applyTheme after a successful save", async () => {
      const { applyTheme } = await import("../utils/theme");
      render(<SettingsView />);
      await waitFor(() => screen.getByRole("button", { name: "System" }));
      await userEvent.click(screen.getByRole("button", { name: "Dark" }));
      await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
      await waitFor(() => expect(applyTheme).toHaveBeenCalledWith("dark"));
    });
  });
});
