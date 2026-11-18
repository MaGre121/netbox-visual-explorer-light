"""Build a site-local graph from permission-filtered NetBox objects, in batches."""
from collections import defaultdict

from django.contrib.contenttypes.models import ContentType
from django.db.models import Prefetch
from django.urls import reverse

from dcim.models import Cable, CablePath, DeviceRole, FrontPort, Interface, RearPort
from ipam.models import IPAddress, VLAN


def plan_url(obj, query=None):
    return reverse(f"dcim:{obj._meta.model_name}_blockschaltplan", args=[obj.pk], query=query)


def role_level(role):
    try:
        return int(role.custom_field_data.get("level"))
    except (AttributeError, TypeError, ValueError):
        return 9


def device_groups(user, devices, locations, racks, location, rack):
    roles = DeviceRole.objects.restrict(user, "view").filter(pk__in=devices.values("role_id")).in_bulk()
    groups = {}
    nodes = []
    for device in devices.order_by("name", "pk").only("id", "role_id", "name", "rack_id", "location_id"):
        role = roles.get(device.role_id)
        device_rack = racks.get(device.rack_id)
        loc = locations.get(device.location_id or (device_rack.location_id if device_rack else None))
        lineage = []
        while loc:
            lineage.append(loc)
            loc = locations.get(loc.parent_id)
        lineage.reverse()
        room = " / ".join(loc.name for loc in lineage)
        group_id = f"r{device_rack.pk}" if device_rack else f"l{lineage[-1].pk if lineage else 0}"
        target = device_rack or (lineage[-1] if lineage else None)
        if group_id not in groups:
            groups[group_id] = {"label": device_rack.name if device_rack else room or "Ohne Zuordnung",
                                "location": room if device_rack else "",
                                "url": plan_url(target) if target and target not in (location, rack) else None}
        # The next visible location, then the rack, then the device itself.
        branch = next((item for item in lineage if location is None or item.level > location.level), None)
        summary = f"d{device.pk}"
        if branch and not rack:
            summary = f"s{branch.pk}"
            if summary not in groups:
                groups[summary] = {"label": branch.name, "location": "", "url": plan_url(branch)}
        elif device_rack and not rack:
            summary = group_id
        nodes.append({"id": device.pk, "name": device.name or f"Gerät #{device.pk}",
                      "url": device.get_absolute_url(), "role": role.name if role else "",
                      "roleId": role.pk if role else None,
                      "color": role.color if role else "", "level": role_level(role),
                      "detailsUrl": reverse("plugins:netbox_visual_explorer:device_details", args=[device.pk]),
                      "group": group_id, "summary": summary})

    return nodes, groups


def network_cables(user, ids):
    ports = {}
    sides = defaultdict(lambda: defaultdict(list))
    path_ids = set()
    visible_path_nodes = {}
    cables = Cable.objects.restrict(user, "view").filter(terminations___device_id__in=ids).distinct()
    cable_map = {c.pk: c for c in cables.only("id", "label", "color")}
    for model, prefix, kind in ((Interface, "i", "Interface"), (FrontPort, "f", "Frontport"),
                                (RearPort, "r", "Rearport")):
        qs = model.objects.restrict(user, "view").filter(device_id__in=ids, cable_id__in=cable_map)
        fields = ["id", "device_id", "name", "label", "cable_id", "cable_end"]
        if model is Interface:
            fields.extend(["_path_id", "untagged_vlan_id", "mode", "mgmt_only"])
            vlans = VLAN.objects.restrict(user, "view").only("vid")
            untagged = dict(vlans.filter(pk__in=qs.values("untagged_vlan_id")).values_list("pk", "vid"))
            qs = qs.prefetch_related(
                Prefetch("tagged_vlans", queryset=vlans, to_attr="visible_vlans"),
                Prefetch("ip_addresses", queryset=IPAddress.objects.restrict(user, "view")
                         .only("address", "assigned_object_id", "assigned_object_type_id"), to_attr="visible_ips"),
            )
        ct_id = ContentType.objects.get_for_model(model).pk
        for port in qs.only(*fields).order_by("pk"):
            key = f"{prefix}{port.pk}"
            info = {"name": port.name, "label": port.label, "kind": kind, "device": port.device_id}
            if model is Interface:
                info.update(untagged=untagged.get(port.untagged_vlan_id),
                            tagged=sorted(v.vid for v in port.visible_vlans),
                            allTagged=port.mode == "tagged-all", mgmt=port.mgmt_only,
                            ips=[str(ip.address) for ip in port.visible_ips])
                if port._path_id:
                    path_ids.add(port._path_id)
            ports[key] = info
            sides[port.cable_id][port.cable_end].append(key)
            visible_path_nodes[f"{ct_id}:{port.pk}"] = key

    links = []
    cable_ct = ContentType.objects.get_for_model(Cable).pk
    for cable_id, ends in sorted(sides.items()):
        if not ends["A"] or not ends["B"]:
            continue
        cable = cable_map[cable_id]
        links.append({"id": cable_id, "name": cable.label or f"Kabel #{cable_id}",
                      "url": cable.get_absolute_url(), "color": cable.color,
                      "a": ends["A"], "b": ends["B"]})
        visible_path_nodes[f"{cable_ct}:{cable_id}"] = cable_id

    return ports, links, complete_paths(path_ids, visible_path_nodes)


def complete_paths(path_ids, visible_path_nodes):
    # NetBox stores forward and reverse traces. Only expose complete, unambiguous
    # interface paths if every intermediate cable and termination is visible in scope.
    paths = []
    seen = set()
    complete = CablePath.objects.filter(pk__in=path_ids, is_complete=True, is_split=False)
    for segments in complete.values_list("path", flat=True):
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
            paths.append({"a": [a], "b": [b], "steps": [s for s in steps if isinstance(s, int)]})
    return paths


def build_topology(user, devices, locations, racks, site, location=None, rack=None):
    nodes, groups = device_groups(user, devices, locations, racks, location, rack)
    ports, links, paths = network_cables(user, [node["id"] for node in nodes])
    return {"title": " / ".join(obj.name for obj in (site, location, rack) if obj),
            "hasChildren": any(n["summary"] in groups for n in nodes),
            "nodes": nodes, "groups": groups, "ports": ports, "cables": links, "paths": paths}
