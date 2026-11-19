from urllib.parse import urlencode

from django.contrib.auth.decorators import login_required, permission_required
from django.contrib.contenttypes.models import ContentType
from django.db.models import Q
from django.http import Http404, JsonResponse
from django.shortcuts import get_object_or_404, redirect
from django.utils.decorators import method_decorator
from django.views.decorators.http import require_GET

from dcim.models import Device, DeviceRole, DeviceType, Interface, Location, Manufacturer, Rack, Site
from extras.models import Tag
from ipam.models import IPAddress
from netbox.views.generic import ObjectView
from utilities.views import ViewTab, register_model_view

from . import config
from .topology import build_topology, device_plan_members, plan_url


def object_id(value):
    if not value or not value.isascii() or not value.isdecimal() or len(value) > 19:
        raise Http404
    number = int(value)
    if not 0 < number <= 2**63 - 1:
        raise Http404
    return number


def selected_ids(params, key, choices):
    ids = {object_id(value) for value in params.getlist(key) if value}
    if ids and ids != set(choices.filter(pk__in=ids).values_list("pk", flat=True)):
        raise Http404
    return ids


@method_decorator(login_required, name="dispatch")
class PlanView(ObjectView):
    additional_permissions = ("dcim.view_device", "dcim.view_site")
    template_name = "netbox_visual_explorer/explorer.html"
    tab = ViewTab(label="Blockschaltplan", permission="dcim.view_device", weight=800)
    http_method_names = ["get", "head", "options"]

    def get(self, request, **kwargs):
        if request.GET.get("preview") == "1":
            instance = self.get_object(**kwargs)
            return JsonResponse(self.get_extra_context(request, instance)["graph"])
        return super().get(request, **kwargs)

    def get_extra_context(self, request, instance):
        user = request.user
        site = instance if isinstance(instance, Site) else get_object_or_404(
            Site.objects.restrict(user, "view"), pk=instance.site_id
        )
        locations = Location.objects.restrict(user, "view").filter(site=site).in_bulk()
        racks = Rack.objects.restrict(user, "view").filter(site=site).in_bulk()
        devices = Device.objects.restrict(user, "view").filter(site=site)
        location = instance if isinstance(instance, Location) else None
        rack = instance if isinstance(instance, Rack) else None
        device = instance if isinstance(instance, Device) else None
        if device:
            devices = devices.filter(Q(pk=device.pk) | Q(pk__in=device_plan_members(user, device)))
        elif rack:
            devices = devices.filter(rack=rack)
        elif location:
            descendants = {loc.pk for loc in locations.values() if loc.tree_id == location.tree_id
                           and location.lft <= loc.lft <= location.rght}
            devices = devices.filter(Q(location_id__in=descendants) | Q(
                location__isnull=True, rack_id__in=[r.pk for r in racks.values() if r.location_id in descendants]
            ))
        tags = Tag.objects.restrict(user, "view").filter(
            Q(object_types__isnull=True) | Q(object_types__app_label="dcim", object_types__model="device")
        ).order_by("name")
        tag_ids = selected_ids(request.GET, "tag", tags)
        roles = DeviceRole.objects.restrict(user, "view")
        excluded_roles = selected_ids(request.GET, "exclude_role", roles)
        # Keep applied exclusions available when drilling into a rack without that role.
        role_ids = devices.values("role_id")
        if tag_ids:
            devices = devices.filter(tags__in=tag_ids).distinct()

        if device:
            rack = racks.get(device.rack_id)
            location = locations.get(device.location_id)
        filters = [("tag", t) for t in sorted(tag_ids)]
        filters.extend(("exclude_role", pk) for pk in sorted(excluded_roles))
        if request.GET.get("ports") in ("0", "1"):
            filters.append(("ports", request.GET["ports"]))
        query = "?" + urlencode(filters) if filters else ""
        graph = build_topology(user, devices, locations, racks, site, location, rack, device)
        if device:
            role_ids = {n["roleId"] for n in graph["nodes"] if n["roleId"]}
        role_choices = roles.filter(Q(pk__in=role_ids) | Q(pk__in=excluded_roles)).order_by("name", "pk")
        return {
            "explorer_version": config.version,
            "device_focus": device.pk if device else None,
            "trail": [(name, url + query) for name, url in graph["trail"]],
            "roles": role_choices, "excluded_roles": excluded_roles,
            "tags": tags, "tag_ids": tag_ids,
            "graph": graph,
        }


@register_model_view(Site, "blockschaltplan")
class SitePlanView(PlanView):
    queryset = Site.objects.all()


@register_model_view(Location, "blockschaltplan")
class LocationPlanView(PlanView):
    queryset = Location.objects.all()


@register_model_view(Rack, "blockschaltplan")
class RackPlanView(PlanView):
    queryset = Rack.objects.all()


@register_model_view(Device, "blockschaltplan")
class DevicePlanView(PlanView):
    queryset = Device.objects.all()


@login_required
@permission_required(("dcim.view_device", "dcim.view_site"), raise_exception=True)
@require_GET
def explorer(request):
    """Resolve bookmarks from the original scope selector."""
    if not request.GET.get("site"):
        return redirect("dcim:site_list")
    site = get_object_or_404(Site.objects.restrict(request.user, "view"), pk=object_id(request.GET["site"]))
    obj = site
    if request.GET.get("location"):
        obj = get_object_or_404(Location.objects.restrict(request.user, "view"), site=site,
                                pk=object_id(request.GET["location"]))
    if request.GET.get("rack"):
        racks = Rack.objects.restrict(request.user, "view").filter(site=site)
        if isinstance(obj, Location):
            allowed = obj.get_descendants(include_self=True).restrict(request.user, "view")
            racks = racks.filter(location__in=allowed)
        obj = get_object_or_404(racks, pk=object_id(request.GET["rack"]))
    query = [(key, val) for key in ("mode", "focus", "tag", "exclude_role", "ports") for val in request.GET.getlist(key)]
    return redirect(plan_url(obj, query))


@login_required
@permission_required("dcim.view_device", raise_exception=True)
@require_GET
def device_details(request, pk):
    user = request.user
    device = get_object_or_404(Device.objects.restrict(user, "view"), pk=pk)
    device_type = DeviceType.objects.restrict(user, "view").filter(pk=device.device_type_id).first()
    manufacturer = None
    if device_type:
        manufacturer = Manufacturer.objects.restrict(user, "view").filter(
            pk=device_type.manufacturer_id
        ).values_list("name", flat=True).first()
    interfaces = Interface.objects.restrict(user, "view").filter(device=device)
    primary = {device.primary_ip4_id, device.primary_ip6_id}
    addresses = IPAddress.objects.restrict(user, "view").filter(
        Q(assigned_object_type=ContentType.objects.get_for_model(Interface),
          assigned_object_id__in=interfaces.values("pk")) | Q(pk__in=primary | {device.oob_ip_id})
    ).order_by("address", "pk").values_list("pk", "address")
    return JsonResponse({
        "name": device.name or f"Gerät #{device.pk}", "manufacturer": manufacturer,
        "model": device_type.model if device_type else None, "status": device.get_status_display(),
        "serial": device.serial, "assetTag": device.asset_tag,
        "addresses": [{"address": str(address), "primary": pk in primary, "oob": pk == device.oob_ip_id}
                      for pk, address in addresses],
    })
