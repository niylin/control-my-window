import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export default class ControlMyWindowExtension extends Extension {
    enable() {
        this._enabled = true;
        this._settings = this.getSettings();
        this._trackedApps = new Set(this._settings.get_strv('tracked-apps'));
        this._stickApps = new Set(this._settings.get_strv('stick-apps'));
        this._rememberApps = new Set(this._settings.get_strv('remember-apps'));
        this._focusApps = new Set(this._settings.get_strv('focus-apps'));
        this._windowSignals = new Map();
        this._pendingWindowTimeouts = new Map();

        this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
            if (key === 'tracked-apps') {
                this._trackedApps = new Set(this._settings.get_strv('tracked-apps'));
                this._applyAllSettings();
            } else if (key === 'stick-apps') {
                this._stickApps = new Set(this._settings.get_strv('stick-apps'));
                this._applyAllSettings();
            } else if (key === 'remember-apps') {
                this._rememberApps = new Set(this._settings.get_strv('remember-apps'));
                this._applyAllSettings();
            } else if (key === 'focus-apps') {
                this._focusApps = new Set(this._settings.get_strv('focus-apps'));
            }
        });

        this._windowDemandsAttentionId = global.display.connect('window-demands-attention', (display, window) => {
            if (this._shouldActivateWindow(window)) {
                try {
                    Main.activateWindow(window);
                } catch (e) {}
            }
        });

        this._focusHandlerId = global.display.connect('notify::focus-window', () => {
            this._applyAllSettings();
        });

        this._windowCreatedId = global.display.connect('window-created', (display, window) => {
            if (!window) return;
            // Apply settings to the new window after a short delay to ensure Shell.App is associated
            const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this._pendingWindowTimeouts.delete(window);
                this._applySettingsToWindow(window);
                return GLib.SOURCE_REMOVE;
            });
            this._pendingWindowTimeouts.set(window, timeoutId);
        });

        // Track running apps to update preferences
        this._appSystem = Shell.AppSystem.get_default();
        this._appStateChangedId = this._appSystem.connect('app-state-changed', () => {
            this._updateRunningApps();
        });

        // Initial update
        this._updateRunningApps();
        this._applyAllSettings();
    }

    disable() {
        this._enabled = false;

        if (this._focusHandlerId) {
            global.display.disconnect(this._focusHandlerId);
            this._focusHandlerId = null;
        }

        if (this._windowCreatedId) {
            global.display.disconnect(this._windowCreatedId);
            this._windowCreatedId = null;
        }

        if (this._windowDemandsAttentionId) {
            global.display.disconnect(this._windowDemandsAttentionId);
            this._windowDemandsAttentionId = null;
        }

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

        if (this._appStateChangedId) {
            this._appSystem.disconnect(this._appStateChangedId);
            this._appStateChangedId = null;
        }

        if (this._pendingWindowTimeouts) {
            for (const timeoutId of this._pendingWindowTimeouts.values()) {
                if (timeoutId)
                    GLib.source_remove(timeoutId);
            }
            this._pendingWindowTimeouts.clear();
            this._pendingWindowTimeouts = null;
        }

        this._restoreWindowState();

        if (this._windowSignals) {
            for (const [window, signals] of this._windowSignals) {
                signals.forEach(id => {
                    try { window.disconnect(id); } catch (e) {}
                });
            }
            this._windowSignals.clear();
            this._windowSignals = null;
        }

        this._settings = null;
        this._trackedApps = null;
        this._stickApps = null;
        this._rememberApps = null;
        this._focusApps = null;
        this._appSystem = null;
    }

    _restoreWindowState() {
        const windows = global.get_window_actors().map(actor => actor.meta_window);
        for (const window of windows) {
            if (!this._isNormalWindow(window))
                continue;

            const appId = this._getWindowAppId(window);
            if (appId && this._stickApps?.has(appId)) {
                try {
                    if (window.is_on_all_workspaces?.())
                        window.unstick();
                } catch (e) {}
            }

            this._untrackWindowPosition(window);
        }
    }

    _updateRunningApps() {
        if (!this._settings) return;
        
        let runningApps = this._appSystem.get_running();
        let data = runningApps
            .map(app => {
                let id = app.get_id() || '';
                let name = app.get_name() || 'Unknown';
                return `${id}|${name}`;
            });
        
        this._settings.set_strv('running-apps', data);
    }

    _applyAllSettings() {
        const windows = global.get_window_actors().map(a => a.meta_window);
        for (const window of windows) {
            this._applySettingsToWindow(window);
        }
    }

    _isNormalWindow(window) {
        try {
            return !!window &&
                !window.is_destroyed?.() &&
                window.get_window_type() === Meta.WindowType.NORMAL;
        } catch (e) {
            return false;
        }
    }

    _applySettingsToWindow(window) {
        if (!this._enabled || !this._isNormalWindow(window))
            return;

        const appId = this._getWindowAppId(window);
        if (!appId)
            return;

        // 1. Handle Stick (Always on all workspaces)
        const shouldStick = this._stickApps.has(appId);
        let isSticky = false;
        try {
            isSticky = window.is_on_all_workspaces?.() ?? false;
        } catch (e) {
            isSticky = false;
        }
        if (isSticky !== shouldStick) {
            try {
                if (shouldStick)
                    window.stick();
                else
                    window.unstick();
            } catch (e) {}
        }

        // 2. Handle Remember Position
        if (this._rememberApps.has(appId)) {
            if (!window._extensionRestored) {
                this._restoreWindowPosition(window, appId);
                window._extensionRestored = true;
            }
            this._trackWindowPosition(window, appId);
        } else {
            this._untrackWindowPosition(window);
        }

        // 3. Handle Auto Hide
        const focusedWindow = global.display.focus_window;
        if (window === focusedWindow || window.minimized)
            return;

        if (this._trackedApps.has(appId)) {
            try {
                window.minimize();
            } catch (e) {}
        }
    }

    _getWindowAppId(window) {
        try {
            const app = Shell.WindowTracker.get_default().get_window_app(window);
            return app?.get_id() ?? null;
        } catch (e) {
            return null;
        }
    }

    _shouldActivateWindow(window) {
        if (!this._enabled || !this._isNormalWindow(window))
            return false;

        const appId = this._getWindowAppId(window);
        return !!appId && this._focusApps.has(appId);
    }

    _trackWindowPosition(window, appId) {
        if (this._windowSignals.has(window))
            return;

        const signals = [];
        const save = () => this._saveWindowPosition(window, appId);

        signals.push(window.connect('position-changed', save));
        signals.push(window.connect('size-changed', save));
        signals.push(window.connect('workspace-changed', save));
        signals.push(window.connect('unmanaged', () => this._untrackWindowPosition(window)));

        this._windowSignals.set(window, signals);
    }

    _untrackWindowPosition(window) {
        if (!this._windowSignals) return;
        const signals = this._windowSignals.get(window);
        if (signals) {
            signals.forEach(id => {
                try { window.disconnect(id); } catch (e) {}
            });
            this._windowSignals.delete(window);
        }
    }

    _saveWindowPosition(window, appId) {
        if (window._extensionRestoring) return; // Avoid saving during restoration to prevent loops
        
        if (!this._settings || window.minimized || !this._isNormalWindow(window))
            return;
        
        let rect;
        let workspace;
        try {
            rect = window.get_frame_rect();
            workspace = window.get_workspace();
        } catch (e) {
            return;
        }
        if (!rect || !workspace)
            return;

        const workspaceIndex = workspace.index();
        const dataStr = `${appId}|${rect.x}|${rect.y}|${workspaceIndex}`;
        
        let saved = this._settings.get_strv('saved-positions');
        let found = false;
        saved = saved.map(s => {
            if (s.startsWith(`${appId}|`)) {
                found = true;
                return dataStr;
            }
            return s;
        });
        if (!found) {
            saved.push(dataStr);
        }
        
        this._settings.set_strv('saved-positions', saved);
    }

    _restoreWindowPosition(window, appId) {
        if (!this._settings || !this._isNormalWindow(window))
            return;

        const saved = this._settings.get_strv('saved-positions');
        const entry = saved.find(s => s.startsWith(`${appId}|`));
        if (!entry) return;

        const parts = entry.split('|');
        if (parts.length < 4) return;

        const [_, x, y, wsIndex] = parts.map((v, i) => i === 0 ? v : parseInt(v));
        if (![x, y, wsIndex].every(Number.isInteger))
            return;
        
        // Restore workspace
        try {
            const workspace = global.workspace_manager.get_workspace_by_index(wsIndex);
            if (workspace)
                window.change_workspace(workspace);
        } catch (e) {
            return;
        }

        // Restore position immediately to avoid visible movement
        if (!window.is_destroyed?.()) {
            window._extensionRestoring = true;
            try {
                window.move_frame(true, x, y);
            } catch (e) {
            } finally {
                window._extensionRestoring = false;
            }
        }
    }
}
