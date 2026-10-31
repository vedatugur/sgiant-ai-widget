import test from "node:test";
import assert from "node:assert/strict";
import { WIDGET_LABELS } from "../dist/labels.js";
import { WIDGET_LABELS_TR } from "../dist/labels-tr.js";

/**
 * THE APPS' ENGLISH WINS (owner's F128 decision, 2026-10-31).
 *
 * Three job-card labels were worded one way by the window and another by the
 * apps that host it. The owner chose the apps' English everywhere, letter for
 * letter; the Turkish stays as it was.
 */
test("the window's English job labels are the apps' words", () => {
  assert.equal(WIDGET_LABELS.jobTitleFallback, "Working on it");
  assert.equal(
    WIDGET_LABELS.jobWatchingInPane,
    "Following along at the side →"
  );
  assert.equal(
    WIDGET_LABELS.jobEvInterrupted,
    "Interrupted, and not started again by itself"
  );
});

test("their Turkish is unchanged", () => {
  assert.equal(WIDGET_LABELS_TR.jobTitleFallback, "Üzerinde çalışılıyor");
  assert.equal(
    WIDGET_LABELS_TR.jobWatchingInPane,
    "Yan tarafta takip ediliyor →"
  );
  assert.equal(
    WIDGET_LABELS_TR.jobEvInterrupted,
    "Yarıda kesildi ve kendiliğinden yeniden başlatılmadı"
  );
});
