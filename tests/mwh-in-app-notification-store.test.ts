import { describe, expect, it } from "vitest";
import {
  archiveInAppNotification,
  archiveMatchingInAppNotifications,
  classifyInAppNotification,
  createInAppNotification,
  markAllInAppNotificationsRead,
  markInAppNotificationRead,
  pageInAppNotifications,
  summarizeInAppNotifications,
} from "../src/mwh/modules/notification/in-app-notification-store/core.js";
import { MemoryInAppNotificationStore } from "../src/mwh/modules/notification/in-app-notification-store/memory-store.js";

describe("MWH in-app-notification-store middleware", () => {
  it("creates records and runs read, archive, and expiry transitions without mutating sources", () => {
    const notification = createInAppNotification({
      id: "n1",
      userId: "u1",
      type: "deploy.finished",
      title: " Deploy finished ",
      body: " Production is live ",
      nowMs: 1_000,
      ttlMs: 500,
      metadata: { deployId: "d1" },
    });

    expect(notification).toEqual(
      expect.objectContaining({
        id: "n1",
        userId: "u1",
        title: "Deploy finished",
        body: "Production is live",
        status: "unread",
        expiresAtMs: 1_500,
      }),
    );
    expect(classifyInAppNotification(notification, 1_200)).toBe("unread");
    expect(classifyInAppNotification(notification, 1_500)).toBe("expired");
    expect(markInAppNotificationRead(notification, 1_200)).toEqual(
      expect.objectContaining({ status: "read", readAtMs: 1_200 }),
    );
    expect(archiveInAppNotification(notification, 1_250)).toEqual(
      expect.objectContaining({ status: "archived", archivedAtMs: 1_250 }),
    );
    expect(notification.status).toBe("unread");
  });

  it("pages stateless notifications newest-first with cursor and unread counts", () => {
    const notifications = [
      createInAppNotification({
        id: "n1",
        userId: "u1",
        type: "a",
        title: "First",
        body: "Body",
        nowMs: 1_000,
      }),
      createInAppNotification({
        id: "n2",
        userId: "u1",
        type: "a",
        title: "Second",
        body: "Body",
        nowMs: 1_100,
      }),
      markInAppNotificationRead(
        createInAppNotification({
          id: "n3",
          userId: "u1",
          type: "a",
          title: "Third",
          body: "Body",
          nowMs: 1_200,
        }),
        1_250,
      ),
      createInAppNotification({
        id: "n4",
        userId: "u2",
        type: "a",
        title: "Other",
        body: "Body",
        nowMs: 1_300,
      }),
    ];

    const firstPage = pageInAppNotifications(notifications, {
      userId: "u1",
      nowMs: 1_300,
      limit: 2,
    });
    expect(firstPage.items.map((item) => item.id)).toEqual(["n3", "n2"]);
    expect(firstPage.nextCursor).toBe("n1");
    expect(firstPage.unreadCount).toBe(2);
    expect(
      pageInAppNotifications(notifications, {
        userId: "u1",
        nowMs: 1_300,
        limit: 2,
        cursor: "n2",
      }).items.map((item) => item.id),
    ).toEqual(["n1"]);
  });

  it("runs stateless bulk read, matching archive, and summaries", () => {
    const notifications = [
      createInAppNotification({
        id: "n1",
        userId: "u1",
        type: "deploy",
        title: "Deploy",
        body: "Done",
        nowMs: 1_000,
      }),
      createInAppNotification({
        id: "n2",
        userId: "u1",
        type: "build",
        title: "Build",
        body: "Failed",
        nowMs: 1_100,
      }),
      createInAppNotification({
        id: "n3",
        userId: "u2",
        type: "build",
        title: "Build",
        body: "Other",
        nowMs: 1_200,
      }),
    ];

    const read = markAllInAppNotificationsRead(notifications, {
      userId: "u1",
      type: "build",
      nowMs: 1_300,
    });
    expect(read.changedIds).toEqual(["n2"]);
    expect(read.notifications.map((notification) => notification.status)).toEqual([
      "unread",
      "read",
      "unread",
    ]);

    const archived = archiveMatchingInAppNotifications(read.notifications, {
      userId: "u1",
      includeRead: true,
      nowMs: 1_400,
    });
    expect(archived.changedIds).toEqual(["n1", "n2"]);
    expect(
      summarizeInAppNotifications(archived.notifications, { userId: "u1", nowMs: 1_400 }),
    ).toEqual({
      unread: 0,
      read: 0,
      archived: 0,
      expired: 0,
      totalVisible: 0,
    });
    expect(
      summarizeInAppNotifications(archived.notifications, {
        userId: "u1",
        nowMs: 1_400,
        includeArchived: true,
      }),
    ).toEqual({
      unread: 0,
      read: 0,
      archived: 2,
      expired: 0,
      totalVisible: 2,
    });
  });

  it("runs stateful create, duplicate rejection, read, archive, paging, unread count, TTL pruning, and clone-safe flows", () => {
    let now = 1_000;
    const store = new MemoryInAppNotificationStore({ now: () => now });

    const created = store.create({
      id: "n1",
      userId: "u1",
      type: "deploy.finished",
      title: "Deploy finished",
      body: "Production is live",
      ttlMs: 500,
      metadata: { deployId: "d1" },
    });
    created.metadata!.deployId = "mutated";
    expect(store.get("n1")?.metadata?.deployId).toBe("d1");
    expect(() =>
      store.create({
        id: "n1",
        userId: "u1",
        type: "deploy.finished",
        title: "Duplicate",
        body: "Body",
      }),
    ).toThrow("in-app notification already exists");

    now = 1_100;
    store.create({
      id: "n2",
      userId: "u1",
      type: "build.failed",
      title: "Build failed",
      body: "Fix it",
    });
    store.create({
      id: "n3",
      userId: "u1",
      type: "build.failed",
      title: "Build failed again",
      body: "Fix it too",
    });
    expect(store.unreadCount("u1")).toBe(3);
    expect(store.markRead("n2")).toEqual(
      expect.objectContaining({ status: "read", readAtMs: 1_100 }),
    );
    expect(store.unreadCount("u1")).toBe(2);
    expect(store.markAllRead({ userId: "u1", type: "build.failed" })).toEqual(["n3"]);
    expect(store.summary({ userId: "u1", includeArchived: true })).toEqual({
      unread: 1,
      read: 2,
      archived: 0,
      expired: 0,
      totalVisible: 3,
    });
    expect(store.archive("n2")).toEqual(
      expect.objectContaining({ status: "archived", archivedAtMs: 1_100 }),
    );
    expect(
      store.archiveMatching({ userId: "u1", type: "build.failed", includeRead: true }),
    ).toEqual(["n3"]);
    expect(store.page({ userId: "u1", limit: 10 }).items.map((item) => item.id)).toEqual(["n1"]);
    expect(
      store.page({ userId: "u1", limit: 10, includeArchived: true }).items.map((item) => item.id),
    ).toEqual(["n3", "n2", "n1"]);

    now = 1_500;
    expect(store.pruneExpired()).toBe(1);
    expect(
      store.page({ userId: "u1", limit: 10, includeArchived: true }).items.map((item) => item.id),
    ).toEqual(["n3", "n2"]);
    expect(store.list().map((item) => item.status)).toEqual(["expired", "archived", "archived"]);
  });
});
