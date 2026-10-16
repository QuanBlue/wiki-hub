import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ArchiveHashProgress,
  ArchiveUploadProgress,
  JobProgress,
  ProgressBar,
  formatBytes,
  formatDuration,
} from "@/components/ui/job-progress";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [2048, "2.0 KB"],
    [5 * 1024 ** 2, "5.0 MB"],
    [3 * 1024 ** 3, "3.00 GB"],
    [2 * 1024 ** 4, "2.00 TB"],
    [2048 * 1024 ** 4, "2048.00 TB"],
  ])("formats %d bytes", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

describe("formatDuration", () => {
  it.each([
    [null, "Calculating…"],
    [Infinity, "Calculating…"],
    [30.2, "31 sec remaining"],
    [125, "2 min 5 sec remaining"],
    [2 * 3600, "2 hr remaining"],
    [2 * 3600 + 15 * 60, "2 hr 15 min remaining"],
    [86400, "1 day remaining"],
    [2 * 86400, "2 days remaining"],
    [86400 + 3 * 3600, "1 day 3 hr remaining"],
  ])("describes %s", (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});

describe("ProgressBar", () => {
  it("shows a value when the percentage is known", () => {
    render(<ProgressBar percent={40} label="Half" />);
    expect(screen.getByRole("progressbar", { name: "Half" })).toHaveAttribute("aria-valuenow", "40");
  });

  it("omits the value while the progress is unknown", () => {
    render(<ProgressBar percent={null} label="Busy" />);
    expect(screen.getByRole("progressbar", { name: "Busy" })).not.toHaveAttribute("aria-valuenow");
  });
});

describe("ArchiveHashProgress", () => {
  const base = { loaded: 50, total: 100, bytesPerSecond: 2048, secondsRemaining: 10 };

  it("shows the percentage, speed and estimate", () => {
    render(<ArchiveHashProgress filename="a.zip" stats={base} />);
    expect(screen.getByText(/50%/)).toBeInTheDocument();
    expect(screen.getByText(/2\.0 KB\/s/)).toBeInTheDocument();
    expect(screen.getByText(/10 sec remaining/)).toBeInTheDocument();
  });

  it("waits for a speed and for a size", () => {
    render(
      <ArchiveHashProgress
        filename="a.zip"
        stats={{ loaded: 0, total: 0, bytesPerSecond: 0, secondsRemaining: null }}
      />,
    );
    expect(screen.getByText(/Calculating speed/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });
});

describe("ArchiveUploadProgress", () => {
  const stats = { loaded: 1024, total: 4096, bytesPerSecond: 1024, secondsRemaining: 3 };

  it("shows the transfer while uploading, with a note", () => {
    render(
      <ArchiveUploadProgress filename="a.zip" percent={25} stats={stats} uploading note="Skipped 2" />,
    );
    expect(screen.getByText(/Uploading/)).toBeInTheDocument();
    expect(screen.getByText(/1\.0 KB \/ 4\.0 KB/)).toBeInTheDocument();
    expect(screen.getByText(/1\.0 KB\/s/)).toBeInTheDocument();
    expect(screen.getByText("Skipped 2")).toBeInTheDocument();
  });

  it("falls back to the declared size while nothing has been measured", () => {
    render(
      <ArchiveUploadProgress filename="a.zip" percent={0} stats={null} uploading totalFallback={2048} />,
    );
    expect(screen.getByText(/0 B \/ 2\.0 KB/)).toBeInTheDocument();
    expect(screen.getByText(/Calculating speed/)).toBeInTheDocument();
    expect(screen.getByText(/Calculating…/)).toBeInTheDocument();
  });

  it("waits for a speed on a stalled connection", () => {
    render(
      <ArchiveUploadProgress
        filename="a.zip"
        percent={10}
        stats={{ ...stats, bytesPerSecond: 0 }}
        uploading
      />,
    );
    expect(screen.getByText(/Calculating speed/)).toBeInTheDocument();
  });

  it("drops speed and estimate once paused", () => {
    render(<ArchiveUploadProgress filename="a.zip" percent={25} stats={stats} uploading={false} />);
    expect(screen.getByText(/Upload paused/)).toBeInTheDocument();
    expect(screen.queryByText(/Speed:/)).toBeNull();
  });
});

describe("JobProgress", () => {
  it("shows a percentage, detail and estimate", () => {
    render(<JobProgress title="Importing" percent={60} etaSeconds={90} detail="3 of 5" />);
    expect(screen.getByText("Importing: 60%")).toBeInTheDocument();
    expect(screen.getByText("3 of 5")).toBeInTheDocument();
    expect(screen.getByText(/1 min 30 sec remaining/)).toBeInTheDocument();
  });

  it("does not invent a number while the progress is unknown", () => {
    render(<JobProgress title="Importing" percent={null} etaSeconds={null} />);
    expect(screen.getByText("Importing")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Working" })).toBeInTheDocument();
  });
});
