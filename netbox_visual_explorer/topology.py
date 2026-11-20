"""Build a site-local graph from permission-filtered NetBox objects, in batches."""
from collections import defaultdict

from django.contrib.contenttypes.models import ContentType
from django.db.models import Prefetch
from django.urls import reverse

from dcim.models import Cable, CablePath, CableTermination, Device, DeviceRole, FrontPort, Interface, PortMapping, RearPort
from ipam.models import IPAddress, VLAN


def plan_url(obj, query=None):
    return reverse(f"dcim:{obj._meta.model_name}_blockschaltplan", args=[obj.pk], query=query)


def location_lineage(locations, location, rack):
    rack_location = locations.get(rack.location_id) if rack else None
    if rack_location and (not location or not rack_location.is_ancestor_of(location, include_self=True)):
        location = rack_location
    lineage = []
    while location:
        lineage.append(location)
        location = locations.get(location.parent_id)
    return list(reversed(lineage))


def plan_trail(objects):
    return [[obj.name or str(obj), plan_url(obj)] for obj in objects if obj is not None]


def role_level(role):
    try:
        return int(role.custom_field_data.get("level"))
    except (AttributeError, TypeError, ValueError):
        return 9


def device_groups(user, devices, locations, racks, site, location, rack):
    roles = DeviceRole.objects.restrict(user, "view").filter(pk__in=devices.values("role_id")).in_bulk()
    groups = {}
    nodes = []
    for device in devices.order_by("name", "pk").only("id", "role_id", "name", "rack_id", "location_id"):
        role = roles.get(device.role_id)
        device_rack = racks.get(device.rack_id)
        lineage = location_lineage(locations, locations.get(device.location_id), device_rack)
        trail = plan_trail([site, *lineage, device_rack])
        group_id = f"r{device_rack.pk}" if device_rack else f"l{lineage[-1].pk if lineage else 0}"
        target = device_rack or (lineage[-1] if lineage else None)
        if group_id not in groups:
            groups[group_id] = {"label": target.name if target else "Ohne Zuordnung", "trail": trail,
                                "url": plan_url(target) if target and target not in (location, rack) else None}
        # The next visible location, then the rack, then the device itself.
        branch = next((item for item in lineage if location is None or item.level > location.level), None)
        summary = f"d{device.pk}"
        if branch and not rack:
            summary = f"s{branch.pk}"
            if summary not in groups:
                groups[summary] = {"label": branch.name, "url": plan_url(branch)}
        elif device_rack and not rack:
            summary = group_id
        nodes.append({"id": device.pk, "name": device.name or f"Gerät #{device.pk}",
                      "url": device.get_absolute_url(), "planUrl": plan_url(device), "role": role.name if role else "",
                      "roleId": role.pk if role else None,
                      "color": role.color if role else "", "level": role_level(role),
                      "detailsUrl": reverse("plugins:netbox_visual_explorer:device_details", args=[device.pk]),
                      "group": group_id, "summary": summary, "trail": trail})

    return nodes, groups


def device_plan_members(user, device):
    """Limit the device tab to its physical neighbors and the paths through their cables."""
    local = Cable.objects.restrict(user, "view").filter(terminations___device=device)
    cable_ids = set(local.values_list("pk", flat=True))
    cable_ct = ContentType.objects.get_for_model(Cable).pk
    prefix = f"{cable_ct}:"
    paths = CablePath.objects.filter(is_complete=True, _nodes__overlap=[prefix + str(pk) for pk in cable_ids])
    for nodes in paths.values_list("_nodes", flat=True):
        cable_ids.update(int(key[len(prefix):]) for key in nodes if key.startswith(prefix))
    return CableTermination.objects.filter(cable_id__in=cable_ids).values("_device_id")


def port_trace_url(key, path_id=None):
    model = {"i": "interface", "f": "frontport", "r": "rearport"}[key[0]]
    query = {"cablepath_id": path_id} if path_id is not None else None
    return reverse(f"dcim:{model}_trace", args=[int(key[1:])], query=query)


def network_cables(user, ids):
    ports = {}
    sides = defaultdict(lambda: defaultdict(list))
    visible_path_nodes = {}
    cables = Cable.objects.restrict(user, "view").filter(terminations___device_id__in=ids).distinct()
    cable_map = {c.pk: c for c in cables.only("id", "label", "color")}
    for model, prefix, kind in ((Interface, "i", "Interface"), (FrontPort, "f", "Frontport"),
                                (RearPort, "r", "Rearport")):
        qs = model.objects.restrict(user, "view").filter(device_id__in=ids, cable_id__in=cable_map)
        fields = ["id", "device_id", "name", "label", "cable_id", "cable_end"]
        if model is Interface:
            fields.extend(["untagged_vlan_id", "mode", "mgmt_only"])
            vlans = VLAN.objects.restrict(user, "view").only("vid")
            untagged = dict(vlans.filter(pk__in=qs.values("untagged_vlan_id")).values_list("pk", "vid"))
            qs = qs.prefetch_related(
                Prefetch("tagged_vlans", queryset=vlans, to_attr="visible_vlans"),
                Prefetch("ip_addresses", queryset=IPAddress.objects.restrict(user, "view")
                         .only("address", "assigned_object_id", "assigned_object_type_id"), to_attr="visible_ips"),
            )
        else:
            fields.append("positions")
        ct_id = ContentType.objects.get_for_model(model).pk
        for port in qs.only(*fields).order_by("pk"):
            key = f"{prefix}{port.pk}"
            info = {"name": port.name, "label": port.label, "kind": kind, "device": port.device_id}
            if model is Interface:
                info.update(untagged=untagged.get(port.untagged_vlan_id),
                            tagged=sorted(v.vid for v in port.visible_vlans),
                            allTagged=port.mode == "tagged-all", mgmt=port.mgmt_only,
                            ips=[str(ip.address) for ip in port.visible_ips])
            elif port.positions > 1:
                info["positions"] = port.positions
            ports[key] = info
            sides[port.cable_id][port.cable_end].append(key)
            visible_path_nodes[f"{ct_id}:{port.pk}"] = key

    links = []
    cable_ct = ContentType.objects.get_for_model(Cable).pk
    for cable_id, ends in sorted(sides.items()):
        if not ends["A"] or not ends["B"]:
            continue
        cable = cable_map[cable_id]
        endpoints = ends["A"] + ends["B"]
        origin = next((key for key in endpoints if key.startswith("i")), endpoints[0])
        links.append({"traceUrl": port_trace_url(origin), "id": cable_id, "name": cable.label or f"Kabel #{cable_id}",
                      "url": cable.get_absolute_url(), "color": cable.color,
                      "a": ends["A"], "b": ends["B"]})
        visible_path_nodes[f"{cable_ct}:{cable_id}"] = cable_id

    return ports, links, complete_paths(user, ports, visible_path_nodes)


