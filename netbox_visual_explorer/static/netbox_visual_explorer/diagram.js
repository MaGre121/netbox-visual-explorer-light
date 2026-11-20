// Graphviz HTML labels accept a small XML vocabulary. Inventory values are text.
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("\\", "&#92;");
const color = (value, fallback) => /^[0-9a-f]{6}$/i.test(value) ? "#" + value : fallback;

const byName = new Intl.Collator("de", {numeric:true});
const portName = port => port.label && port.label !== port.name ? port.name + " · " + port.label : port.name;

function portVlans(port) {
    const parts = [];
    if (port.untagged != null) parts.push("Untagged " + port.untagged);
    if (port.allTagged) parts.push("Tagged alle");
    else if (port.tagged?.length) parts.push("Tagged " + port.tagged.join(", "));
    return parts;
}

export function portText(port) {
    const parts = [portName(port), ...portVlans(port)];
    if (port.ips?.length) parts.push(port.ips.join(", "));
    if (port.mgmt) parts.push("Management");
    return parts.join(" · ");
}

export function deviceTrail(device) {
    return [...device.trail, [device.name, device.planUrl]];
}

function trailLabel(trail) {
    const cells = trail.map(([name, url]) => {
        const href = url ? ' HREF="' + escape(url) + '"' : "";
        return '<TD' + href + '>' + escape(name) + '</TD>';
    });
    return {html:'<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="1"><TR>' +
        cells.join('<TD> / </TD>') + '</TR></TABLE>'};
}

function card(title, subtitle, stripe, url) {
    const href = url ? ' HREF="' + escape(url) + '"' : "";
    return {html: '<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="6"><TR>' +
        '<TD WIDTH="5" BGCOLOR="' + stripe + '" ROWSPAN="2"></TD><TD ALIGN="LEFT"' + href + '><B>' + escape(title) +
        '</B></TD></TR><TR><TD ALIGN="LEFT"><FONT POINT-SIZE="10" COLOR="#475a69">' +
        escape(subtitle) + '</FONT></TD></TR></TABLE>'};
}

export function excludeRoles(data, excluded) {
    if (!excluded.size) return data;
    const nodes = data.nodes.filter(node => !excluded.has(node.roleId));
    const visible = new Set(nodes.map(node => node.id));
    const visiblePort = key => visible.has(data.ports[key].device);
    const cables = [];
    for (const cable of data.cables) {
        const a = cable.a.filter(visiblePort), b = cable.b.filter(visiblePort);
        if (a.length && b.length) cables.push({...cable, a, b});
    }
    // A logical path can cross an omitted patch panel between two visible interfaces.
    const paths = data.paths.filter(path => path.a.every(visiblePort) && path.b.every(visiblePort));
    return {...data, nodes, cables, paths, hasChildren:nodes.some(node => data.groups[node.summary])};
}

// Keep the two documented cable sides together, including breakout terminations.
export function connectionRows(records, ports, selectedId) {
    const rows = [];
    for (const record of records) {
        const append = (from, to, reverse) => rows.push({record, from, to, reverse});
        if (!selectedId) { append(record.a, record.b, false); continue; }
        const local = keys => keys.filter(k => ports[k].device === selectedId);
        const a = local(record.a), b = local(record.b);
        if (a.length) append(a, record.b, false);
        if (b.length) {
            // A loop on the selected device already appears in the forward row.
            const to = record.a.filter(k => ports[k].device !== selectedId);
            if (to.length) append(b, to, true);
        }
    }
    return rows.sort((a, b) => byName.compare(ports[a.from[0]].name, ports[b.from[0]].name));
}

// Reserve space in Graphviz for the vector trace symbol inserted in the SVG.
const traceMark = (port, key) => port.traceable ? ` <FONT FACE="VETrace-${key}" POINT-SIZE="12">M</FONT>` : "";

