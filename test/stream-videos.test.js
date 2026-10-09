import { test } from "node:test";
import assert from "node:assert/strict";
import { registerStreamVideoTools } from "../lib/tools/stream-videos.js";

// The create_video tool, against a recording fake of the Stream API client.
function setup() {
  const handlers = {};
  const server = { tool(name, _d, _s, _a, handler) { handlers[name] = handler; } };
  const calls = [];
  const http = {
    async post(url, body, config) {
      calls.push({ url, body, config });
      return { data: { guid: "v1" } };
    },
  };
  registerStreamVideoTools(server, http, {});
  return { create: handlers.bunny_create_video, calls };
}

// #6: Bunny's Fetch Video endpoint reads collectionId from the query string and
// ignores it in the body, so every fetched video landed in no collection.
test("create_video with fetch_url sends collectionId as a query parameter, not in the body", async () => {
  const { create, calls } = setup();
  await create({ library_id: 7, title: "T", fetch_url: "https://x.test/v.mp4", collection_id: "c-1" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/library/7/videos/fetch");
  assert.deepEqual(calls[0].body, { title: "T", url: "https://x.test/v.mp4" });
  assert.deepEqual(calls[0].config, { params: { collectionId: "c-1" } });
});

test("create_video with fetch_url and no collection sends no query parameters", async () => {
  const { create, calls } = setup();
  await create({ library_id: 7, title: "T", fetch_url: "https://x.test/v.mp4" });
  assert.deepEqual(calls[0].body, { title: "T", url: "https://x.test/v.mp4" });
  assert.equal(calls[0].config, undefined);
});

test("create_video without fetch_url keeps collectionId in the body, where that endpoint reads it", async () => {
  const { create, calls } = setup();
  await create({ library_id: 7, title: "T", collection_id: "c-1" });
  assert.equal(calls[0].url, "/library/7/videos");
  assert.deepEqual(calls[0].body, { title: "T", collectionId: "c-1" });
  assert.equal(calls[0].config, undefined);
});
