# Visual Explorer for NetBox

**English** · [Deutsch](README.de.md)

Explore the cabling documented in NetBox directly from a site, location, rack or device. Location and rack groups and the role-based layout follow the original Draw.io block diagram. The **Blockschaltplan** tab shows how devices connect, including front and rear ports on patch panels. You can follow a cable to its termination, trace an end-to-end path and export the current diagram as SVG. The plugin interface is in German.

**Author** Matthias Grebe · **Plugin version** `0.3.5b` · **Requires** NetBox 4.5.0 or later and Python 3.12 or later.

## Explore a plan

Open **Blockschaltplan** on a NetBox object. Double-click a location or rack to go one level deeper. Double-click a device in any view to open its own plan, with the device on the left and its direct neighbors on the right. To go back up, click a site, location or rack in the location path. Existing explorer bookmarks with a site, location or rack still open the corresponding tab. A bookmark without a selection opens the site list.

| View | What it shows |
| --- | --- |
| **Gruppenübersicht** (group overview) | Groups devices by location or rack and bundles cables between groups. Select a group for a preview of its plan. Sites and locations with child groups open here. |
| **Geräteplan** (device plan) | Shows direct cable neighbors, patch panels and devices without cables. Frames identify racks and locations. Device roles supply the colors, and the optional role custom field `level` influences the layout. Racks open in this view. |
| **Endgerätepfade** (endpoint paths) | Connects the interfaces at both ends of a complete, unambiguous NetBox path. The details pane lists the cables in traversal order. |

- **Portdetails im Plan** toggles between bundled links and individual cables with port names, documented VLANs and IP addresses. In the endpoint view, enabling it draws each complete path separately. Select a bundle to inspect its individual connections.
- **Trace** opens NetBox’s native cable trace in a popup. Click or double-click the trace icon next to a port in the diagram, or use the button in a connection row. For a path with several cables, **Traces** lists the action for each cable.
- **Gerätefokus** limits the plan to one device and its neighbors. Choose **Alle Geräte** to return to the overview. **Rollen ausschließen** hides selected device roles. A path between visible endpoints can still cross a hidden patch panel. Device tags match any selected tag. Filters carry over when navigating between levels.
- Select a device to see its manufacturer, model, role, status and IP addresses below the diagram. Primary and out-of-band addresses are marked. Addresses on uncabled interfaces, the serial number and the asset tag are shown when documented. The device name in the details heading opens its NetBox record.
- Drag to pan. The mouse wheel scrolls tall port diagrams and zooms the other plans. **Einpassen** fits the whole diagram. With the keyboard, Space selects an item and Enter opens it. **SVG exportieren** downloads the full diagram with labels and trace links. The page URL preserves the view, filters and device focus.

## Install with netbox-docker

Choose **source checkout** or **wheel**, then complete the shared activation steps. The examples assume the netbox-docker directory is the Docker build context and Compose builds the `netbox` service using `Dockerfile-Plugins`. If your Compose file names it `Dockerfile.plugins`, edit that file. Configure `netbox-worker` to use the same custom image as `netbox`.

### Option A · Source checkout and plugin_requirements.txt

From the netbox-docker directory, place the plugin repository in the build context:

```sh
mkdir -p plugins
git clone https://github.com/MaGre121/netbox-visual-explorer-light.git plugins/netbox-visual-explorer-light
```

Append this line to **`plugin_requirements.txt`** alongside your existing plugins. It is the path **inside the image** to the directory containing `pyproject.toml`:

```text
/opt/netbox/netbox/plugins/netbox-visual-explorer
```

In **`Dockerfile-Plugins`**, copy the checkout before the requirements installation. If your Dockerfile already copies and installs the requirements file, keep those two instructions and insert the first `COPY` above them.

```dockerfile
COPY plugins/netbox-visual-explorer-light /opt/netbox/netbox/plugins/netbox-visual-explorer
COPY plugin_requirements.txt /opt/netbox/plugin_requirements.txt
RUN /usr/local/bin/uv pip install --python /opt/netbox/venv/bin/python -r /opt/netbox/plugin_requirements.txt
```

### Option B · Wheel

Download the wheel for your version from [GitHub Releases](https://github.com/MaGre121/netbox-visual-explorer-light/releases), or build it from the plugin repository with Python 3.12 or later:

```sh
python -m pip wheel --no-deps --wheel-dir dist .
```

Copy `dist/netbox_visual_explorer-0.3.5b0-py3-none-any.whl` into the `plugins/` directory of your netbox-docker build context. Python normalizes the version `0.3.5b` to `0.3.5b0` in the wheel filename. Add these lines to **`Dockerfile-Plugins`** before `collectstatic`:

```dockerfile
COPY plugins/netbox_visual_explorer-0.3.5b0-py3-none-any.whl /tmp/
RUN /usr/local/bin/uv pip install --python /opt/netbox/venv/bin/python --no-deps /tmp/netbox_visual_explorer-0.3.5b0-py3-none-any.whl
```

### Activate the plugin and rebuild

In **`configuration/plugins.py`**, add `"netbox_visual_explorer"` to the existing `PLUGINS` list. For a new configuration, the complete list is:

```python
PLUGINS = ["netbox_visual_explorer"]
```

Make the updated configuration available during the image build so `collectstatic` picks up the diagram renderer and its styles. Keep this order in `Dockerfile-Plugins` after package installation. Reuse the existing configuration copies and `collectstatic` step if your Dockerfile already has them.

```dockerfile
COPY configuration/plugins.py /etc/netbox/config/plugins.py
RUN DEBUG="true" SECRET_KEY="build-only-dummy-key-for-netbox-collectstatic-at-image-build" \
    /opt/netbox/venv/bin/python /opt/netbox/netbox/manage.py collectstatic --no-input
```

From the netbox-docker directory, rebuild and start the web and worker services:

```sh
docker compose build netbox
docker compose up -d netbox netbox-worker
```

Open a site or device in NetBox and select **Blockschaltplan** to verify the installation.

## Install in a NetBox virtual environment

Activate the NetBox virtual environment and install the wheel with `python -m pip install /path/to/netbox_visual_explorer-0.3.5b0-py3-none-any.whl`. Add `"netbox_visual_explorer"` to `PLUGINS`, run `python manage.py collectstatic --no-input` from the directory containing `manage.py`, and restart the NetBox services. The plugin has no database tables of its own. To run its integration tests in a NetBox test environment, use `python manage.py test netbox_visual_explorer`.

## Data, permissions and licenses

The explorer uses the current NetBox session and reads data through the NetBox ORM. Users need view permissions for sites and devices. NetBox object permissions also apply to roles, locations, racks, tags, interfaces, front and rear ports, cables, VLANs and IP addresses. A cable appears when both sides have a visible network port in scope. Cables with terminations on multiple devices have a junction in the device overview. Endpoint paths require visible intermediate components in scope. For split paths, use the device plan to inspect the documented terminations. Power, console and circuit connections are outside the diagram’s scope.

The browser renders diagrams locally with the bundled layout worker and `@viz-js/viz` 3.31.0 (Graphviz 16.1.0 and Expat 2.8.5). The plugin uses the Apache 2.0 license. [Plugin license](LICENSE) · [Bundled dependency licenses](netbox_visual_explorer/static/netbox_visual_explorer/vendor/) · [Viz.js source](https://github.com/mdaines/viz-js/tree/c8ce050d28eb0dc1ed1629ea32ab7f3dc117db0f) · [Graphviz source](https://gitlab.com/graphviz/graphviz/-/tree/16.1.0) · [Expat source](https://github.com/libexpat/libexpat/tree/R_2_8_5)
