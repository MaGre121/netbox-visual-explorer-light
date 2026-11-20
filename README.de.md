# Visual Explorer für NetBox

[English](README.md) · **Deutsch**

Mit dem Visual Explorer lässt sich die in NetBox dokumentierte Verkabelung direkt an einer Site, einer Location, einem Rack oder einem Gerät erkunden. Die Gruppierung nach Location und Rack und die Anordnung nach Rollen-Level stammen aus dem ursprünglichen Draw.io-Blockschaltplan. Der Reiter **Blockschaltplan** zeigt Geräte und ihre Verbindungen einschließlich der Front- und Rear-Ports an Patchfeldern. Du kannst einem Kabel bis zum Anschluss folgen, einen vollständigen Pfad verfolgen und den aktuellen Plan als SVG exportieren.

**Autor** Matthias Grebe · **Plugin-Version** `0.3.6b` · **Voraussetzungen** NetBox ab 4.5.0 und Python ab 3.12.

## Einen Plan erkunden

Öffne **Blockschaltplan** auf der NetBox-Detailseite. Ein Doppelklick auf eine Location oder ein Rack führt eine Ebene tiefer. Ein Doppelklick auf ein Gerät öffnet in jeder Darstellung dessen eigenen Plan, mit seinen direkten Kabelnachbarn. Gegenstellen an Rearports stehen links, Gegenstellen an Frontports und Interfaces rechts. Am ausgewählten Patchfeld stehen die laut NetBox zugeordneten Rear- und Frontports in derselben Zeile. Über den Standortpfad gelangst du wieder nach oben. Klicke dazu auf die gewünschte Site, Location oder das Rack. Vorhandene Explorer-Lesezeichen mit Site-, Location- oder Rack-Auswahl führen ebenfalls zum entsprechenden Reiter. Ohne Auswahl öffnet sich die Site-Liste.

| Darstellung | Inhalt |
| --- | --- |
| **Gruppenübersicht** | Gruppiert Geräte nach Location oder Rack und bündelt Kabel zwischen den Gruppen. Ein Klick auf eine Gruppe zeigt die Vorschau ihres Plans. Diese Ansicht steht für Sites und Locations zur Verfügung. Bei untergeordneten Gruppen öffnet sie sich automatisch. |
| **Geräteplan** | Zeigt direkte Kabelnachbarn, Patchfelder und Geräte ohne Kabel. Rahmen kennzeichnen Racks und Locations. Die Geräterolle bestimmt die Farbe, das optionale Rollen-Custom-Field `level` beeinflusst die Anordnung. Racks öffnen sich in dieser Ansicht. |
| **Endgerätepfade** | Verbindet die Interfaces an beiden Enden eines vollständigen, eindeutigen NetBox-Kabelpfads. Die Detailspalte zeigt die durchlaufenen Kabel in ihrer Reihenfolge. |

- **Portdetails im Plan** schaltet zwischen Kabelbündeln und Einzelkabeln mit Portnamen, dokumentierten VLANs und IP-Adressen um. In der Endgeräteansicht erscheint bei eingeschalteten Portdetails jeder vollständige Pfad einzeln. Ein Klick auf ein Bündel schlüsselt seine Verbindungen auf.
- **Trace** öffnet die NetBox-Pfadverfolgung als Popup. Klicke einfach oder doppelt auf das Trace-Symbol am Port im Plan oder nutze die Schaltfläche in der Verbindungszeile. Bei einem Pfad mit mehreren Kabeln findest du unter **Traces** eine Aktion je Kabel.
- **Gerätefokus** begrenzt den Plan auf ein Gerät und seine Nachbarn. Mit **Alle Geräte** kehrst du zur Übersicht zurück. Unter **Rollen ausschließen** lassen sich Geräterollen ausblenden. Ein Pfad zwischen sichtbaren Endgeräten kann weiterhin durch ein ausgeblendetes Patchfeld führen. Bei mehreren ausgewählten Geräte-Tags genügt ein Treffer. Die Filter bleiben beim Ebenenwechsel erhalten.
- Ein Klick auf ein Gerät zeigt unter dem Plan Hersteller, Modell, Rolle, Status und IP-Adressen. Primär- und Managementadressen (OOB) sind gekennzeichnet. Auch Adressen unverkabelter Interfaces sowie Serien- und Inventarnummer werden angezeigt, sofern sie dokumentiert sind. Der Gerätename in der Detailüberschrift öffnet die NetBox-Geräteansicht.
- Ziehen verschiebt den Plan. In hohen Portdarstellungen scrollt das Mausrad durch die Anschlüsse, in den übrigen Ansichten zoomt es. **Einpassen** zeigt den gesamten Plan. Mit der Tastatur wählt die Leertaste ein Element aus und die Eingabetaste öffnet es. **SVG exportieren** lädt den vollständigen Plan samt Beschriftungen und Trace-Links herunter. Ansicht, Filter und Gerätefokus sind über die URL teilbar.

## Installation mit netbox-docker

Wähle die Installation **aus dem Quellverzeichnis** oder **per Wheel** und führe anschließend die gemeinsamen Schritte zur Aktivierung aus. Die Beispiele verwenden das netbox-docker-Verzeichnis als Docker-Build-Kontext. Compose baut den Dienst `netbox` mit `Dockerfile-Plugins`. Heißt die Datei in deiner Compose-Konfiguration `Dockerfile.plugins`, ergänze die Schritte dort. Für `netbox-worker` muss dasselbe eigene Image wie für `netbox` konfiguriert sein.

### Variante A · Quellverzeichnis und plugin_requirements.txt

Klone das Plugin im netbox-docker-Verzeichnis in den Build-Kontext:

