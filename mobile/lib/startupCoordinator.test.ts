import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { observeStartupRun, StartupCoordinator } from "./startupCoordinator.ts";

describe("StartupCoordinator", () => {
  it("runs initialization once even if start() is called again while running or succeeded", async () => {
    const coordinator = new StartupCoordinator();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const runA = coordinator.start(async () => {
      calls += 1;
      await gate;
    });
    const runB = coordinator.start(async () => {
      calls += 1;
    });

    assert.equal(runA, runB);
    assert.equal(coordinator.state, "running");
    await Promise.resolve();
    assert.equal(calls, 1);

    release();
    await runA.promise;
    assert.equal(coordinator.state, "succeeded");

    const runC = coordinator.start(async () => {
      calls += 1;
    });
    assert.equal(runC, runA);
    assert.equal(calls, 1);
  });

  it("reports UI timeout without cancelling or re-running the in-flight initialization", async () => {
    const coordinator = new StartupCoordinator();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const run = coordinator.start(async () => {
      calls += 1;
      await gate;
    });

    const timedOut = await observeStartupRun(run, 15);
    assert.equal(timedOut.kind, "timeout");
    assert.equal(coordinator.state, "running");

    // Re-trying during timeout reuses the same run instead of launching a second migration.
    const retryRun = coordinator.start(async () => {
      calls += 1;
    });
    assert.equal(retryRun, run);
    assert.equal(calls, 1);

    release();
    const settled = await observeStartupRun(retryRun, 100);
    assert.equal(settled.kind, "success");
    assert.equal(coordinator.state, "succeeded");
  });

  it("allows a fresh generation after an explicit failure", async () => {
    const coordinator = new StartupCoordinator();
    const first = coordinator.start(async () => {
      throw new Error("disk locked");
    });

    const firstResult = await observeStartupRun(first, 100);
    assert.equal(firstResult.kind, "failure");
    assert.equal(coordinator.state, "failed");

    const second = coordinator.start(async () => undefined);
    assert.notEqual(second.generation, first.generation);
    const secondResult = await observeStartupRun(second, 100);
    assert.equal(secondResult.kind, "success");
    assert.equal(coordinator.state, "succeeded");
  });
});
