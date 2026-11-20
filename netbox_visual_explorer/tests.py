from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase
from django.urls import reverse

from dcim.models import (
    Cable, Device, DeviceRole, DeviceType, FrontPort, Interface, Location, Manufacturer,
    PortMapping, Rack, RearPort, Site,
)
from extras.models import Tag
from ipam.models import IPAddress

from . import config
from .topology import plan_url
from users.models import ObjectPermission


class ExplorerTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.site = Site.objects.create(name="Campus", slug="campus")
        cls.building = Location.objects.create(site=cls.site, name="Haus", slug="haus")
        cls.floor = Location.objects.create(site=cls.site, parent=cls.building, name="EG", slug="eg")
        cls.rack = Rack.objects.create(site=cls.site, location=cls.floor, name="Rack A")
        role = DeviceRole.objects.create(name="Netzwerk", slug="netzwerk")
        manufacturer = Manufacturer.objects.create(name="Test", slug="test")
        device_type = DeviceType.objects.create(manufacturer=manufacturer, model="Switch", slug="switch")
        fields = dict(site=cls.site, location=cls.floor, rack=cls.rack, role=role, device_type=device_type)
        a, panel, b = [Device.objects.create(name=name, **fields) for name in ("Links", "Patchfeld", "Rechts")]
        cls.device = a
        loopback = Interface.objects.create(device=a, name="lo", type="virtual")
        primary = IPAddress.objects.create(address="192.0.2.1/32", assigned_object=loopback)
        IPAddress.objects.create(address="2001:db8::1/128", assigned_object=loopback)
        a.primary_ip4 = primary
        a.save()
        cls.tag = Tag.objects.create(name="Netzplan", slug="netzplan")
        a.tags.add(cls.tag)
        front = FrontPort.objects.create(device=panel, name="Front 1")
        rear = RearPort.objects.create(device=panel, name="Rückseite 1")
        PortMapping.objects.create(device=panel, front_port=front, rear_port=rear,
                                   front_port_position=1, rear_port_position=1)
        for device, port in [(a, front), (b, rear)]:
            iface = Interface.objects.create(device=device, name="eth0", type="1000base-t")
            Cable(a_terminations=[iface], b_terminations=[port]).save()
        cls.user = get_user_model().objects.create(username="explorer-admin", is_superuser=True)
        cls.reader = get_user_model().objects.create(username="explorer-reader")
        permission = ObjectPermission.objects.create(name="Visible graph", actions=["view"])
        permission.users.add(cls.reader)
        # Hiding just RearPort must suppress both the second cable and the
        # complete cached path, even with access to both end devices.
        permission.object_types.add(*(ContentType.objects.get_for_model(m) for m in
                                      (Device, Interface, FrontPort, Cable)))
        limited = ObjectPermission.objects.create(name="Only this site", actions=["view"],
                                                   constraints={"pk": cls.site.pk})
        limited.users.add(cls.reader)
        limited.object_types.add(ContentType.objects.get_for_model(Site))

    def setUp(self):
        self.url = reverse("plugins:netbox_visual_explorer:explorer")

    def graph(self, obj=None, **params):
        response = self.client.get(plan_url(obj or self.site), params)
        self.assertEqual(response.status_code, 200)
        return response.context["graph"]

    def test_trace_and_descendant_scope(self):
        self.client.force_login(self.user)
        graph = self.graph(self.building)
        self.assertEqual(len(graph["nodes"]), 3)
        self.assertEqual(len(graph["cables"]), 2)
        self.assertTrue(all(port.get("traceable") for port in graph["ports"].values()))
        for key, port in graph["ports"].items():
            model = {"i": "interface", "f": "frontport", "r": "rearport"}[key[0]]
            url = port["traceUrl"]
            self.assertEqual(url.split("?")[0], reverse(f"dcim:{model}_trace", args=[int(key[1:])]))
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.context["path"].is_complete)
            if model != "interface":
                self.assertEqual(response.context["path"].pk, int(response.wsgi_request.GET["cablepath_id"]))
        rear = next(p for p in graph["ports"].values() if p["kind"] == "Rearport")
        front = next(key for key, p in graph["ports"].items() if p["kind"] == "Frontport")
        self.assertEqual(rear["frontMappings"], [[front, 1, 1]])
        self.assertEqual(len(graph["paths"]), 1)
        self.assertEqual(set(graph["paths"][0]["steps"]), {c["id"] for c in graph["cables"]})
        for cable in graph["cables"]:
            self.assertEqual(self.client.get(cable["traceUrl"], {"cablepath_id": graph["paths"][0]["pathId"]}).status_code, 200)
        self.assertNotIn("lo", [port["name"] for port in graph["ports"].values()])
        self.assertEqual([n["name"] for n in self.graph(tag=self.tag.pk)["nodes"]], ["Links"])

    def test_hidden_termination_and_scope(self):
        self.client.force_login(self.reader)
        graph = self.graph()
        self.assertEqual(len(graph["cables"]), 1)
        self.assertEqual(graph["paths"], [])
        self.assertNotIn("Rückseite", str(graph))
        self.assertNotIn("frontMappings", str(graph["ports"]))
        self.assertFalse(any(port.get("traceable") or port.get("traceUrl") for port in graph["ports"].values()))
        other = Site.objects.create(name="Privat", slug="privat")
        self.assertEqual(self.client.get(plan_url(other), {"preview": "1"}).status_code, 404)
        self.assertEqual(self.client.get(self.url, {"site": other.pk}).status_code, 404)
        self.assertEqual(self.client.get(self.url, {"site": self.site.pk, "rack": self.rack.pk}).status_code, 404)

    def test_empty_invalid_and_anonymous_scope(self):
        self.assertEqual(self.client.get(self.url).status_code, 302)
        self.client.force_login(self.user)
        self.assertRedirects(self.client.get(self.url), reverse("dcim:site_list"), fetch_redirect_response=False)
        for value in ("abc", "-1", "9" * 50):
            self.assertEqual(self.client.get(self.url, {"site": value}).status_code, 404)
        empty = Site.objects.create(name="Leer", slug="leer")
        self.assertEqual(self.graph(empty)["nodes"], [])

    def test_native_tabs_and_drill_down(self):
        self.client.force_login(self.user)
        chain = [self.site, self.building, self.floor, self.rack]
        for index, obj in enumerate(chain):
            self.assertContains(self.client.get(obj.get_absolute_url()), plan_url(obj))
            response = self.client.get(plan_url(obj))
            if obj == self.rack:
                self.assertNotContains(response, '<option value="summary">')
            else:
                self.assertContains(response, '<option value="summary">')
            self.assertNotContains(response, 'id="ve-scope"')
            for asset in ("explorer.js", "diagram.js", "viewport.js", "layout-worker.js", "explorer.css"):
                self.assertContains(response, f"netbox_visual_explorer/{asset}?v={config.version}")
            self.assertEqual(response.context["trail"], [(p.name, plan_url(p)) for p in chain[:index + 1]])
            graph = response.context["graph"]
            self.assertEqual(self.client.get(plan_url(obj), {"preview": "1"}).json(), graph)
            if obj != self.rack:
                child = graph["nodes"][0]["summary"]
                self.assertEqual(graph["groups"][child]["url"], plan_url(chain[index + 1]))
            else:
                self.assertFalse(graph["hasChildren"])
        old_link = {"site": self.site.pk, "location": self.building.pk, "rack": self.rack.pk, "mode": "paths"}
        self.assertRedirects(self.client.get(self.url, old_link), plan_url(self.rack, {"mode": "paths"}))

    def test_device_tab_and_pass_through_trace_in_separate_rack(self):
        self.client.force_login(self.user)
        panel = Device.objects.get(name="Patchfeld")
        separate = Rack.objects.create(site=self.site, name="Verteiler")
        Device.objects.filter(pk=panel.pk).update(rack=separate)
        self.assertContains(self.client.get(panel.get_absolute_url()), plan_url(panel))
        response = self.client.get(plan_url(panel))
        self.assertContains(response, f'data-device="{panel.pk}"')
        ports = response.context["graph"]["ports"].values()
        self.assertEqual({p["kind"] for p in ports if p.get("traceable")}, {"Frontport", "Rearport", "Interface"})
        self.assertTrue(all(p.get("traceable") for p in self.graph(separate)["ports"].values()))
        Interface.objects.create(device=self.device, name="extra", type="1000base-t")
        loose = FrontPort.objects.create(device=panel, name="Unvollständig")
        Cable(a_terminations=[Interface.objects.get(device=self.device, name="extra")], b_terminations=[loose]).save()
        self.assertFalse(self.graph(panel)["ports"][f"f{loose.pk}"].get("traceable"))

    def test_complete_device_trail(self):
        self.client.force_login(self.user)
        chain = [self.site, self.building, self.floor, self.rack, self.device]
        expected = [[obj.name, plan_url(obj)] for obj in chain]
        for rack_loc, device_loc in ((self.floor, None), (None, self.floor), (self.floor, self.building)):
            Rack.objects.filter(pk=self.rack.pk).update(location=rack_loc)
            Device.objects.filter(pk=self.device.pk).update(location=device_loc)
            response = self.client.get(plan_url(self.device))
            graph = response.context["graph"]
            self.assertEqual(graph["trail"], expected)
            self.assertEqual(response.context["trail"], [tuple(step) for step in expected])
            node = next(n for n in graph["nodes"] if n["id"] == self.device.pk)
            self.assertEqual(node["trail"], expected[:-1])

    def test_role_filter_choices_and_navigation(self):
        self.client.force_login(self.user)
        panel_role = DeviceRole.objects.create(name="Patchpanel", slug="patchpanel")
        Device.objects.filter(name="Patchfeld").update(role=panel_role)
        role_ids = sorted([self.device.role_id, panel_role.pk])
        params = {"tag": self.tag.pk, "exclude_role": role_ids}
        response = self.client.get(plan_url(self.rack), params)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["excluded_roles"], set(role_ids))
        self.assertEqual({r.pk for r in response.context["roles"]}, set(role_ids))
        self.assertEqual(response.context["graph"]["nodes"][0]["roleId"], self.device.role_id)
        self.assertEqual(response.context["trail"][0][1], plan_url(self.site, params))
        self.assertRedirects(self.client.get(self.url, {"site": self.site.pk, **params}),
                             plan_url(self.site, params), fetch_redirect_response=False)
        self.client.force_login(self.reader)
        self.assertEqual(self.client.get(plan_url(self.site), params).status_code, 404)
        self.assertEqual(self.client.get(plan_url(self.site), {"exclude_role": panel_role.pk}).status_code, 404)
        self.assertFalse(self.client.get(plan_url(self.site)).context["roles"].exists())

    def test_selected_device_details_respect_permissions(self):
        self.client.force_login(self.user)
        url = reverse("plugins:netbox_visual_explorer:device_details", args=[self.device.pk])
        info = self.client.get(url).json()
        self.assertEqual((info["name"], info["manufacturer"], info["model"]), ("Links", "Test", "Switch"))
        self.assertEqual(info["addresses"], [
            {"address": "192.0.2.1/32", "primary": True, "oob": False},
            {"address": "2001:db8::1/128", "primary": False, "oob": False},
        ])
        self.client.force_login(self.reader)
        restricted = self.client.get(url).json()
        self.assertIsNone(restricted["manufacturer"])
        self.assertIsNone(restricted["model"])
        self.assertEqual(restricted["addresses"], [])
        limited = ObjectPermission.objects.get(name="Visible graph")
        limited.constraints = {"pk": 999999}
        limited.save()
        self.assertEqual(self.client.get(url).status_code, 404)