```sh
mkdir -p plugins
git clone https://github.com/MaGre121/netbox-visual-explorer-light.git plugins/netbox-visual-explorer-light
```

Ergänze in **`plugin_requirements.txt`** bei deinen vorhandenen Plugins die folgende Zeile. Sie verweist **innerhalb des Images** auf das Verzeichnis mit der `pyproject.toml`:

```text
/opt/netbox/netbox/plugins/netbox-visual-explorer
```

Kopiere in **`Dockerfile-Plugins`** das Quellverzeichnis vor der Installation der Requirements ins Image. Wenn dein Dockerfile die Requirements-Datei bereits kopiert und installiert, füge die erste `COPY`-Zeile direkt vor diesen beiden Schritten ein.

```dockerfile
COPY plugins/netbox-visual-explorer-light /opt/netbox/netbox/plugins/netbox-visual-explorer
COPY plugin_requirements.txt /opt/netbox/plugin_requirements.txt
RUN /usr/local/bin/uv pip install --python /opt/netbox/venv/bin/python -r /opt/netbox/plugin_requirements.txt
```

### Variante B · Wheel

Lade das Wheel für deine Version von [GitHub Releases](https://github.com/MaGre121/netbox-visual-explorer-light/releases) herunter oder baue es im Stammverzeichnis des Plugin-Repositories mit Python ab 3.12:

```sh
python -m pip wheel --no-deps --wheel-dir dist .
```

Kopiere `dist/netbox_visual_explorer-0.3.6b0-py3-none-any.whl` in den Ordner `plugins/` deines netbox-docker-Build-Kontexts. Python normalisiert die Version `0.3.6b` im Wheel-Dateinamen zu `0.3.6b0`. Ergänze in **`Dockerfile-Plugins`** vor `collectstatic`:

```dockerfile
COPY plugins/netbox_visual_explorer-0.3.6b0-py3-none-any.whl /tmp/
RUN /usr/local/bin/uv pip install --python /opt/netbox/venv/bin/python --no-deps /tmp/netbox_visual_explorer-0.3.6b0-py3-none-any.whl
```

### Plugin aktivieren und Image neu bauen

Füge in **`configuration/plugins.py`** den Modulnamen `"netbox_visual_explorer"` zur bestehenden Liste `PLUGINS` hinzu. Bei einer neuen Konfiguration lautet die vollständige Liste:

```python
PLUGINS = ["netbox_visual_explorer"]
```

Die aktualisierte Konfiguration muss bereits beim Image-Build verfügbar sein, damit `collectstatic` den Diagramm-Renderer und die Styles erfasst. Verwende in `Dockerfile-Plugins` nach der Paketinstallation die folgende Reihenfolge. Wenn dein Dockerfile die Konfiguration bereits kopiert und `collectstatic` ausführt, nutze diese vorhandenen Schritte.

```dockerfile
COPY configuration/plugins.py /etc/netbox/config/plugins.py
RUN DEBUG="true" SECRET_KEY="build-only-dummy-key-for-netbox-collectstatic-at-image-build" \
    /opt/netbox/venv/bin/python /opt/netbox/netbox/manage.py collectstatic --no-input
```

Baue im netbox-docker-Verzeichnis das Image neu und starte den Web- und den Worker-Dienst:

```sh
docker compose build netbox
docker compose up -d netbox netbox-worker
```

Öffne zur Prüfung eine Site oder ein Gerät in NetBox und wähle **Blockschaltplan**.

## Installation im NetBox-venv

Aktiviere die virtuelle Umgebung von NetBox und installiere das Wheel mit `python -m pip install /pfad/zum/netbox_visual_explorer-0.3.6b0-py3-none-any.whl`. Ergänze `"netbox_visual_explorer"` in `PLUGINS`, führe im Verzeichnis der `manage.py` den Befehl `python manage.py collectstatic --no-input` aus und starte die NetBox-Dienste neu. Das Plugin hat keine eigenen Datenbanktabellen. In einer NetBox-Testumgebung lassen sich die Integrationstests mit `python manage.py test netbox_visual_explorer` ausführen.

## Datenumfang, Rechte und Lizenzen

Der Explorer verwendet die aktuelle NetBox-Sitzung und liest die Daten über das NetBox-ORM. Der Einstieg erfordert Anzeigerechte für Sites und Geräte. Auch für Rollen, Locations, Racks, Tags, Interfaces, Front- und Rear-Ports, Kabel, VLANs und IP-Adressen gelten die NetBox-Objektberechtigungen. Ein Kabel erscheint, wenn auf beiden Seiten ein sichtbarer Netzwerkport im gewählten Bereich liegt. Kabel mit Abschlüssen an mehreren Geräten erhalten in der Geräteübersicht einen Kabelknoten. Endgerätepfade setzen sichtbare Zwischenstationen im selben Bereich voraus. Bei Split-Pfaden zeigt der Geräteplan die dokumentierten Kabelenden. Strom-, Konsolen- und Circuit-Verbindungen liegen außerhalb des dargestellten Netzwerks.

Der Browser rendert die Pläne lokal mit dem mitgelieferten Layout-Worker und `@viz-js/viz` 3.31.0 (Graphviz 16.1.0 und Expat 2.8.5). Das Plugin steht unter der Apache-2.0-Lizenz. [Plugin-Lizenz](LICENSE) · [Lizenzen der mitgelieferten Komponenten](netbox_visual_explorer/static/netbox_visual_explorer/vendor/) · [Viz.js-Quellcode](https://github.com/mdaines/viz-js/tree/c8ce050d28eb0dc1ed1629ea32ab7f3dc117db0f) · [Graphviz-Quellcode](https://gitlab.com/graphviz/graphviz/-/tree/16.1.0) · [Expat-Quellcode](https://github.com/libexpat/libexpat/tree/R_2_8_5)