function portTable(port, key, details, position) {
    const label = position && port.positions > 1 ? portName(port) + " · Pos. " + position : portName(port);
    const rows = [[port.kind === "Interface" ? "Port" : port.kind, label]];
    if (details) {
        const vlans = portVlans(port);
        if (vlans.length) rows.push(["VLAN", vlans.join(" · ")]);
        for (const ip of port.ips || []) rows.push(["IP", ip]);
    }
    return rows.map(([label, value], i) => '<TR><TD ALIGN="LEFT"><FONT COLOR="#536675" POINT-SIZE="9">' +
        escape(label) + '</FONT></TD><TD ALIGN="LEFT">' + escape(value) + (i === 0 ? traceMark(port, key) : "") + '</TD></TR>').join("");
}

function socketCell(socket, content) {
    const anchor = socket ? ' PORT="' + socket + '"' : "";
    return '<TD' + anchor + ' BORDER="1" COLOR="#c9d5dc"><TABLE BORDER="0" CELLBORDER="0" ' +
        'CELLPADDING="2" CELLSPACING="0">' + content + '</TABLE></TD>';
}

// One row per documented mapping. A missing or filtered partner leaves its cell empty.
function panelRows(ports, local, details) {
    const ordered = [...local].sort((a, b) => byName.compare(ports[a].name, ports[b].name));
    const used = new Set();
    function cell(key, position) {
        if (!key) return '<TD></TD>';
        const anchor = used.has(key) ? null : key;
        used.add(key);
        return socketCell(anchor, portTable(ports[key], key, details, position));
    }
    let html = "";
    for (const rear of ordered.filter(k => k.startsWith("r"))) {
        const pairs = (ports[rear].frontMappings || []).filter(([front]) => local.has(front));
        if (!pairs.length) html += '<TR>' + cell(rear) + cell(null) + '</TR>';
        for (const [front, rearPos, frontPos] of pairs) {
            html += '<TR>' + cell(rear, rearPos) + cell(front, frontPos) + '</TR>';
        }
    }
    for (const key of ordered) {
        if (!used.has(key)) html += '<TR>' + cell(null) + cell(key) + '</TR>';
    }
    return html;
}

