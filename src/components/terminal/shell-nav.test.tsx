import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MobileNav } from "./shell-nav";
import { useTerminal } from "@/store/terminal";

describe("MobileNav primary navigation", () => {
  beforeEach(() => {
    useTerminal.setState({ tab: "overview" });
  });

  it("keeps Overview directly reachable from the bottom navigation", () => {
    render(<MobileNav poolCount={8} />);
    expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument();
  });

  it("marks the current section as the active page", () => {
    useTerminal.setState({ tab: "bot" });
    render(<MobileNav poolCount={8} />);
    expect(screen.getByRole("button", { name: "Bot" })).toHaveAttribute("aria-current", "page");
  });

  it("opens the selected desk from the bottom navigation", () => {
    render(<MobileNav poolCount={8} />);
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(useTerminal.getState().tab).toBe("overview");
    fireEvent.click(screen.getByRole("button", { name: "Bot" }));
    expect(useTerminal.getState().tab).toBe("bot");
  });
});
