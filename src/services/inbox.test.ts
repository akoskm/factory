import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isActiveInboxRow,
  shouldArchiveInboxEpisode,
  shouldOpenInboxEpisode,
  shouldWakeSnoozedEpisode,
} from "./inbox.js";

describe("inbox episode rules", () => {
  it("opens a new episode on needs_user when missing or dismissed", () => {
    assert.equal(
      shouldOpenInboxEpisode({ status: "needs_user", existing: null }),
      true,
    );
    assert.equal(
      shouldOpenInboxEpisode({
        status: "needs_user",
        existing: { dismissedAt: new Date() },
      }),
      true,
    );
    assert.equal(
      shouldOpenInboxEpisode({
        status: "needs_user",
        existing: { dismissedAt: null },
      }),
      false,
    );
    assert.equal(
      shouldOpenInboxEpisode({ status: "running", existing: null }),
      false,
    );
  });

  it("archives when leaving needs_user while episode open", () => {
    assert.equal(
      shouldArchiveInboxEpisode({
        status: "running",
        existing: { dismissedAt: null },
      }),
      true,
    );
    assert.equal(
      shouldArchiveInboxEpisode({
        status: "needs_user",
        existing: { dismissedAt: null },
      }),
      false,
    );
    assert.equal(
      shouldArchiveInboxEpisode({
        status: "failed",
        existing: { dismissedAt: new Date() },
      }),
      false,
    );
  });

  it("wakes a snoozed open episode when still needs_user", () => {
    assert.equal(
      shouldWakeSnoozedEpisode({
        status: "needs_user",
        existing: { dismissedAt: null, snoozedUntil: new Date() },
      }),
      true,
    );
    assert.equal(
      shouldWakeSnoozedEpisode({
        status: "needs_user",
        existing: { dismissedAt: null, snoozedUntil: null },
      }),
      false,
    );
    assert.equal(
      shouldWakeSnoozedEpisode({
        status: "needs_user",
        existing: { dismissedAt: new Date(), snoozedUntil: new Date() },
      }),
      false,
    );
    assert.equal(
      shouldWakeSnoozedEpisode({ status: "running", existing: null }),
      false,
    );
  });

  it("active excludes snoozed and dismissed", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    assert.equal(
      isActiveInboxRow({
        status: "needs_user",
        dismissedAt: null,
        snoozedUntil: null,
        now,
      }),
      true,
    );
    assert.equal(
      isActiveInboxRow({
        status: "needs_user",
        dismissedAt: null,
        snoozedUntil: new Date("2026-01-01T11:00:00Z"),
        now,
      }),
      true,
    );
    assert.equal(
      isActiveInboxRow({
        status: "needs_user",
        dismissedAt: null,
        snoozedUntil: new Date("2026-01-01T13:00:00Z"),
        now,
      }),
      false,
    );
    assert.equal(
      isActiveInboxRow({
        status: "needs_user",
        dismissedAt: new Date(),
        snoozedUntil: null,
        now,
      }),
      false,
    );
  });
});
