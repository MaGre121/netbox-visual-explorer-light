# Visual Explorer für NetBox

Ein deutschsprachiges NetBox-Plugin für interaktive Blockschaltpläne. Der Plan entsteht aus den Geräte-, Port- und Kabeldaten der ausgewählten Site. Die Darstellung greift die Location-/Rack-Gruppierung und die Rollen-Level des Draw.io-Generators in `example/` auf. Das Plugin benötigt eine NetBox-Sitzung und liest die Daten direkt über das NetBox-ORM.

## Einen Plan öffnen

Auf der NetBox-Detailseite einer **Site, Location oder eines Racks** den Reiter **Blockschaltplan** öffnen. Am **Gerät** öffnet derselbe Reiter direkt den Geräteplan mit diesem Gerät links und seinen direkten Nachbarn rechts. Ein Doppelklick auf eine Location führt zu deren untergeordneten Locations und Racks. Ein Doppelklick auf ein Rack öffnet seinen Geräteplan. Ein Doppelklick auf ein Gerät öffnet in allen drei Darstellungen dessen eigenen Blockschaltplan. Im Plan und in den Gerätedetails führt jeder Abschnitt des Standortpfads direkt zur entsprechenden Ebene: von der Site über die verschachtelten Locations bis zum Rack und zum Gerät. Mehrere Geräte-Tags werden mit ODER verknüpft und bleiben beim Ebenenwechsel erhalten.

Unter **Rollen ausschließen** die auszublendenden Geräterollen markieren und **Anwenden** wählen. Die Auswahl gilt für alle Darstellungen, den Gerätefokus und den SVG-Export. Ein Endgerätepfad zwischen sichtbaren Geräten bleibt auch dann nachvollziehbar, wenn er durch ein ausgeblendetes Patchfeld führt. Zum Wiedereinblenden das Häkchen entfernen und erneut anwenden.

| Darstellung | Verwendung |
| --- | --- |
| Gruppenübersicht | Bündelt Geräte nach Location oder Rack und parallele Kabel zwischen Gruppen. Ein Klick zeigt die Vorschau des Gruppenplans und die Anzahl seiner Verbindungen. Ein Doppelklick öffnet den Plan. |
| Geräteplan | Zeigt Geräte einschließlich Patchfeldern und dokumentierter Geräte ohne Kabel. Rahmen kennzeichnen Rack bzw. Location. Rollenfarbe und optionales Rollen-Custom-Field `level` fließen in die Darstellung bzw. Anordnung ein. |
| Endgerätepfade | Verbindet die Interfaces an beiden Enden eines vollständigen, eindeutigen NetBox-Kabelpfads. In den Verbindungsdetails stehen die durchlaufenen Kabel in ihrer Reihenfolge. |

Sites und Locations mit untergeordneten Gerätegruppen starten in der Gruppenübersicht. Ein Rack öffnet sich direkt im Geräteplan. Über den durchsuchbaren **Gerätefokus** lässt sich der Plan auf ein Gerät und seine direkten Nachbarn eingrenzen. Bei ausgeschalteten **Portdetails im Plan** erscheinen parallele Kabel als Bündel. Ein Klick auf das Bündel zeigt die einzelnen Anschlüsse und Traces. Bei eingeschalteten Portdetails hat jedes Kabel eine eigene Linie mit Kabelname und Anschlussdaten, einschließlich der dokumentierten VLANs und IP-Adressen. In der Ansicht **Endgerätepfade** wird jeder vollständige Pfad einzeln gezeichnet. Links steht das gewählte Gerät, rechts stehen die direkten Nachbarn untereinander. An Ports mit einem vollständigen, einsehbaren NetBox-Netzwerkpfad erscheint das Kabeltrace-Symbol. Ein einfacher oder doppelter Klick auf das Symbol öffnet den NetBox-Kabeltrace des Ports in einem Popup. Im SVG-Export bleibt das Symbol als Link erhalten. Die Porttabellen enthalten die dokumentierten VLANs und IP-Adressen. Über **Gerätefokus → Alle Geräte** gelangt man zurück.

Die rechte Detailspalte zeigt für Locations und Racks eine anklickbare Miniatur ihres Zielplans. Unter dem verlinkten Gerätenamen steht je Verbindung eine Zeile: **lokaler Port → Gegenstelle/Port · Trace**. Im Geräteplan ist die Gegenstelle der direkte Kabelnachbar, in **Endgerätepfade** das Interface am anderen Ende des Pfads. **Trace** öffnet die integrierte NetBox-Pfadverfolgung als Popup. Bei mehreren Kabeln öffnet **Traces** die einzelnen Kabelaktionen.

