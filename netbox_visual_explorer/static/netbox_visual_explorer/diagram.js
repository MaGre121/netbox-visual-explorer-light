// Graphviz HTML labels accept a small XML vocabulary. Inventory values are text.
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("\\", "&#92;");
const color = (value, fallback) => /^[0-9a-f]{6}$/i.test(value) ? "#" + value : fallback;

export function portText(port) {
    const parts = [port.label && port.label !== port.name ? port.name + " · " + port.label : port.name];
    if (port.untagged != null) parts.push("Untagged " + port.untagged);
    if (port.allTagged) parts.push("Tagged alle");
    else if (port.tagged?.length) parts.push("Tagged " + port.tagged.join(", "));
    if (port.ips?.length) parts.push(port.ips.join(", "));
    if (port.mgmt) parts.push("Management");
    return parts.join(" · ");
}

function card(title, subtitle, stripe) {
    return {html: '<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="6"><TR>' +
        '<TD WIDTH="5" BGCOLOR="' + stripe + '" ROWSPAN="2"></TD><TD ALIGN="LEFT"><B>' + escape(title) +
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

export function diagram(data, mode, focus, showPorts) {
    const summary = mode === "summary";
    const logical = mode === "paths";
    const devices = new Map(data.nodes.map(n => [n.id, n]));
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
    const graph = {
        directed: true,
        graphAttributes: {rankdir:"LR", bgcolor:"transparent", pad:0.32, margin:0, nodesep:0.32,
            ranksep:0.8, labelloc:"t", labeljust:"l", fontname:"Arial", fontsize:16, fontcolor:"#263c4a",
            label:data.title.replaceAll("\\", "\\\\"), newrank:true},
        nodeAttributes: {shape:"box", style:"rounded,filled", color:"#c1cfd6", fillcolor:"#ffffff",
            fontname:"Arial", fontcolor:"#182f3f", fontsize:12, margin:0.07},
        edgeAttributes: {dir:"none", color:"#657e91", fontcolor:"#354f60", fontsize:9, fontname:"Arial"},
        nodes:[], subgraphs:[], edges:[]
    };
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
        const key = showPorts ? [tail, head, edges.size].join("-") : tail + "-" + head;
        if (!edges.has(key)) edges.set(key, {tail, head, records:[], label});
        edges.get(key).records.push(record);
    }
    for (const r of records) {
        const ends = [r.a, r.b].map(side => [...new Set(side.map(k => nodeKey(deviceOf(k))))]);
        const keys = new Set(ends.flat());
        for (const key of keys) nodes.get(key).records.add(r);
        if (summary && keys.size === 1) continue;
        const describe = keys => keys.map(k => devices.get(deviceOf(k)).name + " · " + portText(data.ports[k])).join("\n");
        if (ends.every(side => side.length === 1)) {
            connect(ends[0][0], ends[1][0], r, showPorts ? describe(r.a) + "\n↔\n" + describe(r.b) : "");
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
        const entry = {name:key, attributes:{id:"ve-node-" + key, label:card(title, sub, stripe)}};
        if (summary || cable) {
            graph.nodes.push(entry);
        } else {
            const id = members[0].group;
            if (!clusters.has(id)) {
                const g = data.groups[id];
                const label = [g.location, g.label].filter(Boolean).join(" / ");
                clusters.set(id, {name:"cluster_" + id, graphAttributes:{id:"ve-cluster-" + id, label:label.replaceAll("\\", "\\\\"),
                    style:"rounded,filled", color:"#d6e1e6", fillcolor:"#eef3f6", fontsize:11, margin:15}, nodes:[]});
            }
            clusters.get(id).nodes.push(entry);
        }
    }
    const edgeItems = [...edges.values()];
    for (const [i, edge] of edgeItems.entries()) {
        const n = edge.records.length;
        const label = edge.label || (n > 1 ? "× " + n : "");
        const lineColor = n === 1 ? color(edge.records[0].color, "#647e90") : "#657e91";
        graph.edges.push({tail:edge.tail, head:edge.head, attributes:{id:"ve-edge-" + i,
            label:label.replaceAll("\\", "\\\\"), color:lineColor, penwidth:n > 1 ? 2 : 1.3}});
    }
    graph.subgraphs = [...clusters.values()];
    return {graph, nodes, edges:edgeItems, count:visible.length, records:records.length};
}
