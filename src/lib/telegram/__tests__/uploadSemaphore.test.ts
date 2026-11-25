import { describe, expect, it } from "vitest";
import { UploadPartSemaphore } from "../uploadSemaphore";

describe("UploadPartSemaphore", () => {
  it("bounds active permits and wakes waiters on release", async () => {
    const semaphore = new UploadPartSemaphore(2);
    await semaphore.acquire();
    await semaphore.acquire();
    expect(semaphore.activeCount).toBe(2);

    let thirdAcquired = false;
    const third = semaphore.acquire().then(() => {
      thirdAcquired = true;
    });
    await Promise.resolve();
    expect(thirdAcquired).toBe(false);
    expect(semaphore.waitingCount).toBe(1);

    semaphore.release();
    await third;
    expect(thirdAcquired).toBe(true);
    expect(semaphore.activeCount).toBe(2);
    expect(semaphore.waitingCount).toBe(0);

    semaphore.release();
    semaphore.release();
    expect(semaphore.activeCount).toBe(0);
  });

  it("releases the permit when the task throws", async () => {
    const semaphore = new UploadPartSemaphore(1);
    await expect(
      semaphore.run(async () => {
        throw new Error("upload failed");
      })
    ).rejects.toThrow("upload failed");
    expect(semaphore.activeCount).toBe(0);

    await expect(semaphore.run(async () => "ok")).resolves.toBe("ok");
    expect(semaphore.activeCount).toBe(0);
  });
});
