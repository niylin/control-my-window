import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Pango from 'gi://Pango';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const RUNNING_APPS_KEY = 'running-apps';
const APP_SETTING_KEYS = [
    ['tracked-apps', 'Auto Hide'],
    ['stick-apps', 'All Work'],
    ['remember-apps', 'Remember'],
    ['focus-apps', 'Focus'],
];

export default class ControlMyWindowPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._settings = this.getSettings();
        this._page = new Adw.PreferencesPage();
        this._groups = [];

        window.set_default_size(860, 680);

        this._settingsChangedIds = [
            this._settings.connect(`changed::${RUNNING_APPS_KEY}`, () => this._rebuild()),
        ];

        window.connect('close-request', () => {
            this._disconnectSettings();
            return false;
        });

        window.add(this._page);
        this._rebuild();
    }

    _disconnectSettings() {
        if (!this._settings)
            return;

        for (const id of this._settingsChangedIds) {
            if (id)
                this._settings.disconnect(id);
        }

        this._settingsChangedIds = [];
        this._settings = null;
    }

    _rebuild() {
        for (const group of this._groups)
            this._page.remove(group);
        this._groups = [];

        const runningApps = this._getRunningApps();
        const selectedByKey = new Map(
            APP_SETTING_KEYS.map(([key]) => [key, new Set(this._settings.get_strv(key))])
        );

        const runningGroup = new Adw.PreferencesGroup({
            title: 'Running Applications',
            description: 'Currently open windows',
        });
        this._groups.push(runningGroup);
        this._page.add(runningGroup);

        if (runningApps.length === 0) {
            runningGroup.add(new Adw.ActionRow({
                title: 'No Running Applications',
                subtitle: 'Open an application to see it here',
            }));
        } else {
            for (const app of runningApps)
                runningGroup.add(this._createAppRow(app, selectedByKey));
        }

        const runningIds = new Set(runningApps.map(app => app.id));
        const configuredIds = new Set();
        for (const selectedIds of selectedByKey.values()) {
            for (const appId of selectedIds) {
                if (!runningIds.has(appId))
                    configuredIds.add(appId);
            }
        }

        if (configuredIds.size === 0)
            return;

        const configuredGroup = new Adw.PreferencesGroup({
            title: 'Configured Applications',
            description: 'These apps are not running now, but their settings remain active',
        });
        this._groups.push(configuredGroup);
        this._page.add(configuredGroup);

        for (const appId of [...configuredIds].sort((a, b) => a.localeCompare(b)))
            configuredGroup.add(this._createAppRow({id: appId, name: appId}, selectedByKey));
    }

    _getRunningApps() {
        return this._settings.get_strv(RUNNING_APPS_KEY)
            .map(item => {
                const separator = item.indexOf('|');
                if (separator < 0)
                    return {id: item, name: item};

                return {
                    id: item.slice(0, separator),
                    name: item.slice(separator + 1),
                };
            })
            .filter(app => app.id)
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    _createAppRow(app, selectedByKey) {
        const row = new Adw.PreferencesRow({
            activatable: false,
        });

        const content = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
            margin_top: 12,
            margin_bottom: 12,
            margin_start: 12,
            margin_end: 12,
        });

        const title = new Gtk.Label({
            label: app.name,
            xalign: 0,
            hexpand: true,
            ellipsize: Pango.EllipsizeMode.END,
        });
        title.add_css_class('heading');

        const subtitle = new Gtk.Label({
            label: app.id,
            xalign: 0,
            hexpand: true,
            ellipsize: Pango.EllipsizeMode.END,
        });
        subtitle.add_css_class('dim-label');

        const mainBox = new Gtk.Grid({
            column_spacing: 12,
            row_spacing: 8,
            column_homogeneous: true,
            hexpand: true,
        });

        APP_SETTING_KEYS.forEach(([settingsKey, label], index) => {
            mainBox.attach(
                this._createToggle(app.id, label, selectedByKey.get(settingsKey), settingsKey),
                index,
                0,
                1,
                1
            );
        });

        content.append(title);
        content.append(subtitle);
        content.append(mainBox);
        row.set_child(content);
        return row;
    }

    _createToggle(appId, label, selectedIds, settingsKey) {
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            valign: Gtk.Align.CENTER,
            hexpand: true,
        });

        const gtkLabel = new Gtk.Label({
            label,
            xalign: 0,
            hexpand: true,
            ellipsize: Pango.EllipsizeMode.END,
        });
        const toggle = new Gtk.Switch({
            active: selectedIds.has(appId),
            valign: Gtk.Align.CENTER,
        });

        toggle.connect('notify::active', () => {
            const current = new Set(this._settings.get_strv(settingsKey));
            if (toggle.active)
                current.add(appId);
            else
                current.delete(appId);

            this._settings.set_strv(settingsKey, [...current].sort());
        });

        box.append(gtkLabel);
        box.append(toggle);
        return box;
    }
}
