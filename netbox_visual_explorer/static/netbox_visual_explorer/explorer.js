const el = id => document.getElementById("ve-" + id);

async function start() {
    const assets = el("app").dataset;
    const [{ diagram, portText, excludeRoles }, { camera, download }] = await Promise.all([
        import(assets.diagram), import(assets.viewport),
    ]);
    const inventory = JSON.parse(el("data").textContent);
    const params = new URLSearchParams(location.search);
    const data = excludeRoles(inventory, new Set(params.getAll("exclude_role").map(Number)));
    const devices = new Map(data.nodes.map(n => [n.id, n]));
    const cables = new Map(inventory.cables.map(c => [c.id, c]));
    const mode = el("mode"), focus = el("focus"), ports = el("ports");
    for (const node of data.nodes) {
        const text = node.name + " · #" + node.id;
        if (focus.tomselect) focus.tomselect.addOption({value:String(node.id), text});
        else focus.add(new Option(text, node.id));
    }
    setFocus(devices.has(Number(params.get("focus"))) ? params.get("focus") : "");
    mode.value = params.get("mode") || (data.hasChildren ? "summary" : "devices");
    if (!mode.value) mode.value = "summary";
    if (focus.value && mode.value === "summary") mode.value = "devices";
    ports.checked = params.get("ports") === "1";
    let worker, scene, svg, viewport;
    function updateURL() {
        const url = new URL(location.href);
        for (const [key,val] of [["mode",mode.value], ["focus",focus.value], ["ports",ports.checked ? "1" : ""]]) {
            if (val) url.searchParams.set(key, val);
            else url.searchParams.delete(key);
        }
        history.replaceState(null, "", url);
        for (const parent of document.querySelectorAll("[data-plan-parent]")) {
            parent.href = scopedURL(parent.href);
        }
    }
    function add(parent, tag, text, className = "") {
        const element = document.createElement(tag);
        element.textContent = text;
        element.className = className;
        parent.append(element);
        return element;
    }
    function action(parent, title, callback) {
        const button = add(parent, "button", title, "btn btn-sm btn-outline-primary my-1 me-1");
        button.onclick = callback;
    }
    function link(parent, title, url) {
        const anchor = add(parent, "a", title);
        anchor.href = url;
        return anchor;
    }
    function setFocus(id) {
        if (focus.tomselect) focus.tomselect.setValue(String(id), true);
        else focus.value = id;
    }
    function focusDevice(id) {
        setFocus(id);
        if (mode.value === "summary") mode.value = "devices";
        render();
    }
    function record(parent, rec) {
        const entry = add(parent, "div", "", "ve-entry");
        if (rec.id) link(entry, rec.name, rec.url);
        else add(entry, "strong", "Endgerätepfad");
        for (const [side, keys] of [["A",rec.a], ["B",rec.b]]) {
            for (const key of keys) {
                const p = data.ports[key];
                const row = add(entry, "small", side + " · ");
                const d = devices.get(p.device);
                link(row, d.name, d.url);
                add(row, "span", " · " + p.kind + " · " + portText(p));
            }
        }
        if (rec.steps) {
            const row = add(entry, "small", "Kabelweg ");
            rec.steps.forEach((id, index) => {
                if (index) row.append(" → ");
                link(row, cables.get(id).name, cables.get(id).url);
            });
        }
    }
    function listRecords(parent, records) {
        const items = [...records];
        let offset = 0;
        function more() {
            items.slice(offset, offset + 25).forEach(r => record(parent, r));
            offset += 25;
            if (offset < items.length) {
                const button = add(parent, "button", "Weitere Verbindungen", "btn btn-sm btn-light my-1");
                button.onclick = () => { button.remove(); more(); };
            }
        }
        more();
    }
    function scopedURL(path) {
        const url = new URL(path, location.href);
        url.search = "";
        for (const key of ["tag", "exclude_role"]) {
            for (const value of params.getAll(key)) url.searchParams.append(key, value);
        }
        if (ports.checked) url.searchParams.set("ports", "1");
        return url.href;
    }
    function groupFor(element) {
        if (element.classList.contains("cluster")) return data.groups[element.id.slice("ve-cluster-".length)];
        return data.groups[element.id.slice("ve-node-".length)];
    }
    function open(element) {
        const group = groupFor(element);
        if (group?.url) return location.assign(scopedURL(group.url));
        const node = scene.nodes.get(element.id.slice("ve-node-".length));
        if (node?.members.length === 1 && !group) return location.assign(node.members[0].url);
        select(element);
    }
    let detailsRequest;
    let selectedDevice;
    async function showDevice(device) {
        if (device && selectedDevice === device.id) return;
        detailsRequest?.abort();
        selectedDevice = device?.id;
        const section = el("device"), panel = el("device-data");
        section.hidden = !device;
        panel.replaceChildren();
        if (!device) return;
        const request = new AbortController();
        detailsRequest = request;
        panel.textContent = device.name + " · Gerätedaten werden geladen …";
        try {
            const response = await fetch(device.detailsUrl, {signal:request.signal, headers:{Accept:"application/json"}});
            if (!response.ok) throw new Error();
            const info = await response.json();
            if (request.signal.aborted) return;
            panel.replaceChildren();
            const list = add(panel, "dl", "");
            function field(label, value) {
                const cell = add(list, "div", "");
                add(cell, "dt", label);
                return add(cell, "dd", value || "—");
            }
            link(field("Name", " "), info.name, device.url);
            field("Hersteller", info.manufacturer);
            field("Modell", info.model);
            field("Rolle", device.role);
            field("Status", info.status);
            if (info.serial) field("Seriennummer", info.serial);
            if (info.assetTag) field("Inventarnummer", info.assetTag);
            const ips = field("IP-Adressen", info.addresses.length ? " " : "—");
            for (const ip of info.addresses) {
                add(ips, "div", [ip.address, ip.primary && "Primär", ip.oob && "OOB"].filter(Boolean).join(" · "));
            }
        } catch {
            if (request.signal.aborted) return;
            selectedDevice = null;
            panel.textContent = "Gerätedaten konnten nicht geladen werden. ";
            link(panel, device.name + " in NetBox öffnen", device.url);
        }
    }
    function select(element) {
        for (const related of svg.querySelectorAll(".ve-related,.ve-selected")) {
            related.classList.remove("ve-related", "ve-selected");
        }
        element.classList.add("ve-selected");
        const panel = el("detail");
        panel.replaceChildren();
        const node = scene.nodes.get(element.id.replace("ve-node-", ""));
        const group = groupFor(element);
        showDevice(node && !node.cable && !group ? node.members[0] : null);
        if (element.classList.contains("cluster")) {
            el("heading").textContent = group.label;
            link(panel, "Blockschaltplan öffnen", scopedURL(group.url));
            return;
        }
        if (!node) {
            const edge = scene.edges[Number(element.id.replace("ve-edge-", ""))];
            for (const key of [edge.tail, edge.head]) svg.querySelector("#ve-node-" + key)?.classList.add("ve-related");
            el("heading").textContent = edge.records.length === 1 ? "Verbindung" : "Verbindungsbündel";
            listRecords(panel, edge.records);
            return;
        }
        scene.edges.forEach((edge, i) => {
            if (edge.tail === node.key || edge.head === node.key) {
                svg.querySelector("#ve-edge-" + i)?.classList.add("ve-related");
            }
        });
        if (node.cable) {
            el("heading").textContent = node.cable.name;
        } else if (group && mode.value === "summary") {
            el("heading").textContent = group.label;
            add(panel, "p", node.members.length + " Geräte · " + node.records.size + " Kabel");
            if (group.url) link(panel, "Blockschaltplan öffnen", scopedURL(group.url));
            const details = add(panel, "details", "", "my-2");
            add(details, "summary", "Geräte anzeigen");
            for (const n of node.members) action(details, n.name, () => focusDevice(n.id));
        } else {
            const n = node.members[0];
            el("heading").textContent = n.name;
            add(panel, "p", [n.role, data.groups[n.group].location, data.groups[n.group].label].filter(Boolean).join(" · "));
            link(panel, "Gerät in NetBox öffnen", n.url);
            add(panel, "div", "");
            action(panel, "Nachbarn fokussieren", () => focusDevice(n.id));
        }
        listRecords(panel, node.records);
    }
    function render() {
        worker?.terminate();
        viewport = svg = null;
        showDevice(devices.get(Number(focus.value)));
        ports.disabled = mode.value === "summary";
        el("canvas").replaceChildren();
        el("export").disabled = true;
        el("heading").textContent = "Details";
        el("detail").textContent = "Gerät, Gruppe oder Verbindung im Plan auswählen.";
        scene = diagram(data, mode.value, Number(focus.value), ports.checked && !ports.disabled);
        updateURL();
        el("count").textContent = scene.count + " Geräte · " + scene.records +
            (mode.value === "paths" ? " vollständige Endgerätepfade" : " interne Netzwerkkabel") +
            (mode.value === "summary" ? " · " + [...scene.nodes.values()].filter(n => data.groups[n.key]).length + " Gruppen" : "");
        if (!scene.nodes.size) {
            el("message").textContent = mode.value === "paths" ? "Keine vollständigen Endgerätepfade in dieser Auswahl." :
                "Keine sichtbaren Geräte in dieser Auswahl.";
            return;
        }
        el("message").textContent = "Plan wird angeordnet …";
        worker = new Worker(assets.worker, {type:"module"});
        worker.onerror = () => { el("message").textContent = "Layout konnte nicht geladen werden. Bitte die statischen Plugin-Dateien prüfen."; };
        worker.onmessage = ({data:result}) => {
            worker.terminate();
            if (result.error) {
                el("message").textContent = "Layout fehlgeschlagen. Bitte die Auswahl eingrenzen.";
                return;
            }
            svg = new DOMParser().parseFromString(result.svg, "image/svg+xml").documentElement;
            el("canvas").replaceChildren(svg);
            svg.setAttribute("aria-label", data.title + " – " + mode.selectedOptions[0].text);
            for (const cluster of svg.querySelectorAll(".cluster")) {
                if (groupFor(cluster)?.url) cluster.dataset.plan = "";
            }
            for (const item of svg.querySelectorAll(".node,.edge,.cluster[data-plan]")) {
                item.setAttribute("tabindex", "0");
                item.setAttribute("role", "button");
                item.setAttribute("aria-label", item.textContent.trim() || "Verbindung");
                if (item.classList.contains("edge")) {
                    const line = item.querySelector("path");
                    if (line) {
                        const hit = line.cloneNode(false);
                        hit.setAttribute("stroke", "transparent");
                        hit.setAttribute("stroke-width", "12");
                        item.prepend(hit);
                    }
                }
            }
            viewport = camera(svg, select, open);
            el("export").disabled = false;
            el("message").textContent = "";
        };
        worker.postMessage(scene.graph);
    }
    el("filters").addEventListener("formdata", event => {
        event.formData.set("mode", mode.value);
        if (focus.value) event.formData.set("focus", focus.value);
        if (ports.checked) event.formData.set("ports", "1");
    });
    mode.onchange = () => { if (mode.value === "summary") setFocus(""); render(); };
    focus.onchange = () => { if (focus.value && mode.value === "summary") mode.value = "devices"; render(); };
    ports.onchange = render;
    el("in").onclick = () => viewport?.zoom(0.75);
    el("out").onclick = () => viewport?.zoom(1/0.75);
    el("fit").onclick = () => viewport?.fit();
    el("export").onclick = () => download(svg, viewport.bounds, data.title + "-" + mode.selectedOptions[0].text);
    render();
}

start().catch(error => {
    el("message").textContent = "Der Blockschaltplan konnte nicht initialisiert werden.";
    console.error("Blockschaltplan", error);
});
