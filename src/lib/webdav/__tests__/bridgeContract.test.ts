import { describe, expect, it } from "vitest";
import { normalizeBridgeResponse, parseBridgeRequest } from "../types";

describe("parseBridgeRequest", () => {
  it("accepts the flattened payload Rust emits", () => {
    const parsed = parseBridgeRequest({
      id: 7,
      method: "propfind",
      path: "/Docs",
      depth: "1",
      destination: "/Target",
      overwrite: "T",
      lockToken: "<opaquelocktoken:abc>",
      ifHeader: "(<opaquelocktoken:abc>)",
      timeout: "Second-600",
      range: "bytes=0-9",
      contentType: "text/plain",
      contentLength: 10,
      bodyPath: "C:/tmp/body.bin",
      outputPath: "C:/tmp/out.bin",
    });
    expect(parsed).toMatchObject({
      id: 7,
      method: "PROPFIND",
      path: "/Docs",
      depth: "1",
      destination: "/Target",
      contentLength: 10,
      bodyPath: "C:/tmp/body.bin",
      outputPath: "C:/tmp/out.bin",
    });
  });

  it("accepts optional fields being absent", () => {
    const parsed = parseBridgeRequest({ id: 1, method: "OPTIONS", path: "/" });
    expect(parsed.depth).toBeUndefined();
    expect(parsed.bodyPath).toBeUndefined();
    expect(parsed.contentLength).toBeUndefined();
  });

  it("rejects malformed ids, methods and paths", () => {
    expect(() => parseBridgeRequest(null)).toThrow();
    expect(() => parseBridgeRequest({ id: 0, method: "GET", path: "/" })).toThrow();
    expect(() => parseBridgeRequest({ id: 1, method: "G ET", path: "/" })).toThrow();
    expect(() => parseBridgeRequest({ id: 1, method: "GET", path: "/../etc" })).toThrow();
    expect(() => parseBridgeRequest({ id: 1, method: "GET", path: "/x", depth: 1 })).toThrow();
    expect(() =>
      parseBridgeRequest({ id: 1, method: "PUT", path: "/x", contentLength: -1 })
    ).toThrow();
  });

  it("normalizes destination paths", () => {
    const parsed = parseBridgeRequest({
      id: 2,
      method: "MOVE",
      path: "/a/./b",
      destination: "/dest//x/",
    });
    expect(parsed.path).toBe("/a/b");
    expect(parsed.destination).toBe("/dest/x");
  });
});

describe("normalizeBridgeResponse", () => {
  it("clamps invalid statuses and strips unsafe headers", () => {
    const response = normalizeBridgeResponse({
      status: 99,
      headers: {
        ETag: '"abc"',
        Bad: "line\r\nInjected: yes",
        "another\nname": "x",
      },
      body: "hello",
    });
    expect(response.status).toBe(500);
    expect(response.headers).toEqual({ ETag: '"abc"' });
    expect(response.body).toBe("hello");
    expect(response.bodyPath).toBeUndefined();
  });

  it("preserves body paths for GET responses", () => {
    const response = normalizeBridgeResponse({
      status: 206,
      headers: { "Content-Range": "bytes 2-5/10" },
      bodyPath: "C:/tmp/out.bin",
    });
    expect(response.status).toBe(206);
    expect(response.bodyPath).toBe("C:/tmp/out.bin");
    expect(response.body).toBeUndefined();
  });
});