function neighborDiagram(data, devices, focus, details, graph) {
    const nodes = new Map(), edges = [];
    function addDevice(id, side) {
        let key = "d" + id;
        // A peer cabled to both faces is drawn on both sides of the selected device.
        if (id !== focus && nodes.has(key) && nodes.get(key).side !== side) key += "-" + side;
        if (!nodes.has(key)) nodes.set(key, {key, side, members:[devices.get(id)], records:new Set(), sockets:new Map()});
        return nodes.get(key);
    }
    graph.graphAttributes.ranksep = 1.6;
    const start = addDevice(focus, "center");
    const local = new Set(), bundles = new Map();
    for (const {record, from, to} of connectionRows(data.cables, data.ports, focus)) {
        start.records.add(record);
        for (const source of from) {
            local.add(source);
            const side = source.startsWith("r") ? "left" : "right";
            for (const target of to) {
                const peer = addDevice(data.ports[target].device, side);
                peer.records.add(record);
                if (peer === start) local.add(target);
                const key = [side, peer.key, details ? record.id : ""].join("-");
                if (!bundles.has(key)) bundles.set(key, {peer, side, records:new Set(), from:new Set(), to:new Set()});
                const bundle = bundles.get(key);
                bundle.records.add(record);
                bundle.from.add(source);
                bundle.to.add(target);
            }
        }
    }
    const panel = [...local].some(k => k.startsWith("r"));
    function attachment(keys, direction) {
        return keys.size === 1 ? [...keys][0] + ":" + direction : direction;
    }
    for (const {peer, side, records:recordSet, from, to} of bundles.values()) {
        const records = [...recordSet];
        const left = side === "left";
        const edge = left ? {tail:peer.key, head:start.key} : {tail:start.key, head:peer.key};
        const source = "src" + edges.length, target = "dst" + edges.length;
        if (!panel) start.sockets.set(source, [...from]);
        if (!panel || peer !== start) peer.sockets.set(target, [...to]);
        const localPort = panel ? attachment(from, left ? "w" : "e") : source + ":e";
        const peerPort = panel && peer === start ? attachment(to, [...to][0].startsWith("r") ? "w" : "e") :
            target + (left || peer === start ? ":e" : ":w");
        const label = records.length > 1 ? records.length + " Kabel" : details ? records[0].name.replaceAll("\\", "\\\\") : "";
        graph.edges.push({...edge, attributes:{id:"ve-edge-" + edges.length, tailport:left ? peerPort : localPort,
            headport:left ? localPort : peerPort, label, tooltip:label || records[0].name,
            color:color(records.length === 1 && records[0].color, "#627c8a"), penwidth:records.length > 1 ? 2.5 : 1.5}});
        edges.push({...edge, records});
    }
    const ranks = {left:[], right:[]};
    for (const node of nodes.values()) {
        const device = node.members[0];
        const paired = panel && node === start;
        let html = '<TABLE BORDER="1" COLOR="#99aeba" CELLBORDER="0" CELLSPACING="0" CELLPADDING="6">' +
            '<TR><TD COLSPAN="' + (paired ? 2 : 1) + '" BGCOLOR="#e6eff3"><B>' + escape(device.name) + '</B></TD></TR>';
        if (paired) html += panelRows(data.ports, local, details);
        for (const [socket, keys] of node.sockets) {
            html += '<TR>' + socketCell(socket, keys.map(k => portTable(data.ports[k], k, details)).join("")) + '</TR>';
        }
        const entry = {name:node.key, attributes:{id:"ve-node-" + node.key, shape:"plain", style:"filled",
            label:{html:html + '</TABLE>'}}};
        (node === start ? graph.nodes : ranks[node.side]).push(entry);
    }
    for (const [side, peers] of Object.entries(ranks)) {
        if (peers.length) graph.subgraphs.push({name:side, graphAttributes:{rank:"same"}, nodes:peers});
    }
    const count = new Set([...nodes.values()].map(node => node.members[0].id)).size;
    return {graph, nodes, edges, count, records:start.records.size};
}

