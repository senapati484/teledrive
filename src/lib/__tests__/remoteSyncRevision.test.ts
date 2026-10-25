import { beforeEach, describe, expect, it, vi } from "vitest";
import { getIndexQueue, resetQueuesForTests } from "../storage/indexQueue";
import { hasIndexRevisionChanged } from "../storage/metadataStore";

const h = vi.hoisted(() => ({
  messages: [] as any[],
  client: {
    getInputEntity: vi.fn(async () => ({ id: 1 })),
    getMessages: vi.fn(async () => h.messages),
    getEntity: vi.fn(async () => ({ id: 1 })),
  },
}));

vi.mock("../telegram/client", () => ({ getClient: () => h.client }));

const CHANNEL = "chan_revision";

beforeEach(() => {
  resetQueuesForTests();
  h.messages = [];
  h.client.getInputEntity.mockClear();
  h.client.getMessages.mockClear();
});

describe("index revision detection", () => {
  it("returns false for an unchanged in-place chunk", async () => {
    getIndexQueue(CHANNEL).setKnownIndex([100], ["chunk-text"]);
    h.messages = [{ id: 100, text: "chunk-text" }];

    await expect(hasIndexRevisionChanged(CHANNEL)).resolves.toBe(false);
  });

  it("detects an edited chunk", async () => {
    getIndexQueue(CHANNEL).setKnownIndex([100], ["old-text"]);
    h.messages = [{ id: 100, text: "new-text" }];

    await expect(hasIndexRevisionChanged(CHANNEL)).resolves.toBe(true);
  });

  it("detects a deleted/replaced chunk", async () => {
    getIndexQueue(CHANNEL).setKnownIndex([100], ["chunk-text"]);
    h.messages = [];

    await expect(hasIndexRevisionChanged(CHANNEL)).resolves.toBe(true);
  });
});
