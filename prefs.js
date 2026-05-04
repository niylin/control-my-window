import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ControlMyWindowPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        
        const runningGroup = new Adw.PreferencesGroup({
            title: 'Running Applications',
            description: 'Currently open windows'
        });

        const runningData = settings.get_strv('running-apps');
        const runningMap = new Map(); // id -> name
        runningData.forEach(d => {
            const [id, name] = d.split('|');
            if (id) runningMap.set(id, name);
        });

        const trackedIds = new Set(settings.get_strv('tracked-apps'));
        const stickIds = new Set(settings.get_strv('stick-apps'));
        const rememberIds = new Set(settings.get_strv('remember-apps'));
        
        // Process Running Apps
        runningMap.forEach((name, id) => {
            const row = this._createAppRow(id, name, trackedIds, stickIds, rememberIds, settings);
            runningGroup.add(row);
        });

        if (runningData.length > 0) {
            page.add(runningGroup);
        } else {
            const emptyGroup = new Adw.PreferencesGroup({
                title: 'No Running Applications',
                description: 'Open an application to see it here'
            });
            page.add(emptyGroup);
        }
        window.add(page);
    }

    _createAppRow(appId, name, trackedIds, stickIds, rememberIds, settings) {
        const row = new Adw.ActionRow({
            title: name,
            subtitle: appId
        });

        const mainBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 12,
            valign: Gtk.Align.CENTER
        });

        // Helper to create toggle with label
        const createToggle = (label, active, settingsKey) => {
            const box = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 6,
                valign: Gtk.Align.CENTER
            });
            const gtkLabel = new Gtk.Label({ label });
            const toggle = new Gtk.Switch({
                active,
                valign: Gtk.Align.CENTER
            });
            toggle.connect('notify::active', () => {
                const current = new Set(settings.get_strv(settingsKey));
                if (toggle.active) {
                    current.add(appId);
                } else {
                    current.delete(appId);
                }
                settings.set_strv(settingsKey, Array.from(current));
            });
            box.append(gtkLabel);
            box.append(toggle);
            return box;
        };

        mainBox.append(createToggle('Auto Hide', trackedIds.has(appId), 'tracked-apps'));
        mainBox.append(createToggle('Always Visible', stickIds.has(appId), 'stick-apps'));
        mainBox.append(createToggle('Remember Pos', rememberIds.has(appId), 'remember-apps'));

        row.add_suffix(mainBox);
        return row;
    }
}
