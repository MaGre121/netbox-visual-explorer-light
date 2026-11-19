export function planSVG(source, ports) {
    const svg = new DOMParser().parseFromString(source, "image/svg+xml").documentElement;
    for (const marker of svg.querySelectorAll('text[font-family^="VETrace"]')) {
        const ns = svg.namespaceURI;
        const key = marker.getAttribute("font-family").match(/^VETrace-([ifr]\d+)/)?.[1];
        const port = ports?.[key];
        const icon = document.createElementNS(ns, port?.traceUrl ? "a" : "g");
        const width = Number(marker.getAttribute("font-size")) || 12;
        const anchor = marker.getAttribute("text-anchor");
        const offset = anchor === "middle" ? width / 2 : anchor === "end" ? width : 0;
        const x = Number(marker.getAttribute("x")) - offset;
        const y = Number(marker.getAttribute("y")) - width * .85;
        icon.setAttribute("transform", `translate(${x} ${y}) scale(${width / 24})`);
        icon.setAttribute("class", "ve-trace-mark");
        const title = document.createElementNS(ns, "title");
        title.textContent = "Vollständiger Kabeltrace";
        if (port?.traceUrl) {
            const url = new URL(port.traceUrl, location.href).href;
            icon.setAttribute("href", url);
            icon.setAttribute("target", "_blank");
            icon.setAttribute("rel", "noopener");
            title.textContent = "Kabeltrace für " + port.name + " öffnen";
            icon.setAttribute("aria-label", title.textContent);
            const hit = document.createElementNS(ns, "rect");
            hit.setAttribute("width", "24");
            hit.setAttribute("height", "24");
            hit.setAttribute("fill", "transparent");
            icon.append(hit);
        }
        const path = document.createElementNS(ns, "path");
        // NetBox uses the transit-connection-variant motif for its Trace action.
        path.setAttribute("d", "M17 4H6a3 3 0 0 0-3 3v2a3 3 0 0 0 3 3h12a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3H7 M21 4a2 2 0 1 1-4 0 2 2 0 1 1 4 0 M7 20a2 2 0 1 1-4 0 2 2 0 1 1 4 0");
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "#087c76");
        path.setAttribute("stroke-width", "2");
        const joint = document.createElementNS(ns, "circle");
        joint.setAttribute("cx", "12");
        joint.setAttribute("cy", "12");
        joint.setAttribute("r", "3");
        joint.setAttribute("fill", "#087c76");
        icon.append(title, path, joint);
        marker.replaceWith(icon);
    }
    return svg;
}

export function camera(svg, select, open) {
    const bounds = svg.getAttribute("viewBox").split(/\s+/).map(Number);
    let view = [...bounds];
    const apply = () => svg.setAttribute("viewBox", view.join(" "));
    function zoom(factor, x = view[0] + view[2]/2, y = view[1] + view[3]/2) {
        const width = Math.max(bounds[2]/200, Math.min(bounds[2]*5, view[2]*factor));
        const ratio = width/view[2];
        view = [x + (view[0]-x)*ratio, y + (view[1]-y)*ratio, width, view[3]*ratio];
        apply();
    }
    const point = e => new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    svg.addEventListener("wheel", e => {
        const canvas = svg.parentElement;
        if (canvas.classList.contains("ve-scroll-plan") && canvas.scrollHeight > canvas.clientHeight && !e.ctrlKey) return;
        e.preventDefault();
        const p = point(e);
        zoom(e.deltaY > 0 ? 1.18 : 1/1.18, p.x, p.y);
    }, {passive:false});
    const target = element => element.closest(".node,.edge,.cluster[data-plan]");
    let start;
    let lastSelected;
    svg.addEventListener("dblclick", e => {
        if (e.target.closest("a[href]")) return;
        const item = target(e.target);
        if (item && item === lastSelected) open(item);
    });
    svg.addEventListener("pointerdown", e => {
        if (e.button !== 0 || !e.isPrimary || e.target.closest("a[href]")) return;
        start = {x:e.clientX, y:e.clientY, element:target(e.target), view:[...view],
            scale:svg.getScreenCTM().a, moved:false};
        (start.element || svg).setPointerCapture(e.pointerId);
    });
    svg.addEventListener("pointermove", e => {
        if (!start || !e.isPrimary) return;
        const dx = e.clientX-start.x, dy = e.clientY-start.y;
        if (Math.abs(dx)+Math.abs(dy) > 4) start.moved = true;
        if (start.moved) {
            view = [start.view[0]-dx/start.scale, start.view[1]-dy/start.scale, ...start.view.slice(2)];
            apply();
        }
    });
    svg.addEventListener("pointerup", () => {
        lastSelected = start && !start.moved ? start.element : null;
        if (lastSelected) select(lastSelected);
        start = null;
    });
    svg.addEventListener("pointercancel", () => { start = null; });
    svg.addEventListener("keydown", e => {
        if (e.target.closest("a[href]")) return;
        const element = target(e.target);
        if (element && ["Enter"," "].includes(e.key)) { e.preventDefault(); if (e.key === "Enter") open(element); else select(element); }
    });
    return {zoom, fit() { view = [...bounds]; apply(); }, bounds};
}

export function download(svg, bounds, name) {
    const copy = svg.cloneNode(true);
    copy.setAttribute("width", Math.ceil(bounds[2]));
    copy.setAttribute("height", Math.ceil(bounds[3]));
    copy.setAttribute("viewBox", bounds.join(" "));
    const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    for (const [i, attr] of ["x","y","width","height"].entries()) background.setAttribute(attr, bounds[i]);
    background.setAttribute("fill", "#ffffff");
    copy.prepend(background);
    for (const hitArea of copy.querySelectorAll('.edge path[stroke="transparent"]')) hitArea.remove();
    for (const shape of copy.querySelectorAll(":is(.ve-selected,.ve-related) :is(path,polygon,ellipse)")) {
        shape.setAttribute("stroke", "#007d75");
        shape.setAttribute("stroke-width", "3");
    }
    for (const element of copy.querySelectorAll("[tabindex]")) {
        element.removeAttribute("tabindex");
        element.removeAttribute("role");
    }
    const blob = new Blob([new XMLSerializer().serializeToString(copy)], {type:"image/svg+xml;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name.replace(/[^\p{L}\p{N}._-]+/gu, "-") + ".svg";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}