Ein Klick auf ein Gerät zeigt unter der Zeichnung Name, Hersteller, Modell, Rolle, Status, IP-Adressen und, sofern gepflegt, Serien- und Inventarnummer. Dazu gehören auch IP-Adressen unverkabelter Interfaces. Primär- und Managementadresse (OOB) sind gekennzeichnet. Ein Klick auf den Gerätenamen in der Detailüberschrift öffnet die NetBox-Geräteansicht. Mit der Tastatur wählt die Leertaste ein Element aus und die Eingabetaste öffnet es.

In hohen Nachbarplänen und bei eingeblendeten Portdetails scrollt das Mausrad durch die Anschlussreihen. In der übrigen Planansicht zoomt das Mausrad um den Mauszeiger. Ziehen verschiebt den Plan. **Einpassen** zeigt die gesamte Auswahl. **SVG exportieren** lädt die vollständige aktuelle Darstellung mit Beschriftungen als eigenständige Vektorgrafik herunter. Site, Filter, Darstellung und Gerätefokus sind über die URL teilbar.

## Datenumfang und Rechte

Der Einstieg erfordert die Anzeigerechte für Site und Device. Geräte, Rollen, Locations, Racks, Tags, Interfaces, Front-/Rear-Ports, Kabel, VLANs und IP-Adressen werden mit den Objektberechtigungen des angemeldeten Benutzers abgefragt. Ein Kabel erscheint, wenn auf beiden Seiten mindestens ein sichtbarer Netzwerkport im ausgewählten Bereich liegt. Mehrfachabschlüsse an mehreren Geräten erhalten einen Kabelknoten. Ein Endgerätepfad setzt sichtbare Zwischenstationen im selben Bereich voraus. Bei Split-Pfaden zeigt der Geräteplan die dokumentierten Kabelenden. Strom-, Konsolen- und Circuit-Verbindungen sind außerhalb des Funktionsumfangs dieser Version.

## Installation mit netbox-docker

Die Mindestversion ist NetBox 4.5.0. Das Wheel für die Plugin-Version `0.3.5b` trägt die normalisierte Python-Paketversion `0.3.5b0`. Für die verwendete Docker-Struktur das Wheel in den Build-Kontext neben dem vorhandenen Plugin-Bestand kopieren. Vom Stamm dieses Plugin-Projekts aus:

```sh
cp dist/netbox_visual_explorer-0.3.5b0-py3-none-any.whl /home/matze/Docker/netbox-docker/plugins/
```

In `Dockerfile-Plugins` vor dem vorhandenen `collectstatic` ergänzen:

```dockerfile
COPY plugins/netbox_visual_explorer-0.3.5b0-py3-none-any.whl /tmp/
RUN /usr/local/bin/uv pip install --no-deps /tmp/netbox_visual_explorer-0.3.5b0-py3-none-any.whl
```

In `configuration/plugins.py` nach der bestehenden Plugin-Liste ergänzen:

```python
PLUGINS = [*PLUGINS, "netbox_visual_explorer"]
```

Anschließend im Verzeichnis von netbox-docker bauen und die Web- und Worker-Dienste auf das neue Image umstellen:

```sh
docker compose build netbox
docker compose up -d netbox netbox-worker
```

Vorhandene Links mit Site-, Location- oder Rack-Auswahl führen zum entsprechenden Objektreiter. Ohne Auswahl öffnet der alte Einstieg die Site-Liste. Die mitgelieferten statischen Dateien umfassen den Layout-Worker und Graphviz für den Browser. Es werden keine externen Grafikdienste aufgerufen.

## Installation im NetBox-venv und Paketbau

Im NetBox-venv das Wheel mit `pip install /pfad/zum/netbox_visual_explorer-0.3.5b0-py3-none-any.whl` installieren, den Paketnamen wie oben zu `PLUGINS` hinzufügen, `python manage.py collectstatic --no-input` ausführen und die NetBox-Dienste neu starten. Das Plugin enthält keine eigenen Datenbanktabellen.

Ein neues Wheel lässt sich mit `python -m pip wheel --no-deps --wheel-dir dist .` erstellen. In einer NetBox-Testinstallation führt `python manage.py test netbox_visual_explorer` die Integrationstests in einer Testdatenbank aus.

Das mitgelieferte Browser-Modul stammt aus `@viz-js/viz` 3.31.0 (Graphviz 16.1.0, Expat 2.8.5). Lizenztexte liegen neben dem Modul im Verzeichnis `netbox_visual_explorer/static/netbox_visual_explorer/vendor/`. [Viz.js-Quellcode](https://github.com/mdaines/viz-js/tree/c8ce050d28eb0dc1ed1629ea32ab7f3dc117db0f) · [Graphviz-Quellcode](https://gitlab.com/graphviz/graphviz/-/tree/16.1.0) · [Expat-Quellcode](https://github.com/libexpat/libexpat/tree/R_2_8_5)
