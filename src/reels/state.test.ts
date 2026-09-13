import assert from "node:assert/strict";
import test from "node:test";
import { canTransitionReel } from "./state.js";

test("reel state machine requires approval before publishing", () => {
  assert.equal(canTransitionReel("pending_approval", "approved"), true);
  assert.equal(canTransitionReel("pending_approval", "publishing"), false);
  assert.equal(canTransitionReel("approved", "publishing"), true);
});

test("rejected reels cannot publish", () => {
  assert.equal(canTransitionReel("rejected", "publishing"), false);
});
