const el = id => document.getElementById("ve-" + id);

async function start() {
    const assets = el("app").dataset;
    const [{ diagram, deviceTrail, portText, excludeRoles, connectionRows }, { camera, download, planSVG }] = await Promise.all([
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
    const target = assets.device || params.get("focus");
    setFocus(devices.has(Number(target)) ? target : "");
    mode.value = params.get("mode") || (data.hasChildren ? "summary" : "devices");
    if (!mode.value) mode.value = assets.device ? "devices" : "summary";
    if (focus.value && mode.value === "summary") mode.value = "devices";
    ports.checked = params.has("ports") ? params.get("ports") === "1" : Boolean(assets.device);
    let worker, scene, svg, viewport;
    function updateURL() {
        const url = new URL(location.href);
        for (const [key,val] of [["mode",mode.value], ["focus",focus.value], ["ports",ports.checked ? "1" : assets.device || params.has("ports") ? "0" : ""]]) {
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
    function link(parent, title, url) {
        const anchor = add(parent, "a", title);
        anchor.href = url;
        return anchor;
    }
    function setFocus(id) {
        if (focus.tomselect) focus.tomselect.setValue(String(id), true);
        else focus.value = id;
    }
    function endpointNames(parent, keys, selectedId) {
        const cell = add(parent, "div", "", "ve-route-ports");
        for (const key of keys) {
            const port = data.ports[key];
            const device = devices.get(port.device);
            const name = port.device === selectedId ? add(cell, "span", port.name) :
                link(cell, device.name + "/" + port.name, device.url);
            if (port.traceable) {
                const icon = add(name, "i", "", "mdi mdi-transit-connection-variant ms-1");
                icon.setAttribute("aria-label", "Vollständiger Kabeltrace");
                icon.title = "Vollständiger Kabeltrace";
            }
            name.title = port.kind + " · " + portText(port);
        }
    }
    function traceButton(parent, cable, pathId) {
        const url = new URL(cable.traceUrl, location.href);
        if (pathId) url.searchParams.set("cablepath_id", pathId);
        const trace = link(parent, "Trace", url.href);
        trace.className = "btn btn-sm btn-outline-secondary ve-trace";
        trace.title = "Pfad verfolgen · " + cable.name;
        trace.target = "_blank";
        trace.rel = "noopener";
        trace.setAttribute("aria-label", "NetBox-Trace für " + cable.name + " öffnen");
        trace.onclick = openTrace;
    }
    function openTrace(event) {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (event.detail > 1) return;
        window.open(event.currentTarget.getAttribute("href"), "_blank", "popup,noopener,width=1080,height=780,resizable=yes,scrollbars=yes");
    }
    function connections(parent, records, selectedId, showCable = false) {
        const items = connectionRows(records, data.ports, selectedId);
        if (!items.length) {
            add(parent, "p", "Keine Verbindungen in dieser Auswahl.", "text-secondary");
            return;
        }
        let offset = 0;
        function more() {
            for (const {record, from, to, reverse} of items.slice(offset, offset + 25)) {
                const route = add(parent, "div", "", "ve-route");
                endpointNames(route, from, showCable ? undefined : selectedId);
                add(route, "span", "→", "ve-route-arrow").setAttribute("aria-hidden", "true");
                endpointNames(route, to, showCable ? undefined : selectedId);
                const steps = record.steps ? record.steps.map(id => cables.get(id)) : [record];
                if (steps.length === 1) {
                    traceButton(route, steps[0], record.pathId);
                    if (showCable) link(route, steps[0].name, steps[0].url).className = "ve-cable-name";
                } else {
                    const traces = add(route, "details", "", "ve-route-traces");
                    add(traces, "summary", "Traces (" + steps.length + ")", "btn btn-sm btn-outline-secondary");
                    const list = add(traces, "div", "", "ve-trace-list");
                    for (const cable of reverse ? steps.reverse() : steps) {
                        const step = add(list, "div", "");
                        link(step, cable.name, cable.url);
                        traceButton(step, cable, record.pathId);
                    }
                }
            }
            offset += 25;
            if (offset < items.length) {
                const button = add(parent, "button", "Weitere Verbindungen", "btn btn-sm btn-light my-1");
                button.onclick = () => { button.remove(); more(); };
            }
        }
        more();
    }
    let previewRequest, previewWorker;
    function stopPreview() {
        previewRequest?.abort();
        previewWorker?.terminate();
    }
    async function groupPreview(panel, group) {
        const target = scopedURL(group.url);
        const anchor = link(panel, "", target);
        anchor.className = "ve-plan-preview";
        anchor.setAttribute("aria-label", "Blockschaltplan für " + group.label + " öffnen");
        const message = add(anchor, "span", "Vorschau wird geladen …");
        link(panel, "Blockschaltplan öffnen", target);
        const url = new URL(target);
        url.searchParams.set("preview", "1");
        const request = new AbortController();
        previewRequest = request;
        try {
            const response = await fetch(url, {signal:request.signal});
            if (!response.ok) throw new Error();
            const child = excludeRoles(await response.json(), new Set(params.getAll("exclude_role").map(Number)));
            if (request.signal.aborted) return;
            if (!child.nodes.length) {
                message.textContent = "Keine sichtbaren Geräte.";
                return;
            }
            const preview = diagram(child, child.hasChildren ? "summary" : "devices", 0, ports.checked);
            const layout = new Worker(assets.worker, {type:"module"});
            previewWorker = layout;
            layout.onerror = () => { message.textContent = "Vorschau nicht verfügbar."; layout.terminate(); };
            layout.onmessage = ({data:result}) => {
                layout.terminate();
                if (request.signal.aborted) return;
                if (result.error) { message.textContent = "Vorschau nicht verfügbar."; return; }
                const image = planSVG(result.svg);
                for (const item of image.querySelectorAll("a")) item.replaceWith(...item.childNodes);
                for (const item of image.querySelectorAll("[id]")) item.removeAttribute("id");
                anchor.replaceChildren(image);
            };
            layout.postMessage(preview.graph);
        } catch {
            if (!request.signal.aborted) message.textContent = "Vorschau nicht verfügbar.";
        }
    }
    function scopedURL(path) {
        const url = new URL(path, location.href);
        url.search = "";
        for (const key of ["tag", "exclude_role"]) {
            for (const value of params.getAll(key)) url.searchParams.append(key, value);
        }
        url.searchParams.set("ports", ports.checked ? "1" : "0");
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
        if (node?.members.length === 1 && !group) {
            return location.assign(scopedURL(node.members[0].planUrl));
        }
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
        stopPreview();
        const panel = el("detail");
        panel.replaceChildren();
        const node = scene.nodes.get(element.id.replace("ve-node-", ""));
        const group = groupFor(element);
        showDevice(node && !node.cable && !group ? node.members[0] : null);
        if (element.classList.contains("cluster")) {
            el("heading").textContent = group.label;
            groupPreview(panel, group);
            return;
        }
        if (!node) {
            const edge = scene.edges[Number(element.id.replace("ve-edge-", ""))];
            for (const key of [edge.tail, edge.head]) svg.querySelector("#ve-node-" + key)?.classList.add("ve-related");
            el("heading").textContent = edge.records.length === 1 ? "Verbindung" : "Verbindungsbündel";
            connections(panel, edge.records, mode.value === "devices" ? Number(focus.value) : undefined, true);
            return;
        }
        if (mode.value !== "devices" || node.key !== "d" + focus.value) {
            scene.edges.forEach((edge, i) => {
                if (edge.tail === node.key || edge.head === node.key) {
                    svg.querySelector("#ve-edge-" + i)?.classList.add("ve-related");
                }
            });
        }
        if (node.cable) {
            el("heading").textContent = node.cable.name;
        } else if (group && mode.value === "summary") {
            el("heading").textContent = group.label;
            add(panel, "p", node.members.length + " Geräte · " + node.records.size + " Kabel");
            if (group.url) groupPreview(panel, group);
            if (node.records.size) {
                const details = add(panel, "details", "", "mt-3");
                add(details, "summary", "Verbindungen (" + node.records.size + ")");
                details.addEventListener("toggle", () => connections(details, node.records), {once:true});
            }
            return;
        } else {
            const n = node.members[0];
            el("heading").replaceChildren();
            link(el("heading"), n.name, n.url);
            const trail = add(panel, "nav", "", "ve-object-path");
            trail.setAttribute("aria-label", "Standortpfad");
            for (const [name, url] of deviceTrail(n)) {
                if (trail.firstChild) trail.append(" / ");
                link(trail, name, scopedURL(url));
            }
            connections(panel, mode.value === "paths" ? data.paths : data.cables, n.id);
            return;
        }
        connections(panel, node.records);
    }
    function render() {
        stopPreview();
        worker?.terminate();
        viewport = svg = null;
        showDevice(devices.get(Number(focus.value)));
        el("canvas").classList.remove("ve-scroll-plan");
        el("canvas").replaceChildren();
        el("export").disabled = true;
        el("heading").textContent = "Details";
        el("detail").textContent = "Gerät, Gruppe oder Verbindung im Plan auswählen.";
        if (assets.device && !focus.value) {
            el("count").textContent = "";
            el("message").textContent = "Das Gerät ist durch die aktuellen Filter ausgeblendet.";
            return;
        }
        scene = diagram(data, mode.value, Number(focus.value), ports.checked);
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
            svg = planSVG(result.svg, data.ports);
            for (const anchor of svg.querySelectorAll("a")) {
                if (anchor.classList.contains("ve-trace-mark")) {
                    anchor.addEventListener("click", openTrace);
                    continue;
                }
                const path = anchor.href.baseVal;
                if (!path) continue;
                const url = scopedURL(path);
                anchor.setAttribute("href", url);
                anchor.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", url);
            }
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
            const canvas = el("canvas");
            if (ports.checked || (mode.value === "devices" && focus.value)) {
                const [, , width, height] = viewport.bounds;
                svg.style.setProperty("--ve-width-fit-height", (100 * height / width) + "cqw");
                svg.style.setProperty("--ve-native-height", height + "px");
                canvas.classList.add("ve-scroll-plan");
            }
            if (mode.value === "devices" && focus.value) {
                const start = svg.querySelector("#ve-node-d" + Number(focus.value));
                select(start);
                canvas.scrollTop += start.getBoundingClientRect().top - canvas.getBoundingClientRect().top - 24;
            }
            el("export").disabled = false;
            el("message").textContent = "";
        };
        worker.postMessage(scene.graph);
    }
    el("filters").addEventListener("formdata", event => {
        event.formData.set("mode", mode.value);
        if (focus.value) event.formData.set("focus", focus.value);
        if (ports.checked || assets.device || params.has("ports")) event.formData.set("ports", ports.checked ? "1" : "0");
    });
    mode.onchange = () => { if (mode.value === "summary") setFocus(""); render(); };
    focus.onchange = () => { if (focus.value && mode.value === "summary") mode.value = "devices"; render(); };
    ports.onchange = render;
    el("in").onclick = () => viewport?.zoom(0.75);
    el("out").onclick = () => viewport?.zoom(1/0.75);
    el("fit").onclick = () => {
        el("canvas").classList.remove("ve-scroll-plan");
        viewport?.fit();
    };
    el("export").onclick = () => download(svg, viewport.bounds, data.title + "-" + mode.selectedOptions[0].text);
    render();
}

start().catch(error => {
    el("message").textContent = "Der Blockschaltplan konnte nicht initialisiert werden.";
    console.error("Blockschaltplan", error);
});
