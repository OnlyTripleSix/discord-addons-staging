(() => {
  "use strict";

  const V = vendetta;
  if (!V?.metro?.common) return {};

  const { React, ReactNative: RN } = V.metro.common;
  const { instead } = V.patcher;
  const { storage } = V.plugin;
  const VERSION = "2.5.1-shiggy";

  storage.onlyActiveNotifications ??= true;

  const runtime = {
    multiAccountStore: null,
    userStore: null,
    actions: null,
    pushActions: null,
    notificationTokenManager: null,
    receiveNotificationModule: null,
    rest: null,
    pushUnpatch: null,
    receiveUnpatch: null,
    notificationStatus: "starting",
    blockedNotifications: 0,
    lastBlockedAt: 0,
    lastBlockedUserId: "",
    lastNativeSyncAt: 0,
    lastNativeSyncKey: "",
    lastSuccessfulKey: "",
    syncInFlight: null,
    pendingSync: false,
    pendingForce: false,
    startupTimer: null,
    switchRepairTimers: [],
    lastDetachStatus: "none",
    lastExplicitSyncStatus: "none",
    loaded: false,
  };

  const C = {
    bg: "#111214",
    card: "#1e1f22",
    card2: "#2b2d31",
    text: "#f2f3f5",
    muted: "#b5bac1",
    green: "#23a55a",
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function toast(text) {
    const value = String(text);
    try {
      const actions = V.metro?.common?.toasts;
      if (typeof actions?.open === "function") {
        actions.open(`its666-account-switcher-${Date.now()}`, { text: value });
        return;
      }
    } catch {}
    try { V.ui?.toasts?.showToast?.(value); } catch {}
  }

  function find(...props) {
    try { return V.metro?.findByProps?.(...props); } catch { return undefined; }
  }

  function findStore(name) {
    try { return V.metro?.findByStoreName?.(name); } catch { return undefined; }
  }

  function findModule(predicate) {
    try { return V.metro?.find?.(predicate); } catch { return undefined; }
  }

  function unwrapDefault(value) {
    if (value?.default && (typeof value.default === "object" || typeof value.default === "function")) {
      return value.default;
    }
    return value;
  }

  function resolveRuntime() {
    runtime.multiAccountStore ??= (
      findStore("MultiAccountStore")
      ?? find("getUsers", "getValidUsers", "getHasLoggedInAccounts")
      ?? find("getUsers", "getValidUsers")
    );
    runtime.userStore ??= findStore("UserStore") ?? find("getCurrentUser", "getUser");
    runtime.actions ??= (
      find("switchAccount", "removeAccount", "moveAccount")
      ?? find("switchAccount", "removeAccount")
      ?? find("switchAccount")
    );
    return runtime;
  }

  function resolveNotifications() {
    resolveRuntime();

    runtime.pushActions ??= unwrapDefault(
      find("registerDevice", "syncDevice", "unregisterDevice")
    );

    runtime.notificationTokenManager ??= unwrapDefault(
      find("registerToken", "getToken", "handleSyncWithMultiAccount")
      ?? findModule(module => {
        const value = unwrapDefault(module);
        return !!value
          && typeof value.getToken === "function"
          && typeof value.registerToken === "function"
          && typeof value.handleSyncWithMultiAccount === "function";
      })
    );

    if (!runtime.receiveNotificationModule) {
      const module = findModule(candidate => {
        const fn = candidate?.default;
        if (typeof fn !== "function") return false;
        if (fn.name === "receiveNotification") return true;
        try { return String(fn).includes("receiving_user_id"); } catch { return false; }
      });
      if (module?.default && typeof module.default === "function") {
        runtime.receiveNotificationModule = module;
      }
    }

    runtime.rest ??= (
      find("getAPIBaseURL", "get", "del", "post", "put")
      ?? find("getAPIBaseURL", "get", "del", "post")
    );

    return runtime;
  }

  function currentId() {
    resolveRuntime();
    try { return String(runtime.userStore?.getCurrentUser?.()?.id ?? ""); }
    catch { return ""; }
  }

  function entryId(entry) {
    return String(entry?.id ?? entry?.user?.id ?? "");
  }

  function getPushToken() {
    resolveNotifications();
    try { return runtime.notificationTokenManager?.getToken?.() ?? null; }
    catch { return null; }
  }

  function validUserIds() {
    resolveRuntime();
    try {
      const users = runtime.multiAccountStore?.getValidUsers?.();
      return Array.isArray(users)
        ? users.map(entryId).filter(Boolean).sort()
        : [];
    } catch {
      return [];
    }
  }

  function desiredSyncKey(activeOnly = storage.onlyActiveNotifications === true, token = getPushToken()) {
    const accounts = activeOnly ? [currentId()].filter(Boolean) : validUserIds();
    return `${activeOnly ? "active" : "default"}:${accounts.join(",")}:${String(token ?? "")}`;
  }

  function activePushSyncToken() {
    resolveRuntime();
    const active = currentId();
    if (!active) return null;
    try {
      const users = runtime.multiAccountStore?.getValidUsers?.();
      const account = Array.isArray(users) ? users.find(user => entryId(user) === active) : null;
      return account?.pushSyncToken ?? null;
    } catch {
      return null;
    }
  }

  function activePushSyncTokenReady() {
    return !!activePushSyncToken();
  }

  function pushProvider() {
    return RN.Platform?.OS === "ios" ? "apns" : "gcm";
  }

  async function explicitActiveSync(deviceToken) {
    resolveNotifications();
    const rest = runtime.rest;
    const syncToken = activePushSyncToken();
    if (!deviceToken) throw new Error("Android push token unavailable");
    if (!syncToken) throw new Error("active account push sync token unavailable");
    if (typeof rest?.put !== "function") throw new Error("Discord REST PUT unavailable");

    const response = await Promise.resolve(rest.put({
      url: "/users/@me/devices/sync",
      body: {
        provider: pushProvider(),
        token: String(deviceToken),
        push_sync_tokens: [String(syncToken)],
      },
    }));

    const invalid = response?.body?.invalid_push_sync_tokens;
    if (Array.isArray(invalid) && invalid.map(String).includes(String(syncToken))) {
      throw new Error("Discord rejected the active account push sync token");
    }

    runtime.lastExplicitSyncStatus = "ok";
    return response;
  }

  async function unregisterCurrentDevice(deviceToken) {
    resolveNotifications();
    const rest = runtime.rest;
    if (!deviceToken || typeof rest?.del !== "function") {
      runtime.lastDetachStatus = "unavailable";
      return false;
    }

    try {
      const response = await Promise.resolve(rest.del({
        url: "/users/@me/devices",
        body: {
          provider: pushProvider(),
          token: String(deviceToken),
        },
      }));
      const ok = syncResultSucceeded(response);
      runtime.lastDetachStatus = ok ? "ok" : "failed";
      return ok;
    } catch {
      runtime.lastDetachStatus = "failed";
      return false;
    }
  }

  function syncResultSucceeded(result) {
    if (result == null) return true;
    if (result?.ok === false) return false;
    const status = Number(result?.status ?? result?.statusCode ?? NaN);
    if (Number.isFinite(status)) return status >= 200 && status < 400;
    return true;
  }

  function syncFailureText(result) {
    const status = Number(result?.status ?? result?.statusCode ?? NaN);
    return Number.isFinite(status) ? `sync failed: HTTP ${status}` : "sync failed";
  }

  function uninstallPushPatch() {
    if (!runtime.pushUnpatch) return;
    try { runtime.pushUnpatch(); } catch {}
    runtime.pushUnpatch = null;
  }

  function uninstallReceiveFilter() {
    if (!runtime.receiveUnpatch) return;
    try { runtime.receiveUnpatch(); } catch {}
    runtime.receiveUnpatch = null;
  }

  function installReceiveFilter() {
    if (storage.onlyActiveNotifications !== true) {
      uninstallReceiveFilter();
      return false;
    }
    if (runtime.receiveUnpatch) return true;

    resolveNotifications();
    const module = runtime.receiveNotificationModule;
    if (!module || typeof module.default !== "function") return false;

    runtime.receiveUnpatch = instead("default", module, (args, original) => {
      if (storage.onlyActiveNotifications !== true) return original(...args);

      const source = args?.[0];
      const getter = source?.getData;
      if (typeof getter !== "function") return original(...args);

      let data;
      try { data = getter.call(source); }
      catch { return original(...args); }

      const receivingId = data?.receiving_user_id;
      const active = currentId();

      // Fail open when Discord does not identify the receiving account.
      // Only suppress a push when both IDs are explicit and they disagree.
      if (receivingId != null && active && String(receivingId) !== active) {
        runtime.blockedNotifications += 1;
        runtime.lastBlockedAt = Date.now();
        runtime.lastBlockedUserId = String(receivingId);
        return false;
      }

      return original(...args);
    });

    return true;
  }

  function callOriginalActiveOnly(args, original) {
    const store = runtime.multiAccountStore;
    const active = currentId();
    if (!active || typeof store?.getValidUsers !== "function") return original(...args);

    const originalGetter = store.getValidUsers;
    const ownDescriptor = Object.getOwnPropertyDescriptor(store, "getValidUsers");
    const restore = () => {
      try {
        if (ownDescriptor) Object.defineProperty(store, "getValidUsers", ownDescriptor);
        else delete store.getValidUsers;
      } catch {}
    };

    try {
      Object.defineProperty(store, "getValidUsers", {
        configurable: true,
        writable: true,
        value: function getOnlyActiveUser() {
          const users = originalGetter.call(store);
          return Array.isArray(users)
            ? users.filter(user => entryId(user) === active)
            : users;
        },
      });

      const result = original(...args);
      if (result && typeof result.then === "function") {
        return Promise.resolve(result).finally(restore);
      }
      restore();
      return result;
    } catch (error) {
      restore();
      throw error;
    }
  }

  function installPushPatch() {
    if (storage.onlyActiveNotifications !== true) {
      uninstallPushPatch();
      return false;
    }
    if (runtime.pushUnpatch) return true;

    resolveNotifications();
    const pushActions = runtime.pushActions;
    if (typeof pushActions?.syncDevice !== "function") {
      runtime.notificationStatus = "waiting for Discord push modules";
      return false;
    }

    runtime.pushUnpatch = instead("syncDevice", pushActions, (args, original) => {
      if (storage.onlyActiveNotifications !== true) return original(...args);

      const active = currentId();
      const deviceToken = args?.[0] ?? getPushToken();
      if (!active || !deviceToken) return original(...args);

      const key = desiredSyncKey(true, deviceToken);
      runtime.lastNativeSyncAt = Date.now();
      runtime.lastNativeSyncKey = key;

      let result;
      if (typeof runtime.rest?.put === "function" && activePushSyncTokenReady()) {
        result = explicitActiveSync(deviceToken);
      } else {
        // Fallback for builds where the REST PUT wrapper or sync token is not ready:
        // keep the active-only account view in place for the entire native sync promise.
        result = callOriginalActiveOnly(args, original);
      }

      Promise.resolve(result)
        .then(response => {
          if (storage.onlyActiveNotifications !== true) return;
          const tokenReady = !runtime.multiAccountStore?.canUseMultiAccountNotifications || activePushSyncTokenReady();
          if (syncResultSucceeded(response) && tokenReady) {
            runtime.lastSuccessfulKey = key;
            runtime.notificationStatus = typeof runtime.rest?.put === "function"
              ? "active account locked"
              : "active account synced";
          } else if (!tokenReady) {
            runtime.notificationStatus = "waiting for account push token";
          } else {
            runtime.notificationStatus = syncFailureText(response);
          }
        })
        .catch(error => {
          runtime.lastExplicitSyncStatus = "failed";
          if (storage.onlyActiveNotifications === true) {
            runtime.notificationStatus = `sync failed: ${error?.message ?? error}`;
          }
        });

      return result;
    });

    return true;
  }

  function applyPatchForMode() {
    if (storage.onlyActiveNotifications === true) {
      const push = installPushPatch();
      const local = installReceiveFilter();
      return push || local;
    }
    uninstallPushPatch();
    uninstallReceiveFilter();
    return true;
  }

  async function performSync(force) {
    resolveNotifications();
    applyPatchForMode();

    const activeOnly = storage.onlyActiveNotifications === true;
    const manager = runtime.notificationTokenManager;
    const pushActions = runtime.pushActions;
    const token = getPushToken();

    if (!token) {
      runtime.notificationStatus = "waiting for Android push token";
      return false;
    }

    const key = desiredSyncKey(activeOnly, token);
    if (!force && runtime.lastSuccessfulKey === key) {
      runtime.notificationStatus = activeOnly ? "server sync complete" : "Discord default";
      return true;
    }

    try {
      let result;
      if (
        typeof pushActions?.syncDevice === "function"
        && runtime.multiAccountStore?.canUseMultiAccountNotifications
      ) {
        result = await Promise.resolve(pushActions.syncDevice(token, false));
      } else if (typeof manager?.registerToken === "function") {
        result = await Promise.resolve(manager.registerToken());
      } else {
        runtime.notificationStatus = "push registration unavailable";
        return false;
      }

      if (!syncResultSucceeded(result)) {
        runtime.notificationStatus = syncFailureText(result);
        return false;
      }

      if (
        activeOnly
        && runtime.multiAccountStore?.canUseMultiAccountNotifications
        && !activePushSyncTokenReady()
      ) {
        runtime.notificationStatus = "waiting for account push token";
        return false;
      }

      runtime.lastSuccessfulKey = key;
      runtime.notificationStatus = activeOnly ? "server sync complete" : "Discord default";
      return true;
    } catch (error) {
      runtime.notificationStatus = `sync failed: ${error?.message ?? error}`;
      return false;
    }
  }

  function requestSync(force = false) {
    runtime.pendingSync = true;
    runtime.pendingForce ||= force;

    if (runtime.syncInFlight) return runtime.syncInFlight;

    runtime.syncInFlight = (async () => {
      let result = false;
      while (runtime.pendingSync) {
        const runForce = runtime.pendingForce;
        const beforeKey = desiredSyncKey();
        runtime.pendingSync = false;
        runtime.pendingForce = false;
        result = await performSync(runForce);

        // If mode/account/token changed while the request was running,
        // do one final coalesced sync for the newest state.
        if (beforeKey !== desiredSyncKey()) runtime.pendingSync = true;
      }
      return result;
    })().finally(() => {
      runtime.syncInFlight = null;
    });

    return runtime.syncInFlight;
  }

  async function initializeNotificationProtection() {
    const waits = [0, 250, 750, 1500, 3000];
    for (const wait of waits) {
      if (wait) await sleep(wait);
      resolveNotifications();
      applyPatchForMode();
      if (
        runtime.pushActions
        && getPushToken()
        && (storage.onlyActiveNotifications !== true || runtime.receiveUnpatch)
      ) break;
    }

    if (storage.onlyActiveNotifications === true) {
      if (getPushToken()) await requestSync(true);
      else runtime.notificationStatus = "waiting for Android push token";
    } else {
      runtime.notificationStatus = "Discord default";
    }
  }

  function clearSwitchRepairs() {
    for (const timer of runtime.switchRepairTimers.splice(0)) {
      try { clearTimeout(timer); } catch {}
    }
  }

  function armSwitchRepairs(targetId) {
    clearSwitchRepairs();
    for (const wait of [500, 2500, 7000]) {
      runtime.switchRepairTimers.push(setTimeout(() => {
        if (!runtime.loaded || storage.onlyActiveNotifications !== true) return;
        if (currentId() !== String(targetId)) return;
        requestSync(true).catch(() => {});
      }, wait));
    }
  }

  function restoreDiscordNotifications() {
    uninstallPushPatch();
    resolveNotifications();

    const manager = runtime.notificationTokenManager;
    const pushActions = runtime.pushActions;
    const token = getPushToken();
    if (!token) return;

    try {
      if (
        typeof pushActions?.syncDevice === "function"
        && runtime.multiAccountStore?.canUseMultiAccountNotifications
      ) {
        Promise.resolve(pushActions.syncDevice(token, false)).catch(() => {});
      } else if (typeof manager?.registerToken === "function") {
        Promise.resolve(manager.registerToken()).catch(() => {});
      }
    } catch {}
  }

  function normalizeAccount(entry) {
    const base = entry?.user ?? entry;
    if (!base?.id) return null;

    let user = base;
    try { user = runtime.userStore?.getUser?.(String(base.id)) ?? base; } catch {}

    return {
      id: String(base.id),
      username: String(user?.username ?? base?.username ?? base.id),
      displayName: String(
        user?.globalName
        ?? user?.global_name
        ?? user?.displayName
        ?? base?.globalName
        ?? base?.global_name
        ?? base?.username
        ?? base.id,
      ),
    };
  }

  function accountList() {
    resolveRuntime();
    const found = [];
    const store = runtime.multiAccountStore;

    for (const getter of ["getValidUsers", "getUsers"]) {
      try {
        const raw = store?.[getter]?.();
        const list = Array.isArray(raw)
          ? raw
          : raw && typeof raw === "object"
            ? Object.values(raw)
            : [];

        for (const entry of list) {
          const account = normalizeAccount(entry);
          if (account) found.push(account);
        }
      } catch {}
    }

    try {
      const current = normalizeAccount(runtime.userStore?.getCurrentUser?.());
      if (current) found.push(current);
    } catch {}

    const active = currentId();
    return [...new Map(found.map(account => [account.id, account])).values()]
      .sort((a, b) => {
        if (a.id === active) return -1;
        if (b.id === active) return 1;
        return a.displayName.localeCompare(b.displayName);
      });
  }

  async function switchAccount(id) {
    resolveRuntime();
    const target = String(id ?? "");
    if (!target || target === currentId()) return;

    const fn = runtime.actions?.switchAccount;
    if (typeof fn !== "function") {
      throw new Error("Discord's multi-account switch action was not found");
    }

    const activeOnly = storage.onlyActiveNotifications === true;
    const deviceToken = activeOnly ? getPushToken() : null;

    // Detach the account we are leaving while it is still the authenticated account.
    // This prevents its old FCM registration from surviving the switch.
    if (activeOnly && deviceToken) {
      runtime.notificationStatus = "detaching previous account";
      await unregisterCurrentDevice(deviceToken);
    }

    try {
      await Promise.resolve(fn(target, undefined));
    } catch (error) {
      // If the switch itself fails, restore notification registration for the
      // account that remains active.
      if (activeOnly) requestSync(true).catch(() => {});
      throw error;
    }

    if (activeOnly) armSwitchRepairs(target);
  }

  function NotificationToggle({ refresh }) {
    const enabled = storage.onlyActiveNotifications === true;

    return React.createElement(RN.View, {
      style: {
        backgroundColor: C.card,
        padding: 14,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
      },
    }, [
      React.createElement(RN.View, { key: "copy", style: { flex: 1, paddingRight: 12 } }, [
        React.createElement(RN.Text, {
          key: "title",
          style: { color: C.text, fontSize: 15, fontWeight: "700" },
        }, "Only notify active account"),
        React.createElement(RN.Text, {
          key: "desc",
          style: { color: C.muted, marginTop: 4, fontSize: 12, lineHeight: 17 },
        }, "Detaches the account you leave, locks server push sync to the active account, and keeps a local receiving-account guard as backup."),
        React.createElement(RN.Text, {
          key: "status",
          style: {
            color: enabled ? C.green : C.muted,
            marginTop: 5,
            fontSize: 11,
            lineHeight: 16,
          },
        }, `Status: ${runtime.notificationStatus} • local:${runtime.receiveUnpatch ? "armed" : "waiting"}${runtime.blockedNotifications ? ` • blocked ${runtime.blockedNotifications}` : ""}`),
      ]),
      React.createElement(RN.Switch, {
        key: "switch",
        value: enabled,
        onValueChange: value => {
          storage.onlyActiveNotifications = value;
          applyPatchForMode();
          refresh();

          requestSync(true)
            .then(ok => {
              toast(ok
                ? (value ? "Active-account protection enabled" : "Multi-account notifications restored")
                : "Notification protection is waiting for Discord");
              refresh();
            })
            .catch(() => {});
        },
      }),
    ]);
  }

  function Settings() {
    const [, refresh] = React.useReducer(value => value + 1, 0);
    const [switching, setSwitching] = React.useState("");

    const accounts = accountList();
    const active = currentId();
    const canSwitch = typeof runtime.actions?.switchAccount === "function";
    const Pressable = RN.Pressable ?? RN.TouchableOpacity;

    const children = [
      React.createElement(RN.View, {
        key: "intro",
        style: { backgroundColor: C.card, padding: 14, borderRadius: 12 },
      }, [
        React.createElement(RN.Text, {
          key: "title",
          style: { color: C.text, fontSize: 18, fontWeight: "700" },
        }, "Account Switcher"),
        React.createElement(RN.Text, {
          key: "desc",
          style: { color: C.muted, marginTop: 6, fontSize: 12, lineHeight: 17 },
        }, "Uses Discord's saved accounts and native switch action. Active-account notification filtering is enabled by default."),
      ]),
      React.createElement(NotificationToggle, { key: "notifications", refresh }),
      React.createElement(RN.Text, {
        key: "accounts-title",
        style: { color: C.text, fontSize: 16, fontWeight: "700" },
      }, "Accounts"),
    ];

    if (!accounts.length) {
      children.push(React.createElement(RN.View, {
        key: "empty",
        style: { backgroundColor: C.card2, padding: 13, borderRadius: 10 },
      }, React.createElement(RN.Text, {
        style: { color: C.muted, fontSize: 13, lineHeight: 18 },
      }, "No saved Discord accounts were found.")));
    } else {
      for (const account of accounts) {
        const isCurrent = account.id === active;
        const busy = switching === account.id;

        children.push(React.createElement(Pressable, {
          key: account.id,
          disabled: isCurrent || !!switching || !canSwitch,
          onPress: async () => {
            setSwitching(account.id);
            try {
              await switchAccount(account.id);
              setSwitching("");
              refresh();
            } catch (error) {
              toast(`Account switch failed: ${error?.message ?? error}`);
              setSwitching("");
              refresh();
            }
          },
          style: {
            backgroundColor: C.card,
            padding: 13,
            borderRadius: 10,
            opacity: isCurrent ? 0.7 : 1,
          },
        }, [
          React.createElement(RN.Text, {
            key: "name",
            style: { color: C.text, fontSize: 15, fontWeight: "700" },
          }, account.displayName),
          React.createElement(RN.Text, {
            key: "user",
            style: { color: isCurrent ? C.green : C.muted, fontSize: 13, marginTop: 2 },
          }, `@${account.username}${isCurrent ? " • Current" : busy ? " • Switching…" : " • Tap to switch"}`),
        ]));
      }
    }

    children.push(React.createElement(Pressable, {
      key: "refresh",
      onPress: () => {
        runtime.multiAccountStore = null;
        runtime.userStore = null;
        runtime.actions = null;
        refresh();
      },
      style: {
        backgroundColor: C.card2,
        paddingHorizontal: 14,
        paddingVertical: 11,
        borderRadius: 9,
        alignItems: "center",
      },
    }, React.createElement(RN.Text, {
      style: { color: C.text, fontWeight: "700", fontSize: 14 },
    }, "Refresh Accounts")));

    children.push(React.createElement(RN.Text, {
      key: "version",
      style: { color: C.muted, fontSize: 12, lineHeight: 17 },
    }, `v${VERSION} • switch:${canSwitch ? "yes" : "no"} • notifications:${storage.onlyActiveNotifications === true ? "active-only" : "default"} • local:${runtime.receiveUnpatch ? "armed" : "waiting"} • detach:${runtime.lastDetachStatus} • explicit-sync:${runtime.lastExplicitSyncStatus} • blocked:${runtime.blockedNotifications}`));

    return React.createElement(
      RN.ScrollView ?? RN.View,
      {
        style: { flex: 1, backgroundColor: C.bg },
        contentContainerStyle: { padding: 16, paddingBottom: 40, gap: 12 },
      },
      children,
    );
  }

  return {
    onLoad() {
      runtime.loaded = true;
      runtime.startupTimer = setTimeout(() => {
        initializeNotificationProtection().catch(() => {});
      }, 500);
    },
    onUnload() {
      runtime.loaded = false;
      if (runtime.startupTimer) clearTimeout(runtime.startupTimer);
      clearSwitchRepairs();

      // Removing the plugin must not leave Discord registered in active-only mode.
      uninstallReceiveFilter();
      if (storage.onlyActiveNotifications === true) restoreDiscordNotifications();
      else uninstallPushPatch();
    },
    settings: Settings,
  };
})()