export function diagram(data, mode, focus, showPorts) {
    const summary = mode === "summary";
    const logical = mode === "paths";
    const devices = new Map(data.nodes.map(n => [n.id, n]));
    const graph = {
        directed: true,
        graphAttributes: {rankdir:"LR", bgcolor:"transparent", pad:0.32, margin:0, nodesep:0.32,
            ranksep:0.8, labelloc:"t", labeljust:"l", fontname:"Arial", fontsize:16, fontcolor:"#263c4a",
            label:trailLabel(focus ? deviceTrail(devices.get(focus)) : data.trail), newrank:true},
        nodeAttributes: {shape:"box", style:"rounded,filled", color:"#c1cfd6", fillcolor:"#ffffff",
            fontname:"Arial", fontcolor:"#182f3f", fontsize:12, margin:0.07},
        edgeAttributes: {dir:"none", color:"#657e91", fontcolor:"#354f60", fontsize:9, fontname:"Arial"},
        nodes:[], subgraphs:[], edges:[]
    };
    if (focus && mode === "devices") return neighborDiagram(data, devices, focus, showPorts, graph);
    const deviceOf = key => data.ports[key].device;
    let records = logical ? data.paths : data.cables;
    if (focus) records = records.filter(r => [...r.a, ...r.b].some(key => deviceOf(key) === focus));
    const participating = new Set(records.flatMap(r => [...r.a, ...r.b].map(deviceOf)));
    if (focus) participating.add(focus);
    const visible = data.nodes.filter(n => (!focus && !logical) || participating.has(n.id));
    const nodeKey = id => summary ? devices.get(id).summary : "d" + id;
    const nodes = new Map();
    const edges = new Map();
    const clusters = new Map();
    for (const n of visible) {
        const key = nodeKey(n.id);
        if (!nodes.has(key)) nodes.set(key, {key, members:[], records:new Set(), level:n.level});
        const node = nodes.get(key);
        node.members.push(n);
        node.level = Math.min(node.level, n.level);
    }
    function connect(tail, head, record, label = "") {
        const left = nodes.get(tail), right = nodes.get(head);
        if (left.level > right.level || (left.level === right.level && tail > head)) {
            [tail, head] = [head, tail];
        }
        const key = showPorts ? edges.size : tail + "-" + head;
        if (!edges.has(key)) edges.set(key, {tail, head, records:[], label});
        edges.get(key).records.push(record);
    }
    for (const r of records) {
        const ends = [r.a, r.b].map(side => [...new Set(side.map(k => nodeKey(deviceOf(k))))]);
        const keys = new Set(ends.flat());
        for (const key of keys) nodes.get(key).records.add(r);
        if (summary && keys.size === 1) continue;
        const describe = keys => keys.map(k => {
            const port = data.ports[k];
            return escape(devices.get(port.device).name + " · " + portText(port)) + traceMark(port, k);
        }).join('<BR/>');
        if (ends.every(side => side.length === 1)) {
            connect(ends[0][0], ends[1][0], r, showPorts ? describe(r.a) + "<BR/>↔<BR/>" + describe(r.b) : "");
        } else {
            // A breakout cable is one shared object. A junction preserves its
            // terminations without guessing pin-to-pin device relationships.
            const key = "c" + r.id;
            nodes.set(key, {key, cable:r, records:new Set([r]), members:[], level:9});
            for (const end of keys) {
                const pins = [...r.a, ...r.b].filter(k => nodeKey(deviceOf(k)) === end);
                connect(end, key, r, showPorts ? describe(pins) : "");
            }
        }
    }
    for (const node of nodes.values()) {
        const {key, members, cable} = node;
        const group = summary ? data.groups[key] : null;
        const title = cable ? cable.name : group ? group.label : members[0].name;
        const sub = cable ? "Mehrfachabschluss" : group ? members.length + " Geräte" : members[0].role || "Gerät";
        const stripe = (group || cable) ? "#167e78" : color(members[0].color, "#46829a");
        const entry = {name:key, attributes:{id:"ve-node-" + key, label:card(title, sub, stripe, group?.url)}};
        if (summary || cable) {
            graph.nodes.push(entry);
        } else {
            const id = members[0].group;
            if (!clusters.has(id)) {
                const g = data.groups[id];
                const trail = id === "l0" ? [...g.trail, [g.label, null]] : g.trail;
                clusters.set(id, {name:"cluster_" + id, graphAttributes:{id:"ve-cluster-" + id, label:trailLabel(trail),
                    style:"rounded,filled", color:"#d6e1e6", fillcolor:"#eef3f6", fontsize:11, margin:15}, nodes:[]});
            }
            clusters.get(id).nodes.push(entry);
        }
    }
    const edgeItems = [...edges.values()];
    for (const [i, edge] of edgeItems.entries()) {
        const n = edge.records.length;
        const cableName = !logical && showPorts ? '<B>' + escape(edge.records[0].name) + '</B><BR/>' : "";
        const label = n > 1 ? (logical ? n + " Pfade" : n + " Kabel") : edge.label ? {html:cableName + edge.label} : "";
        const lineColor = n === 1 ? color(edge.records[0].color, "#647e90") : "#657e91";
        graph.edges.push({tail:edge.tail, head:edge.head, attributes:{id:"ve-edge-" + i,
            label, color:lineColor, penwidth:n > 1 ? 2 : 1.3}});
    }
    graph.subgraphs = [...clusters.values()];
    return {graph, nodes, edges:edgeItems, count:visible.length, records:records.length};
}
