import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { UsageDonuts } from "@/components/admin/monitor/usage-donuts";
import type { ContainerInfo, HostInfo } from "@/lib/admin-monitor";

const GB = 1024 ** 3;

const host: HostInfo = {
  cpus: 4,
  load: [1, 1, 1],
  memory_total: 16 * GB,
  memory_used: 8 * GB,
  memory_available: 8 * GB,
  swap_total: 0,
  swap_used: 0,
  disk_total: 1,
  disk_used: 0,
  uptime_seconds: 1,
  docker_version: "29",
  os: "Ubuntu",
  kernel: "",
  containers_total: 3,
  containers_running: 3,
  images: 1,
};

function container(
  name: string,
  memory: number,
  cpu: number,
  extra: Partial<ContainerInfo> = {},
): ContainerInfo {
  return {
    id: name,
    name,
    image: "img",
    state: "running",
    status: "Up",
    project: "wikihub",
    service: name,
    created: 0,
    uptime_seconds: 10,
    restarts: 0,
    health: "healthy",
    cpu_percent: cpu,
    memory_bytes: memory,
    memory_limit: null,
    ...extra,
  };
}

const containers = [
  container("wikihub-backend-1", 4 * GB, 100),
  container("wikihub-postgres-1", 2 * GB, 50),
  container("wikihub-redis-1", 0.5 * GB, 2),
  container("wikihub-migrate-1", 0, 0, { state: "exited" }),
];

function card(title: string) {
  return screen.getByText(title).closest("div.border-border") as HTMLElement;
}

describe("UsageDonuts", () => {
  it("shows each container's share of the whole server's memory, and what is left", () => {
    render(<UsageDonuts host={host} containers={containers} />);

    const memory = within(card("Memory"));
    expect(memory.getByText("of 16.00 GB")).toBeInTheDocument();
    const backend = memory.getByRole("button", { name: /wikihub-backend-1/ });
    expect(backend).toHaveTextContent("4.00 GB");
    expect(backend).toHaveTextContent("25%");
    // 8 GB used on the host, 6.5 GB of it by containers.
    expect(
      memory.getByRole("button", { name: /System and other/ }),
    ).toHaveTextContent("1.50 GB");
    expect(memory.getByRole("button", { name: /Free/ })).toHaveTextContent(
      "50%",
    );
    // A container that is not running has no slice.
    expect(memory.queryByText("wikihub-migrate-1")).not.toBeInTheDocument();
  });

  it("reads CPU against every core: 100% is one core", () => {
    render(<UsageDonuts host={host} containers={containers} />);

    const cpu = within(card("CPU"));
    expect(cpu.getByText("of 4 cores")).toBeInTheDocument();
    const backend = cpu.getByRole("button", { name: /wikihub-backend-1/ });
    expect(backend).toHaveTextContent("1.00 cores");
    expect(backend).toHaveTextContent("25%"); // one core of four
    expect(cpu.getByRole("button", { name: /Free/ })).toHaveTextContent("62%");
  });

  it("puts a slice's figures in the centre while its row is hovered or focused", async () => {
    render(<UsageDonuts host={host} containers={containers} />);
    const memory = within(card("Memory"));

    expect(memory.getByText("used by containers")).toBeInTheDocument();
    await userEvent.hover(
      memory.getByRole("button", { name: /wikihub-postgres-1/ }),
    );
    expect(
      memory.getByText("wikihub-postgres-1 · 2.00 GB"),
    ).toBeInTheDocument();
    await userEvent.unhover(
      memory.getByRole("button", { name: /wikihub-postgres-1/ }),
    );
    expect(memory.getByText("used by containers")).toBeInTheDocument();

    // A keyboard user gets the same from focusing a row.
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(
      memory.getByRole("button", { name: /wikihub-backend-1/ }),
    ).toHaveFocus();
    expect(memory.getByText("wikihub-backend-1 · 4.00 GB")).toBeInTheDocument();
  });

  it("can compare the containers among themselves instead of against the whole server", async () => {
    render(<UsageDonuts host={host} containers={containers} />);
    const memory = within(card("Memory"));
    expect(
      memory.getByRole("button", { name: "Whole server" }),
    ).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(
      memory.getByRole("button", { name: "Containers only" }),
    );

    // 4 + 2 + 0.5 GB between them: the biggest is 61.5% of that, not 25% of 16 GB.
    expect(
      memory.getByRole("button", { name: /wikihub-backend-1/ }),
    ).toHaveTextContent("62%");
    expect(
      memory.queryByRole("button", { name: /Free/ }),
    ).not.toBeInTheDocument();
    expect(
      memory.queryByRole("button", { name: /System and other/ }),
    ).not.toBeInTheDocument();
    expect(memory.getByText("6.50 GB")).toBeInTheDocument();
    expect(memory.getByText("in total")).toBeInTheDocument();
    // The other chart keeps its own choice.
    expect(
      within(card("CPU")).getByRole("button", { name: "Whole server" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("names the chart for assistive technology, with the total used", () => {
    render(<UsageDonuts host={host} containers={containers} />);
    expect(
      screen.getByRole("img", { name: /Memory: used by containers 41%/ }),
    ).toBeInTheDocument();
  });

  it('says "1 other container", not "1 other containers"', () => {
    const seven = Array.from({ length: 7 }, (_, i) =>
      container(`svc-${i}`, (i + 1) * 0.1 * GB, i + 1),
    );
    render(<UsageDonuts host={host} containers={seven} />);
    expect(
      within(card("Memory")).getByRole("button", {
        name: /1 other container /,
      }),
    ).toBeInTheDocument();
  });

  it("folds the smallest containers into one row", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      container(`svc-${i}`, (i + 1) * 0.1 * GB, i + 1),
    );
    render(<UsageDonuts host={host} containers={many} />);

    const memory = within(card("Memory"));
    expect(
      memory.getByRole("button", { name: /3 other containers/ }),
    ).toBeInTheDocument();
  });

  it("shows nothing before there are containers to chart", () => {
    const { container: root } = render(
      <UsageDonuts host={host} containers={[]} />,
    );
    expect(root).toBeEmptyDOMElement();
  });
});