def complete_paths(user, ports, visible_path_nodes):
    # A patch panel in a rack may have both end devices outside the plan.
    # Check visibility along the native path before announcing a successful trace.
    complete = list(CablePath.objects.filter(
        is_complete=True, _nodes__overlap=list(visible_path_nodes)
    ).order_by("pk").values_list("is_split", "pk", "path", "_nodes"))
    permitted = set(visible_path_nodes)
    missing = defaultdict(set)
    for _, _, _, nodes in complete:
        for key in set(nodes).difference(visible_path_nodes):
            ct, pk = key.split(":")
            missing[int(ct)].add(int(pk))
    visible_devices = Device.objects.restrict(user, "view")
    types = ContentType.objects.in_bulk(missing)
    for ct, ids in missing.items():
        model = types[ct].model_class() if ct in types else None
        if model is None or not hasattr(model._default_manager, "restrict"):
            continue
        allowed = model._default_manager.restrict(user, "view").filter(pk__in=ids)
        if model in (Interface, FrontPort, RearPort):
            allowed = allowed.filter(device__in=visible_devices)
        permitted.update(f"{ct}:{pk}" for pk in allowed.values_list("pk", flat=True))

    paths = []
    seen = set()
    for split, path_id, segments, nodes in complete:
        if not permitted.issuperset(nodes):
            continue
        for key in nodes:
            port = visible_path_nodes.get(key)
            if port in ports and "traceUrl" not in ports[port]:
                ports[port]["traceable"] = True
                ports[port]["traceUrl"] = port_trace_url(port, path_id)
        if split:
            continue
        if not segments or len(segments[0]) != 1 or len(segments[-1]) != 1:
            continue
        steps = [visible_path_nodes.get(item) for step in segments for item in step]
        if None in steps or not steps:
            continue
        a, b = steps[0], steps[-1]
        if not all(isinstance(p, str) and p.startswith("i") for p in (a, b)):
            continue
        pair = tuple(sorted((a, b)))
        if pair not in seen:
            seen.add(pair)
            paths.append({"pathId": path_id, "a": [a], "b": [b], "steps": [s for s in steps if isinstance(s, int)]})
    return paths


def build_topology(user, devices, locations, racks, site, location=None, rack=None, device=None):
    nodes, groups = device_groups(user, devices, locations, racks, site, location, rack)
    ports, links, paths = network_cables(user, [node["id"] for node in nodes])
    if device:
        def touches_device(link):
            return any(ports[k]["device"] == device.pk for k in link["a"] + link["b"])

        paths = [path for path in paths if touches_device(path)]
        steps = {pk for path in paths for pk in path["steps"]}
        links = [cable for cable in links if touches_device(cable) or cable["id"] in steps]
        keys = {k for cable in links for k in cable["a"] + cable["b"]}
        ports = {k: ports[k] for k in keys}
        members = {device.pk} | {port["device"] for port in ports.values()}
        nodes = [node for node in nodes if node["id"] in members]
        group_keys = {node[k] for node in nodes for k in ("group", "summary")}
        groups = {k: group for k, group in groups.items() if k in group_keys}
    # PortMapping is private in NetBox. Both ends must already be visible in this plan.
    front_ids = [int(k[1:]) for k in ports if k.startswith("f")]
    rear_ids = [int(k[1:]) for k in ports if k.startswith("r")]
    mappings = PortMapping.objects.filter(front_port_id__in=front_ids, rear_port_id__in=rear_ids)
    for rear, front, rear_pos, front_pos in mappings.order_by("rear_port_position").values_list(
        "rear_port_id", "front_port_id", "rear_port_position", "front_port_position"
    ):
        ports[f"r{rear}"].setdefault("frontMappings", []).append([f"f{front}", rear_pos, front_pos])
    trail = plan_trail([site, *location_lineage(locations, location, rack), rack, device])
    return {"title": " / ".join(name for name, _ in trail), "trail": trail,
            "hasChildren": any(n["summary"] in groups for n in nodes),
            "nodes": nodes, "groups": groups, "ports": ports, "cables": links, "paths": paths}
